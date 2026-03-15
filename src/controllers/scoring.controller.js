const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const ScoringEvent = require('../models/ScoringEvent');
const PlayerMatchStats = require('../models/PlayerMatchStats');
const { createAuditEntry } = require('../middleware/audit');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../utils/errors');
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, MATCH_STATUS } = require('../utils/constants');
const { getIO } = require('../config/socket');
const aiService = require('../services/ai.service');
const notificationService = require('../services/notification.service');
const { getEngine } = require('../scoring');

/**
 * Build notification body text (standalone to avoid `this` binding issues)
 */
function buildNotificationBody(eventType, eventData, match) {
  const scoreDisplay = `${match.currentState?.scoreA || 0} - ${match.currentState?.scoreB || 0}`;

  switch (eventType) {
    case 'wicket':
      return `Wicket! Score: ${match.currentState?.score || 0}/${match.currentState?.wickets || 0}`;
    case 'goal':
      return `GOAL! Score: ${scoreDisplay}`;
    case 'shot_made':
      return `${eventData?.shotType} made! Score: ${scoreDisplay}`;
    case 'set_end':
    case 'game_end':
      return `Set/Game complete! Score update.`;
    default:
      return `Score update: ${scoreDisplay}`;
  }
}

class ScoringController {
  /**
   * POST /api/scoring/:matchId/events
   * Submit a scoring event
   */
  async submitEvent(req, res, next) {
    try {
      const { matchId } = req.params;
      const { eventType, eventData, playerId, teamId } = req.body;

      const match = await Match.findById(matchId);
      if (!match) throw new NotFoundError('Match not found');

      // Verify match is live
      if (match.status !== MATCH_STATUS.LIVE) {
        throw new BadRequestError('Match is not live. Cannot submit scoring events.');
      }

      // Verify scorer authorization
      if (req.requireScorerCheck) {
        if (!match.scorerUserId || match.scorerUserId.toString() !== req.userId.toString()) {
          throw new ForbiddenError('You are not the assigned scorer for this match');
        }
      }

      // Get tournament rules
      const tournament = await Tournament.findById(match.tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      // Get sport engine
      const engine = getEngine(match.sportType);

      // Normalize event: flatten eventData into the event object so all engines
      // can read fields at the top level (e.g. event.shotType, event.team)
      // while still supporting event.eventData for engines that use that pattern.
      const normalizedEvent = { eventType, eventData, ...(eventData || {}) };
      if (teamId) normalizedEvent.teamId = teamId;
      if (playerId) normalizedEvent.playerId = playerId;

      // Validate event
      const validation = engine.validateEvent(match, normalizedEvent, tournament.rulesConfig);
      if (validation && validation.valid === false) {
        throw new BadRequestError(validation.reason || 'Event validation failed');
      }

      // Get next sequence number
      const lastEvent = await ScoringEvent.findOne({ matchId })
        .sort({ sequenceNumber: -1 });
      const sequenceNumber = (lastEvent?.sequenceNumber || 0) + 1;

      // Save state snapshot before processing
      const stateSnapshot = JSON.parse(JSON.stringify(match.currentState));

      // Process event through engine
      const result = engine.processEvent(match, normalizedEvent, tournament.rulesConfig);
      match.currentState = result.state;

      // Calculate win probability
      match.winProbability = aiService.calculateWinProbability(
        match.currentState,
        match.sportType,
        tournament.rulesConfig
      );

      // Check if match is complete
      if (engine.isMatchComplete(match.currentState, tournament.rulesConfig)) {
        match.currentState.matchComplete = true;
      }

      await match.save();

      // Create scoring event
      const scoringEvent = new ScoringEvent({
        matchId,
        sportType: match.sportType,
        eventType,
        eventData,
        playerId: playerId || null,
        teamId: teamId || null,
        sequenceNumber,
        stateSnapshot,
        createdBy: req.userId,
      });

      // Check notification worthiness
      const isNotificationWorthy = await aiService.evaluateNotificationWorthiness(
        { eventType, eventData },
        {
          sportType: match.sportType,
          currentState: match.currentState,
          rulesConfig: tournament.rulesConfig,
        }
      );
      scoringEvent.isNotificationWorthy = isNotificationWorthy;

      await scoringEvent.save();

      // Emit to socket rooms
      try {
        const io = getIO();
        io.to(`match:${matchId}`).emit('score_update', {
          currentState: match.currentState,
          event: scoringEvent,
          winProbability: match.winProbability,
        });
        io.to(`tournament:${match.tournamentId}`).emit('match_update', {
          matchId,
          currentState: match.currentState,
        });
      } catch (e) { /* socket not available */ }

      // AI commentary (async, non-blocking)
      const [teamA, teamB] = await Promise.all([
        Team.findById(match.teamA).select('name'),
        Team.findById(match.teamB).select('name'),
      ]);

      aiService.generateCommentary(
        { eventType, eventData },
        {
          sportType: match.sportType,
          currentState: match.currentState,
          teamAName: teamA?.name,
          teamBName: teamB?.name,
        }
      ).then(async (commentary) => {
        scoringEvent.aiCommentary = commentary;
        await scoringEvent.save();

        // Emit commentary
        try {
          const io = getIO();
          io.to(`match:${matchId}`).emit('commentary', {
            eventId: scoringEvent._id,
            text: commentary,
          });
        } catch (e) {}
      }).catch((err) => console.error('Commentary error:', err.message));

      // Send push notification if worthy (async)
      if (isNotificationWorthy) {
        notificationService.notifySubscribers({
          tournamentId: match.tournamentId,
          organizationId: tournament.organizationId,
          type: eventType,
          title: `${teamA?.name || 'Team A'} vs ${teamB?.name || 'Team B'}`,
          body: buildNotificationBody(eventType, eventData, match),
          data: { matchId, tournamentId: match.tournamentId, sportType: match.sportType },
          excludeUserId: req.userId,
        }).catch((err) => console.error('Notification error:', err.message));
      }

      // Audit log
      await createAuditEntry({
        organizationId: tournament.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.SCORE_EVENT,
        entityType: AUDIT_ENTITY_TYPES.SCORING_EVENT,
        entityId: scoringEvent._id,
        newValue: { eventType, eventData, sequenceNumber },
        req,
      });

      res.status(201).json({
        success: true,
        data: {
          event: scoringEvent,
          currentState: match.currentState,
          winProbability: match.winProbability,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/scoring/:matchId/events/:eventId/undo
   * Undo a scoring event (soft delete with mandatory reason)
   */
  async undoEvent(req, res, next) {
    try {
      const { matchId, eventId } = req.params;
      const { reason } = req.body;

      const match = await Match.findById(matchId);
      if (!match) throw new NotFoundError('Match not found');

      if (match.status !== MATCH_STATUS.LIVE) {
        throw new BadRequestError('Can only undo events in a live match');
      }

      // Verify scorer authorization
      if (req.requireScorerCheck) {
        if (!match.scorerUserId || match.scorerUserId.toString() !== req.userId.toString()) {
          throw new ForbiddenError('You are not the assigned scorer for this match');
        }
      }

      const event = await ScoringEvent.findOne({ _id: eventId, matchId });
      if (!event) throw new NotFoundError('Scoring event not found');

      if (event.isUndone) {
        throw new BadRequestError('Event already undone');
      }

      // Mark event as undone
      event.isUndone = true;
      event.undoneBy = req.userId;
      event.undoReason = reason;
      event.undoneAt = new Date();
      await event.save();

      // Rollback state: replay all non-undone events
      const tournament = await Tournament.findById(match.tournamentId);
      const engine = getEngine(match.sportType);

      // If the undone event has a state snapshot, we can use it
      if (event.stateSnapshot) {
        // Find the event just before this one
        const previousEvent = await ScoringEvent.findOne({
          matchId,
          sequenceNumber: { $lt: event.sequenceNumber },
          isUndone: false,
        }).sort({ sequenceNumber: -1 });

        if (previousEvent?.stateSnapshot) {
          // Replay from previous snapshot
          match.currentState = previousEvent.stateSnapshot;

          // Now replay events after the previous one (excluding undone ones)
          const eventsToReplay = await ScoringEvent.find({
            matchId,
            sequenceNumber: { $gt: previousEvent.sequenceNumber },
            isUndone: false,
          }).sort({ sequenceNumber: 1 });

          for (const evt of eventsToReplay) {
            const result = engine.processEvent(match, evt, tournament.rulesConfig);
            match.currentState = result.state;
          }
        } else {
          // Fallback: use the snapshot from undone event
          match.currentState = event.stateSnapshot;
        }
      } else {
        // Full replay from initial state
        match.currentState = engine.initializeState(match, tournament.rulesConfig);
        const allEvents = await ScoringEvent.find({
          matchId,
          isUndone: false,
        }).sort({ sequenceNumber: 1 });

        for (const evt of allEvents) {
          const result = engine.processEvent(match, evt, tournament.rulesConfig);
          match.currentState = result.state;
        }
      }

      // Recalculate win probability
      match.winProbability = aiService.calculateWinProbability(
        match.currentState,
        match.sportType,
        tournament.rulesConfig
      );

      await match.save();

      // Emit updated state
      try {
        const io = getIO();
        io.to(`match:${matchId}`).emit('score_update', {
          currentState: match.currentState,
          event: { ...event.toObject(), isUndone: true },
          winProbability: match.winProbability,
          undone: true,
        });
      } catch (e) {}

      // Audit log (mandatory for undo)
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.SCORE_UNDO,
        entityType: AUDIT_ENTITY_TYPES.SCORING_EVENT,
        entityId: event._id,
        oldValue: { eventType: event.eventType, eventData: event.eventData },
        reason,
        req,
      });

      res.json({
        success: true,
        data: {
          event,
          currentState: match.currentState,
          winProbability: match.winProbability,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/scoring/:matchId/events
   * Get event timeline for a match
   */
  async getEvents(req, res, next) {
    try {
      const { matchId } = req.params;
      const { includeUndone } = req.query;

      const filter = { matchId };
      if (includeUndone !== 'true') {
        filter.isUndone = false;
      }

      const events = await ScoringEvent.find(filter)
        .populate('playerId', 'fullName')
        .populate('teamId', 'name shortName')
        .populate('createdBy', 'fullName')
        .sort({ sequenceNumber: 1 });

      res.json({
        success: true,
        data: events,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/scoring/:matchId/stats
   * Get player stats for a match
   */
  async getMatchStats(req, res, next) {
    try {
      const { matchId } = req.params;

      const stats = await PlayerMatchStats.find({ matchId })
        .populate('playerId', 'fullName avatarUrl')
        .populate('teamId', 'name shortName color');

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

}

module.exports = new ScoringController();

const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const ScoringEvent = require('../models/ScoringEvent');
const { createAuditEntry } = require('../middleware/audit');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../utils/errors');
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, MATCH_STATUS } = require('../utils/constants');
const { parsePagination, paginationMeta } = require('../utils/helpers');
const { getIO } = require('../config/socket');
const standingsService = require('../services/standings.service');
const aiService = require('../services/ai.service');
const emailService = require('../services/email.service');

/**
 * Build result summary from match state (standalone function to avoid `this` binding issues)
 */
function buildResultSummary(match, state) {
  if (!state) return {};

  const sport = match.sportType;
  let winnerId = null;
  let scoreA = '';
  let scoreB = '';
  let margin = '';

  switch (sport) {
    case 'cricket': {
      const inn1 = state.innings?.[0] || {};
      const inn2 = state.innings?.[1] || {};
      scoreA = `${inn1.score || 0}/${inn1.wickets || 0} (${inn1.overs || 0})`;
      scoreB = `${inn2.score || 0}/${inn2.wickets || 0} (${inn2.overs || 0})`;

      if ((inn1.score || 0) > (inn2.score || 0)) {
        winnerId = match.teamA;
        margin = `${(inn1.score || 0) - (inn2.score || 0)} runs`;
      } else if ((inn2.score || 0) > (inn1.score || 0)) {
        winnerId = match.teamB;
        margin = `${10 - (inn2.wickets || 0)} wickets`;
      }
      break;
    }
    case 'football':
    case 'basketball_5v5':
    case 'basketball_3x3': {
      scoreA = String(state.scoreA || 0);
      scoreB = String(state.scoreB || 0);
      if ((state.scoreA || 0) > (state.scoreB || 0)) {
        winnerId = match.teamA;
        margin = `${(state.scoreA || 0) - (state.scoreB || 0)} ${sport === 'football' ? 'goals' : 'points'}`;
      } else if ((state.scoreB || 0) > (state.scoreA || 0)) {
        winnerId = match.teamB;
        margin = `${(state.scoreB || 0) - (state.scoreA || 0)} ${sport === 'football' ? 'goals' : 'points'}`;
      }
      break;
    }
    default: {
      scoreA = String(state.setsWonA || state.gamesWonA || 0);
      scoreB = String(state.setsWonB || state.gamesWonB || 0);
      if ((state.setsWonA || state.gamesWonA || 0) > (state.setsWonB || state.gamesWonB || 0)) {
        winnerId = match.teamA;
      } else if ((state.setsWonB || state.gamesWonB || 0) > (state.setsWonA || state.gamesWonA || 0)) {
        winnerId = match.teamB;
      }
      margin = `${scoreA}-${scoreB} (sets)`;
      break;
    }
  }

  return {
    winnerId,
    scoreA,
    scoreB,
    margin,
    resultType: winnerId ? 'normal' : 'draw',
  };
}

class MatchController {
  /**
   * POST /api/matches
   */
  async create(req, res, next) {
    try {
      const {
        tournamentId, teamA, teamB, scheduledAt,
        venue, stage, groupName, matchNumber,
      } = req.body;

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      // Validate teams belong to tournament
      const [tA, tB] = await Promise.all([
        Team.findOne({ _id: teamA, tournamentId }),
        Team.findOne({ _id: teamB, tournamentId }),
      ]);

      if (!tA || !tB) throw new BadRequestError('Teams must belong to the tournament');
      if (teamA === teamB) throw new BadRequestError('A team cannot play against itself');

      const match = new Match({
        tournamentId,
        sportType: tournament.sportType,
        teamA,
        teamB,
        scheduledAt,
        venue,
        stage: stage || 'group',
        groupName,
        matchNumber,
        status: MATCH_STATUS.SCHEDULED,
      });

      await match.save();

      await createAuditEntry({
        organizationId: tournament.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.MATCH_CREATE,
        entityType: AUDIT_ENTITY_TYPES.MATCH,
        entityId: match._id,
        newValue: { teamA: tA.name, teamB: tB.name, scheduledAt },
        req,
      });

      res.status(201).json({
        success: true,
        data: match,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/matches/:matchId
   */
  async getById(req, res, next) {
    try {
      const match = await Match.findById(req.params.matchId)
        .populate('teamA', 'name shortName color logoUrl players')
        .populate('teamB', 'name shortName color logoUrl players')
        .populate('tournamentId', 'name sportType rulesConfig organizationId')
        .populate('scorerUserId', 'fullName')
        .populate('resultSummary.motm', 'fullName avatarUrl');

      if (!match) throw new NotFoundError('Match not found');

      res.json({
        success: true,
        data: match,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/matches/:matchId
   */
  async update(req, res, next) {
    try {
      const match = await Match.findById(req.params.matchId);
      if (!match) throw new NotFoundError('Match not found');

      const oldValue = match.toObject();
      const allowedFields = ['scheduledAt', 'venue', 'stage', 'groupName', 'matchNumber'];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          match[field] = req.body[field];
        }
      }

      await match.save();

      const tournament = await Tournament.findById(match.tournamentId);
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.MATCH_UPDATE,
        entityType: AUDIT_ENTITY_TYPES.MATCH,
        entityId: match._id,
        oldValue,
        newValue: req.body,
        req,
      });

      res.json({
        success: true,
        data: match,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/matches/:matchId/scorer
   */
  async assignScorer(req, res, next) {
    try {
      const { scorerUserId } = req.body;
      const match = await Match.findById(req.params.matchId);
      if (!match) throw new NotFoundError('Match not found');

      const oldScorer = match.scorerUserId;
      match.scorerUserId = scorerUserId;
      await match.save();

      const tournament = await Tournament.findById(match.tournamentId);
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.SCORER_ASSIGN,
        entityType: AUDIT_ENTITY_TYPES.MATCH,
        entityId: match._id,
        oldValue: { scorerUserId: oldScorer },
        newValue: { scorerUserId },
        req,
      });

      // Send assignment email to scorer
      const scorer = await require('../models/User').findById(scorerUserId);
      if (scorer?.email) {
        const [tA, tB] = await Promise.all([
          Team.findById(match.teamA),
          Team.findById(match.teamB),
        ]);
        emailService.sendScorerAssignmentEmail({
          to: scorer.email,
          matchDetails: {
            teamA: tA?.name,
            teamB: tB?.name,
            scheduledAt: match.scheduledAt,
            venue: match.venue,
          },
          tournamentName: tournament?.name,
        }).catch((err) => console.error('Scorer email failed:', err.message));
      }

      res.json({
        success: true,
        data: match,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/matches/:matchId/lifecycle
   * Handle match start, pause, resume, end
   */
  async lifecycle(req, res, next) {
    try {
      const { action, toss } = req.body;
      const match = await Match.findById(req.params.matchId);
      if (!match) throw new NotFoundError('Match not found');

      // Verify scorer authorization
      if (req.requireScorerCheck) {
        if (!match.scorerUserId || match.scorerUserId.toString() !== req.userId.toString()) {
          throw new ForbiddenError('You are not the assigned scorer for this match');
        }
      }

      const tournament = await Tournament.findById(match.tournamentId);

      switch (action) {
        case 'start': {
          if (match.status !== MATCH_STATUS.SCHEDULED && match.status !== MATCH_STATUS.POSTPONED) {
            throw new BadRequestError('Match can only be started from scheduled or postponed status');
          }

          // Initialize sport-specific state
          const { getEngine } = require('../scoring');
          const engine = getEngine(match.sportType);
          match.currentState = engine.initializeState(match, tournament.rulesConfig);
          match.status = MATCH_STATUS.LIVE;
          match.startedAt = new Date();

          // Set toss for cricket
          if (toss && match.sportType === 'cricket') {
            match.toss = toss;
          }

          await match.save();

          // Emit to socket rooms
          try {
            const io = getIO();
            io.to(`match:${match._id}`).emit('match_lifecycle', { action: 'start', match });
            io.to(`tournament:${match.tournamentId}`).emit('match_update', {
              matchId: match._id,
              status: 'live',
            });
          } catch (e) { /* socket not available */ }

          await createAuditEntry({
            organizationId: tournament?.organizationId,
            userId: req.userId,
            userRole: req.user.role,
            actionType: AUDIT_ACTIONS.MATCH_START,
            entityType: AUDIT_ENTITY_TYPES.MATCH,
            entityId: match._id,
            newValue: { status: 'live', toss },
            req,
          });
          break;
        }

        case 'pause': {
          if (match.status !== MATCH_STATUS.LIVE) {
            throw new BadRequestError('Can only pause a live match');
          }

          // Pause clocks if applicable
          if (match.currentState?.clockRunning) {
            const elapsed = (Date.now() - new Date(match.currentState.clockStartedAt).getTime()) / 1000;
            match.currentState.clockSeconds = Math.max(0, match.currentState.clockSeconds - elapsed);
            match.currentState.clockRunning = false;
            match.currentState.clockStartedAt = null;
          }

          match.status = MATCH_STATUS.LIVE; // Still live, just paused
          match.currentState.isPaused = true;
          match.markModified('currentState');
          await match.save();

          try {
            const io = getIO();
            io.to(`match:${match._id}`).emit('match_lifecycle', { action: 'pause', match });
          } catch (e) {}

          await createAuditEntry({
            organizationId: tournament?.organizationId,
            userId: req.userId,
            userRole: req.user.role,
            actionType: AUDIT_ACTIONS.MATCH_PAUSE,
            entityType: AUDIT_ENTITY_TYPES.MATCH,
            entityId: match._id,
            req,
          });
          break;
        }

        case 'resume': {
          if (!match.currentState?.isPaused) {
            throw new BadRequestError('Match is not paused');
          }

          match.currentState.isPaused = false;

          // Resume clocks if applicable
          if (match.currentState.clockSeconds > 0) {
            match.currentState.clockRunning = true;
            match.currentState.clockStartedAt = new Date();
          }

          match.markModified('currentState');
          await match.save();

          try {
            const io = getIO();
            io.to(`match:${match._id}`).emit('match_lifecycle', { action: 'resume', match });
          } catch (e) {}

          await createAuditEntry({
            organizationId: tournament?.organizationId,
            userId: req.userId,
            userRole: req.user.role,
            actionType: AUDIT_ACTIONS.MATCH_RESUME,
            entityType: AUDIT_ENTITY_TYPES.MATCH,
            entityId: match._id,
            req,
          });
          break;
        }

        case 'end': {
          if (match.status !== MATCH_STATUS.LIVE) {
            throw new BadRequestError('Can only end a live match');
          }

          match.status = MATCH_STATUS.COMPLETED;
          match.completedAt = new Date();

          // Determine winner (engine-specific)
          const { getEngine } = require('../scoring');
          const engine = getEngine(match.sportType);

          // Build result summary from current state
          const state = match.currentState;
          match.resultSummary = buildResultSummary(match, state);

          // Generate rule-based insights immediately (always available)
          const matchEvents = await ScoringEvent.find({ matchId: match._id, isUndone: false });
          const insights = aiService.generateMatchInsights(match, matchEvents, []);
          match.matchInsights = insights;

          match.markModified('currentState');
          match.markModified('matchInsights');
          await match.save();

          // Update standings
          await standingsService.updateAfterMatch(match);

          // Generate AI summary (async, non-blocking — enhances insights with AI narrative)
          aiService.generateMatchSummary(
            match,
            matchEvents,
            []
          ).then(async (summary) => {
            if (summary) {
              match.aiSummary = summary;
              match.markModified('aiSummary');
              await match.save();
            }
          }).catch((err) => console.error('AI summary failed:', err.message));

          try {
            const io = getIO();
            io.to(`match:${match._id}`).emit('match_lifecycle', { action: 'end', match });
            io.to(`tournament:${match.tournamentId}`).emit('match_update', {
              matchId: match._id,
              status: 'completed',
              resultSummary: match.resultSummary,
            });
          } catch (e) {}

          await createAuditEntry({
            organizationId: tournament?.organizationId,
            userId: req.userId,
            userRole: req.user.role,
            actionType: AUDIT_ACTIONS.MATCH_END,
            entityType: AUDIT_ENTITY_TYPES.MATCH,
            entityId: match._id,
            newValue: { resultSummary: match.resultSummary },
            req,
          });
          break;
        }

        case 'cancel': {
          if (!['scheduled', 'live', 'postponed'].includes(match.status)) {
            throw new BadRequestError('Can only cancel a scheduled, live, or postponed match');
          }

          // Stop clock if running
          if (match.currentState?.clockRunning) {
            match.currentState.clockRunning = false;
            match.currentState.clockStartedAt = null;
          }

          match.status = MATCH_STATUS.CANCELLED;
          match.completedAt = new Date();
          match.resultSummary = {
            resultType: 'abandoned',
            reason: req.body.reason || 'Match cancelled',
          };
          match.markModified('currentState');
          match.markModified('resultSummary');
          await match.save();

          try {
            const io = getIO();
            io.to(`match:${match._id}`).emit('match_lifecycle', { action: 'cancel', match });
            io.to(`tournament:${match.tournamentId}`).emit('match_update', {
              matchId: match._id,
              status: 'cancelled',
            });
          } catch (e) {}

          await createAuditEntry({
            organizationId: tournament?.organizationId,
            userId: req.userId,
            userRole: req.user.role,
            actionType: AUDIT_ACTIONS.MATCH_CANCEL,
            entityType: AUDIT_ENTITY_TYPES.MATCH,
            entityId: match._id,
            newValue: { reason: req.body.reason },
            req,
          });
          break;
        }

        case 'postpone': {
          if (!['scheduled', 'live'].includes(match.status)) {
            throw new BadRequestError('Can only postpone a scheduled or live match');
          }

          // Pause clock if running
          if (match.currentState?.clockRunning) {
            const elapsed = (Date.now() - new Date(match.currentState.clockStartedAt).getTime()) / 1000;
            match.currentState.clockSeconds = Math.max(0, match.currentState.clockSeconds - elapsed);
            match.currentState.clockRunning = false;
            match.currentState.clockStartedAt = null;
            match.currentState.isPaused = true;
          }

          match.status = MATCH_STATUS.POSTPONED;
          match.markModified('currentState');
          await match.save();

          try {
            const io = getIO();
            io.to(`match:${match._id}`).emit('match_lifecycle', { action: 'postpone', match });
            io.to(`tournament:${match.tournamentId}`).emit('match_update', {
              matchId: match._id,
              status: 'postponed',
            });
          } catch (e) {}

          await createAuditEntry({
            organizationId: tournament?.organizationId,
            userId: req.userId,
            userRole: req.user.role,
            actionType: AUDIT_ACTIONS.MATCH_POSTPONE,
            entityType: AUDIT_ENTITY_TYPES.MATCH,
            entityId: match._id,
            newValue: { reason: req.body.reason },
            req,
          });
          break;
        }

        default:
          throw new BadRequestError(`Invalid action: ${action}`);
      }

      res.json({
        success: true,
        data: match,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/matches/tournament/:tournamentId
   */
  async getByTournament(req, res, next) {
    try {
      const { status, stage, groupName } = req.query;
      const filter = { tournamentId: req.params.tournamentId };

      if (status) filter.status = status;
      if (stage) filter.stage = stage;
      if (groupName) filter.groupName = groupName;

      const matches = await Match.find(filter)
        .populate('teamA', 'name shortName color logoUrl')
        .populate('teamB', 'name shortName color logoUrl')
        .populate('scorerUserId', 'fullName')
        .sort({ matchNumber: 1, scheduledAt: 1 });

      res.json({
        success: true,
        data: matches,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/matches/live
   * All live matches globally
   */
  async getLive(req, res, next) {
    try {
      const filter = { status: MATCH_STATUS.LIVE };

      if (req.query.sportType) filter.sportType = req.query.sportType;
      if (req.query.organizationId) {
        const Tournament = require('../models/Tournament');
        const tournaments = await Tournament.find({ organizationId: req.query.organizationId }).select('_id');
        filter.tournamentId = { $in: tournaments.map((t) => t._id) };
      }

      const matches = await Match.find(filter)
        .populate('teamA', 'name shortName color logoUrl')
        .populate('teamB', 'name shortName color logoUrl')
        .populate('tournamentId', 'name sportType organizationId')
        .sort({ startedAt: -1 });

      res.json({
        success: true,
        data: matches,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/matches/scorer/my-matches
   * Get matches assigned to the current scorer
   */
  async getScorerMatches(req, res, next) {
    try {
      const matches = await Match.find({
        scorerUserId: req.userId,
        status: { $in: ['scheduled', 'live'] },
      })
        .populate('teamA', 'name shortName color')
        .populate('teamB', 'name shortName color')
        .populate('tournamentId', 'name sportType rulesConfig')
        .sort({ scheduledAt: 1 });

      res.json({
        success: true,
        data: matches,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new MatchController();

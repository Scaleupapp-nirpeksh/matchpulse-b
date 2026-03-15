// ============================================
// MatchPulse — Football Scoring Engine
// ============================================
// Clock-based state machine for association
// football. Handles goals, cards (yellow/red
// with second-yellow logic), substitutions,
// half management, and optional extra time
// with penalty shootouts.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');
const {
  FOOTBALL_CARD_TYPES,
  FOOTBALL_EVENT_TYPES,
  EVENT_TYPES,
} = require('../utils/constants');

const VALID_EVENT_TYPES = [
  FOOTBALL_EVENT_TYPES.GOAL,
  FOOTBALL_EVENT_TYPES.CARD,
  FOOTBALL_EVENT_TYPES.SUBSTITUTION,
  FOOTBALL_EVENT_TYPES.HALF_START,
  FOOTBALL_EVENT_TYPES.HALF_END,
];

const VALID_CARD_TYPES = Object.values(FOOTBALL_CARD_TYPES);

// Half identifiers
const HALF = {
  FIRST: 1,
  SECOND: 2,
  EXTRA_FIRST: 3,
  EXTRA_SECOND: 4,
  PENALTIES: 5,
};

const TEAM_SIDES = ['a', 'b'];

class FootballScoringEngine extends BaseScoringEngine {
  constructor() {
    super('football');
  }

  // -------------------------------------------
  // initializeState
  // -------------------------------------------

  initializeState(match, rulesConfig) {
    this._assert(match.teamA, 'match.teamA is required');
    this._assert(match.teamB, 'match.teamB is required');

    const teamAId = match.teamA._id
      ? match.teamA._id.toString()
      : match.teamA.toString();
    const teamBId = match.teamB._id
      ? match.teamB._id.toString()
      : match.teamB.toString();

    return {
      teamAId,
      teamBId,
      scoreA: 0,
      scoreB: 0,
      half: 0, // 0 = not started, 1 = first half, 2 = second half, 3/4 = ET, 5 = penalties
      clockSeconds: 0,
      clockRunning: false,
      clockStartedAt: null,
      events: [],
      cards: {
        a: { yellow: [], red: [] },
        b: { yellow: [], red: [] },
      },
      substitutions: {
        a: [],
        b: [],
      },
      penalties: null, // populated only if shootout begins
      isComplete: false,
      matchResult: null,
      halfLength: rulesConfig.halfLength || 30,
      extraTime: !!rulesConfig.extraTime,
      extraTimeLength: rulesConfig.extraTimeLength || 10,
      penaltyShootout: rulesConfig.penaltyShootout !== false,
      maxSubstitutions: rulesConfig.maxSubstitutions || 3,
    };
  }

  // -------------------------------------------
  // processEvent
  // -------------------------------------------

  processEvent(match, event, rulesConfig) {
    const state = this._cloneState(match.currentState);
    const eventType = event.eventType || event.type;

    this._requireField({ eventType }, 'eventType', 'eventType');
    this._requireEnum(eventType, VALID_EVENT_TYPES, 'eventType');

    switch (eventType) {
      case FOOTBALL_EVENT_TYPES.GOAL:
        return this._processGoal(state, event, rulesConfig);
      case FOOTBALL_EVENT_TYPES.CARD:
        return this._processCard(state, event, rulesConfig);
      case FOOTBALL_EVENT_TYPES.SUBSTITUTION:
        return this._processSubstitution(state, event, rulesConfig);
      case FOOTBALL_EVENT_TYPES.HALF_START:
        return this._processHalfStart(state, event, rulesConfig);
      case FOOTBALL_EVENT_TYPES.HALF_END:
        return this._processHalfEnd(state, event, rulesConfig);
      default:
        throw new BadRequestError(`Unhandled football event type: ${eventType}`);
    }
  }

  // -------------------------------------------
  // validateEvent
  // -------------------------------------------

  validateEvent(match, event, rulesConfig) {
    const state = match.currentState;
    const eventType = event.eventType || event.type;
    const data = event.eventData || event;

    if (!state) {
      return { valid: false, reason: 'Match state is not initialized' };
    }

    if (state.isComplete) {
      return { valid: false, reason: 'Match is already complete' };
    }

    if (!VALID_EVENT_TYPES.includes(eventType)) {
      return { valid: false, reason: `Invalid event type: ${eventType}` };
    }

    // --- half_start ---
    if (eventType === FOOTBALL_EVENT_TYPES.HALF_START) {
      if (state.clockRunning) {
        return { valid: false, reason: 'Clock is already running. End the current half first.' };
      }
      // Cannot start a half beyond what's allowed
      const nextHalf = state.half + 1;
      if (nextHalf > HALF.SECOND && !state.extraTime) {
        if (nextHalf !== HALF.PENALTIES || !state.penaltyShootout) {
          return { valid: false, reason: 'No more halves to play' };
        }
      }
      if (nextHalf > HALF.EXTRA_SECOND && !state.penaltyShootout) {
        return { valid: false, reason: 'No penalty shootout configured' };
      }
      if (nextHalf > HALF.PENALTIES) {
        return { valid: false, reason: 'Match cannot progress beyond penalties' };
      }
    }

    // --- half_end ---
    if (eventType === FOOTBALL_EVENT_TYPES.HALF_END) {
      if (state.half === 0) {
        return { valid: false, reason: 'Match has not started yet' };
      }
    }

    // --- goal ---
    if (eventType === FOOTBALL_EVENT_TYPES.GOAL) {
      if (state.half === 0) {
        return { valid: false, reason: 'Cannot score a goal before match starts' };
      }

      const team = data.eventData ? data.eventData.team : data.team;
      if (!team || !TEAM_SIDES.includes(team)) {
        return { valid: false, reason: `team must be "a" or "b", got: "${team}"` };
      }

      const scorer = data.eventData ? data.eventData.scorer : data.scorer;
      if (!scorer) {
        return { valid: false, reason: 'scorer is required for a goal event' };
      }

      const minute = data.eventData ? data.eventData.minute : data.minute;
      if (minute === undefined || minute === null) {
        return { valid: false, reason: 'minute is required for a goal event' };
      }
      if (!Number.isInteger(minute) || minute < 0) {
        return { valid: false, reason: 'minute must be a non-negative integer' };
      }

      // Check if the scorer is not sent off
      const side = team;
      const scorerId = scorer.toString();
      if (this._isPlayerSentOff(state, side, scorerId)) {
        return { valid: false, reason: 'Player has been sent off and cannot score' };
      }
    }

    // --- card ---
    if (eventType === FOOTBALL_EVENT_TYPES.CARD) {
      if (state.half === 0) {
        return { valid: false, reason: 'Cannot issue a card before match starts' };
      }

      const cardData = data.eventData || data;
      const cardType = cardData.cardType;
      if (!cardType || !VALID_CARD_TYPES.includes(cardType)) {
        return { valid: false, reason: `Invalid card type: "${cardType}". Must be "yellow" or "red".` };
      }

      const team = cardData.team;
      if (!team || !TEAM_SIDES.includes(team)) {
        return { valid: false, reason: `team must be "a" or "b", got: "${team}"` };
      }

      const player = cardData.player;
      if (!player) {
        return { valid: false, reason: 'player is required for a card event' };
      }

      const minute = cardData.minute;
      if (minute === undefined || minute === null) {
        return { valid: false, reason: 'minute is required for a card event' };
      }

      // Check if player is already sent off
      const playerId = player.toString();
      if (this._isPlayerSentOff(state, team, playerId)) {
        return { valid: false, reason: 'Player has already been sent off' };
      }
    }

    // --- substitution ---
    if (eventType === FOOTBALL_EVENT_TYPES.SUBSTITUTION) {
      if (state.half === 0) {
        return { valid: false, reason: 'Cannot make a substitution before match starts' };
      }

      const subData = data.eventData || data;
      const team = subData.team;
      if (!team || !TEAM_SIDES.includes(team)) {
        return { valid: false, reason: `team must be "a" or "b", got: "${team}"` };
      }

      if (!subData.playerOut) {
        return { valid: false, reason: 'playerOut is required for a substitution' };
      }
      if (!subData.playerIn) {
        return { valid: false, reason: 'playerIn is required for a substitution' };
      }

      // Check max substitutions
      const subsUsed = state.substitutions[team].length;
      const maxSubs = state.maxSubstitutions;
      if (subsUsed >= maxSubs) {
        return {
          valid: false,
          reason: `Maximum substitutions (${maxSubs}) already used for team ${team.toUpperCase()}`,
        };
      }

      // Cannot sub out a player who has been sent off
      const playerOutId = subData.playerOut.toString();
      if (this._isPlayerSentOff(state, team, playerOutId)) {
        return { valid: false, reason: 'Cannot substitute a player who has been sent off' };
      }

      // Cannot sub in a player who was already subbed out
      const playerInId = subData.playerIn.toString();
      const alreadySubbedOut = state.substitutions[team].some(
        (s) => s.playerOut === playerInId
      );
      if (alreadySubbedOut) {
        return { valid: false, reason: 'Player was already substituted out and cannot re-enter' };
      }
    }

    return { valid: true };
  }

  // -------------------------------------------
  // getPlayerStats
  // -------------------------------------------

  getPlayerStats(events) {
    const stats = {};
    const activeEvents = events.filter((e) => !e.isUndone);

    for (const evt of activeEvents) {
      const eventType = evt.eventType;
      const data = evt.eventData;
      if (!data) continue;

      if (eventType === FOOTBALL_EVENT_TYPES.GOAL) {
        // Scorer
        if (data.scorer) {
          const scorerId = data.scorer.toString();
          if (!stats[scorerId]) stats[scorerId] = this._emptyPlayerStats(scorerId);
          stats[scorerId].goals += 1;
        }
        // Assister
        if (data.assister) {
          const assisterId = data.assister.toString();
          if (!stats[assisterId]) stats[assisterId] = this._emptyPlayerStats(assisterId);
          stats[assisterId].assists += 1;
        }
      }

      if (eventType === FOOTBALL_EVENT_TYPES.CARD) {
        if (data.player) {
          const playerId = data.player.toString();
          if (!stats[playerId]) stats[playerId] = this._emptyPlayerStats(playerId);

          if (data.cardType === FOOTBALL_CARD_TYPES.YELLOW) {
            stats[playerId].yellowCards += 1;
          } else if (data.cardType === FOOTBALL_CARD_TYPES.RED) {
            stats[playerId].redCards += 1;
          }
        }
      }

      if (eventType === FOOTBALL_EVENT_TYPES.SUBSTITUTION) {
        if (data.playerOut) {
          const outId = data.playerOut.toString();
          if (!stats[outId]) stats[outId] = this._emptyPlayerStats(outId);
          stats[outId].subTime = data.minute || null;
          stats[outId].subbedOff = true;
        }
        if (data.playerIn) {
          const inId = data.playerIn.toString();
          if (!stats[inId]) stats[inId] = this._emptyPlayerStats(inId);
          stats[inId].subTime = data.minute || null;
          stats[inId].subbedOn = true;
        }
      }
    }

    // Calculate minutes played for each player
    // This is a best-effort estimate based on event data
    for (const playerId of Object.keys(stats)) {
      const ps = stats[playerId];
      if (ps.subbedOn && ps.subbedOff) {
        // Came on and went off — approximate minutes
        // (Would need both sub times for accuracy; leave as recorded)
      }
    }

    return stats;
  }

  // -------------------------------------------
  // isMatchComplete
  // -------------------------------------------

  isMatchComplete(state, rulesConfig) {
    if (!state) return false;
    return !!state.isComplete;
  }

  // =============================================
  // Private: Goal
  // =============================================

  _processGoal(state, event, rulesConfig) {
    const data = event.eventData || event;
    const team = data.team;
    const scorer = data.scorer;
    const assister = data.assister || null;
    const minute = data.minute;

    this._assert(team, 'team is required');
    this._requireEnum(team, TEAM_SIDES, 'team');
    this._assert(scorer, 'scorer is required');
    this._assert(minute !== undefined && minute !== null, 'minute is required');

    // Check player not sent off
    const scorerId = scorer.toString();
    if (this._isPlayerSentOff(state, team, scorerId)) {
      throw new BadRequestError('Player has been sent off and cannot score');
    }

    // Increment score
    if (team === 'a') {
      state.scoreA += 1;
    } else {
      state.scoreB += 1;
    }

    // Record event in state
    state.events.push({
      type: FOOTBALL_EVENT_TYPES.GOAL,
      team,
      scorer: scorerId,
      assister: assister ? assister.toString() : null,
      minute,
      half: state.half,
    });

    return {
      state,
      meta: {
        isMatchComplete: false,
        scoreA: state.scoreA,
        scoreB: state.scoreB,
      },
    };
  }

  // =============================================
  // Private: Card
  // =============================================

  _processCard(state, event, rulesConfig) {
    const data = event.eventData || event;
    const cardType = data.cardType;
    const team = data.team;
    const player = data.player;
    const minute = data.minute;
    const reason = data.reason || null;

    this._assert(cardType, 'cardType is required');
    this._requireEnum(cardType, VALID_CARD_TYPES, 'cardType');
    this._assert(team, 'team is required');
    this._requireEnum(team, TEAM_SIDES, 'team');
    this._assert(player, 'player is required');
    this._assert(minute !== undefined && minute !== null, 'minute is required');

    const playerId = player.toString();

    // Check if already sent off
    if (this._isPlayerSentOff(state, team, playerId)) {
      throw new BadRequestError('Player has already been sent off');
    }

    let isSecondYellow = false;
    let effectiveRed = false;

    if (cardType === FOOTBALL_CARD_TYPES.YELLOW) {
      // Check for second yellow
      const existingYellows = state.cards[team].yellow.filter(
        (c) => c.playerId === playerId
      );

      state.cards[team].yellow.push({
        playerId,
        minute,
        reason,
        half: state.half,
      });

      if (existingYellows.length >= 1) {
        // Second yellow = red card
        isSecondYellow = true;
        effectiveRed = true;
        state.cards[team].red.push({
          playerId,
          minute,
          reason: 'second_yellow',
          half: state.half,
          isSecondYellow: true,
        });
      }
    } else {
      // Direct red
      state.cards[team].red.push({
        playerId,
        minute,
        reason,
        half: state.half,
        isSecondYellow: false,
      });
      effectiveRed = true;
    }

    // Record event
    state.events.push({
      type: FOOTBALL_EVENT_TYPES.CARD,
      cardType: effectiveRed && cardType === FOOTBALL_CARD_TYPES.YELLOW
        ? 'second_yellow'
        : cardType,
      team,
      playerId,
      minute,
      half: state.half,
      reason,
    });

    return {
      state,
      meta: {
        isMatchComplete: false,
        isSecondYellow,
        effectiveRed,
        playerId,
      },
    };
  }

  // =============================================
  // Private: Substitution
  // =============================================

  _processSubstitution(state, event, rulesConfig) {
    const data = event.eventData || event;
    const team = data.team;
    const playerOut = data.playerOut;
    const playerIn = data.playerIn;
    const minute = data.minute;

    this._assert(team, 'team is required');
    this._requireEnum(team, TEAM_SIDES, 'team');
    this._assert(playerOut, 'playerOut is required');
    this._assert(playerIn, 'playerIn is required');

    const playerOutId = playerOut.toString();
    const playerInId = playerIn.toString();

    // Check max subs
    const subsUsed = state.substitutions[team].length;
    if (subsUsed >= state.maxSubstitutions) {
      throw new BadRequestError(
        `Maximum substitutions (${state.maxSubstitutions}) already used for team ${team.toUpperCase()}`
      );
    }

    // Cannot sub a sent-off player
    if (this._isPlayerSentOff(state, team, playerOutId)) {
      throw new BadRequestError('Cannot substitute a player who has been sent off');
    }

    // Cannot sub in a player who was already subbed out
    const alreadySubbedOut = state.substitutions[team].some(
      (s) => s.playerOut === playerInId
    );
    if (alreadySubbedOut) {
      throw new BadRequestError(
        'Player was already substituted out and cannot re-enter'
      );
    }

    state.substitutions[team].push({
      playerOut: playerOutId,
      playerIn: playerInId,
      minute: minute || null,
      half: state.half,
    });

    state.events.push({
      type: FOOTBALL_EVENT_TYPES.SUBSTITUTION,
      team,
      playerOut: playerOutId,
      playerIn: playerInId,
      minute: minute || null,
      half: state.half,
    });

    return {
      state,
      meta: {
        isMatchComplete: false,
        subsRemaining: {
          a: state.maxSubstitutions - state.substitutions.a.length,
          b: state.maxSubstitutions - state.substitutions.b.length,
        },
      },
    };
  }

  // =============================================
  // Private: Half start
  // =============================================

  _processHalfStart(state, event, rulesConfig) {
    const nextHalf = state.half + 1;

    // Validate progression
    if (nextHalf > HALF.SECOND && !state.extraTime) {
      // Jump to penalties if configured and scores are level
      if (nextHalf === HALF.PENALTIES && state.penaltyShootout && state.scoreA === state.scoreB) {
        // Allow penalty shootout
      } else if (state.scoreA !== state.scoreB) {
        throw new BadRequestError('Match is decided — no extra time needed');
      } else {
        throw new BadRequestError('Extra time is not configured for this match');
      }
    }

    if (nextHalf > HALF.EXTRA_SECOND && nextHalf <= HALF.PENALTIES) {
      if (!state.penaltyShootout) {
        throw new BadRequestError('Penalty shootout is not configured');
      }
      if (state.scoreA !== state.scoreB) {
        throw new BadRequestError('Scores are not level — no shootout needed');
      }
    }

    if (nextHalf > HALF.PENALTIES) {
      throw new BadRequestError('Cannot progress beyond penalties');
    }

    state.half = nextHalf;
    state.clockRunning = true;
    state.clockStartedAt = new Date().toISOString();

    // Reset clock for new periods
    if (nextHalf === HALF.FIRST) {
      state.clockSeconds = 0;
    } else if (nextHalf === HALF.SECOND) {
      state.clockSeconds = state.halfLength * 60;
    } else if (nextHalf === HALF.EXTRA_FIRST) {
      state.clockSeconds = state.halfLength * 2 * 60;
    } else if (nextHalf === HALF.EXTRA_SECOND) {
      state.clockSeconds = (state.halfLength * 2 + state.extraTimeLength) * 60;
    } else if (nextHalf === HALF.PENALTIES) {
      state.clockSeconds = 0; // Clock not relevant for penalties
      state.clockRunning = false;
      state.penalties = {
        a: [],
        b: [],
        currentRound: 1,
        currentTeam: 'a',
      };
    }

    state.events.push({
      type: FOOTBALL_EVENT_TYPES.HALF_START,
      half: nextHalf,
      timestamp: state.clockStartedAt,
    });

    return {
      state,
      meta: {
        isMatchComplete: false,
        half: nextHalf,
      },
    };
  }

  // =============================================
  // Private: Half end
  // =============================================

  _processHalfEnd(state, event, rulesConfig) {
    if (state.half === 0) {
      throw new BadRequestError('Match has not started');
    }

    state.clockRunning = false;

    // Update clock to the expected end time of this half
    if (state.half === HALF.FIRST) {
      state.clockSeconds = state.halfLength * 60;
    } else if (state.half === HALF.SECOND) {
      state.clockSeconds = state.halfLength * 2 * 60;
    } else if (state.half === HALF.EXTRA_FIRST) {
      state.clockSeconds = (state.halfLength * 2 + state.extraTimeLength) * 60;
    } else if (state.half === HALF.EXTRA_SECOND) {
      state.clockSeconds = (state.halfLength * 2 + state.extraTimeLength * 2) * 60;
    }

    state.clockStartedAt = null;

    state.events.push({
      type: FOOTBALL_EVENT_TYPES.HALF_END,
      half: state.half,
      timestamp: new Date().toISOString(),
    });

    let isMatchComplete = false;

    // Determine if match is complete
    if (state.half === HALF.SECOND) {
      if (state.scoreA !== state.scoreB) {
        // Normal result
        isMatchComplete = true;
      } else if (!state.extraTime && !state.penaltyShootout) {
        // Draw allowed
        isMatchComplete = true;
      }
      // Otherwise, extra time or penalties will follow
    } else if (state.half === HALF.EXTRA_SECOND) {
      if (state.scoreA !== state.scoreB) {
        isMatchComplete = true;
      } else if (!state.penaltyShootout) {
        // Draw after extra time (no penalties)
        isMatchComplete = true;
      }
      // Otherwise, penalties follow
    } else if (state.half === HALF.PENALTIES) {
      // Penalties ended
      isMatchComplete = true;
    }

    if (isMatchComplete) {
      state.isComplete = true;
      state.matchResult = this._buildMatchResult(state);
    }

    return {
      state,
      meta: {
        isMatchComplete,
        half: state.half,
        scoreA: state.scoreA,
        scoreB: state.scoreB,
      },
    };
  }

  // =============================================
  // Private: Helpers
  // =============================================

  /**
   * Check if a player has been sent off (direct red or second yellow).
   */
  _isPlayerSentOff(state, team, playerId) {
    return state.cards[team].red.some((c) => c.playerId === playerId);
  }

  /**
   * Build a match result summary.
   */
  _buildMatchResult(state) {
    let winnerId = null;
    let loserId = null;
    let resultType = 'normal';

    if (state.scoreA > state.scoreB) {
      winnerId = state.teamAId;
      loserId = state.teamBId;
    } else if (state.scoreB > state.scoreA) {
      winnerId = state.teamBId;
      loserId = state.teamAId;
    } else {
      resultType = 'draw';
    }

    let margin = null;
    if (winnerId) {
      const diff = Math.abs(state.scoreA - state.scoreB);
      margin = `${diff} goal${diff !== 1 ? 's' : ''}`;
    }

    // If decided in extra time
    if (state.half === HALF.EXTRA_SECOND && winnerId) {
      margin += ' (AET)';
    }

    // If decided on penalties
    if (state.half === HALF.PENALTIES && state.penalties) {
      const penA = state.penalties.a.filter((p) => p.scored).length;
      const penB = state.penalties.b.filter((p) => p.scored).length;

      if (penA !== penB) {
        winnerId = penA > penB ? state.teamAId : state.teamBId;
        loserId = penA > penB ? state.teamBId : state.teamAId;
        margin = `${Math.max(penA, penB)}-${Math.min(penA, penB)} on penalties`;
        resultType = 'normal';
      }
    }

    return {
      winnerId,
      loserId,
      margin,
      resultType,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
    };
  }

  /**
   * Create an empty player stats object.
   */
  _emptyPlayerStats(playerId) {
    return {
      playerId,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      minutes: 0,
      subTime: null,
      subbedOn: false,
      subbedOff: false,
    };
  }
}

module.exports = FootballScoringEngine;

// ============================================
// MatchPulse — Basketball 5v5 Scoring Engine
// ============================================
// Handles standard 5-on-5 basketball scoring
// with quarters, fouls, timeouts, and full
// player stat tracking.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');

const VALID_EVENT_TYPES = [
  'shot_made',
  'shot_missed',
  'foul',
  'timeout',
  'quarter_start',
  'quarter_end',
  'rebound',
  'assist',
  'steal',
  'block',
  'turnover',
];

const VALID_SHOT_TYPES = ['2pt', '3pt', 'ft'];

class Basketball5v5Engine extends BaseScoringEngine {
  constructor() {
    super('basketball_5v5');
  }

  // -------------------------------------------
  // Public API
  // -------------------------------------------

  /**
   * Create the initial match state.
   *
   * @param {Object} match       — the Match document
   * @param {Object} rulesConfig — { quarterLength, overtimeLength, shotClock, foulBonusThreshold, numberOfQuarters }
   * @returns {Object} initial state
   */
  initializeState(match, rulesConfig = {}) {
    const quarterLength = rulesConfig.quarterLength || 10;

    return {
      scoreA: 0,
      scoreB: 0,
      quarter: 1,
      clockSeconds: quarterLength * 60,
      clockRunning: false,
      clockStartedAt: null,
      teamFoulsA: 0,
      teamFoulsB: 0,
      timeoutsA: 0,
      timeoutsB: 0,
      playerStatsA: {},
      playerStatsB: {},
      leadChanges: 0,
      largestLead: 0,
      isOvertime: false,
      quarterComplete: false,
    };
  }

  /**
   * Validate whether an event is legal in the current state.
   *
   * @param {Object} match       — the Match document (with currentState)
   * @param {Object} event       — the proposed event
   * @param {Object} rulesConfig
   * @returns {{ valid: boolean, reason?: string }}
   */
  validateEvent(match, event, rulesConfig = {}) {
    const state = match.currentState;

    if (!event || !event.eventType) {
      return { valid: false, reason: 'Event type is required' };
    }

    if (!VALID_EVENT_TYPES.includes(event.eventType)) {
      return {
        valid: false,
        reason: `Invalid event type: "${event.eventType}". Allowed: ${VALID_EVENT_TYPES.join(', ')}`,
      };
    }

    // Quarter must be started before scoring events
    const scoringEvents = ['shot_made', 'shot_missed', 'foul', 'rebound', 'assist', 'steal', 'block', 'turnover'];
    if (scoringEvents.includes(event.eventType) && state.quarterComplete) {
      return { valid: false, reason: 'Quarter has ended. Start the next quarter before recording events.' };
    }

    switch (event.eventType) {
      case 'shot_made':
      case 'shot_missed': {
        if (!event.shotType) {
          return { valid: false, reason: 'shotType is required for shot events' };
        }
        if (!VALID_SHOT_TYPES.includes(event.shotType)) {
          return {
            valid: false,
            reason: `Invalid shotType: "${event.shotType}". Allowed: ${VALID_SHOT_TYPES.join(', ')}`,
          };
        }
        if (!event.team || !['a', 'b'].includes(event.team)) {
          return { valid: false, reason: 'team must be "a" or "b"' };
        }
        break;
      }

      case 'foul': {
        if (!event.team || !['a', 'b'].includes(event.team)) {
          return { valid: false, reason: 'team must be "a" or "b"' };
        }
        break;
      }

      case 'timeout': {
        if (!event.team || !['a', 'b'].includes(event.team)) {
          return { valid: false, reason: 'team must be "a" or "b"' };
        }
        break;
      }

      case 'quarter_start': {
        if (!state.quarterComplete && state.quarter > 1) {
          // Allow starting quarter 1 from initial state
        }
        break;
      }

      case 'quarter_end': {
        if (state.quarterComplete) {
          return { valid: false, reason: 'Quarter is already ended' };
        }
        break;
      }
    }

    return { valid: true };
  }

  /**
   * Process a scoring event and return the new match state.
   *
   * @param {Object} match       — the Match document (with currentState)
   * @param {Object} event       — the incoming event data
   * @param {Object} rulesConfig
   * @returns {{ state: Object, meta: Object }}
   */
  processEvent(match, event, rulesConfig = {}) {
    const validation = this.validateEvent(match, event, rulesConfig);
    if (!validation.valid) {
      throw new BadRequestError(validation.reason);
    }

    const state = this._cloneState(match.currentState);
    const meta = {
      isMatchComplete: false,
      isQuarterComplete: false,
      scoreChanged: false,
      foulBonus: false,
    };

    // Sync clock from scorer if provided
    if (event.clockSeconds !== undefined) {
      state.clockSeconds = event.clockSeconds;
    }

    switch (event.eventType) {
      case 'shot_made':
        this._processShotMade(state, event, meta, rulesConfig);
        break;

      case 'shot_missed':
        this._processShotMissed(state, event, meta);
        break;

      case 'foul':
        this._processFoul(state, event, meta, rulesConfig);
        break;

      case 'timeout':
        this._processTimeout(state, event, meta);
        break;

      case 'quarter_start':
        this._processQuarterStart(state, event, meta, rulesConfig);
        break;

      case 'quarter_end':
        this._processQuarterEnd(state, event, meta, rulesConfig);
        break;

      case 'rebound':
        this._processStatEvent(state, event, 'rebounds');
        break;

      case 'assist':
        this._processStatEvent(state, event, 'assists');
        break;

      case 'steal':
        this._processStatEvent(state, event, 'steals');
        break;

      case 'block':
        this._processStatEvent(state, event, 'blocks');
        break;

      case 'turnover':
        this._processStatEvent(state, event, 'turnovers');
        break;
    }

    // Update match complete status
    meta.isMatchComplete = this.isMatchComplete(state, rulesConfig);

    return { state, meta };
  }

  /**
   * Roll back state after an event is marked as undone.
   * Delegates to base class by default.
   */
  undoEvent(match, event, events, rulesConfig) {
    return super.undoEvent(match, event, events, rulesConfig);
  }

  /**
   * Aggregate per-player statistics from scoring events.
   *
   * @param {Array} events — all non-undone events for the match
   * @returns {Object} keyed by playerId
   */
  getPlayerStats(events) {
    const stats = {};

    const ensurePlayer = (playerId) => {
      if (!playerId) return null;
      const key = playerId.toString();
      if (!stats[key]) {
        stats[key] = {
          minutes: 0,
          points: 0,
          twoPointMade: 0,
          twoPointAttempted: 0,
          threePointMade: 0,
          threePointAttempted: 0,
          ftMade: 0,
          ftAttempted: 0,
          rebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
          fouls: 0,
          plusMinus: 0,
        };
      }
      return key;
    };

    for (const evt of events) {
      const data = evt.eventData || evt;
      const key = ensurePlayer(data.player);
      if (!key) continue;

      switch (data.eventType) {
        case 'shot_made': {
          if (data.shotType === '2pt') {
            stats[key].twoPointMade += 1;
            stats[key].twoPointAttempted += 1;
            stats[key].points += 2;
          } else if (data.shotType === '3pt') {
            stats[key].threePointMade += 1;
            stats[key].threePointAttempted += 1;
            stats[key].points += 3;
          } else if (data.shotType === 'ft') {
            stats[key].ftMade += 1;
            stats[key].ftAttempted += 1;
            stats[key].points += 1;
          }
          break;
        }

        case 'shot_missed': {
          if (data.shotType === '2pt') {
            stats[key].twoPointAttempted += 1;
          } else if (data.shotType === '3pt') {
            stats[key].threePointAttempted += 1;
          } else if (data.shotType === 'ft') {
            stats[key].ftAttempted += 1;
          }
          break;
        }

        case 'foul':
          stats[key].fouls += 1;
          break;

        case 'rebound':
          stats[key].rebounds += 1;
          break;

        case 'assist':
          stats[key].assists += 1;
          break;

        case 'steal':
          stats[key].steals += 1;
          break;

        case 'block':
          stats[key].blocks += 1;
          break;

        case 'turnover':
          stats[key].turnovers += 1;
          break;
      }
    }

    return stats;
  }

  /**
   * Determine whether the match is complete.
   * Match ends when the 4th quarter (or OT) ends and scores are not tied.
   *
   * @param {Object} state       — the currentState
   * @param {Object} rulesConfig
   * @returns {boolean}
   */
  isMatchComplete(state, rulesConfig = {}) {
    const numberOfQuarters = rulesConfig.numberOfQuarters || 4;

    // Match is not complete if the current quarter hasn't ended
    if (!state.quarterComplete) {
      return false;
    }

    // Regular time: after all quarters, scores must not be tied
    if (state.quarter >= numberOfQuarters && state.scoreA !== state.scoreB) {
      return true;
    }

    // Overtime: after OT ends, scores must not be tied
    if (state.isOvertime && state.quarterComplete && state.scoreA !== state.scoreB) {
      return true;
    }

    return false;
  }

  // -------------------------------------------
  // Private helpers
  // -------------------------------------------

  /**
   * Get or initialize player stats map for a team.
   */
  _getPlayerStatsMap(state, team) {
    return team === 'a' ? state.playerStatsA : state.playerStatsB;
  }

  /**
   * Ensure a player entry exists in the team stats map.
   */
  _ensurePlayerStats(statsMap, playerId) {
    if (!playerId) return null;
    const key = playerId.toString();
    if (!statsMap[key]) {
      statsMap[key] = {
        minutes: 0,
        points: 0,
        twoPointMade: 0,
        twoPointAttempted: 0,
        threePointMade: 0,
        threePointAttempted: 0,
        ftMade: 0,
        ftAttempted: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        plusMinus: 0,
      };
    }
    return key;
  }

  /**
   * Process a made shot.
   */
  _processShotMade(state, event, meta, rulesConfig) {
    const { shotType, team, player } = event;
    const statsMap = this._getPlayerStatsMap(state, team);
    const playerKey = this._ensurePlayerStats(statsMap, player);

    let points = 0;
    switch (shotType) {
      case '2pt':
        points = 2;
        if (playerKey) {
          statsMap[playerKey].twoPointMade += 1;
          statsMap[playerKey].twoPointAttempted += 1;
        }
        break;
      case '3pt':
        points = 3;
        if (playerKey) {
          statsMap[playerKey].threePointMade += 1;
          statsMap[playerKey].threePointAttempted += 1;
        }
        break;
      case 'ft':
        points = 1;
        if (playerKey) {
          statsMap[playerKey].ftMade += 1;
          statsMap[playerKey].ftAttempted += 1;
        }
        break;
    }

    // Track lead before scoring
    const prevLeader = state.scoreA > state.scoreB ? 'a' : state.scoreB > state.scoreA ? 'b' : null;

    // Apply score
    if (team === 'a') {
      state.scoreA += points;
    } else {
      state.scoreB += points;
    }

    // Update player points
    if (playerKey) {
      statsMap[playerKey].points += points;
    }

    meta.scoreChanged = true;

    // Track lead changes
    const newLeader = state.scoreA > state.scoreB ? 'a' : state.scoreB > state.scoreA ? 'b' : null;
    if (prevLeader && newLeader && prevLeader !== newLeader) {
      state.leadChanges += 1;
    }

    // Track largest lead
    const currentLead = Math.abs(state.scoreA - state.scoreB);
    if (currentLead > state.largestLead) {
      state.largestLead = currentLead;
    }
  }

  /**
   * Process a missed shot.
   */
  _processShotMissed(state, event, meta) {
    const { shotType, team, player } = event;
    const statsMap = this._getPlayerStatsMap(state, team);
    const playerKey = this._ensurePlayerStats(statsMap, player);

    if (playerKey) {
      switch (shotType) {
        case '2pt':
          statsMap[playerKey].twoPointAttempted += 1;
          break;
        case '3pt':
          statsMap[playerKey].threePointAttempted += 1;
          break;
        case 'ft':
          statsMap[playerKey].ftAttempted += 1;
          break;
      }
    }
  }

  /**
   * Process a foul.
   */
  _processFoul(state, event, meta, rulesConfig) {
    const { team, player } = event;
    const foulBonusThreshold = rulesConfig.foulBonusThreshold || 5;

    // Increment team fouls
    if (team === 'a') {
      state.teamFoulsA += 1;
      if (state.teamFoulsA >= foulBonusThreshold) {
        meta.foulBonus = true;
      }
    } else {
      state.teamFoulsB += 1;
      if (state.teamFoulsB >= foulBonusThreshold) {
        meta.foulBonus = true;
      }
    }

    // Track player foul
    const statsMap = this._getPlayerStatsMap(state, team);
    const playerKey = this._ensurePlayerStats(statsMap, player);
    if (playerKey) {
      statsMap[playerKey].fouls += 1;
    }
  }

  /**
   * Process a timeout.
   */
  _processTimeout(state, event, meta) {
    const { team } = event;
    if (team === 'a') {
      state.timeoutsA += 1;
    } else {
      state.timeoutsB += 1;
    }

    // Stop the clock
    state.clockRunning = false;
    state.clockStartedAt = null;
  }

  /**
   * Process quarter start.
   */
  _processQuarterStart(state, event, meta, rulesConfig) {
    const quarterLength = rulesConfig.quarterLength || 10;
    const overtimeLength = rulesConfig.overtimeLength || 5;

    state.quarterComplete = false;
    state.clockRunning = true;
    state.clockStartedAt = Date.now();

    // Set clock based on whether this is overtime or regular
    if (state.isOvertime) {
      state.clockSeconds = overtimeLength * 60;
    } else {
      state.clockSeconds = quarterLength * 60;
    }

    // Reset team fouls for the new quarter
    state.teamFoulsA = 0;
    state.teamFoulsB = 0;
  }

  /**
   * Process quarter end.
   */
  _processQuarterEnd(state, event, meta, rulesConfig) {
    const numberOfQuarters = rulesConfig.numberOfQuarters || 4;

    state.quarterComplete = true;
    state.clockRunning = false;
    state.clockStartedAt = null;
    state.clockSeconds = 0;

    meta.isQuarterComplete = true;

    // Check if we need overtime
    if (state.quarter >= numberOfQuarters && state.scoreA === state.scoreB) {
      // Tied at end of regulation — next quarter is overtime
      state.quarter += 1;
      state.isOvertime = true;
    } else if (state.isOvertime && state.scoreA === state.scoreB) {
      // Still tied after OT — another OT
      state.quarter += 1;
    } else if (state.quarter < numberOfQuarters) {
      // Move to next regular quarter
      state.quarter += 1;
    }
  }

  /**
   * Process a generic stat event (rebound, assist, steal, block, turnover).
   */
  _processStatEvent(state, event, statKey) {
    const { team, player } = event;
    if (!team || !['a', 'b'].includes(team)) {
      throw new BadRequestError('team must be "a" or "b"');
    }

    const statsMap = this._getPlayerStatsMap(state, team);
    const playerKey = this._ensurePlayerStats(statsMap, player);
    if (playerKey) {
      statsMap[playerKey][statKey] += 1;
    }
  }
}

module.exports = Basketball5v5Engine;

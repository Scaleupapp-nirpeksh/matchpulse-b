// ============================================
// MatchPulse — Basketball 3x3 Scoring Engine
// ============================================
// Handles FIBA 3x3 basketball scoring rules:
// 1-point shots (inside arc), 2-point shots
// (outside arc), target score win, timed game,
// and team foul bonus tracking.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');

const VALID_EVENT_TYPES = [
  'shot_made',
  'shot_missed',
  'foul',
  'timeout',
];

const VALID_SHOT_TYPES = ['1pt', '2pt'];

class Basketball3x3Engine extends BaseScoringEngine {
  constructor() {
    super('basketball_3x3');
  }

  // -------------------------------------------
  // Public API
  // -------------------------------------------

  /**
   * Create the initial match state.
   *
   * @param {Object} match       — the Match document
   * @param {Object} rulesConfig — { targetScore, gameTime, shotClock, foulBonus }
   * @returns {Object} initial state
   */
  initializeState(match, rulesConfig = {}) {
    const gameTime = rulesConfig.gameTime || 10;
    const shotClock = rulesConfig.shotClock || 12;

    return {
      scoreA: 0,
      scoreB: 0,
      clockSeconds: gameTime * 60,
      clockRunning: false,
      clockStartedAt: null,
      teamFoulsA: 0,
      teamFoulsB: 0,
      shotClock: shotClock,
      playerStatsA: {},
      playerStatsB: {},
      gameComplete: false,
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

    if (state.gameComplete) {
      return { valid: false, reason: 'Game is already complete' };
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
    const targetScore = rulesConfig.targetScore || 21;
    const foulBonusThreshold = rulesConfig.foulBonus || 7;

    const meta = {
      isMatchComplete: false,
      scoreChanged: false,
      foulBonus: false,
      targetScoreReached: false,
    };

    // Sync clock from scorer if provided
    if (event.clockSeconds !== undefined) {
      state.clockSeconds = event.clockSeconds;
    }

    switch (event.eventType) {
      case 'shot_made':
        this._processShotMade(state, event, meta, targetScore);
        break;

      case 'shot_missed':
        this._processShotMissed(state, event);
        break;

      case 'foul':
        this._processFoul(state, event, meta, foulBonusThreshold);
        break;

      case 'timeout':
        this._processTimeout(state, event);
        break;
    }

    // Check time expiry — scorer sends clockSeconds = 0 when time runs out
    if (state.clockSeconds <= 0 && !state.gameComplete) {
      state.gameComplete = true;
      state.clockRunning = false;
      state.clockStartedAt = null;
    }

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
          points: 0,
          onePointMade: 0,
          onePointAttempted: 0,
          twoPointMade: 0,
          twoPointAttempted: 0,
          fouls: 0,
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
          if (data.shotType === '1pt') {
            stats[key].onePointMade += 1;
            stats[key].onePointAttempted += 1;
            stats[key].points += 1;
          } else if (data.shotType === '2pt') {
            stats[key].twoPointMade += 1;
            stats[key].twoPointAttempted += 1;
            stats[key].points += 2;
          }
          break;
        }

        case 'shot_missed': {
          if (data.shotType === '1pt') {
            stats[key].onePointAttempted += 1;
          } else if (data.shotType === '2pt') {
            stats[key].twoPointAttempted += 1;
          }
          break;
        }

        case 'foul':
          stats[key].fouls += 1;
          break;
      }
    }

    return stats;
  }

  /**
   * Determine whether the match is complete.
   * Game ends when target score is reached or time expires.
   *
   * @param {Object} state       — the currentState
   * @param {Object} rulesConfig
   * @returns {boolean}
   */
  isMatchComplete(state, rulesConfig = {}) {
    const targetScore = rulesConfig.targetScore || 21;

    // Target score reached
    if (state.scoreA >= targetScore || state.scoreB >= targetScore) {
      return true;
    }

    // Time expired
    if (state.gameComplete) {
      return true;
    }

    // Clock at zero (scorer may set it directly)
    if (state.clockSeconds <= 0) {
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
        points: 0,
        onePointMade: 0,
        onePointAttempted: 0,
        twoPointMade: 0,
        twoPointAttempted: 0,
        fouls: 0,
      };
    }
    return key;
  }

  /**
   * Process a made shot.
   */
  _processShotMade(state, event, meta, targetScore) {
    const { shotType, team, player } = event;
    const statsMap = this._getPlayerStatsMap(state, team);
    const playerKey = this._ensurePlayerStats(statsMap, player);

    let points = 0;
    switch (shotType) {
      case '1pt':
        points = 1;
        if (playerKey) {
          statsMap[playerKey].onePointMade += 1;
          statsMap[playerKey].onePointAttempted += 1;
        }
        break;
      case '2pt':
        points = 2;
        if (playerKey) {
          statsMap[playerKey].twoPointMade += 1;
          statsMap[playerKey].twoPointAttempted += 1;
        }
        break;
    }

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

    // Check target score
    if (state.scoreA >= targetScore || state.scoreB >= targetScore) {
      state.gameComplete = true;
      state.clockRunning = false;
      state.clockStartedAt = null;
      meta.targetScoreReached = true;
    }
  }

  /**
   * Process a missed shot.
   */
  _processShotMissed(state, event) {
    const { shotType, team, player } = event;
    const statsMap = this._getPlayerStatsMap(state, team);
    const playerKey = this._ensurePlayerStats(statsMap, player);

    if (playerKey) {
      switch (shotType) {
        case '1pt':
          statsMap[playerKey].onePointAttempted += 1;
          break;
        case '2pt':
          statsMap[playerKey].twoPointAttempted += 1;
          break;
      }
    }
  }

  /**
   * Process a foul.
   */
  _processFoul(state, event, meta, foulBonusThreshold) {
    const { team, player } = event;

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
  _processTimeout(state, event) {
    state.clockRunning = false;
    state.clockStartedAt = null;
  }
}

module.exports = Basketball3x3Engine;

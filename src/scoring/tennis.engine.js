// ============================================
// MatchPulse — Tennis Scoring Engine
// ============================================
// Handles tennis scoring with standard point
// progression (0-15-30-40-game), deuce/advantage,
// no-ad option, tiebreaks, and full player
// stat tracking.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');

const VALID_EVENT_TYPES = [
  'point',
  'ace',
  'double_fault',
  'winner',
  'unforced_error',
  'first_serve_in',
  'first_serve_out',
  'break_point_converted',
  'break_point_saved',
];

// Standard tennis point progression
const POINT_VALUES = [0, 15, 30, 40];

class TennisEngine extends BaseScoringEngine {
  constructor() {
    super('tennis');
  }

  // -------------------------------------------
  // Public API
  // -------------------------------------------

  /**
   * Create the initial match state.
   *
   * @param {Object} match       — the Match document
   * @param {Object} rulesConfig — { bestOf, tiebreakEnabled, noAdScoring, finalSetTiebreak }
   * @returns {Object} initial state
   */
  initializeState(match, rulesConfig = {}) {
    return {
      sets: [],
      currentGame: { a: 0, b: 0 },
      serving: 'a',
      setsWonA: 0,
      setsWonB: 0,
      gamesA: 0,
      gamesB: 0,
      tiebreak: false,
      tiebreakScore: { a: 0, b: 0 },
      playerStatsA: {
        aces: 0,
        doubleFaults: 0,
        firstServeIn: 0,
        firstServeTotal: 0,
        firstServePercent: 0,
        breakPointsConverted: 0,
        breakPointsFaced: 0,
        breakPointsSaved: 0,
        breakPointsTotal: 0,
        winners: 0,
        unforcedErrors: 0,
      },
      playerStatsB: {
        aces: 0,
        doubleFaults: 0,
        firstServeIn: 0,
        firstServeTotal: 0,
        firstServePercent: 0,
        breakPointsConverted: 0,
        breakPointsFaced: 0,
        breakPointsSaved: 0,
        breakPointsTotal: 0,
        winners: 0,
        unforcedErrors: 0,
      },
      matchComplete: false,
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

    if (state.matchComplete) {
      return { valid: false, reason: 'Match is already complete' };
    }

    // Point events require a winner
    if (event.eventType === 'point') {
      if (!event.winner || !['a', 'b'].includes(event.winner)) {
        return { valid: false, reason: 'winner must be "a" or "b"' };
      }
    }

    // Stat events that award a point also need a team/player context
    if (['ace', 'double_fault', 'winner', 'unforced_error'].includes(event.eventType)) {
      if (!event.player || !['a', 'b'].includes(event.player)) {
        return { valid: false, reason: 'player must be "a" or "b"' };
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
      isGameComplete: false,
      isSetComplete: false,
      scoreChanged: false,
      tiebreakStarted: false,
    };

    switch (event.eventType) {
      case 'point':
        this._processPoint(state, event, meta, rulesConfig);
        break;

      case 'ace':
        this._processAce(state, event, meta, rulesConfig);
        break;

      case 'double_fault':
        this._processDoubleFault(state, event, meta, rulesConfig);
        break;

      case 'winner':
        this._processWinner(state, event, meta, rulesConfig);
        break;

      case 'unforced_error':
        this._processUnforcedError(state, event, meta, rulesConfig);
        break;

      case 'first_serve_in':
        this._processFirstServe(state, event, true);
        break;

      case 'first_serve_out':
        this._processFirstServe(state, event, false);
        break;

      case 'break_point_converted':
        this._processBreakPoint(state, event, true);
        break;

      case 'break_point_saved':
        this._processBreakPoint(state, event, false);
        break;
    }

    meta.isMatchComplete = this.isMatchComplete(state, rulesConfig);
    if (meta.isMatchComplete) {
      state.matchComplete = true;
    }

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
   * @returns {Object} keyed by playerId (or 'a'/'b' if no playerId)
   */
  getPlayerStats(events) {
    const stats = {};

    const ensurePlayer = (playerId) => {
      if (!playerId) return null;
      const key = playerId.toString();
      if (!stats[key]) {
        stats[key] = {
          aces: 0,
          doubleFaults: 0,
          firstServePercent: 0,
          breakPointsConverted: 0,
          breakPointsSaved: 0,
          winners: 0,
          unforcedErrors: 0,
          _firstServeIn: 0,
          _firstServeTotal: 0,
        };
      }
      return key;
    };

    for (const evt of events) {
      const data = evt.eventData || evt;
      const key = ensurePlayer(data.player);
      if (!key) continue;

      switch (data.eventType) {
        case 'ace':
          stats[key].aces += 1;
          break;
        case 'double_fault':
          stats[key].doubleFaults += 1;
          break;
        case 'winner':
          stats[key].winners += 1;
          break;
        case 'unforced_error':
          stats[key].unforcedErrors += 1;
          break;
        case 'first_serve_in':
          stats[key]._firstServeIn += 1;
          stats[key]._firstServeTotal += 1;
          break;
        case 'first_serve_out':
          stats[key]._firstServeTotal += 1;
          break;
        case 'break_point_converted':
          stats[key].breakPointsConverted += 1;
          break;
        case 'break_point_saved':
          stats[key].breakPointsSaved += 1;
          break;
      }
    }

    // Calculate first serve percentage
    for (const key of Object.keys(stats)) {
      const s = stats[key];
      if (s._firstServeTotal > 0) {
        s.firstServePercent = Math.round((s._firstServeIn / s._firstServeTotal) * 100);
      }
      // Clean up internal counters
      delete s._firstServeIn;
      delete s._firstServeTotal;
    }

    return stats;
  }

  /**
   * Determine whether the match is complete.
   * Match is complete when one player wins the required number of sets.
   *
   * @param {Object} state       — the currentState
   * @param {Object} rulesConfig
   * @returns {boolean}
   */
  isMatchComplete(state, rulesConfig = {}) {
    const bestOf = rulesConfig.bestOf || 3;
    const setsToWin = Math.ceil(bestOf / 2);

    if (state.setsWonA >= setsToWin || state.setsWonB >= setsToWin) {
      return true;
    }

    return false;
  }

  // -------------------------------------------
  // Private helpers
  // -------------------------------------------

  /**
   * Get the display score for a point value.
   * In standard tennis: 0, 15, 30, 40.
   */
  _getDisplayScore(pointIndex) {
    if (pointIndex >= 0 && pointIndex < POINT_VALUES.length) {
      return POINT_VALUES[pointIndex];
    }
    return pointIndex; // Beyond 40, raw index is used for deuce tracking
  }

  /**
   * Process a point won by a player.
   */
  _processPoint(state, event, meta, rulesConfig) {
    const { winner } = event;
    const noAd = rulesConfig.noAdScoring || false;

    meta.scoreChanged = true;

    if (state.tiebreak) {
      this._processTiebreakPoint(state, winner, meta, rulesConfig);
      return;
    }

    // Standard game scoring
    const loser = winner === 'a' ? 'b' : 'a';

    const winnerScore = state.currentGame[winner];
    const loserScore = state.currentGame[loser];

    // Both at 40 (index 3) = deuce situation
    if (winnerScore >= 3 && loserScore >= 3) {
      if (noAd) {
        // No-ad scoring: next point wins
        this._winGame(state, winner, meta, rulesConfig);
      } else if (winnerScore > loserScore) {
        // Winner has advantage and wins the point -> game
        this._winGame(state, winner, meta, rulesConfig);
      } else if (winnerScore === loserScore) {
        // Deuce -> advantage to winner
        state.currentGame[winner] += 1;
      } else {
        // Loser had advantage -> back to deuce
        state.currentGame[loser] -= 1;
      }
    } else if (winnerScore >= 3) {
      // Winner at 40, loser below 40 -> game
      this._winGame(state, winner, meta, rulesConfig);
    } else {
      // Normal point progression
      state.currentGame[winner] += 1;
    }
  }

  /**
   * Process a tiebreak point.
   */
  _processTiebreakPoint(state, winner, meta, rulesConfig) {
    state.tiebreakScore[winner] += 1;

    const scoreA = state.tiebreakScore.a;
    const scoreB = state.tiebreakScore.b;
    const totalPoints = scoreA + scoreB;

    // First to 7 with 2-point lead
    const maxScore = Math.max(scoreA, scoreB);
    const lead = Math.abs(scoreA - scoreB);

    if (maxScore >= 7 && lead >= 2) {
      // Tiebreak won
      const tiebreakWinner = scoreA > scoreB ? 'a' : 'b';
      this._winGame(state, tiebreakWinner, meta, rulesConfig);
      return;
    }

    // Serve alternates every 2 points (after the first point)
    // First point: server serves. Then alternate every 2 points.
    if (totalPoints === 1 || (totalPoints > 1 && (totalPoints - 1) % 2 === 0)) {
      state.serving = state.serving === 'a' ? 'b' : 'a';
    }
  }

  /**
   * Handle winning a game and check for set completion.
   */
  _winGame(state, winner, meta, rulesConfig) {
    meta.isGameComplete = true;

    // Increment games for the winner in the current set
    if (winner === 'a') {
      state.gamesA += 1;
    } else {
      state.gamesB += 1;
    }

    // Reset game score
    state.currentGame = { a: 0, b: 0 };

    // If we were in a tiebreak, reset tiebreak state
    if (state.tiebreak) {
      state.tiebreak = false;
      state.tiebreakScore = { a: 0, b: 0 };
    }

    // Switch server for next game
    state.serving = state.serving === 'a' ? 'b' : 'a';

    // Check if set is complete
    this._checkSetComplete(state, meta, rulesConfig);
  }

  /**
   * Check if the current set is complete.
   */
  _checkSetComplete(state, meta, rulesConfig) {
    const tiebreakEnabled = rulesConfig.tiebreakEnabled !== false; // default true
    const finalSetTiebreak = rulesConfig.finalSetTiebreak !== false; // default true
    const bestOf = rulesConfig.bestOf || 3;
    const setsToWin = Math.ceil(bestOf / 2);

    const gA = state.gamesA;
    const gB = state.gamesB;
    const maxGames = Math.max(gA, gB);
    const lead = Math.abs(gA - gB);

    // Standard set win: 6 games with 2-game lead
    if (maxGames >= 6 && lead >= 2) {
      this._winSet(state, gA > gB ? 'a' : 'b', meta, rulesConfig);
      return;
    }

    // Tiebreak at 6-6
    if (gA === 6 && gB === 6) {
      // Check if this is the final set and whether final set tiebreak is enabled
      const isFinalSet = state.setsWonA === setsToWin - 1 && state.setsWonB === setsToWin - 1;

      if (isFinalSet && !finalSetTiebreak) {
        // No tiebreak in the final set — must win by 2 games
        // Game already awarded above, so just continue playing
        return;
      }

      if (tiebreakEnabled) {
        state.tiebreak = true;
        state.tiebreakScore = { a: 0, b: 0 };
        meta.tiebreakStarted = true;
      }
    }

    // No tiebreak and games beyond 6-6: win by 2-game lead
    // (handled by the lead >= 2 check above on subsequent calls)
  }

  /**
   * Handle winning a set and prepare for the next.
   */
  _winSet(state, winner, meta, rulesConfig) {
    meta.isSetComplete = true;

    // Record the completed set
    state.sets.push([state.gamesA, state.gamesB]);

    // Award set win
    if (winner === 'a') {
      state.setsWonA += 1;
    } else {
      state.setsWonB += 1;
    }

    // Reset games for the next set
    state.gamesA = 0;
    state.gamesB = 0;
    state.currentGame = { a: 0, b: 0 };
    state.tiebreak = false;
    state.tiebreakScore = { a: 0, b: 0 };
  }

  /**
   * Process an ace — awards a point to the server and records the stat.
   */
  _processAce(state, event, meta, rulesConfig) {
    const { player } = event;

    // Record the stat
    const statsKey = player === 'a' ? 'playerStatsA' : 'playerStatsB';
    state[statsKey].aces += 1;

    // Ace = point won by the server (the ace hitter)
    this._processPoint(state, { ...event, eventType: 'point', winner: player }, meta, rulesConfig);
  }

  /**
   * Process a double fault — awards a point to the opponent and records the stat.
   */
  _processDoubleFault(state, event, meta, rulesConfig) {
    const { player } = event;
    const opponent = player === 'a' ? 'b' : 'a';

    // Record the stat
    const statsKey = player === 'a' ? 'playerStatsA' : 'playerStatsB';
    state[statsKey].doubleFaults += 1;

    // Double fault = point won by the opponent
    this._processPoint(state, { ...event, eventType: 'point', winner: opponent }, meta, rulesConfig);
  }

  /**
   * Process a winner — records the stat (point must be awarded separately
   * unless the caller wants auto-point-award).
   */
  _processWinner(state, event, meta, rulesConfig) {
    const { player } = event;

    // Record the stat
    const statsKey = player === 'a' ? 'playerStatsA' : 'playerStatsB';
    state[statsKey].winners += 1;

    // Winner = point won by the hitting player
    this._processPoint(state, { ...event, eventType: 'point', winner: player }, meta, rulesConfig);
  }

  /**
   * Process an unforced error — awards a point to the opponent and records the stat.
   */
  _processUnforcedError(state, event, meta, rulesConfig) {
    const { player } = event;
    const opponent = player === 'a' ? 'b' : 'a';

    // Record the stat
    const statsKey = player === 'a' ? 'playerStatsA' : 'playerStatsB';
    state[statsKey].unforcedErrors += 1;

    // Unforced error = point won by the opponent
    this._processPoint(state, { ...event, eventType: 'point', winner: opponent }, meta, rulesConfig);
  }

  /**
   * Process a first serve tracking event (in or out).
   */
  _processFirstServe(state, event, isIn) {
    const { player } = event;
    if (!player || !['a', 'b'].includes(player)) return;

    const statsKey = player === 'a' ? 'playerStatsA' : 'playerStatsB';
    state[statsKey].firstServeTotal += 1;
    if (isIn) {
      state[statsKey].firstServeIn += 1;
    }

    // Recalculate percentage
    if (state[statsKey].firstServeTotal > 0) {
      state[statsKey].firstServePercent = Math.round(
        (state[statsKey].firstServeIn / state[statsKey].firstServeTotal) * 100
      );
    }
  }

  /**
   * Process a break point event (converted or saved).
   */
  _processBreakPoint(state, event, converted) {
    const { player } = event;
    if (!player || !['a', 'b'].includes(player)) return;

    const statsKey = player === 'a' ? 'playerStatsA' : 'playerStatsB';
    if (converted) {
      state[statsKey].breakPointsConverted += 1;
    } else {
      state[statsKey].breakPointsSaved += 1;
    }
  }
}

module.exports = TennisEngine;

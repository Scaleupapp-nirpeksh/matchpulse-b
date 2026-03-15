// ============================================
// MatchPulse — Table Tennis Scoring Engine
// ============================================
// ITTF rules: sets to 11 (win by 2 at deuce),
// service rotates every 2 points (every 1 at
// deuce), best-of-5 or best-of-7 match format.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');

class TableTennisScoringEngine extends BaseScoringEngine {
  constructor() {
    super('table_tennis');
  }

  // -------------------------------------------
  // Public API
  // -------------------------------------------

  /**
   * Build the initial match state.
   *
   * @param {Object} match       — Match document
   * @param {Object} rulesConfig — { bestOf: 5|7, pointsPerSet: 11, minLeadToWin: 2 }
   * @returns {Object} initial state
   */
  initializeState(match, rulesConfig) {
    const bestOf = rulesConfig.bestOf || 5;
    this._assert(
      bestOf === 5 || bestOf === 7,
      'Table Tennis bestOf must be 5 or 7'
    );

    return {
      sets: [],
      currentSet: { a: 0, b: 0 },
      setNumber: 1,
      serving: 'a', // default; can be overridden by toss
      setsWonA: 0,
      setsWonB: 0,
      serviceCount: 0,
      matchComplete: false,
      winner: null,
      history: [],
    };
  }

  /**
   * Validate a proposed event against the current state.
   *
   * @param {Object} match      — Match document (with currentState)
   * @param {Object} event      — { type: 'point', winner: 'a'|'b' }
   * @param {Object} rulesConfig
   * @returns {{ valid: boolean, reason?: string }}
   */
  validateEvent(match, event, rulesConfig) {
    const state = match.currentState;

    if (state.matchComplete) {
      return { valid: false, reason: 'Match is already complete' };
    }

    if (event.type !== 'point') {
      return { valid: false, reason: `Invalid event type: "${event.type}". Expected "point"` };
    }

    if (!['a', 'b'].includes(event.winner)) {
      return { valid: false, reason: `Invalid winner: "${event.winner}". Must be "a" or "b"` };
    }

    return { valid: true };
  }

  /**
   * Process a point event and return updated state + metadata.
   *
   * @param {Object} match       — Match document (with currentState)
   * @param {Object} event       — { type: 'point', winner: 'a'|'b' }
   * @param {Object} rulesConfig
   * @returns {{ state: Object, meta: Object }}
   */
  processEvent(match, event, rulesConfig) {
    const validation = this.validateEvent(match, event, rulesConfig);
    if (!validation.valid) {
      throw new BadRequestError(validation.reason);
    }

    const state = this._cloneState(match.currentState);
    const bestOf = rulesConfig.bestOf || 5;
    const setsToWin = Math.ceil(bestOf / 2);
    const pointsPerSet = rulesConfig.pointsPerSet || 11;
    const minLead = rulesConfig.minLeadToWin || 2;

    // Save snapshot for undo
    state.history.push(this._cloneState(match.currentState));

    // Award point
    state.currentSet[event.winner] += 1;
    state.serviceCount += 1;

    const scoreA = state.currentSet.a;
    const scoreB = state.currentSet.b;

    // Determine if set is won
    const isDeuce = scoreA >= pointsPerSet - 1 && scoreB >= pointsPerSet - 1;
    let setComplete = false;

    if (isDeuce) {
      // In deuce: must win by minLead
      if (Math.abs(scoreA - scoreB) >= minLead) {
        setComplete = true;
      }
    } else if (scoreA >= pointsPerSet || scoreB >= pointsPerSet) {
      setComplete = true;
    }

    // Rotate service
    if (isDeuce) {
      // During deuce: service rotates every 1 point
      state.serving = state.serving === 'a' ? 'b' : 'a';
      state.serviceCount = 0;
    } else if (state.serviceCount >= 2) {
      // Normal play: service rotates every 2 points
      state.serving = state.serving === 'a' ? 'b' : 'a';
      state.serviceCount = 0;
    }

    const meta = {
      isSetComplete: false,
      isMatchComplete: false,
      setWinner: null,
      matchWinner: null,
    };

    if (setComplete) {
      const setWinner = scoreA > scoreB ? 'a' : 'b';
      meta.isSetComplete = true;
      meta.setWinner = setWinner;

      // Record completed set
      state.sets.push([scoreA, scoreB]);

      if (setWinner === 'a') {
        state.setsWonA += 1;
      } else {
        state.setsWonB += 1;
      }

      // Check match completion
      if (state.setsWonA >= setsToWin || state.setsWonB >= setsToWin) {
        state.matchComplete = true;
        state.winner = state.setsWonA >= setsToWin ? 'a' : 'b';
        meta.isMatchComplete = true;
        meta.matchWinner = state.winner;
      } else {
        // Start next set
        state.setNumber += 1;
        state.currentSet = { a: 0, b: 0 };
        state.serviceCount = 0;
        // Alternate first server each set (opposite of who served first in previous set)
        state.serving = state.serving === 'a' ? 'b' : 'a';
      }
    }

    return { state, meta };
  }

  /**
   * Roll back the most recent event.
   *
   * @param {Object} match       — Match document
   * @param {Object} event       — the event being undone
   * @param {Array}  events      — all events for the match (chronological)
   * @param {Object} rulesConfig
   * @returns {Object} rolled-back state
   */
  undoEvent(match, event, events, rulesConfig) {
    const state = match.currentState;

    // Use internal history if available
    if (state.history && state.history.length > 0) {
      return state.history[state.history.length - 1];
    }

    // Fall back to base class logic
    return super.undoEvent(match, event, events, rulesConfig);
  }

  /**
   * Aggregate player statistics from all non-undone events.
   *
   * @param {Array} events — non-undone events in chronological order
   * @returns {Object} { a: { ... }, b: { ... } }
   */
  getPlayerStats(events) {
    const stats = {
      a: {
        pointsPerSet: [],
        servicePointsWon: 0,
        longestStreak: 0,
        totalPoints: 0,
      },
      b: {
        pointsPerSet: [],
        servicePointsWon: 0,
        longestStreak: 0,
        totalPoints: 0,
      },
    };

    // Track set-level points
    let setPointsA = 0;
    let setPointsB = 0;

    // Track service info by replaying service rotation
    let serving = 'a';
    let serviceCount = 0;
    let pointsPerSet = 11; // default

    // Track streaks
    let currentStreakPlayer = null;
    let currentStreakLength = 0;

    // Deuce tracking
    let deuceActive = false;

    for (const evt of events) {
      if (evt.isUndone) continue;

      const eventData = evt.eventData || evt;
      if (eventData.type !== 'point') continue;

      const winner = eventData.winner;

      // Count total points
      stats[winner].totalPoints += 1;

      // Count set-level points
      if (winner === 'a') {
        setPointsA += 1;
      } else {
        setPointsB += 1;
      }

      // Service point tracking
      if (serving === winner) {
        stats[winner].servicePointsWon += 1;
      }

      // Streak tracking
      if (currentStreakPlayer === winner) {
        currentStreakLength += 1;
      } else {
        currentStreakPlayer = winner;
        currentStreakLength = 1;
      }
      if (currentStreakLength > stats[winner].longestStreak) {
        stats[winner].longestStreak = currentStreakLength;
      }

      // Rotate service (mirrors processEvent logic)
      serviceCount += 1;
      deuceActive =
        setPointsA >= pointsPerSet - 1 && setPointsB >= pointsPerSet - 1;

      if (deuceActive) {
        serving = serving === 'a' ? 'b' : 'a';
        serviceCount = 0;
      } else if (serviceCount >= 2) {
        serving = serving === 'a' ? 'b' : 'a';
        serviceCount = 0;
      }

      // Check for set completion to reset set-level counters
      const setWon = deuceActive
        ? Math.abs(setPointsA - setPointsB) >= 2
        : setPointsA >= pointsPerSet || setPointsB >= pointsPerSet;

      if (setWon) {
        stats.a.pointsPerSet.push(setPointsA);
        stats.b.pointsPerSet.push(setPointsB);
        setPointsA = 0;
        setPointsB = 0;
        serviceCount = 0;
        deuceActive = false;
        // Alternate server for next set
        serving = serving === 'a' ? 'b' : 'a';
      }
    }

    // Push any incomplete set points
    if (setPointsA > 0 || setPointsB > 0) {
      stats.a.pointsPerSet.push(setPointsA);
      stats.b.pointsPerSet.push(setPointsB);
    }

    return stats;
  }

  /**
   * Check whether the match is complete.
   *
   * @param {Object} state       — currentState
   * @param {Object} rulesConfig
   * @returns {boolean}
   */
  isMatchComplete(state, rulesConfig) {
    if (state.matchComplete) return true;

    const bestOf = rulesConfig.bestOf || 5;
    const setsToWin = Math.ceil(bestOf / 2);

    return state.setsWonA >= setsToWin || state.setsWonB >= setsToWin;
  }
}

module.exports = TableTennisScoringEngine;

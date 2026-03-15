// ============================================
// MatchPulse — Badminton Scoring Engine
// ============================================
// BWF rules: sets to 21 (win by 2, cap at 30),
// best-of-3. Server's court side determined by
// score parity (even = right, odd = left).
// Winner of the rally scores and serves next.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');

class BadmintonScoringEngine extends BaseScoringEngine {
  constructor() {
    super('badminton');
  }

  // -------------------------------------------
  // Public API
  // -------------------------------------------

  /**
   * Build the initial match state.
   *
   * @param {Object} match       — Match document
   * @param {Object} rulesConfig — { bestOf: 3, pointsPerGame: 21, capAt: 30, minLeadToWin: 2 }
   * @returns {Object} initial state
   */
  initializeState(match, rulesConfig) {
    const bestOf = rulesConfig.bestOf || 3;
    this._assert(bestOf === 3, 'Badminton bestOf must be 3');

    return {
      sets: [],
      currentSet: { a: 0, b: 0 },
      setNumber: 1,
      serving: 'a',
      setsWonA: 0,
      setsWonB: 0,
      courtSide: {
        a: 'right', // even score = right court
        b: 'left',
      },
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
    const pointsPerGame = rulesConfig.pointsPerGame || 21;
    const capAt = rulesConfig.capAt || 30;
    const minLead = rulesConfig.minLeadToWin || 2;
    const setsToWin = Math.ceil((rulesConfig.bestOf || 3) / 2); // 2 sets to win

    // Save snapshot for undo
    state.history.push(this._cloneState(match.currentState));

    // Award point
    state.currentSet[event.winner] += 1;

    const scoreA = state.currentSet.a;
    const scoreB = state.currentSet.b;

    // Service: winner of the rally serves next
    state.serving = event.winner;

    // Update court sides based on server's score
    this._updateCourtSides(state);

    // Determine if set is won
    let setComplete = false;

    if (scoreA >= pointsPerGame || scoreB >= pointsPerGame) {
      if (Math.abs(scoreA - scoreB) >= minLead) {
        setComplete = true;
      } else if (scoreA >= capAt || scoreB >= capAt) {
        // At 29-29, next point wins (cap at 30)
        setComplete = true;
      }
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
        // Start next set — players switch ends
        state.setNumber += 1;
        state.currentSet = { a: 0, b: 0 };
        // Winner of previous set serves first in the next
        state.serving = setWinner;
        // Reset court sides (0 is even → right court for server)
        this._updateCourtSides(state);
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
        totalPoints: 0,
      },
      b: {
        pointsPerSet: [],
        servicePointsWon: 0,
        totalPoints: 0,
      },
    };

    let setPointsA = 0;
    let setPointsB = 0;
    let serving = 'a';
    const pointsPerGame = 21;
    const capAt = 30;

    for (const evt of events) {
      if (evt.isUndone) continue;

      const eventData = evt.eventData || evt;
      if (eventData.type !== 'point') continue;

      const winner = eventData.winner;

      stats[winner].totalPoints += 1;

      if (winner === 'a') {
        setPointsA += 1;
      } else {
        setPointsB += 1;
      }

      // Service point tracking (server at the time of the rally)
      if (serving === winner) {
        stats[winner].servicePointsWon += 1;
      }

      // Rally winner serves next
      serving = winner;

      // Check for set completion
      let setWon = false;
      if (setPointsA >= pointsPerGame || setPointsB >= pointsPerGame) {
        if (Math.abs(setPointsA - setPointsB) >= 2) {
          setWon = true;
        } else if (setPointsA >= capAt || setPointsB >= capAt) {
          setWon = true;
        }
      }

      if (setWon) {
        stats.a.pointsPerSet.push(setPointsA);
        stats.b.pointsPerSet.push(setPointsB);
        setPointsA = 0;
        setPointsB = 0;
        // Set winner serves first in next set
        serving = winner;
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

    const setsToWin = Math.ceil((rulesConfig.bestOf || 3) / 2);
    return state.setsWonA >= setsToWin || state.setsWonB >= setsToWin;
  }

  // -------------------------------------------
  // Private helpers
  // -------------------------------------------

  /**
   * Update court sides based on the server's current score.
   * BWF rule: server stands on right court if their score is even,
   * left court if their score is odd. Receiver takes the opposite side.
   *
   * @param {Object} state — mutable state object
   */
  _updateCourtSides(state) {
    const serverScore = state.currentSet[state.serving];
    const serverSide = serverScore % 2 === 0 ? 'right' : 'left';
    const receiverSide = serverSide === 'right' ? 'left' : 'right';

    const receiver = state.serving === 'a' ? 'b' : 'a';
    state.courtSide[state.serving] = serverSide;
    state.courtSide[receiver] = receiverSide;
  }
}

module.exports = BadmintonScoringEngine;

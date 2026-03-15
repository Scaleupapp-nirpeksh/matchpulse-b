// ============================================
// MatchPulse — Squash Scoring Engine
// ============================================
// PAR (Point-A-Rally) scoring to 11 (win by 2).
// Best-of-5 (or best-of-3). Winner of each
// rally scores regardless of who served.
// Winner of the rally serves next.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');

class SquashScoringEngine extends BaseScoringEngine {
  constructor() {
    super('squash');
  }

  // -------------------------------------------
  // Public API
  // -------------------------------------------

  /**
   * Build the initial match state.
   *
   * @param {Object} match       — Match document
   * @param {Object} rulesConfig — { bestOf: 5|3, pointsPerGame: 11, minLeadToWin: 2 }
   * @returns {Object} initial state
   */
  initializeState(match, rulesConfig) {
    const bestOf = rulesConfig.bestOf || 5;
    this._assert(
      bestOf === 3 || bestOf === 5,
      'Squash bestOf must be 3 or 5'
    );

    return {
      games: [],
      currentGame: { a: 0, b: 0 },
      gameNumber: 1,
      serving: 'a',
      gamesWonA: 0,
      gamesWonB: 0,
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
    const gamesToWin = Math.ceil(bestOf / 2);
    const pointsPerGame = rulesConfig.pointsPerGame || 11;
    const minLead = rulesConfig.minLeadToWin || 2;

    // Save snapshot for undo
    state.history.push(this._cloneState(match.currentState));

    // PAR scoring: rally winner always scores
    state.currentGame[event.winner] += 1;

    // Service: winner of the rally serves next
    state.serving = event.winner;

    const scoreA = state.currentGame.a;
    const scoreB = state.currentGame.b;

    // Determine if game is won
    let gameComplete = false;

    if (scoreA >= pointsPerGame || scoreB >= pointsPerGame) {
      if (Math.abs(scoreA - scoreB) >= minLead) {
        gameComplete = true;
      }
    }

    const meta = {
      isGameComplete: false,
      isMatchComplete: false,
      gameWinner: null,
      matchWinner: null,
    };

    if (gameComplete) {
      const gameWinner = scoreA > scoreB ? 'a' : 'b';
      meta.isGameComplete = true;
      meta.gameWinner = gameWinner;

      // Record completed game
      state.games.push([scoreA, scoreB]);

      if (gameWinner === 'a') {
        state.gamesWonA += 1;
      } else {
        state.gamesWonB += 1;
      }

      // Check match completion
      if (state.gamesWonA >= gamesToWin || state.gamesWonB >= gamesToWin) {
        state.matchComplete = true;
        state.winner = state.gamesWonA >= gamesToWin ? 'a' : 'b';
        meta.isMatchComplete = true;
        meta.matchWinner = state.winner;
      } else {
        // Start next game
        state.gameNumber += 1;
        state.currentGame = { a: 0, b: 0 };
        // Winner of previous game serves first in the next
        state.serving = gameWinner;
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
        pointsPerGame: [],
        servicePointsWon: 0,
        totalPoints: 0,
      },
      b: {
        pointsPerGame: [],
        servicePointsWon: 0,
        totalPoints: 0,
      },
    };

    let gamePointsA = 0;
    let gamePointsB = 0;
    let serving = 'a';
    const pointsPerGame = 11;

    for (const evt of events) {
      if (evt.isUndone) continue;

      const eventData = evt.eventData || evt;
      if (eventData.type !== 'point') continue;

      const winner = eventData.winner;

      stats[winner].totalPoints += 1;

      if (winner === 'a') {
        gamePointsA += 1;
      } else {
        gamePointsB += 1;
      }

      // Service point tracking (server at the time of the rally)
      if (serving === winner) {
        stats[winner].servicePointsWon += 1;
      }

      // Rally winner serves next
      serving = winner;

      // Check for game completion
      let gameWon = false;
      if (gamePointsA >= pointsPerGame || gamePointsB >= pointsPerGame) {
        if (Math.abs(gamePointsA - gamePointsB) >= 2) {
          gameWon = true;
        }
      }

      if (gameWon) {
        stats.a.pointsPerGame.push(gamePointsA);
        stats.b.pointsPerGame.push(gamePointsB);
        gamePointsA = 0;
        gamePointsB = 0;
        // Game winner serves first in next game
        serving = winner;
      }
    }

    // Push any incomplete game points
    if (gamePointsA > 0 || gamePointsB > 0) {
      stats.a.pointsPerGame.push(gamePointsA);
      stats.b.pointsPerGame.push(gamePointsB);
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
    const gamesToWin = Math.ceil(bestOf / 2);

    return state.gamesWonA >= gamesToWin || state.gamesWonB >= gamesToWin;
  }
}

module.exports = SquashScoringEngine;

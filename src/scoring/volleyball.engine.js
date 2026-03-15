// ============================================
// MatchPulse — Volleyball Scoring Engine
// ============================================
// Handles indoor volleyball scoring with set
// management, service rotation, side switches,
// and player stat tracking.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');

const VALID_EVENT_TYPES = [
  'rally_point',
  'set_end',
  'kill',
  'block_point',
  'ace',
  'dig',
  'service_error',
];

class VolleyballEngine extends BaseScoringEngine {
  constructor() {
    super('volleyball');
  }

  // -------------------------------------------
  // Public API
  // -------------------------------------------

  /**
   * Create the initial match state.
   *
   * @param {Object} match       — the Match document
   * @param {Object} rulesConfig — { setsToWin, pointsPerSet, decidingSetPoints, minLeadToWin }
   * @returns {Object} initial state
   */
  initializeState(match, rulesConfig = {}) {
    return {
      sets: [],
      currentSet: { a: 0, b: 0 },
      setNumber: 1,
      serving: 'a',
      setsWonA: 0,
      setsWonB: 0,
      playerStatsA: {},
      playerStatsB: {},
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

    switch (event.eventType) {
      case 'rally_point': {
        if (!event.scoringTeam || !['a', 'b'].includes(event.scoringTeam)) {
          return { valid: false, reason: 'scoringTeam must be "a" or "b"' };
        }
        break;
      }

      case 'set_end': {
        // Verify that the current set actually qualifies to end
        const setCheck = this._isSetComplete(state.currentSet, state, rulesConfig);
        if (!setCheck) {
          return { valid: false, reason: 'Current set does not meet win conditions yet' };
        }
        break;
      }

      case 'kill':
      case 'block_point':
      case 'ace':
      case 'dig':
      case 'service_error': {
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
    const meta = {
      isMatchComplete: false,
      isSetComplete: false,
      scoreChanged: false,
      sideSwitch: false,
    };

    switch (event.eventType) {
      case 'rally_point':
        this._processRallyPoint(state, event, meta, rulesConfig);
        break;

      case 'set_end':
        this._processSetEnd(state, event, meta, rulesConfig);
        break;

      case 'kill':
        this._processStatEvent(state, event, 'kills');
        break;

      case 'block_point':
        this._processStatEvent(state, event, 'blocks');
        break;

      case 'ace':
        this._processStatEvent(state, event, 'aces');
        break;

      case 'dig':
        this._processStatEvent(state, event, 'digs');
        break;

      case 'service_error':
        this._processStatEvent(state, event, 'serviceErrors');
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
   * @returns {Object} keyed by playerId
   */
  getPlayerStats(events) {
    const stats = {};

    const ensurePlayer = (playerId) => {
      if (!playerId) return null;
      const key = playerId.toString();
      if (!stats[key]) {
        stats[key] = {
          kills: 0,
          blocks: 0,
          aces: 0,
          digs: 0,
          serviceErrors: 0,
        };
      }
      return key;
    };

    for (const evt of events) {
      const data = evt.eventData || evt;
      const key = ensurePlayer(data.player);
      if (!key) continue;

      switch (data.eventType) {
        case 'kill':
          stats[key].kills += 1;
          break;
        case 'block_point':
          stats[key].blocks += 1;
          break;
        case 'ace':
          stats[key].aces += 1;
          break;
        case 'dig':
          stats[key].digs += 1;
          break;
        case 'service_error':
          stats[key].serviceErrors += 1;
          break;
      }
    }

    return stats;
  }

  /**
   * Determine whether the match is complete.
   * Match is complete when one team wins the required number of sets.
   *
   * @param {Object} state       — the currentState
   * @param {Object} rulesConfig
   * @returns {boolean}
   */
  isMatchComplete(state, rulesConfig = {}) {
    const setsToWin = rulesConfig.setsToWin || 3;

    if (state.setsWonA >= setsToWin || state.setsWonB >= setsToWin) {
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
        kills: 0,
        blocks: 0,
        aces: 0,
        digs: 0,
        serviceErrors: 0,
      };
    }
    return key;
  }

  /**
   * Check whether the current set meets win conditions.
   */
  _isSetComplete(currentSet, state, rulesConfig = {}) {
    const setsToWin = rulesConfig.setsToWin || 3;
    const pointsPerSet = rulesConfig.pointsPerSet || 25;
    const decidingSetPoints = rulesConfig.decidingSetPoints || 15;
    const minLead = rulesConfig.minLeadToWin || 2;

    // Determine the target for this set
    const totalSetsNeeded = setsToWin * 2 - 1; // e.g. 5 for best-of-5 (3 sets to win)
    const isDecidingSet = state.setNumber >= totalSetsNeeded;
    const target = isDecidingSet ? decidingSetPoints : pointsPerSet;

    const a = currentSet.a;
    const b = currentSet.b;
    const lead = Math.abs(a - b);
    const maxScore = Math.max(a, b);

    // Set is won when a team reaches the target with the required lead
    return maxScore >= target && lead >= minLead;
  }

  /**
   * Process a rally point.
   */
  _processRallyPoint(state, event, meta, rulesConfig) {
    const { scoringTeam } = event;

    // Award the point
    if (scoringTeam === 'a') {
      state.currentSet.a += 1;
    } else {
      state.currentSet.b += 1;
    }

    meta.scoreChanged = true;

    // Service rotation: if the receiving team scores, service changes
    if (scoringTeam !== state.serving) {
      state.serving = scoringTeam;
    }

    // Auto set management: check if the set is complete
    if (this._isSetComplete(state.currentSet, state, rulesConfig)) {
      this._completeSet(state, meta, rulesConfig);
    }
  }

  /**
   * Complete the current set and prepare for the next.
   */
  _completeSet(state, meta, rulesConfig) {
    const setsToWin = rulesConfig.setsToWin || 3;

    // Record the completed set
    state.sets.push([state.currentSet.a, state.currentSet.b]);

    // Award set win
    if (state.currentSet.a > state.currentSet.b) {
      state.setsWonA += 1;
    } else {
      state.setsWonB += 1;
    }

    meta.isSetComplete = true;

    // Check if match is complete
    if (state.setsWonA >= setsToWin || state.setsWonB >= setsToWin) {
      state.matchComplete = true;
      meta.isMatchComplete = true;
      return;
    }

    // Prepare next set
    state.setNumber += 1;
    state.currentSet = { a: 0, b: 0 };

    // Side switch between sets
    state.serving = state.serving === 'a' ? 'b' : 'a';
    meta.sideSwitch = true;
  }

  /**
   * Process a manual set_end event (for cases where auto-detection
   * was bypassed or the scorer explicitly ends a set).
   */
  _processSetEnd(state, event, meta, rulesConfig) {
    // If the set hasn't been auto-completed yet, do it now
    if (!this._isSetComplete(state.currentSet, state, rulesConfig)) {
      throw new BadRequestError('Current set does not meet win conditions yet');
    }

    // If auto-complete already handled it (from rally_point), this is a no-op.
    // But if the set is complete and not yet recorded (edge case), handle it.
    const lastRecordedSet = state.sets[state.sets.length - 1];
    const alreadyRecorded =
      lastRecordedSet &&
      lastRecordedSet[0] === state.currentSet.a &&
      lastRecordedSet[1] === state.currentSet.b;

    if (!alreadyRecorded) {
      this._completeSet(state, meta, rulesConfig);
    }
  }

  /**
   * Process a generic stat event (kill, block, ace, dig, service_error).
   */
  _processStatEvent(state, event, statKey) {
    const { team, player } = event;
    const statsMap = this._getPlayerStatsMap(state, team);
    const playerKey = this._ensurePlayerStats(statsMap, player);
    if (playerKey) {
      statsMap[playerKey][statKey] += 1;
    }
  }
}

module.exports = VolleyballEngine;

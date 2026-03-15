// ============================================
// MatchPulse — Base Scoring Engine
// ============================================
// Abstract base class that all sport-specific
// scoring engines must extend. Provides the
// contract and shared utilities for event-driven
// state machines.
// ============================================

const { BadRequestError } = require('../utils/errors');

class BaseScoringEngine {
  /**
   * @param {string} sport — sport identifier (e.g. 'cricket', 'football')
   */
  constructor(sport) {
    if (new.target === BaseScoringEngine) {
      throw new Error('BaseScoringEngine is abstract and cannot be instantiated directly');
    }
    this.sport = sport;
  }

  // -------------------------------------------
  // Public API — must be implemented by subclass
  // -------------------------------------------

  /**
   * Create the initial match state for a given sport.
   *
   * @param {Object} match  — the Match document (teamA, teamB, toss, etc.)
   * @param {Object} rulesConfig — sport-specific rules (e.g. overs, halfLength)
   * @returns {Object} the initial currentState to persist on the Match document
   */
  initializeState(match, rulesConfig) {
    throw new BadRequestError(
      `initializeState() is not implemented for sport: ${this.sport}`
    );
  }

  /**
   * Process a scoring event and return the new match state.
   *
   * Implementations MUST be pure-ish: given the same match + event + rules
   * they must return the same state. Side-effects (persistence, notifications)
   * are handled by the caller.
   *
   * @param {Object} match      — the Match document (with currentState)
   * @param {Object} event      — the incoming scoring event data
   * @param {Object} rulesConfig
   * @returns {Object} { state, meta }
   *   - state: the updated currentState
   *   - meta: optional metadata (e.g. { isMatchComplete, isInningsComplete })
   */
  processEvent(match, event, rulesConfig) {
    throw new BadRequestError(
      `processEvent() is not implemented for sport: ${this.sport}`
    );
  }

  /**
   * Roll back state after an event is marked as undone.
   *
   * The default strategy uses the stateSnapshot stored on the
   * *preceding* event. Subclasses may override for more sophisticated
   * rollback logic (e.g. re-playing all events from scratch).
   *
   * @param {Object} match       — the Match document
   * @param {Object} event       — the event being undone
   * @param {Array}  events      — all events for the match (chronological)
   * @param {Object} rulesConfig
   * @returns {Object} the rolled-back currentState
   */
  undoEvent(match, event, events, rulesConfig) {
    // Find the active (non-undone) events in chronological order
    const activeEvents = events.filter((e) => !e.isUndone);

    // The event being undone should be the last active event
    const lastActive = activeEvents[activeEvents.length - 1];
    if (!lastActive || lastActive._id.toString() !== event._id.toString()) {
      throw new BadRequestError(
        'Only the most recent active event can be undone'
      );
    }

    // Find the event immediately before the undone one
    const precedingEvents = activeEvents.slice(0, -1);
    if (precedingEvents.length === 0) {
      // No preceding events — roll back to initial state
      return this.initializeState(match, rulesConfig);
    }

    const precedingEvent = precedingEvents[precedingEvents.length - 1];
    if (precedingEvent.stateSnapshot) {
      return JSON.parse(JSON.stringify(precedingEvent.stateSnapshot));
    }

    // Fallback: replay all preceding active events from scratch
    return this._replayEvents(match, precedingEvents, rulesConfig);
  }

  /**
   * Validate whether an event is legal in the current match state.
   *
   * @param {Object} match      — the Match document (with currentState)
   * @param {Object} event      — the proposed event
   * @param {Object} rulesConfig
   * @returns {{ valid: boolean, reason?: string }}
   */
  validateEvent(match, event, rulesConfig) {
    throw new BadRequestError(
      `validateEvent() is not implemented for sport: ${this.sport}`
    );
  }

  /**
   * Aggregate per-player statistics from a list of scoring events.
   *
   * @param {Array} events — all non-undone events for the match
   * @returns {Object} keyed by playerId, with sport-specific stat objects
   */
  getPlayerStats(events) {
    throw new BadRequestError(
      `getPlayerStats() is not implemented for sport: ${this.sport}`
    );
  }

  /**
   * Determine whether the match is complete based on current state.
   *
   * @param {Object} state       — the currentState on the Match document
   * @param {Object} rulesConfig
   * @returns {boolean}
   */
  isMatchComplete(state, rulesConfig) {
    throw new BadRequestError(
      `isMatchComplete() is not implemented for sport: ${this.sport}`
    );
  }

  // -------------------------------------------
  // Shared helpers available to all subclasses
  // -------------------------------------------

  /**
   * Deep-clone a state object to avoid mutation.
   *
   * @param {Object} obj
   * @returns {Object}
   */
  _cloneState(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Replay a series of events from scratch to rebuild state.
   * Used as a fallback when stateSnapshots are missing.
   *
   * @param {Object} match   — the Match document
   * @param {Array}  events  — events to replay (in order)
   * @param {Object} rulesConfig
   * @returns {Object} the rebuilt state
   */
  _replayEvents(match, events, rulesConfig) {
    let state = this.initializeState(match, rulesConfig);

    // Build a lightweight match proxy that carries the evolving state
    const matchProxy = { ...match, currentState: state };

    for (const evt of events) {
      const result = this.processEvent(
        { ...matchProxy, currentState: state },
        evt.eventData || evt,
        rulesConfig
      );
      state = result.state || result;
    }

    return state;
  }

  /**
   * Assert a condition or throw BadRequestError.
   *
   * @param {boolean} condition
   * @param {string}  message
   */
  _assert(condition, message) {
    if (!condition) {
      throw new BadRequestError(message);
    }
  }

  /**
   * Ensure a required field is present on an object.
   *
   * @param {Object} obj
   * @param {string} field
   * @param {string} label — human-readable label for error messages
   */
  _requireField(obj, field, label) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new BadRequestError(`${label || field} is required`);
    }
  }

  /**
   * Ensure a value is within a set of allowed values.
   *
   * @param {*} value
   * @param {Array} allowed
   * @param {string} label
   */
  _requireEnum(value, allowed, label) {
    if (!allowed.includes(value)) {
      throw new BadRequestError(
        `Invalid ${label}: "${value}". Allowed values: ${allowed.join(', ')}`
      );
    }
  }
}

module.exports = BaseScoringEngine;

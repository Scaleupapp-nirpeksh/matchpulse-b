// ============================================
// MatchPulse — Scoring Engine Registry
// ============================================
// Central registry that maps sport types to their
// scoring engine classes. Use getEngine(sportType)
// to obtain a singleton engine instance.
// ============================================

const { SPORTS } = require('../utils/constants');
const { BadRequestError } = require('../utils/errors');

// Sport-specific engines
const CricketScoringEngine = require('./cricket.engine');
const FootballScoringEngine = require('./football.engine');
const Basketball5v5ScoringEngine = require('./basketball5v5.engine');
const Basketball3x3ScoringEngine = require('./basketball3x3.engine');
const VolleyballScoringEngine = require('./volleyball.engine');
const TableTennisScoringEngine = require('./tableTennis.engine');
const BadmintonScoringEngine = require('./badminton.engine');
const TennisScoringEngine = require('./tennis.engine');
const SquashScoringEngine = require('./squash.engine');

// Map sport constants to engine classes
const ENGINE_MAP = {
  [SPORTS.CRICKET]: CricketScoringEngine,
  [SPORTS.FOOTBALL]: FootballScoringEngine,
  [SPORTS.BASKETBALL_5V5]: Basketball5v5ScoringEngine,
  [SPORTS.BASKETBALL_3X3]: Basketball3x3ScoringEngine,
  [SPORTS.VOLLEYBALL]: VolleyballScoringEngine,
  [SPORTS.TENNIS]: TennisScoringEngine,
  [SPORTS.TABLE_TENNIS]: TableTennisScoringEngine,
  [SPORTS.BADMINTON]: BadmintonScoringEngine,
  [SPORTS.SQUASH]: SquashScoringEngine,
};

// Singleton cache — one instance per sport
const engineInstances = {};

/**
 * Get the scoring engine for a given sport type.
 *
 * @param {string} sportType — one of the SPORTS constants
 * @returns {BaseScoringEngine} the engine instance
 * @throws {BadRequestError} if the sport is not supported
 */
function getEngine(sportType) {
  if (!ENGINE_MAP[sportType]) {
    throw new BadRequestError(
      `No scoring engine available for sport: "${sportType}". ` +
      `Supported sports: ${Object.keys(ENGINE_MAP).join(', ')}`
    );
  }

  // Return cached instance or create one
  if (!engineInstances[sportType]) {
    const EngineClass = ENGINE_MAP[sportType];
    engineInstances[sportType] = new EngineClass();
  }

  return engineInstances[sportType];
}

module.exports = {
  getEngine,
  ENGINE_MAP,
};

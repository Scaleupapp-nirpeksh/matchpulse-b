// ============================================
// MatchPulse — Constants
// ============================================

const SPORTS = {
  CRICKET: 'cricket',
  FOOTBALL: 'football',
  BASKETBALL_5V5: 'basketball_5v5',
  BASKETBALL_3X3: 'basketball_3x3',
  VOLLEYBALL: 'volleyball',
  TENNIS: 'tennis',
  TABLE_TENNIS: 'table_tennis',
  BADMINTON: 'badminton',
  SQUASH: 'squash',
};

const SPORT_LIST = Object.values(SPORTS);

const TOURNAMENT_FORMATS = {
  ROUND_ROBIN: 'round_robin',
  KNOCKOUT: 'knockout',
  GROUPS_KNOCKOUT: 'groups_knockout',
  SWISS: 'swiss',
};

const TOURNAMENT_STATUS = {
  DRAFT: 'draft',
  REGISTRATION: 'registration',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const MATCH_STATUS = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  POSTPONED: 'postponed',
};

const USER_ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  ORG_ADMIN: 'org_admin',
  TOURNAMENT_ADMIN: 'tournament_admin',
  SCORER: 'scorer',
  PLAYER: 'player',
};

const ROLE_HIERARCHY = {
  [USER_ROLES.PLATFORM_ADMIN]: 5,
  [USER_ROLES.ORG_ADMIN]: 4,
  [USER_ROLES.TOURNAMENT_ADMIN]: 3,
  [USER_ROLES.SCORER]: 2,
  [USER_ROLES.PLAYER]: 1,
};

const MATCH_LIFECYCLE = {
  START: 'start',
  PAUSE: 'pause',
  RESUME: 'resume',
  END: 'end',
};

// Cricket-specific
const CRICKET_EXTRAS = {
  WIDE: 'wide',
  NO_BALL: 'no_ball',
  BYE: 'bye',
  LEG_BYE: 'leg_bye',
};

const CRICKET_WICKET_TYPES = {
  BOWLED: 'bowled',
  CAUGHT: 'caught',
  LBW: 'lbw',
  RUN_OUT: 'run_out',
  STUMPED: 'stumped',
  HIT_WICKET: 'hit_wicket',
  RETIRED_HURT: 'retired_hurt',
  RETIRED_OUT: 'retired_out',
  TIMED_OUT: 'timed_out',
  OBSTRUCTING: 'obstructing_the_field',
};

// Football-specific
const FOOTBALL_CARD_TYPES = {
  YELLOW: 'yellow',
  RED: 'red',
};

const FOOTBALL_EVENT_TYPES = {
  GOAL: 'goal',
  CARD: 'card',
  SUBSTITUTION: 'substitution',
  HALF_START: 'half_start',
  HALF_END: 'half_end',
};

// Basketball-specific
const BASKETBALL_SHOT_TYPES = {
  TWO_POINT: '2pt',
  THREE_POINT: '3pt',
  FREE_THROW: 'ft',
  ONE_POINT: '1pt', // 3x3 only
};

// Scoring event types (generic)
const EVENT_TYPES = {
  // Cricket
  BALL: 'ball',
  WICKET: 'wicket',
  OVER_COMPLETE: 'over_complete',
  INNINGS_BREAK: 'innings_break',

  // Football
  GOAL: 'goal',
  CARD: 'card',
  SUBSTITUTION: 'substitution',

  // Basketball
  SHOT_MADE: 'shot_made',
  SHOT_MISSED: 'shot_missed',
  FOUL: 'foul',
  TIMEOUT: 'timeout',
  QUARTER_START: 'quarter_start',
  QUARTER_END: 'quarter_end',

  // Rally sports (volleyball, badminton, squash)
  RALLY_POINT: 'rally_point',
  SET_END: 'set_end',

  // Point sports (tennis, table tennis)
  POINT: 'point',
  GAME_END: 'game_end',

  // Shared
  MATCH_START: 'match_start',
  MATCH_PAUSE: 'match_pause',
  MATCH_RESUME: 'match_resume',
  MATCH_END: 'match_end',
  PERIOD_START: 'period_start',
  PERIOD_END: 'period_end',
  UNDO: 'undo',
};

// Audit action types
const AUDIT_ACTIONS = {
  // Auth
  USER_REGISTER: 'user_register',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',

  // Org
  ORG_CREATE: 'org_create',
  ORG_UPDATE: 'org_update',
  ORG_INVITE: 'org_invite',

  // Tournament
  TOURNAMENT_CREATE: 'tournament_create',
  TOURNAMENT_UPDATE: 'tournament_update',
  TOURNAMENT_STATUS_CHANGE: 'tournament_status_change',
  RULES_UPDATE: 'rules_update',

  // Teams & Players
  TEAM_CREATE: 'team_create',
  TEAM_UPDATE: 'team_update',
  TEAM_DELETE: 'team_delete',
  PLAYER_ADD: 'player_add',
  PLAYER_REMOVE: 'player_remove',
  PLAYER_UPDATE: 'player_update',

  // Match
  MATCH_CREATE: 'match_create',
  MATCH_UPDATE: 'match_update',
  MATCH_START: 'match_start',
  MATCH_PAUSE: 'match_pause',
  MATCH_RESUME: 'match_resume',
  MATCH_END: 'match_end',
  SCORER_ASSIGN: 'scorer_assign',

  // Scoring
  SCORE_EVENT: 'score_event',
  SCORE_UNDO: 'score_undo',

  // Config
  CONFIG_CHANGE: 'config_change',

  // Fixtures
  FIXTURES_GENERATE: 'fixtures_generate',
  FIXTURE_UPDATE: 'fixture_update',
};

const AUDIT_ENTITY_TYPES = {
  USER: 'user',
  ORGANIZATION: 'organization',
  TOURNAMENT: 'tournament',
  TEAM: 'team',
  PLAYER: 'player',
  MATCH: 'match',
  SCORING_EVENT: 'scoring_event',
  STANDING: 'standing',
  NOTIFICATION: 'notification',
};

// Notification types
const NOTIFICATION_TYPES = {
  MATCH_STARTING: 'match_starting',
  SCORE_UPDATE: 'score_update',
  MATCH_COMPLETED: 'match_completed',
  WICKET: 'wicket',
  GOAL: 'goal',
  RED_CARD: 'red_card',
  MILESTONE: 'milestone',
  LEAD_CHANGE: 'lead_change',
  TOURNAMENT_UPDATE: 'tournament_update',
  INVITE: 'invite',
  ASSIGNMENT: 'assignment',
};

// Push subscription platforms
const PUSH_PLATFORMS = {
  IOS_APNS: 'ios_apns',
  WEB_PUSH: 'web_push',
  WEB_FCM: 'web_fcm',
};

// Default rules configs per sport
const DEFAULT_RULES = {
  [SPORTS.CRICKET]: {
    oversPerInnings: 15,
    powerplayOvers: 4,
    maxOversPerBowler: 3,
    wideBallReBowl: true,
    freeHit: true,
    lbwEnabled: false,
    numberOfInnings: 2,
  },
  [SPORTS.FOOTBALL]: {
    halfLength: 30, // minutes
    extraTime: false,
    extraTimeLength: 10,
    penaltyShootout: true,
    maxSubstitutions: 3,
  },
  [SPORTS.BASKETBALL_5V5]: {
    quarterLength: 10, // minutes
    overtimeLength: 5,
    shotClock: 24,
    foulBonusThreshold: 5,
    numberOfQuarters: 4,
  },
  [SPORTS.BASKETBALL_3X3]: {
    targetScore: 21,
    gameTime: 10, // minutes
    shotClock: 12,
    foulBonus: 7,
  },
  [SPORTS.VOLLEYBALL]: {
    setsToWin: 3,
    pointsPerSet: 25,
    decidingSetPoints: 15,
    minLeadToWin: 2,
  },
  [SPORTS.TENNIS]: {
    bestOf: 3,
    tiebreakEnabled: true,
    noAdScoring: false,
    finalSetTiebreak: true,
  },
  [SPORTS.TABLE_TENNIS]: {
    bestOf: 5,
    pointsPerSet: 11,
    minLeadToWin: 2,
  },
  [SPORTS.BADMINTON]: {
    bestOf: 3,
    pointsPerGame: 21,
    capAt: 30,
    minLeadToWin: 2,
  },
  [SPORTS.SQUASH]: {
    bestOf: 5,
    pointsPerGame: 11,
    parScoring: true,
    minLeadToWin: 2,
  },
};

module.exports = {
  SPORTS,
  SPORT_LIST,
  TOURNAMENT_FORMATS,
  TOURNAMENT_STATUS,
  MATCH_STATUS,
  USER_ROLES,
  ROLE_HIERARCHY,
  MATCH_LIFECYCLE,
  CRICKET_EXTRAS,
  CRICKET_WICKET_TYPES,
  FOOTBALL_CARD_TYPES,
  FOOTBALL_EVENT_TYPES,
  BASKETBALL_SHOT_TYPES,
  EVENT_TYPES,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  NOTIFICATION_TYPES,
  PUSH_PLATFORMS,
  DEFAULT_RULES,
};

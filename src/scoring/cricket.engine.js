// ============================================
// MatchPulse — Cricket Scoring Engine
// ============================================
// Ball-by-ball state machine for limited-overs
// cricket. Handles extras, wickets, strike
// rotation, free hits, partnerships, and
// innings breaks.
// ============================================

const BaseScoringEngine = require('./base.engine');
const { BadRequestError } = require('../utils/errors');
const {
  CRICKET_EXTRAS,
  CRICKET_WICKET_TYPES,
  EVENT_TYPES,
} = require('../utils/constants');
const { ballsToOvers } = require('../utils/helpers');

const VALID_EVENT_TYPES = [
  EVENT_TYPES.BALL,
  EVENT_TYPES.OVER_COMPLETE,
  EVENT_TYPES.INNINGS_BREAK,
];

const VALID_EXTRA_TYPES = Object.values(CRICKET_EXTRAS);
const VALID_WICKET_TYPES = Object.values(CRICKET_WICKET_TYPES);

// Wicket types where the bowler is NOT credited
const NON_BOWLER_WICKETS = [
  CRICKET_WICKET_TYPES.RUN_OUT,
  CRICKET_WICKET_TYPES.RETIRED_HURT,
  CRICKET_WICKET_TYPES.RETIRED_OUT,
  CRICKET_WICKET_TYPES.TIMED_OUT,
  CRICKET_WICKET_TYPES.OBSTRUCTING,
];

// Wicket types that require a fielder
const FIELDER_WICKETS = [
  CRICKET_WICKET_TYPES.CAUGHT,
  CRICKET_WICKET_TYPES.RUN_OUT,
  CRICKET_WICKET_TYPES.STUMPED,
];

class CricketScoringEngine extends BaseScoringEngine {
  constructor() {
    super('cricket');
  }

  // -------------------------------------------
  // initializeState
  // -------------------------------------------

  initializeState(match, rulesConfig) {
    this._assert(match.teamA, 'match.teamA is required');
    this._assert(match.teamB, 'match.teamB is required');

    const teamAId = match.teamA._id
      ? match.teamA._id.toString()
      : match.teamA.toString();
    const teamBId = match.teamB._id
      ? match.teamB._id.toString()
      : match.teamB.toString();

    // Determine batting order from toss
    let battingFirst = teamAId;
    let bowlingFirst = teamBId;

    if (match.toss && match.toss.winnerId && match.toss.decision) {
      const tossWinnerId = match.toss.winnerId._id
        ? match.toss.winnerId._id.toString()
        : match.toss.winnerId.toString();

      if (match.toss.decision === 'bat') {
        battingFirst = tossWinnerId;
        bowlingFirst = tossWinnerId === teamAId ? teamBId : teamAId;
      } else {
        bowlingFirst = tossWinnerId;
        battingFirst = tossWinnerId === teamAId ? teamBId : teamAId;
      }
    }

    const oversPerInnings = rulesConfig.oversPerInnings || 15;
    const numberOfInnings = rulesConfig.numberOfInnings || 2;

    const innings = [];
    for (let i = 0; i < numberOfInnings; i++) {
      const teamId = i % 2 === 0 ? battingFirst : bowlingFirst;
      innings.push(this._createInningsObject(teamId));
    }

    return {
      battingTeam: battingFirst,
      bowlingTeam: bowlingFirst,
      innings,
      currentInnings: 0,
      target: null,
      currentBatter: 'opener_1',
      nonStriker: 'opener_2',
      currentBowler: 'bowler_1',
      freeHitNext: false,
      runRate: 0,
      requiredRate: null,
      oversPerInnings,
      isComplete: false,
      matchResult: null,
    };
  }

  // -------------------------------------------
  // processEvent
  // -------------------------------------------

  processEvent(match, event, rulesConfig) {
    const state = this._cloneState(match.currentState);
    const eventType = event.eventType || event.type;

    this._requireField({ eventType }, 'eventType', 'eventType');
    this._requireEnum(eventType, VALID_EVENT_TYPES, 'eventType');

    switch (eventType) {
      case EVENT_TYPES.BALL:
        return this._processBall(state, event, rulesConfig);
      case EVENT_TYPES.OVER_COMPLETE:
        return this._processOverComplete(state, event, rulesConfig);
      case EVENT_TYPES.INNINGS_BREAK:
        return this._processInningsBreak(state, event, rulesConfig);
      default:
        throw new BadRequestError(`Unhandled cricket event type: ${eventType}`);
    }
  }

  // -------------------------------------------
  // validateEvent
  // -------------------------------------------

  validateEvent(match, event, rulesConfig) {
    const state = match.currentState;
    const eventType = event.eventType || event.type;

    if (!state) {
      return { valid: false, reason: 'Match state is not initialized' };
    }

    if (state.isComplete) {
      return { valid: false, reason: 'Match is already complete' };
    }

    if (!VALID_EVENT_TYPES.includes(eventType)) {
      return {
        valid: false,
        reason: `Invalid event type: ${eventType}`,
      };
    }

    const innings = state.innings[state.currentInnings];
    if (!innings) {
      return { valid: false, reason: 'No active innings' };
    }

    if (eventType === EVENT_TYPES.BALL) {
      if (!state.currentBatter) {
        return { valid: false, reason: 'No batter at the crease. Set currentBatter first.' };
      }
      if (!state.currentBowler) {
        return { valid: false, reason: 'No bowler set. Set currentBowler first.' };
      }

      // Check if innings is already over (all out or overs done)
      const maxBalls = state.oversPerInnings * 6;
      if (innings.balls >= maxBalls) {
        return { valid: false, reason: 'Innings overs completed. Use innings_break.' };
      }

      if (innings.wickets >= 10) {
        return { valid: false, reason: 'All out. Use innings_break.' };
      }

      // Validate extras
      if (event.eventData && event.eventData.extras) {
        const extraType = event.eventData.extras.type;
        if (extraType && !VALID_EXTRA_TYPES.includes(extraType)) {
          return { valid: false, reason: `Invalid extras type: ${extraType}` };
        }
      }

      // Validate wicket
      if (event.eventData && event.eventData.isWicket) {
        const wicketType = event.eventData.wicketType;
        if (!wicketType) {
          return { valid: false, reason: 'wicketType is required when isWicket is true' };
        }
        if (!VALID_WICKET_TYPES.includes(wicketType)) {
          return { valid: false, reason: `Invalid wicket type: ${wicketType}` };
        }

        // Cannot take a wicket on a free hit (except run out)
        if (
          state.freeHitNext &&
          wicketType !== CRICKET_WICKET_TYPES.RUN_OUT
        ) {
          return {
            valid: false,
            reason: 'Only run-out dismissal is allowed on a free-hit delivery',
          };
        }

        // Fielder required for certain dismissals
        if (
          FIELDER_WICKETS.includes(wicketType) &&
          !(event.eventData.fielder)
        ) {
          return {
            valid: false,
            reason: `fielder is required for ${wicketType} dismissal`,
          };
        }
      }

      // Validate runs
      if (event.eventData) {
        const runs = event.eventData.runs;
        if (runs !== undefined && runs !== null) {
          if (!Number.isInteger(runs) || runs < 0 || runs > 7) {
            return { valid: false, reason: 'runs must be an integer between 0 and 7' };
          }
        }
      }
    }

    if (eventType === EVENT_TYPES.OVER_COMPLETE) {
      // Over complete only valid at the end of an over (6 legal balls)
      if (innings.ballsInCurrentOver < 6 && innings.balls > 0) {
        return {
          valid: false,
          reason: `Over is not complete yet. ${innings.ballsInCurrentOver || 0}/6 legal balls bowled.`,
        };
      }
    }

    if (eventType === EVENT_TYPES.INNINGS_BREAK) {
      if (state.currentInnings >= state.innings.length - 1) {
        return { valid: false, reason: 'No more innings remaining' };
      }
    }

    return { valid: true };
  }

  // -------------------------------------------
  // getPlayerStats
  // -------------------------------------------

  getPlayerStats(events) {
    const stats = {};
    const activeEvents = events.filter((e) => !e.isUndone);

    for (const evt of activeEvents) {
      const eventType = evt.eventType;
      const data = evt.eventData;

      if (eventType !== EVENT_TYPES.BALL || !data) continue;

      // --- Batting stats ---
      if (data.batter) {
        const batterId = data.batter.toString();
        if (!stats[batterId]) {
          stats[batterId] = this._emptyBattingStats(batterId);
        }
        const bs = stats[batterId].batting;

        const runs = data.runs || 0;
        const isLegalBall = !data.extras ||
          (data.extras.type !== CRICKET_EXTRAS.WIDE);

        // Runs off the bat (not byes or leg byes)
        const isExtrasNotBat =
          data.extras &&
          (data.extras.type === CRICKET_EXTRAS.BYE ||
           data.extras.type === CRICKET_EXTRAS.LEG_BYE);

        if (!isExtrasNotBat) {
          bs.runs += runs;
          if (runs === 4) bs.fours += 1;
          if (runs === 6) bs.sixes += 1;
        }

        // A wide does not count as a ball faced
        if (isLegalBall) {
          bs.balls += 1;
          if (runs === 0 && !data.isWicket) bs.dots += 1;
        }

        bs.strikeRate = bs.balls > 0
          ? parseFloat(((bs.runs / bs.balls) * 100).toFixed(2))
          : 0;

        // Dismissal
        if (data.isWicket && data.dismissedBatter) {
          const dismissedId = data.dismissedBatter.toString();
          if (!stats[dismissedId]) {
            stats[dismissedId] = this._emptyBattingStats(dismissedId);
          }
          stats[dismissedId].batting.howOut = data.wicketType;
          stats[dismissedId].batting.bowler = data.bowler
            ? data.bowler.toString()
            : null;
          stats[dismissedId].batting.fielder = data.fielder
            ? data.fielder.toString()
            : null;
        }
      }

      // --- Bowling stats ---
      if (data.bowler) {
        const bowlerId = data.bowler.toString();
        if (!stats[bowlerId]) {
          stats[bowlerId] = this._emptyBowlingStats(bowlerId);
        }
        const bw = stats[bowlerId].bowling;

        const isWide = data.extras && data.extras.type === CRICKET_EXTRAS.WIDE;
        const isNoBall = data.extras && data.extras.type === CRICKET_EXTRAS.NO_BALL;
        const isBye = data.extras && data.extras.type === CRICKET_EXTRAS.BYE;
        const isLegBye = data.extras && data.extras.type === CRICKET_EXTRAS.LEG_BYE;
        const extraRuns = (data.extras && data.extras.runs) || 0;
        const battingRuns = data.runs || 0;

        // Legal delivery?
        if (!isWide && !isNoBall) {
          bw.legalBalls += 1;
          bw.overs = ballsToOvers(bw.legalBalls);
        }

        // Runs conceded by bowler
        // - Byes and leg byes are NOT charged to the bowler
        // - Wides and no-balls + their extra runs ARE charged to the bowler
        if (isWide) {
          bw.wides += 1;
          bw.runs += 1 + extraRuns; // 1 for the wide + any additional runs
        } else if (isNoBall) {
          bw.noBalls += 1;
          bw.runs += 1 + battingRuns; // 1 for no-ball + runs scored off the bat
        } else if (isBye || isLegBye) {
          // Byes/leg byes: bowler gets dot credit (runs not charged)
          if (battingRuns === 0 && extraRuns === 0) {
            bw.dots += 1;
          }
        } else {
          bw.runs += battingRuns;
          if (battingRuns === 0) bw.dots += 1;
        }

        // Wicket credited to bowler
        if (
          data.isWicket &&
          data.wicketType &&
          !NON_BOWLER_WICKETS.includes(data.wicketType)
        ) {
          bw.wickets += 1;
        }

        bw.economy = bw.legalBalls > 0
          ? parseFloat(((bw.runs / (bw.legalBalls / 6)) ).toFixed(2))
          : 0;
      }
    }

    return stats;
  }

  // -------------------------------------------
  // isMatchComplete
  // -------------------------------------------

  isMatchComplete(state, rulesConfig) {
    if (!state || !state.innings) return false;
    if (state.isComplete) return true;

    const totalInnings = state.innings.length;

    // All innings completed
    if (state.currentInnings >= totalInnings) return true;

    // Check if the chasing team has reached the target
    if (state.target !== null && state.currentInnings >= 1) {
      const chasingInnings = state.innings[state.currentInnings];
      if (chasingInnings && chasingInnings.score >= state.target) {
        return true;
      }
    }

    // Check if the last innings is done (all out or overs complete)
    if (state.currentInnings === totalInnings - 1) {
      const lastInnings = state.innings[state.currentInnings];
      if (!lastInnings) return false;

      const maxBalls = (rulesConfig.oversPerInnings || state.oversPerInnings) * 6;
      if (lastInnings.wickets >= 10 || lastInnings.balls >= maxBalls) {
        return true;
      }
    }

    return false;
  }

  // =============================================
  // Private: Ball processing
  // =============================================

  _processBall(state, event, rulesConfig) {
    const data = event.eventData || event;
    const innings = state.innings[state.currentInnings];

    this._assert(innings, 'No active innings to process ball');
    this._assert(state.currentBatter, 'currentBatter is required');
    this._assert(state.currentBowler, 'currentBowler is required');

    const runs = data.runs || 0;
    const extras = data.extras || null;
    const isWicket = !!data.isWicket;

    const isWide = extras && extras.type === CRICKET_EXTRAS.WIDE;
    const isNoBall = extras && extras.type === CRICKET_EXTRAS.NO_BALL;
    const isBye = extras && extras.type === CRICKET_EXTRAS.BYE;
    const isLegBye = extras && extras.type === CRICKET_EXTRAS.LEG_BYE;
    const extraRuns = (extras && extras.runs) || 0;

    const isLegalDelivery = !isWide && !isNoBall;

    // -- Update score --
    let totalRunsThisBall = 0;

    if (isWide) {
      innings.extras.wides += 1 + extraRuns;
      totalRunsThisBall = 1 + extraRuns;
    } else if (isNoBall) {
      innings.extras.noBalls += 1;
      totalRunsThisBall = 1 + runs; // 1 penalty + runs scored off the bat
    } else if (isBye) {
      innings.extras.byes += extraRuns;
      totalRunsThisBall = extraRuns;
    } else if (isLegBye) {
      innings.extras.legByes += extraRuns;
      totalRunsThisBall = extraRuns;
    } else {
      // Normal delivery or boundary
      totalRunsThisBall = runs;
    }

    innings.score += totalRunsThisBall;

    // -- Legal ball counting --
    if (isLegalDelivery) {
      innings.balls += 1;
      innings.ballsInCurrentOver = (innings.ballsInCurrentOver || 0) + 1;
    }

    // -- Update lastSixBalls --
    const ballDescription = this._describeBall(runs, extras, isWicket, data.wicketType);
    innings.lastSixBalls.push(ballDescription);
    if (innings.lastSixBalls.length > 6) {
      innings.lastSixBalls.shift();
    }

    // -- Update overs display --
    innings.overs = ballsToOvers(innings.balls);

    // -- Free hit determination --
    const wasFreeHit = state.freeHitNext;
    if (isNoBall && rulesConfig.freeHit !== false) {
      state.freeHitNext = true;
    } else if (isLegalDelivery) {
      state.freeHitNext = false;
    }
    // If wide, freeHit carries forward (no change)

    // -- Batter stats inline --
    this._updateBatterInInnings(innings, state.currentBatter, data, isLegalDelivery, isWide, isNoBall, isBye, isLegBye, runs, extraRuns);

    // -- Bowler stats inline --
    this._updateBowlerInInnings(innings, state.currentBowler, data, isLegalDelivery, isWide, isNoBall, isBye, isLegBye, runs, extraRuns, isWicket);

    // -- Wicket handling --
    let isInningsComplete = false;
    if (isWicket) {
      // On a free hit, only run-out is valid (already validated)
      const wicketType = data.wicketType;
      const dismissedBatter = data.dismissedBatter
        ? data.dismissedBatter.toString()
        : state.currentBatter;

      innings.wickets += 1;

      // Record fall of wicket
      innings.fallOfWickets.push({
        wicketNumber: innings.wickets,
        score: innings.score,
        overs: innings.overs,
        batterId: dismissedBatter,
        howOut: wicketType,
        bowlerId: data.bowler
          ? data.bowler.toString()
          : state.currentBowler,
        fielderId: data.fielder
          ? data.fielder.toString()
          : null,
      });

      // Mark batter as out
      const outBatterEntry = innings.batters.find(
        (b) => b.playerId === dismissedBatter
      );
      if (outBatterEntry) {
        outBatterEntry.howOut = wicketType;
        outBatterEntry.bowler = data.bowler
          ? data.bowler.toString()
          : state.currentBowler;
        outBatterEntry.fielder = data.fielder
          ? data.fielder.toString()
          : null;
      }

      // End current partnership
      this._endPartnership(innings, innings.score);

      // All out check
      if (innings.wickets >= 10) {
        isInningsComplete = true;
      }

      // Clear the dismissed batter from the crease
      if (dismissedBatter === state.currentBatter) {
        state.currentBatter = null;
      } else if (dismissedBatter === state.nonStriker) {
        state.nonStriker = null;
      }
    }

    // -- Strike rotation --
    // Odd runs: swap striker and non-striker
    const totalRunsForRotation = isWide || isNoBall ? runs + extraRuns : runs;
    // Byes/leg byes: the extra runs determine rotation
    const rotationRuns = (isBye || isLegBye) ? extraRuns : totalRunsForRotation;

    if (rotationRuns % 2 !== 0 && !isWicket) {
      this._swapBatters(state);
    }

    // -- Over complete auto-check --
    const maxBalls = (rulesConfig.oversPerInnings || state.oversPerInnings) * 6;

    if (innings.ballsInCurrentOver >= 6 && isLegalDelivery) {
      // Over is complete — swap batters at end of over
      this._swapBatters(state);
      innings.ballsInCurrentOver = 0;

      // Check for maiden over
      // (A maiden is an over with 0 runs off the bowler — extras via byes don't count)
      // We'll track this at over_complete event for accuracy
    }

    // Overs exhausted
    if (innings.balls >= maxBalls) {
      isInningsComplete = true;
    }

    // -- Run rate --
    innings.runRate = innings.balls > 0
      ? parseFloat((innings.score / (innings.balls / 6)).toFixed(2))
      : 0;
    state.runRate = innings.runRate;

    // -- Required rate (chase innings) --
    if (state.target !== null && state.currentInnings >= 1) {
      const runsNeeded = state.target - innings.score;
      const ballsRemaining = maxBalls - innings.balls;
      state.requiredRate = ballsRemaining > 0
        ? parseFloat((runsNeeded / (ballsRemaining / 6)).toFixed(2))
        : null;

      // Target reached
      if (innings.score >= state.target) {
        isInningsComplete = true;
        state.isComplete = true;
        state.matchResult = this._buildMatchResult(state, rulesConfig);
      }
    }

    // If innings is complete for non-chase reasons
    if (isInningsComplete && !state.isComplete) {
      // Check if this was the last innings
      if (state.currentInnings >= state.innings.length - 1) {
        state.isComplete = true;
        state.matchResult = this._buildMatchResult(state, rulesConfig);
      }
    }

    return {
      state,
      meta: {
        isMatchComplete: state.isComplete,
        isInningsComplete,
        totalRunsThisBall,
        wasFreeHit,
        freeHitNext: state.freeHitNext,
      },
    };
  }

  // =============================================
  // Private: Over complete
  // =============================================

  _processOverComplete(state, event, rulesConfig) {
    const innings = state.innings[state.currentInnings];
    this._assert(innings, 'No active innings');

    const data = event.eventData || event;

    // Record maiden if applicable
    if (data.isMaiden) {
      const bowlerEntry = innings.bowlers.find(
        (b) => b.playerId === state.currentBowler
      );
      if (bowlerEntry) {
        bowlerEntry.maidens = (bowlerEntry.maidens || 0) + 1;
      }
    }

    // Set new bowler if provided
    if (data.newBowler) {
      // Validate bowler hasn't exceeded max overs
      const maxOversPerBowler = rulesConfig.maxOversPerBowler || Math.ceil(state.oversPerInnings / 5);
      const newBowlerId = data.newBowler.toString();

      const existingBowler = innings.bowlers.find(
        (b) => b.playerId === newBowlerId
      );
      if (existingBowler) {
        const bowlerOvers = existingBowler.legalBalls
          ? Math.floor(existingBowler.legalBalls / 6)
          : 0;
        if (bowlerOvers >= maxOversPerBowler) {
          throw new BadRequestError(
            `Bowler has already bowled maximum ${maxOversPerBowler} overs`
          );
        }
      }

      state.currentBowler = newBowlerId;
    }

    // Reset balls in current over
    innings.ballsInCurrentOver = 0;

    return {
      state,
      meta: {
        isMatchComplete: false,
        isInningsComplete: false,
      },
    };
  }

  // =============================================
  // Private: Innings break
  // =============================================

  _processInningsBreak(state, event, rulesConfig) {
    const completedInningsIndex = state.currentInnings;
    const completedInnings = state.innings[completedInningsIndex];

    this._assert(
      completedInningsIndex < state.innings.length - 1,
      'No more innings remaining'
    );

    // End any active partnership
    this._endPartnership(completedInnings, completedInnings.score);

    // Set target for chasing team
    state.target = completedInnings.score + 1;

    // Move to next innings
    state.currentInnings += 1;
    const nextInnings = state.innings[state.currentInnings];

    // Swap batting/bowling teams
    const prevBatting = state.battingTeam;
    state.battingTeam = state.bowlingTeam;
    state.bowlingTeam = prevBatting;

    // Reset crease
    state.currentBatter = null;
    state.nonStriker = null;
    state.currentBowler = null;
    state.freeHitNext = false;
    state.runRate = 0;

    // Calculate required rate
    const maxBalls = (rulesConfig.oversPerInnings || state.oversPerInnings) * 6;
    state.requiredRate = maxBalls > 0
      ? parseFloat((state.target / (maxBalls / 6)).toFixed(2))
      : null;

    return {
      state,
      meta: {
        isMatchComplete: false,
        isInningsComplete: false,
        target: state.target,
        chasingTeam: state.battingTeam,
      },
    };
  }

  // =============================================
  // Private: Inline batter/bowler stat helpers
  // =============================================

  _updateBatterInInnings(innings, batterId, data, isLegal, isWide, isNoBall, isBye, isLegBye, runs, extraRuns) {
    let entry = innings.batters.find((b) => b.playerId === batterId);
    if (!entry) {
      entry = {
        playerId: batterId,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        dots: 0,
        strikeRate: 0,
        howOut: null,
        bowler: null,
        fielder: null,
      };
      innings.batters.push(entry);

      // Start new partnership
      this._startPartnership(innings, batterId);
    }

    // Wide does not count as a ball faced
    if (!isWide) {
      if (isLegal) entry.balls += 1;
      // No-ball: batter faces the ball (counts in balls faced for stats)
      if (isNoBall) entry.balls += 1;
    }

    // Runs off the bat (not byes/leg byes, those don't go to batter)
    if (!isBye && !isLegBye) {
      entry.runs += runs;
      if (runs === 4) entry.fours += 1;
      if (runs === 6) entry.sixes += 1;
      if (runs === 0 && !isWide && !isNoBall && !data.isWicket) entry.dots += 1;
    }

    entry.strikeRate = entry.balls > 0
      ? parseFloat(((entry.runs / entry.balls) * 100).toFixed(2))
      : 0;
  }

  _updateBowlerInInnings(innings, bowlerId, data, isLegal, isWide, isNoBall, isBye, isLegBye, runs, extraRuns, isWicket) {
    let entry = innings.bowlers.find((b) => b.playerId === bowlerId);
    if (!entry) {
      entry = {
        playerId: bowlerId,
        overs: 0,
        legalBalls: 0,
        maidens: 0,
        runs: 0,
        wickets: 0,
        economy: 0,
        dots: 0,
        wides: 0,
        noBalls: 0,
      };
      innings.bowlers.push(entry);
    }

    if (isLegal) {
      entry.legalBalls += 1;
      entry.overs = ballsToOvers(entry.legalBalls);
    }

    // Runs conceded
    if (isWide) {
      entry.wides += 1;
      entry.runs += 1 + extraRuns;
    } else if (isNoBall) {
      entry.noBalls += 1;
      entry.runs += 1 + runs;
    } else if (isBye || isLegBye) {
      // Byes/leg byes not charged to bowler
      if (runs === 0 && extraRuns === 0) entry.dots += 1;
    } else {
      entry.runs += runs;
      if (runs === 0 && !isWicket) entry.dots += 1;
    }

    // Wicket credited
    if (
      isWicket &&
      data.wicketType &&
      !NON_BOWLER_WICKETS.includes(data.wicketType)
    ) {
      entry.wickets += 1;
    }

    entry.economy = entry.legalBalls > 0
      ? parseFloat((entry.runs / (entry.legalBalls / 6)).toFixed(2))
      : 0;
  }

  // =============================================
  // Private: Partnership tracking
  // =============================================

  _startPartnership(innings, newBatterId) {
    const activeBatters = innings.batters.filter((b) => b.howOut === null);
    if (activeBatters.length >= 2) {
      // There's already an active partnership
      const existing = innings.partnerships[innings.partnerships.length - 1];
      if (existing && !existing.isActive) {
        innings.partnerships.push({
          batter1: activeBatters[0].playerId,
          batter2: activeBatters[1].playerId,
          runs: 0,
          balls: 0,
          startScore: innings.score,
          isActive: true,
        });
      }
    }
  }

  _endPartnership(innings, currentScore) {
    const active = innings.partnerships.find((p) => p.isActive);
    if (active) {
      active.runs = currentScore - active.startScore;
      active.isActive = false;
    }
  }

  // =============================================
  // Private: Utility
  // =============================================

  _createInningsObject(teamId) {
    return {
      teamId,
      score: 0,
      wickets: 0,
      overs: 0,
      balls: 0,
      ballsInCurrentOver: 0,
      extras: {
        wides: 0,
        noBalls: 0,
        byes: 0,
        legByes: 0,
      },
      batters: [],
      bowlers: [],
      fallOfWickets: [],
      partnerships: [],
      lastSixBalls: [],
      runRate: 0,
    };
  }

  _swapBatters(state) {
    const temp = state.currentBatter;
    state.currentBatter = state.nonStriker;
    state.nonStriker = temp;
  }

  _describeBall(runs, extras, isWicket, wicketType) {
    if (isWicket) return 'W';
    if (extras) {
      if (extras.type === CRICKET_EXTRAS.WIDE) return `Wd${extras.runs || ''}`;
      if (extras.type === CRICKET_EXTRAS.NO_BALL) return `Nb`;
      if (extras.type === CRICKET_EXTRAS.BYE) return `B${extras.runs || ''}`;
      if (extras.type === CRICKET_EXTRAS.LEG_BYE) return `Lb${extras.runs || ''}`;
    }
    if (runs === 0) return '.';
    return String(runs);
  }

  _buildMatchResult(state, rulesConfig) {
    const innings = state.innings;
    if (innings.length < 2) return null;

    const first = innings[0];
    const second = innings[1];

    // Chasing team won
    if (second.score >= state.target) {
      const wicketsRemaining = 10 - second.wickets;
      return {
        winnerId: second.teamId,
        loserId: first.teamId,
        margin: `${wicketsRemaining} wicket${wicketsRemaining !== 1 ? 's' : ''}`,
        resultType: 'normal',
      };
    }

    // Batting first team won (chasing team all out or overs exhausted)
    if (first.score > second.score) {
      const runDiff = first.score - second.score;
      return {
        winnerId: first.teamId,
        loserId: second.teamId,
        margin: `${runDiff} run${runDiff !== 1 ? 's' : ''}`,
        resultType: 'normal',
      };
    }

    // Tie
    if (first.score === second.score) {
      return {
        winnerId: null,
        loserId: null,
        margin: null,
        resultType: 'tie',
      };
    }

    return null;
  }

  _emptyBattingStats(playerId) {
    return {
      playerId,
      batting: {
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        dots: 0,
        strikeRate: 0,
        howOut: null,
        bowler: null,
        fielder: null,
      },
    };
  }

  _emptyBowlingStats(playerId) {
    return {
      playerId,
      bowling: {
        overs: 0,
        legalBalls: 0,
        maidens: 0,
        runs: 0,
        wickets: 0,
        economy: 0,
        dots: 0,
        wides: 0,
        noBalls: 0,
      },
    };
  }
}

module.exports = CricketScoringEngine;

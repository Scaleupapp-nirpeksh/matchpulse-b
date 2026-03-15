const env = require('../config/env');
const { SPORTS } = require('../utils/constants');

let anthropicClient = null;

const getAnthropicClient = () => {
  if (!anthropicClient && env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
};

class AIService {
  /**
   * Generate live commentary for a scoring event
   * Returns a single sentence in broadcast style
   */
  async generateCommentary(event, matchContext) {
    const client = getAnthropicClient();
    if (!client) {
      return this.fallbackCommentary(event, matchContext);
    }

    try {
      const prompt = this.buildCommentaryPrompt(event, matchContext);

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        system: `You are a live sports commentator for MatchPulse. Generate exactly ONE sentence of exciting, professional broadcast commentary for the event described. Match the tone to the sport — cricket should sound like cricket commentary, basketball like NBA coverage, etc. Be concise, energetic, and reference players by name when available. Never exceed 2 sentences.`,
      });

      return response.content[0]?.text?.trim() || this.fallbackCommentary(event, matchContext);
    } catch (error) {
      console.error('❌ AI commentary error:', error.message);
      return this.fallbackCommentary(event, matchContext);
    }
  }

  /**
   * Generate post-match summary and insights
   * Returns a structured object with summary, insights, key moments
   */
  async generateMatchSummary(match, events, playerStats) {
    const client = getAnthropicClient();

    // Always generate insights — use AI if available, fallback otherwise
    if (!client) {
      return this.fallbackMatchInsights(match, events, playerStats);
    }

    try {
      const prompt = this.buildSummaryPrompt(match, events, playerStats);

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        system: `You are a sports analytics journalist writing a post-match report for MatchPulse.
Return a JSON object with these fields:
- "narrative": A 3-4 paragraph match summary covering the result, key moments, standout performers, and turning points.
- "keyMoments": An array of 3-5 strings describing the most important moments.
- "insights": An array of 3-5 analytical observations about the match (tactical, statistical, momentum shifts).
- "motmReason": A one-sentence reason for Man of the Match selection (if applicable).

Be factual and professional. Reference actual scores, player names, and statistics from the data provided.
Return ONLY valid JSON, no markdown formatting.`,
      });

      const text = response.content[0]?.text?.trim();
      if (!text) return this.fallbackMatchInsights(match, events, playerStats);

      try {
        // Try to parse as JSON
        const parsed = JSON.parse(text);
        return parsed;
      } catch {
        // If not JSON, return as narrative string (backwards compatible)
        return {
          narrative: text,
          ...this.fallbackMatchInsights(match, events, playerStats),
          narrative: text, // Override narrative with AI version
        };
      }
    } catch (error) {
      console.error('❌ AI match summary error:', error.message);
      return this.fallbackMatchInsights(match, events, playerStats);
    }
  }

  /**
   * Generate insights for a completed match (always available, no AI needed)
   */
  generateMatchInsights(match, events, playerStats) {
    return this.fallbackMatchInsights(match, events, playerStats);
  }

  /**
   * Evaluate if an event is notification-worthy
   */
  async evaluateNotificationWorthiness(event, matchContext) {
    // Use rule-based logic for speed, not AI (per PRD — smart notifications evaluate importance)
    const sport = matchContext.sportType;
    const eventType = event.eventType;
    const eventData = event.eventData || {};

    switch (sport) {
      case SPORTS.CRICKET:
        return this.isCricketNotifiable(eventType, eventData, matchContext);
      case SPORTS.FOOTBALL:
        return this.isFootballNotifiable(eventType, eventData);
      case SPORTS.BASKETBALL_5V5:
      case SPORTS.BASKETBALL_3X3:
        return this.isBasketballNotifiable(eventType, eventData, matchContext);
      case SPORTS.VOLLEYBALL:
      case SPORTS.TENNIS:
      case SPORTS.TABLE_TENNIS:
      case SPORTS.BADMINTON:
      case SPORTS.SQUASH:
        return this.isRallySportNotifiable(eventType, eventData, matchContext);
      default:
        return false;
    }
  }

  /**
   * Calculate win probability (algorithmic, not AI)
   */
  calculateWinProbability(matchState, sportType, rulesConfig) {
    switch (sportType) {
      case SPORTS.CRICKET:
        return this.cricketWinProb(matchState, rulesConfig);
      case SPORTS.BASKETBALL_5V5:
      case SPORTS.BASKETBALL_3X3:
        return this.basketballWinProb(matchState, rulesConfig);
      case SPORTS.FOOTBALL:
        return this.footballWinProb(matchState, rulesConfig);
      case SPORTS.VOLLEYBALL:
        return this.volleyballWinProb(matchState, rulesConfig);
      case SPORTS.TENNIS:
        return this.tennisWinProb(matchState, rulesConfig);
      case SPORTS.TABLE_TENNIS:
        return this.tableTennisWinProb(matchState, rulesConfig);
      case SPORTS.BADMINTON:
        return this.badmintonWinProb(matchState, rulesConfig);
      case SPORTS.SQUASH:
        return this.squashWinProb(matchState, rulesConfig);
      default:
        return this.genericWinProb(matchState);
    }
  }

  // --- Win Probability Algorithms ---

  cricketWinProb(state, rules) {
    if (!state || !state.target) return { a: 50, b: 50 };

    const runsNeeded = state.target - (state.score || 0);
    const wicketsLeft = 10 - (state.wickets || 0);
    const oversLeft = (rules.oversPerInnings || 20) - (state.overs || 0);

    // Simple model: batting team probability based on required rate vs resources
    const requiredRate = runsNeeded / Math.max(0.1, oversLeft);
    const currentRate = state.runRate || 6;
    const resourceFactor = wicketsLeft / 10;
    const rateFactor = Math.min(2, currentRate / Math.max(1, requiredRate));

    let battingProb = Math.min(95, Math.max(5, 50 * rateFactor * resourceFactor));

    // If batting team is Team B (chasing)
    return {
      a: Math.round(100 - battingProb),
      b: Math.round(battingProb),
    };
  }

  basketballWinProb(state, rules) {
    if (!state) return { a: 50, b: 50 };

    const diff = (state.scoreA || 0) - (state.scoreB || 0);
    const totalTime = (rules.quarterLength || 10) * (rules.numberOfQuarters || 4) * 60;
    const elapsed = totalTime - (state.clockSeconds || 0);
    const timeProgress = Math.min(1, elapsed / totalTime);

    // Larger leads matter more as time decreases
    const leadImpact = diff * (1 + timeProgress * 2);
    const probA = 50 + Math.max(-45, Math.min(45, leadImpact));

    return {
      a: Math.round(probA),
      b: Math.round(100 - probA),
    };
  }

  footballWinProb(state, rules) {
    if (!state) return { a: 50, b: 50 };

    const diff = (state.scoreA || 0) - (state.scoreB || 0);
    const totalTime = (rules.halfLength || 45) * 2;
    const elapsed = state.clockSeconds ? state.clockSeconds / 60 : 0;
    const timeProgress = Math.min(1, elapsed / totalTime);

    const leadImpact = diff * 15 * (1 + timeProgress);
    const probA = 50 + Math.max(-45, Math.min(45, leadImpact));

    return {
      a: Math.round(probA),
      b: Math.round(100 - probA),
    };
  }

  volleyballWinProb(state, rules) {
    if (!state) return { a: 50, b: 50 };
    const setsA = state.setsWonA || 0;
    const setsB = state.setsWonB || 0;
    const setsToWin = Math.ceil((rules.setsToWin || 3) / 2) + 1 || 2;
    const ptsA = state.scoreA || 0;
    const ptsB = state.scoreB || 0;

    // Set advantage weighted heavily
    const setAdv = (setsA - setsB) * 25;
    const ptAdv = Math.max(-10, Math.min(10, (ptsA - ptsB) * 2));
    const probA = 50 + Math.max(-45, Math.min(45, setAdv + ptAdv));
    return { a: Math.round(probA), b: Math.round(100 - probA) };
  }

  tennisWinProb(state, rules) {
    if (!state) return { a: 50, b: 50 };
    const setsA = state.setsWonA || 0;
    const setsB = state.setsWonB || 0;
    const gamesA = state.gamesWonA || 0;
    const gamesB = state.gamesWonB || 0;

    const setAdv = (setsA - setsB) * 30;
    const gameAdv = Math.max(-10, Math.min(10, (gamesA - gamesB) * 3));
    const probA = 50 + Math.max(-45, Math.min(45, setAdv + gameAdv));
    return { a: Math.round(probA), b: Math.round(100 - probA) };
  }

  tableTennisWinProb(state, rules) {
    if (!state) return { a: 50, b: 50 };
    const setsA = state.setsWonA || 0;
    const setsB = state.setsWonB || 0;
    const ptsA = state.scoreA || 0;
    const ptsB = state.scoreB || 0;

    const setAdv = (setsA - setsB) * 20;
    const ptAdv = Math.max(-15, Math.min(15, (ptsA - ptsB) * 3));
    const probA = 50 + Math.max(-45, Math.min(45, setAdv + ptAdv));
    return { a: Math.round(probA), b: Math.round(100 - probA) };
  }

  badmintonWinProb(state, rules) {
    if (!state) return { a: 50, b: 50 };
    const setsA = state.setsWonA || state.gamesWonA || 0;
    const setsB = state.setsWonB || state.gamesWonB || 0;
    const ptsA = state.scoreA || 0;
    const ptsB = state.scoreB || 0;

    const setAdv = (setsA - setsB) * 25;
    const ptAdv = Math.max(-10, Math.min(10, (ptsA - ptsB) * 2));
    const probA = 50 + Math.max(-45, Math.min(45, setAdv + ptAdv));
    return { a: Math.round(probA), b: Math.round(100 - probA) };
  }

  squashWinProb(state, rules) {
    if (!state) return { a: 50, b: 50 };
    const setsA = state.setsWonA || state.gamesWonA || 0;
    const setsB = state.setsWonB || state.gamesWonB || 0;
    const ptsA = state.scoreA || 0;
    const ptsB = state.scoreB || 0;

    const setAdv = (setsA - setsB) * 22;
    const ptAdv = Math.max(-12, Math.min(12, (ptsA - ptsB) * 2.5));
    const probA = 50 + Math.max(-45, Math.min(45, setAdv + ptAdv));
    return { a: Math.round(probA), b: Math.round(100 - probA) };
  }

  genericWinProb(state) {
    if (!state) return { a: 50, b: 50 };
    const scoreA = state.scoreA || 0;
    const scoreB = state.scoreB || 0;
    const total = scoreA + scoreB || 1;
    return {
      a: Math.round((scoreA / total) * 100) || 50,
      b: Math.round((scoreB / total) * 100) || 50,
    };
  }

  // --- Notification Worthiness ---

  isCricketNotifiable(eventType, data, context) {
    if (eventType === 'wicket') return true;
    if (eventType === 'ball' && data.isWicket) return true;
    if (eventType === 'ball' && data.runs === 6) return true;
    if (eventType === 'ball' && data.runs === 4 && context.currentState?.overs >= (context.rulesConfig?.oversPerInnings || 20) - 2) return true;
    // Milestones: 50, 100 runs
    const score = context.currentState?.score || 0;
    if (score > 0 && (score % 50 === 0)) return true;
    return false;
  }

  isFootballNotifiable(eventType, data) {
    if (eventType === 'goal') return true;
    if (eventType === 'card' && data.cardType === 'red') return true;
    return false;
  }

  isBasketballNotifiable(eventType, data, context) {
    if (eventType === 'shot_made' && data.shotType === '3pt') {
      // Lead changes
      const diff = Math.abs((context.currentState?.scoreA || 0) - (context.currentState?.scoreB || 0));
      if (diff <= 3) return true;
    }
    // Significant runs (8+ unanswered points)
    return false;
  }

  isRallySportNotifiable(eventType, data, context) {
    if (eventType === 'set_end' || eventType === 'game_end') return true;
    return false;
  }

  // --- Prompt Builders ---

  buildCommentaryPrompt(event, context) {
    const sport = context.sportType;
    const state = context.currentState || {};
    const data = event.eventData || {};
    const teamA = context.teamAName || 'Team A';
    const teamB = context.teamBName || 'Team B';

    const sportContext = this.getSportCommentaryContext(sport, state);

    return `Sport: ${sport}
Event: ${event.eventType}
Event Data: ${JSON.stringify(data)}
Match State: ${sportContext}
Teams: ${teamA} vs ${teamB}

Generate one sentence of live commentary for this event.`;
  }

  getSportCommentaryContext(sport, state) {
    switch (sport) {
      case SPORTS.CRICKET: {
        const inn = state.innings?.[state.currentInnings || 0] || {};
        return `Score: ${inn.score || 0}/${inn.wickets || 0} (${inn.overs || 0} overs), Run Rate: ${inn.runRate?.toFixed(2) || '0.00'}`;
      }
      case SPORTS.FOOTBALL:
        return `Score: ${state.scoreA || 0}-${state.scoreB || 0}, Half: ${state.currentHalf || 1}`;
      case SPORTS.BASKETBALL_5V5:
        return `Score: ${state.scoreA || 0}-${state.scoreB || 0}, Quarter: ${state.currentQuarter || 1}`;
      case SPORTS.BASKETBALL_3X3:
        return `Score: ${state.scoreA || 0}-${state.scoreB || 0}`;
      case SPORTS.VOLLEYBALL:
        return `Sets: ${state.setsWonA || 0}-${state.setsWonB || 0}, Current Set: ${state.scoreA || 0}-${state.scoreB || 0}`;
      case SPORTS.TENNIS:
        return `Sets: ${state.setsWonA || 0}-${state.setsWonB || 0}, Games: ${state.gamesWonA || 0}-${state.gamesWonB || 0}, Points: ${state.pointsA || 0}-${state.pointsB || 0}`;
      case SPORTS.TABLE_TENNIS:
        return `Sets: ${state.setsWonA || 0}-${state.setsWonB || 0}, Current Set: ${state.scoreA || 0}-${state.scoreB || 0}`;
      case SPORTS.BADMINTON:
        return `Games: ${state.gamesWonA || state.setsWonA || 0}-${state.gamesWonB || state.setsWonB || 0}, Rally: ${state.scoreA || 0}-${state.scoreB || 0}`;
      case SPORTS.SQUASH:
        return `Games: ${state.gamesWonA || state.setsWonA || 0}-${state.gamesWonB || state.setsWonB || 0}, Rally: ${state.scoreA || 0}-${state.scoreB || 0}`;
      default:
        return JSON.stringify(state);
    }
  }

  buildSummaryPrompt(match, events, playerStats) {
    const activeEvents = events.filter((e) => !e.isUndone).slice(-200); // Last 200 events

    return `Sport: ${match.sportType}
Teams: Team A vs Team B
Final State: ${JSON.stringify(match.currentState)}
Result: ${JSON.stringify(match.resultSummary)}
Key Events (last ${activeEvents.length}): ${JSON.stringify(activeEvents.map((e) => ({
      type: e.eventType,
      data: e.eventData,
      seq: e.sequenceNumber,
    })))}
Player Stats: ${JSON.stringify(playerStats?.slice(0, 20))}

Write a 3-4 paragraph post-match summary covering result, key moments, standout performers, and turning points.`;
  }

  /**
   * Fallback commentary when AI is unavailable — full coverage for all 9 sports
   */
  fallbackCommentary(event, context) {
    const sport = context.sportType;
    const type = event.eventType;
    const data = event.eventData || {};
    const teamA = context.teamAName || 'Team A';
    const teamB = context.teamBName || 'Team B';
    const scoringTeam = data.team === 'b' ? teamB : teamA;

    switch (sport) {
      case SPORTS.CRICKET:
        return this.cricketCommentary(type, data, context);
      case SPORTS.FOOTBALL:
        return this.footballCommentary(type, data, scoringTeam, context);
      case SPORTS.BASKETBALL_5V5:
        return this.basketball5v5Commentary(type, data, scoringTeam, context);
      case SPORTS.BASKETBALL_3X3:
        return this.basketball3x3Commentary(type, data, scoringTeam, context);
      case SPORTS.VOLLEYBALL:
        return this.volleyballCommentary(type, data, scoringTeam, context);
      case SPORTS.TENNIS:
        return this.tennisCommentary(type, data, scoringTeam, context);
      case SPORTS.TABLE_TENNIS:
        return this.tableTennisCommentary(type, data, scoringTeam, context);
      case SPORTS.BADMINTON:
        return this.badmintonCommentary(type, data, scoringTeam, context);
      case SPORTS.SQUASH:
        return this.squashCommentary(type, data, scoringTeam, context);
      default:
        return `Action on the field! The game continues.`;
    }
  }

  // --- Sport-Specific Fallback Commentary ---

  cricketCommentary(type, data, context) {
    if (type === 'ball' && data.isWicket) {
      const wicketTypes = {
        bowled: 'BOWLED! The stumps are shattered — what a delivery!',
        caught: 'CAUGHT! Taken cleanly, the batter has to walk back.',
        lbw: 'OUT! LBW — the umpire raises the finger without hesitation.',
        run_out: 'RUN OUT! Brilliant fielding and the batter is short of the crease.',
        stumped: 'STUMPED! Lightning-quick work behind the stumps.',
      };
      return wicketTypes[data.wicketType] || 'WICKET! That\'s a big breakthrough for the bowling side.';
    }
    if (type === 'ball' && data.runs === 6) return 'SIX! That\'s been smashed into the stands! Maximum!';
    if (type === 'ball' && data.runs === 4) return 'FOUR! Beautifully timed shot races to the boundary.';
    if (type === 'ball' && data.runs === 0) return 'Dot ball. Tight bowling, no run conceded.';
    if (type === 'ball' && data.runs === 1) return 'Quick single taken, good running between the wickets.';
    if (type === 'ball' && data.runs === 2) return 'Two runs, nicely placed into the gap.';
    if (type === 'ball' && data.runs === 3) return 'Three runs! Excellent running, they come back for the third.';
    if (type === 'over_complete') return 'End of the over. Time for a bowling change.';
    if (type === 'innings_break') return 'Innings break! The teams switch roles.';
    if (type === 'ball') return `${data.runs || 0} run${(data.runs || 0) !== 1 ? 's' : ''} scored off this delivery.`;
    return 'Play continues in this cricket match.';
  }

  footballCommentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    if (type === 'goal') {
      const scorer = data.scorer || 'a player';
      const minute = data.minute ? `(${data.minute}')` : '';
      const score = `${state.scoreA || 0}-${state.scoreB || 0}`;
      return `GOAL! ${scoringTeam} scores through ${scorer} ${minute}! It's ${score} now.`;
    }
    if (type === 'card') {
      const cardType = data.cardType === 'red' ? 'RED CARD' : 'Yellow card';
      return `${cardType} shown to ${data.player || 'a player'} from ${scoringTeam}! ${data.cardType === 'red' ? 'They\'re off!' : 'A cautionary booking.'}`;
    }
    if (type === 'half_start') return `Kick-off! The ${data.half === 2 ? 'second' : 'first'} half is underway.`;
    if (type === 'half_end') return `The referee blows for half-time. Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
    if (type === 'substitution') return `Substitution for ${scoringTeam}. Tactical change from the manager.`;
    if (type === 'penalty') return `PENALTY! A spot kick awarded. The tension is palpable.`;
    if (type === 'corner') return `Corner kick to ${scoringTeam}. An opportunity to attack.`;
    if (type === 'free_kick') return `Free kick awarded. ${scoringTeam} set up the delivery.`;
    return `Play continues. Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
  }

  basketball5v5Commentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    if (type === 'shot_made') {
      const pts = data.shotType === '3pt' ? 'THREE' : data.shotType === 'ft' ? 'free throw' : 'two';
      if (data.shotType === '3pt') return `SPLASH! ${scoringTeam} drains a three-pointer! Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
      if (data.shotType === 'ft') return `Free throw good for ${scoringTeam}. Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
      return `Bucket! ${scoringTeam} scores inside. Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
    }
    if (type === 'shot_missed') return `Shot missed by ${scoringTeam}. The rebound is contested.`;
    if (type === 'foul') {
      if (data.foulType === 'technical') return `Technical foul called! That's going to cost ${scoringTeam}.`;
      if (data.foulType === 'flagrant') return `Flagrant foul! That's a serious infraction.`;
      return `Foul called on ${scoringTeam}. ${data.player || 'A player'} picked up the whistle.`;
    }
    if (type === 'turnover') return `Turnover by ${scoringTeam}! Possession changes hands.`;
    if (type === 'steal') return `Steal! Great defensive play by ${scoringTeam}!`;
    if (type === 'block') return `BLOCKED! Emphatic rejection at the rim!`;
    if (type === 'rebound') return `Rebound grabbed by ${scoringTeam}.`;
    if (type === 'assist') return `Beautiful assist! Great team basketball from ${scoringTeam}.`;
    if (type === 'timeout') return `Timeout called by ${scoringTeam}. Time to regroup.`;
    if (type === 'quarter_start') return `Quarter ${data.quarter || ''} tips off!`;
    if (type === 'quarter_end') return `End of the quarter. Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
    return `Action continues on the court. Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
  }

  basketball3x3Commentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    if (type === 'shot_made') {
      if (data.shotType === '2pt') return `BANG! Two-pointer from beyond the arc for ${scoringTeam}! Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
      return `Score! ${scoringTeam} puts up a point. Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
    }
    if (type === 'shot_missed') return `Miss! The check ball goes to the other team.`;
    if (type === 'foul') return `Foul on ${scoringTeam}. Reset the play.`;
    return `Fast-paced 3x3 action continues! Score: ${state.scoreA || 0}-${state.scoreB || 0}.`;
  }

  volleyballCommentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    const setScore = `${state.scoreA || 0}-${state.scoreB || 0}`;
    const setsScore = `${state.setsWonA || 0}-${state.setsWonB || 0}`;

    if (type === 'rally_point') {
      const pointTypes = [
        `Point ${scoringTeam}! Great rally won. Set score: ${setScore}.`,
        `${scoringTeam} takes the point! The momentum builds. ${setScore} in this set.`,
        `Kill shot! ${scoringTeam} earns the point. ${setScore}.`,
        `Point to ${scoringTeam} after an intense rally! ${setScore}.`,
      ];
      return pointTypes[Math.floor(Math.random() * pointTypes.length)];
    }
    if (type === 'ace') return `ACE! Untouchable serve from ${scoringTeam}! ${setScore}.`;
    if (type === 'block') return `STUFF BLOCK! ${scoringTeam} shuts it down at the net! ${setScore}.`;
    if (type === 'set_end') return `Set over! Sets stand at ${setsScore}. What a battle!`;
    if (type === 'timeout') return `Timeout called. Sets: ${setsScore}, Current set: ${setScore}.`;
    if (type === 'substitution') return `Substitution for ${scoringTeam}. Tactical adjustment.`;
    return `Rally continues in this volleyball contest. Sets: ${setsScore}, Set: ${setScore}.`;
  }

  tennisCommentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    const setsScore = `${state.setsWonA || 0}-${state.setsWonB || 0}`;
    const gamesScore = `${state.gamesWonA || 0}-${state.gamesWonB || 0}`;

    if (type === 'point') {
      if (data.pointType === 'ace') return `ACE! Unreturnable serve from ${scoringTeam}! Sets: ${setsScore}, Games: ${gamesScore}.`;
      if (data.pointType === 'double_fault') return `Double fault! Unforced error gives the point away. Games: ${gamesScore}.`;
      if (data.pointType === 'winner') return `Winner! Beautiful shot from ${scoringTeam}! Clean and precise. Games: ${gamesScore}.`;
      if (data.pointType === 'unforced_error') return `Unforced error. The ball goes wide. Games: ${gamesScore}.`;
      return `Point to ${scoringTeam}. Games: ${gamesScore} in this set.`;
    }
    if (type === 'game_end') return `Game! ${scoringTeam} holds. Games: ${gamesScore}.`;
    if (type === 'set_end') return `SET! ${scoringTeam} takes the set. Sets now at ${setsScore}.`;
    if (type === 'tiebreak_point') return `Tiebreak point to ${scoringTeam}! The pressure intensifies.`;
    return `Point played on the tennis court. Sets: ${setsScore}, Games: ${gamesScore}.`;
  }

  tableTennisCommentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    const setScore = `${state.scoreA || 0}-${state.scoreB || 0}`;
    const setsScore = `${state.setsWonA || 0}-${state.setsWonB || 0}`;

    if (type === 'point') {
      const descriptions = [
        `Point ${scoringTeam}! Quick reflexes on display. ${setScore} in this game.`,
        `${scoringTeam} wins the point with a smash! ${setScore}.`,
        `Excellent rally won by ${scoringTeam}! ${setScore} in the game.`,
        `Point to ${scoringTeam}. Clinical finishing. ${setScore}.`,
      ];
      return descriptions[Math.floor(Math.random() * descriptions.length)];
    }
    if (type === 'set_end' || type === 'game_end') return `Game over! Sets: ${setsScore}. The contest intensifies!`;
    if (type === 'timeout') return `Timeout. Sets: ${setsScore}, Current game: ${setScore}.`;
    return `Fast action at the table! Sets: ${setsScore}, Game: ${setScore}.`;
  }

  badmintonCommentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    const rallyScore = `${state.scoreA || 0}-${state.scoreB || 0}`;
    const gamesScore = `${state.gamesWonA || state.setsWonA || 0}-${state.gamesWonB || state.setsWonB || 0}`;

    if (type === 'rally_point') {
      const descriptions = [
        `Point ${scoringTeam}! Brilliant shuttle play. ${rallyScore} in this game.`,
        `Smash! ${scoringTeam} wins the rally with power! ${rallyScore}.`,
        `${scoringTeam} takes the point. Clever placement. ${rallyScore}.`,
        `Rally won by ${scoringTeam}! Deceptive shot at the net. ${rallyScore}.`,
      ];
      return descriptions[Math.floor(Math.random() * descriptions.length)];
    }
    if (type === 'game_end' || type === 'set_end') return `Game point! Games: ${gamesScore}. The shuttle war continues!`;
    if (type === 'service_fault') return `Service fault by ${scoringTeam}. Point to the opponent.`;
    return `Shuttle flies back and forth! Games: ${gamesScore}, Rally: ${rallyScore}.`;
  }

  squashCommentary(type, data, scoringTeam, context) {
    const state = context.currentState || {};
    const rallyScore = `${state.scoreA || 0}-${state.scoreB || 0}`;
    const gamesScore = `${state.gamesWonA || state.setsWonA || 0}-${state.gamesWonB || state.setsWonB || 0}`;

    if (type === 'rally_point') {
      const descriptions = [
        `Point ${scoringTeam}! Excellent retrieval and finish. ${rallyScore} in this game.`,
        `${scoringTeam} wins the point! Tight drop shot into the nick. ${rallyScore}.`,
        `Boast! ${scoringTeam} takes the point with court craft. ${rallyScore}.`,
        `Winner! ${scoringTeam} finds the tin-hugging shot. ${rallyScore}.`,
      ];
      return descriptions[Math.floor(Math.random() * descriptions.length)];
    }
    if (type === 'game_end' || type === 'set_end') return `Game point! Games: ${gamesScore}. Brutal rallies on the glass court!`;
    if (type === 'let') return `Let! The rally is replayed.`;
    if (type === 'stroke') return `Stroke awarded to ${scoringTeam}. Point conceded.`;
    return `Intense squash action! Games: ${gamesScore}, Rally: ${rallyScore}.`;
  }

  // --- Fallback Match Insights (rule-based, no AI needed) ---

  fallbackMatchInsights(match, events, playerStats) {
    const sport = match.sportType;
    const state = match.currentState || {};
    const result = match.resultSummary || {};
    const activeEvents = (events || []).filter((e) => !e.isUndone);

    // Build sport-specific insights
    const insights = this.buildSportInsights(sport, state, activeEvents, result);
    const keyMoments = this.extractKeyMoments(sport, activeEvents);
    const narrative = this.buildNarrative(sport, state, result, activeEvents);

    return {
      narrative,
      keyMoments,
      insights,
      stats: this.buildMatchStats(sport, state, activeEvents),
    };
  }

  buildNarrative(sport, state, result, events) {
    const winner = result.winnerId ? 'the winning side' : null;
    const totalEvents = events.length;

    switch (sport) {
      case SPORTS.CRICKET: {
        const inn1 = state.innings?.[0] || {};
        const inn2 = state.innings?.[1] || {};
        const p1 = `The match concluded with ${result.scoreA || '0/0'} vs ${result.scoreB || '0/0'}. `;
        const p2 = `The first innings saw ${inn1.score || 0} runs scored for ${inn1.wickets || 0} wickets in ${inn1.overs || 0} overs, setting a ${(inn1.score || 0) > 100 ? 'competitive' : 'modest'} target. `;
        const p3 = result.winnerId
          ? `The match was decided by ${result.margin || 'a close margin'}, bringing an end to an entertaining contest.`
          : `The match ended in a tie — a rare and exciting result!`;
        return p1 + p2 + p3;
      }
      case SPORTS.FOOTBALL: {
        const goals = events.filter(e => e.eventType === 'goal');
        const cards = events.filter(e => e.eventType === 'card');
        const p1 = `Final score: ${result.scoreA || 0}-${result.scoreB || 0}. `;
        const p2 = `The match featured ${goals.length} goal${goals.length !== 1 ? 's' : ''} and ${cards.length} card${cards.length !== 1 ? 's' : ''}. `;
        const p3 = result.winnerId
          ? `A ${result.margin || ''} victory for the dominant side.`
          : `The spoils were shared in a closely fought encounter.`;
        return p1 + p2 + p3;
      }
      case SPORTS.BASKETBALL_5V5:
      case SPORTS.BASKETBALL_3X3: {
        const diff = Math.abs((state.scoreA || 0) - (state.scoreB || 0));
        const p1 = `Final score: ${result.scoreA || 0}-${result.scoreB || 0}. `;
        const p2 = diff <= 5 ? `A nail-biting finish with just ${diff} points separating the teams. ` :
                   diff >= 20 ? `A dominant display, winning by ${diff} points. ` :
                   `A competitive game with ${diff} points between the teams. `;
        const p3 = `${totalEvents} scoring events shaped this ${sport === SPORTS.BASKETBALL_3X3 ? '3x3' : '5v5'} contest.`;
        return p1 + p2 + p3;
      }
      case SPORTS.VOLLEYBALL: {
        const p1 = `Match concluded with sets at ${result.scoreA || 0}-${result.scoreB || 0}. `;
        const p2 = `${totalEvents} rally points were played across the match. `;
        const p3 = result.winnerId
          ? `A ${(result.scoreA === '3' || result.scoreB === '3') ? 'comprehensive' : 'hard-fought'} victory at the net.`
          : `An incredibly close contest in volleyball.`;
        return p1 + p2 + p3;
      }
      case SPORTS.TENNIS: {
        const p1 = `Match completed with sets at ${result.scoreA || 0}-${result.scoreB || 0}. `;
        const aces = events.filter(e => e.eventData?.pointType === 'ace');
        const winners = events.filter(e => e.eventData?.pointType === 'winner');
        const p2 = `The match featured ${aces.length} ace${aces.length !== 1 ? 's' : ''} and ${winners.length} winner${winners.length !== 1 ? 's' : ''}. `;
        const p3 = result.winnerId
          ? `A quality tennis match decided over ${result.margin || 'multiple sets'}.`
          : `A remarkable draw in this tennis encounter.`;
        return p1 + p2 + p3;
      }
      case SPORTS.TABLE_TENNIS: {
        const p1 = `Match ended with sets at ${result.scoreA || 0}-${result.scoreB || 0}. `;
        const p2 = `${totalEvents} points were contested in rapid-fire exchanges at the table. `;
        const p3 = result.winnerId
          ? `A decisive result in this fast-paced table tennis clash.`
          : `Honours even in a tight table tennis battle.`;
        return p1 + p2 + p3;
      }
      case SPORTS.BADMINTON: {
        const p1 = `Badminton match concluded at ${result.scoreA || 0}-${result.scoreB || 0} in games. `;
        const p2 = `${totalEvents} rally points showcased skill and endurance on court. `;
        const p3 = result.winnerId
          ? `A well-earned victory with impressive shuttle control.`
          : `Both players matched each other shot for shot.`;
        return p1 + p2 + p3;
      }
      case SPORTS.SQUASH: {
        const p1 = `Squash match finished at ${result.scoreA || 0}-${result.scoreB || 0} in games. `;
        const p2 = `${totalEvents} points played in the glass court. `;
        const p3 = result.winnerId
          ? `The winner demonstrated superior court coverage and shot selection.`
          : `A grueling draw — both players gave everything on court.`;
        return p1 + p2 + p3;
      }
      default:
        return `Match completed with a score of ${result.scoreA || 0}-${result.scoreB || 0}. ${totalEvents} events were recorded.`;
    }
  }

  buildSportInsights(sport, state, events, result) {
    const insights = [];

    switch (sport) {
      case SPORTS.CRICKET: {
        const inn1 = state.innings?.[0] || {};
        const inn2 = state.innings?.[1] || {};
        const boundaries = events.filter(e => e.eventType === 'ball' && (e.eventData?.runs === 4 || e.eventData?.runs === 6));
        const wickets = events.filter(e => (e.eventType === 'ball' && e.eventData?.isWicket) || e.eventType === 'wicket');
        const dots = events.filter(e => e.eventType === 'ball' && (e.eventData?.runs === 0) && !e.eventData?.isWicket);

        if (boundaries.length > 0) insights.push(`${boundaries.length} boundaries hit — ${boundaries.filter(e => e.eventData?.runs === 6).length} sixes and ${boundaries.filter(e => e.eventData?.runs === 4).length} fours.`);
        if (wickets.length > 0) insights.push(`${wickets.length} wicket${wickets.length !== 1 ? 's' : ''} fell during the match.`);
        if (dots.length > 0) insights.push(`${dots.length} dot ball${dots.length !== 1 ? 's' : ''} bowled — pressure building.`);
        if (inn1.runRate) insights.push(`First innings run rate: ${inn1.runRate.toFixed(2)} per over.`);
        if (inn2.runRate) insights.push(`Second innings run rate: ${inn2.runRate.toFixed(2)} per over.`);
        break;
      }
      case SPORTS.FOOTBALL: {
        const goals = events.filter(e => e.eventType === 'goal');
        const cards = events.filter(e => e.eventType === 'card');
        const yellows = cards.filter(e => e.eventData?.cardType === 'yellow');
        const reds = cards.filter(e => e.eventData?.cardType === 'red');

        if (goals.length > 0) insights.push(`${goals.length} goal${goals.length !== 1 ? 's' : ''} scored in the match.`);
        if (yellows.length > 0) insights.push(`${yellows.length} yellow card${yellows.length !== 1 ? 's' : ''} shown — a disciplined/heated affair.`);
        if (reds.length > 0) insights.push(`${reds.length} red card${reds.length !== 1 ? 's' : ''} — a player sent off!`);
        const firstHalfGoals = goals.filter(e => e.eventData?.minute <= 45);
        const secondHalfGoals = goals.filter(e => e.eventData?.minute > 45);
        if (goals.length > 1) insights.push(`Goals split: ${firstHalfGoals.length} in the first half, ${secondHalfGoals.length} in the second.`);
        break;
      }
      case SPORTS.BASKETBALL_5V5:
      case SPORTS.BASKETBALL_3X3: {
        const shots = events.filter(e => e.eventType === 'shot_made');
        const threes = shots.filter(e => e.eventData?.shotType === '3pt' || e.eventData?.shotType === '2pt');
        const fouls = events.filter(e => e.eventType === 'foul');
        const diff = Math.abs((state.scoreA || 0) - (state.scoreB || 0));

        if (shots.length > 0) insights.push(`${shots.length} made shot${shots.length !== 1 ? 's' : ''} in the game.`);
        if (threes.length > 0) insights.push(`${threes.length} long-range shot${threes.length !== 1 ? 's' : ''} converted.`);
        if (fouls.length > 0) insights.push(`${fouls.length} foul${fouls.length !== 1 ? 's' : ''} called during the game.`);
        if (diff <= 5) insights.push(`A close contest — only ${diff} points between the teams at full time.`);
        else if (diff >= 15) insights.push(`A dominant performance — ${diff}-point margin of victory.`);
        break;
      }
      case SPORTS.VOLLEYBALL: {
        const rallies = events.filter(e => e.eventType === 'rally_point');
        const teamAPoints = rallies.filter(e => e.eventData?.team === 'a');
        const teamBPoints = rallies.filter(e => e.eventData?.team === 'b');

        insights.push(`${rallies.length} total rally points contested.`);
        insights.push(`Point distribution: Team A ${teamAPoints.length}, Team B ${teamBPoints.length}.`);
        if (state.setsWonA !== undefined) insights.push(`Sets won: ${state.setsWonA || 0}-${state.setsWonB || 0}.`);
        break;
      }
      case SPORTS.TENNIS: {
        const points = events.filter(e => e.eventType === 'point');
        const aces = points.filter(e => e.eventData?.pointType === 'ace');
        const doubleFaults = points.filter(e => e.eventData?.pointType === 'double_fault');
        const winners = points.filter(e => e.eventData?.pointType === 'winner');

        insights.push(`${points.length} points played in the match.`);
        if (aces.length > 0) insights.push(`${aces.length} ace${aces.length !== 1 ? 's' : ''} served — dominant serving.`);
        if (doubleFaults.length > 0) insights.push(`${doubleFaults.length} double fault${doubleFaults.length !== 1 ? 's' : ''} committed.`);
        if (winners.length > 0) insights.push(`${winners.length} clean winner${winners.length !== 1 ? 's' : ''} struck.`);
        break;
      }
      case SPORTS.TABLE_TENNIS: {
        const points = events.filter(e => e.eventType === 'point');
        const teamAPoints = points.filter(e => e.eventData?.team === 'a');
        const teamBPoints = points.filter(e => e.eventData?.team === 'b');

        insights.push(`${points.length} points played at lightning speed.`);
        insights.push(`Point distribution: Team A ${teamAPoints.length}, Team B ${teamBPoints.length}.`);
        if (state.setsWonA !== undefined) insights.push(`Sets: ${state.setsWonA || 0}-${state.setsWonB || 0}.`);
        break;
      }
      case SPORTS.BADMINTON: {
        const rallies = events.filter(e => e.eventType === 'rally_point');
        const teamAPoints = rallies.filter(e => e.eventData?.team === 'a');
        const teamBPoints = rallies.filter(e => e.eventData?.team === 'b');

        insights.push(`${rallies.length} shuttle rallies decided the match.`);
        insights.push(`Rally wins: Team A ${teamAPoints.length}, Team B ${teamBPoints.length}.`);
        const gamesA = state.gamesWonA || state.setsWonA || 0;
        const gamesB = state.gamesWonB || state.setsWonB || 0;
        insights.push(`Games: ${gamesA}-${gamesB}.`);
        break;
      }
      case SPORTS.SQUASH: {
        const rallies = events.filter(e => e.eventType === 'rally_point');
        const teamAPoints = rallies.filter(e => e.eventData?.team === 'a');
        const teamBPoints = rallies.filter(e => e.eventData?.team === 'b');

        insights.push(`${rallies.length} points played on the glass court.`);
        insights.push(`Point wins: Team A ${teamAPoints.length}, Team B ${teamBPoints.length}.`);
        const gamesA = state.gamesWonA || state.setsWonA || 0;
        const gamesB = state.gamesWonB || state.setsWonB || 0;
        insights.push(`Games: ${gamesA}-${gamesB}.`);
        break;
      }
    }

    if (insights.length === 0) {
      insights.push(`${events.length} events recorded in this match.`);
    }

    return insights;
  }

  extractKeyMoments(sport, events) {
    const moments = [];

    switch (sport) {
      case SPORTS.CRICKET: {
        const wickets = events.filter(e => (e.eventType === 'ball' && e.eventData?.isWicket) || e.eventType === 'wicket');
        const sixes = events.filter(e => e.eventType === 'ball' && e.eventData?.runs === 6);
        wickets.forEach((w, i) => moments.push(`Wicket #${i + 1}: ${w.eventData?.wicketType || 'out'} — a key breakthrough.`));
        sixes.forEach((s, i) => moments.push(`Maximum! A six hit at event #${s.sequenceNumber || i}.`));
        break;
      }
      case SPORTS.FOOTBALL: {
        const goals = events.filter(e => e.eventType === 'goal');
        const reds = events.filter(e => e.eventType === 'card' && e.eventData?.cardType === 'red');
        goals.forEach((g) => moments.push(`Goal by ${g.eventData?.scorer || 'a player'} at minute ${g.eventData?.minute || '?'}.`));
        reds.forEach((r) => moments.push(`Red card for ${r.eventData?.player || 'a player'} — game changer!`));
        break;
      }
      case SPORTS.BASKETBALL_5V5:
      case SPORTS.BASKETBALL_3X3: {
        const threes = events.filter(e => e.eventType === 'shot_made' && (e.eventData?.shotType === '3pt' || e.eventData?.shotType === '2pt'));
        threes.slice(0, 5).forEach((s, i) => moments.push(`Long-range shot #${i + 1} converted!`));
        break;
      }
      default: {
        // For rally sports, mark set/game ends
        const setEnds = events.filter(e => e.eventType === 'set_end' || e.eventType === 'game_end');
        setEnds.forEach((s, i) => moments.push(`Set/Game #${i + 1} completed.`));
        if (events.length > 0 && moments.length === 0) {
          moments.push(`Match started and ${events.length} events were recorded.`);
        }
        break;
      }
    }

    if (moments.length === 0) {
      moments.push(`The match progressed with ${events.length} recorded events.`);
    }

    return moments.slice(0, 5); // Max 5 key moments
  }

  buildMatchStats(sport, state, events) {
    const stats = {
      totalEvents: events.length,
      sport,
    };

    switch (sport) {
      case SPORTS.CRICKET: {
        const inn1 = state.innings?.[0] || {};
        const inn2 = state.innings?.[1] || {};
        stats.innings1 = { score: inn1.score || 0, wickets: inn1.wickets || 0, overs: inn1.overs || 0, runRate: inn1.runRate || 0 };
        stats.innings2 = { score: inn2.score || 0, wickets: inn2.wickets || 0, overs: inn2.overs || 0, runRate: inn2.runRate || 0 };
        stats.boundaries = events.filter(e => e.eventType === 'ball' && (e.eventData?.runs === 4 || e.eventData?.runs === 6)).length;
        stats.wickets = events.filter(e => (e.eventType === 'ball' && e.eventData?.isWicket) || e.eventType === 'wicket').length;
        break;
      }
      case SPORTS.FOOTBALL:
        stats.scoreA = state.scoreA || 0;
        stats.scoreB = state.scoreB || 0;
        stats.goals = events.filter(e => e.eventType === 'goal').length;
        stats.cards = events.filter(e => e.eventType === 'card').length;
        break;
      case SPORTS.BASKETBALL_5V5:
      case SPORTS.BASKETBALL_3X3:
        stats.scoreA = state.scoreA || 0;
        stats.scoreB = state.scoreB || 0;
        stats.shotsMade = events.filter(e => e.eventType === 'shot_made').length;
        stats.fouls = events.filter(e => e.eventType === 'foul').length;
        break;
      case SPORTS.VOLLEYBALL:
        stats.setsA = state.setsWonA || 0;
        stats.setsB = state.setsWonB || 0;
        stats.totalRallies = events.filter(e => e.eventType === 'rally_point').length;
        break;
      case SPORTS.TENNIS:
        stats.setsA = state.setsWonA || 0;
        stats.setsB = state.setsWonB || 0;
        stats.aces = events.filter(e => e.eventData?.pointType === 'ace').length;
        stats.winners = events.filter(e => e.eventData?.pointType === 'winner').length;
        stats.doubleFaults = events.filter(e => e.eventData?.pointType === 'double_fault').length;
        break;
      case SPORTS.TABLE_TENNIS:
        stats.setsA = state.setsWonA || 0;
        stats.setsB = state.setsWonB || 0;
        stats.totalPoints = events.filter(e => e.eventType === 'point').length;
        break;
      case SPORTS.BADMINTON:
        stats.gamesA = state.gamesWonA || state.setsWonA || 0;
        stats.gamesB = state.gamesWonB || state.setsWonB || 0;
        stats.totalRallies = events.filter(e => e.eventType === 'rally_point').length;
        break;
      case SPORTS.SQUASH:
        stats.gamesA = state.gamesWonA || state.setsWonA || 0;
        stats.gamesB = state.gamesWonB || state.setsWonB || 0;
        stats.totalRallies = events.filter(e => e.eventType === 'rally_point').length;
        break;
    }

    return stats;
  }
}

module.exports = new AIService();

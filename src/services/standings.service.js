const Standing = require('../models/Standing');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const { SPORTS } = require('../utils/constants');

class StandingsService {
  /**
   * Update standings after a match completes
   */
  async updateAfterMatch(match) {
    const tournament = await Tournament.findById(match.tournamentId);
    if (!tournament) return;

    const standingA = await Standing.findOne({ tournamentId: match.tournamentId, teamId: match.teamA });
    const standingB = await Standing.findOne({ tournamentId: match.tournamentId, teamId: match.teamB });

    if (!standingA || !standingB) return;

    // Update played count
    standingA.played += 1;
    standingB.played += 1;

    // Determine result
    const winnerId = match.resultSummary?.winnerId;

    if (!winnerId || match.resultSummary?.resultType === 'draw' || match.resultSummary?.resultType === 'tie') {
      // Draw
      standingA.drawn += 1;
      standingB.drawn += 1;
      standingA.points += this.getDrawPoints(tournament.sportType);
      standingB.points += this.getDrawPoints(tournament.sportType);
    } else if (winnerId.toString() === match.teamA.toString()) {
      standingA.won += 1;
      standingB.lost += 1;
      standingA.points += this.getWinPoints(tournament.sportType);
      standingB.points += this.getLossPoints(tournament.sportType);
    } else {
      standingB.won += 1;
      standingA.lost += 1;
      standingB.points += this.getWinPoints(tournament.sportType);
      standingA.points += this.getLossPoints(tournament.sportType);
    }

    // Update for/against values (sport-specific)
    this.updateForAgainstValues(standingA, standingB, match, tournament.sportType);

    await standingA.save();
    await standingB.save();

    // Recalculate rankings for the group/tournament
    await this.recalculateRankings(match.tournamentId, standingA.groupName);
  }

  /**
   * Recalculate rankings for a group or tournament
   */
  async recalculateRankings(tournamentId, groupName = null) {
    const query = { tournamentId };
    if (groupName) query.groupName = groupName;

    const standings = await Standing.find(query).sort({
      points: -1,
      netValue: -1,
      forValue: -1,
      won: -1,
    });

    for (let i = 0; i < standings.length; i++) {
      standings[i].rank = i + 1;
      await standings[i].save();
    }

    return standings;
  }

  /**
   * Get standings for a tournament
   */
  async getStandings(tournamentId, groupName = null) {
    const query = { tournamentId };
    if (groupName) query.groupName = groupName;

    const standings = await Standing.find(query)
      .populate('teamId', 'name shortName color logoUrl')
      .sort({ groupName: 1, rank: 1 });

    return standings;
  }

  /**
   * Update for/against values based on sport
   */
  updateForAgainstValues(standingA, standingB, match, sportType) {
    const state = match.currentState;
    if (!state) return;

    switch (sportType) {
      case SPORTS.CRICKET: {
        // Use innings scores
        const scoreA = state.innings?.[0]?.score || 0;
        const scoreB = state.innings?.[1]?.score || 0;
        standingA.forValue += scoreA;
        standingA.againstValue += scoreB;
        standingB.forValue += scoreB;
        standingB.againstValue += scoreA;

        // NRR calculation
        const oversA = state.innings?.[0]?.overs || 0;
        const oversB = state.innings?.[1]?.overs || 0;
        standingA.additionalData = standingA.additionalData || {};
        standingA.additionalData.oversPlayed = (standingA.additionalData.oversPlayed || 0) + oversA;
        standingA.additionalData.oversBowled = (standingA.additionalData.oversBowled || 0) + oversB;
        standingB.additionalData = standingB.additionalData || {};
        standingB.additionalData.oversPlayed = (standingB.additionalData.oversPlayed || 0) + oversB;
        standingB.additionalData.oversBowled = (standingB.additionalData.oversBowled || 0) + oversA;

        // NRR
        if (standingA.additionalData.oversPlayed > 0 && standingA.additionalData.oversBowled > 0) {
          standingA.netValue = (standingA.forValue / standingA.additionalData.oversPlayed) -
            (standingA.againstValue / standingA.additionalData.oversBowled);
        }
        if (standingB.additionalData.oversPlayed > 0 && standingB.additionalData.oversBowled > 0) {
          standingB.netValue = (standingB.forValue / standingB.additionalData.oversPlayed) -
            (standingB.againstValue / standingB.additionalData.oversBowled);
        }
        break;
      }
      case SPORTS.FOOTBALL: {
        const goalsA = state.scoreA || 0;
        const goalsB = state.scoreB || 0;
        standingA.forValue += goalsA;
        standingA.againstValue += goalsB;
        standingA.netValue = standingA.forValue - standingA.againstValue;
        standingB.forValue += goalsB;
        standingB.againstValue += goalsA;
        standingB.netValue = standingB.forValue - standingB.againstValue;
        break;
      }
      case SPORTS.BASKETBALL_5V5:
      case SPORTS.BASKETBALL_3X3: {
        const ptsA = state.scoreA || 0;
        const ptsB = state.scoreB || 0;
        standingA.forValue += ptsA;
        standingA.againstValue += ptsB;
        standingA.netValue = standingA.forValue - standingA.againstValue;
        standingB.forValue += ptsB;
        standingB.againstValue += ptsA;
        standingB.netValue = standingB.forValue - standingB.againstValue;
        break;
      }
      default: {
        // Generic: use scoreA/scoreB
        const valA = state.scoreA || 0;
        const valB = state.scoreB || 0;
        standingA.forValue += valA;
        standingA.againstValue += valB;
        standingA.netValue = standingA.forValue - standingA.againstValue;
        standingB.forValue += valB;
        standingB.againstValue += valA;
        standingB.netValue = standingB.forValue - standingB.againstValue;
        break;
      }
    }
  }

  /**
   * Points awarded per sport
   */
  getWinPoints(sportType) {
    switch (sportType) {
      case SPORTS.CRICKET: return 2;
      case SPORTS.FOOTBALL: return 3;
      default: return 2;
    }
  }

  getDrawPoints(sportType) {
    switch (sportType) {
      case SPORTS.CRICKET: return 1;
      case SPORTS.FOOTBALL: return 1;
      default: return 1;
    }
  }

  getLossPoints(sportType) {
    return 0;
  }
}

module.exports = new StandingsService();

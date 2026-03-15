const mongoose = require('mongoose');
const { SPORT_LIST } = require('../utils/constants');

const playerMatchStatsSchema = new mongoose.Schema(
  {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    sportType: {
      type: String,
      enum: SPORT_LIST,
      required: true,
    },
    // Sport-specific stats (polymorphic)
    stats: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      /*
        Cricket batting:  { runs, balls, fours, sixes, strikeRate, howOut, bowler, fielder, dotPercent, boundaryPercent }
        Cricket bowling:  { overs, maidens, runs, wickets, economy, dots, dotPercent, wides, noBalls }
        Football:         { goals, assists, yellowCards, redCards, minutes, subTime }
        Basketball 5v5:   { minutes, points, twoPointMade, twoPointAttempted, threePointMade, threePointAttempted,
                            ftMade, ftAttempted, fgPercent, offRebounds, defRebounds, totalRebounds,
                            assists, steals, blocks, turnovers, fouls, plusMinus }
        Basketball 3x3:   { points, onePointMade, onePointAttempted, twoPointMade, twoPointAttempted }
        Volleyball:       { kills, blocks, aces, digs, serviceErrors }
        Tennis:           { aces, doubleFaults, firstServePercent, breakPointsConverted, breakPointsSaved,
                            winners, unforcedErrors }
        Table Tennis:     { pointsPerSet: [], servicePointsWon, longestStreak }
        Badminton:        { pointsPerSet: [], servicePointsWon }
        Squash:           { pointsPerGame: [], servicePointsWon }
      */
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
playerMatchStatsSchema.index({ playerId: 1, sportType: 1 });
playerMatchStatsSchema.index({ matchId: 1 });
playerMatchStatsSchema.index({ teamId: 1 });
playerMatchStatsSchema.index({ tournamentId: 1 });
playerMatchStatsSchema.index({ playerId: 1, matchId: 1 }, { unique: true });

module.exports = mongoose.model('PlayerMatchStats', playerMatchStatsSchema);

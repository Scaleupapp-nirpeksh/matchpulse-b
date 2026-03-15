const Match = require('../models/Match');
const Team = require('../models/Team');
const Tournament = require('../models/Tournament');
const Standing = require('../models/Standing');
const { BadRequestError, NotFoundError } = require('../utils/errors');

class FixtureService {
  /**
   * Auto-generate fixtures based on tournament format
   */
  async generateFixtures(tournamentId, userId) {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) throw new NotFoundError('Tournament not found');

    const teams = await Team.find({ tournamentId, isActive: true });
    if (teams.length < 2) throw new BadRequestError('Need at least 2 teams');

    // Clear existing scheduled matches
    await Match.deleteMany({ tournamentId, status: 'scheduled' });

    let matches;
    switch (tournament.format) {
      case 'round_robin':
        matches = this.generateRoundRobin(tournament, teams);
        break;
      case 'knockout':
        matches = this.generateKnockout(tournament, teams);
        break;
      case 'groups_knockout':
        matches = await this.generateGroupsKnockout(tournament, teams);
        break;
      case 'swiss':
        matches = this.generateSwissRound(tournament, teams, 1);
        break;
      default:
        throw new BadRequestError(`Unsupported format: ${tournament.format}`);
    }

    // Save matches
    const savedMatches = await Match.insertMany(matches);

    // Initialize standings
    await this.initializeStandings(tournamentId, teams, tournament.format === 'groups_knockout');

    return savedMatches;
  }

  /**
   * Round Robin: every team plays every other team
   */
  generateRoundRobin(tournament, teams) {
    const matches = [];
    let matchNumber = 1;

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matches.push({
          tournamentId: tournament._id,
          sportType: tournament.sportType,
          teamA: teams[i]._id,
          teamB: teams[j]._id,
          stage: 'group',
          groupName: teams[i].groupName || 'A',
          matchNumber: matchNumber++,
          status: 'scheduled',
        });
      }
    }

    return matches;
  }

  /**
   * Single Elimination Knockout
   */
  generateKnockout(tournament, teams) {
    const matches = [];
    let matchNumber = 1;

    // Shuffle or use seeding
    const orderedTeams = tournament.seeding === 'random'
      ? this.shuffleArray([...teams])
      : teams.sort((a, b) => (a.seed || 999) - (b.seed || 999));

    // Pad to next power of 2
    const totalSlots = this.nextPowerOf2(orderedTeams.length);
    const byes = totalSlots - orderedTeams.length;

    // Determine rounds
    const rounds = Math.log2(totalSlots);
    const stageNames = this.getKnockoutStageNames(rounds);

    // First round
    let currentRoundTeams = [...orderedTeams];
    const firstRoundMatches = Math.floor(currentRoundTeams.length / 2);

    // Handle byes — top seeds get byes
    const byeTeams = currentRoundTeams.splice(0, byes);
    const playingTeams = currentRoundTeams;

    for (let i = 0; i < playingTeams.length; i += 2) {
      if (i + 1 < playingTeams.length) {
        matches.push({
          tournamentId: tournament._id,
          sportType: tournament.sportType,
          teamA: playingTeams[i]._id,
          teamB: playingTeams[i + 1]._id,
          stage: stageNames[0] || `round_${rounds}`,
          matchNumber: matchNumber++,
          status: 'scheduled',
        });
      }
    }

    // Generate placeholder matches for subsequent rounds
    const remainingRounds = rounds - 1;
    let previousRoundMatchCount = matches.length;

    for (let round = 1; round <= remainingRounds; round++) {
      const matchesInRound = Math.ceil((previousRoundMatchCount + (round === 1 ? byeTeams.length : 0)) / 2);

      for (let i = 0; i < matchesInRound; i++) {
        const matchEntry = {
          tournamentId: tournament._id,
          sportType: tournament.sportType,
          teamA: null, // TBD — depends on previous round results
          teamB: null,
          stage: stageNames[round] || `round_${rounds - round}`,
          matchNumber: matchNumber++,
          status: 'scheduled',
          dependsOn: {
            teamASource: `winner_of_match_${matchNumber - matchesInRound * 2 + i * 2 - 1}`,
            teamBSource: `winner_of_match_${matchNumber - matchesInRound * 2 + i * 2}`,
          },
        };

        // For first subsequent round, pair bye teams with first round winners
        if (round === 1 && i < byeTeams.length) {
          matchEntry.teamA = byeTeams[i]._id;
        }

        matches.push(matchEntry);
      }

      previousRoundMatchCount = matchesInRound;
    }

    // Third-place match
    if (tournament.thirdPlaceMatch && matches.length >= 2) {
      matches.push({
        tournamentId: tournament._id,
        sportType: tournament.sportType,
        teamA: null,
        teamB: null,
        stage: 'third_place',
        matchNumber: matchNumber++,
        status: 'scheduled',
      });
    }

    return matches;
  }

  /**
   * Groups + Knockout
   */
  async generateGroupsKnockout(tournament, teams) {
    const matches = [];
    let matchNumber = 1;
    const numGroups = tournament.numGroups || 2;

    // Assign teams to groups if not already assigned
    const groupNames = 'ABCDEFGHIJKLMNOP'.split('').slice(0, numGroups);
    const teamsWithGroups = teams.map((team, idx) => {
      if (!team.groupName) {
        team.groupName = groupNames[idx % numGroups];
        team.save(); // Non-blocking
      }
      return team;
    });

    // Group stage: round robin within each group
    for (const groupName of groupNames) {
      const groupTeams = teamsWithGroups.filter((t) => t.groupName === groupName);

      for (let i = 0; i < groupTeams.length; i++) {
        for (let j = i + 1; j < groupTeams.length; j++) {
          matches.push({
            tournamentId: tournament._id,
            sportType: tournament.sportType,
            teamA: groupTeams[i]._id,
            teamB: groupTeams[j]._id,
            stage: 'group',
            groupName,
            matchNumber: matchNumber++,
            status: 'scheduled',
          });
        }
      }
    }

    // Knockout stage placeholders
    const teamsAdvancing = tournament.teamsAdvancing || 2;
    const knockoutTeamCount = numGroups * teamsAdvancing;
    const knockoutRounds = Math.ceil(Math.log2(knockoutTeamCount));
    const stageNames = this.getKnockoutStageNames(knockoutRounds);

    let matchesInRound = Math.ceil(knockoutTeamCount / 2);

    for (let round = 0; round < knockoutRounds; round++) {
      for (let i = 0; i < matchesInRound; i++) {
        matches.push({
          tournamentId: tournament._id,
          sportType: tournament.sportType,
          teamA: null,
          teamB: null,
          stage: stageNames[round] || `round_${knockoutRounds - round}`,
          matchNumber: matchNumber++,
          status: 'scheduled',
        });
      }
      matchesInRound = Math.ceil(matchesInRound / 2);
    }

    return matches;
  }

  /**
   * Swiss system — generate one round at a time
   */
  generateSwissRound(tournament, teams, roundNumber) {
    const matches = [];
    let matchNumber = 1;

    // Sort teams by current points (for pairing)
    const sortedTeams = [...teams].sort((a, b) => (b.points || 0) - (a.points || 0));

    // Pair adjacent teams
    for (let i = 0; i < sortedTeams.length; i += 2) {
      if (i + 1 < sortedTeams.length) {
        matches.push({
          tournamentId: tournament._id,
          sportType: tournament.sportType,
          teamA: sortedTeams[i]._id,
          teamB: sortedTeams[i + 1]._id,
          stage: `swiss_round_${roundNumber}`,
          matchNumber: matchNumber++,
          status: 'scheduled',
        });
      }
    }

    return matches;
  }

  /**
   * Initialize standings for all teams
   */
  async initializeStandings(tournamentId, teams, hasGroups = false) {
    // Remove existing standings
    await Standing.deleteMany({ tournamentId });

    const standings = teams.map((team) => ({
      tournamentId,
      teamId: team._id,
      groupName: hasGroups ? team.groupName : null,
      played: 0,
      won: 0,
      lost: 0,
      drawn: 0,
      points: 0,
      forValue: 0,
      againstValue: 0,
      netValue: 0,
      rank: 0,
    }));

    await Standing.insertMany(standings);
  }

  /**
   * Check for scheduling conflicts
   */
  async checkConflicts(tournamentId, teamA, teamB, scheduledAt, duration = 120) {
    if (!scheduledAt) return [];

    const startTime = new Date(scheduledAt);
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    const conflicts = await Match.find({
      tournamentId,
      status: { $in: ['scheduled', 'live'] },
      scheduledAt: { $gte: startTime, $lte: endTime },
      $or: [
        { teamA: { $in: [teamA, teamB] } },
        { teamB: { $in: [teamA, teamB] } },
      ],
    });

    return conflicts;
  }

  // --- Helpers ---

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  nextPowerOf2(n) {
    let power = 1;
    while (power < n) power *= 2;
    return power;
  }

  getKnockoutStageNames(totalRounds) {
    const names = [];
    for (let i = totalRounds; i >= 1; i--) {
      if (i === 1) names.push('final');
      else if (i === 2) names.push('semifinal');
      else if (i === 3) names.push('quarterfinal');
      else names.push(`round_of_${Math.pow(2, i)}`);
    }
    return names.reverse();
  }
}

module.exports = new FixtureService();

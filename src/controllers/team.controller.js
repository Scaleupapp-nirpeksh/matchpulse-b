const Team = require('../models/Team');
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const { createAuditEntry } = require('../middleware/audit');
const { NotFoundError, BadRequestError, ConflictError } = require('../utils/errors');
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require('../utils/constants');
const { parsePagination, paginationMeta } = require('../utils/helpers');
const { parse } = require('csv-parse/sync');

class TeamController {
  /**
   * POST /api/teams
   */
  async create(req, res, next) {
    try {
      const { tournamentId, name, shortName, color, logoUrl, groupName, seed } = req.body;

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      const team = new Team({
        tournamentId,
        name,
        shortName: shortName || name.substring(0, 3).toUpperCase(),
        color,
        logoUrl,
        groupName,
        seed,
      });

      await team.save();

      await createAuditEntry({
        organizationId: tournament.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.TEAM_CREATE,
        entityType: AUDIT_ENTITY_TYPES.TEAM,
        entityId: team._id,
        newValue: { name, tournamentId },
        req,
      });

      res.status(201).json({
        success: true,
        data: team,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/teams/:teamId
   */
  async getById(req, res, next) {
    try {
      const team = await Team.findById(req.params.teamId)
        .populate('players.playerId', 'fullName avatarUrl bio')
        .populate('captainId', 'fullName avatarUrl');

      if (!team) throw new NotFoundError('Team not found');

      res.json({
        success: true,
        data: team,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/teams/:teamId
   */
  async update(req, res, next) {
    try {
      const team = await Team.findById(req.params.teamId);
      if (!team) throw new NotFoundError('Team not found');

      const oldValue = team.toObject();
      const allowedFields = ['name', 'shortName', 'color', 'logoUrl', 'groupName', 'seed', 'captainId'];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          team[field] = req.body[field];
        }
      }

      await team.save();

      const tournament = await Tournament.findById(team.tournamentId);
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.TEAM_UPDATE,
        entityType: AUDIT_ENTITY_TYPES.TEAM,
        entityId: team._id,
        oldValue,
        newValue: req.body,
        req,
      });

      res.json({
        success: true,
        data: team,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/teams/:teamId
   */
  async delete(req, res, next) {
    try {
      const team = await Team.findById(req.params.teamId);
      if (!team) throw new NotFoundError('Team not found');

      team.isActive = false;
      await team.save();

      const tournament = await Tournament.findById(team.tournamentId);
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.TEAM_DELETE,
        entityType: AUDIT_ENTITY_TYPES.TEAM,
        entityId: team._id,
        oldValue: { name: team.name },
        req,
      });

      res.json({
        success: true,
        message: 'Team deactivated',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/teams/:teamId/players
   */
  async addPlayer(req, res, next) {
    try {
      const { playerId, jerseyNumber, position, role } = req.body;
      const team = await Team.findById(req.params.teamId);
      if (!team) throw new NotFoundError('Team not found');

      // Check player exists
      const player = await User.findById(playerId);
      if (!player) throw new NotFoundError('Player not found');

      // Check if player already in team
      const existing = team.players.find(
        (p) => p.playerId.toString() === playerId
      );
      if (existing) throw new ConflictError('Player already in this team');

      team.players.push({
        playerId,
        jerseyNumber,
        position,
        role,
        isPlaying: true,
      });

      await team.save();

      const tournament = await Tournament.findById(team.tournamentId);
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.PLAYER_ADD,
        entityType: AUDIT_ENTITY_TYPES.TEAM,
        entityId: team._id,
        newValue: { playerId, jerseyNumber, teamName: team.name },
        req,
      });

      res.status(201).json({
        success: true,
        data: team,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/teams/:teamId/players/:playerId
   */
  async removePlayer(req, res, next) {
    try {
      const team = await Team.findById(req.params.teamId);
      if (!team) throw new NotFoundError('Team not found');

      const playerIndex = team.players.findIndex(
        (p) => p.playerId.toString() === req.params.playerId
      );

      if (playerIndex === -1) throw new NotFoundError('Player not found in team');

      const removedPlayer = team.players[playerIndex];
      team.players.splice(playerIndex, 1);
      await team.save();

      const tournament = await Tournament.findById(team.tournamentId);
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.PLAYER_REMOVE,
        entityType: AUDIT_ENTITY_TYPES.TEAM,
        entityId: team._id,
        oldValue: { playerId: req.params.playerId },
        req,
      });

      res.json({
        success: true,
        message: 'Player removed from team',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/teams/tournament/:tournamentId
   */
  async getByTournament(req, res, next) {
    try {
      const teams = await Team.find({
        tournamentId: req.params.tournamentId,
        isActive: true,
      })
        .populate('players.playerId', 'fullName avatarUrl')
        .populate('captainId', 'fullName')
        .sort({ groupName: 1, seed: 1, name: 1 });

      res.json({
        success: true,
        data: teams,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/teams/tournament/:tournamentId/bulk-import
   * Import teams and players from CSV
   */
  async bulkImport(req, res, next) {
    try {
      if (!req.file) throw new BadRequestError('CSV file required');

      const tournament = await Tournament.findById(req.params.tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      const csvContent = req.file.buffer.toString('utf-8');
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const results = { teams: 0, players: 0, errors: [] };

      // Group by team
      const teamMap = {};
      for (const record of records) {
        const teamName = record.team || record.Team || record.team_name;
        if (!teamName) {
          results.errors.push(`Row missing team name: ${JSON.stringify(record)}`);
          continue;
        }

        if (!teamMap[teamName]) {
          teamMap[teamName] = [];
        }
        teamMap[teamName].push(record);
      }

      for (const [teamName, players] of Object.entries(teamMap)) {
        // Create or find team
        let team = await Team.findOne({
          tournamentId: tournament._id,
          name: teamName,
          isActive: true,
        });

        if (!team) {
          team = new Team({
            tournamentId: tournament._id,
            name: teamName,
            shortName: teamName.substring(0, 3).toUpperCase(),
          });
          await team.save();
          results.teams++;
        }

        // Add players
        for (const playerData of players) {
          const playerName = playerData.player || playerData.Player || playerData.player_name || playerData.name;
          if (!playerName) continue;

          try {
            // Find or create player user
            let user = await User.findOne({
              organizationId: tournament.organizationId,
              fullName: playerName,
            });

            if (!user) {
              user = new User({
                fullName: playerName,
                organizationId: tournament.organizationId,
                role: 'player',
              });
              await user.save();
            }

            // Add to team if not already
            const alreadyInTeam = team.players.find(
              (p) => p.playerId.toString() === user._id.toString()
            );

            if (!alreadyInTeam) {
              team.players.push({
                playerId: user._id,
                jerseyNumber: parseInt(playerData.jersey || playerData.jerseyNumber) || null,
                position: playerData.position || null,
                role: playerData.role || null,
              });
              results.players++;
            }
          } catch (err) {
            results.errors.push(`Error adding ${playerName}: ${err.message}`);
          }
        }

        await team.save();
      }

      res.status(201).json({
        success: true,
        data: results,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TeamController();

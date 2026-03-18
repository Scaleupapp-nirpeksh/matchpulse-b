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
      let { playerId, name, jerseyNumber, position, role } = req.body;
      const team = await Team.findById(req.params.teamId);
      if (!team) throw new NotFoundError('Team not found');

      // Either playerId or name must be provided
      if (!playerId && !name) {
        throw new BadRequestError('Either playerId or player name is required');
      }

      let player;
      if (playerId) {
        // Existing user by ID
        player = await User.findById(playerId);
        if (!player) throw new NotFoundError('Player not found');
      } else {
        // Auto-create a player user record by name
        const tournament = await Tournament.findById(team.tournamentId);
        player = new User({
          fullName: name,
          role: 'player',
          organizationId: tournament?.organizationId || null,
          isActive: true,
        });
        await player.save();
        playerId = player._id;
      }

      // Check if player already in team
      const existing = team.players.find(
        (p) => p.playerId.toString() === playerId.toString()
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
        newValue: { playerId, name: player.fullName, jerseyNumber, teamName: team.name },
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
   * PUT /api/teams/:teamId/players/:playerId
   */
  async updatePlayer(req, res, next) {
    try {
      const team = await Team.findById(req.params.teamId);
      if (!team) throw new NotFoundError('Team not found');

      const playerEntry = team.players.find(
        (p) => p.playerId.toString() === req.params.playerId
      );
      if (!playerEntry) throw new NotFoundError('Player not found in team');

      const oldValue = { ...playerEntry.toObject() };
      const allowedFields = ['jerseyNumber', 'position', 'role', 'isPlaying'];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          playerEntry[field] = req.body[field];
        }
      }

      team.markModified('players');
      await team.save();

      const tournament = await Tournament.findById(team.tournamentId);
      await createAuditEntry({
        organizationId: tournament?.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.PLAYER_UPDATE,
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

  // ===== PUBLIC TEAM REGISTRATION =====

  /**
   * POST /api/teams/tournament/:tournamentId/register (PUBLIC)
   */
  async publicRegister(req, res, next) {
    try {
      const tournament = await Tournament.findById(req.params.tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      if (tournament.status !== 'registration') {
        throw new BadRequestError('Tournament is not currently accepting registrations');
      }

      const settings = tournament.registrationSettings || {};
      if (settings.isOpen === false) {
        throw new BadRequestError('Registration is currently closed');
      }
      if (settings.deadline && new Date() > new Date(settings.deadline)) {
        throw new BadRequestError('Registration deadline has passed');
      }

      const { teamName, shortName, captain, players } = req.body;
      const TeamRegistration = require('../models/TeamRegistration');

      // Check max teams
      if (settings.maxTeams) {
        const pendingCount = await TeamRegistration.countDocuments({
          tournamentId: tournament._id,
          status: { $in: ['pending', 'approved'] },
        });
        const teamCount = await Team.countDocuments({ tournamentId: tournament._id, isActive: true });
        if (pendingCount + teamCount >= settings.maxTeams) {
          throw new BadRequestError('Maximum number of teams reached');
        }
      }

      // Check duplicate
      const duplicate = await TeamRegistration.findOne({
        tournamentId: tournament._id,
        teamName,
        status: { $ne: 'rejected' },
      });
      if (duplicate) throw new ConflictError('A team with this name has already registered');

      const existingTeam = await Team.findOne({ tournamentId: tournament._id, name: teamName, isActive: true });
      if (existingTeam) throw new ConflictError('A team with this name already exists');

      // If no approval required, create team directly
      if (!settings.requireApproval) {
        const team = new Team({
          tournamentId: tournament._id,
          name: teamName,
          shortName: shortName || teamName.substring(0, 3).toUpperCase(),
        });
        await team.save();

        for (const p of players) {
          const user = new User({ fullName: p.name, organizationId: tournament.organizationId, role: 'player', isActive: true });
          await user.save();
          team.players.push({ playerId: user._id, jerseyNumber: p.jerseyNumber || null, position: p.position || null });
        }
        await team.save();

        return res.status(201).json({
          success: true,
          data: { status: 'approved', teamId: team._id },
          message: 'Team registered successfully!',
        });
      }

      // Otherwise, create pending registration
      const registration = new TeamRegistration({
        tournamentId: tournament._id,
        teamName,
        shortName: shortName || teamName.substring(0, 3).toUpperCase(),
        captain,
        players,
        status: 'pending',
      });
      await registration.save();

      res.status(201).json({
        success: true,
        data: { status: 'pending', registrationId: registration._id },
        message: 'Registration submitted. Awaiting admin approval.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/teams/tournament/:tournamentId/registrations
   */
  async getRegistrations(req, res, next) {
    try {
      const TeamRegistration = require('../models/TeamRegistration');
      const statusFilter = req.query.status || 'pending';
      const registrations = await TeamRegistration.find({
        tournamentId: req.params.tournamentId,
        status: statusFilter,
      }).sort({ createdAt: -1 });

      res.json({ success: true, data: registrations });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/teams/tournament/:tournamentId/registrations/:registrationId
   */
  async reviewRegistration(req, res, next) {
    try {
      const { action, rejectionReason } = req.body;
      const TeamRegistration = require('../models/TeamRegistration');

      const registration = await TeamRegistration.findById(req.params.registrationId);
      if (!registration) throw new NotFoundError('Registration not found');
      if (registration.status !== 'pending') throw new BadRequestError('Registration already reviewed');

      if (action === 'approve') {
        const tournament = await Tournament.findById(registration.tournamentId);
        const team = new Team({
          tournamentId: registration.tournamentId,
          name: registration.teamName,
          shortName: registration.shortName,
        });
        await team.save();

        for (const p of registration.players) {
          const user = new User({ fullName: p.name, organizationId: tournament?.organizationId, role: 'player', isActive: true });
          await user.save();
          team.players.push({ playerId: user._id, jerseyNumber: p.jerseyNumber || null, position: p.position || null });
        }
        await team.save();

        registration.status = 'approved';
        registration.reviewedBy = req.userId;
        registration.reviewedAt = new Date();
        await registration.save();

        await createAuditEntry({
          organizationId: tournament?.organizationId,
          userId: req.userId,
          userRole: req.user.role,
          actionType: AUDIT_ACTIONS.TEAM_CREATE,
          entityType: AUDIT_ENTITY_TYPES.TEAM,
          entityId: team._id,
          newValue: { name: team.name, source: 'public_registration' },
          req,
        });

        return res.json({ success: true, data: { registration, team }, message: 'Team approved' });
      }

      if (action === 'reject') {
        registration.status = 'rejected';
        registration.rejectionReason = rejectionReason || null;
        registration.reviewedBy = req.userId;
        registration.reviewedAt = new Date();
        await registration.save();
        return res.json({ success: true, data: registration, message: 'Registration rejected' });
      }

      throw new BadRequestError('Action must be "approve" or "reject"');
    } catch (error) {
      next(error);
    }
  }

  // ===== AI-POWERED IMPORT =====

  /**
   * POST /api/teams/tournament/:tournamentId/ai-import (Step 1: upload + AI preview)
   */
  async aiImport(req, res, next) {
    try {
      if (!req.file) throw new BadRequestError('File required (.csv or .xlsx)');

      const tournament = await Tournament.findById(req.params.tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      const fileName = req.file.originalname.toLowerCase();
      let headers = [];
      let rows = [];

      if (fileName.endsWith('.csv')) {
        const csvContent = req.file.buffer.toString('utf-8');
        const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
        if (records.length > 0) {
          headers = Object.keys(records[0]);
          rows = records;
        }
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const XLSX = require('xlsx');
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (jsonData.length > 0) {
          headers = Object.keys(jsonData[0]);
          rows = jsonData;
        }
      } else {
        throw new BadRequestError('Unsupported file format. Use .csv or .xlsx');
      }

      if (rows.length === 0) throw new BadRequestError('File is empty or has no data rows');

      const aiService = require('../services/ai.service');
      const result = await aiService.mapImportColumns(headers, rows, tournament.sportType);

      res.json({
        success: true,
        data: {
          originalHeaders: headers,
          totalRows: rows.length,
          columnMapping: result.columnMapping,
          teams: result.teams,
          confidence: result.confidence,
          warnings: result.warnings || [],
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/teams/tournament/:tournamentId/ai-import/confirm (Step 2: confirm and create)
   */
  async confirmAiImport(req, res, next) {
    try {
      const { teams } = req.body;
      if (!teams || !Array.isArray(teams) || teams.length === 0) {
        throw new BadRequestError('No teams data provided');
      }

      const tournament = await Tournament.findById(req.params.tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      const results = { teams: 0, players: 0, errors: [] };

      for (const teamData of teams) {
        try {
          let team = await Team.findOne({ tournamentId: tournament._id, name: teamData.name, isActive: true });
          if (!team) {
            team = new Team({
              tournamentId: tournament._id,
              name: teamData.name,
              shortName: teamData.shortName || teamData.name.substring(0, 3).toUpperCase(),
            });
            await team.save();
            results.teams++;
          }

          for (const p of (teamData.players || [])) {
            if (!p.name) continue;
            try {
              let user = await User.findOne({ organizationId: tournament.organizationId, fullName: p.name });
              if (!user) {
                user = new User({ fullName: p.name, organizationId: tournament.organizationId, role: 'player', isActive: true });
                await user.save();
              }
              const already = team.players.find((tp) => tp.playerId.toString() === user._id.toString());
              if (!already) {
                team.players.push({ playerId: user._id, jerseyNumber: parseInt(p.jerseyNumber) || null, position: p.position || null, role: p.role || null });
                results.players++;
              }
            } catch (err) {
              results.errors.push(`Error adding ${p.name}: ${err.message}`);
            }
          }
          await team.save();
        } catch (err) {
          results.errors.push(`Error creating team ${teamData.name}: ${err.message}`);
        }
      }

      await createAuditEntry({
        organizationId: tournament.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.TEAM_CREATE,
        entityType: AUDIT_ENTITY_TYPES.TEAM,
        entityId: tournament._id,
        newValue: { source: 'ai_import', teamsCreated: results.teams, playersAdded: results.players },
        req,
      });

      res.status(201).json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TeamController();

const Tournament = require('../models/Tournament');
const Organization = require('../models/Organization');
const { createAuditEntry } = require('../middleware/audit');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, DEFAULT_RULES } = require('../utils/constants');
const { parsePagination, paginationMeta } = require('../utils/helpers');
const fixtureService = require('../services/fixture.service');

class TournamentController {
  /**
   * POST /api/tournaments
   */
  async create(req, res, next) {
    try {
      const {
        organizationId, name, description, sportType, format,
        numGroups, teamsPerGroup, teamsAdvancing, seeding,
        rulesConfig, startDate, endDate, venues, thirdPlaceMatch,
      } = req.body;

      // Verify org exists
      const org = await Organization.findById(organizationId);
      if (!org) throw new NotFoundError('Organization not found');

      const tournament = new Tournament({
        organizationId,
        name,
        description,
        sportType,
        format,
        numGroups: numGroups || (format === 'groups_knockout' ? 2 : 1),
        teamsPerGroup,
        teamsAdvancing: teamsAdvancing || 2,
        seeding: seeding || 'random',
        rulesConfig: rulesConfig || DEFAULT_RULES[sportType] || {},
        startDate,
        endDate,
        venues: venues || [],
        thirdPlaceMatch: thirdPlaceMatch || false,
        createdBy: req.userId,
      });

      await tournament.save();

      await createAuditEntry({
        organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.TOURNAMENT_CREATE,
        entityType: AUDIT_ENTITY_TYPES.TOURNAMENT,
        entityId: tournament._id,
        newValue: { name, sportType, format },
        req,
      });

      res.status(201).json({
        success: true,
        data: tournament,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tournaments/:tournamentId
   */
  async getById(req, res, next) {
    try {
      const tournament = await Tournament.findById(req.params.tournamentId)
        .populate('organizationId', 'name slug logoUrl')
        .populate('createdBy', 'fullName');

      if (!tournament) throw new NotFoundError('Tournament not found');

      res.json({
        success: true,
        data: tournament,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/tournaments/:tournamentId
   */
  async update(req, res, next) {
    try {
      const tournament = await Tournament.findById(req.params.tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      const oldValue = tournament.toObject();
      const allowedFields = [
        'name', 'description', 'logoUrl', 'format', 'numGroups',
        'teamsPerGroup', 'teamsAdvancing', 'seeding', 'rulesConfig',
        'startDate', 'endDate', 'venues', 'thirdPlaceMatch', 'swissRounds',
        'registrationSettings',
      ];

      const updates = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      Object.assign(tournament, updates);
      await tournament.save();

      // Separate audit for rules changes
      if (updates.rulesConfig) {
        await createAuditEntry({
          organizationId: tournament.organizationId,
          userId: req.userId,
          userRole: req.user.role,
          actionType: AUDIT_ACTIONS.RULES_UPDATE,
          entityType: AUDIT_ENTITY_TYPES.TOURNAMENT,
          entityId: tournament._id,
          oldValue: oldValue.rulesConfig,
          newValue: updates.rulesConfig,
          req,
        });
      }

      await createAuditEntry({
        organizationId: tournament.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.TOURNAMENT_UPDATE,
        entityType: AUDIT_ENTITY_TYPES.TOURNAMENT,
        entityId: tournament._id,
        oldValue,
        newValue: updates,
        req,
      });

      res.json({
        success: true,
        data: tournament,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/tournaments/:tournamentId/status
   */
  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const tournament = await Tournament.findById(req.params.tournamentId);
      if (!tournament) throw new NotFoundError('Tournament not found');

      const validTransitions = {
        draft: ['registration', 'active', 'cancelled'],
        registration: ['active', 'cancelled'],
        active: ['completed', 'cancelled'],
        completed: [],
        cancelled: ['draft'],
      };

      if (!validTransitions[tournament.status]?.includes(status)) {
        throw new BadRequestError(
          `Cannot transition from ${tournament.status} to ${status}`
        );
      }

      const oldStatus = tournament.status;
      tournament.status = status;
      await tournament.save();

      await createAuditEntry({
        organizationId: tournament.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.TOURNAMENT_STATUS_CHANGE,
        entityType: AUDIT_ENTITY_TYPES.TOURNAMENT,
        entityId: tournament._id,
        oldValue: { status: oldStatus },
        newValue: { status },
        req,
      });

      res.json({
        success: true,
        data: tournament,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/tournaments/:tournamentId/fixtures/generate
   */
  async generateFixtures(req, res, next) {
    try {
      const matches = await fixtureService.generateFixtures(
        req.params.tournamentId,
        req.userId
      );

      await createAuditEntry({
        organizationId: req.user.organizationId,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.FIXTURES_GENERATE,
        entityType: AUDIT_ENTITY_TYPES.TOURNAMENT,
        entityId: req.params.tournamentId,
        newValue: { matchCount: matches.length },
        req,
      });

      res.status(201).json({
        success: true,
        data: matches,
        message: `${matches.length} fixtures generated`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tournaments/org/:orgId
   */
  async getByOrg(req, res, next) {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const filter = { organizationId: req.params.orgId };

      if (req.query.status) filter.status = req.query.status;
      if (req.query.sportType) filter.sportType = req.query.sportType;

      const [tournaments, total] = await Promise.all([
        Tournament.find(filter)
          .select('name sportType format status startDate endDate logoUrl')
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 }),
        Tournament.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: tournaments,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tournaments (list all active — public)
   */
  async listActive(req, res, next) {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const filter = { status: { $in: ['registration', 'active'] } };

      if (req.query.sportType) filter.sportType = req.query.sportType;

      const [tournaments, total] = await Promise.all([
        Tournament.find(filter)
          .populate('organizationId', 'name slug logoUrl')
          .select('name sportType format status startDate endDate logoUrl organizationId')
          .skip(skip)
          .limit(limit)
          .sort({ startDate: 1 }),
        Tournament.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: tournaments,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tournaments/:tournamentId/registration-info (PUBLIC)
   */
  async getRegistrationInfo(req, res, next) {
    try {
      const tournament = await Tournament.findById(req.params.tournamentId)
        .select('name sportType format status registrationSettings description logoUrl startDate')
        .populate('organizationId', 'name logoUrl');

      if (!tournament) throw new NotFoundError('Tournament not found');

      const settings = tournament.registrationSettings || {};
      const isAccepting =
        tournament.status === 'registration' &&
        settings.isOpen !== false &&
        (!settings.deadline || new Date() <= new Date(settings.deadline));

      res.json({
        success: true,
        data: {
          tournament: {
            _id: tournament._id,
            name: tournament.name,
            sportType: tournament.sportType,
            format: tournament.format,
            description: tournament.description,
            logoUrl: tournament.logoUrl,
            startDate: tournament.startDate,
            organization: tournament.organizationId,
          },
          registration: {
            isAccepting,
            requireApproval: settings.requireApproval ?? true,
            instructions: settings.instructions || '',
            deadline: settings.deadline || null,
            maxTeams: settings.maxTeams || null,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TournamentController();

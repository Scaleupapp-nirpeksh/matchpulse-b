const Organization = require('../models/Organization');
const User = require('../models/User');
const { createAuditEntry } = require('../middleware/audit');
const { NotFoundError, ConflictError, BadRequestError } = require('../utils/errors');
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require('../utils/constants');
const { generateInviteCode, createSlug, parsePagination, paginationMeta } = require('../utils/helpers');
const emailService = require('../services/email.service');

class OrganizationController {
  /**
   * POST /api/organizations
   */
  async create(req, res, next) {
    try {
      const { name, slug, primaryColor, secondaryColor, description } = req.body;

      const orgSlug = slug || createSlug(name);

      // Check slug uniqueness
      const existing = await Organization.findOne({ slug: orgSlug });
      if (existing) {
        throw new ConflictError('Organization slug already taken');
      }

      const org = new Organization({
        name,
        slug: orgSlug,
        primaryColor,
        secondaryColor,
        description,
        adminUserIds: [req.userId],
      });

      await org.save();

      // Update user role to org_admin and link to org
      await User.findByIdAndUpdate(req.userId, {
        role: 'org_admin',
        organizationId: org._id,
      });

      await createAuditEntry({
        organizationId: org._id,
        userId: req.userId,
        userRole: 'org_admin',
        actionType: AUDIT_ACTIONS.ORG_CREATE,
        entityType: AUDIT_ENTITY_TYPES.ORGANIZATION,
        entityId: org._id,
        newValue: { name, slug: orgSlug },
        req,
      });

      res.status(201).json({
        success: true,
        data: org,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/organizations/:orgId
   */
  async getById(req, res, next) {
    try {
      const org = await Organization.findById(req.params.orgId)
        .populate('adminUserIds', 'fullName email avatarUrl');

      if (!org) throw new NotFoundError('Organization not found');

      res.json({
        success: true,
        data: org,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/organizations/slug/:slug
   */
  async getBySlug(req, res, next) {
    try {
      const org = await Organization.findOne({ slug: req.params.slug })
        .populate('adminUserIds', 'fullName email avatarUrl');

      if (!org) throw new NotFoundError('Organization not found');

      res.json({
        success: true,
        data: org,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/organizations/:orgId
   */
  async update(req, res, next) {
    try {
      const org = await Organization.findById(req.params.orgId);
      if (!org) throw new NotFoundError('Organization not found');

      const oldValue = org.toObject();

      const updates = {};
      const allowedFields = ['name', 'primaryColor', 'secondaryColor', 'description', 'logoUrl', 'settings'];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      Object.assign(org, updates);
      await org.save();

      await createAuditEntry({
        organizationId: org._id,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.ORG_UPDATE,
        entityType: AUDIT_ENTITY_TYPES.ORGANIZATION,
        entityId: org._id,
        oldValue,
        newValue: updates,
        req,
      });

      res.json({
        success: true,
        data: org,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/organizations/:orgId/invite
   */
  async invite(req, res, next) {
    try {
      const { role, email, phone, tournamentId } = req.body;
      const org = await Organization.findById(req.params.orgId);
      if (!org) throw new NotFoundError('Organization not found');

      const code = generateInviteCode();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      org.inviteCodes.push({
        code,
        role,
        tournamentId: tournamentId || null,
        expiresAt,
      });

      await org.save();

      // Send invite email if email provided
      let emailSent = false;
      let emailError = null;
      if (email) {
        try {
          await emailService.sendInviteEmail({
            to: email,
            orgName: org.name,
            inviteCode: code,
            role,
            inviterName: req.user.fullName,
          });
          emailSent = true;
        } catch (err) {
          emailError = err.message;
          console.error('Invite email failed:', err.message);
        }
      }

      await createAuditEntry({
        organizationId: org._id,
        userId: req.userId,
        userRole: req.user.role,
        actionType: AUDIT_ACTIONS.ORG_INVITE,
        entityType: AUDIT_ENTITY_TYPES.ORGANIZATION,
        entityId: org._id,
        newValue: { code, role, email, phone },
        req,
      });

      const inviteUrl = `${require('../config/env').CLIENT_URL}/invite/${code}`;

      res.status(201).json({
        success: true,
        data: {
          inviteCode: code,
          role,
          expiresAt,
          inviteUrl,
          emailSent,
          emailError: emailError || undefined,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/organizations/join/:inviteCode
   */
  async joinByInvite(req, res, next) {
    try {
      const { inviteCode } = req.params;

      const org = await Organization.findOne({
        'inviteCodes.code': inviteCode,
        'inviteCodes.usedBy': null,
        'inviteCodes.expiresAt': { $gt: new Date() },
      });

      if (!org) throw new NotFoundError('Invalid or expired invite code');

      const invite = org.inviteCodes.find(
        (ic) => ic.code === inviteCode && !ic.usedBy
      );

      if (!invite) throw new NotFoundError('Invite code already used');

      // Update user
      await User.findByIdAndUpdate(req.userId, {
        organizationId: org._id,
        role: invite.role,
        ...(invite.tournamentId ? {
          $push: {
            tournamentRoles: {
              tournamentId: invite.tournamentId,
              role: invite.role,
            },
          },
        } : {}),
      });

      // Mark invite as used
      invite.usedBy = req.userId;
      invite.usedAt = new Date();
      await org.save();

      res.json({
        success: true,
        data: {
          organization: { _id: org._id, name: org.name, slug: org.slug },
          role: invite.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/organizations/:orgId/members
   */
  async getMembers(req, res, next) {
    try {
      const { page, limit, skip } = parsePagination(req.query);

      const [members, total] = await Promise.all([
        User.find({ organizationId: req.params.orgId, isActive: true })
          .select('fullName email phone role avatarUrl preferredSports')
          .skip(skip)
          .limit(limit)
          .sort({ role: 1, fullName: 1 }),
        User.countDocuments({ organizationId: req.params.orgId, isActive: true }),
      ]);

      res.json({
        success: true,
        data: members,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/organizations (list all — public)
   */
  async list(req, res, next) {
    try {
      const { page, limit, skip } = parsePagination(req.query);

      const [orgs, total] = await Promise.all([
        Organization.find({ isActive: true })
          .select('name slug logoUrl primaryColor description')
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 }),
        Organization.countDocuments({ isActive: true }),
      ]);

      res.json({
        success: true,
        data: orgs,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new OrganizationController();

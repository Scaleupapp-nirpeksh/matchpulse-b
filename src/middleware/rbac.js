const { ForbiddenError } = require('../utils/errors');
const { USER_ROLES, ROLE_HIERARCHY } = require('../utils/constants');
const Organization = require('../models/Organization');
const Tournament = require('../models/Tournament');

/**
 * Require specific roles
 * Usage: requireRole('org_admin', 'platform_admin')
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ForbiddenError('Authentication required'));
    }

    // Platform admin can do anything
    if (req.user.role === USER_ROLES.PLATFORM_ADMIN) {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      // Check tournament-specific roles
      const tournamentId = req.params.tournamentId || req.body.tournamentId;
      if (tournamentId && req.user.tournamentRoles) {
        const tournamentRole = req.user.tournamentRoles.find(
          (tr) => tr.tournamentId.toString() === tournamentId.toString()
        );
        if (tournamentRole && allowedRoles.includes(tournamentRole.role)) {
          return next();
        }
      }

      return next(new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`));
    }

    next();
  };
};

/**
 * Require minimum role level (uses hierarchy)
 * Usage: requireMinRole('tournament_admin') — allows tournament_admin, org_admin, platform_admin
 */
const requireMinRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ForbiddenError('Authentication required'));
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;

    if (userLevel >= requiredLevel) {
      return next();
    }

    // Check tournament-specific roles
    const tournamentId = req.params.tournamentId || req.body.tournamentId;
    if (tournamentId && req.user.tournamentRoles) {
      const tournamentRole = req.user.tournamentRoles.find(
        (tr) => tr.tournamentId.toString() === tournamentId.toString()
      );
      if (tournamentRole) {
        const trLevel = ROLE_HIERARCHY[tournamentRole.role] || 0;
        if (trLevel >= requiredLevel) {
          return next();
        }
      }
    }

    return next(new ForbiddenError(`Access denied. Minimum role: ${minRole}`));
  };
};

/**
 * Require that the user belongs to the organization
 * Checks req.params.orgId or req.params.organizationId
 */
const requireOrgMembership = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ForbiddenError('Authentication required'));
    }

    // Platform admin bypasses
    if (req.user.role === USER_ROLES.PLATFORM_ADMIN) {
      return next();
    }

    const orgId = req.params.orgId || req.params.organizationId || req.body.organizationId;

    if (!orgId) {
      return next(new ForbiddenError('Organization context required'));
    }

    // Check if user belongs to this org
    if (req.user.organizationId && req.user.organizationId.toString() === orgId.toString()) {
      return next();
    }

    // Check if user is an admin of this org
    const org = await Organization.findById(orgId);
    if (org && org.adminUserIds.some((id) => id.toString() === req.user._id.toString())) {
      return next();
    }

    return next(new ForbiddenError('You do not belong to this organization'));
  } catch (error) {
    next(error);
  }
};

/**
 * Require that the user is the assigned scorer for the match
 * or is an admin
 */
const requireScorerOrAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ForbiddenError('Authentication required'));
    }

    // Platform admin and org admin bypass
    if ([USER_ROLES.PLATFORM_ADMIN, USER_ROLES.ORG_ADMIN].includes(req.user.role)) {
      return next();
    }

    // Check tournament admin role
    const tournamentId = req.params.tournamentId;
    if (tournamentId && req.user.tournamentRoles) {
      const tournamentRole = req.user.tournamentRoles.find(
        (tr) => tr.tournamentId.toString() === tournamentId
      );
      if (tournamentRole && tournamentRole.role === USER_ROLES.TOURNAMENT_ADMIN) {
        return next();
      }
    }

    // For scorers, we'll check in the controller (need match data)
    if (req.user.role === USER_ROLES.SCORER) {
      req.requireScorerCheck = true;
      return next();
    }

    return next(new ForbiddenError('Scorer or admin access required'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requireRole,
  requireMinRole,
  requireOrgMembership,
  requireScorerOrAdmin,
};

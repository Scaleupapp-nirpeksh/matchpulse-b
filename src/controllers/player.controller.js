const User = require('../models/User');
const Team = require('../models/Team');
const PlayerMatchStats = require('../models/PlayerMatchStats');
const Match = require('../models/Match');
const { NotFoundError } = require('../utils/errors');
const { parsePagination, paginationMeta } = require('../utils/helpers');

class PlayerController {
  /**
   * GET /api/players/:playerId
   */
  async getProfile(req, res, next) {
    try {
      const player = await User.findById(req.params.playerId)
        .select('fullName email avatarUrl bio preferredSports organizationId privacySettings createdAt')
        .populate('organizationId', 'name slug');

      if (!player) throw new NotFoundError('Player not found');

      // Respect privacy settings
      const profile = player.toObject();
      if (!profile.privacySettings?.showPhoto) {
        profile.avatarUrl = null;
      }

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/players/:playerId/stats
   * Career stats across all sports
   */
  async getStats(req, res, next) {
    try {
      const { playerId } = req.params;
      const { sportType, tournamentId } = req.query;

      const player = await User.findById(playerId);
      if (!player) throw new NotFoundError('Player not found');

      if (!player.privacySettings?.showStats) {
        return res.json({
          success: true,
          data: { message: 'Stats are private' },
        });
      }

      const filter = { playerId };
      if (sportType) filter.sportType = sportType;
      if (tournamentId) filter.tournamentId = tournamentId;

      const stats = await PlayerMatchStats.find(filter)
        .populate('matchId', 'status resultSummary scheduledAt')
        .populate('teamId', 'name shortName')
        .populate('tournamentId', 'name sportType')
        .sort({ createdAt: -1 });

      // Aggregate career stats per sport
      const careerStats = {};
      for (const stat of stats) {
        const sport = stat.sportType;
        if (!careerStats[sport]) {
          careerStats[sport] = {
            matches: 0,
            aggregated: {},
          };
        }
        careerStats[sport].matches++;

        // Aggregate numeric stats
        if (stat.stats) {
          for (const [key, value] of Object.entries(stat.stats)) {
            if (typeof value === 'number') {
              careerStats[sport].aggregated[key] = (careerStats[sport].aggregated[key] || 0) + value;
            }
          }
        }
      }

      res.json({
        success: true,
        data: {
          player: { _id: player._id, fullName: player.fullName },
          careerStats,
          matchStats: stats,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/players/:playerId/matches
   * Match history
   */
  async getMatches(req, res, next) {
    try {
      const { playerId } = req.params;
      const { page, limit, skip } = parsePagination(req.query);

      // Find teams the player belongs to
      const teams = await Team.find({ 'players.playerId': playerId }).select('_id');
      const teamIds = teams.map((t) => t._id);

      const filter = {
        $or: [
          { teamA: { $in: teamIds } },
          { teamB: { $in: teamIds } },
        ],
        status: { $in: ['completed', 'live'] },
      };

      const [matches, total] = await Promise.all([
        Match.find(filter)
          .populate('teamA', 'name shortName color')
          .populate('teamB', 'name shortName color')
          .populate('tournamentId', 'name sportType')
          .select('sportType status resultSummary scheduledAt stage')
          .skip(skip)
          .limit(limit)
          .sort({ scheduledAt: -1 }),
        Match.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: matches,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/players/org/:orgId
   * List all players in an org (org-level player pool)
   */
  async getByOrg(req, res, next) {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const { search } = req.query;

      const filter = {
        organizationId: req.params.orgId,
        isActive: true,
      };

      if (search) {
        filter.fullName = { $regex: search, $options: 'i' };
      }

      const [players, total] = await Promise.all([
        User.find(filter)
          .select('fullName email phone avatarUrl bio preferredSports role')
          .skip(skip)
          .limit(limit)
          .sort({ fullName: 1 }),
        User.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: players,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/players/:playerId
   * Admin update player details
   */
  async update(req, res, next) {
    try {
      const player = await User.findById(req.params.playerId);
      if (!player) throw new NotFoundError('Player not found');

      const allowedFields = ['fullName', 'bio', 'avatarUrl', 'preferredSports', 'jerseyNumber'];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          player[field] = req.body[field];
        }
      }

      await player.save();

      res.json({
        success: true,
        data: player.toPublicJSON(),
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PlayerController();

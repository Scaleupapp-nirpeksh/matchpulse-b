const standingsService = require('../services/standings.service');

class StandingsController {
  /**
   * GET /api/standings/tournament/:tournamentId
   */
  async getStandings(req, res, next) {
    try {
      const { tournamentId } = req.params;
      const { groupName } = req.query;

      const standings = await standingsService.getStandings(tournamentId, groupName);

      res.json({
        success: true,
        data: standings,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/standings/tournament/:tournamentId/recalculate
   * Force recalculate rankings (admin only)
   */
  async recalculate(req, res, next) {
    try {
      const { tournamentId } = req.params;
      const { groupName } = req.body;

      const standings = await standingsService.recalculateRankings(tournamentId, groupName);

      res.json({
        success: true,
        data: standings,
        message: 'Rankings recalculated',
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StandingsController();

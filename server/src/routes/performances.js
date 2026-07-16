import { Router } from "express";
import { pool } from "../db.js";

export const performancesRouter = Router();

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

// GET /api/performances?page=1&pageSize=25
performancesRouter.get("/", async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const requestedSize = Number.parseInt(req.query.pageSize, 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize)
    ? requestedSize
    : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  try {
    const totalResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM performances"
    );
    const total = totalResult.rows[0].total;

    const { rows } = await pool.query(
      `SELECT pf.id,
              p.player_id,
              p.player_name,
              p.team,
              p.position,
              m.match_id,
              m.match_date,
              pf.opponent_team,
              pf.match_result,
              pf.goals,
              pf.assists,
              pf.minutes_played,
              pf.player_rating
       FROM performances pf
       JOIN players p ON p.player_id = pf.player_id
       JOIN matches m ON m.match_id = pf.match_id
       ORDER BY pf.id
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    res.json({
      data: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      pageSizeOptions: ALLOWED_PAGE_SIZES,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch performances" });
  }
});

import { Router } from "express";
import { pool } from "../db.js";

export const rankingsRouter = Router();

const SORTABLE = {
  goals: "total_goals",
  assists: "total_assists",
  rating: "avg_rating",
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// GET /api/rankings?sort=goals&limit=25
// Per-player aggregates via JOIN + GROUP BY (SUM / COUNT / AVG).
rankingsRouter.get("/", async (req, res) => {
  const sortKey = SORTABLE[req.query.sort] ? req.query.sort : "goals";
  const sortColumn = SORTABLE[sortKey];

  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  try {
    const { rows } = await pool.query(
      `SELECT p.player_id,
              p.player_name,
              p.team,
              p.position,
              p.nationality,
              COUNT(pf.id)::int                    AS matches_played,
              COALESCE(SUM(pf.goals), 0)::int      AS total_goals,
              COALESCE(SUM(pf.assists), 0)::int    AS total_assists,
              ROUND(AVG(pf.player_rating), 2)      AS avg_rating
       FROM players p
       JOIN performances pf ON pf.player_id = p.player_id
       GROUP BY p.player_id, p.player_name, p.team, p.position, p.nationality
       ORDER BY ${sortColumn} DESC, p.player_name ASC
       LIMIT $1`,
      [limit]
    );

    const data = rows.map((row, index) => ({
      rank: index + 1,
      ...row,
    }));

    res.json({
      data,
      sort: sortKey,
      limit,
      sortOptions: Object.keys(SORTABLE),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch rankings" });
  }
});

import { Router } from "express";
import type { Request } from "express";
import { pool } from "../db.js";

export const rankingsRouter = Router();

const SORTABLE = {
  goals: "total_goals",
  assists: "total_assists",
  rating: "avg_rating",
} as const;

type SortKey = keyof typeof SORTABLE;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// GET /api/rankings?sort=goals&limit=25
rankingsRouter.get("/", async (req: Request, res) => {
  const requestedSort = queryString(req.query.sort);
  const sortKey: SortKey =
    requestedSort in SORTABLE ? (requestedSort as SortKey) : "goals";
  const sortColumn = SORTABLE[sortKey];

  let limit = Number.parseInt(queryString(req.query.limit), 10);
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

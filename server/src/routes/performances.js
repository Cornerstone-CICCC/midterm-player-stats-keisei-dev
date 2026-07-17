import { Router } from "express";
import { pool } from "../db.js";

export const performancesRouter = Router();

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

// Sort column can't be a bind param — only keys from this map are ever interpolated.
const SORTABLE_COLUMNS = {
  id: "pf.id",
  player_name: "p.player_name",
  team: "p.team",
  position: "p.position",
  match_date: "m.match_date",
  goals: "pf.goals",
  assists: "pf.assists",
  minutes_played: "pf.minutes_played",
  player_rating: "pf.player_rating",
};

function buildFilters(query) {
  const conditions = [];
  const params = [];

  if (query.q && query.q.trim() !== "") {
    params.push(`%${query.q.trim()}%`);
    conditions.push(`p.player_name ILIKE $${params.length}`);
  }
  if (query.position && query.position.trim() !== "") {
    params.push(query.position.trim());
    conditions.push(`p.position = $${params.length}`);
  }
  if (query.team && query.team.trim() !== "") {
    params.push(query.team.trim());
    conditions.push(`p.team = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

const EDITABLE_FIELDS = [
  "opponent_team",
  "match_result",
  "minutes_played",
  "goals",
  "assists",
  "shots",
  "shots_on_target",
  "player_rating",
];

function pickEditable(body) {
  const fields = [];
  const values = [];
  for (const key of EDITABLE_FIELDS) {
    if (body[key] !== undefined) {
      fields.push(key);
      values.push(body[key] === "" ? null : body[key]);
    }
  }
  return { fields, values };
}

// GET /api/performances/filters — distinct values for dropdowns
performancesRouter.get("/filters", async (req, res) => {
  try {
    const positions = await pool.query(
      "SELECT DISTINCT position FROM players WHERE position IS NOT NULL ORDER BY position"
    );
    const teams = await pool.query(
      "SELECT DISTINCT team FROM players WHERE team IS NOT NULL ORDER BY team"
    );
    res.json({
      positions: positions.rows.map((r) => r.position),
      teams: teams.rows.map((r) => r.team),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch filter options" });
  }
});

// GET /api/performances?page=&pageSize=&q=&position=&team=&sort=&order=
performancesRouter.get("/", async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const requestedSize = Number.parseInt(req.query.pageSize, 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize)
    ? requestedSize
    : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const sortColumn = SORTABLE_COLUMNS[req.query.sort] || SORTABLE_COLUMNS.id;
  const sortOrder =
    String(req.query.order).toLowerCase() === "desc" ? "DESC" : "ASC";

  const { where, params } = buildFilters(req.query);

  try {
    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM performances pf
       JOIN players p ON p.player_id = pf.player_id
       JOIN matches m ON m.match_id = pf.match_id
       ${where}`,
      params
    );
    const total = totalResult.rows[0].total;

    const dataParams = [...params, pageSize, offset];
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
       ${where}
       ORDER BY ${sortColumn} ${sortOrder}, pf.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams
    );

    res.json({
      data: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      pageSizeOptions: ALLOWED_PAGE_SIZES,
      sort: Object.keys(SORTABLE_COLUMNS).find(
        (k) => SORTABLE_COLUMNS[k] === sortColumn
      ),
      order: sortOrder.toLowerCase(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch performances" });
  }
});

// GET /api/performances/:id
performancesRouter.get("/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT pf.*,
              p.player_name, p.age, p.nationality, p.team, p.position,
              p.jersey_number, p.club_name,
              m.match_date, m.stadium, m.city, m.tournament_stage
       FROM performances pf
       JOIN players p ON p.player_id = pf.player_id
       JOIN matches m ON m.match_id = pf.match_id
       WHERE pf.id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Performance not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch performance" });
  }
});

// POST /api/performances
performancesRouter.post("/", async (req, res) => {
  const { player_id, match_id } = req.body;
  if (!player_id || !match_id) {
    return res.status(400).json({ error: "player_id and match_id are required" });
  }

  const { fields, values } = pickEditable(req.body);
  const columns = ["player_id", "match_id", ...fields];
  const allValues = [player_id, match_id, ...values];
  const placeholders = allValues.map((_, i) => `$${i + 1}`);

  try {
    const { rows } = await pool.query(
      `INSERT INTO performances (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      allValues
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23503") {
      return res.status(400).json({ error: "Unknown player_id or match_id" });
    }
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "This player already has a row for that match" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create performance" });
  }
});

// PUT /api/performances/:id
performancesRouter.put("/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const { fields, values } = pickEditable(req.body);
  if (fields.length === 0) {
    return res.status(400).json({ error: "No editable fields provided" });
  }

  const assignments = fields.map((f, i) => `${f} = $${i + 1}`);
  try {
    const { rows } = await pool.query(
      `UPDATE performances
       SET ${assignments.join(", ")}
       WHERE id = $${fields.length + 1}
       RETURNING *`,
      [...values, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Performance not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update performance" });
  }
});

// DELETE /api/performances/:id
performancesRouter.delete("/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM performances WHERE id = $1",
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Performance not found" });
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete performance" });
  }
});

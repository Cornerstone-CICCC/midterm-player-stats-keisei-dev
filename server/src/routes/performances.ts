import { Router } from "express";
import type { Request } from "express";
import { query } from "../db.js";

export const performancesRouter = Router();

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

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
} as const;

type SortKey = keyof typeof SORTABLE_COLUMNS;

const EDITABLE_FIELDS = [
  "opponent_team",
  "match_result",
  "minutes_played",
  "goals",
  "assists",
  "shots",
  "shots_on_target",
  "player_rating",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildFilters(query: Request["query"]) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const q = queryString(query.q).trim();
  if (q !== "") {
    params.push(`%${q}%`);
    conditions.push(`p.player_name ILIKE $${params.length}`);
  }

  const position = queryString(query.position).trim();
  if (position !== "") {
    params.push(position);
    conditions.push(`p.position = $${params.length}`);
  }

  const team = queryString(query.team).trim();
  if (team !== "") {
    params.push(team);
    conditions.push(`p.team = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

function pickEditable(body: Record<string, unknown>) {
  const fields: EditableField[] = [];
  const values: unknown[] = [];
  for (const key of EDITABLE_FIELDS) {
    if (body[key] !== undefined) {
      fields.push(key);
      values.push(body[key] === "" ? null : body[key]);
    }
  }
  return { fields, values };
}

function isPgError(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

// GET /api/performances/filters
performancesRouter.get("/filters", async (_req, res) => {
  try {
    const positions = await query<{ position: string }>(
      "SELECT DISTINCT position FROM players WHERE position IS NOT NULL ORDER BY position"
    );
    const teams = await query<{ team: string }>(
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

// GET /api/performances
performancesRouter.get("/", async (req, res) => {
  const page = Math.max(1, Number.parseInt(queryString(req.query.page), 10) || 1);
  const requestedSize = Number.parseInt(queryString(req.query.pageSize), 10);
  const pageSize = (ALLOWED_PAGE_SIZES as readonly number[]).includes(requestedSize)
    ? requestedSize
    : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const requestedSort = queryString(req.query.sort);
  const sortKey: SortKey =
    requestedSort in SORTABLE_COLUMNS ? (requestedSort as SortKey) : "id";
  const sortColumn = SORTABLE_COLUMNS[sortKey];
  const sortOrder =
    queryString(req.query.order).toLowerCase() === "desc" ? "DESC" : "ASC";

  const { where, params } = buildFilters(req.query);

  try {
    const totalResult = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM performances pf
       JOIN players p ON p.player_id = pf.player_id
       JOIN matches m ON m.match_id = pf.match_id
       ${where}`,
      params
    );
    const total = totalResult.rows[0].total;

    const dataParams = [...params, pageSize, offset];
    const { rows } = await query(
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
      sort: sortKey,
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
    const { rows } = await query(
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
  const { player_id, match_id } = req.body as {
    player_id?: string;
    match_id?: string;
  };
  if (!player_id || !match_id) {
    return res.status(400).json({ error: "player_id and match_id are required" });
  }

  const { fields, values } = pickEditable(req.body as Record<string, unknown>);
  const columns = ["player_id", "match_id", ...fields];
  const allValues = [player_id, match_id, ...values];
  const placeholders = allValues.map((_, i) => `$${i + 1}`);

  try {
    const { rows } = await query(
      `INSERT INTO performances (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      allValues
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (isPgError(err) && err.code === "23503") {
      return res.status(400).json({ error: "Unknown player_id or match_id" });
    }
    if (isPgError(err) && err.code === "23505") {
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

  const { fields, values } = pickEditable(req.body as Record<string, unknown>);
  if (fields.length === 0) {
    return res.status(400).json({ error: "No editable fields provided" });
  }

  const assignments = fields.map((f, i) => `${f} = $${i + 1}`);
  try {
    const { rows } = await query(
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
    const { rowCount } = await query(
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

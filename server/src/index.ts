import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Imported after dotenv runs so the pool sees the PG* env vars.
const { pool } = await import("./db.js");
const { performancesRouter } = await import("./routes/performances.js");
const { rankingsRouter } = await import("./routes/rankings.js");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/performances", performancesRouter);
app.use("/api/rankings", rankingsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "player-stats-api" });
});

app.get("/api/health/db", async (_req, res) => {
  try {
    const { rows } = await pool.query<{
      players: string;
      matches: string;
      performances: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM players)      AS players,
         (SELECT COUNT(*) FROM matches)      AS matches,
         (SELECT COUNT(*) FROM performances) AS performances`
    );
    res.json({ status: "ok", counts: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "database unavailable" });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

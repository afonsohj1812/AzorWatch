import express from "express";
import cron from "node-cron";

import { islands, getIsland } from "./config/islands.js";
import { findForecast, findOverlay } from "./services/db.js";
import { loadDem } from "./services/dem.js";
import { inspectCell } from "./services/fogModel.js";
import { inspectSeaCell } from "./services/seaModel.js";
import { runPipeline } from "./services/pipeline.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.param("islandId", (req, res, next, id) =>
  getIsland(id) ? next() : res.status(404).json({ error: "unknown island" }),
);

function sendOverlay(req, res, doc) {
  if (!doc) return res.status(404).json({ error: "unknown hour" });

  res.set({
    "Content-Type": "image/png",
    ETag: doc.etag,
    "Cache-Control": "public, max-age=1800",
  });

  if (req.headers["if-none-match"] === doc.etag) return res.status(304).end();
  res.send(Buffer.isBuffer(doc.png) ? doc.png : doc.png.buffer);
}

// Islands with map boundaries and center
app.get("/api/islands", (req, res) => {
  res.json(islands);
});

// Island days and hours color categories
app.get("/api/forecast/:islandId", async (req, res, next) => {
  try {
    const doc = await findForecast("fog", req.params.islandId);
    if (!doc) return res.status(503).json({ error: "forecast not stored yet" });

    const { time, ...summary } = doc;
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Island dive conditions, days and hours color categories
app.get("/api/sea/:islandId", async (req, res, next) => {
  try {
    const doc = await findForecast("sea", req.params.islandId);
    if (!doc) return res.status(503).json({ error: "forecast not stored yet" });

    const { time, ...summary } = doc;
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Island hour fog prediction image to overlay on the map
app.get("/api/fog/:islandId/:hour.png", async (req, res, next) => {
  try {
    const { islandId, hour } = req.params;
    sendOverlay(req, res, await findOverlay("fog", islandId, "overall", hour));
  } catch (err) {
    next(err);
  }
});

// Island hour dive conditions image to overlay on the map
app.get("/api/sea/:islandId/:hour.png", async (req, res, next) => {
  try {
    const { islandId, hour } = req.params;
    sendOverlay(req, res, await findOverlay("sea", islandId, "overall", hour));
  } catch (err) {
    next(err);
  }
});

// Island hour image for a single dive layer, such as wave or visibility
app.get("/api/sea/:islandId/:layer/:hour.png", async (req, res, next) => {
  try {
    const { islandId, layer, hour } = req.params;
    sendOverlay(req, res, await findOverlay("sea", islandId, layer, hour));
  } catch (err) {
    next(err);
  }
});

// Island hour pixel information (height, visibility, etc...)
app.get("/api/point/:islandId/:hour", async (req, res, next) => {
  try {
    const { islandId, hour } = req.params;
    const x = Number(req.query.x);
    const y = Number(req.query.y);
    if (!Number.isInteger(x) || !Number.isInteger(y))
      return res.status(400).json({ error: "x and y required" });

    const doc = await findForecast("fog", islandId);
    if (!doc) return res.status(503).json({ error: "forecast not stored yet" });

    const index = doc.time.indexOf(hour);
    if (index === -1) return res.status(404).json({ error: "unknown hour" });

    const dem = await loadDem(islandId);
    res.json(inspectCell(dem, doc, index, hour, x, y));
  } catch (err) {
    next(err);
  }
});

// Island hour dive conditions for one cell of the coastal band
app.get("/api/sea/point/:islandId/:hour", async (req, res, next) => {
  try {
    const { islandId, hour } = req.params;
    const x = Number(req.query.x);
    const y = Number(req.query.y);
    if (!Number.isInteger(x) || !Number.isInteger(y))
      return res.status(400).json({ error: "x and y required" });

    const doc = await findForecast("sea", islandId);
    if (!doc) return res.status(503).json({ error: "forecast not stored yet" });

    const index = doc.time.indexOf(hour);
    if (index === -1) return res.status(404).json({ error: "unknown hour" });

    const dem = await loadDem(islandId);
    res.json(inspectSeaCell(dem, doc, index, hour, x, y));
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  console.log(`AzorWatch backend listening on :${port}`);
});

await runPipeline().catch(console.error);
cron.schedule("0 * * * *", () => runPipeline().catch(console.error));

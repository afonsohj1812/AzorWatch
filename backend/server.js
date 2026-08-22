import express from "express";
import cron from "node-cron";

import { islands, getIsland } from "./config/islands.js";
import { findForecast, findOverlay } from "./services/db.js";
import { loadDem } from "./services/dem.js";
import { inspectCell, runPipeline } from "./services/fogModel.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`AzorWatch backend listening on :${port}`);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.param("islandId", (req, res, next, id) =>
  getIsland(id) ? next() : res.status(404).json({ error: "unknown island" }),
);

// Islands with map boundaries and center
app.get("/api/islands", (req, res) => {
  res.json(islands);
});

// Island days and hours color categories
app.get("/api/forecast/:islandId", async (req, res, next) => {
  try {
    const doc = await findForecast(req.params.islandId);
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
    const doc = await findOverlay(islandId, hour);
    if (!doc) return res.status(404).json({ error: "unknown hour" });

    res.set({
      "Content-Type": "image/png",
      ETag: doc.etag,
      "Cache-Control": "public, max-age=1800",
    });

    if (req.headers["if-none-match"] === doc.etag) return res.status(304).end();
    res.send(Buffer.isBuffer(doc.png) ? doc.png : doc.png.buffer);
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

    const doc = await findForecast(islandId);
    if (!doc) return res.status(503).json({ error: "forecast not stored yet" });

    const index = doc.time.indexOf(hour);
    if (index === -1) return res.status(404).json({ error: "unknown hour" });

    const dem = await loadDem(islandId);
    res.json(inspectCell(dem, doc.conditions[index], hour, x, y));
  } catch (err) {
    next(err);
  }
});

await runPipeline();
cron.schedule("0 * * * *", () => runPipeline().catch(console.error));

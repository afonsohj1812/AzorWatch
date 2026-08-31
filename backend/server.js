import express from "express";
import cron from "node-cron";

import { islands, getIsland } from "./config/islands.js";
import { getMode } from "./config/modes.js";
import { findForecast, findOverlay } from "./services/db.js";
import { loadDem } from "./services/dem.js";
import { runPipeline } from "./services/pipeline.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.param("islandId", (req, res, next, id) =>
  getIsland(id) ? next() : res.status(404).json({ error: "unknown island" }),
);

app.param("mode", (req, res, next, id) =>
  getMode(id) ? next() : res.status(404).json({ error: "unknown mode" }),
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

// One cell of one island for one hour, in whichever mode is asked for
app.get("/api/:mode/point/:islandId/:hour", async (req, res, next) => {
  try {
    const { mode, islandId, hour } = req.params;
    const x = Number(req.query.x);
    const y = Number(req.query.y);
    if (!Number.isInteger(x) || !Number.isInteger(y))
      return res.status(400).json({ error: "x and y required" });

    const doc = await findForecast(mode, islandId);
    if (!doc) return res.status(503).json({ error: "forecast not stored yet" });

    const index = doc.time.indexOf(hour);
    if (index === -1) return res.status(404).json({ error: "unknown hour" });

    const dem = await loadDem(islandId);
    res.json(getMode(mode).inspect(dem, doc, index, hour, x, y));
  } catch (err) {
    next(err);
  }
});

// Island days and hours color categories
app.get("/api/:mode/:islandId", async (req, res, next) => {
  try {
    const doc = await findForecast(req.params.mode, req.params.islandId);
    if (!doc) return res.status(503).json({ error: "forecast not stored yet" });

    const { time, ...summary } = doc;
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Island hour image to overlay on the map
app.get("/api/:mode/:islandId/:hour.png", async (req, res, next) => {
  try {
    const { mode, islandId, hour } = req.params;
    sendOverlay(req, res, await findOverlay(mode, islandId, "overall", hour));
  } catch (err) {
    next(err);
  }
});

// Island hour image for a single layer, such as wave or cloud cover
app.get("/api/:mode/:islandId/:layer/:hour.png", async (req, res, next) => {
  try {
    const { mode, islandId, layer, hour } = req.params;
    sendOverlay(req, res, await findOverlay(mode, islandId, layer, hour));
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

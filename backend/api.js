import { Router } from "express";

import { islands, getIsland } from "./shared/islands.js";
import {
  getIslandSummary,
  getIslandFog,
  inspectPoint,
} from "./services/fogModel.js";
import { renderOverlay } from "./services/render.js";

const api = Router();

// Islands with map boundaries and center
api.get("/islands", (req, res) => {
  res.json(islands);
});

// Island days and hours color categories
api.get("/forecast/:islandId", async (req, res, next) => {
  try {
    const { islandId } = req.params;
    if (!getIsland(islandId))
      return res.status(404).json({ error: "unknown island" });

    res.json(await getIslandSummary(islandId));
  } catch (err) {
    next(err);
  }
});

// Island hour fog prediction image to overlay on the map
api.get("/fog/:islandId/:hour.png", async (req, res, next) => {
  try {
    const { islandId, hour } = req.params;
    if (!getIsland(islandId))
      return res.status(404).json({ error: "unknown island" });

    const fog = await getIslandFog(islandId);
    const index = fog.time.indexOf(hour);
    if (index === -1) return res.status(404).json({ error: "unknown hour" });

    const overlay = await renderOverlay(islandId, index);

    res.set({
      "Content-Type": "image/png",
      ETag: overlay.etag,
      "Cache-Control": "public, max-age=1800",
    });

    if (req.headers["if-none-match"] === overlay.etag)
      return res.status(304).end();
    res.send(overlay.buffer);
  } catch (err) {
    next(err);
  }
});

// Island hour pixel information (height, visibility, etc...)
api.get("/point/:islandId/:hour", async (req, res, next) => {
  try {
    const { islandId, hour } = req.params;
    if (!getIsland(islandId))
      return res.status(404).json({ error: "unknown island" });

    const x = Number(req.query.x);
    const y = Number(req.query.y);
    if (!Number.isInteger(x) || !Number.isInteger(y))
      return res.status(400).json({ error: "x and y required" });

    const fog = await getIslandFog(islandId);
    const index = fog.time.indexOf(hour);
    if (index === -1) return res.status(404).json({ error: "unknown hour" });

    const point = await inspectPoint(islandId, index, x, y);
    if (!point) return res.json(null);

    res.json(point);
  } catch (err) {
    next(err);
  }
});

export default api;

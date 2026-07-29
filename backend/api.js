import { Router } from "express";

import { islands, getIsland } from "./shared/islands.js";
import { getIslandFog, FOG_CLASS_NAMES } from "./services/fogModel.js";
import { renderOverlay } from "./services/render.js";

const api = Router();

const HOURS_PER_DAY = 24;

const asUtc = (date) => new Date(`${date}T00:00:00Z`);
const dayLabel = (date) =>
  asUtc(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
const weekday = (date) =>
  asUtc(date).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });

api.get("/health", (req, res) => {
  res.json({ ok: true, islands: islands.length });
});

api.get("/islands", (req, res) => {
  res.json(islands);
});

api.get("/forecast/:islandId", async (req, res, next) => {
  try {
    const { islandId } = req.params;
    if (!getIsland(islandId))
      return res.status(404).json({ error: "unknown island" });

    const fog = await getIslandFog(islandId);
    const days = [];

    for (let day = 0; day < fog.dayMax.length; day++) {
      const start = day * HOURS_PER_DAY;
      const date = fog.time[start].slice(0, 10);

      days.push({
        date,
        label: dayLabel(date),
        weekday: weekday(date),
        maxClass: FOG_CLASS_NAMES[fog.dayMax[day]],
        hours: Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
          time: fog.time[start + h],
          maxClass: FOG_CLASS_NAMES[fog.hourMax[start + h]],
        })),
      });
    }

    res.json({
      island: islandId,
      runAt: fog.runAt,
      bbox: fog.bbox,
      days,
    });
  } catch (err) {
    next(err);
  }
});

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
      "X-Fog-Bbox": overlay.bbox.join(","),
      "X-Fog-Time": overlay.time,
    });

    if (req.headers["if-none-match"] === overlay.etag)
      return res.status(304).end();
    res.send(overlay.buffer);
  } catch (err) {
    next(err);
  }
});

export default api;

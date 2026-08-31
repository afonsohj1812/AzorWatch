import { readFileSync } from "node:fs";

import { islands } from "../../../config/islands.js";
import { cached, fetchHourly } from "../../utils.js";
import { sampleIslands } from "../../dem.js";

const API = "https://api.open-meteo.com/v1/forecast";

const { forecastDays, fog } = JSON.parse(
  readFileSync(new URL("../../../config/model.json", import.meta.url)),
);

const WEATHER_GRID_DEGREES = 0.0703125;
const SOURCES = Object.values(fog.layers).map(
  (layer) => layer.source,
);

const TIMEZONE = "Atlantic/Azores";

const HOURS_PER_DAY = 24;
const EXPECTED_HOURS = forecastDays * HOURS_PER_DAY;
const TTL_MS = 30 * 60_000;

let sampled = null;

const samplePoints = () =>
  sampleIslands(
    WEATHER_GRID_DEGREES,
    ({ elevation, ocean }) =>
      (i) =>
        elevation[i] !== ocean,
  );

async function fetchAll() {
  sampled ??= await samplePoints();
  const { requests, byIsland } = sampled;

  const params = new URLSearchParams({
    latitude: requests.map((p) => p.lat.toFixed(4)).join(","),
    longitude: requests.map((p) => p.lon.toFixed(4)).join(","),
    hourly: SOURCES.join(","),
    forecast_days: String(forecastDays),
    timezone: TIMEZONE,
  });

  const entries = await fetchHourly(
    `${API}?${params}`,
    "surface",
    requests.length,
    EXPECTED_HOURS,
  );

  const byIslandPoints = {};

  for (const island of islands) {
    const points = [];
    const seen = new Set();

    for (const index of byIsland[island.id]) {
      const entry = entries[index];
      const key = `${entry.latitude}:${entry.longitude}`;
      if (seen.has(key)) continue;
      seen.add(key);

      points.push({
        lat: entry.latitude,
        lon: entry.longitude,
        ...Object.fromEntries(SOURCES.map((k) => [k, entry.hourly[k]])),
      });
    }

    byIslandPoints[island.id] = points;
  }

  return { runAt: new Date().toISOString(), islands: byIslandPoints };
}

export const getSurface = cached(TTL_MS, "surface", fetchAll);

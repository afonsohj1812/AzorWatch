import { readFileSync } from "node:fs";

import { islands } from "../config/islands.js";
import { loadDem } from "./dem.js";

const API = "https://api.open-meteo.com/v1/forecast";

const { forecastDays, surface } = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
);

const GRID = surface.sampleGridDegrees;
const SOURCES = Object.values(surface.layers).map((layer) => layer.source);

const HOURS_PER_DAY = 24;
const EXPECTED_HOURS = forecastDays * HOURS_PER_DAY;
const TTL_MS = 30 * 60_000;

let sampled = null;
let cache = null;
let inFlight = null;

async function samplePoints() {
  const requests = [];
  const byIsland = {};

  for (const island of islands) {
    const dem = await loadDem(island.id);
    const { width, height, elevation, ocean, bbox } = dem;
    const [west, south, east, north] = bbox;

    const best = new Map();

    for (let i = 0; i < elevation.length; i++) {
      if (elevation[i] === ocean) continue;

      const x = i % width;
      const y = (i / width) | 0;
      const lon = west + ((x + 0.5) / width) * (east - west);
      const lat = north - ((y + 0.5) / height) * (north - south);

      const gx = Math.floor(lon / GRID);
      const gy = Math.floor(lat / GRID);
      const offLon = lon - (gx + 0.5) * GRID;
      const offLat = lat - (gy + 0.5) * GRID;
      const offset = offLat * offLat + offLon * offLon;

      const key = `${gy}:${gx}`;
      const current = best.get(key);
      if (!current || offset < current.offset)
        best.set(key, { lat, lon, offset });
    }

    byIsland[island.id] = [];
    for (const { lat, lon } of best.values()) {
      byIsland[island.id].push(requests.length);
      requests.push({ lat, lon });
    }
  }

  return { requests, byIsland };
}

async function fetchAll() {
  sampled ??= await samplePoints();
  const { requests, byIsland } = sampled;

  const params = new URLSearchParams({
    latitude: requests.map((p) => p.lat.toFixed(4)).join(","),
    longitude: requests.map((p) => p.lon.toFixed(4)).join(","),
    hourly: SOURCES.join(","),
    forecast_days: String(forecastDays),
    timezone: "auto",
  });

  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo surface HTTP ${res.status}`);

  const body = await res.json();
  const entries = Array.isArray(body) ? body : [body];
  if (entries.length !== requests.length) {
    throw new Error(
      `surface: expected ${requests.length} locations, got ${entries.length}`,
    );
  }

  for (const entry of entries) {
    if (entry.hourly?.time?.length !== EXPECTED_HOURS) {
      throw new Error(
        `surface: expected ${EXPECTED_HOURS} hours, got ${entry.hourly?.time?.length}`,
      );
    }
  }

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

export async function getSurface() {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.data;
  if (inFlight) return inFlight;

  inFlight = fetchAll()
    .then((data) => {
      cache = { data, fetchedAt: Date.now() };
      return data;
    })
    .catch((err) => {
      if (cache) {
        console.warn(`surface refresh failed (${err.message}), serving cached`);
        return cache.data;
      }
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

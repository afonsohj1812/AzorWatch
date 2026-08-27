import { readFileSync } from "node:fs";

import { islands } from "../config/islands.js";
import { loadDem } from "./dem.js";

const MARINE_API = "https://marine-api.open-meteo.com/v1/marine";
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";

const { cellSize, forecastDays, sea } = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
);

const BAND_CELLS = Math.round(sea.bandMeters / cellSize);
const MARINE_GRID_DEGREES = 1 / 12;

const TIMEZONE = "Atlantic/Azores";

const HOURS_PER_DAY = 24;
const PAST_DAYS = 1;
const HISTORY_HOURS = PAST_DAYS * HOURS_PER_DAY;
const EXPECTED_HOURS = (forecastDays + PAST_DAYS) * HOURS_PER_DAY;

const MARINE = [
  "wave_height",
  "wave_direction",
  "sea_level_height_msl",
  "wind_wave_height",
];

const WEATHER = [
  "wind_speed_10m",
  "wind_direction_10m",
  "shortwave_radiation",
];

const LAND = ["precipitation"];
const LAND_GRID_METERS = 6000;

const TTL_MS = 30 * 60_000;

let sampled = null;
let land = null;
let cache = null;
let inFlight = null;

async function samplePoints() {
  const requests = [];
  const byIsland = {};

  for (const island of islands) {
    const dem = await loadDem(island.id);
    const { width, height, elevation, coast, ocean, bbox } = dem;
    const [west, south, east, north] = bbox;

    const best = new Map();

    for (let i = 0; i < coast.length; i++) {
      if (elevation[i] !== ocean) continue;
      if (coast[i] < 1 || coast[i] > BAND_CELLS) continue;

      const x = i % width;
      const y = (i / width) | 0;
      const lon = west + ((x + 0.5) / width) * (east - west);
      const lat = north - ((y + 0.5) / height) * (north - south);

      const gx = Math.floor(lon / MARINE_GRID_DEGREES);
      const gy = Math.floor(lat / MARINE_GRID_DEGREES);
      const offLon = lon - (gx + 0.5) * MARINE_GRID_DEGREES;
      const offLat = lat - (gy + 0.5) * MARINE_GRID_DEGREES;
      const offset = offLat * offLat + offLon * offLon;

      const key = `${gy}:${gx}`;
      const current = best.get(key);
      if (!current || offset < current.offset) best.set(key, { lat, lon, offset });
    }

    byIsland[island.id] = [];
    for (const { lat, lon } of best.values()) {
      byIsland[island.id].push(requests.length);
      requests.push({ lat, lon });
    }
  }

  return { requests, byIsland };
}

async function landPoints() {
  const requests = [];
  const byIsland = {};

  for (const island of islands) {
    const dem = await loadDem(island.id);
    const { width, height, elevation, ocean, bbox } = dem;
    const [west, south, east, north] = bbox;
    const step = Math.round(LAND_GRID_METERS / cellSize);

    byIsland[island.id] = [];

    for (let y = (step / 2) | 0; y < height; y += step) {
      for (let x = (step / 2) | 0; x < width; x += step) {
        if (elevation[y * width + x] === ocean) continue;

        byIsland[island.id].push(requests.length);
        requests.push({
          lat: north - ((y + 0.5) / height) * (north - south),
          lon: west + ((x + 0.5) / width) * (east - west),
        });
      }
    }

    if (!byIsland[island.id].length) {
      const [lat, lon] = island.center;
      byIsland[island.id].push(requests.length);
      requests.push({ lat, lon });
    }
  }

  return { requests, byIsland };
}

async function fetchSeries(api, variables, requests, selection) {
  const params = new URLSearchParams({
    latitude: requests.map((p) => p.lat.toFixed(4)).join(","),
    longitude: requests.map((p) => p.lon.toFixed(4)).join(","),
    hourly: variables.join(","),
    past_days: String(PAST_DAYS),
    forecast_days: String(forecastDays),
    timezone: TIMEZONE,
    ...(selection ? { cell_selection: selection } : {}),
  });

  const res = await fetch(`${api}?${params}`);
  if (!res.ok) throw new Error(`${api} HTTP ${res.status}`);

  const body = await res.json();
  const entries = Array.isArray(body) ? body : [body];
  if (entries.length !== requests.length) {
    throw new Error(
      `${api}: expected ${requests.length} locations, got ${entries.length}`,
    );
  }

  for (const entry of entries) {
    if (entry.hourly?.time?.length !== EXPECTED_HOURS) {
      throw new Error(
        `${api}: expected ${EXPECTED_HOURS} hours, got ${entry.hourly?.time?.length}`,
      );
    }
  }

  return entries;
}

const usable = (series) => series.some((value) => Number.isFinite(value));

async function fetchAll() {
  sampled ??= await samplePoints();
  land ??= await landPoints();

  const { requests, byIsland } = sampled;

  const [marine, weather, rain] = await Promise.all([
    fetchSeries(MARINE_API, MARINE, requests),
    fetchSeries(WEATHER_API, WEATHER, requests, "sea"),
    fetchSeries(WEATHER_API, LAND, land.requests, "land"),
  ]);

  if (marine[0].hourly.time[0] !== weather[0].hourly.time[0]) {
    throw new Error(
      `marine and weather windows differ: ${marine[0].hourly.time[0]} vs ${weather[0].hourly.time[0]}`,
    );
  }

  const byIslandPoints = {};
  let dropped = 0;

  for (const island of islands) {
    const onLand = land.byIsland[island.id];
    const hours = rain[0].hourly.time.length;
    const precipitation = new Array(hours);

    for (let h = 0; h < hours; h++) {
      let sum = 0;
      let seenCount = 0;
      for (const index of onLand) {
        const value = rain[index].hourly.precipitation[h];
        if (!Number.isFinite(value)) continue;
        sum += value;
        seenCount++;
      }
      precipitation[h] = seenCount ? sum / seenCount : 0;
    }

    const points = [];
    const seen = new Set();

    for (const index of byIsland[island.id]) {
      const entry = marine[index];
      const series = Object.fromEntries([
        ...MARINE.map((k) => [k, entry.hourly[k]]),
        ...WEATHER.map((k) => [k, weather[index].hourly[k]]),
      ]);

      if (!usable(series.wave_height)) {
        dropped++;
        continue;
      }

      const key = `${entry.latitude}:${entry.longitude}`;
      if (seen.has(key)) continue;
      seen.add(key);

      points.push({
        lat: entry.latitude,
        lon: entry.longitude,
        ...series,
        precipitation,
        energy: series.wave_height.map((v) =>
          Number.isFinite(v) ? v * v : null,
        ),
      });
    }

    if (!points.length)
      throw new Error(`${island.id}: no usable marine sample points`);

    byIslandPoints[island.id] = points;
  }

  if (dropped)
    console.log(`Marine: dropped ${dropped} sample point(s) with no wave data`);

  return {
    runAt: new Date().toISOString(),
    time: marine[0].hourly.time,
    historyHours: HISTORY_HOURS,
    islands: byIslandPoints,
  };
}

export async function getMarine() {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.data;
  if (inFlight) return inFlight;

  inFlight = fetchAll()
    .then((data) => {
      cache = { data, fetchedAt: Date.now() };
      return data;
    })
    .catch((err) => {
      if (cache) {
        console.warn(`marine refresh failed (${err.message}), serving cached`);
        return cache.data;
      }
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

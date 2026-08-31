import { readFileSync } from "node:fs";

import { islands } from "../../../config/islands.js";
import { cached, cellCenter, fetchHourly } from "../../utils.js";
import { loadDem, sampleIslands } from "../../dem.js";

const MARINE_API = "https://marine-api.open-meteo.com/v1/marine";
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";

const { cellSize, forecastDays, sea } = JSON.parse(
  readFileSync(new URL("../../../config/model.json", import.meta.url)),
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

const samplePoints = () =>
  sampleIslands(
    MARINE_GRID_DEGREES,
    ({ elevation, coast, ocean }) =>
      (i) =>
        elevation[i] === ocean && coast[i] >= 1 && coast[i] <= BAND_CELLS,
  );

async function landPoints() {
  const requests = [];
  const byIsland = {};

  for (const island of islands) {
    const dem = await loadDem(island.id);
    const { width, height, elevation, ocean } = dem;
    const step = Math.round(LAND_GRID_METERS / cellSize);

    byIsland[island.id] = [];

    for (let y = (step / 2) | 0; y < height; y += step) {
      for (let x = (step / 2) | 0; x < width; x += step) {
        if (elevation[y * width + x] === ocean) continue;

        byIsland[island.id].push(requests.length);
        requests.push(cellCenter(dem, x, y));
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

  return fetchHourly(`${api}?${params}`, api, requests.length, EXPECTED_HOURS);
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

export const getMarine = cached(TTL_MS, "marine", fetchAll);

import { islands } from "../shared/islands.js";

const API = "https://api.open-meteo.com/v1/forecast";

const SURFACE = [
  "temperature_2m",
  "dew_point_2m",
  "wind_speed_10m",
  "wind_direction_10m",
];

const LEVELS = [1000, 975, 950, 925, 900, 850, 800];

const TTL_MS = Number(process.env.FORECAST_TTL_MINUTES ?? 30) * 60_000;

let cache = null;
let inFlight = null;

function url() {
  const params = new URLSearchParams({
    latitude: islands.map((i) => i.center[0]).join(","),
    longitude: islands.map((i) => i.center[1]).join(","),
    elevation: islands.map(() => "0").join(","),
    hourly: [
      ...SURFACE,
      ...LEVELS.flatMap((p) => [
        `temperature_${p}hPa`,
        `relative_humidity_${p}hPa`,
        `geopotential_height_${p}hPa`,
      ]),
    ].join(","),
    forecast_days: "4",
    timezone: "auto",
  });
  return `${API}?${params}`;
}

function shape(entry, island) {
  const h = entry.hourly;
  return {
    id: island.id,
    elevation: entry.elevation,
    time: h.time,
    surface: Object.fromEntries(SURFACE.map((k) => [k, h[k]])),
    levels: LEVELS.map((pressure) => ({
      pressure,
      height: h[`geopotential_height_${pressure}hPa`],
      temperature: h[`temperature_${pressure}hPa`],
      humidity: h[`relative_humidity_${pressure}hPa`],
    })),
  };
}

async function fetchAll() {
  const res = await fetch(url());
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

  const body = await res.json();
  if (!Array.isArray(body) || body.length !== islands.length) {
    throw new Error(
      `expected ${islands.length} locations, got ${body?.length}`,
    );
  }

  const byIsland = {};
  islands.forEach((island, i) => {
    const entry = body[i];
    if (entry.hourly?.time?.length !== 96) {
      throw new Error(
        `${island.id}: expected 96 hours, got ${entry.hourly?.time?.length}`,
      );
    }
    byIsland[island.id] = shape(entry, island);
  });

  return {
    runAt: new Date().toISOString(),
    timezone: body[0].timezone,
    islands: byIsland,
  };
}

export async function getForecast() {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.data;
  if (inFlight) return inFlight;

  inFlight = fetchAll()
    .then((data) => {
      cache = { data, fetchedAt: Date.now() };
      return data;
    })
    .catch((err) => {
      if (cache) {
        console.warn(
          `forecast refresh failed (${err.message}), serving cached`,
        );
        return cache.data;
      }
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function getIslandForecast(id) {
  return (await getForecast()).islands[id];
}

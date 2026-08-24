import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import { createFogMath, FOG_CLASS, FOG_CLASS_NAMES, OCEAN } from "./fogMath.js";
import { loadDem } from "./dem.js";
import { dayLabel, weekday } from "./dates.js";
import { getForecast } from "./forecast.js";
import { getSurface } from "./surface.js";
import { nearestPoints } from "./seaMath.js";

const config = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
);

const math = createFogMath(config);

const PALETTE = FOG_CLASS_NAMES.map(
  (name) => config.classes.find((c) => c.id === name).rgb,
);

const {
  hourConditions,
  hasCloud,
  localBase,
  classifyCell,
  classifyHour,
  visibilityAt,
} = math;

const HOURS_PER_DAY = 24;

const SURFACE_SOURCES = Object.values(config.surface.layers).map(
  (layer) => layer.source,
);
const CLOUD_SOURCE = config.surface.layers.cloudCover.source;
const NEIGHBORS = config.sea.neighbors;
const IDW_POWER = config.sea.idwPower;

function landMask(dem) {
  const classes = new Uint8Array(dem.elevation.length);
  for (let i = 0; i < dem.elevation.length; i++)
    classes[i] = dem.elevation[i] === OCEAN ? FOG_CLASS.NONE : FOG_CLASS.YELLOW;
  return classes;
}

function coverAt(dem, points, index, x, y) {
  if (!points?.length) return null;

  const [west, south, east, north] = dem.bbox;
  const lon = west + ((x + 0.5) / dem.width) * (east - west);
  const lat = north - ((y + 0.5) / dem.height) * (north - south);

  let value = 0;
  let weight = 0;

  for (const { index: p, weight: share } of nearestPoints(
    lat,
    lon,
    points,
    NEIGHBORS,
    IDW_POWER,
  )) {
    const reading = points[p][CLOUD_SOURCE]?.[index];
    if (!Number.isFinite(reading)) continue;
    value += reading * share;
    weight += share;
  }

  return weight ? Math.round(value / weight) : null;
}

function renderOverlay(classes, width, height) {
  const png = new PNG({ width, height });

  for (let i = 0; i < classes.length; i++) {
    const [r, g, b, a] = PALETTE[classes[i]];
    const p = i * 4;
    png.data[p] = r;
    png.data[p + 1] = g;
    png.data[p + 2] = b;
    png.data[p + 3] = a;
  }

  return PNG.sync.write(png);
}

export async function buildForecast(id, onOverlay) {
  const { runAt, islands: byIsland } = await getForecast();
  const forecast = byIsland[id];
  if (!forecast) return null;

  const dem = await loadDem(id);
  const hours = forecast.time.length;

  let landCells = 0;
  for (let i = 0; i < dem.elevation.length; i++)
    if (dem.elevation[i] !== OCEAN) landCells++;

  const surface = await getSurface().catch((err) => {
    console.warn(`cloud layer unavailable (${err.message})`);
    return null;
  });

  const coverage = config.summary.coverage;
  const hourClass = new Uint8Array(hours);

  if (onOverlay)
    await onOverlay({
      time: "land",
      etag: `"${runAt}:${id}:land"`,
      png: renderOverlay(landMask(dem), dem.width, dem.height),
    });

  for (let hour = 0; hour < hours; hour++) {
    const classes = classifyHour(dem, forecast, hour);

    let fogged = 0;
    for (let i = 0; i < classes.length; i++)
      if (dem.elevation[i] !== OCEAN && classes[i] !== FOG_CLASS.NONE) fogged++;

    const covered = fogged / landCells;
    hourClass[hour] =
      covered >= coverage.red
        ? FOG_CLASS.RED
        : covered >= coverage.orange
          ? FOG_CLASS.ORANGE
          : covered >= coverage.yellow
            ? FOG_CLASS.YELLOW
            : FOG_CLASS.NONE;

    if (onOverlay)
      await onOverlay({
        time: forecast.time[hour],
        etag: `"${runAt}:${id}:${hour}"`,
        png: renderOverlay(classes, dem.width, dem.height),
      });

  }

  const days = [];
  for (let day = 0; day < hours / HOURS_PER_DAY; day++) {
    const start = day * HOURS_PER_DAY;
    const date = forecast.time[start].slice(0, 10);

    let total = 0;
    for (let h = start; h < start + HOURS_PER_DAY; h++) total += hourClass[h];

    days.push({
      date,
      label: dayLabel(date),
      weekday: weekday(date),
      fogClass: FOG_CLASS_NAMES[Math.floor(total / HOURS_PER_DAY)],
      hours: Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
        time: forecast.time[start + h],
        fogClass: FOG_CLASS_NAMES[hourClass[start + h]],
      })),
    });
  }

  return {
    island: id,
    runAt,
    width: dem.width,
    height: dem.height,
    time: forecast.time,
    days,
    conditions: forecast.time.map((_, hour) => hourConditions(forecast, hour)),
    points: (surface?.islands[id] ?? []).map((point) => ({
      lat: point.lat,
      lon: point.lon,
      ...Object.fromEntries(SURFACE_SOURCES.map((k) => [k, point[k]])),
    })),
  };
}

export function inspectCell(dem, doc, hour, time, x, y) {
  if (x < 0 || y < 0 || x >= dem.width || y >= dem.height) return null;

  const c = doc.conditions[hour];
  const index = y * dem.width + x;
  const z = dem.elevation[index];

  if (z === OCEAN) return { time, x, y, sea: true, class: "none" };

  const base = localBase(dem.aspect[index], dem.slope[index], c);
  const fogClass = classifyCell(z, base, c);

  return {
    time,
    x,
    y,
    sea: false,
    class: FOG_CLASS_NAMES[fogClass],
    cloudy: hasCloud(c),
    elevation: z,
    slope: dem.slope[index],
    aspect: dem.aspect[index] * 2,
    cloudBase: Math.round(base),
    cloudTop: Math.round(c.top),
    depth: Math.round(z - base),
    aboveCloud: z > c.top,
    visibility: visibilityAt(z, base, fogClass, c),
    cover: coverAt(dem, doc.points, hour, x, y),
  };
}


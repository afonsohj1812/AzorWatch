import { readFileSync } from "node:fs";

import {
  createFogMath,
  FOG_CLASS,
  FOG_CLASS_NAMES,
  OCEAN,
} from "../shared/fogMath.js";
import { islands } from "../shared/islands.js";
import { loadDem } from "./dem.js";
import { getForecast } from "./forecast.js";
import { renderOverlay } from "./render.js";
import { saveForecast, saveOverlays } from "./db.js";

const config = JSON.parse(
  readFileSync(new URL("../config/fogModel.json", import.meta.url)),
);

const math = createFogMath(config);

const { hourConditions, localBase, classifyCell, classifyHour, visibilityAt } =
  math;

const HOURS_PER_DAY = 24;

const bundles = new Map();

export async function getIslandFog(id) {
  const { runAt, islands: byIsland } = await getForecast();
  const forecast = byIsland[id];
  if (!forecast) return null;

  const cached = bundles.get(id);
  if (cached && cached.runAt === runAt) return cached;

  const dem = await loadDem(id);
  const hours = forecast.time.length;

  let landCells = 0;
  for (let i = 0; i < dem.elevation.length; i++)
    if (dem.elevation[i] !== OCEAN) landCells++;

  const coverage = config.summary.coverage;

  const grids = [];
  const hourClass = new Uint8Array(hours);

  for (let hour = 0; hour < hours; hour++) {
    const classes = classifyHour(dem, forecast, hour);
    grids.push(classes);

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
  }

  const days = hours / HOURS_PER_DAY;
  const dayClass = new Uint8Array(days);

  for (let day = 0; day < days; day++) {
    const start = day * HOURS_PER_DAY;

    let total = 0;
    for (let h = start; h < start + HOURS_PER_DAY; h++) total += hourClass[h];

    dayClass[day] = Math.floor(total / HOURS_PER_DAY);
  }

  const bundle = {
    runAt,
    time: forecast.time,
    width: dem.width,
    height: dem.height,
    grids,
    hourClass,
    dayClass,
  };
  bundles.set(id, bundle);
  return bundle;
}

const asUtc = (date) => new Date(`${date}T00:00:00Z`);
const dayLabel = (date) =>
  asUtc(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const weekday = (date) =>
  asUtc(date).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });

export async function getIslandSummary(id) {
  const { islands: byIsland } = await getForecast();
  const forecast = byIsland[id];
  if (!forecast) return null;

  const fog = await getIslandFog(id);
  const days = [];

  for (let day = 0; day < fog.dayClass.length; day++) {
    const start = day * HOURS_PER_DAY;
    const date = fog.time[start].slice(0, 10);

    days.push({
      date,
      label: dayLabel(date),
      weekday: weekday(date),
      fogClass: FOG_CLASS_NAMES[fog.dayClass[day]],
      hours: Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
        time: fog.time[start + h],
        fogClass: FOG_CLASS_NAMES[fog.hourClass[start + h]],
      })),
    });
  }

  return {
    island: id,
    runAt: fog.runAt,
    width: fog.width,
    height: fog.height,
    days,
    conditions: fog.time.map((_, hour) => {
      const c = hourConditions(forecast, hour);
      return {
        base: c.base,
        top: c.top,
        orangeDepth: c.orangeDepth,
        redDepth: c.redDepth,
        windDirection: c.windDirection,
        windSpeed: c.windSpeed,
      };
    }),
  };
}

export function inspectCell(dem, c, time, x, y) {
  if (x < 0 || y < 0 || x >= dem.width || y >= dem.height) return null;

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
    elevation: z,
    slope: dem.slope[index],
    aspect: dem.aspect[index] * 2,
    cloudBase: Math.round(base),
    cloudTop: Math.round(c.top),
    depth: Math.round(z - base),
    aboveCloud: z > c.top,
    visibility: visibilityAt(z, base, fogClass, c),
  };
}

let running = false;

export async function runPipeline() {
  if (running)
    return console.log("pipeline: previous run still going, skipped");

  running = true;
  const started = Date.now();
  let bytes = 0;

  try {
    for (const island of islands) {
      const summary = await getIslandSummary(island.id);
      const fog = await getIslandFog(island.id);

      await saveForecast(island.id, { ...summary, time: fog.time });

      const items = fog.time.map((time, hour) => {
        const overlay = renderOverlay(fog, island.id, hour);
        bytes += overlay.buffer.length;

        return { time, etag: overlay.etag, png: overlay.buffer };
      });

      await saveOverlays(island.id, fog.runAt, items);
    }

    console.log(
      `pipeline: ${islands.length} islands, ${(bytes / 1024 / 1024).toFixed(1)} MB of overlays, ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  } finally {
    running = false;
  }
}

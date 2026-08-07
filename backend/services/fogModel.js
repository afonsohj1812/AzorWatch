import { readFileSync } from "node:fs";

import {
  createFogMath,
  FOG_CLASS,
  FOG_CLASS_NAMES,
  OCEAN,
} from "../shared/fogMath.js";
import { loadDem } from "./dem.js";
import { getForecast } from "./forecast.js";

const config = JSON.parse(
  readFileSync(new URL("../config/fogModel.json", import.meta.url)),
);

const math = createFogMath(config);

export const {
  hourConditions,
  localBase,
  classifyCell,
  classifyHour,
  visibilityAt,
} = math;
export { FOG_CLASS, FOG_CLASS_NAMES };

const HOURS_PER_DAY = 24;

const bundles = new Map();

export async function getIslandFog(id) {
  const { runAt, islands } = await getForecast();
  const forecast = islands[id];
  if (!forecast) return null;

  const cached = bundles.get(id);
  if (cached && cached.runAt === runAt) return cached;

  const dem = await loadDem(id);
  const hours = forecast.time.length;

  let landCells = 0;
  for (let i = 0; i < dem.elevation.length; i++)
    if (dem.elevation[i] !== OCEAN) landCells++;

  const minCells = config.summary.minCoverage * landCells;
  const minHours = Math.ceil(config.summary.minDuration * HOURS_PER_DAY);

  const grids = [];
  const hourClass = new Uint8Array(hours);

  for (let hour = 0; hour < hours; hour++) {
    const classes = classifyHour(dem, forecast, hour);
    grids.push(classes);

    const counts = [0, 0, 0, 0];
    for (let i = 0; i < classes.length; i++)
      if (dem.elevation[i] !== OCEAN) counts[classes[i]]++;

    let atOrWorse = 0;
    for (let q = FOG_CLASS.RED; q >= FOG_CLASS.YELLOW; q--) {
      atOrWorse += counts[q];
      if (atOrWorse >= minCells) {
        hourClass[hour] = q;
        break;
      }
    }
  }

  const days = hours / HOURS_PER_DAY;
  const dayClass = new Uint8Array(days);

  for (let day = 0; day < days; day++) {
    const start = day * HOURS_PER_DAY;

    for (let q = FOG_CLASS.RED; q >= FOG_CLASS.YELLOW; q--) {
      let matching = 0;
      for (let h = start; h < start + HOURS_PER_DAY; h++)
        if (hourClass[h] >= q) matching++;

      if (matching >= minHours) {
        dayClass[day] = q;
        break;
      }
    }
  }

  const bundle = {
    id,
    runAt,
    time: forecast.time,
    width: dem.width,
    height: dem.height,
    bbox: dem.bbox,
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
    month: "long",
    timeZone: "UTC",
  });
const weekday = (date) =>
  asUtc(date).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });

export async function getIslandSummary(id) {
  const { islands } = await getForecast();
  const forecast = islands[id];
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
    bbox: fog.bbox,
    width: fog.width,
    height: fog.height,
    days,
    conditions: fog.time.map((_, hour) => {
      const c = hourConditions(forecast, hour);
      return {
        base: c.base,
        top: c.top,
        mist: Number.isFinite(c.mist) ? c.mist : null,
        orangeDepth: c.orangeDepth,
        redDepth: c.redDepth,
        windDirection: c.windDirection,
        windSpeed: c.windSpeed,
      };
    }),
  };
}

export async function inspectPoint(id, hour, x, y) {
  const fog = await getIslandFog(id);
  if (!fog || hour < 0 || hour >= fog.time.length) return null;
  if (x < 0 || y < 0 || x >= fog.width || y >= fog.height) return null;

  const dem = await loadDem(id);
  const index = y * fog.width + x;
  const z = dem.elevation[index];

  const point = {
    time: fog.time[hour],
    x,
    y,
    sea: z === OCEAN,
    class: FOG_CLASS_NAMES[fog.grids[hour][index]],
  };

  if (point.sea) return point;

  const c = hourConditions((await getForecast()).islands[id], hour);
  const base = localBase(dem.aspect[index], dem.slope[index], c);
  const fogClass = fog.grids[hour][index];

  return {
    ...point,
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

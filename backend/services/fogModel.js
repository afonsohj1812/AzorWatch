import { readFileSync } from "node:fs";

import { loadDem } from "./dem.js";
import { getForecast } from "./forecast.js";

const config = JSON.parse(
  readFileSync(new URL("../config/fogModel.json", import.meta.url)),
);

export const FOG_CLASS = { NONE: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

export const FOG_CLASS_NAMES = ["none", "yellow", "orange", "red"];

const OCEAN = -32768;
const HOURS_PER_DAY = 24;

const es = (t) => 6.112 * Math.exp((17.67 * t) / (t + 243.5));
const rhFrom = (t, td) => 100 * (es(td) / es(t));

function saturationHeight(profile) {
  const target = config.cloudBase.saturationRh;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i].humidity < target) continue;
    if (i === 0) return profile[0].height;

    const below = profile[i - 1];
    const span = profile[i].humidity - below.humidity;
    const frac = span === 0 ? 0 : (target - below.humidity) / span;
    return below.height + frac * (profile[i].height - below.height);
  }
  return null;
}

function lclHeight(temperature, dewPoint, modelElevation) {
  return (
    modelElevation + config.cloudBase.lclCoefficient * (temperature - dewPoint)
  );
}

function cloudTopHeight(profile, base) {
  const cap = base + config.cloudTop.maxThickness;
  const exit = config.cloudTop.exitRh;

  for (let i = 1; i < profile.length; i++) {
    const level = profile[i];
    if (level.height <= base) continue;
    const below = profile[i - 1];

    if (level.humidity < exit) {
      const span = below.humidity - level.humidity;
      const frac = span <= 0 ? 0 : (below.humidity - exit) / span;
      const top = below.height + frac * (level.height - below.height);
      return Math.min(Math.max(top, base), cap);
    }
    if (level.temperature > below.temperature)
      return Math.min(level.height, cap);
  }
  return cap;
}

function depthForVisibility(visibility) {
  const { coefficient, exponent } = config.kunkel;
  const lwc = Math.pow(3912 / (coefficient * visibility), 1 / exponent);
  const perKm = config.lwc.subAdiabaticFactor * config.lwc.adiabaticGradient;
  return (lwc * 1000) / perKm;
}

function visibilityForDepth(depth) {
  const { coefficient, exponent } = config.kunkel;
  const perKm = config.lwc.subAdiabaticFactor * config.lwc.adiabaticGradient;
  const lwc = (perKm * depth) / 1000;
  if (lwc <= 0) return null;

  return 3912 / (coefficient * Math.pow(lwc, exponent));
}

function visibilityInYellow(z, base, c) {
  const { yellow, orange } = config.classThresholds;

  const bottom = Math.min(base - config.mist.belowBaseBand, c.mist);
  const top = base + c.orangeDepth;
  if (!(top > bottom)) return orange;

  const fraction = Math.min(1, Math.max(0, (z - bottom) / (top - bottom)));
  return yellow * Math.pow(orange / yellow, fraction);
}

export function visibilityAt(z, base, fogClass, c) {
  if (fogClass === FOG_CLASS.NONE) return null;
  if (fogClass === FOG_CLASS.YELLOW) return visibilityInYellow(z, base, c);
  return visibilityForDepth(z - base);
}

function mistHeight(temperature, dewPoint, modelElevation) {
  const target = config.mist.saturationRh;
  const dT = config.lapseRate.temperature / 1000;
  const dTd = config.lapseRate.dewPoint / 1000;

  let low = modelElevation;
  let high = modelElevation + 3000;
  if (rhFrom(temperature, dewPoint) >= target) return low;
  if (rhFrom(temperature - dT * 3000, dewPoint - dTd * 3000) < target)
    return Infinity;

  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const d = mid - modelElevation;
    if (rhFrom(temperature - dT * d, dewPoint - dTd * d) >= target) high = mid;
    else low = mid;
  }
  return high;
}

function hourlyProfile(forecast, hour) {
  return forecast.levels
    .map((level) => ({
      height: level.height[hour],
      temperature: level.temperature[hour],
      humidity: level.humidity[hour],
    }))
    .filter((level) => Number.isFinite(level.height))
    .sort((a, b) => a.height - b.height);
}

export function hourConditions(forecast, hour) {
  const surface = forecast.surface;
  const temperature = surface.temperature_2m[hour];
  const dewPoint = surface.dew_point_2m[hour];
  const elevation = forecast.elevation;

  const profile = hourlyProfile(forecast, hour);
  const saturated = saturationHeight(profile);
  const lcl = lclHeight(temperature, dewPoint, elevation);

  const base = Math.max(0, saturated === null ? lcl : Math.min(saturated, lcl));

  return {
    base,
    top: cloudTopHeight(profile, base),
    mist: mistHeight(temperature, dewPoint, elevation),
    orangeDepth: depthForVisibility(config.classThresholds.orange),
    redDepth: depthForVisibility(config.classThresholds.red),
    windDirection: surface.wind_direction_10m[hour],
    windSpeed: surface.wind_speed_10m[hour],
  };
}

const radians = (degrees) => (degrees * Math.PI) / 180;

function windwardLowering(aspectDegrees, slopeDegrees, wind) {
  if (slopeDegrees < config.windward.minSlope) return 0;

  let diff = Math.abs(aspectDegrees - wind.windDirection) % 360;
  if (diff > 180) diff = 360 - diff;
  if (diff > config.windward.aspectTolerance) return 0;

  const facing = 1 - diff / config.windward.aspectTolerance;
  const strength = Math.min(
    1,
    wind.windSpeed / config.windward.fullEffectWindSpeed,
  );
  const steepness = Math.min(
    1,
    Math.sin(radians(slopeDegrees)) /
      Math.sin(radians(config.windward.fullEffectSlope)),
  );

  return config.windward.maxLowering * facing * strength * steepness;
}

export function localBase(aspectByte, slopeDegrees, c) {
  return c.base - windwardLowering(aspectByte * 2, slopeDegrees, c);
}

export function classifyCell(z, base, c) {
  if (z === OCEAN || z > c.top) return FOG_CLASS.NONE;

  const depth = z - base;
  if (depth >= 0) {
    return depth >= c.redDepth
      ? FOG_CLASS.RED
      : depth >= c.orangeDepth
        ? FOG_CLASS.ORANGE
        : FOG_CLASS.YELLOW;
  }
  if (-depth <= config.mist.belowBaseBand || z >= c.mist)
    return FOG_CLASS.YELLOW;
  return FOG_CLASS.NONE;
}

export function classifyHour(dem, forecast, hour) {
  const c = hourConditions(forecast, hour);
  const { elevation, aspect, slope } = dem;
  const classes = new Uint8Array(elevation.length);

  for (let i = 0; i < elevation.length; i++) {
    const z = elevation[i];
    if (z === OCEAN) continue;
    classes[i] = classifyCell(z, localBase(aspect[i], slope[i], c), c);
  }

  return classes;
}

const bundles = new Map();

export async function getIslandFog(id) {
  const { runAt, islands } = await getForecast();
  const forecast = islands[id];
  if (!forecast) return null;

  const cached = bundles.get(id);
  if (cached && cached.runAt === runAt) return cached;

  const dem = await loadDem(id);
  const hours = forecast.time.length;

  const grids = [];
  const hourMax = new Uint8Array(hours);

  for (let hour = 0; hour < hours; hour++) {
    const classes = classifyHour(dem, forecast, hour);
    grids.push(classes);

    let max = 0;
    for (let i = 0; i < classes.length; i++)
      if (classes[i] > max) max = classes[i];
    hourMax[hour] = max;
  }

  const days = hours / HOURS_PER_DAY;
  const dayMax = new Uint8Array(days);
  for (let day = 0; day < days; day++) {
    let max = 0;
    for (let h = day * HOURS_PER_DAY; h < (day + 1) * HOURS_PER_DAY; h++) {
      if (hourMax[h] > max) max = hourMax[h];
    }
    dayMax[day] = max;
  }

  const bundle = {
    id,
    runAt,
    time: forecast.time,
    width: dem.width,
    height: dem.height,
    bbox: dem.bbox,
    grids,
    hourMax,
    dayMax,
  };
  bundles.set(id, bundle);
  return bundle;
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

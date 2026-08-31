import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import { createFogMath, FOG_CLASS, FOG_CLASS_NAMES, OCEAN } from "./math.js";
import { loadDem } from "../../dem.js";
import { getForecast } from "./forecast.js";
import { getSurface } from "./surface.js";
import { buildBlend, blendSeries, paint } from "../../utils.js";
import { groupDays, percentileClass } from "../../summary.js";

const config = JSON.parse(
  readFileSync(new URL("../../../config/model.json", import.meta.url)),
);

const math = createFogMath(config);

const PALETTE = FOG_CLASS_NAMES.map((name) => config.classes[name].rgb);

const {
  hourConditions,
  hasCloud,
  localBase,
  classifyCell,
  classifyHour,
  visibilityAt,
} = math;

const HOURS_PER_DAY = 24;

const LAYERS = Object.entries(config.fog.layers);
const SURFACE_SOURCES = LAYERS.map(([, layer]) => layer.source);
const RAMP = config.fog.ramp;
const RAMP_PALETTE = RAMP.map((name) => config.classes[name].rgb);
const LAYER_PERCENTILE = 0.5;

const rampBin = (value, spec) => {
  if (!Number.isFinite(value)) return null;
  const span = spec.max - spec.min;
  const fraction = span === 0 ? 0 : (value - spec.min) / span;
  return Math.min(
    RAMP.length - 1,
    Math.max(0, Math.floor(fraction * RAMP.length)),
  );
};

const landBlends = new Map();

function landBlend(id, dem, points) {
  const signature = `${points.length}:${points[0]?.lat},${points[0]?.lon}`;
  const cached = landBlends.get(id);
  if (cached?.signature === signature) return cached.blend;

  const cells = [];
  for (let i = 0; i < dem.elevation.length; i++)
    if (dem.elevation[i] !== OCEAN) cells.push(i);

  const blend = buildBlend(
    Int32Array.from(cells),
    dem,
    points,
    NEIGHBORS,
    IDW_POWER,
  );

  landBlends.set(id, { signature, blend });
  return blend;
}

function renderRamp(png, blend, bins) {
  paint(png.data, blend.cells, bins, RAMP_PALETTE);
  return PNG.sync.write(png);
}
const NEIGHBORS = config.sea.neighbors;
const IDW_POWER = config.sea.idwPower;

function landMask(dem) {
  const classes = new Uint8Array(dem.elevation.length);
  for (let i = 0; i < dem.elevation.length; i++)
    classes[i] = dem.elevation[i] === OCEAN ? FOG_CLASS.NONE : FOG_CLASS.YELLOW;
  return classes;
}

function renderOverlay(classes, width, height) {
  const png = new PNG({ width, height });
  paint(png.data, null, classes, PALETTE);
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

  const coverage = config.fog.summary.coverage;
  const hourClass = new Uint8Array(hours);

  if (onOverlay)
    await onOverlay({
      time: "land",
      etag: `"${runAt}:${id}:land"`,
      png: renderOverlay(landMask(dem), dem.width, dem.height),
    });

  const points = (surface?.islands[id] ?? []).map((point) => ({
    lat: point.lat,
    lon: point.lon,
    ...Object.fromEntries(SURFACE_SOURCES.map((k) => [k, point[k]])),
  }));

  const blend = points.length ? landBlend(id, dem, points) : null;
  const layerHourClass = blend
    ? Object.fromEntries(LAYERS.map(([layer]) => [layer, new Uint8Array(hours)]))
    : null;
  const layerSeries = Object.fromEntries(
    LAYERS.map(([layer, spec]) => [layer, points.map((p) => p[spec.source])]),
  );

  const layerPng = blend
    ? new PNG({ width: dem.width, height: dem.height })
    : null;
  if (layerPng) layerPng.data.fill(0);
  const bins = blend ? new Uint8Array(blend.cells.length) : null;

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

    if (!blend) continue;

    for (const [layer, spec] of LAYERS) {
      const counts = new Int32Array(RAMP.length);
      const series = layerSeries[layer];
      let seen = 0;

      for (let j = 0; j < blend.cells.length; j++) {
        const bin = rampBin(blendSeries(series, blend, j, hour), spec);
        bins[j] = bin === null ? 255 : bin;
        if (bin === null) continue;
        counts[bin]++;
        seen++;
      }

      layerHourClass[layer][hour] = seen
        ? percentileClass(counts, seen, LAYER_PERCENTILE)
        : 0;

      if (onOverlay)
        await onOverlay({
          layer,
          time: forecast.time[hour],
          etag: `"${runAt}:${id}:${layer}:${hour}"`,
          png: renderRamp(layerPng, blend, bins),
        });
    }
  }

  const meanBin = (series, start) => {
    let total = 0;
    for (let h = start; h < start + HOURS_PER_DAY; h++) total += series[h];
    return Math.round(total / HOURS_PER_DAY);
  };

  const medianBin = (series, start) => {
    const slice = Array.from(series.slice(start, start + HOURS_PER_DAY));
    slice.sort((a, b) => a - b);
    return slice[Math.round(LAYER_PERCENTILE * (slice.length - 1))];
  };

  const days = groupDays({
    times: forecast.time,
    hourClass,
    names: FOG_CLASS_NAMES,
    dayOf: meanBin,
    layers: layerHourClass
      ? Object.fromEntries(
          LAYERS.map(([layer]) => [
            layer,
            { series: layerHourClass[layer], names: RAMP, dayOf: medianBin },
          ]),
        )
      : {},
  });

  return {
    island: id,
    runAt,
    width: dem.width,
    height: dem.height,
    time: forecast.time,
    days,
    conditions: forecast.time.map((_, hour) => hourConditions(forecast, hour)),
    points,
  };
}

export const inspectCell = math.inspect;

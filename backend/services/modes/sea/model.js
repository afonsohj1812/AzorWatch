import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import {
  createSeaMath,
  DIRECTION_SOURCES,
  LAYER_LABELS,
  LAYER_SOURCES,
  SEA_CLASS_NAMES,
  SERIES,
} from "./math.js";
import { loadDem } from "../../dem.js";
import { buildBlend as idwBlend } from "../../blend.js";
import { groupDays, percentileClass } from "../../summary.js";
import { getMarine } from "./marine.js";

const config = JSON.parse(
  readFileSync(new URL("../../../config/model.json", import.meta.url)),
);

const math = createSeaMath(config);

const PALETTE = SEA_CLASS_NAMES.map((name) => config.classes[name].rgb);

const SOURCED = Object.entries(LAYER_SOURCES);
const DIRECTIONS = Object.entries(DIRECTION_SOURCES);
const SERIES_NAMES = SERIES.map(([name]) => name);
const SCORED = LAYER_LABELS.filter(({ id }) => config.sea.layers[id]);
const CELL_SIZE = config.cellSize;
const BAND_CELLS = Math.round(config.sea.bandMeters / config.cellSize);
const NEIGHBORS = config.sea.neighbors;
const NORMAL_RADIUS = config.sea.normalRadius ?? 0;
const PERCENTILE = config.sea.summary.percentile;
const HOURS_PER_DAY = 24;

const blends = new Map();

function blurredCoast(coast, width, height) {
  const source = Float32Array.from(coast);
  if (NORMAL_RADIUS < 1) return source;

  const wide = new Float32Array(coast.length);
  const out = new Float32Array(coast.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let d = -NORMAL_RADIUS; d <= NORMAL_RADIUS; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= width) continue;
        sum += source[row + xx];
        n++;
      }
      wide[row + x] = sum / n;
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let n = 0;
      for (let d = -NORMAL_RADIUS; d <= NORMAL_RADIUS; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= height) continue;
        sum += wide[yy * width + x];
        n++;
      }
      out[y * width + x] = sum / n;
    }
  }

  return out;
}

function buildBlend(dem, points) {
  const { width, height, elevation, coast, ocean } = dem;

  const cells = [];
  for (let i = 0; i < coast.length; i++)
    if (elevation[i] === ocean && coast[i] >= 1 && coast[i] <= BAND_CELLS)
      cells.push(i);

  const blend = idwBlend(
    Int32Array.from(cells),
    dem,
    points,
    NEIGHBORS,
    config.sea.idwPower,
  );

  const shore = new Float32Array(cells.length);
  const normalX = new Float32Array(cells.length);
  const normalY = new Float32Array(cells.length);

  const smoothed = blurredCoast(coast, width, height);
  const distanceAt = (x, y) =>
    smoothed[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ];

  for (let j = 0; j < cells.length; j++) {
    const i = cells[j];
    shore[j] = coast[i] * CELL_SIZE;

    const x = i % width;
    const y = (i / width) | 0;
    const gx = (distanceAt(x + 1, y) - distanceAt(x - 1, y)) / 2;
    const gy = (distanceAt(x, y + 1) - distanceAt(x, y - 1)) / 2;

    if (gx === 0 && gy === 0) continue;

    const bearing = Math.atan2(gx, -gy);
    const facing = Math.min(1, Math.hypot(gx, gy));
    normalX[j] = Math.cos(bearing) * facing;
    normalY[j] = Math.sin(bearing) * facing;
  }

  return { ...blend, shore, normalX, normalY };
}

function cellBlend(blend, j, into) {
  const base = j * blend.k;
  for (let n = 0; n < blend.k; n++) {
    into[n].index = blend.indices[base + n];
    into[n].weight = blend.weights[base + n];
  }
  return into;
}

const cellAt = (blend, j) => ({
  coastMeters: blend.shore[j],
  normalX: blend.normalX[j],
  normalY: blend.normalY[j],
});

function blendFor(id, dem, points) {
  const signature = points.map((p) => `${p.lat},${p.lon}`).join(" ");
  const cached = blends.get(id);
  if (cached?.signature === signature) return cached.blend;

  const blend = buildBlend(dem, points);
  blends.set(id, { signature, blend });
  return blend;
}

function renderOverlay(png, cells, classes) {
  for (let j = 0; j < cells.length; j++) {
    const [r, g, b, a] = PALETTE[classes[j]];
    const p = cells[j] * 4;
    png.data[p] = r;
    png.data[p + 1] = g;
    png.data[p + 2] = b;
    png.data[p + 3] = a;
  }

  return PNG.sync.write(png);
}

const round = (value, places) =>
  Number.isFinite(value) ? Number(value.toFixed(places)) : null;

export const inspectSeaCell = math.inspect;

export async function buildSeaForecast(id, onOverlay) {
  const marine = await getMarine();
  const points = marine.islands[id];
  if (!points) return null;

  const dem = await loadDem(id);
  const blend = blendFor(id, dem, points);
  const { cells, k } = blend;

  const hours = marine.time.length - marine.historyHours;
  const hourClass = new Uint8Array(hours);
  const classes = new Uint8Array(cells.length);
  const slots = Array.from({ length: k }, () => ({ index: 0, weight: 0 }));

  const png = new PNG({ width: dem.width, height: dem.height });
  png.data.fill(0);

  const summaryPoints = points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    layers: Object.fromEntries(SOURCED.map(([id]) => [id, new Array(hours)])),
    directions: Object.fromEntries(
      DIRECTIONS.map(([id]) => [id, new Array(hours)]),
    ),
    series: Object.fromEntries(SERIES_NAMES.map((n) => [n, new Array(hours)])),
  }));

  const layerHourClass = SCORED.map(() => new Uint8Array(hours));
  const layerClasses = SCORED.map(() => new Uint8Array(cells.length));

  for (let hour = 0; hour < hours; hour++) {
    const index = marine.historyHours + hour;

    for (let p = 0; p < points.length; p++) {
      for (const [layer, source] of SOURCED)
        summaryPoints[p].layers[layer][hour] = round(
          points[p][source]?.[index],
          2,
        );

      for (const [layer, source] of DIRECTIONS) {
        const degrees = points[p][source]?.[index];
        summaryPoints[p].directions[layer][hour] = Number.isFinite(degrees)
          ? Math.round(degrees)
          : null;
      }

      const series = math.seriesFor(points[p], index);
      for (const name of SERIES_NAMES)
        summaryPoints[p].series[name][hour] = round(series[name], 4);
    }

    const counts = new Int32Array(SEA_CLASS_NAMES.length);
    const layerCounts = SCORED.map(
      () => new Int32Array(SEA_CLASS_NAMES.length),
    );

    for (let j = 0; j < cells.length; j++) {
      const { score, cell } = math.scoreCell(
        summaryPoints,
        cellBlend(blend, j, slots),
        hour,
        cellAt(blend, j),
      );

      const seaClass = math.classify(score);
      classes[j] = seaClass;
      counts[seaClass]++;

      SCORED.forEach(({ id: layer }, li) => {
        const layerClass = math.classify(math.penaltyOf(cell, layer));
        layerClasses[li][j] = layerClass;
        layerCounts[li][layerClass]++;
      });
    }

    hourClass[hour] = percentileClass(counts, cells.length, PERCENTILE);
    for (let li = 0; li < SCORED.length; li++)
      layerHourClass[li][hour] = percentileClass(layerCounts[li], cells.length, PERCENTILE);

    if (onOverlay) {
      await onOverlay({
        time: marine.time[index],
        etag: `"${marine.runAt}:${id}:sea:${hour}"`,
        png: renderOverlay(png, cells, classes),
      });

      for (let li = 0; li < SCORED.length; li++)
        await onOverlay({
          layer: SCORED[li].id,
          time: marine.time[index],
          etag: `"${marine.runAt}:${id}:sea:${SCORED[li].id}:${hour}"`,
          png: renderOverlay(png, cells, layerClasses[li]),
        });
    }
  }

  const dayClassOf = (series, start) => {
    const slice = Array.from(series.slice(start, start + HOURS_PER_DAY));
    slice.sort((a, b) => a - b);
    return slice[Math.round(PERCENTILE * (slice.length - 1))];
  };

  const days = groupDays({
    times: marine.time.slice(marine.historyHours),
    hourClass,
    names: SEA_CLASS_NAMES,
    dayOf: dayClassOf,
    layers: Object.fromEntries(
      SCORED.map(({ id: layer }, li) => [
        layer,
        { series: layerHourClass[li], names: SEA_CLASS_NAMES, dayOf: dayClassOf },
      ]),
    ),
  });

  return {
    island: id,
    runAt: marine.runAt,
    width: dem.width,
    height: dem.height,
    time: marine.time.slice(marine.historyHours),
    bandCells: cells.length,
    days,
    points: summaryPoints,
  };
}

import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import {
  createSeaMath,
  DIRECTION_SOURCES,
  LAYER_LABELS,
  LAYER_SOURCES,
  SEA_CLASS_NAMES,
  SERIES,
} from "./seaMath.js";
import { loadDem } from "./dem.js";
import { dayLabel, weekday } from "./dates.js";
import { getMarine } from "./marine.js";

const config = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
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
const IDW_EXPONENT = -config.sea.idwPower / 2;
const PERCENTILE = config.sea.summary.percentile;
const HOURS_PER_DAY = 24;

const blends = new Map();

function buildBlend(dem, points) {
  const { width, height, elevation, coast, ocean, bbox } = dem;
  const [west, south, east, north] = bbox;

  const cells = [];
  for (let i = 0; i < coast.length; i++)
    if (elevation[i] === ocean && coast[i] >= 1 && coast[i] <= BAND_CELLS)
      cells.push(i);

  const k = Math.min(NEIGHBORS, points.length);
  const indices = new Uint8Array(cells.length * k);
  const weights = new Float32Array(cells.length * k);
  const scale = Math.cos((((south + north) / 2) * Math.PI) / 180);

  const bestIndex = new Int32Array(k);
  const bestDistance = new Float64Array(k);

  for (let j = 0; j < cells.length; j++) {
    const i = cells[j];
    const x = i % width;
    const y = (i / width) | 0;
    const lon = west + ((x + 0.5) / width) * (east - west);
    const lat = north - ((y + 0.5) / height) * (north - south);

    bestDistance.fill(Infinity);

    for (let p = 0; p < points.length; p++) {
      const dx = (points[p].lon - lon) * scale;
      const dy = points[p].lat - lat;
      const distance = dx * dx + dy * dy;
      if (distance >= bestDistance[k - 1]) continue;

      let n = k - 1;
      while (n > 0 && bestDistance[n - 1] > distance) {
        bestDistance[n] = bestDistance[n - 1];
        bestIndex[n] = bestIndex[n - 1];
        n--;
      }
      bestDistance[n] = distance;
      bestIndex[n] = p;
    }

    const base = j * k;

    if (bestDistance[0] === 0) {
      indices[base] = bestIndex[0];
      weights[base] = 1;
      continue;
    }

    let total = 0;
    for (let n = 0; n < k; n++) {
      const weight = Math.pow(bestDistance[n], IDW_EXPONENT);
      indices[base + n] = bestIndex[n];
      weights[base + n] = weight;
      total += weight;
    }
    for (let n = 0; n < k; n++) weights[base + n] /= total;
  }

  const shore = new Float32Array(cells.length);
  const normalX = new Float32Array(cells.length);
  const normalY = new Float32Array(cells.length);

  const distanceAt = (x, y) =>
    coast[
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
    normalX[j] = Math.cos(bearing);
    normalY[j] = Math.sin(bearing);
  }

  return {
    cells: Int32Array.from(cells),
    indices,
    weights,
    k,
    shore,
    normalX,
    normalY,
  };
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

function findCell(cells, target) {
  let low = 0;
  let high = cells.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cells[mid] === target) return mid;
    if (cells[mid] < target) low = mid + 1;
    else high = mid - 1;
  }

  return -1;
}

export function inspectSeaCell(dem, summary, hour, time, x, y) {
  if (x < 0 || y < 0 || x >= dem.width || y >= dem.height) return null;

  const blend = blendFor(summary.island, dem, summary.points);
  const j = findCell(blend.cells, y * dem.width + x);
  if (j === -1) return { time, x, y, offshore: true };

  const slots = Array.from({ length: blend.k }, () => ({
    index: 0,
    weight: 0,
  }));

  const { score, cell } = math.scoreCell(
    summary.points,
    cellBlend(blend, j, slots),
    hour,
    cellAt(blend, j),
  );

  return {
    time,
    x,
    y,
    offshore: false,
    shore: Math.round(blend.shore[j]),
    class: SEA_CLASS_NAMES[math.classify(score)],
    score: round(score, 3),
    layers: math.describe(cell).map((entry) => ({
      ...entry,
      penalty: round(entry.penalty, 3),
    })),
  };
}

function percentileClass(counts, total) {
  const target = PERCENTILE * total;
  let seen = 0;

  for (let c = 0; c < counts.length; c++) {
    seen += counts[c];
    if (seen >= target) return c;
  }

  return counts.length - 1;
}

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

    hourClass[hour] = percentileClass(counts, cells.length);
    for (let li = 0; li < SCORED.length; li++)
      layerHourClass[li][hour] = percentileClass(layerCounts[li], cells.length);

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
    return SEA_CLASS_NAMES[slice[Math.round(PERCENTILE * (slice.length - 1))]];
  };

  const days = [];
  for (let day = 0; day < hours / HOURS_PER_DAY; day++) {
    const start = day * HOURS_PER_DAY;
    const date = marine.time[marine.historyHours + start].slice(0, 10);

    days.push({
      date,
      label: dayLabel(date),
      weekday: weekday(date),
      seaClass: dayClassOf(hourClass, start),
      layerClass: Object.fromEntries(
        SCORED.map(({ id: layer }, li) => [
          layer,
          dayClassOf(layerHourClass[li], start),
        ]),
      ),
      hours: Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
        time: marine.time[marine.historyHours + start + h],
        seaClass: SEA_CLASS_NAMES[hourClass[start + h]],
        layerClass: Object.fromEntries(
          SCORED.map(({ id: layer }, li) => [
            layer,
            SEA_CLASS_NAMES[layerHourClass[li][start + h]],
          ]),
        ),
      })),
    });
  }

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

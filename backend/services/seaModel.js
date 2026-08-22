import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import { createSeaMath, SEA_CLASS_NAMES } from "./seaMath.js";
import { loadDem } from "./dem.js";
import { dayLabel, weekday } from "./dates.js";
import { getMarine } from "./marine.js";

const config = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
);

const math = createSeaMath(config);

const PALETTE = SEA_CLASS_NAMES.map(
  (name) => config.sea.classes.find((c) => c.id === name).rgb,
);

const LAYER_NAMES = Object.keys(config.sea.layers);
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

  return { cells: Int32Array.from(cells), indices, weights, k };
}

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

  const base = j * blend.k;
  const layers = {};

  for (const name of LAYER_NAMES) {
    let value = 0;
    let weight = 0;

    for (let n = 0; n < blend.k; n++) {
      const reading = summary.points[blend.indices[base + n]].layers[name][hour];
      if (reading === null) continue;
      value += reading * blend.weights[base + n];
      weight += blend.weights[base + n];
    }

    layers[name] = weight ? round(value / weight, 2) : null;
  }

  let score = 0;
  for (let n = 0; n < blend.k; n++)
    score += summary.points[blend.indices[base + n]].score[hour] * blend.weights[base + n];

  return {
    time,
    x,
    y,
    offshore: false,
    class: SEA_CLASS_NAMES[math.classify(score)],
    score: round(score, 3),
    layers,
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
  const { cells, indices, weights, k } = blend;

  const hours = marine.time.length - marine.historyHours;
  const hourClass = new Uint8Array(hours);
  const scores = new Float64Array(points.length);
  const classes = new Uint8Array(cells.length);

  const png = new PNG({ width: dem.width, height: dem.height });
  png.data.fill(0);

  const summaryPoints = points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    score: new Array(hours),
    layers: Object.fromEntries(
      LAYER_NAMES.map((name) => [name, new Array(hours)]),
    ),
  }));

  for (let hour = 0; hour < hours; hour++) {
    const index = marine.historyHours + hour;

    for (let p = 0; p < points.length; p++) {
      scores[p] = math.score(points[p], index) ?? 1;
      summaryPoints[p].score[hour] = round(scores[p], 3);

      const values = math.layerValues(points[p], index);
      for (const name of LAYER_NAMES)
        summaryPoints[p].layers[name][hour] = round(values[name], 2);
    }

    const counts = new Int32Array(SEA_CLASS_NAMES.length);

    for (let j = 0; j < cells.length; j++) {
      const base = j * k;
      let value = 0;
      for (let n = 0; n < k; n++)
        value += scores[indices[base + n]] * weights[base + n];

      const seaClass = math.classify(value);
      classes[j] = seaClass;
      counts[seaClass]++;
    }

    hourClass[hour] = percentileClass(counts, cells.length);

    if (onOverlay)
      await onOverlay({
        time: marine.time[index],
        etag: `"${marine.runAt}:${id}:sea:${hour}"`,
        png: renderOverlay(png, cells, classes),
      });
  }

  const days = [];
  for (let day = 0; day < hours / HOURS_PER_DAY; day++) {
    const start = day * HOURS_PER_DAY;
    const slice = Array.from(hourClass.slice(start, start + HOURS_PER_DAY));
    const date = marine.time[marine.historyHours + start].slice(0, 10);

    slice.sort((a, b) => a - b);

    days.push({
      date,
      label: dayLabel(date),
      weekday: weekday(date),
      seaClass: SEA_CLASS_NAMES[slice[Math.floor(PERCENTILE * (slice.length - 1))]],
      hours: Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
        time: marine.time[marine.historyHours + start + h],
        seaClass: SEA_CLASS_NAMES[hourClass[start + h]],
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

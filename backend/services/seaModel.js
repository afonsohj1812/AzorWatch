import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import {
  createSeaMath,
  DIRECTION_SOURCES,
  LAYER_SOURCES,
  SEA_CLASS_NAMES,
} from "./seaMath.js";
import { loadDem } from "./dem.js";
import { dayLabel, weekday } from "./dates.js";
import { getMarine } from "./marine.js";

const config = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
);

const math = createSeaMath(config);

const PALETTE = SEA_CLASS_NAMES.map(
  (name) => config.classes[name].rgb,
);

const LAYER_NAMES = ["visibility", ...Object.keys(LAYER_SOURCES)];
const DIRECTIONS = Object.keys(DIRECTION_SOURCES);
const TOTAL_WEIGHT = Object.values(config.sea.layers).reduce(
  (sum, spec) => sum + spec.weight,
  0,
);
const SCORED_LAYERS = Object.entries(config.sea.layers);
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
  const bearings = new Float32Array(cells.length);

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
    bearings[j] = ((bearing * 180) / Math.PI + 360) % 360;
  }

  return {
    cells: Int32Array.from(cells),
    indices,
    weights,
    k,
    shore,
    normalX,
    normalY,
    bearings,
  };
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

function renderBand(dem, cells, shore, bearings) {
  const png = new PNG({ width: dem.width, height: dem.height });
  png.data.fill(0);

  for (let j = 0; j < cells.length; j++) {
    const p = cells[j] * 4;
    png.data[p] = Math.min(255, Math.round(shore[j] / CELL_SIZE));
    png.data[p + 1] = Math.round(bearings[j] / 2) % 180;
    png.data[p + 3] = 255;
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

  const facing = {};
  const directions = {};
  for (const name of DIRECTIONS) {
    let fx = 0;
    let fy = 0;
    for (let n = 0; n < blend.k; n++) {
      const degrees =
        summary.points[blend.indices[base + n]].directions?.[name]?.[hour];
      if (!Number.isFinite(degrees)) continue;
      const radians = (degrees * Math.PI) / 180;
      fx += Math.cos(radians) * blend.weights[base + n];
      fy += Math.sin(radians) * blend.weights[base + n];
    }
    facing[name] = fx * blend.normalX[j] + fy * blend.normalY[j];
    directions[name] =
      fx === 0 && fy === 0
        ? null
        : Math.round(((Math.atan2(fy, fx) * 180) / Math.PI + 360) % 360);
  }

  layers.visibility = round(
    math.shoreAdjusted(layers.visibility, blend.shore[j]),
    2,
  );

  let sum = 0;
  let used = 0;

  for (const [name, spec] of SCORED_LAYERS) {
    let reading = layers[name];
    if (!Number.isFinite(reading)) continue;

    if (name in facing) {
      reading = math.exposed(reading, name, facing[name]);
      layers[name] = round(reading, 2);
    }

    sum += math.normalize(reading, spec.perfect, spec.undivable) * spec.weight;
    used += spec.weight;
  }

  const score = used ? sum / used : 1;

  layers.clarity = round(math.clarityMeters(layers.visibility), 1);

  return {
    time,
    x,
    y,
    offshore: false,
    shore: Math.round(blend.shore[j]),
    class: SEA_CLASS_NAMES[math.classify(score)],
    score: round(score, 3),
    layers,
    directions,
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
  const { cells, indices, weights, k, shore, normalX, normalY } = blend;

  const hours = marine.time.length - marine.historyHours;
  const hourClass = new Uint8Array(hours);
  const scores = new Float64Array(points.length);
  const classes = new Uint8Array(cells.length);

  const png = new PNG({ width: dem.width, height: dem.height });
  png.data.fill(0);

  if (onOverlay)
    await onOverlay({
      time: "band",
      etag: `"${id}:band"`,
      png: renderBand(dem, cells, shore, blend.bearings),
    });

  const summaryPoints = points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    score: new Array(hours),
    layers: Object.fromEntries(
      LAYER_NAMES.map((name) => [name, new Array(hours)]),
    ),
    directions: Object.fromEntries(
      DIRECTIONS.map((name) => [name, new Array(hours)]),
    ),
  }));

  const readings = SCORED_LAYERS.map(() => new Float64Array(points.length));
  const present = SCORED_LAYERS.map(() => new Uint8Array(points.length));
  const layerHourClass = SCORED_LAYERS.map(() => new Uint8Array(hours));
  const dirX = DIRECTIONS.map(() => new Float64Array(points.length));
  const dirY = DIRECTIONS.map(() => new Float64Array(points.length));

  for (let hour = 0; hour < hours; hour++) {
    const index = marine.historyHours + hour;

    for (let p = 0; p < points.length; p++) {
      scores[p] = math.score(points[p], index) ?? 1;
      summaryPoints[p].score[hour] = round(scores[p], 3);

      const values = math.layerValues(points[p], index);
      for (const name of LAYER_NAMES)
        summaryPoints[p].layers[name][hour] = round(values[name], 2);

      SCORED_LAYERS.forEach(([name], li) => {
        const reading = values[name];
        present[li][p] = Number.isFinite(reading) ? 1 : 0;
        readings[li][p] = Number.isFinite(reading) ? reading : 0;
      });

      DIRECTIONS.forEach((name, di) => {
        const degrees = points[p][DIRECTION_SOURCES[name]]?.[index];
        summaryPoints[p].directions[name][hour] = Number.isFinite(degrees)
          ? Math.round(degrees)
          : null;
        const radians = ((degrees ?? 0) * Math.PI) / 180;
        dirX[di][p] = Number.isFinite(degrees) ? Math.cos(radians) : 0;
        dirY[di][p] = Number.isFinite(degrees) ? Math.sin(radians) : 0;
      });
    }

    const counts = new Int32Array(SEA_CLASS_NAMES.length);
    const layerCounts = SCORED_LAYERS.map(() =>
      new Int32Array(SEA_CLASS_NAMES.length),
    );

    for (let j = 0; j < cells.length; j++) {
      const base = j * k;

      const facing = DIRECTIONS.map((_, di) => {
        let fx = 0;
        let fy = 0;
        for (let n = 0; n < k; n++) {
          const p = indices[base + n];
          fx += dirX[di][p] * weights[base + n];
          fy += dirY[di][p] * weights[base + n];
        }
        return fx * normalX[j] + fy * normalY[j];
      });

      let sum = 0;
      let used = 0;

      for (let li = 0; li < SCORED_LAYERS.length; li++) {
        let blended = 0;
        let weight = 0;

        for (let n = 0; n < k; n++) {
          const p = indices[base + n];
          if (!present[li][p]) continue;
          blended += readings[li][p] * weights[base + n];
          weight += weights[base + n];
        }
        if (!weight) continue;

        const [name, spec] = SCORED_LAYERS[li];
        let reading = blended / weight;

        if (name === "visibility") reading = math.shoreAdjusted(reading, shore[j]);
        const di = DIRECTIONS.indexOf(name);
        if (di !== -1) reading = math.exposed(reading, name, facing[di]);

        const normalized = math.normalize(reading, spec.perfect, spec.undivable);
        layerCounts[li][math.classify(normalized)]++;

        sum += normalized * spec.weight;
        used += spec.weight;
      }

      const value = used ? sum / used : 1;
      const seaClass = math.classify(value);
      classes[j] = seaClass;
      counts[seaClass]++;
    }

    hourClass[hour] = percentileClass(counts, cells.length);
    for (let li = 0; li < SCORED_LAYERS.length; li++)
      layerHourClass[li][hour] = percentileClass(
        layerCounts[li],
        cells.length,
      );

    if (onOverlay)
      await onOverlay({
        time: marine.time[index],
        etag: `"${marine.runAt}:${id}:sea:${hour}"`,
        png: renderOverlay(png, cells, classes),
      });
  }

  const dayClassOf = (series, start) => {
    const slice = Array.from(series.slice(start, start + HOURS_PER_DAY));
    slice.sort((a, b) => a - b);
    return SEA_CLASS_NAMES[slice[Math.floor(PERCENTILE * (slice.length - 1))]];
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
        SCORED_LAYERS.map(([name], li) => [
          name,
          dayClassOf(layerHourClass[li], start),
        ]),
      ),
      hours: Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
        time: marine.time[marine.historyHours + start + h],
        seaClass: SEA_CLASS_NAMES[hourClass[start + h]],
        layerClass: Object.fromEntries(
          SCORED_LAYERS.map(([name], li) => [
            name,
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

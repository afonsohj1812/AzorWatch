import { mkdir, readFile, writeFile, open, access } from "node:fs/promises";
import { createWriteStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { islands } from "../config/islands.js";
import { parseDem } from "./demFormat.js";

const DEM_DIR = "data/dem";
const CACHE_DIR = "data/cache";

const { cellSize, sea } = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
);

const BAND_CELLS = Math.round(sea.bandMeters / cellSize);

const M_PER_DEG_LAT = 111320;
const OCEAN = -32768;

const FORMAT = 2;
const ORTHOGONAL = 3;
const DIAGONAL = 4;
const FAR = 60000;
const MAX_COAST_DISTANCE = 255;

const PX_PER_DEG = 3600;
const ORIGIN_LON = -32;
const ORIGIN_LAT = 40;

const tileUrl = (name) =>
  `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_${name}_DEM/Copernicus_DSM_COG_10_${name}_DEM.tif`;

function tileName(south, west) {
  const ns = `${south < 0 ? "S" : "N"}${String(Math.abs(south)).padStart(2, "0")}`;
  const ew = `${west < 0 ? "W" : "E"}${String(Math.abs(west)).padStart(3, "0")}`;
  return `${ns}_00_${ew}_00`;
}

function requiredTiles() {
  const names = new Set();
  for (const { bbox } of islands) {
    const [w, s, e, n] = bbox;
    for (let lat = Math.floor(s); lat <= Math.floor(n); lat++) {
      for (let lon = Math.floor(w); lon <= Math.floor(e); lon++) {
        names.add(tileName(lat, lon));
      }
    }
  }
  return [...names].sort();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(name) {
  const path = `${CACHE_DIR}/${name}.tif`;
  if (await exists(path)) return path;

  const res = await fetch(tileUrl(name));
  if (res.status === 404) {
    console.log(`  ${name}  not published (open ocean), treating as sea`);
    return null;
  }
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);

  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  console.log(`  ${name}  downloaded`);
  return path;
}

async function loadTile(path) {
  const { fromFile } = await import("geotiff");
  const image = await (await fromFile(path)).getImage();
  const [raster] = await image.readRasters();

  const out = new Int16Array(raster.length);
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    out[i] = Number.isFinite(v) && v > -500 && v < 9000 ? Math.round(v) : 0;
  }
  return out;
}

async function loadTiles() {
  const names = requiredTiles();
  console.log(`tiles: ${names.length} needed`);
  await mkdir(CACHE_DIR, { recursive: true });

  const tiles = new Map();
  for (const name of names) {
    const path = await download(name);
    if (path) tiles.set(name, await loadTile(path));
  }
  return tiles;
}

function pixelAt(tiles, ix, iy) {
  const tx = Math.floor(ix / PX_PER_DEG);
  const ty = Math.floor(iy / PX_PER_DEG);
  const tile = tiles.get(tileName(ORIGIN_LAT - ty - 1, ORIGIN_LON + tx));
  if (!tile) return 0;
  return tile[(iy - ty * PX_PER_DEG) * PX_PER_DEG + (ix - tx * PX_PER_DEG)];
}

function sample(tiles, lat, lon) {
  const gx = (lon - ORIGIN_LON) * PX_PER_DEG - 0.5;
  const gy = (ORIGIN_LAT - lat) * PX_PER_DEG - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;

  const v00 = pixelAt(tiles, x0, y0);
  const v10 = pixelAt(tiles, x0 + 1, y0);
  const v01 = pixelAt(tiles, x0, y0 + 1);
  const v11 = pixelAt(tiles, x0 + 1, y0 + 1);

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

function deriveSlopeAspect(elevation, width, height) {
  const slope = new Uint8Array(width * height);
  const aspect = new Uint8Array(width * height);
  const z = (x, y) => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    const v = elevation[cy * width + cx];
    return v === OCEAN ? 0 : v;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nw = z(x - 1, y - 1),
        n = z(x, y - 1),
        ne = z(x + 1, y - 1);
      const w = z(x - 1, y),
        e = z(x + 1, y);
      const sw = z(x - 1, y + 1),
        s = z(x, y + 1),
        se = z(x + 1, y + 1);

      const dzdE = (ne + 2 * e + se - (nw + 2 * w + sw)) / (8 * cellSize);
      const dzdN = (nw + 2 * n + ne - (sw + 2 * s + se)) / (8 * cellSize);

      const i = y * width + x;
      slope[i] = Math.min(
        90,
        Math.round((Math.atan(Math.hypot(dzdE, dzdN)) * 180) / Math.PI),
      );

      let bearing = (Math.atan2(-dzdE, -dzdN) * 180) / Math.PI;
      if (bearing < 0) bearing += 360;
      aspect[i] = Math.round(bearing / 2) % 180;
    }
  }
  return { slope, aspect };
}

function nearestIsland(lat, lon) {
  let nearest = null;
  let shortest = Infinity;

  for (const island of islands) {
    const [centerLat, centerLon] = island.center;
    const dx = (lon - centerLon) * Math.cos((lat * Math.PI) / 180);
    const dy = lat - centerLat;
    const distance = dx * dx + dy * dy;

    if (distance < shortest) {
      shortest = distance;
      nearest = island.id;
    }
  }

  return nearest;
}

function maskForeignLand(elevation, width, height, island) {
  const [west, south, east, north] = island.bbox;
  const label = new Int32Array(width * height).fill(-1);
  const sumX = [];
  const sumY = [];
  const counts = [];
  const stack = [];

  for (let start = 0; start < elevation.length; start++) {
    if (label[start] !== -1 || elevation[start] === OCEAN) continue;

    const id = counts.length;
    sumX.push(0);
    sumY.push(0);
    counts.push(0);

    stack.push(start);
    label[start] = id;

    while (stack.length) {
      const i = stack.pop();
      const x = i % width;
      const y = (i / width) | 0;

      sumX[id] += x;
      sumY[id] += y;
      counts[id]++;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const j = ny * width + nx;
          if (label[j] !== -1 || elevation[j] === OCEAN) continue;

          label[j] = id;
          stack.push(j);
        }
      }
    }
  }

  const foreign = counts.map((count, id) => {
    const lon = west + ((sumX[id] / count + 0.5) / width) * (east - west);
    const lat = north - ((sumY[id] / count + 0.5) / height) * (north - south);
    return nearestIsland(lat, lon) !== island.id;
  });

  let masked = 0;
  for (let i = 0; i < elevation.length; i++) {
    if (label[i] !== -1 && foreign[label[i]]) {
      elevation[i] = OCEAN;
      masked++;
    }
  }

  return masked;
}

function deriveCoastDistance(elevation, width, height) {
  const size = width * height;
  const spread = new Uint16Array(size);

  for (let i = 0; i < size; i++)
    spread[i] = elevation[i] === OCEAN ? FAR : 0;

  const at = (x, y) =>
    x < 0 || y < 0 || x >= width || y >= height ? FAR : spread[y * width + x];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (spread[i] === 0) continue;

      spread[i] = Math.min(
        spread[i],
        at(x - 1, y) + ORTHOGONAL,
        at(x, y - 1) + ORTHOGONAL,
        at(x - 1, y - 1) + DIAGONAL,
        at(x + 1, y - 1) + DIAGONAL,
        FAR,
      );
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (spread[i] === 0) continue;

      spread[i] = Math.min(
        spread[i],
        at(x + 1, y) + ORTHOGONAL,
        at(x, y + 1) + ORTHOGONAL,
        at(x + 1, y + 1) + DIAGONAL,
        at(x - 1, y + 1) + DIAGONAL,
        FAR,
      );
    }
  }

  const coast = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (elevation[i] === OCEAN)
      coast[i] = Math.min(
        MAX_COAST_DISTANCE,
        Math.round(spread[i] / ORTHOGONAL),
      );
  }

  return coast;
}

function buildIsland(tiles, island) {
  const [west, south, east, north] = island.bbox;
  const latMid = (south + north) / 2;

  const dLat = cellSize / M_PER_DEG_LAT;
  const dLon = cellSize / (M_PER_DEG_LAT * Math.cos((latMid * Math.PI) / 180));

  const width = Math.round((east - west) / dLon);
  const height = Math.round((north - south) / dLat);

  const elevation = new Int16Array(width * height);

  for (let y = 0; y < height; y++) {
    const lat = north - (y + 0.5) * dLat;
    for (let x = 0; x < width; x++) {
      const lon = west + (x + 0.5) * dLon;
      const z = Math.round(sample(tiles, lat, lon));
      elevation[y * width + x] = z >= 1 ? z : OCEAN;
    }
  }

  const foreign = maskForeignLand(elevation, width, height, island);

  let land = 0;
  for (let i = 0; i < elevation.length; i++)
    if (elevation[i] !== OCEAN) land++;

  const { slope, aspect } = deriveSlopeAspect(elevation, width, height);
  const coast = deriveCoastDistance(elevation, width, height);

  return {
    width,
    height,
    dLat,
    dLon,
    elevation,
    slope,
    aspect,
    coast,
    land,
    foreign,
  };
}

async function writeGrid(island, grid) {
  const json = JSON.stringify({
    id: island.id,
    format: FORMAT,
    width: grid.width,
    height: grid.height,
    bbox: island.bbox,
    cellSize,
    ocean: OCEAN,
  });
  const header = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);

  await writeFile(
    `${DEM_DIR}/${island.id}.bin`,
    Buffer.concat([
      length,
      header,
      Buffer.from(
        grid.elevation.buffer,
        grid.elevation.byteOffset,
        grid.elevation.byteLength,
      ),
      Buffer.from(grid.aspect.buffer),
      Buffer.from(grid.slope.buffer),
      Buffer.from(grid.coast.buffer),
    ]),
  );
}

const SUMMITS = [
  ["pico", "Pico", 38.4687, -28.3994, 2351],
  ["sao-miguel", "Pico da Vara", 37.8097, -25.2107, 1103],
  ["faial", "Cabeço Gordo", 38.5757, -28.7132, 1043],
  ["terceira", "Santa Bárbara", 38.7299, -27.3183, 1021],
  ["sao-jorge", "Pico da Esperança", 38.6504, -28.0738, 1053],
  ["flores", "Morro Alto", 39.4635, -31.2201, 914],
  ["santa-maria", "Pico Alto", 36.983, -25.0907, 587],
  ["graciosa", "Caldeira", 39.0212, -27.966, 402],
  ["corvo", "Estreitinho", 39.6993, -31.1152, 718],
];

function bandCells(grid) {
  let count = 0;
  for (let i = 0; i < grid.coast.length; i++)
    if (grid.coast[i] >= 1 && grid.coast[i] <= BAND_CELLS) count++;
  return count;
}

function borderClear(grid) {
  const { width, height, elevation, coast } = grid;
  const blocked = (i) =>
    elevation[i] !== OCEAN || (coast[i] >= 1 && coast[i] <= BAND_CELLS);

  for (let x = 0; x < width; x++)
    if (blocked(x) || blocked((height - 1) * width + x)) return false;

  for (let y = 0; y < height; y++)
    if (blocked(y * width) || blocked(y * width + width - 1)) return false;

  return true;
}

const SUMMIT_TOLERANCE = 60;
const TOTAL_LAND_KM2 = 2322;
const AREA_TOLERANCE = 0.15;

function verify(grids) {
  let failures = 0;

  for (const [id, name, lat, lon, expected] of SUMMITS) {
    const island = islands.find((i) => i.id === id);
    const grid = grids.get(id);
    const [west, south, east, north] = island.bbox;

    const cx = Math.round((lon - west) / grid.dLon - 0.5);
    const cy = Math.round((north - lat) / grid.dLat - 0.5);
    let peak = 0;
    for (let y = cy - 4; y <= cy + 4; y++) {
      for (let x = cx - 4; x <= cx + 4; x++) {
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        const v = grid.elevation[y * grid.width + x];
        if (v !== OCEAN && v > peak) peak = v;
      }
    }

    const off = peak - expected;
    const ok = Math.abs(off) <= SUMMIT_TOLERANCE;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${name.padEnd(18)} ${String(peak).padStart(4)} m  (expected ${expected}, off by ${off > 0 ? "+" : ""}${off})`,
    );
  }

  for (const island of islands) {
    const ok = borderClear(grids.get(island.id));
    if (!ok) failures++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${island.name.padEnd(18)} ${sea.bandMeters}m band fits inside the bbox`,
    );
  }

  const areaKm2 =
    ([...grids.values()].reduce((sum, g) => sum + g.land, 0) * cellSize ** 2) /
    1e6;
  const areaOk =
    Math.abs(areaKm2 - TOTAL_LAND_KM2) / TOTAL_LAND_KM2 <= AREA_TOLERANCE;
  if (!areaOk) failures++;
  console.log(
    `  ${areaOk ? "ok  " : "FAIL"} total land area   ${areaKm2.toFixed(0)} km2  (expected ~${TOTAL_LAND_KM2})`,
  );

  return failures;
}

async function prepareDem() {
  await mkdir(DEM_DIR, { recursive: true });

  const tiles = await loadTiles();

  console.log("grids:");
  const grids = new Map();
  for (const island of islands) {
    const grid = buildIsland(tiles, island);
    await writeGrid(island, grid);
    grids.set(island.id, grid);
    const band = bandCells(grid);
    console.log(
      `  ${island.id.padEnd(12)} ${String(grid.width).padStart(4)}x${String(grid.height).padStart(3)}  ${String(((grid.land * cellSize ** 2) / 1e6).toFixed(0)).padStart(3)} km2 land  ${String(band).padStart(6)} band cells${grid.foreign ? `  (masked ${((grid.foreign * cellSize ** 2) / 1e6).toFixed(0)} km2 of a neighbor)` : ""}`,
    );
  }

  console.log("checks:");
  const failures = verify(grids);
  if (failures)
    throw new Error(`${failures} DEM check(s) failed, refusing to continue`);

  console.log("all checks passed");
}

async function builtHeader(path) {
  let file;
  try {
    file = await open(path);
    const length = Buffer.alloc(4);
    await file.read(length, 0, 4, 0);

    const header = Buffer.alloc(length.readUInt32LE(0));
    await file.read(header, 0, header.length, 4);
    return JSON.parse(header);
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

function matchesConfig(header, island) {
  return (
    header?.format === FORMAT &&
    header?.cellSize === cellSize &&
    header?.bbox?.length === 4 &&
    header.bbox.every((value, i) => value === island.bbox[i])
  );
}

const cache = new Map();

let preparing = null;

async function ensureDem() {
  preparing ??= (async () => {
    const stale = [];
    for (const island of islands) {
      const header = await builtHeader(`${DEM_DIR}/${island.id}.bin`);
      if (!matchesConfig(header, island)) stale.push(island.id);
    }
    if (!stale.length) return;

    console.log(
      `DEM missing or out of date for ${stale.join(", ")}, preparing (a few minutes, ~20 MB)`,
    );
    await prepareDem();
  })();

  return preparing;
}

export async function loadDem(id) {
  if (cache.has(id)) return cache.get(id);

  await ensureDem();

  const buf = await readFile(`${DEM_DIR}/${id}.bin`);
  const dem =
    buf.byteOffset % 4 === 0
      ? parseDem(buf.buffer, buf.byteOffset)
      : parseDem(Uint8Array.from(buf).buffer);

  cache.set(id, dem);
  return dem;
}

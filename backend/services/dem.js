import { readFile, open } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { islands } from "../shared/islands.js";
import { parseDem } from "../shared/demFormat.js";

const DEM_DIR = "data/dem";

const { cellSize } = JSON.parse(
  readFileSync(new URL("../config/fogModel.json", import.meta.url)),
);

async function builtCellSize(path) {
  let file;
  try {
    file = await open(path);
    const length = Buffer.alloc(4);
    await file.read(length, 0, 4, 0);

    const header = Buffer.alloc(length.readUInt32LE(0));
    await file.read(header, 0, header.length, 4);
    return JSON.parse(header).cellSize;
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

const cache = new Map();

let preparing = null;

export async function ensureDem() {
  preparing ??= (async () => {
    const stale = [];
    for (const { id } of islands) {
      if ((await builtCellSize(`${DEM_DIR}/${id}.bin`)) !== cellSize)
        stale.push(id);
    }
    if (!stale.length) return;

    console.log(
      `DEM missing or not built at ${cellSize}m for ${stale.join(", ")}, preparing (a few minutes, ~20 MB)`,
    );
    await import("../scripts/prepare-dem.js");
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

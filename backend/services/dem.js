import { readFile, access } from "node:fs/promises";

import { islands } from "../shared/islands.js";
import { parseDem } from "../shared/demFormat.js";

const DEM_DIR = "data/dem";

const cache = new Map();

let preparing = null;

export async function ensureDem() {
  preparing ??= (async () => {
    const missing = [];
    for (const { id } of islands) {
      try {
        await access(`${DEM_DIR}/${id}.bin`);
      } catch {
        missing.push(id);
      }
    }
    if (!missing.length) return;

    console.log(
      `DEM missing for ${missing.join(", ")}, preparing (a few minutes, ~20 MB)`,
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

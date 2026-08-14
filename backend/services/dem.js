import { readFile, access } from "node:fs/promises";

import { islands } from "../shared/islands.js";

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
  const headerLength = buf.readUInt32LE(0);
  const header = JSON.parse(buf.subarray(4, 4 + headerLength));
  const cells = header.width * header.height;

  let base = buf.byteOffset + 4 + headerLength;
  let source = buf.buffer;
  if (base % 4 !== 0) {
    const copy = Buffer.from(buf.subarray(4 + headerLength));
    source = copy.buffer;
    base = copy.byteOffset;
  }

  const dem = {
    ...header,
    elevation: new Int16Array(source, base, cells),
    aspect: new Uint8Array(source, base + cells * 2, cells),
    slope: new Uint8Array(source, base + cells * 3, cells),
  };

  cache.set(id, dem);
  return dem;
}

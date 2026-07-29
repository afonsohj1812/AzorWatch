// Loads the 50 m grids written by scripts/prepare-dem.js.
//
// Layout: uint32 header length, JSON header (padded to 4 bytes), then Int16
// elevation, Uint8 aspect (degrees/2) and Uint8 slope (degrees).

import { readFile } from "node:fs/promises";

const DEM_DIR = "data/dem";

const cache = new Map();

export async function loadDem(id) {
  if (cache.has(id)) return cache.get(id);

  const buf = await readFile(`${DEM_DIR}/${id}.bin`);
  const headerLength = buf.readUInt32LE(0);
  const header = JSON.parse(buf.subarray(4, 4 + headerLength));
  const cells = header.width * header.height;

  // The header is padded so this lands 4-byte aligned, but readFile can hand back
  // a pooled buffer at an odd offset — copy in that case rather than throwing.
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

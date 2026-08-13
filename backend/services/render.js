import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import { getIslandFog } from "./fogModel.js";

const config = JSON.parse(
  readFileSync(new URL("../config/fogModel.json", import.meta.url)),
);

const PALETTE = [
  [0, 0, 0, 0],
  config.colors.yellow,
  config.colors.orange,
  config.colors.red,
];

const cache = new Map();

export async function renderOverlay(id, hour) {
  const fog = await getIslandFog(id);
  if (!fog || hour < 0 || hour >= fog.grids.length) return null;

  const key = `${id}:${hour}:${fog.runAt}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const classes = fog.grids[hour];
  const png = new PNG({ width: fog.width, height: fog.height });

  for (let i = 0; i < classes.length; i++) {
    const [r, g, b, a] = PALETTE[classes[i]];
    const p = i * 4;
    png.data[p] = r;
    png.data[p + 1] = g;
    png.data[p + 2] = b;
    png.data[p + 3] = a;
  }

  const result = {
    buffer: PNG.sync.write(png),
    etag: `"${fog.runAt}:${id}:${hour}"`,
  };

  cache.set(key, result);
  return result;
}

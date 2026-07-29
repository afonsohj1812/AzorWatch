// Renders a class grid as a translucent PNG for Leaflet to drape over the map.
//
// One image per island-hour. Ocean and no-fog are fully transparent, so the
// basemap shows through and the overlay is just the fog. The data is blocky and
// mostly empty, which PNG compresses very well — tens of KB for a grid that is
// megabytes raw.

import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

import { getIslandFog } from "./fogModel.js";

const config = JSON.parse(
  readFileSync(new URL("../config/fogModel.json", import.meta.url)),
);

// Class index -> RGBA. NONE stays fully transparent, so ocean and clear land
// leave the basemap untouched.
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
    bbox: fog.bbox,
    width: fog.width,
    height: fog.height,
    time: fog.time[hour],
    // The forecast run is in the key, so a new run invalidates every image.
    etag: `"${fog.runAt}:${id}:${hour}"`,
  };

  cache.set(key, result);
  return result;
}

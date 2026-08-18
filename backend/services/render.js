import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const config = JSON.parse(
  readFileSync(new URL("../config/model.json", import.meta.url)),
);

const PALETTE = [
  [0, 0, 0, 0],
  config.colors.yellow,
  config.colors.orange,
  config.colors.red,
];

export function renderOverlay(fog, id, hour) {
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

  return {
    buffer: PNG.sync.write(png),
    etag: `"${fog.runAt}:${id}:${hour}"`,
  };
}

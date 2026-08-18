import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises";

import { islands } from "../config/islands.js";
import { getIslandFog, getIslandSummary } from "../services/fogModel.js";
import { renderOverlay } from "../services/render.js";

const OUT = "dist-api";
const DEM_DIR = "data/dem";

async function main() {
  await mkdir(`${OUT}/forecast`, { recursive: true });
  await mkdir(`${OUT}/dem`, { recursive: true });

  await writeFile(`${OUT}/islands.json`, JSON.stringify(islands));
  await copyFile("config/model.json", `${OUT}/config.json`);
  console.log(`islands.json  ${islands.length} islands`);

  let bytes = 0;

  for (const island of islands) {
    const summary = await getIslandSummary(island.id);
    await writeFile(
      `${OUT}/forecast/${island.id}.json`,
      JSON.stringify(summary),
    );

    const fog = await getIslandFog(island.id);
    await mkdir(`${OUT}/fog/${island.id}`, { recursive: true });

    let islandBytes = 0;
    for (let hour = 0; hour < fog.time.length; hour++) {
      const overlay = renderOverlay(fog, island.id, hour);
      await writeFile(
        `${OUT}/fog/${island.id}/${fog.time[hour]}.png`,
        overlay.buffer,
      );
      islandBytes += overlay.buffer.length;
    }

    bytes += islandBytes;
    console.log(
      `  ${island.id.padEnd(12)} ${fog.time.length} hours  ${(islandBytes / 1024).toFixed(0)} KB`,
    );
  }

  for (const file of await readdir(DEM_DIR)) {
    if (file.endsWith(".bin"))
      await copyFile(`${DEM_DIR}/${file}`, `${OUT}/dem/${file}`);
  }

  console.log(
    `\noverlays ${(bytes / 1024 / 1024).toFixed(1)} MB, wrote to ${OUT}/`,
  );
}

await main();

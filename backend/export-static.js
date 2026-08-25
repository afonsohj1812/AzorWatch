import { mkdir, writeFile, copyFile, readdir, rm } from "node:fs/promises";

import { islands } from "./config/islands.js";
import { buildForecast } from "./services/fogModel.js";
import { buildSeaForecast } from "./services/seaModel.js";

const OUT = "dist-api";
const DEM_DIR = "data/dem";

const MODELS = [
  { kind: "fog", build: buildForecast, summaries: "forecast", overlays: "fog" },
  { kind: "sea", build: buildSeaForecast, summaries: "sea", overlays: "sea" },
];

async function main() {
  await mkdir(`${OUT}/dem`, { recursive: true });

  await writeFile(`${OUT}/islands.json`, JSON.stringify(islands));
  console.log(`islands.json  ${islands.length} islands`);

  const storedAt = new Date().toISOString();
  const failed = new Set();

  for (const model of MODELS) {
    await mkdir(`${OUT}/${model.summaries}`, { recursive: true });

    let bytes = 0;
    console.log(`\n${model.kind}:`);

    for (const island of islands) {
      const dir = `${OUT}/${model.overlays}/${island.id}`;
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });

      let islandBytes = 0;
      let hours = 0;

      let summary;
      try {
        const built = await model.build(island.id, async (overlay) => {
          await writeFile(
            `${OUT}/${model.overlays}/${island.id}/${overlay.time}.png`,
            overlay.png,
          );
          islandBytes += overlay.png.length;
          hours++;
        });

        const { time, ...rest } = built;
        summary = rest;
      } catch (err) {
        failed.add(model.kind);
        console.log(`  ${model.kind} unavailable: ${err.message}`);
        break;
      }

      const json = JSON.stringify({ ...summary, storedAt });
      await writeFile(`${OUT}/${model.summaries}/${island.id}.json`, json);

      bytes += islandBytes;
      console.log(
        `  ${island.id.padEnd(12)} ${hours} hours  ${(islandBytes / 1024).toFixed(0).padStart(5)} KB overlays  ${(json.length / 1024).toFixed(0).padStart(4)} KB summary`,
      );
    }

    console.log(`  ${model.kind} overlays ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  }

  for (const file of await readdir(DEM_DIR)) {
    if (file.endsWith(".bin"))
      await copyFile(`${DEM_DIR}/${file}`, `${OUT}/dem/${file}`);
  }

  if (failed.size)
    console.log(`\nincomplete: ${[...failed].join(", ")} could not be built`);

  console.log(`\nwrote to ${OUT}/`);
}

await main();

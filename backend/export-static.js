import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises";

import { islands } from "./config/islands.js";
import { buildForecast } from "./services/fogModel.js";

const OUT = "dist-api";
const DEM_DIR = "data/dem";

async function main() {
  await mkdir(`${OUT}/forecast`, { recursive: true });
  await mkdir(`${OUT}/dem`, { recursive: true });

  await writeFile(`${OUT}/islands.json`, JSON.stringify(islands));
  await copyFile("config/model.json", `${OUT}/config.json`);
  console.log(`islands.json  ${islands.length} islands`);

  const storedAt = new Date().toISOString();
  let bytes = 0;

  for (const island of islands) {
    await mkdir(`${OUT}/fog/${island.id}`, { recursive: true });

    let islandBytes = 0;
    let hours = 0;

    const { time, ...summary } = await buildForecast(
      island.id,
      async (overlay) => {
        await writeFile(
          `${OUT}/fog/${island.id}/${overlay.time}.png`,
          overlay.png,
        );
        islandBytes += overlay.png.length;
        hours++;
      },
    );

    await writeFile(
      `${OUT}/forecast/${island.id}.json`,
      JSON.stringify({ ...summary, storedAt }),
    );

    bytes += islandBytes;
    console.log(
      `  ${island.id.padEnd(12)} ${hours} hours  ${(islandBytes / 1024).toFixed(0)} KB`,
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

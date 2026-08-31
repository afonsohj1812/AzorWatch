import { mkdir, writeFile, copyFile, readdir, rm } from "node:fs/promises";

import { islands } from "./config/islands.js";
import { modes } from "./config/modes.js";

const OUT = "dist-api";
const DEM_DIR = "data/dem";

async function main() {
  await mkdir(`${OUT}/dem`, { recursive: true });

  await writeFile(`${OUT}/islands.json`, JSON.stringify(islands));
  console.log(`islands.json  ${islands.length} islands`);

  const storedAt = new Date().toISOString();
  const failed = new Set();

  for (const mode of modes) {
    await mkdir(`${OUT}/${mode.id}`, { recursive: true });

    let bytes = 0;
    console.log(`\n${mode.id}:`);

    for (const island of islands) {
      const dir = `${OUT}/${mode.id}/${island.id}`;
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });

      let islandBytes = 0;
      let hours = 0;
      const made = new Set();

      let summary;
      try {
        const built = await mode.build(island.id, async (overlay) => {
          const into = overlay.layer ? `${dir}/${overlay.layer}` : dir;

          if (!made.has(into)) {
            await mkdir(into, { recursive: true });
            made.add(into);
          }

          await writeFile(`${into}/${overlay.time}.png`, overlay.png);
          islandBytes += overlay.png.length;
          if (!overlay.layer) hours++;
        });

        const { time, ...rest } = built;
        summary = rest;
      } catch (err) {
        failed.add(mode.id);
        console.log(`  ${mode.id} unavailable: ${err.message}`);
        break;
      }

      const json = JSON.stringify({ ...summary, storedAt });
      await writeFile(`${OUT}/${mode.id}/${island.id}.json`, json);

      bytes += islandBytes;
      console.log(
        `  ${island.id.padEnd(12)} ${hours} hours  ${(islandBytes / 1024).toFixed(0).padStart(5)} KB overlays  ${(json.length / 1024).toFixed(0).padStart(4)} KB summary`,
      );
    }

    console.log(`  ${mode.id} overlays ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  }

  for (const file of await readdir(DEM_DIR)) {
    if (file.endsWith(".bin"))
      await copyFile(`${DEM_DIR}/${file}`, `${OUT}/dem/${file}`);
  }

  console.log(`\nwrote to ${OUT}/`);

  if (failed.size) {
    console.error(
      `\nincomplete: ${[...failed].join(", ")} could not be built, refusing to publish a partial site`,
    );
    process.exitCode = 1;
  }
}

await main();

import { islands } from "../config/islands.js";
import { modes } from "../config/modes.js";
import { saveForecast, saveOverlays } from "./db.js";

let running = false;

async function store(mode, id, storedAt) {
  const items = [];
  const summary = await mode.build(id, (overlay) => items.push(overlay));
  if (!summary) return;

  await saveForecast(mode.id, id, { ...summary, storedAt });
  await saveOverlays(mode.id, id, summary.runAt, items);
}

export async function runPipeline() {
  if (running)
    return console.log("Pipeline: previous run still going, skipped");

  running = true;
  const storedAt = new Date().toISOString();

  const failed = new Set();

  try {
    for (const island of islands) {
      for (const mode of modes) {
        if (failed.has(mode.id)) continue;

        try {
          await store(mode, island.id, storedAt);
        } catch (err) {
          failed.add(mode.id);
          console.error(
            `Pipeline: ${mode.id} failed (${err.message}), skipping it for the rest of this run`,
          );
        }
      }
    }
  } finally {
    running = false;
  }
}

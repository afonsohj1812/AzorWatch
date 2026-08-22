import { islands } from "../config/islands.js";
import { saveForecast, saveOverlays } from "./db.js";
import { buildForecast } from "./fogModel.js";
import { buildSeaForecast } from "./seaModel.js";

const MODELS = [
  ["fog", buildForecast],
  ["sea", buildSeaForecast],
];

let running = false;

async function store(kind, build, id, storedAt) {
  const items = [];
  const summary = await build(id, (overlay) => items.push(overlay));
  if (!summary) return;

  await saveForecast(kind, id, { ...summary, storedAt });
  await saveOverlays(kind, id, summary.runAt, items);
}

export async function runPipeline() {
  if (running)
    return console.log("Pipeline: previous run still going, skipped");

  running = true;
  const storedAt = new Date().toISOString();

  try {
    for (const island of islands)
      for (const [kind, build] of MODELS)
        await store(kind, build, island.id, storedAt);
  } finally {
    running = false;
  }
}

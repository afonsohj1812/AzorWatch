import { readFileSync } from "node:fs";

import { buildForecast, inspectCell } from "../services/modes/fog/model.js";
import { buildSeaForecast, inspectSeaCell } from "../services/modes/sea/model.js";

const { modes: declared } = JSON.parse(
  readFileSync(new URL("./model.json", import.meta.url)),
);

const BUILDERS = {
  fog: { build: buildForecast, inspect: inspectCell },
  sea: { build: buildSeaForecast, inspect: inspectSeaCell },
};

export const modes = declared.map((mode) => {
  const builder = BUILDERS[mode.id];
  if (!builder) throw new Error(`model.json declares unknown mode "${mode.id}"`);
  return { ...mode, ...builder };
});

export const getMode = (id) => modes.find((mode) => mode.id === id) ?? null;

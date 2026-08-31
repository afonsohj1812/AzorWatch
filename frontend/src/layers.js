import model from "./config/model.json";
import { LAYER_LABELS } from "./services/modes/sea/math";

export const OVERALL = "overall";

const labelOf = (id, spec) =>
  spec.label ?? LAYER_LABELS.find((entry) => entry.id === id)?.label ?? id;

const LISTS = Object.fromEntries(
  model.modes.map(({ id: mode }) => [
    mode,
    [
      { id: OVERALL, label: "Overall" },
      ...Object.entries(model[mode].layers).map(([id, spec]) => ({
        id,
        label: labelOf(id, spec),
      })),
    ],
  ]),
);

export const layersFor = (mode) => LISTS[mode] ?? LISTS[model.modes[0].id];

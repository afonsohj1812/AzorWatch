import model from "./config/model.json";
import { LAYER_LABELS } from "./services/seaMath";

const SEA_RAMP = ["green", "yellow", "orange", "red"];

const trim = (value) => Number(value.toFixed(2)).toString();

export const MODES = [
  { id: "sea", label: "Dive" },
  { id: "fog", label: "Fog" },
];

const resolve = (classes) =>
  classes.map((entry) => ({ ...entry, color: model.classes[entry.id].color }));

const PALETTES = {
  fog: resolve(model.fog.classes),
  sea: resolve(model.sea.classes),
};

export const paletteFor = (mode) => PALETTES[mode] ?? PALETTES.fog;

export const colorOf = (mode, id) =>
  paletteFor(mode).find((entry) => entry.id === id)?.color;

function rampLegend(spec) {
  const ramp = model.fog.surface.ramp;
  const step = (spec.max - spec.min) / ramp.length;

  return {
    title: spec.label.toUpperCase(),
    entries: ramp
      .map((entry, i) => ({
        id: `${spec.label}-${i}`,
        color: model.classes[entry].color,
        label: `${Math.round(spec.min + i * step)} - ${Math.round(spec.min + (i + 1) * step)} ${spec.unit}`,
      }))
      .reverse(),
  };
}

function rangeLegend(id, spec) {
  const meta = LAYER_LABELS.find((entry) => entry.id === id);
  const unit = meta?.unit ?? "";
  const { ranges } = spec;

  const best = ranges[0];
  const worst = ranges[ranges.length - 1];
  const higherIsBetter = best > worst;

  const entries = [
    `${higherIsBetter ? ">" : "<"} ${trim(best)}${unit}`,
    ...ranges.slice(0, -1).map((edge, i) => {
      const next = ranges[i + 1];
      return `${trim(Math.min(edge, next))} - ${trim(Math.max(edge, next))}${unit}`;
    }),
    `${higherIsBetter ? "<" : ">"} ${trim(worst)}${unit}`,
  ].map((label, i) => ({
    id: `${id}-${i}`,
    color: model.classes[SEA_RAMP[i]].color,
    label,
  }));

  return {
    title: (meta?.label ?? id).toUpperCase(),
    entries: entries.reverse(),
  };
}

export function legendFor(mode, layer) {
  const surface = model.fog.surface.layers[layer];
  if (surface) return rampLegend(surface);

  const sea = mode === "sea" ? model.sea.layers[layer] : null;
  if (sea) return rangeLegend(layer, sea);

  return {
    title: mode === "sea" ? "CONDITIONS" : "VISIBILITY",
    entries: paletteFor(mode),
  };
}

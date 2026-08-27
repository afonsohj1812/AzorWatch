import model from "./config/model.json";

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

export function legendFor(mode, layer) {
  const surface = model.fog.surface.layers[layer];
  if (surface) return rampLegend(surface);

  return {
    title: mode === "sea" ? "CONDITIONS" : "VISIBILITY",
    entries: paletteFor(mode),
  };
}

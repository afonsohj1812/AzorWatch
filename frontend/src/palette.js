import model from "./config/model.json";

export const MODES = [
  { id: "fog", label: "Fog" },
  { id: "sea", label: "Dive" },
];

const PALETTES = { fog: model.classes, sea: model.sea.classes };

export const paletteFor = (mode) => PALETTES[mode] ?? PALETTES.fog;

export const colorOf = (mode, id) =>
  paletteFor(mode).find((entry) => entry.id === id)?.color;

function rampLegend(spec) {
  const ramp = model.surface.ramp;
  const step = (spec.max - spec.min) / ramp.length;

  return {
    title: spec.label.toUpperCase(),
    entries: ramp
      .map((entry, i) => ({
        id: `${spec.label}-${i}`,
        color: entry.color,
        range: `${Math.round(spec.min + i * step)} - ${Math.round(spec.min + (i + 1) * step)} ${spec.unit}`,
      }))
      .reverse(),
  };
}

export function legendFor(mode, layer) {
  if (mode === "fog" && layer === "elevation")
    return rampLegend(model.surface.elevation);

  const surface = model.surface.layers[layer];
  if (surface) return rampLegend(surface);

  return {
    title: mode === "sea" ? "CONDITIONS" : "VISIBILITY",
    entries: paletteFor(mode),
  };
}

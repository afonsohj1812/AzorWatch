import model from "./config/model.json";

export const MODES = [
  { id: "fog", label: "Fog" },
  { id: "sea", label: "Dive" },
];

const PALETTES = { fog: model.classes, sea: model.sea.classes };

export const paletteFor = (mode) => PALETTES[mode] ?? PALETTES.fog;

export const colorOf = (mode, id) =>
  paletteFor(mode).find((entry) => entry.id === id)?.color;

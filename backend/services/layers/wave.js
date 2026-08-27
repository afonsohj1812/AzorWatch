import { ramp } from "../curve.js";

export default {
  id: "wave",
  label: "Waves",
  source: "wave_height",
  direction: "wave_direction",
  exposed: true,
  penalty: (cell, config) => ramp(cell.wave, config.perfect, config.undivable),
  readout: (cell) => `${cell.wave.toFixed(1)}m`,
};

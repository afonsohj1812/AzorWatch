export default {
  id: "wave",
  label: "Waves",
  source: "wave_height",
  direction: "wave_direction",
  exposed: true,
  value: (cell) => cell.wave,
  readout: (cell) => `${cell.wave.toFixed(1)}m`,
};

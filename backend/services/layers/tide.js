import { ramp } from "../curve.js";

function rateAt(values, index) {
  const before = values?.[index - 1];
  const here = values?.[index];
  const after = values?.[index + 1];

  if (Number.isFinite(before) && Number.isFinite(after))
    return Math.abs(after - before) / 2;
  if (Number.isFinite(before) && Number.isFinite(here))
    return Math.abs(here - before);
  if (Number.isFinite(here) && Number.isFinite(after))
    return Math.abs(after - here);

  return null;
}

export default {
  id: "tide",
  label: "Tide",
  source: "sea_level_height_msl",

  series: {
    tideRate: (point, index) => rateAt(point.sea_level_height_msl, index),
  },

  penalty: (cell, config) =>
    ramp(cell.tideRate, config.perfect, config.undivable),

  readout: (cell) => `${(cell.tideRate ?? 0).toFixed(2)}m/h`,
};

function rateAt(values, index) {
  const before = values?.[index - 1];
  const here = values?.[index];
  const after = values?.[index + 1];

  if (Number.isFinite(before) && Number.isFinite(after))
    return (after - before) / 2;
  if (Number.isFinite(before) && Number.isFinite(here)) return here - before;
  if (Number.isFinite(here) && Number.isFinite(after)) return after - here;

  return null;
}

export default {
  id: "tide",
  label: "Tide",
  unit: "m/h",
  source: "sea_level_height_msl",

  series: {
    tideRate: (point, index) => rateAt(point.sea_level_height_msl, index),
  },

  value: (cell, config) =>
    cell.tideRate >= 0 ? cell.tideRate : -cell.tideRate * config.falling,

  readout: (cell) => {
    const rate = cell.tideRate ?? 0;
    return `${rate < 0 ? "-" : "+"}${Math.abs(rate).toFixed(2)}m/h`;
  },
};

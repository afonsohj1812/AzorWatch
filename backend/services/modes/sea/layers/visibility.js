import { decayed, ramp } from "../../../curve.js";

const clearAt = (turbidity, config) =>
  config.clear *
  Math.exp(-Math.log(config.clear / config.atOneMeter) * turbidity);

export default {
  id: "visibility",
  label: "Visibility",
  unit: "m",

  series: {
    stir: (point, index, config) =>
      decayed(point.energy, index, config.stir.hours, config.stir.decay),
    runoff: (point, index, config) =>
      decayed(
        point.precipitation,
        index,
        config.runoff.hours,
        config.runoff.decay,
      ),
    gloom: (point, index, config) =>
      ramp(point.shortwave_radiation?.[index], config.light.from, config.light.to),
  },

  meters: (cell, config) => {
    const nearness = ramp(cell.shore, config.shoreRange, 0);
    const exposure =
      config.minExposure + (1 - config.minExposure) * cell.waveFacing;

    const turbidity =
      Math.sqrt(Math.max(0, cell.stir ?? 0)) * config.stir.weight * exposure +
      (cell.runoff ?? 0) * config.runoff.weight +
      (cell.gloom ?? 0) * config.light.weight;

    return clearAt(turbidity * (1 + nearness * config.shoreWeight), config);
  },

  value(cell, config) {
    return this.meters(cell, config);
  },

  readout(cell, config) {
    return `${Math.round(this.meters(cell, config))}m`;
  },
};

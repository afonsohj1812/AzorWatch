import { ramp } from "../curve.js";

export default {
  id: "wind",
  label: "Wind",
  source: "wind_speed_10m",
  direction: "wind_direction_10m",
  exposed: true,
  penalty: (cell, config) => ramp(cell.wind, config.perfect, config.undivable),
  readout: (cell) => `${Math.round(cell.wind)}km/h`,
};

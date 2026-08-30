export default {
  id: "wind",
  label: "Wind",
  source: "wind_speed_10m",
  direction: "wind_direction_10m",
  exposed: true,
  value: (cell) => cell.wind,
  readout: (cell) => `${Math.round(cell.wind)}km/h`,
};

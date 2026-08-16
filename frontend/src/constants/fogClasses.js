export const FOG_CLASSES = [
  { id: "red", color: "#ff3f3f", range: "10m - 100m" },
  { id: "orange", color: "#ff7f3f", range: "100m - 1km" },
  { id: "yellow", color: "#ffff3f", range: "1km - 10km" },
  { id: "none", color: "#dfdfdf", range: "> 10km" },
];

const byId = Object.fromEntries(FOG_CLASSES.map((c) => [c.id, c]));

export const colorOf = (id) => byId[id].color;

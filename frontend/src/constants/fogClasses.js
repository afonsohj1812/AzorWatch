export const FOG_CLASSES = [
  { id: "red", color: "#ff0000", range: "10m - 100m" },
  { id: "orange", color: "#ff7f00", range: "100m - 1km" },
  { id: "yellow", color: "#ffff00", range: "1km - 10km" },
  { id: "none", color: "#dfdfdf", range: "> 10km" },
];

const byId = Object.fromEntries(FOG_CLASSES.map((c) => [c.id, c]));

export const colorOf = (id) => byId[id]?.color ?? byId.none.color;

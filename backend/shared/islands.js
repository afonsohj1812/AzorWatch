export const islands = [
  {
    id: "flores",
    name: "Flores",
    bbox: [-31.3, 39.36, -31.11, 39.54],
    center: [39.45, -31.205],
  },
  {
    id: "corvo",
    name: "Corvo",
    bbox: [-31.14, 39.66, -31.05, 39.73],
    center: [39.695, -31.095],
  },
  {
    id: "faial",
    name: "Faial",
    bbox: [-28.86, 38.5, -28.59, 38.66],
    center: [38.58, -28.725],
  },
  {
    id: "pico",
    name: "Pico",
    bbox: [-28.57, 38.38, -28.02, 38.56],
    center: [38.47, -28.295],
  },
  {
    id: "sao-jorge",
    name: "São Jorge",
    bbox: [-28.33, 38.52, -27.74, 38.77],
    center: [38.645, -28.035],
  },
  {
    id: "graciosa",
    name: "Graciosa",
    bbox: [-28.07, 38.99, -27.92, 39.1],
    center: [39.045, -27.995],
  },
  {
    id: "terceira",
    name: "Terceira",
    bbox: [-27.39, 38.62, -27.03, 38.82],
    center: [38.72, -27.21],
  },
  {
    id: "sao-miguel",
    name: "São Miguel",
    bbox: [-25.88, 37.69, -25.12, 37.91],
    center: [37.8, -25.5],
  },
  {
    id: "santa-maria",
    name: "Santa Maria",
    bbox: [-25.2, 36.91, -25.0, 37.02],
    center: [36.965, -25.1],
  },
];

export function getIsland(id) {
  return islands.find((island) => island.id === id);
}

export const islands = [
  {
    id: "flores",
    name: "Flores",
    bbox: [-31.33, 39.33, -31.08, 39.57],
    center: [39.45, -31.205],
  },
  {
    id: "corvo",
    name: "Corvo",
    bbox: [-31.17, 39.63, -31.02, 39.76],
    center: [39.695, -31.095],
  },
  {
    id: "faial",
    name: "Faial",
    bbox: [-28.89, 38.47, -28.56, 38.69],
    center: [38.58, -28.725],
  },
  {
    id: "pico",
    name: "Pico",
    bbox: [-28.6, 38.35, -27.99, 38.59],
    center: [38.47, -28.295],
  },
  {
    id: "sao-jorge",
    name: "São Jorge",
    bbox: [-28.36, 38.49, -27.71, 38.8],
    center: [38.645, -28.035],
  },
  {
    id: "graciosa",
    name: "Graciosa",
    bbox: [-28.1, 38.96, -27.89, 39.13],
    center: [39.045, -27.995],
  },
  {
    id: "terceira",
    name: "Terceira",
    bbox: [-27.42, 38.59, -27.01, 38.85],
    center: [38.72, -27.21],
  },
  {
    id: "sao-miguel",
    name: "São Miguel",
    bbox: [-25.91, 37.66, -25.09, 37.94],
    center: [37.8, -25.5],
  },
  {
    id: "santa-maria",
    name: "Santa Maria",
    bbox: [-25.23, 36.88, -24.97, 37.05],
    center: [36.965, -25.1],
  },
];

export function getIsland(id) {
  return islands.find((island) => island.id === id);
}

const STATIC = import.meta.env.VITE_STATIC === "1";
const BASE = import.meta.env.BASE_URL;

const url = (path) => (STATIC ? `${BASE}api/${path}` : `/api/${path}`);

export const isStatic = STATIC;

export const islandsUrl = () => url(STATIC ? "islands.json" : "islands");
export const forecastUrl = (id) =>
  url(STATIC ? `forecast/${id}.json` : `forecast/${id}`);
export const fogUrl = (id, time) => url(`fog/${id}/${time}.png`);
export const pointUrl = (id, time, x, y) =>
  url(`point/${id}/${time}?x=${x}&y=${y}`);

export const demUrl = (id) => url(`dem/${id}.bin`);
export const configUrl = () => url("config.json");

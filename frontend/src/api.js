const STATIC = import.meta.env.VITE_STATIC === "1";
const BASE = import.meta.env.BASE_URL;

const url = (path) => (STATIC ? `${BASE}api/${path}` : `/api/${path}`);

export const isStatic = STATIC;

export const islandsUrl = () => url(STATIC ? "islands.json" : "islands");

export const summaryUrl = (mode, id) =>
  mode === "sea"
    ? url(STATIC ? `sea/${id}.json` : `sea/${id}`)
    : url(STATIC ? `forecast/${id}.json` : `forecast/${id}`);

export const overlayUrl = (mode, id, time) =>
  url(`${mode === "sea" ? "sea" : "fog"}/${id}/${time}.png`);

export const pointUrl = (mode, id, time, x, y) =>
  mode === "sea"
    ? url(`sea/point/${id}/${time}?x=${x}&y=${y}`)
    : url(`point/${id}/${time}?x=${x}&y=${y}`);

export const demUrl = (id) => url(`dem/${id}.bin`);
export const configUrl = () => url("config.json");

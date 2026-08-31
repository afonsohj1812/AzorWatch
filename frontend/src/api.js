const STATIC = import.meta.env.VITE_STATIC === "1";
const BASE = import.meta.env.BASE_URL;

const url = (path) => (STATIC ? `${BASE}api/${path}` : `/api/${path}`);

export const isStatic = STATIC;

export const islandsUrl = () => url(STATIC ? "islands.json" : "islands");

export const summaryUrl = (mode, id) =>
  url(STATIC ? `${mode}/${id}.json` : `${mode}/${id}`);

export const overlayUrl = (mode, id, time, layer) =>
  url(`${mode}/${id}/${layer ? `${layer}/` : ""}${time}.png`);

export const pointUrl = (mode, id, time, x, y) =>
  url(`${mode}/point/${id}/${time}?x=${x}&y=${y}`);

export const demUrl = (id) => url(`dem/${id}.bin`);

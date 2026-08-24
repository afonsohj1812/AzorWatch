import model from "./config/model.json";
import {
  createSeaMath,
  nearestPoints,
  SEA_CLASS_NAMES,
} from "./services/seaMath";

const math = createSeaMath(model);

const PALETTE = SEA_CLASS_NAMES.map(
  (name) => model.classes[name].rgb,
);

export const OVERALL = "overall";

export const SURFACE_LAYERS = model.fog.surface.layers;

export const FOG_LAYERS = [
  { id: OVERALL, label: "Overall" },
  ...Object.entries(SURFACE_LAYERS).map(([id, spec]) => ({
    id,
    label: spec.label,
  })),
];

export const isSurfaceLayer = (layer) => layer in SURFACE_LAYERS;

const RAMP = model.fog.surface.ramp.map((id) => model.classes[id].rgb);

export const rampBin = (value, spec) => {
  const span = spec.max - spec.min;
  const fraction = span === 0 ? 0 : (value - spec.min) / span;
  return Math.min(
    RAMP.length - 1,
    Math.max(0, Math.floor(fraction * RAMP.length)),
  );
};

export const SEA_LAYERS = [
  { id: OVERALL, label: "Overall" },
  { id: "wave", label: "Waves" },
  { id: "visibility", label: "Visibility" },
  { id: "wind", label: "Wind" },
  { id: "tide", label: "Tide" },
];

export const layersFor = (mode) => (mode === "sea" ? SEA_LAYERS : FOG_LAYERS);

const masks = new Map();
const blends = new Map();

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function maskFor(id, url) {
  if (masks.has(id)) return masks.get(id);

  const pending = loadImage(url).then((image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);

    const { data } = context.getImageData(0, 0, image.width, image.height);
    const pixels = [];
    const shore = [];
    for (let i = 0; i < image.width * image.height; i++) {
      if (data[i * 4 + 3] === 0) continue;
      pixels.push(i);
      shore.push(data[i * 4] * model.cellSize);
    }

    return {
      width: image.width,
      height: image.height,
      pixels: Int32Array.from(pixels),
      shore: Float32Array.from(shore),
    };
  });

  masks.set(id, pending);
  return pending;
}

function blendFor(id, mask, bbox, points) {
  const signature = `${id}:${points.length}:${points[0].lat},${points[0].lon}`;
  const cached = blends.get(id);
  if (cached?.signature === signature) return cached.blend;

  const [west, south, east, north] = bbox;
  const blend = new Array(mask.pixels.length);

  for (let j = 0; j < mask.pixels.length; j++) {
    const i = mask.pixels[j];
    const x = i % mask.width;
    const y = (i / mask.width) | 0;
    const lon = west + ((x + 0.5) / mask.width) * (east - west);
    const lat = north - ((y + 0.5) / mask.height) * (north - south);

    blend[j] = nearestPoints(
      lat,
      lon,
      points,
      model.sea.neighbors,
      model.sea.idwPower,
    );
  }

  blends.set(id, { signature, blend });
  return blend;
}

function paintSurface(mask, blend, points, layer, hour) {
  const spec = SURFACE_LAYERS[layer];
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;

  const context = canvas.getContext("2d");
  const image = context.createImageData(mask.width, mask.height);

  for (let j = 0; j < mask.pixels.length; j++) {
    let value = 0;
    let weight = 0;

    for (const { index, weight: share } of blend[j]) {
      const reading = points[index][spec.source]?.[hour];
      if (!Number.isFinite(reading)) continue;
      value += reading * share;
      weight += share;
    }
    if (!weight) continue;

    const [r, g, b, a] = RAMP[rampBin(value / weight, spec)];
    const p = mask.pixels[j] * 4;
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = a;
  }

  context.putImageData(image, 0, 0);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)), "image/png"),
  );
}

function paint(mask, blend, points, layer, hour) {
  const spec = model.sea.layers[layer];
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;

  const context = canvas.getContext("2d");
  const image = context.createImageData(mask.width, mask.height);

  for (let j = 0; j < mask.pixels.length; j++) {
    let value = 0;
    let weight = 0;

    for (const { index, weight: share } of blend[j]) {
      const reading = points[index].layers[layer][hour];
      if (reading === null) continue;
      value += reading * share;
      weight += share;
    }
    if (!weight) continue;

    const reading =
      layer === "visibility"
        ? math.shoreAdjusted(value / weight, mask.shore[j])
        : value / weight;

    const normalized = math.normalize(reading, spec.perfect, spec.undivable);
    const [r, g, b, a] = PALETTE[math.classify(normalized)];

    const p = mask.pixels[j] * 4;
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = a;
  }

  context.putImageData(image, 0, 0);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)), "image/png"),
  );
}

export async function renderLayer({ id, bbox, points, layer, hour, maskUrl }) {
  const surface = isSurfaceLayer(layer);
  if (!points?.length || !(surface || model.sea.layers[layer])) return null;

  const key = surface ? `${id}:land` : id;
  const mask = await maskFor(key, maskUrl);
  if (!mask.pixels.length) return null;

  const blend = blendFor(key, mask, bbox, points);
  return surface
    ? paintSurface(mask, blend, points, layer, hour)
    : paint(mask, blend, points, layer, hour);
}

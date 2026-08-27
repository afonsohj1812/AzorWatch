import model from "./config/model.json";
import {
  createSeaMath,
  LAYER_LABELS,
  nearestPoints,
  SEA_CLASS_NAMES,
} from "./services/seaMath";

const math = createSeaMath(model);

const PALETTE = SEA_CLASS_NAMES.map(
  (name) => model.classes[name].rgb,
);

export const OVERALL = "overall";

const SURFACE_LAYERS = model.fog.surface.layers;

const FOG_LAYERS = [
  { id: OVERALL, label: "Overall" },
  ...Object.entries(SURFACE_LAYERS).map(([id, spec]) => ({
    id,
    label: spec.label,
  })),
];

export const isSurfaceLayer = (layer) => layer in SURFACE_LAYERS;

const RAMP = model.fog.surface.ramp.map((id) => model.classes[id].rgb);

const rampBin = (value, spec) => {
  const span = spec.max - spec.min;
  const fraction = span === 0 ? 0 : (value - spec.min) / span;
  return Math.min(
    RAMP.length - 1,
    Math.max(0, Math.floor(fraction * RAMP.length)),
  );
};

const SEA_LAYERS = [
  { id: OVERALL, label: "Overall" },
  ...LAYER_LABELS.filter(({ id }) => model.sea.layers[id]),
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
    const bearing = [];
    for (let i = 0; i < image.width * image.height; i++) {
      if (data[i * 4 + 3] === 0) continue;
      pixels.push(i);
      shore.push(data[i * 4] * model.cellSize);
      bearing.push((data[i * 4 + 1] * 2 * Math.PI) / 180);
    }

    return {
      width: image.width,
      height: image.height,
      pixels: Int32Array.from(pixels),
      shore: Float32Array.from(shore),
      bearing: Float32Array.from(bearing),
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

function paint(mask, colorAt) {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;

  const context = canvas.getContext("2d");
  const image = context.createImageData(mask.width, mask.height);

  for (let j = 0; j < mask.pixels.length; j++) {
    const rgb = colorAt(j);
    if (!rgb) continue;

    const p = mask.pixels[j] * 4;
    image.data[p] = rgb[0];
    image.data[p + 1] = rgb[1];
    image.data[p + 2] = rgb[2];
    image.data[p + 3] = rgb[3];
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

  if (surface) {
    const spec = SURFACE_LAYERS[layer];
    return paint(mask, (j) => {
      let value = 0;
      let weight = 0;
      for (const { index, weight: share } of blend[j]) {
        const reading = points[index][spec.source]?.[hour];
        if (!Number.isFinite(reading)) continue;
        value += reading * share;
        weight += share;
      }
      return weight ? RAMP[rampBin(value / weight, spec)] : null;
    });
  }

  return paint(mask, (j) => {
    const cell = math.cellFor(points, blend[j], hour, {
      coastMeters: mask.shore[j],
      normalX: Math.cos(mask.bearing[j]),
      normalY: Math.sin(mask.bearing[j]),
    });

    return PALETTE[math.classify(math.penaltyOf(cell, layer))];
  });
}

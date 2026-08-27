import { degreesToVector } from "./curve.js";
import { LAYERS } from "./layers/index.js";

export const SEA_CLASS_NAMES = ["green", "yellow", "orange", "red"];

export const LAYER_SOURCES = Object.fromEntries(
  LAYERS.filter((layer) => layer.source).map((layer) => [
    layer.id,
    layer.source,
  ]),
);

export const DIRECTION_SOURCES = Object.fromEntries(
  LAYERS.filter((layer) => layer.direction).map((layer) => [
    layer.id,
    layer.direction,
  ]),
);

export const SERIES = LAYERS.flatMap((layer) =>
  Object.keys(layer.series ?? {}).map((name) => [name, layer]),
);

export const LAYER_LABELS = LAYERS.map((layer) => ({
  id: layer.id,
  label: layer.label,
}));

export function nearestPoints(lat, lon, points, count, power) {
  const scale = Math.cos((lat * Math.PI) / 180);

  const ranked = points
    .map((point, index) => {
      const dx = (point.lon - lon) * scale;
      const dy = point.lat - lat;
      return { index, distance: dx * dx + dy * dy };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(count, points.length));

  if (ranked[0].distance === 0) return [{ index: ranked[0].index, weight: 1 }];

  let total = 0;
  const weighted = ranked.map(({ index, distance }) => {
    const weight = Math.pow(distance, -power / 2);
    total += weight;
    return { index, weight };
  });

  return weighted.map(({ index, weight }) => ({
    index,
    weight: weight / total,
  }));
}

export function createSeaMath(config) {
  const { layers, exposure, classThresholds } = config.sea;

  for (const id of Object.keys(layers))
    if (!LAYERS.some((layer) => layer.id === id))
      throw new Error(`model.json configures unknown sea layer "${id}"`);

  const active = LAYERS.filter((layer) => layers[layer.id]);
  const SCALE = active.reduce((sum, layer) => sum + layers[layer.id].weight, 0);

  function seriesFor(point, index) {
    const values = {};
    for (const [name, layer] of SERIES)
      values[name] = layer.series[name](point, index, layers[layer.id]);
    return values;
  }

  function blend(points, weights, pick) {
    let value = 0;
    let share = 0;

    for (const { index, weight } of weights) {
      const reading = pick(points[index]);
      if (!Number.isFinite(reading)) continue;
      value += reading * weight;
      share += weight;
    }

    return share ? value / share : null;
  }

  function facingOf(points, weights, id, hour, cell) {
    let fx = 0;
    let fy = 0;

    for (const { index, weight } of weights) {
      const vector = degreesToVector(points[index].directions?.[id]?.[hour]);
      if (!vector) continue;
      fx += vector[0] * weight;
      fy += vector[1] * weight;
    }

    return {
      facing: fx * cell.normalX + fy * cell.normalY,
      bearing:
        fx === 0 && fy === 0
          ? null
          : Math.round(((Math.atan2(fy, fx) * 180) / Math.PI + 360) % 360),
    };
  }

  function cellFor(points, weights, hour, place) {
    const cell = { shore: place.coastMeters, waveFacing: 0.5 };

    for (const layer of active) {
      if (layer.source)
        cell[layer.id] = blend(points, weights, (p) => p.layers?.[layer.id]?.[hour]);

      for (const name of Object.keys(layer.series ?? {}))
        cell[name] = blend(points, weights, (p) => p.series?.[name]?.[hour]);

      if (!layer.direction) continue;

      const { facing, bearing } = facingOf(points, weights, layer.id, hour, place);
      cell[`${layer.id}Facing`] = (facing + 1) / 2;
      cell[`${layer.id}Bearing`] = bearing;

      if (layer.exposed && Number.isFinite(cell[layer.id]))
        cell[layer.id] = Math.max(
          0,
          cell[layer.id] * (1 + exposure[layer.id] * facing),
        );
    }

    return cell;
  }

  function scoreCell(points, weights, hour, place) {
    const cell = cellFor(points, weights, hour, place);

    let sum = 0;
    for (const layer of active)
      sum += layer.penalty(cell, layers[layer.id]) * layers[layer.id].weight;

    return { score: sum / SCALE, cell };
  }

  function describe(cell) {
    return active.map((layer) => ({
      id: layer.id,
      label: layer.label,
      penalty: layer.penalty(cell, layers[layer.id]),
      weight: layers[layer.id].weight / SCALE,
      readout: layer.readout?.(cell, layers[layer.id]) ?? null,
      bearing: cell[`${layer.id}Bearing`] ?? null,
    }));
  }

  function penaltyOf(cell, id) {
    const layer = active.find((entry) => entry.id === id);
    return layer ? layer.penalty(cell, layers[id]) : null;
  }

  function classify(value) {
    if (value === null) return null;
    if (value < classThresholds.green) return 0;
    if (value < classThresholds.yellow) return 1;
    if (value < classThresholds.orange) return 2;
    return 3;
  }

  return { seriesFor, cellFor, scoreCell, describe, penaltyOf, classify };
}

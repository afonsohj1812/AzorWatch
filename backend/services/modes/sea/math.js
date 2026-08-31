import { degreesToVector } from "../../curve.js";
import { nearestPoints } from "../../blend.js";
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
  unit: layer.unit ?? "",
}));

export function anchorsOf(ranges) {
  const first = ranges[0];
  const last = ranges[ranges.length - 1];

  return [
    first - (ranges[1] - first),
    ...ranges,
    last + (last - ranges[ranges.length - 2]),
  ];
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

  const LEVELS = [
    0,
    classThresholds.green,
    classThresholds.yellow,
    classThresholds.orange,
    1,
  ];

  function grade(value, config) {
    if (!Number.isFinite(value)) return 1;

    const anchors = anchorsOf(config.ranges);

    for (let i = 0; i < anchors.length - 1; i++) {
      const from = anchors[i];
      const to = anchors[i + 1];
      const inside =
        from <= to ? value >= from && value <= to : value <= from && value >= to;
      if (!inside) continue;

      const share = to === from ? 0 : (value - from) / (to - from);
      return LEVELS[i] + share * (LEVELS[i + 1] - LEVELS[i]);
    }

    const perfect = anchors[0];
    const worseUpward = anchors[anchors.length - 1] > perfect;
    const better = worseUpward ? value < perfect : value > perfect;

    return better ? 0 : 1;
  }

  const valueOf = (layer, cell) => layer.value(cell, layers[layer.id]);
  const penaltyFor = (layer, cell) => grade(valueOf(layer, cell), layers[layer.id]);

  function scoreCell(points, weights, hour, place) {
    const cell = cellFor(points, weights, hour, place);

    let sum = 0;
    for (const layer of active)
      sum += penaltyFor(layer, cell) * layers[layer.id].weight;

    return { score: sum / SCALE, cell };
  }

  function describe(cell) {
    return active.map((layer) => {
      const config = layers[layer.id];

      return {
        id: layer.id,
        label: layer.label,
        penalty: penaltyFor(layer, cell),
        weight: config.weight / SCALE,
        readout: layer.readout?.(cell, config) ?? null,
        bearing: cell[`${layer.id}Bearing`] ?? null,
        value: valueOf(layer, cell),
        from: anchorsOf(config.ranges)[0],
        to: anchorsOf(config.ranges).at(-1),
        ranges: config.ranges,
      };
    });
  }

  function penaltyOf(cell, id) {
    const layer = active.find((entry) => entry.id === id);
    return layer ? penaltyFor(layer, cell) : null;
  }

  function classify(value) {
    if (value === null) return null;
    if (value < classThresholds.green) return 0;
    if (value < classThresholds.yellow) return 1;
    if (value < classThresholds.orange) return 2;
    return 3;
  }

  const bandCells = Math.round(config.sea.bandMeters / config.cellSize);

  function inspect(dem, summary, hour, time, x, y) {
    if (x < 0 || y < 0 || x >= dem.width || y >= dem.height) return null;

    const index = y * dem.width + x;
    const base = { time, x, y };

    if (
      dem.elevation[index] !== dem.ocean ||
      dem.coast[index] < 1 ||
      dem.coast[index] > bandCells
    )
      return {
        ...base,
        outside: true,
        headline: "Outside the band",
        note: `Conditions are modeled within ${config.sea.bandMeters / 1000}km of the coast`,
      };

    const [west, south, east, north] = dem.bbox;
    const lon = west + ((x + 0.5) / dem.width) * (east - west);
    const lat = north - ((y + 0.5) / dem.height) * (north - south);

    const gx = (dem.coast[index + 1] - dem.coast[index - 1]) / 2;
    const gy = (dem.coast[index + dem.width] - dem.coast[index - dem.width]) / 2;
    const bearing = Math.atan2(gx, -gy);
    const facing = Math.min(1, Math.hypot(gx, gy));

    const { score, cell } = scoreCell(
      summary.points,
      nearestPoints(
        lat,
        lon,
        summary.points,
        config.sea.neighbors,
        config.sea.idwPower,
      ),
      hour,
      {
        coastMeters: dem.coast[index] * config.cellSize,
        normalX: Math.cos(bearing) * facing,
        normalY: Math.sin(bearing) * facing,
      },
    );

    return {
      ...base,
      outside: false,
      headline: null,
      note: null,
      class: SEA_CLASS_NAMES[classify(score)],
      score,
      layers: describe(cell),
    };
  }

  return {
    seriesFor,
    cellFor,
    scoreCell,
    describe,
    penaltyOf,
    classify,
    inspect,
  };
}

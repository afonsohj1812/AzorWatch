export const SEA_CLASS = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

export const SEA_CLASS_NAMES = ["green", "yellow", "orange", "red"];

export const LAYER_SOURCES = {
  wave: "wave_height",
  current: "ocean_current_velocity",
  wind: "wind_speed_10m",
  temperature: "sea_surface_temperature",
  tide: "sea_level_height_msl",
};

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
  const { layers, turbidity, shore, classThresholds } = config.sea;

  function normalize(value, perfect, undivable) {
    if (!Number.isFinite(value)) return null;

    const span = undivable - perfect;
    if (span === 0) return 0;

    return Math.min(1, Math.max(0, (value - perfect) / span));
  }

  function decayed(series, index, hours, halfLife, average) {
    let sum = 0;
    let weights = 0;

    for (let back = 0; back < hours; back++) {
      const i = index - back;
      if (i < 0) break;

      const value = series?.[i];
      if (!Number.isFinite(value)) continue;

      const weight = Math.pow(0.5, back / halfLife);
      sum += value * weight;
      weights += weight;
    }

    if (!weights) return null;
    return average ? sum / weights : sum;
  }

  function turbidityAt(sample, index) {
    const stirred = decayed(
      sample.wave_height,
      index,
      turbidity.stirHours,
      turbidity.stirHalfLife,
      true,
    );
    const chopped = decayed(
      sample.wind_wave_height,
      index,
      turbidity.chopHours,
      turbidity.chopHalfLife,
      true,
    );
    const rained = decayed(
      sample.precipitation,
      index,
      turbidity.runoffHours,
      turbidity.runoffHalfLife,
      false,
    );

    const stir =
      normalize(stirred, turbidity.waveClear, turbidity.waveMurky) ?? 0;
    const chop =
      normalize(chopped, turbidity.chopClear, turbidity.chopMurky) ?? 0;
    const runoff =
      normalize(rained, turbidity.rainClear, turbidity.rainMurky) ?? 0;
    const gloom =
      normalize(
        sample.shortwave_radiation?.[index],
        turbidity.lightClear,
        turbidity.lightMurky,
      ) ?? 0;

    return Math.min(
      1,
      turbidity.stirWeight * stir +
        turbidity.chopWeight * chop +
        turbidity.runoffWeight * runoff +
        turbidity.lightWeight * gloom,
    );
  }

  function shoreAdjusted(value, coastMeters) {
    if (!Number.isFinite(value)) return value;

    const near = normalize(coastMeters, shore.clearMeters, 0) ?? 0;
    return value + (1 - value) * shore.weight * near;
  }

  function clarityMeters(value) {
    if (!Number.isFinite(value)) return null;

    const { clearMeters, murkyMeters } = turbidity;
    return clearMeters * Math.pow(murkyMeters / clearMeters, value);
  }

  function layerValues(sample, index) {
    const values = { visibility: turbidityAt(sample, index) };

    for (const [name, source] of Object.entries(LAYER_SOURCES))
      values[name] = sample[source]?.[index] ?? null;

    return values;
  }

  function layerScores(sample, index) {
    const values = layerValues(sample, index);
    const scores = {};

    for (const [name, spec] of Object.entries(layers))
      scores[name] = normalize(values[name], spec.perfect, spec.undivable);

    return scores;
  }

  function score(sample, index) {
    const scores = layerScores(sample, index);

    let sum = 0;
    let weights = 0;

    for (const [name, spec] of Object.entries(layers)) {
      if (scores[name] === null) continue;
      sum += scores[name] * spec.weight;
      weights += spec.weight;
    }

    return weights === 0 ? null : sum / weights;
  }

  function classify(value) {
    if (value === null) return null;
    if (value < classThresholds.green) return SEA_CLASS.GREEN;
    if (value < classThresholds.yellow) return SEA_CLASS.YELLOW;
    if (value < classThresholds.orange) return SEA_CLASS.ORANGE;
    return SEA_CLASS.RED;
  }

  return {
    normalize,
    turbidityAt,
    shoreAdjusted,
    clarityMeters,
    layerValues,
    layerScores,
    score,
    classify,
  };
}

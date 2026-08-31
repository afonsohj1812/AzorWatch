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

export function buildBlend(cells, dem, points, neighbors, power) {
  const { width, height, bbox } = dem;
  const [west, south, east, north] = bbox;

  const k = Math.min(neighbors, points.length);
  const indices = new Int32Array(cells.length * k);
  const weights = new Float32Array(cells.length * k);
  const exponent = -power / 2;
  const scale = Math.cos((((south + north) / 2) * Math.PI) / 180);

  const bestIndex = new Int32Array(k);
  const bestDistance = new Float64Array(k);

  for (let j = 0; j < cells.length; j++) {
    const i = cells[j];
    const x = i % width;
    const y = (i / width) | 0;
    const lon = west + ((x + 0.5) / width) * (east - west);
    const lat = north - ((y + 0.5) / height) * (north - south);

    bestDistance.fill(Infinity);

    for (let p = 0; p < points.length; p++) {
      const dx = (points[p].lon - lon) * scale;
      const dy = points[p].lat - lat;
      const distance = dx * dx + dy * dy;
      if (distance >= bestDistance[k - 1]) continue;

      let n = k - 1;
      while (n > 0 && bestDistance[n - 1] > distance) {
        bestDistance[n] = bestDistance[n - 1];
        bestIndex[n] = bestIndex[n - 1];
        n--;
      }
      bestDistance[n] = distance;
      bestIndex[n] = p;
    }

    const base = j * k;

    if (bestDistance[0] === 0) {
      indices[base] = bestIndex[0];
      weights[base] = 1;
      continue;
    }

    let total = 0;
    for (let n = 0; n < k; n++) {
      const weight = Math.pow(bestDistance[n], exponent);
      indices[base + n] = bestIndex[n];
      weights[base + n] = weight;
      total += weight;
    }
    for (let n = 0; n < k; n++) weights[base + n] /= total;
  }

  return { cells, indices, weights, k };
}

export function blendSeries(series, blend, j, hour) {
  const base = j * blend.k;

  let value = 0;
  let share = 0;

  for (let n = 0; n < blend.k; n++) {
    const reading = series[blend.indices[base + n]]?.[hour];
    if (!Number.isFinite(reading)) continue;
    value += reading * blend.weights[base + n];
    share += blend.weights[base + n];
  }

  return share ? value / share : null;
}

const ATTEMPTS = 4;
const BACKOFF_MS = 2000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRetrying(url, label) {
  let last = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res = null;

    try {
      res = await fetch(url);
    } catch (err) {
      last = err;
    }

    if (res?.ok) return res;

    if (res) {
      last = new Error(`${label} HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) throw last;
    }

    if (attempt < ATTEMPTS) {
      console.warn(
        `${label} attempt ${attempt} failed (${last.message}), retrying`,
      );
      await wait(BACKOFF_MS * attempt);
    }
  }

  throw last;
}

export async function fetchHourly(url, label, locations, hours) {
  const res = await fetchRetrying(url, label);
  const body = await res.json();
  const entries = Array.isArray(body) ? body : [body];

  if (entries.length !== locations) {
    throw new Error(
      `${label}: expected ${locations} locations, got ${entries.length}`,
    );
  }

  for (const entry of entries) {
    if (entry.hourly?.time?.length !== hours) {
      throw new Error(
        `${label}: expected ${hours} hours, got ${entry.hourly?.time?.length}`,
      );
    }
  }

  return entries;
}

export function cached(ttlMs, label, fetcher) {
  let store = null;
  let inFlight = null;

  return async function get() {
    if (store && Date.now() - store.fetchedAt < ttlMs) return store.data;
    if (inFlight) return inFlight;

    inFlight = fetcher()
      .then((data) => {
        store = { data, fetchedAt: Date.now() };
        return data;
      })
      .catch((err) => {
        if (store) {
          console.warn(
            `${label} refresh failed (${err.message}), serving cached`,
          );
          return store.data;
        }
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
}

export function cellCenter(dem, x, y) {
  const [west, south, east, north] = dem.bbox;

  return {
    lon: west + ((x + 0.5) / dem.width) * (east - west),
    lat: north - ((y + 0.5) / dem.height) * (north - south),
  };
}

export function paint(data, cells, classes, palette) {
  const count = cells ? cells.length : classes.length;

  for (let j = 0; j < count; j++) {
    const p = (cells ? cells[j] : j) * 4;
    const rgba = palette[classes[j]];

    if (!rgba) {
      data[p + 3] = 0;
      continue;
    }

    data[p] = rgba[0];
    data[p + 1] = rgba[1];
    data[p + 2] = rgba[2];
    data[p + 3] = rgba[3];
  }
}

export function sampleByGrid(dem, degrees, accept) {
  const { width, height } = dem;
  const best = new Map();

  for (let i = 0; i < width * height; i++) {
    if (!accept(i)) continue;

    const { lon, lat } = cellCenter(dem, i % width, (i / width) | 0);

    const gx = Math.floor(lon / degrees);
    const gy = Math.floor(lat / degrees);
    const offLon = lon - (gx + 0.5) * degrees;
    const offLat = lat - (gy + 0.5) * degrees;
    const offset = offLat * offLat + offLon * offLon;

    const key = `${gy}:${gx}`;
    const current = best.get(key);
    if (!current || offset < current.offset) best.set(key, { lat, lon, offset });
  }

  return [...best.values()].map(({ lat, lon }) => ({ lat, lon }));
}

export function ramp(value, from, to) {
  if (!Number.isFinite(value)) return 1;

  const span = to - from;
  if (span === 0) return 0;

  return Math.min(1, Math.max(0, (value - from) / span));
}

export function decayed(values, index, hours, decay) {
  let sum = 0;
  let weights = 0;

  for (let back = 0; back < hours; back++) {
    const i = index - back;
    if (i < 0) break;

    const value = values?.[i];
    if (!Number.isFinite(value)) continue;

    const weight = Math.pow(decay, back);
    sum += value * weight;
    weights += weight;
  }

  return weights ? sum / weights : null;
}

export const degreesToVector = (degrees) =>
  Number.isFinite(degrees)
    ? [
        Math.cos((degrees * Math.PI) / 180),
        Math.sin((degrees * Math.PI) / 180),
      ]
    : null;

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
  const { width, bbox } = dem;
  const [, south, , north] = bbox;

  const k = Math.min(neighbors, points.length);
  const indices = new Int32Array(cells.length * k);
  const weights = new Float32Array(cells.length * k);
  const exponent = -power / 2;
  const scale = Math.cos((((south + north) / 2) * Math.PI) / 180);

  const bestIndex = new Int32Array(k);
  const bestDistance = new Float64Array(k);

  for (let j = 0; j < cells.length; j++) {
    const i = cells[j];
    const { lon, lat } = cellCenter(dem, i % width, (i / width) | 0);

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

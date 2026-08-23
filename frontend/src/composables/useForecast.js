import { ref, computed, watch, onScopeDispose } from "vue";

import {
  isStatic,
  islandsUrl,
  summaryUrl,
  overlayUrl,
  pointUrl,
  demUrl,
  configUrl,
} from "../api";
import { createFogMath, FOG_CLASS_NAMES, OCEAN } from "../services/fogMath";
import {
  createSeaMath,
  nearestPoints,
  SEA_CLASS_NAMES,
} from "../services/seaMath";

const DEFAULT_ISLAND = "terceira";
const DEFAULT_MODE = "fog";
const PIPELINE_LAG_MS = 90_000;
const HOURS_PER_DAY = 24;

const demCache = new Map();

function fetchDem(url) {
  if (!demCache.has(url))
    demCache.set(
      url,
      fetch(url)
        .then((res) => res.arrayBuffer())
        .then((buffer) => {
          const headerLength = new DataView(buffer).getUint32(0, true);
          const header = JSON.parse(
            new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)),
          );

          const cells = header.width * header.height;
          const base = 4 + headerLength;

          return {
            ...header,
            elevation: new Int16Array(buffer, base, cells),
            aspect: new Uint8Array(buffer, base + cells * 2, cells),
            slope: new Uint8Array(buffer, base + cells * 3, cells),
            coast: new Uint8Array(buffer, base + cells * 4, cells),
          };
        }),
    );

  return demCache.get(url);
}

const azoresHour = () =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Atlantic/Azores",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );

export function useForecast() {
  const islands = ref([]);
  const islandId = ref(DEFAULT_ISLAND);
  const mode = ref(DEFAULT_MODE);
  const loadedMode = ref(DEFAULT_MODE);
  const forecast = ref(null);
  const dayIndex = ref(0);
  const nowHour = ref(azoresHour());
  const hourIndex = ref(nowHour.value);
  const now = ref(Date.now());

  let refreshTimer = null;

  const ticker = setInterval(() => {
    now.value = Date.now();
    nowHour.value = azoresHour();
  }, 60_000);

  onScopeDispose(() => {
    clearInterval(ticker);
    clearTimeout(refreshTimer);
  });

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  async function loadForecast() {
    const wanted = mode.value;

    try {
      const summary = await load(summaryUrl(wanted, islandId.value));
      if (wanted !== mode.value) return;

      loadedMode.value = wanted;
      forecast.value = summary;
    } catch (err) {
      console.error(err);
      forecast.value = null;
    }
  }

  async function refreshForecast() {
    try {
      forecast.value = await load(summaryUrl(mode.value, islandId.value));
    } catch (err) {
      console.error(err);
    }
  }

  load(islandsUrl())
    .then((list) => {
      islands.value = list;
    })
    .catch(console.error);

  watch([islandId, mode], loadForecast, { immediate: true });

  watch(nowHour, () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshForecast, PIPELINE_LAG_MS);
  });

  const classKey = computed(() =>
    mode.value === "sea" ? "seaClass" : "fogClass",
  );

  const island = computed(
    () => islands.value.find((i) => i.id === islandId.value) ?? null,
  );

  const ready = computed(() => loadedMode.value === mode.value);

  const days = computed(() =>
    (ready.value ? (forecast.value?.days ?? []) : []).map((day) => ({
      ...day,
      class: day[classKey.value],
      hours: day.hours.map((hour) => ({
        ...hour,
        class: hour[classKey.value],
      })),
    })),
  );

  const day = computed(() => days.value[dayIndex.value] ?? null);
  const hours = computed(() => day.value?.hours ?? []);
  const hour = computed(() => hours.value[hourIndex.value] ?? null);

  const overlayFor = (time) => overlayUrl(mode.value, islandId.value, time);
  const currentOverlay = computed(() =>
    hour.value ? overlayFor(hour.value.time) : null,
  );

  const prefetchUrls = computed(() =>
    [hourIndex.value - 1, hourIndex.value + 1]
      .filter((i) => i >= 0 && i < hours.value.length)
      .map((i) => overlayFor(hours.value[i].time)),
  );

  const updatedLabel = computed(() => {
    if (!forecast.value?.storedAt) return null;

    const minutes = Math.max(
      0,
      Math.round((now.value - Date.parse(forecast.value.storedAt)) / 60_000),
    );
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;

    const elapsed = Math.round(minutes / 60);
    return elapsed === 1 ? "1 hour ago" : `${elapsed} hours ago`;
  });

  const grid = computed(() =>
    forecast.value
      ? { width: forecast.value.width, height: forecast.value.height }
      : null,
  );

  const point = ref(null);
  let pending = null;
  let lastCall = 0;

  let config = null;
  let fogMath = null;
  let seaMath = null;

  async function loadConfig() {
    config ??= await (await fetch(configUrl())).json();
    return config;
  }

  async function inspectFogLocally(x, y) {
    const model = await loadConfig();
    fogMath ??= createFogMath(model);

    const dem = await fetchDem(demUrl(islandId.value));
    const index = y * dem.width + x;
    const z = dem.elevation[index];

    const base = { time: hour.value.time, x, y };
    if (z === OCEAN) return { ...base, sea: true, class: "none" };

    const c =
      forecast.value.conditions[dayIndex.value * HOURS_PER_DAY + hourIndex.value];

    const cloudBase = fogMath.localBase(dem.aspect[index], dem.slope[index], c);
    const fogClass = fogMath.classifyCell(z, cloudBase, c);

    return {
      ...base,
      sea: false,
      class: FOG_CLASS_NAMES[fogClass],
      cloudy: fogMath.hasCloud(c),
      elevation: z,
      slope: dem.slope[index],
      aspect: dem.aspect[index] * 2,
      cloudBase: Math.round(cloudBase),
      cloudTop: Math.round(c.top),
      depth: Math.round(z - cloudBase),
      aboveCloud: z > c.top,
      visibility: fogMath.visibilityAt(z, cloudBase, fogClass, c),
    };
  }

  async function inspectSeaLocally(x, y) {
    const model = await loadConfig();
    seaMath ??= createSeaMath(model);

    const dem = await fetchDem(demUrl(islandId.value));
    const index = y * dem.width + x;
    const band = Math.round(model.sea.bandMeters / model.cellSize);

    const base = { time: hour.value.time, x, y };
    if (
      dem.elevation[index] !== OCEAN ||
      dem.coast[index] < 1 ||
      dem.coast[index] > band
    )
      return { ...base, offshore: true };

    const [west, south, east, north] = dem.bbox;
    const lon = west + ((x + 0.5) / dem.width) * (east - west);
    const lat = north - ((y + 0.5) / dem.height) * (north - south);

    const points = forecast.value.points;
    const blend = nearestPoints(
      lat,
      lon,
      points,
      model.sea.neighbors,
      model.sea.idwPower,
    );

    const at = dayIndex.value * HOURS_PER_DAY + hourIndex.value;
    const layers = {};

    for (const name of Object.keys(points[0].layers)) {
      let value = 0;
      let weight = 0;

      for (const { index: p, weight: w } of blend) {
        const reading = points[p].layers[name][at];
        if (reading === null) continue;
        value += reading * w;
        weight += w;
      }

      layers[name] = weight ? value / weight : null;
    }

    layers.clarity = seaMath.clarityMeters(layers.visibility);

    let score = 0;
    for (const { index: p, weight: w } of blend) score += points[p].score[at] * w;

    return {
      ...base,
      offshore: false,
      class: SEA_CLASS_NAMES[seaMath.classify(score)],
      score,
      layers,
    };
  }

  function inspect(target) {
    if (!target || !hour.value) {
      pending?.abort();
      pending = null;
      point.value = null;
      return;
    }

    const wait = Math.max(0, 80 - (Date.now() - lastCall));
    clearTimeout(inspect.timer);
    inspect.timer = setTimeout(() => {
      lastCall = Date.now();

      if (isStatic) {
        const local =
          mode.value === "sea" ? inspectSeaLocally : inspectFogLocally;

        local(target.x, target.y)
          .then((data) => {
            point.value = data;
          })
          .catch(() => {});
        return;
      }

      pending?.abort();
      pending = new AbortController();

      fetch(
        pointUrl(
          mode.value,
          islandId.value,
          hour.value.time,
          target.x,
          target.y,
        ),
        { signal: pending.signal },
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          point.value = data;
        })
        .catch(() => {});
    }, wait);
  }

  watch([mode, islandId], () => {
    point.value = null;
  });

  onScopeDispose(() => {
    clearTimeout(inspect.timer);
    pending?.abort();
  });

  return {
    grid,
    point,
    inspect,
    islands,
    islandId,
    island,
    mode,
    days,
    dayIndex,
    hours,
    hourIndex,
    nowHour,
    overlayUrl: currentOverlay,
    prefetchUrls,
    updatedLabel,
  };
}

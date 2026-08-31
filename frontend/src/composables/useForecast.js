import { ref, computed, watch, onScopeDispose } from "vue";

import {
  isStatic,
  islandsUrl,
  summaryUrl,
  overlayUrl,
  pointUrl,
  demUrl,
} from "../api";
import { createFogMath } from "../services/modes/fog/math";
import { parseDem } from "../services/demFormat";
import { createSeaMath } from "../services/modes/sea/math";
import { OVERALL } from "../layers";
import model from "../config/model.json";

const DEFAULT_ISLAND = "terceira";
const DEFAULT_MODE = "sea";
const PIPELINE_LAG_MS = 90_000;
const HOURS_PER_DAY = 24;

const demCache = new Map();

function fetchDem(url) {
  if (!demCache.has(url))
    demCache.set(
      url,
      fetch(url)
        .then((res) => res.arrayBuffer())
        .then((buffer) => parseDem(buffer)),
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
  const layer = ref(OVERALL);
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

  const island = computed(
    () => islands.value.find((i) => i.id === islandId.value) ?? null,
  );

  const ready = computed(() => loadedMode.value === mode.value);

  const classOf = (entry) =>
    (layer.value === OVERALL ? null : entry.layerClass?.[layer.value]) ??
    entry.class;

  const days = computed(() =>
    (ready.value ? (forecast.value?.days ?? []) : []).map((day) => ({
      ...day,
      class: classOf(day),
      hours: day.hours.map((hour) => ({
        ...hour,
        class: classOf(hour),
      })),
    })),
  );

  const day = computed(() => days.value[dayIndex.value] ?? null);
  const hours = computed(() => day.value?.hours ?? []);
  const hour = computed(() => hours.value[hourIndex.value] ?? null);

  const overlayFor = (time, forLayer) =>
    overlayUrl(mode.value, islandId.value, time, forLayer);

  const activeLayer = computed(() =>
    layer.value === OVERALL ? null : layer.value,
  );

  const displayedOverlay = computed(() =>
    hour.value ? overlayFor(hour.value.time, activeLayer.value) : null,
  );

  const prefetchUrls = computed(() =>
    [hourIndex.value - 1, hourIndex.value + 1]
      .filter((i) => i >= 0 && i < hours.value.length)
      .map((i) => overlayFor(hours.value[i].time, activeLayer.value)),
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

  let fogMath = null;
  let seaMath = null;

  async function inspectLocally(x, y) {
    const dem = await fetchDem(demUrl(islandId.value));
    const at = dayIndex.value * HOURS_PER_DAY + hourIndex.value;

    if (mode.value === "sea") {
      seaMath ??= createSeaMath(model);
      return seaMath.inspect(dem, forecast.value, at, hour.value.time, x, y);
    }

    fogMath ??= createFogMath(model);
    return fogMath.inspect(dem, forecast.value, at, hour.value.time, x, y);
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
        inspectLocally(target.x, target.y)
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

  watch(mode, () => {
    layer.value = OVERALL;
  });

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
    layer,
    days,
    dayIndex,
    hours,
    hourIndex,
    nowHour,
    overlayUrl: displayedOverlay,
    prefetchUrls,
    updatedLabel,
  };
}

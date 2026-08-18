import { ref, computed, watch, onScopeDispose } from "vue";

import {
  isStatic,
  islandsUrl,
  forecastUrl,
  fogUrl,
  pointUrl,
  demUrl,
  configUrl,
} from "../api";
import { fetchDem } from "../lib/dem";
import { createFogMath, FOG_CLASS_NAMES, OCEAN } from "../services/fogMath";

const DEFAULT_ISLAND = "terceira";

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
  const forecast = ref(null);
  const dayIndex = ref(0);
  const nowHour = ref(azoresHour());
  const hourIndex = ref(nowHour.value);
  const now = ref(Date.now());

  const ticker = setInterval(async () => {
    now.value = Date.now();
    nowHour.value = azoresHour();

    try {
      forecast.value = await load(forecastUrl(islandId.value));
    } catch (err) {
      console.error(err);
    }
  }, 60_000);
  onScopeDispose(() => clearInterval(ticker));

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  async function loadForecast(id) {
    try {
      forecast.value = await load(forecastUrl(id));
    } catch (err) {
      console.error(err);
      forecast.value = null;
    }
  }

  load(islandsUrl())
    .then((list) => {
      islands.value = list;
    })
    .catch(console.error);

  watch(islandId, loadForecast, { immediate: true });

  const island = computed(
    () => islands.value.find((i) => i.id === islandId.value) ?? null,
  );
  const days = computed(() => forecast.value?.days ?? []);
  const day = computed(() => days.value[dayIndex.value] ?? null);
  const hours = computed(() => day.value?.hours ?? []);
  const hour = computed(() => hours.value[hourIndex.value] ?? null);

  const overlayFor = (time) => fogUrl(islandId.value, time);
  const overlayUrl = computed(() =>
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

    const hours = Math.round(minutes / 60);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  });

  const grid = computed(() =>
    forecast.value
      ? { width: forecast.value.width, height: forecast.value.height }
      : null,
  );

  const point = ref(null);
  let pending = null;
  let lastCall = 0;

  let math = null;

  async function inspectLocally(x, y) {
    if (!math) math = createFogMath(await (await fetch(configUrl())).json());

    const dem = await fetchDem(demUrl(islandId.value));
    const index = y * dem.width + x;
    const z = dem.elevation[index];

    const base = { time: hour.value.time, x, y };
    if (z === OCEAN) return { ...base, sea: true, class: "none" };

    const c = forecast.value.conditions[dayIndex.value * 24 + hourIndex.value];

    const cloudBase = math.localBase(dem.aspect[index], dem.slope[index], c);
    const fogClass = math.classifyCell(z, cloudBase, c);

    return {
      ...base,
      sea: false,
      class: FOG_CLASS_NAMES[fogClass],
      elevation: z,
      slope: dem.slope[index],
      aspect: dem.aspect[index] * 2,
      cloudBase: Math.round(cloudBase),
      cloudTop: Math.round(c.top),
      depth: Math.round(z - cloudBase),
      aboveCloud: z > c.top,
      visibility: math.visibilityAt(z, cloudBase, fogClass, c),
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
        inspectLocally(target.x, target.y)
          .then((data) => {
            point.value = data;
          })
          .catch(() => {});
        return;
      }

      pending?.abort();
      pending = new AbortController();

      fetch(pointUrl(islandId.value, hour.value.time, target.x, target.y), {
        signal: pending.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          point.value = data;
        })
        .catch(() => {});
    }, wait);
  }

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
    days,
    dayIndex,
    hours,
    hourIndex,
    nowHour,
    overlayUrl,
    prefetchUrls,
    updatedLabel,
  };
}

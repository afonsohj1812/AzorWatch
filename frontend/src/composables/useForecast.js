import { ref, computed, watch } from "vue";

const DEFAULT_ISLAND = "sao-miguel";

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
  const hourIndex = ref(azoresHour());
  const loading = ref(false);
  const error = ref(null);

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  async function loadForecast(id) {
    loading.value = true;
    error.value = null;
    try {
      forecast.value = await load(`/api/forecast/${id}`);
    } catch (err) {
      error.value = err.message;
      forecast.value = null;
    } finally {
      loading.value = false;
    }
  }

  load("/api/islands")
    .then((list) => {
      islands.value = list;
    })
    .catch((err) => {
      error.value = err.message;
    });

  watch(islandId, loadForecast, { immediate: true });

  const island = computed(
    () => islands.value.find((i) => i.id === islandId.value) ?? null,
  );
  const days = computed(() => forecast.value?.days ?? []);
  const day = computed(() => days.value[dayIndex.value] ?? null);
  const hours = computed(() => day.value?.hours ?? []);
  const hour = computed(() => hours.value[hourIndex.value] ?? null);

  const fogUrl = (time) => `/api/fog/${islandId.value}/${time}.png`;
  const overlayUrl = computed(() =>
    hour.value ? fogUrl(hour.value.time) : null,
  );

  const prefetchUrls = computed(() =>
    [hourIndex.value - 1, hourIndex.value + 1]
      .filter((i) => i >= 0 && i < hours.value.length)
      .map((i) => fogUrl(hours.value[i].time)),
  );

  return {
    islands,
    islandId,
    island,
    days,
    day,
    dayIndex,
    hours,
    hour,
    hourIndex,
    overlayUrl,
    prefetchUrls,
    loading,
    error,
  };
}

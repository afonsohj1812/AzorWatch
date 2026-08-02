<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const props = defineProps({
  island: { type: Object, default: null },
  overlayUrl: { type: String, default: null },
  prefetchUrls: { type: Array, default: () => [] },
  grid: { type: Object, default: null },
  resetView: { type: Number, default: 0 },
});
const emit = defineEmits(["inspect"]);

const MIN_INSPECT_ZOOM = 14;

const container = ref(null);
let map = null;
let overlay = null;
let cellOutline = null;
let hovered = null;

function boundsOf(island) {
  const [west, south, east, north] = island.bbox;
  return L.latLngBounds([south, west], [north, east]);
}

function fitIsland() {
  if (!map || !props.island) return;
  map.fitBounds(boundsOf(props.island), { padding: [40, 40] });
}

const WHEEL_PX_PER_ZOOM = 60;
let wheelDistance = 0;

function zoomBy(levels, pointer) {
  if (!map || !props.island) return;

  const onIsland = boundsOf(props.island).contains(pointer);
  const anchor =
    levels < 0 || onIsland
      ? pointer
      : L.latLng(props.island.center[0], props.island.center[1]);

  map.setZoomAround(anchor, map.getZoom() + levels);
}

function onWheel(event) {
  if (!map || !props.island) return;
  event.preventDefault();

  wheelDistance += event.deltaY;
  const steps = Math.trunc(wheelDistance / WHEEL_PX_PER_ZOOM);
  if (!steps) return;

  wheelDistance -= steps * WHEEL_PX_PER_ZOOM;
  zoomBy(-steps, map.mouseEventToLatLng(event));
}

function showOverlay() {
  if (!map || !props.island || !props.overlayUrl) return;
  const url = props.overlayUrl;
  const bounds = boundsOf(props.island);

  const image = new Image();
  image.onload = () => {
    if (props.overlayUrl !== url) return;
    if (overlay) {
      overlay.setBounds(bounds);
      overlay.setUrl(url);
    } else {
      overlay = L.imageOverlay(url, bounds, {
        interactive: false,
        className: "fog-overlay",
      }).addTo(map);
    }
  };
  image.src = url;
}

function cellAt(latlng) {
  if (!map || !props.island || !props.grid) return null;

  const [west, south, east, north] = props.island.bbox;
  const { width, height } = props.grid;

  const dLon = (east - west) / width;
  const x = Math.floor((latlng.lng - west) / dLon);
  if (x < 0 || x >= width) return null;

  const crs = map.options.crs;
  const top = crs.project(L.latLng(north, west)).y;
  const span = crs.project(L.latLng(south, west)).y - top;

  const y = Math.floor(((crs.project(latlng).y - top) / span) * height);
  if (y < 0 || y >= height) return null;

  const edge = crs.project(L.latLng(0, west)).x;
  const latOfRow = (row) =>
    crs.unproject(L.point(edge, top + (row / height) * span)).lat;

  return {
    x,
    y,
    bounds: L.latLngBounds(
      [latOfRow(y + 1), west + x * dLon],
      [latOfRow(y), west + (x + 1) * dLon],
    ),
  };
}

function clearCell() {
  hovered = null;
  if (cellOutline) {
    cellOutline.remove();
    cellOutline = null;
  }
  emit("inspect", null);
}

function onMapMove(event) {
  if (map.getZoom() < MIN_INSPECT_ZOOM) return clearCell();

  const cell = cellAt(event.latlng);
  if (!cell) return clearCell();

  if (hovered && hovered.x === cell.x && hovered.y === cell.y) return;
  hovered = cell;

  if (cellOutline) cellOutline.setBounds(cell.bounds);
  else
    cellOutline = L.rectangle(cell.bounds, {
      color: "#fff",
      weight: 1,
      fill: false,
      interactive: false,
    }).addTo(map);

  emit("inspect", { x: cell.x, y: cell.y });
}

onMounted(async () => {
  map = L.map(container.value, {
    attributionControl: false,
    zoomControl: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
  }).setView([38.5, -28.2], 8);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 18,
      maxZoom: 21,
      attribution:
        "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community",
    },
  ).addTo(map);

  map.on("mousemove", onMapMove);
  map.on("mouseout", clearCell);
  map.on("click", onMapMove);
  map.on("dblclick", (event) => zoomBy(1, event.latlng));
  container.value.addEventListener("wheel", onWheel, { passive: false });

  map.on("zoomend", () => {
    if (map.getZoom() < MIN_INSPECT_ZOOM) clearCell();
  });

  await nextTick();
  map.invalidateSize();
  fitIsland();
  showOverlay();
});

onBeforeUnmount(() => {
  container.value?.removeEventListener("wheel", onWheel);
  map?.remove();
  map = null;
  overlay = null;
  cellOutline = null;
});

watch(
  () => props.island,
  () => {
    clearCell();
    fitIsland();
  },
);
watch(() => props.overlayUrl, showOverlay);
watch(
  () => props.resetView,
  () => {
    clearCell();
    fitIsland();
  },
);
watch(
  () => props.prefetchUrls,
  (urls) => urls.forEach((url) => (new Image().src = url)),
);
</script>

<template>
  <div ref="container" class="map" />
</template>

<style scoped>
.map :deep(.fog-overlay) {
  image-rendering: pixelated;
}

.map {
  background-color: rgb(17 32 47);
  height: 100%;
  position: relative;
  z-index: 0;
}
</style>

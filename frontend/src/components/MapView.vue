<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const props = defineProps({
  island: { type: Object, default: null },
  overlayUrl: { type: String, default: null },
  prefetchUrls: { type: Array, default: () => [] },
});

const container = ref(null);
let map = null;
let overlay = null;

function boundsOf(island) {
  const [west, south, east, north] = island.bbox;
  return L.latLngBounds([south, west], [north, east]);
}

function fitIsland() {
  if (!map || !props.island) return;
  map.fitBounds(boundsOf(props.island), { padding: [40, 40] });
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

onMounted(async () => {
  map = L.map(container.value, { attributionControl: false }).setView(
    [38.5, -28.2],
    8,
  );

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 18,
      maxZoom: 21,
      attribution:
        "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community",
    },
  ).addTo(map);

  await nextTick();
  map.invalidateSize();
  fitIsland();
  showOverlay();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  overlay = null;
});

watch(() => props.island, fitIsland);
watch(() => props.overlayUrl, showOverlay);
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
  height: 100%;
  position: relative;
  z-index: 0;
}
</style>

<script setup>
import { computed, ref } from "vue";

import MapView from "./components/MapView.vue";
import DayPicker from "./components/DayPicker.vue";
import IslandPicker from "./components/IslandPicker.vue";
import HourSlider from "./components/HourSlider.vue";
import Legend from "./components/Legend.vue";
import PointInfo from "./components/PointInfo.vue";
import { useForecast } from "./composables/useForecast";

const {
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
  grid,
  point,
  inspect,
  error,
} = useForecast();

const viewReset = ref(0);

const currentHour = computed(() =>
  dayIndex.value === 0 ? nowHour.value : null,
);
</script>

<template>
  <div class="app">
    <MapView
      :island="island"
      :overlay-url="overlayUrl"
      :prefetch-urls="prefetchUrls"
      :reset-view="viewReset"
      :grid="grid"
      @inspect="inspect"
    />

    <div class="panel panel--top">
      <DayPicker v-model="dayIndex" :days="days" />
    </div>
    <div class="panel panel--left">
      <IslandPicker
        v-model="islandId"
        :islands="islands"
        @select="viewReset++"
      />
    </div>
    <div class="panel panel--right">
      <PointInfo :point="point" />
    </div>
    <div class="panel panel--bottom">
      <HourSlider
        v-model="hourIndex"
        :hours="hours"
        :current-hour="currentHour"
      />
    </div>
    <div class="panel panel--bottom-right">
      <Legend />
    </div>

    <p class="panel credits">
      Imagery &copy; Esri &middot; Elevation &copy; Copernicus
    </p>
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  position: relative;
  overflow: hidden;
}

.panel {
  position: absolute;
  z-index: 10;
}

.panel--top {
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
}

.panel--left {
  top: 50%;
  left: 1rem;
  transform: translateY(-50%);
}

.panel--right {
  top: 50%;
  right: 1rem;
  transform: translateY(-50%);
}

.panel--bottom {
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 2rem));
}

.panel--bottom-right {
  bottom: 1rem;
  right: 1rem;
}

.credits {
  bottom: 0.5rem;
  left: 0.5rem;
  font-size: 0.75rem;
  color: rgb(127, 127, 127);
  pointer-events: none;
}
</style>

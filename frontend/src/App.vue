<script setup>
import { computed, ref } from "vue";

import MapView from "./components/MapView.vue";
import DayPicker from "./components/DayPicker.vue";
import IslandPicker from "./components/IslandPicker.vue";
import ModeSwitch from "./components/ModeSwitch.vue";
import LayerPicker from "./components/LayerPicker.vue";
import MobileMenu from "./components/MobileMenu.vue";
import HourSlider from "./components/HourSlider.vue";
import Legend from "./components/Legend.vue";
import PointInfo from "./components/PointInfo.vue";
import { useForecast } from "./composables/useForecast";
import { useMobile } from "./composables/useMobile";
import { layersFor } from "./layers";

const {
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
  overlayUrl,
  prefetchUrls,
  grid,
  point,
  inspect,
  updatedLabel,
} = useForecast();

const viewReset = ref(0);
const isMobile = useMobile();

const layerEntries = computed(() => layersFor(mode.value));

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
      <DayPicker v-model="dayIndex" :days="days" :mode="mode" />
    </div>
    <div v-if="isMobile" class="panel panel--menu">
      <MobileMenu>
        <section class="group">
          <h2>Mode</h2>
          <ModeSwitch v-model="mode" />
        </section>
        <section class="group">
          <h2>Layer</h2>
          <LayerPicker v-model="layer" :entries="layerEntries" />
        </section>
        <section class="group">
          <h2>Island</h2>
          <IslandPicker
            v-model="islandId"
            :islands="islands"
            @select="viewReset++"
          />
        </section>
      </MobileMenu>
    </div>

    <template v-else>
      <div class="panel panel--mode">
        <ModeSwitch v-model="mode" />
      </div>
      <div class="panel panel--layers">
        <LayerPicker v-model="layer" :entries="layerEntries" />
      </div>
      <div class="panel panel--left">
        <IslandPicker
          v-model="islandId"
          :islands="islands"
          @select="viewReset++"
        />
      </div>
    </template>
    <div class="panel panel--right">
      <PointInfo :point="point" :mode="mode" />
    </div>
    <div class="panel panel--bottom">
      <HourSlider
        v-model="hourIndex"
        :hours="hours"
        :current-hour="currentHour"
        :mode="mode"
      />
    </div>
    <div class="panel panel--bottom-right">
      <Legend :collapsible="isMobile" :mode="mode" :layer="layer" />
    </div>

    <p class="panel credits">
      &copy; Esri &middot; &copy; Copernicus<span v-if="updatedLabel">
        &middot; Forecast updated {{ updatedLabel }}</span
      >
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

.panel--mode {
  top: 1rem;
  left: 1rem;
}

.panel--menu {
  top: 6rem;
  left: 0.5rem;
  z-index: 20;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.group h2 {
  font-size: 0.7rem;
  font-weight: bold;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.6);
}

.panel--layers {
  top: 6.5rem;
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

@media (max-width: 1472px) {
  .panel--bottom {
    bottom: 2rem;
    left: 0.5rem;
    right: 0.5rem;
    transform: none;
    width: auto;
  }

  .panel--bottom-right {
    bottom: 6rem;
    right: 0.5rem;
  }
}

@media (max-width: 768px) {
  .panel--top {
    top: 0.5rem;
  }

  .panel--right {
    top: 6rem;
    right: 0.5rem;
    transform: none;
  }

  .credits span {
    font-size: 0.9rem;
  }
}
</style>

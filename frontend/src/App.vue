<script setup>
import { ref } from "vue";

import MapView from "./components/MapView.vue";
import DayPicker from "./components/DayPicker.vue";
import IslandPicker from "./components/IslandPicker.vue";
import HourSlider from "./components/HourSlider.vue";
import Legend from "./components/Legend.vue";

const selectedIsland = ref("sao-miguel");
const selectedDay = ref(0);
const selectedHour = ref(12);
</script>

<template>
  <div class="app">
    <MapView :island="selectedIsland" :day="selectedDay" :hour="selectedHour" />

    <div class="panel panel--top">
      <DayPicker v-model="selectedDay" />
    </div>
    <div class="panel panel--left">
      <IslandPicker v-model="selectedIsland" />
    </div>
    <div class="panel panel--bottom">
      <HourSlider v-model="selectedHour" />
    </div>
    <div class="panel panel--bottom-right">
      <Legend />
    </div>
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

.panel--bottom {
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 2rem));
}

.panel--bottom-right {
  right: 1rem;
  bottom: 1rem;
}
</style>

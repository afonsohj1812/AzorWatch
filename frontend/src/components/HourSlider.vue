<script setup>
import { computed, ref } from "vue";

import model from "../config/model.json";

const colorOf = (id) => model.classes.find((c) => c.id === id).color;

const props = defineProps({
  hours: { type: Array, default: () => [] },
  modelValue: { type: Number, required: true },
  currentHour: { type: Number, default: null },
});
const emit = defineEmits(["update:modelValue"]);

const track = ref(null);
const dragging = ref(false);

const count = computed(() => props.hours.length);
const label = computed(() => String(props.modelValue).padStart(2, "0") + ":00");

function leftFor(index) {
  if (!count.value) return "50%";
  return `${((index + 0.5) / count.value) * 100}%`;
}

const CHECKPOINTS = [0, 6, 12, 18];
const COLLISION_HOURS = 2;

const checkpoints = computed(() => {
  if (!count.value) return [];
  const last = count.value - 1;

  return CHECKPOINTS.map((hour) => {
    const index = Math.min(hour, last);

    return {
      hour,
      left: leftFor(index),
      label: String(hour).padStart(2, "0"),
      hidden: Math.abs(index - props.modelValue) < COLLISION_HOURS,
    };
  });
});

function indexAt(clientX) {
  const rect = track.value.getBoundingClientRect();
  const ratio = (clientX - rect.left) / rect.width;
  return Math.min(
    count.value - 1,
    Math.max(0, Math.floor(ratio * count.value)),
  );
}

function select(clientX) {
  if (!count.value) return;
  const next = indexAt(clientX);
  if (next !== props.modelValue) emit("update:modelValue", next);
}

function onPointerDown(event) {
  if (!count.value) return;

  event.preventDefault();
  dragging.value = true;

  track.value.setPointerCapture(event.pointerId);
  select(event.clientX);
}

function onPointerMove(event) {
  if (dragging.value) select(event.clientX);
}

function onPointerUp(event) {
  dragging.value = false;
  if (track.value?.hasPointerCapture(event.pointerId))
    track.value.releasePointerCapture(event.pointerId);
}
</script>

<template>
  <div class="hour-slider glass">
    <div class="strip">
      <span
        v-for="point in checkpoints"
        :key="point.hour"
        class="checkpoint"
        :class="{ hidden: point.hidden }"
        :style="{ left: point.left }"
        >{{ point.label }}</span
      >

      <div class="label" :style="{ left: leftFor(modelValue) }">
        {{ label }}
      </div>

      <div
        ref="track"
        class="track"
        :class="{ dragging }"
        role="slider"
        tabindex="0"
        aria-label="Forecast hour"
        :aria-valuemin="0"
        :aria-valuemax="Math.max(0, count - 1)"
        :aria-valuenow="modelValue"
        :aria-valuetext="`${label}, ${hours[modelValue]?.fogClass ?? 'no data'}`"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div
          v-for="(entry, i) in hours"
          :key="entry.time"
          class="tick"
          :class="{ active: i === modelValue, now: i === currentHour }"
          :style="{ background: colorOf(entry.fogClass) }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.hour-slider {
  padding: 0.5rem;
}

.strip {
  position: relative;
  padding-top: 1.25rem;
}

.checkpoint,
.label {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  pointer-events: none;
}

.checkpoint {
  font-size: 0.65rem;
  color: rgb(255 255 255 / 0.5);
  padding-top: 0.2rem;
  transition: opacity 0.1s ease;
}

.checkpoint.hidden {
  opacity: 0;
}

.label {
  font-size: 0.9rem;
  font-weight: bold;
  letter-spacing: 0.05rem;
  transition: left 0.1s ease;
}

.track {
  display: flex;
  gap: 0.125rem;
  outline: none;
  border: none;
  padding-top: 0.125rem;
  cursor: pointer;
  touch-action: none;
}

.track:not(.dragging) .tick:hover {
  transform: scaleY(1.25);
  filter: brightness(1.25);
}

.tick {
  flex: 1;
  height: 1rem;
  border-radius: 0.125rem;
  transition:
    transform 0.1s ease,
    filter 0.1s ease;
}

.tick.now {
  outline: solid 2px rgb(63, 223, 127);
  animation: pulse 2s ease-out infinite;
}

.tick.active {
  outline: solid 2px rgb(255 255 255);
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgb(63 223 127 / 0.5);
  }
  75% {
    box-shadow: 0 0 0 0.5rem rgb(63 223 127 / 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgb(63 223 127 / 0);
  }
}
</style>

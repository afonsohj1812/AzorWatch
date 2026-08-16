<script setup>
import { ref } from "vue";

import { colorOf } from "../constants/fogClasses";

const props = defineProps({
  days: { type: Array, default: () => [] },
  modelValue: { type: Number, required: true },
});
const emit = defineEmits(["update:modelValue"]);

const picker = ref(null);
const dragging = ref(false);

function select(clientX) {
  const count = props.days.length;
  if (!count) return;

  const rect = picker.value.getBoundingClientRect();
  const ratio = (clientX - rect.left) / rect.width;
  const next = Math.min(count - 1, Math.max(0, Math.floor(ratio * count)));

  if (next !== props.modelValue) emit("update:modelValue", next);
}

function onPointerDown(event) {
  if (!props.days.length) return;

  event.preventDefault();
  dragging.value = true;

  picker.value.setPointerCapture(event.pointerId);
  select(event.clientX);
}

function onPointerMove(event) {
  if (dragging.value) select(event.clientX);
}

function onPointerUp(event) {
  dragging.value = false;
  if (picker.value?.hasPointerCapture(event.pointerId))
    picker.value.releasePointerCapture(event.pointerId);
}
</script>

<template>
  <div
    ref="picker"
    class="day-picker glass"
    :class="{ dragging }"
    :style="{ '--days': days.length || 1 }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <button
      v-for="(day, i) in days"
      :key="day.date"
      class="day"
      :class="{ active: i === modelValue }"
      type="button"
      @click="$emit('update:modelValue', i)"
    >
      <span class="dot" :style="{ background: colorOf(day.fogClass) }" />
      <span class="name">
        <span v-if="i === 0" class="live" />
        {{ i === 0 ? "Today" : day.weekday }}
      </span>
      <span class="date">{{ day.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.day-picker {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  width: clamp(15rem, calc(100vw - 1rem), calc(var(--days, 4) * 6.25rem));
  touch-action: none;
}

.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  padding: 0.5rem;
  background: none;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  transition:
    background 0.1s ease,
    box-shadow 0.1s ease;
}

.day-picker:not(.dragging) .day:hover {
  background: rgb(255 255 255 / 0.1);
}

.day.active {
  background: rgb(255 255 255 / 0.2);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25);
}

.dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  border: solid 1px rgb(255 255 255 / 0.5);
}

.name {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
  font-weight: bold;
}

.live {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: rgb(63, 223, 127);
  animation: pulse 2s ease-out infinite;
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

.date {
  font-size: 0.7rem;
  color: rgb(255 255 255 / 0.75);
}
</style>

<script setup>
import { colorOf } from "../constants/fogClasses";

defineProps({
  days: { type: Array, default: () => [] },
  modelValue: { type: Number, required: true },
});
defineEmits(["update:modelValue"]);
</script>

<template>
  <div class="day-picker glass">
    <button
      v-for="(day, i) in days"
      :key="day.date"
      class="day"
      :class="{ active: i === modelValue }"
      type="button"
      @click="$emit('update:modelValue', i)"
    >
      <span class="dot" :style="{ background: colorOf(day.maxClass) }" />
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
  width: clamp(15rem, calc(100vw - 1rem), 25rem);
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

.day:hover {
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

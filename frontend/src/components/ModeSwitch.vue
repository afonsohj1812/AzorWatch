<script setup>
import { MODES } from "../palette";

defineProps({
  modelValue: { type: String, required: true },
});
defineEmits(["update:modelValue"]);
</script>

<template>
  <div class="mode-switch glass">
    <button
      v-for="option in MODES"
      :key="option.id"
      class="mode"
      :class="{ active: option.id === modelValue }"
      type="button"
      @click="$emit('update:modelValue', option.id)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.mode-switch {
  display: flex;
  gap: 0.1rem;
  padding: 0.25rem;
}

.mode {
  font-size: 0.75rem;
  font-weight: bold;
  padding: 0.5rem 0.9rem;
  background: none;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  transition:
    background 0.1s ease,
    color 0.1s ease;
}

.mode:hover {
  color: rgb(255, 255, 255);
  background: rgb(255 255 255 / 0.1);
}

.mode.active {
  color: rgb(255, 255, 255);
  background: rgb(255 255 255 / 0.25);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25);
}
</style>

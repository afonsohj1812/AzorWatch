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
      class="mode pill"
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
  padding: 0.5rem 0.9rem;
}
</style>

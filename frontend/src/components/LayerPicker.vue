<script setup>
defineProps({
  modelValue: { type: String, required: true },
  entries: { type: Array, default: () => [] },
});
defineEmits(["update:modelValue"]);
</script>

<template>
  <div class="layer-picker glass">
    <button
      v-for="entry in entries"
      :key="entry.id"
      class="chip pill"
      :class="{ active: entry.id === modelValue }"
      type="button"
      @click="$emit('update:modelValue', entry.id)"
    >
      {{ entry.label }}
    </button>
  </div>
</template>

<style scoped>
.layer-picker {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.1rem;
  padding: 0.25rem;
  max-width: min(34rem, calc(100vw - 2rem));
}

.chip {
  padding: 0.4rem 0.75rem;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .layer-picker {
    flex-wrap: nowrap;
    justify-content: flex-start;
    max-width: none;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .layer-picker::-webkit-scrollbar {
    display: none;
  }
}
</style>

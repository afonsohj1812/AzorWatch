<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  islands: { type: Array, default: () => [] },
  modelValue: { type: String, required: true },
  collapsible: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue", "select"]);

const open = ref(false);

const currentName = computed(
  () => props.islands.find((i) => i.id === props.modelValue)?.name ?? "Island",
);

function choose(id) {
  emit("update:modelValue", id);
  emit("select", id);
  open.value = false;
}
</script>

<template>
  <button
    v-if="collapsible && !open"
    class="toggle glass"
    type="button"
    @click="open = true"
  >
    {{ currentName }}
  </button>

  <div v-else class="island-picker glass">
    <button
      v-for="island in islands"
      :key="island.id"
      class="island pill"
      :class="{ active: island.id === modelValue }"
      type="button"
      @click="choose(island.id)"
    >
      {{ island.name }}
    </button>
  </div>
</template>

<style scoped>
.island-picker {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.5rem;
}

.island {
  position: relative;
  text-align: left;
}

.island.active::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0.25rem;
  width: 2px;
  height: 1rem;
  transform: translateY(-50%);
  background: rgb(255, 255, 255);
}

.toggle {
  font-size: 0.75rem;
  font-weight: bold;
  padding: 0.75rem 1rem;
}
</style>

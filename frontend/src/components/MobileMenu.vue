<script setup>
import { ref } from "vue";

const open = ref(false);
</script>

<template>
  <div class="menu">
    <button
      class="toggle glass"
      type="button"
      aria-label="Menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="bars" :class="{ open }" />
    </button>

    <div v-if="open" class="sheet glass">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  cursor: pointer;
}

.bars,
.bars::before,
.bars::after {
  display: block;
  width: 1.1rem;
  height: 2px;
  border-radius: 1px;
  background: rgb(255, 255, 255);
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.bars {
  position: relative;
}

.bars::before,
.bars::after {
  content: "";
  position: absolute;
  left: 0;
}

.bars::before {
  top: -0.35rem;
}

.bars::after {
  top: 0.35rem;
}

.bars.open {
  background: transparent;
}

.bars.open::before {
  transform: translateY(0.35rem) rotate(45deg);
}

.bars.open::after {
  transform: translateY(-0.35rem) rotate(-45deg);
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  width: min(18rem, calc(100vw - 1rem));
  max-height: calc(100vh - 12rem);
  overflow-y: auto;
}

.sheet :deep(.glass) {
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  padding: 0;
}

.sheet :deep(.mode-switch),
.sheet :deep(.layer-picker),
.sheet :deep(.island-picker) {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  max-width: none;
  overflow-x: visible;
}

.sheet :deep(.mode),
.sheet :deep(.chip),
.sheet :deep(.island) {
  padding: 0.5rem 0.4rem;
  text-align: center;
}

.sheet :deep(.island.active)::before {
  display: none;
}
</style>

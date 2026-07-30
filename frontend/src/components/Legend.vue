<script setup>
import { FOG_CLASSES } from "../constants/fogClasses";
</script>

<template>
  <div class="legend glass">
    <div class="title">VISIBILITY</div>
    <div v-for="fogClass in FOG_CLASSES" :key="fogClass.id" class="row">
      <span class="swatch" :style="{ background: fogClass.color }" />
      <span class="range">{{ fogClass.range }}</span>
    </div>
  </div>
</template>

<style scoped>
.legend {
  padding: 0.5rem 0.75rem;
}

.title {
  font-size: 0.7rem;
  font-weight: bold;
  letter-spacing: 0.1em;
  color: rgb(191, 191, 191);
  margin-bottom: 0.5rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  line-height: 1.75rem;
}

.swatch {
  width: 1rem;
  height: 1rem;
  border: solid 1px rgb(255 255 255 / 0.5);
  border-radius: 4px;
}
</style>

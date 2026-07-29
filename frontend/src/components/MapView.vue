<script setup>
defineProps({
  island: { type: String, required: true },
  day: { type: Number, required: true },
  hour: { type: Number, required: true },
});
</script>

<template>
  <div class="map" />
</template>

<style scoped>
.map {
  height: 100%;
  background: rgb(191, 223, 239);
}
</style>

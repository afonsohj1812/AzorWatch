<script setup>
defineProps({ modelValue: { type: Number, required: true } });
defineEmits(["update:modelValue"]);
</script>

<template>
  <div class="day-picker" />
</template>

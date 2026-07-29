<script setup>
defineProps({ modelValue: { type: String, required: true } });
defineEmits(["update:modelValue"]);
</script>

<template>
  <div class="island-picker" />
</template>

<script setup>
import { computed } from "vue";

import model from "../config/model.json";

const FOG_CLASSES = model.classes;

const props = defineProps({
  point: { type: Object, default: null },
});

const byId = Object.fromEntries(FOG_CLASSES.map((c) => [c.id, c]));
const fogClass = computed(() => byId[props.point?.class] ?? null);

const metres = (value) => `${Math.round(value).toLocaleString("en-GB")} m`;

const depthText = computed(() => {
  const p = props.point;
  if (!p || p.sea) return null;
  if (p.cloudy === false) return "No low cloud forecast";
  if (p.aboveCloud) return "Above the cloud top";
  return p.depth >= 0
    ? `${metres(p.depth)} into the cloud`
    : `${metres(-p.depth)} below the base`;
});
</script>

<template>
  <div v-if="point" class="point-info glass">
    <template v-if="point.sea">
      <div class="headline">Sea</div>
      <div class="note">No fog modelled over water</div>
    </template>

    <template v-else>
      <div class="headline">
        <span class="swatch" :style="{ background: fogClass?.color }" />
        <span>{{
          point.visibility ? metres(point.visibility) : fogClass?.range
        }}</span>
      </div>

      <div class="note">{{ depthText }}</div>

      <dl class="detail">
        <dt>Elevation</dt>
        <dd>{{ metres(point.elevation) }}</dd>
        <template v-if="point.cloudy !== false">
          <dt>Cloud</dt>
          <dd>{{ metres(point.cloudBase) }} – {{ metres(point.cloudTop) }}</dd>
        </template>
        <dt>Slope</dt>
        <dd>{{ point.slope }}°</dd>
      </dl>
    </template>
  </div>
</template>

<style scoped>
.point-info {
  min-width: 10rem;
  padding: 0.5rem 0.75rem;
}

.headline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: bold;
  line-height: 1.5;
}

.swatch {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  border-radius: 0.2rem;
  border: solid 1px rgb(255 255 255 / 0.5);
}

.note {
  font-size: 0.75rem;
  color: rgb(255 255 255 / 0.75);
  line-height: 1.5;
}

.detail {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 0.5rem;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgb(255 255 255 / 0.25);
  font-size: 0.75rem;
  line-height: 1.75;
}

dt {
  color: rgb(255 255 255 / 0.5);
}

dd {
  text-align: right;
}
</style>

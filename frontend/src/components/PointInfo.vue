<script setup>
import { computed } from "vue";

import { paletteFor } from "../palette";

const props = defineProps({
  point: { type: Object, default: null },
  mode: { type: String, default: "fog" },
});

const swatch = computed(
  () => paletteFor(props.mode).find((c) => c.id === props.point?.class) ?? null,
);

const isNumber = (value) => Number.isFinite(value);

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

const FORMAT = {
  wave: (v) => `${v.toFixed(1)} m`,
  tide: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} m`,
  current: (v) => `${v.toFixed(1)} km/h`,
  wind: (v) => `${Math.round(v)} km/h`,
  clarity: (v) => `${Math.round(v)} m`,
  temperature: (v) => `${v.toFixed(1)} °C`,
};

const SEA_GROUPS = [
  { label: "Waves", main: "wave", sub: [] },
  { label: "Tide", main: "tide", sub: [["current", "current"]] },
  { label: "Wind", main: "wind", sub: [] },
  { label: "Visibility", main: "clarity", sub: [] },
  { label: "Water", main: "temperature", sub: [] },
];

const seaGroups = computed(() => {
  const layers = props.point?.layers;
  if (!layers) return [];

  return SEA_GROUPS.filter((group) => Number.isFinite(layers[group.main])).map(
    (group) => ({
      label: group.label,
      main: FORMAT[group.main](layers[group.main]),
      sub: group.sub
        .filter(([, key]) => Number.isFinite(layers[key]))
        .map(([name, key]) => `${name} ${FORMAT[key](layers[key])}`)
        .join(" · "),
    }),
  );
});
</script>

<template>
  <div v-if="point" class="point-info glass">
    <template v-if="mode === 'sea'">
      <template v-if="point.offshore">
        <div class="headline">Outside the band</div>
        <div class="note">Conditions are modeled within 1 km of the coast</div>
      </template>

      <template v-else>
        <div class="headline">
          <span class="swatch" :style="{ background: swatch?.color }" />
          <span>{{ swatch?.range }}</span>
        </div>

        <dl class="detail">
          <template v-for="group in seaGroups" :key="group.label">
            <dt>{{ group.label }}</dt>
            <dd>
              <span>{{ group.main }}</span>
              <span v-if="group.sub" class="sub">{{ group.sub }}</span>
            </dd>
          </template>
        </dl>
      </template>
    </template>

    <template v-else-if="point.sea">
      <div class="headline">Sea</div>
      <div class="note">No fog modeled over water</div>
    </template>

    <template v-else>
      <div class="headline">
        <span class="swatch" :style="{ background: swatch?.color }" />
        <span>{{
          point.visibility ? metres(point.visibility) : swatch?.range
        }}</span>
      </div>

      <div class="note">{{ depthText }}</div>

      <dl class="detail">
        <dt>Elevation</dt>
        <dd>{{ metres(point.elevation) }}</dd>
        <template v-if="isNumber(point.cover)">
          <dt>Cloud cover</dt>
          <dd>{{ point.cover }}%</dd>
        </template>
        <template v-if="point.cloudy !== false">
          <dt>Cloud</dt>
          <dd>{{ metres(point.cloudBase) }} – {{ metres(point.cloudTop) }}</dd>
        </template>
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
  text-transform: capitalize;
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
  max-width: 12rem;
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
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.4rem;
  text-align: right;
}

.sub {
  font-size: 0.7rem;
  color: rgb(255 255 255 / 0.5);
  white-space: nowrap;
}
</style>

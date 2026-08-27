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

const metres = (value) => `${Math.round(value).toLocaleString("en-GB")}m`;

const depthText = computed(() => {
  const p = props.point;
  if (!p || p.sea) return null;
  if (p.cloudy === false) return "No low cloud forecast";
  if (p.aboveCloud) return "Above the cloud top";
  return p.depth >= 0
    ? `${metres(p.depth)} into the cloud`
    : `${metres(-p.depth)} below the base`;
});

const seaRows = computed(() => props.point?.layers ?? []);
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
          <span>{{ swatch?.label }}</span>
        </div>

        <dl class="detail">
          <template v-for="row in seaRows" :key="row.id">
            <dt>{{ row.label }}</dt>
            <dd>
              <span class="bar">
                <span
                  class="fill"
                  :style="{ width: `${row.penalty * row.weight * 100}%` }"
                />
              </span>
              <span>{{ row.readout }}</span>
              <span
                v-if="row.bearing !== null"
                class="arrow"
                :style="{ transform: `rotate(${row.bearing}deg)` }"
                >&#8593;</span
              >
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
          point.visibility ? metres(point.visibility) : swatch?.label
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

.arrow {
  display: inline-block;
  line-height: 1;
}

.bar {
  flex: 1;
  min-width: 2.5rem;
  height: 0.3rem;
  border-radius: 0.15rem;
  background: rgb(255 255 255 / 0.15);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  background: rgb(255 255 255 / 0.6);
}

dd {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.4rem;
  text-align: right;
}

</style>

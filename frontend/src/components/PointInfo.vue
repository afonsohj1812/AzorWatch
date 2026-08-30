<script setup>
import { computed } from "vue";

import model from "../config/model.json";
import { paletteFor } from "../palette";

const GRADE = ["green", "yellow", "orange", "red"].map(
  (id) => model.classes[id].color,
);

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

function meterFor(row) {
  const span = row.to - row.from;
  const at = (value) =>
    span === 0
      ? 0
      : Math.max(0, Math.min(100, ((value - row.from) / span) * 100));

  const bands = [];
  let start = 0;

  row.ranges.forEach((edge, i) => {
    const stop = at(edge);
    bands.push(`${GRADE[i]} ${start}% ${stop}%`);
    start = stop;
  });
  bands.push(`${GRADE[GRADE.length - 1]} ${start}% 100%`);

  return {
    background: `linear-gradient(to right, ${bands.join(", ")})`,
    marker: at(row.value),
  };
}

const seaRows = computed(() =>
  (props.point?.layers ?? []).map((row) => ({
    ...row,
    meter: row.ranges ? meterFor(row) : null,
  })),
);
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

        <div class="gauges">
          <div v-for="row in seaRows" :key="row.id" class="gauge">
            <div class="head">
              <span class="name">{{ row.label }}</span>
              <span class="reading">
                <span>{{ row.readout }}</span>
                <span
                  v-if="row.bearing !== null"
                  class="arrow"
                  :style="{ transform: `rotate(${row.bearing}deg)` }"
                  >&#8593;</span
                >
              </span>
            </div>

            <span
              v-if="row.meter"
              class="meter"
              :style="{ background: row.meter.background }"
            >
              <span class="marker" :style="{ left: `${row.meter.marker}%` }" />
            </span>
          </div>
        </div>
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

dd {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.4rem;
  text-align: right;
}

.gauges {
  display: flex;
  flex-direction: column;
  width: 11.5rem;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgb(255 255 255 / 0.25);
  font-size: 0.75rem;
}

.gauge {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.name {
  color: rgb(255 255 255 / 0.5);
}

.reading {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  white-space: nowrap;
}

.arrow {
  display: inline-block;
  line-height: 1;
}

.meter {
  display: block;
  position: relative;
  width: 100%;
  height: 0.35rem;
  border-radius: 0.175rem;
}

.marker {
  position: absolute;
  top: -0.15rem;
  bottom: -0.15rem;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: rgb(255, 255, 255);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5);
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { useRoastStore } from "../stores/roast";
import { formatTime } from "../core/simulation";
import { phaseMetrics } from "../core/events";
const s = useRoastStore();
const metrics = computed(() => phaseMetrics(s.curve.markers, s.cursor));
</script>
<template>
  <section class="phase-strip" aria-label="已确认事件的阶段时长与占比">
    <div v-for="(phase, i) in metrics.phases" :key="phase.name" :class="`phase-segment phase-${i}`">
      <span :class="['phase-bean', 'bean-texture', `bean-stage-${i}`]" aria-hidden="true"></span
      ><strong>{{ phase.name }}</strong
      ><span class="mono">{{ phase.seconds === null ? "—" : formatTime(phase.seconds) }}</span
      ><span class="phase-ratio">{{
        phase.ratio === null ? "—" : phase.ratio.toFixed(1) + "%"
      }}</span>
      <div class="phase-track"><i :style="{ width: `${phase.ratio ?? 0}%` }"></i></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoastStore } from "../stores/roast";
import { eventLabels, eventOrder, turningPointCandidate } from "../core/events";
import { formatTime } from "../core/simulation";
import ConsoleDialog from "./ConsoleDialog.vue";
import type { MarkerKind } from "../core/types";
const s = useRoastStore(),
  show = ref(false),
  error = ref(""),
  editing = ref<MarkerKind | null>(null),
  seconds = ref(0);
const candidate = computed(() => {
  const charge = s.curve.markers.find((m) => m.kind === "CHARGE");
  return charge && !s.curve.markers.some((m) => m.kind === "TP")
    ? turningPointCandidate(s.samples, charge.t)
    : null;
});
function edit() {
  if (editing.value && s.editMarker(editing.value, seconds.value)) {
    editing.value = null;
    error.value = "";
  } else error.value = "事件时间必须位于采样区间内，并保持烘焙事件先后顺序。";
}
</script>
<template>
  <div class="event-toolbar" aria-label="手动事件标记">
    <span class="toolbar-label">事件标记</span
    ><button
      v-for="kind in eventOrder"
      :key="kind"
      :data-test="`marker-${kind}`"
      :title="kind"
      :disabled="!s.canMark(kind)"
      @click="s.mark(kind)"
    >
      <i :class="`event-dot event-${kind}`"></i>{{ eventLabels[kind] }}</button
    ><button :disabled="!s.curve.markers.length" title="撤销最后一个事件" @click="s.undoMarker()">
      ↶ <span>撤销</span></button
    ><button aria-label="编辑事件时间" @click="show = true">⋯</button>
  </div>
  <div v-if="candidate && s.recording" class="candidate-strip">
    <span
      >候选回温点 {{ formatTime(candidate.t) }} · {{ candidate.bt?.toFixed(1) }}°C，需人工确认</span
    ><button @click="s.confirmTurningPoint(candidate.t)">确认回温点</button>
  </div>
  <ConsoleDialog v-if="show" title="事件记录与时间修正" @close="show = false">
    <p class="subtle">阶段由已确认的事件决定。回温点只是建议；脱水、一爆与二爆均需人工判断。</p>
    <p v-if="s.curve.nativeArtisan" class="small-note">
      编辑秒数从首个采样算起（图表以入豆为 00:00）；入豆位于
      {{ (s.curve.markers.find((m) => m.kind === "CHARGE")?.t ?? 0).toFixed(3) }}
      秒。原生导出时事件与最近采样点的误差最多 0.5 秒，超出会拒绝导出，不会静默截断。
    </p>
    <p v-if="!s.curve.markers.length" class="empty-state">
      还没有标记事件。开始模拟录制后可手动标记。
    </p>
    <ul class="event-list">
      <li v-for="m in s.curve.markers" :key="m.kind">
        <strong>{{ eventLabels[m.kind] }}</strong
        ><span>{{ formatTime(m.t) }}</span
        ><span
          >{{ m.bt == null ? "温度未记录" : m.bt.toFixed(1) + "°C"
          }}<small v-if="m.temperatureSource === 'interpolated'">（插值）</small></span
        ><span class="subtle">{{
          m.source === "manual"
            ? "手动"
            : m.source === "legacy" || s.curve.source === "legacy"
              ? "历史记录"
              : "曲线事件"
        }}</span
        ><button
          @click="
            editing = m.kind;
            seconds = m.t;
          "
        >
          编辑
        </button>
      </li>
    </ul>
    <form v-if="editing" class="inline-form" @submit.prevent="edit">
      <label>
        {{ eventLabels[editing] }}时间（秒）<input
          v-model.number="seconds"
          type="number"
          min="0"
          step="0.1" /></label
      ><button class="button primary">保存修正</button>
    </form>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p class="small-note">
      温度来自该时间点的样本；非采样时刻仅在连续数据内插值，缺失或长间断不补造读数。
    </p>
  </ConsoleDialog>
</template>

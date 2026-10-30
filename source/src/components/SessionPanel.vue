<script setup lang="ts">
/** 功能：提供离线仿真和完整记录回放。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 作为练习模式面板，修正实机能力与时间文案。 */
import { computed, ref } from "vue";
import { useRoastStore } from "../stores/roast";
import { formatTime, createDemoCurve } from "../core/simulation";
import { interpolateSample } from "../core/events";
import type { RoastCurve } from "../core/types";
const props = defineProps<{
  items: RoastCurve[];
}>();
const emit = defineEmits<{
  start: [];
  simulate: [origin?: number];
  reference: [curve: RoastCurve];
}>();
const s = useRoastStore(),
  explicitOrigin = ref(false);
const choices = computed(() => [
  createDemoCurve(),
  ...props.items.filter((c) => c.id !== "demo-ethiopia"),
  ...(s.reference &&
  !props.items.some((c) => c.id === s.reference?.id) &&
  s.reference.id !== "demo-ethiopia"
    ? [s.reference]
    : []),
]);
const hasCharge = computed(() => s.reference?.markers.some((m) => m.kind === "CHARGE"));
const target = computed(() => interpolateSample(s.referenceSamples, s.cursor)?.bt ?? null);
const current = computed(() => s.current?.bt ?? null),
  error = computed(() =>
    target.value === null || current.value === null ? null : current.value - target.value,
  );
const display = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const states = {
  idle: "待开始",
  ready: "已暂停",
  running: "闭环运行中",
  manual: "手动仿真",
  completed: "已完成",
  fault: "故障保护",
};
function select(e: Event) {
  const chosen = choices.value.find((c) => c.id === (e.target as HTMLSelectElement).value);
  if (chosen) {
    explicitOrigin.value = false;
    emit("reference", chosen);
  }
}
function begin() {
  emit(
    "simulate",
    hasCharge.value ? undefined : explicitOrigin.value ? s.reference?.samples[0]?.t : undefined,
  );
}
</script>
<template>
  <aside class="tracking-panel" aria-label="离线曲线跟踪仿真">
    <div class="panel-heading">
      <h2><span class="wave-icon">∿</span>曲线跟踪</h2>
      <span class="pill">仿真</span>
    </div>
    <label class="field-label" for="target-curve">参考曲线</label
    ><select id="target-curve" :value="s.reference?.id ?? ''" @change="select">
      <option disabled value="">请从曲线库选择</option>
      <option v-for="curve in choices" :key="curve.id" :value="curve.id">{{ curve.name }}</option>
    </select>
    <p v-if="hasCharge" class="target-origin">以参考曲线的入豆时刻对齐</p>
    <label v-else class="origin-confirm"
      ><input v-model="explicitOrigin" type="checkbox" />无入豆标记，确认以首个样本为起点</label
    >
    <div class="tracking-values">
      <div>
        <span>目标 BT</span><strong>{{ display(target) }}<small>°C</small></strong>
      </div>
      <div>
        <span>当前 BT</span><strong>{{ display(current) }}<small>°C</small></strong>
      </div>
      <div>
        <span>偏差</span
        ><strong :class="{ sage: error !== null && Math.abs(error) < 3 }"
          >{{ error !== null && error > 0 ? "+" : "" }}{{ display(error) }}<small>°C</small></strong
        >
      </div>
    </div>
    <div class="tracking-progress">
      <span>{{ states[s.tracking.state] }}</span
      ><strong
        >{{
          s.tracking.duration ? Math.round((s.tracking.elapsed / s.tracking.duration) * 100) : 0
        }}%</strong
      ><progress
        max="100"
        :value="s.tracking.duration ? (s.tracking.elapsed / s.tracking.duration) * 100 : 0"
        aria-label="仿真跟踪进度"
      />
    </div>
    <div class="mode-row"><span>跟踪模式</span><span>离线闭环仿真</span></div>
    <div class="output-cards">
      <div>
        <span class="output-icon" aria-hidden="true"
          ><svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          >
            <path
              d="M12 3c1 5-3 5-2 9 2-1 3-2 4-4 3 3 5 6 3 10-1 2-3 3-5 3-4 0-7-3-7-7 0-4 5-6 7-11Z"
            />
            <path d="M12 14c0 2-3 3-2 5 1 2 4 1 4-1 0-1-1-2-2-4Z" /></svg></span
        ><span>加热请求</span><strong>{{ s.tracking.output.toFixed(0) }}<small>%</small></strong
        ><small>模拟输出</small>
      </div>
      <div>
        <span class="output-icon fan-icon">✣</span><span>风门反馈</span><strong>—</strong
        ><small>未接入 / 未模拟</small>
      </div>
    </div>
    <div class="tracking-actions">
      <button
        v-if="s.tracking.state !== 'running' && s.tracking.state !== 'manual'"
        data-test="start-tracking"
        class="button primary full"
        :disabled="!s.reference || (!hasCharge && !explicitOrigin)"
        @click="begin"
      >
        ▶ {{ s.tracking.state === "ready" ? "继续仿真" : "开始仿真" }}</button
      ><button
        v-else-if="s.tracking.state === 'running'"
        class="button primary full"
        @click="s.pauseTracking()"
      >
        Ⅱ 暂停仿真
      </button>
      <div class="two-buttons">
        <button
          class="button secondary"
          :disabled="s.tracking.state !== 'running'"
          @click="s.takeManual()"
        >
          手动接管仿真</button
        ><button class="button stop-button" :disabled="!s.trackingActive" @click="s.stopTracking()">
          ■ 停止仿真
        </button>
      </div>
      <label v-if="s.tracking.state === 'manual'" class="manual-control"
        >手动模拟加热 {{ s.tracking.output.toFixed(0) }}%<input
          type="range"
          min="0"
          max="100"
          :value="s.tracking.output"
          @input="s.manualOutput(Number(($event.target as HTMLInputElement).value))"
      /></label>
    </div>
    <p class="tracking-reason" :class="{ error: s.tracking.state === 'fault' }" role="status">
      {{ s.tracking.reason }}
    </p>
    <button
      data-test="real-tracking"
      class="real-tracking"
      disabled
      title="实机传感器与物理执行器尚未接入验证，网页仅支持只读连接"
    >
      真实设备跟踪不可用
    </button>
    <p class="hardware-reason">实机传感器与执行器尚待接入验证</p>
    <section class="playback-tools">
      <div class="playback-heading">
        <strong>完整记录回放</strong
        ><span>{{ formatTime(s.cursor) }} / {{ formatTime(s.duration) }}</span>
      </div>
      <div class="playback-buttons">
        <button
          :disabled="s.trackingActive"
          :aria-label="s.playing ? '暂停模拟' : '播放模拟'"
          @click="s.togglePlayback()"
        >
          {{ s.playing ? "Ⅱ 暂停" : "▷ 播放" }}</button
        ><button :disabled="s.recording" @click="s.resetPlayback()">↺ 重置</button
        ><select v-model.number="s.speed" aria-label="回放速度" :disabled="s.trackingActive">
          <option :value="1">1×</option>
          <option :value="5">5×</option>
          <option :value="10">10×</option>
        </select>
      </div>
      <input
        v-model.number="s.cursor"
        class="scrubber"
        type="range"
        aria-label="回放位置"
        :min="s.curve.samples[0]?.t ?? 0"
        :max="s.duration"
        step="2"
        :disabled="s.recording || s.trackingActive"
        @input="s.playing = false"
      /><button
        v-if="!s.recording"
        data-test="start-recording"
        class="text-button"
        @click="emit('start')"
      >
        ＋ 新建模拟记录</button
      ><button
        v-else
        data-test="stop-recording"
        class="text-button danger-text"
        @click="s.stopRecording()"
      >
        ■ 停止录制
      </button>
    </section>
  </aside>
</template>

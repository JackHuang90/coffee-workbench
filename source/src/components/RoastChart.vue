<script setup lang="ts">
/** 功能：显示烘焙测量、趋势和事件，并提供独立的短缺口估算图层。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 增加可关闭的贝塞尔估算，仅使用游标前采样且不改变指标，并保留孤立实测点；增加交互读数、拖选和事件窗口。 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRoastStore } from "../stores/roast";
import { formatTime, channelRates } from "../core/simulation";
import { displayGapSeconds, forecastBT } from "../core/trend";
import { eventLabels, interpolateSample, phaseMetrics } from "../core/events";
import type { Sample } from "../core/types";
import { gapPath, measuredPath, temperatureGeometry } from "../core/curve-repair";
const s = useRoastStore(),
  root = ref<HTMLElement>(),
  width = ref(950),
  height = ref(440),
  showEt = ref(true),
  showRor = ref(true),
  showDeltaEt = ref(false),
  showTrend = ref(true),
  rateScale = ref("roast");
const showRepair = ref(true);
const geometry = computed(() => ({
  bt: temperatureGeometry(s.samples, "bt"),
  et: temperatureGeometry(s.samples, "et"),
}));
const repairCount = computed(
  () => geometry.value.bt.gaps.length + (showEt.value ? geometry.value.et.gaps.length : 0),
);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver((entries) => {
      width.value = Math.max(300, entries[0]?.contentRect.width ?? 950);
      height.value = Math.max(210, entries[0]?.contentRect.height ?? 440);
    });
    if (root.value) observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
const summary = computed(() => phaseMetrics(s.curve.markers, s.cursor));
const rates = computed(() => channelRates(s.samples, "bt")),
  etRates = computed(() => channelRates(s.samples, "et"));
const display = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(1);
const prediction = computed(() =>
  forecastBT(s.curve.samples, {
    cursor: s.cursor,
    blockedReason:
      s.deviceRecording && s.deviceInterrupted
        ? "设备数据中断，暂停预测"
        : s.trackingSession && !["running", "manual"].includes(s.tracking.state)
          ? "仿真已暂停或冻结，暂不预测"
          : undefined,
  }),
);
const end = computed(() =>
  Math.max(
    600,
    s.duration,
    s.referenceSamples.at(-1)?.t ?? 0,
    showTrend.value ? (prediction.value.points.at(-1)?.t ?? 0) : 0,
  ),
);
const nativeCharge = computed(() =>
  s.curve.nativeArtisan ? s.curve.markers.find((marker) => marker.kind === "CHARGE") : undefined,
);
const chargeOrigin = computed(() => nativeCharge.value?.t ?? 0);
const chartTime = (t: number) => {
  const relative = t - chargeOrigin.value;
  return `${relative < 0 ? "−" : ""}${formatTime(Math.abs(relative))}`;
};
const bounds = computed(() => {
  const values = [
    ...s.samples,
    ...(s.reference?.samples ?? []),
    ...(showTrend.value ? prediction.value.points : []),
  ]
    .flatMap((p) => [p.bt, showEt.value ? p.et : null])
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    min: Math.min(50, Math.floor(Math.min(...values, 50) / 50) * 50),
    max: Math.max(250, Math.ceil(Math.max(...values, 250) / 50) * 50),
  };
});
const clippedRates = computed(
  () =>
    rateScale.value === "roast" &&
    [...(showRor.value ? rates.value : []), ...(showDeltaEt.value ? etRates.value : [])].some(
      (v) => v !== null && (v < -10 || v > 30),
    ),
);
const range = computed(() => {
  if (rateScale.value === "roast") return { min: -10, max: 30 };
  const values = [
    ...(showRor.value ? rates.value : []),
    ...(showDeltaEt.value ? etRates.value : []),
  ].filter((v): v is number => v !== null);
  return {
    min: Math.min(-10, Math.floor(Math.min(...values, -10) / 10) * 10),
    max: Math.max(30, Math.ceil(Math.max(...values, 30) / 10) * 10),
  };
});
const viewStart = computed(() => s.chartWindow?.start ?? 0);
const viewEnd = computed(() => s.chartWindow?.end ?? end.value);
const viewSpan = computed(() => Math.max(1, viewEnd.value - viewStart.value));
const timeTickCount = computed(() => (width.value < 550 ? 6 : 11));
const x = (t: number) => 48 + ((t - viewStart.value) / viewSpan.value) * (width.value - 94),
  y = (v: number) =>
    32 + ((bounds.value.max - v) / (bounds.value.max - bounds.value.min)) * (height.value - 76),
  ry = (v: number) =>
    32 + ((range.value.max - v) / (range.value.max - range.value.min)) * (height.value - 76);
function line(points: Sample[], channel: "bt" | "et") {
  const maxGap = displayGapSeconds(points);
  let d = "",
    down = false,
    previous: number | undefined;
  for (const p of points) {
    const value = p[channel];
    if (!Number.isFinite(p.t) || value == null || !Number.isFinite(value)) {
      down = false;
      previous = p.t;
      continue;
    }
    if (previous !== undefined && (p.t <= previous || p.t - previous > maxGap)) down = false;
    d += `${down ? "L" : "M"}${x(p.t).toFixed(2)},${y(value).toFixed(2)} `;
    down = true;
    previous = p.t;
  }
  return d;
}
function rateLine(values: Array<number | null>) {
  let d = "",
    down = false;
  values.forEach((v, i) => {
    if (v === null) {
      down = false;
      return;
    }
    d += `${down ? "L" : "M"}${x(s.samples[i].t)},${ry(v)} `;
    down = true;
  });
  return d;
}
const markers = computed(() =>
  s.curve.markers
    .filter((m) => m.t <= s.cursor && m.t >= viewStart.value && m.t <= viewEnd.value)
    .map((m) => ({
      ...m,
      temperature: m.bt ?? interpolateSample(s.curve.samples, m.t)?.bt ?? null,
    })),
);

const inspectTime = ref<number | null>(null);
const selectionStart = ref<number | null>(null);
const inspectionAt = computed(() =>
  Math.max(viewStart.value, Math.min(viewEnd.value, inspectTime.value ?? s.cursor)),
);
const inspected = computed(() => interpolateSample(s.samples, inspectionAt.value));
const inspectedTarget = computed(() => interpolateSample(s.referenceSamples, inspectionAt.value));
watch(
  () => [s.curve.id, viewStart.value, viewEnd.value],
  () => {
    inspectTime.value = null;
    selectionStart.value = null;
  },
);
/** 功能：将鼠标或触摸位置映射为显示时刻，只读曲线不更改运行游标。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function inspectPointer(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  if (!rect.width) return;
  const px = ((event.clientX - rect.left) / rect.width) * width.value;
  inspectTime.value = Math.max(
    viewStart.value,
    Math.min(viewEnd.value, viewStart.value + ((px - 48) / (width.value - 94)) * viewSpan.value),
  );
}
/** 功能：开始图表区间选择并捕获指针。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function beginSelection(event: PointerEvent) {
  if (event.button !== 0) return;
  inspectPointer(event);
  selectionStart.value = inspectTime.value;
  (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
}
/** 功能：结束有效拖选并放大，点击则只保留读数。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function finishSelection(event: PointerEvent) {
  inspectPointer(event);
  if (
    selectionStart.value !== null &&
    inspectTime.value !== null &&
    Math.abs(inspectTime.value - selectionStart.value) > Math.max(5, viewSpan.value * 0.025)
  )
    s.chartWindow = {
      start: Math.min(selectionStart.value, inspectTime.value),
      end: Math.max(selectionStart.value, inspectTime.value),
    };
  selectionStart.value = null;
  (event.currentTarget as SVGElement).releasePointerCapture?.(event.pointerId);
}
/** 功能：定位已确认一爆的前后 90 秒，复盘时显示已有全量数据。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function zoomCrack() {
  const marker = s.curve.markers.find((m) => m.kind === "FCs");
  if (!marker) return;
  s.chartWindow = { start: Math.max(0, marker.t - 90), end: marker.t + 90 };
  if (!s.recording) {
    s.playing = false;
    s.cursor = s.curve.samples.at(-1)?.t ?? s.cursor;
  }
}
</script>
<template>
  <section class="curve-workspace" aria-label="温度曲线与升温速率">
    <div class="metrics">
      <div>
        <span>豆温 BT</span
        ><strong class="metric bt">{{ display(s.current?.bt) }}<small>°C</small></strong>
      </div>
      <div>
        <span>炉温 ET</span
        ><strong class="metric et">{{ display(s.current?.et) }}<small>°C</small></strong>
      </div>
      <div>
        <span>ΔBT / RoR</span
        ><strong class="metric ror"
          >{{ display(s.current ? rates.at(-1) : null) }}<small>°C/min</small></strong
        >
      </div>
      <div class="et-rate">
        <span>ΔET</span
        ><strong class="metric"
          >{{ display(s.current ? etRates.at(-1) : null) }}<small>°C/min</small></strong
        >
      </div>
      <div>
        <span>烘焙时长</span
        ><strong class="metric time">{{ formatTime(summary.elapsed ?? s.cursor) }}</strong>
      </div>
      <div>
        <span>发展 · DTR</span
        ><strong class="metric development"
          >{{ summary.development === null ? "—" : formatTime(summary.development)
          }}<small>{{ summary.dtr === null ? "—" : summary.dtr.toFixed(1) + "%" }}</small></strong
        >
      </div>
    </div>
    <div class="chart-legend">
      <span><i class="line bt-line"></i>豆温 BT</span
      ><label><input v-model="showEt" type="checkbox" /><i class="line et-line"></i>炉温 ET</label
      ><span v-if="s.reference"><i class="line ref-line"></i>目标 BT</span
      ><label
        ><input v-model="showTrend" type="checkbox" aria-label="显示短期 BT 趋势" /><i
          class="line prediction-line"
        ></i
        >趋势 BT</label
      ><label><input v-model="showRor" type="checkbox" /><i class="line ror-line"></i>ΔBT</label
      ><label
        ><input v-model="showDeltaEt" type="checkbox" /><i class="line delta-line"></i>ΔET</label
      ><select v-model="rateScale" class="rate-scale" aria-label="升温率显示范围">
        <option value="roast">RoR −10～30</option>
        <option value="full">RoR 完整范围</option></select
      ><small v-if="clippedRates">含超出视窗数据</small><small v-else>30 秒连续窗口</small
      ><label
        ><input
          v-model="showRepair"
          type="checkbox"
          aria-label="贝塞尔补全短缺口"
        />补全短缺口</label
      >
    </div>
    <div class="chart-tools">
      <span>移动查看读数 · 拖选放大</span
      ><button
        data-test="zoom-crack"
        :disabled="!s.curve.markers.some((m) => m.kind === 'FCs')"
        @click="zoomCrack"
      >
        一爆附近</button
      ><button data-test="zoom-reset" :disabled="!s.chartWindow" @click="s.chartWindow = null">
        完整曲线
      </button>
    </div>
    <div ref="root" class="chart-plot">
      <svg
        class="temperature-chart"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        aria-labelledby="temperature-title temperature-desc"
        @pointermove="inspectPointer"
        @pointerdown="beginSelection"
        @pointerup="finishSelection"
        @pointercancel="selectionStart = null"
      >
        <title id="temperature-title">咖啡烘焙温度曲线</title>
        <desc id="temperature-desc">
          模拟或导入曲线。当前豆温
          {{ display(s.current?.bt) }}
          摄氏度。实测数据在缺口处断开，开启补全时短缺口使用虚线贝塞尔估算。
        </desc>
        <defs>
          <pattern
            id="minor-grid"
            :width="(width - 94) / 30"
            :height="(height - 76) / 20"
            patternUnits="userSpaceOnUse"
            x="48"
            y="32"
          >
            <path
              :d="`M ${(width - 94) / 30} 0 L 0 0 0 ${(height - 76) / 20}`"
              fill="none"
              stroke="#e9e1d9"
              stroke-width=".5"
            />
          </pattern>
          <clipPath id="plot-clip">
            <rect x="48" y="32" :width="width - 94" :height="height - 76" />
          </clipPath>
        </defs>
        <rect x="48" y="32" :width="width - 94" :height="height - 76" fill="url(#minor-grid)" />
        <g v-for="i in 6" :key="`y${i}`">
          <line
            x1="48"
            :x2="width - 46"
            :y1="y(bounds.min + ((i - 1) * (bounds.max - bounds.min)) / 5)"
            :y2="y(bounds.min + ((i - 1) * (bounds.max - bounds.min)) / 5)"
            class="grid-line"
          />
          <text
            x="38"
            :y="y(bounds.min + ((i - 1) * (bounds.max - bounds.min)) / 5) + 4"
            text-anchor="end"
          >
            {{ Math.round(bounds.min + ((i - 1) * (bounds.max - bounds.min)) / 5) }}
          </text>
          <text :x="width - 35" :y="32 + ((i - 1) * (height - 76)) / 5 + 4">
            {{ Math.round(range.max - ((i - 1) * (range.max - range.min)) / 5) }}
          </text>
        </g>
        <text x="16" y="16">°C</text>
        <text :x="width - 8" y="16" text-anchor="end">°C/min</text>
        <g v-for="i in timeTickCount" :key="`x${i}`">
          <line
            :x1="x(viewStart + ((i - 1) * viewSpan) / (timeTickCount - 1))"
            :x2="x(viewStart + ((i - 1) * viewSpan) / (timeTickCount - 1))"
            y1="32"
            :y2="height - 44"
            class="grid-line vertical"
          />
          <text
            :x="x(viewStart + ((i - 1) * viewSpan) / (timeTickCount - 1))"
            :y="height - 24"
            text-anchor="middle"
          >
            {{ chartTime(viewStart + ((i - 1) * viewSpan) / (timeTickCount - 1)) }}
          </text>
        </g>
        <text :x="width / 2" :y="height - 5" text-anchor="middle">时间（分:秒）</text>
        <g clip-path="url(#plot-clip)">
          <rect
            v-if="selectionStart !== null && inspectTime !== null"
            :x="x(Math.min(selectionStart, inspectTime))"
            y="32"
            :width="Math.abs(x(selectionStart) - x(inspectTime))"
            :height="height - 76"
            fill="#bb623f20"
          />
          <line
            v-if="inspectTime !== null"
            :x1="x(inspectTime)"
            :x2="x(inspectTime)"
            y1="32"
            :y2="height - 44"
            class="inspection-line"
          />
          <path v-if="s.reference" :d="line(s.referenceSamples, 'bt')" class="reference-path" />
          <path :d="measuredPath(geometry.bt, x, y)" class="bt-path" />
          <path
            v-for="gap in showRepair ? geometry.bt.gaps : []"
            :key="`repair-bt-${gap.start.t}`"
            :d="gapPath(gap, x, y)"
            class="repair-path repair-bt"
            stroke-dasharray="4 4"
            data-test="repair-bt"
          >
            <title>豆温短缺口 · 贝塞尔估算</title>
          </path>
          <path
            v-if="showTrend && prediction.points.length > 1"
            :d="line(prediction.points, 'bt')"
            class="prediction-path"
          />
          <path v-if="showEt" :d="measuredPath(geometry.et, x, y)" class="et-path" />
          <path
            v-for="gap in showRepair && showEt ? geometry.et.gaps : []"
            :key="`repair-et-${gap.start.t}`"
            :d="gapPath(gap, x, y)"
            class="repair-path repair-et"
            stroke-dasharray="4 4"
            data-test="repair-et"
          >
            <title>炉温短缺口 · 贝塞尔估算</title>
          </path>
          <circle
            v-for="point in geometry.bt.runs.filter((run) => run.length === 1).flat()"
            :key="`isolated-bt-${point.t}`"
            :cx="x(point.t)"
            :cy="y(point.value)"
            r="3"
            fill="#ce562b"
            data-test="isolated-bt"
          />
          <circle
            v-for="point in showEt ? geometry.et.runs.filter((run) => run.length === 1).flat() : []"
            :key="`isolated-et-${point.t}`"
            :cx="x(point.t)"
            :cy="y(point.value)"
            r="3"
            fill="#688460"
            data-test="isolated-et"
          />
          <path v-if="showRor" :d="rateLine(rates)" class="ror-path" />
          <path v-if="showDeltaEt" :d="rateLine(etRates)" class="delta-et-path" />
          <line :x1="x(s.cursor)" :x2="x(s.cursor)" y1="32" :y2="height - 44" class="cursor-line" />
        </g>
        <g v-for="(m, i) in markers" :key="m.kind" class="chart-marker">
          <line
            :x1="x(m.t)"
            :x2="x(m.t)"
            :y1="m.temperature === null ? 55 : Math.max(40, y(m.temperature) - 40 - (i % 2) * 22)"
            :y2="height - 44"
            class="marker-line"
          />
          <circle
            v-if="m.temperature !== null"
            :cx="x(m.t)"
            :cy="y(m.temperature)"
            r="3.5"
            class="bt-dot"
          />
          <text
            :x="Math.max(55, Math.min(width - 100, x(m.t) + 6))"
            :y="m.temperature === null ? 55 : Math.max(42, y(m.temperature) - 30 - (i % 2) * 22)"
            class="marker-label"
          >
            {{ eventLabels[m.kind] }}
            <tspan :x="Math.max(55, Math.min(width - 100, x(m.t) + 6))" dy="15" class="marker-time">
              {{ chartTime(m.t) }}
            </tspan>
          </text>
        </g>
        <circle
          v-if="s.current?.bt != null && s.current.t >= viewStart && s.current.t <= viewEnd"
          :cx="x(s.current.t)"
          :cy="y(s.current.bt)"
          r="4"
          class="bt-dot"
        />
      </svg>
    </div>
    <div class="chart-inspector">
      <label
        >查看时刻<input
          :value="inspectionAt"
          type="range"
          aria-label="曲线读数时刻"
          :min="viewStart"
          :max="viewEnd"
          step="1"
          @input="inspectTime = Number(($event.target as HTMLInputElement).value)" /></label
      ><strong>{{ chartTime(inspectionAt) }}</strong
      ><span
        >BT <b>{{ display(inspected?.bt) }}°C</b></span
      ><span
        >ET <b>{{ display(inspected?.et) }}°C</b></span
      ><span
        >参考 <b>{{ display(inspectedTarget?.bt) }}°C</b></span
      ><small>{{
        inspected?.basis === "interpolated"
          ? "相邻有效点线性读数"
          : inspected?.bt == null
            ? "此处缺测"
            : "采样读数"
      }}</small>
    </div>
    <div class="chart-caption">
      <span
        >{{
          s.curve.source === "legacy" || s.curve.schemaVersion === 1
            ? "历史数据"
            : s.curve.source === "simulation"
              ? "本地仿真数据"
              : s.curve.source === "device-demo"
                ? "设备演示记录（非实机）"
                : s.curve.source === "imported"
                  ? "导入数据"
                  : "示例模拟数据"
        }}
        ·
        {{
          s.deviceRecording
            ? s.deviceInterrupted
              ? "设备数据中断 · 历史曲线已保留"
              : "只读采集中"
            : s.current
              ? "非实时设备读数"
              : "当前位置缺少有效新采样"
        }}</span
      ><span>{{ s.reference ? "目标：" + s.reference.name : "未选择参考曲线" }}</span>
      <span v-if="s.curve.nativeArtisan">{{
        nativeCharge ? "入豆为 00:00 · 保留入豆前采样" : "缺少入豆事件 · 首个采样为 00:00"
      }}</span>
      <span v-if="showTrend" class="trend-status" data-test="trend-status">{{
        prediction.reason ?? "30 秒回归 · 最多预测 60 秒 · 仅供观察，不参与控制"
      }}</span>
      <span v-if="showRepair && repairCount" class="repair-status"
        >{{ repairCount }} 段虚线为贝塞尔估算 · 原始数据保留 · 不参与 RoR、趋势或控制</span
      >
    </div>
  </section>
</template>

<style scoped>
.prediction-line {
  border-color: #8b668f;
  border-top-style: dashed;
}
.prediction-path {
  fill: none;
  stroke: #8b668f;
  stroke-width: 2;
  stroke-dasharray: 7 3 1 3;
  stroke-linecap: round;
}
.chart-caption {
  flex-wrap: wrap;
  row-gap: 2px;
}
.trend-status {
  color: #79607c;
}
.repair-path {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}
.repair-bt {
  stroke: #ce562b;
}
.repair-et {
  stroke: #688460;
}
.repair-status {
  color: #927148;
}
</style>

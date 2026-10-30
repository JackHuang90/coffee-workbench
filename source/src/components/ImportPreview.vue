<script setup lang="ts">
/** 功能：显示导入检查和独立曲线缩略图，确认前不改变现有草稿。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写；增加可关闭的短缺口贝塞尔估算并保留实测统计。 */
import { computed, onMounted, ref } from "vue";
import type { RoastCurve } from "../core/types";
import { inspectImport } from "../core/import-inspection";
import { formatTime } from "../core/simulation";
import { estimateGap, gapPath, measuredPath, temperatureGeometry } from "../core/curve-repair";

const props = defineProps<{ curve: RoastCurve; fileName: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const heading = ref<HTMLElement>();
const showRepair = ref(true);
const report = computed(() => inspectImport(props.curve));
const geometry = computed(() => ({
  bt: temperatureGeometry(props.curve.samples, "bt"),
  et: temperatureGeometry(props.curve.samples, "et"),
}));
const repairCount = computed(() => geometry.value.bt.gaps.length + geometry.value.et.gaps.length);
const events = computed(() =>
  report.value.events.map((event) => {
    const gap =
      showRepair.value && event.seconds !== null && event.bt === null
        ? geometry.value.bt.gaps.find(
            (item) =>
              event.seconds! + report.value.origin > item.start.t &&
              event.seconds! + report.value.origin < item.end.t,
          )
        : undefined;
    return {
      ...event,
      bt: gap ? estimateGap(gap, event.seconds! + report.value.origin) : event.bt,
      estimated: !!gap,
    };
  }),
);
const limits = computed(() => {
  const values = props.curve.samples
    .flatMap((sample) => [sample.bt, sample.et])
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const min = values.length ? Math.floor(Math.min(...values) / 10) * 10 : 0;
  return {
    min,
    max: Math.max(min + 10, values.length ? Math.ceil(Math.max(...values) / 10) * 10 : 100),
    start: props.curve.samples[0].t,
    end: props.curve.samples.at(-1)!.t,
  };
});
onMounted(() => {
  heading.value?.focus({ preventScroll: true });
  const dialog = heading.value?.closest<HTMLElement>('[role="dialog"]');
  if (dialog) dialog.scrollTop = 0;
});

/** 功能：为预览图定位采样时间。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function x(t: number) {
  return 48 + ((t - limits.value.start) / Math.max(1, limits.value.end - limits.value.start)) * 622;
}
/** 功能：将摄氏温度投影到预览图高度。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function y(value: number) {
  return 25 + ((limits.value.max - value) / (limits.value.max - limits.value.min)) * 155;
}
/** 功能：显示相对入豆或首点的时间，保留入豆前负时间。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function relativeTime(t: number) {
  return `${t < 0 ? "−" : ""}${formatTime(Math.abs(t))}`;
}
</script>

<template>
  <div data-test="import-preview" class="import-check">
    <div class="import-check-heading">
      <div>
        <span class="eyebrow">{{ curve.nativeArtisan ? "Artisan · .alog" : "CURVE IMPORT" }}</span>
        <h3 ref="heading" tabindex="-1">{{ curve.name }}</h3>
        <p>{{ fileName }} · {{ curve.samples.length }} 个采样点</p>
      </div>
      <span class="pill">校验通过 · 尚未导入</span>
    </div>
    <div class="inspection-unit">
      <span
        >原始温标 <strong>°{{ report.originalUnit }}</strong></span
      ><span>工作台显示 <strong>°C</strong></span
      ><span>{{
        report.hasCharge ? "时间以入豆为 00:00" : "缺少入豆标记 · 时间以首个采样为 00:00"
      }}</span>
    </div>
    <div class="inspection-chart">
      <div class="inspection-legend">
        <span class="bt-key">● 豆温 BT</span><span class="et-key">● 炉温 ET</span
        ><span>{{ showRepair && repairCount ? "虚线为贝塞尔估算" : "缺失点保留断线" }}</span>
      </div>
      <svg viewBox="0 0 700 215" role="img" aria-label="导入曲线预览，豆温和炉温以摄氏度显示">
        <g v-for="fraction in [0, 0.5, 1]" :key="fraction">
          <line
            x1="48"
            x2="670"
            :y1="25 + fraction * 155"
            :y2="25 + fraction * 155"
            stroke="#e4dcd3"
          />
          <text x="40" :y="29 + fraction * 155" text-anchor="end">
            {{ Math.round(limits.max - fraction * (limits.max - limits.min)) }}°
          </text>
        </g>
        <path :d="measuredPath(geometry.et, x, y)" fill="none" stroke="#688460" stroke-width="2" />
        <path
          :d="measuredPath(geometry.bt, x, y)"
          fill="none"
          stroke="#ce562b"
          stroke-width="2.5"
        />
        <g v-if="showRepair">
          <path
            v-for="gap in geometry.bt.gaps"
            :key="`bt-${gap.start.t}`"
            :d="gapPath(gap, x, y)"
            fill="none"
            stroke="#ce562b"
            stroke-width="2.5"
            stroke-dasharray="4 4"
            data-test="repair-bt"
          >
            <title>豆温短缺口 · 贝塞尔估算</title>
          </path>
          <path
            v-for="gap in geometry.et.gaps"
            :key="`et-${gap.start.t}`"
            :d="gapPath(gap, x, y)"
            fill="none"
            stroke="#688460"
            stroke-width="2"
            stroke-dasharray="4 4"
            data-test="repair-et"
          >
            <title>炉温短缺口 · 贝塞尔估算</title>
          </path>
        </g>
        <circle
          v-for="point in geometry.bt.runs.filter((run) => run.length === 1).flat()"
          :key="`bt-${point.t}`"
          :cx="x(point.t)"
          :cy="y(point.value)"
          r="3"
          fill="#ce562b"
          data-test="isolated-bt"
        />
        <circle
          v-for="point in geometry.et.runs.filter((run) => run.length === 1).flat()"
          :key="`et-${point.t}`"
          :cx="x(point.t)"
          :cy="y(point.value)"
          r="3"
          fill="#688460"
          data-test="isolated-et"
        />
        <g
          v-for="(event, i) in report.events.filter((item) => item.seconds !== null)"
          :key="event.kind"
        >
          <line
            :x1="x(event.seconds! + report.origin)"
            :x2="x(event.seconds! + report.origin)"
            y1="20"
            y2="180"
            stroke="#b8a28f"
            stroke-dasharray="3 4"
          />
          <text
            :x="Math.max(80, Math.min(635, x(event.seconds! + report.origin)))"
            :y="15 + (i % 2) * 16"
            text-anchor="middle"
          >
            {{ event.label }}
          </text>
        </g>
        <text x="48" y="205">{{ relativeTime(limits.start - report.origin) }}</text>
        <text x="670" y="205" text-anchor="end">
          {{ relativeTime(limits.end - report.origin) }}
        </text>
      </svg>
    </div>
    <div class="repair-options">
      <label
        ><input
          v-model="showRepair"
          type="checkbox"
          aria-label="贝塞尔补全短缺口"
        />贝塞尔补全短缺口</label
      ><span>{{
        repairCount
          ? `${repairCount} 段可估算 · 端点间距 ≤ ${geometry.bt.maxGapSeconds.toFixed(1)} 秒`
          : "没有可补全的短缺口"
      }}</span>
      <p>虚线仅供观察；有效点数、保存和导出均保留原始数据。长缺口及两端缺失不外推。</p>
    </div>
    <div class="inspection-channels">
      <div
        v-for="channel in ['bt', 'et'] as const"
        :key="channel"
        :data-test="`channel-${channel}`"
      >
        <span>{{ channel === "bt" ? "豆温 BT" : "炉温 ET" }} · 有效点</span
        ><strong>{{ report.channels[channel].valid }} / {{ curve.samples.length }}</strong>
        <p>
          {{
            report.channels[channel].min === null
              ? "无有效温度数据"
              : `${report.channels[channel].min!.toFixed(1)}–${report.channels[channel].max!.toFixed(1)} °C`
          }}
          · 缺失 {{ report.channels[channel].missing }} 点
        </p>
      </div>
    </div>
    <div class="inspection-events">
      <div v-for="event in events" :key="event.kind" :class="{ missing: event.seconds === null }">
        <span>{{ event.label }}</span
        ><strong>{{ event.seconds === null ? "未标记" : relativeTime(event.seconds) }}</strong
        ><small>{{
          event.seconds === null
            ? "不会自动补造"
            : event.bt === null
              ? "该时刻豆温缺失"
              : `${event.bt.toFixed(1)} °C${event.estimated ? "（贝塞尔估算）" : event.temperatureSource === "interpolated" ? "（插值）" : ""}`
        }}</small>
      </div>
    </div>
    <section class="inspection-controls">
      <h4>火力与风量事件</h4>
      <div class="control-check-row">
        <p data-test="heat-events">
          火力
          <strong>{{
            report.controls.heat ? `已识别 ${report.controls.heat} 条` : "未发现明确标注"
          }}</strong>
        </p>
        <p data-test="air-events">
          风量 / 风门
          <strong>{{
            report.controls.air ? `已识别 ${report.controls.air} 条` : "未发现明确标注"
          }}</strong>
        </p>
      </div>
      <p class="small-note">
        共 {{ report.controls.total }} 条特殊事件 · 其他类型 {{ report.controls.other }} 条 · 未确认
        {{ report.controls.unknown }} 条。按文件类型名称识别，仅保留记录，不执行控制。
      </p>
      <p v-for="warning in report.controls.warnings" :key="warning" class="inspection-warning">
        {{ warning }}
      </p>
    </section>
    <details v-if="report.native" class="inspection-details">
      <summary>原始文件与兼容信息</summary>
      <p>
        {{ report.native.fieldCount }} 个原生字段 · {{ report.native.extraChannelPairs }} 组附加通道
        · 来源版本 {{ report.native.sourceVersion ?? "未声明" }}
      </p>
      <ul>
        <li v-for="warning in report.native.warnings" :key="warning">{{ warning }}</li>
      </ul>
    </details>
    <div class="inspection-footer">
      <p class="small-note">确认后打开为草稿；保存曲线后才会加入本地曲线库。</p>
      <div class="button-row">
        <button data-test="cancel-import" @click="emit('cancel')">返回选择</button
        ><button class="button primary" data-test="confirm-import" @click="emit('confirm')">
          确认打开草稿
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.import-check {
  display: grid;
  gap: 16px;
}
.import-check-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}
.import-check-heading h3 {
  font-size: 24px;
  margin: 8px 0 5px;
  overflow-wrap: anywhere;
}
.import-check-heading h3:focus {
  outline: none;
}
.import-check-heading p,
.inspection-unit {
  font-size: 12px;
  color: var(--muted);
}
.inspection-unit {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.inspection-unit strong {
  color: var(--ink);
  margin-left: 5px;
}
.inspection-chart {
  background: #faf6f0;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 10px 0;
}
.inspection-chart svg {
  display: block;
  width: 100%;
}
.inspection-chart text {
  font-size: 11px;
  fill: #756c64;
}
.inspection-legend {
  display: flex;
  justify-content: center;
  gap: 20px;
  font-size: 11px;
  margin-bottom: 10px;
  color: var(--muted);
}
.bt-key {
  color: #b44e2a;
}
.et-key {
  color: #526a4b;
}
.repair-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: 12px;
  color: var(--muted);
}
.repair-options label {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--ink);
  cursor: pointer;
}
.repair-options p {
  flex-basis: 100%;
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}
.inspection-channels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.inspection-channels > div {
  border: 1px solid var(--line);
  padding: 14px;
  border-radius: 6px;
}
.inspection-channels span,
.inspection-events span {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.inspection-channels strong {
  display: block;
  font-size: 23px;
  font-weight: 500;
  margin: 7px 0;
}
.inspection-channels p {
  font-size: 11px;
  color: var(--muted);
}
.inspection-events {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: #f5efe7;
  padding: 14px 0;
  border-radius: 6px;
}
.inspection-events > div {
  padding: 0 18px;
  border-right: 1px solid var(--line);
}
.inspection-events > div:last-child {
  border: 0;
}
.inspection-events strong {
  display: block;
  font-size: 18px;
  font-weight: 500;
  margin: 7px 0;
}
.inspection-events small {
  font-size: 11px;
  color: var(--muted);
}
.inspection-events .missing strong {
  color: #97704b;
}
.inspection-controls h4 {
  margin: 0 0 10px;
  font-size: 13px;
}
.control-check-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  font-size: 12px;
  margin-bottom: 8px;
}
.control-check-row strong {
  margin-left: 10px;
  font-weight: 500;
}
.inspection-warning {
  font-size: 12px;
  color: #896339;
  margin-top: 5px;
}
.inspection-details {
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
}
.inspection-details summary {
  cursor: pointer;
}
.inspection-details p {
  margin-top: 8px;
}
.inspection-details ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.inspection-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
@media (max-width: 600px) {
  .import-check-heading h3 {
    font-size: 20px;
  }
  .import-check-heading {
    flex-wrap: wrap;
  }
  .inspection-events > div {
    padding: 0 10px;
  }
  .inspection-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .inspection-footer .button-row {
    justify-content: flex-end;
  }
}
</style>

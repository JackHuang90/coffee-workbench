<script setup lang="ts">
/** 功能：按复盘、练习和只读采集组织侧栏操作。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { computed, watch } from "vue";
import { useRoastStore } from "../stores/roast";
import { summarizeRoast, deviationTrend } from "../core/journal";
import { formatTime } from "../core/simulation";
import type { RoastCurve } from "../core/types";
import type { DeviceSnapshot } from "../core/device";
import SessionPanel from "./SessionPanel.vue";
const props = defineProps<{
  items: RoastCurve[];
  device: DeviceSnapshot;
  fresh: boolean;
  draftStatus: string;
}>();
const emit = defineEmits<{
  start: [];
  simulate: [origin?: number];
  reference: [curve: RoastCurve];
  record: [];
  connect: [];
  deviceStart: [];
  library: [];
}>();
const s = useRoastStore();
const summary = computed(() => summarizeRoast(s.curve));
const trend = computed(() => deviationTrend(s.curve.samples, s.referenceSamples, s.cursor));
const canAlignCrack = computed(
  () =>
    s.curve.markers.some((m) => m.kind === "FCs") &&
    s.reference?.markers.some((m) => m.kind === "FCs"),
);
watch(canAlignCrack, (valid) => {
  if (!valid) s.alignment = "CHARGE";
});
const choices = computed(() => [
  ...new Map(
    [...(s.reference ? [s.reference] : []), ...props.items].map((c) => [c.id, c]),
  ).values(),
]);
/** 功能：切换比较参考，不执行参考内事件。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function choose(event: Event) {
  const curve = choices.value.find((c) => c.id === (event.target as HTMLSelectElement).value);
  if (curve) emit("reference", curve);
}
</script>
<template>
  <aside class="workflow-panel" aria-label="烘焙工作流程">
    <div class="workflow-modes" role="tablist" aria-label="工作模式">
      <button
        v-for="mode in [
          ['review', '复盘'],
          ['practice', '练习'],
          ['record', '记录'],
        ] as const"
        :key="mode[0]"
        role="tab"
        :aria-selected="s.workspaceMode === mode[0]"
        @click="s.workspaceMode = mode[0]"
      >
        {{ mode[1] }}
      </button>
    </div>
    <div v-if="s.workspaceMode === 'review'" class="workflow-body">
      <div class="panel-heading">
        <h2>读懂这一锅</h2>
        <span class="pill">复盘</span>
      </div>
      <p class="small-note">看曲线的变化，也记住杯中的感受。</p>
      <div class="record-mini">
        <span class="eyebrow">本锅记录</span>
        <h3>{{ s.curve.name || "未命名记录" }}</h3>
        <div class="mini-metrics">
          <div>
            <small>烘焙时长</small
            ><strong>{{ summary.elapsed === null ? "—" : formatTime(summary.elapsed) }}</strong>
          </div>
          <div>
            <small>发展比例</small
            ><strong>{{ summary.dtr === null ? "—" : summary.dtr.toFixed(1) + "%" }}</strong>
          </div>
        </div>
        <button class="button primary full" data-test="open-record" @click="emit('record')">
          查看本锅记录 <span aria-hidden="true">↗</span>
        </button>
        <small class="small-note">{{
          s.dirty
            ? draftStatus || "尚未保存"
            : s.savedToLibrary
              ? "已存入曲线库"
              : "示例记录 · 可自由探索"
        }}</small>
      </div>
      <label class="field-label" for="review-reference">与哪一锅比较</label>
      <select id="review-reference" :value="s.reference?.id ?? ''" @change="choose">
        <option disabled value="">选择参考曲线</option>
        <option v-for="c in choices" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <button class="text-button" @click="emit('library')">从曲线库选择 ↗</button>
      <div class="alignment-options" aria-label="曲线对齐方式">
        <button :aria-pressed="s.alignment === 'CHARGE'" @click="s.alignment = 'CHARGE'">
          入豆对齐</button
        ><button
          :aria-pressed="s.alignment === 'FCs'"
          :disabled="!canAlignCrack"
          @click="s.alignment = 'FCs'"
        >
          一爆对齐
        </button>
      </div>
      <p class="small-note">
        {{
          s.alignment === "FCs"
            ? "仅移动参考显示位置；事件时间差仍按各自入豆计算。"
            : "缺少入豆时，以首个采样对齐。"
        }}
      </p>
      <p class="deviation-note">{{ s.reference ? trend : "选择参考后查看偏差走势" }}</p>
      <div class="review-playback">
        <div class="playback-heading">
          <strong>完整记录回放</strong
          ><span>{{ formatTime(s.cursor) }} / {{ formatTime(s.duration) }}</span>
        </div>
        <input
          v-model.number="s.cursor"
          type="range"
          aria-label="复盘位置"
          :min="s.curve.samples[0]?.t ?? 0"
          :max="s.duration"
          :disabled="s.recording"
          @input="s.playing = false"
        /><button :disabled="s.recording" @click="s.togglePlayback()">
          {{ s.playing ? "Ⅱ 暂停回放" : "▷ 回放记录" }}
        </button>
      </div>
    </div>
    <SessionPanel
      v-show="s.workspaceMode === 'practice'"
      :items="items"
      @start="emit('start')"
      @simulate="emit('simulate', $event)"
      @reference="emit('reference', $event)"
    />
    <div v-if="s.workspaceMode === 'record'" class="workflow-body">
      <div class="panel-heading">
        <h2>设备数据记录</h2>
        <span class="pill">只读</span>
      </div>
      <p class="small-note">从已连接设备采集温度，持续保存到本地草稿。</p>
      <div class="connection-checks">
        <p>
          <span>连接</span><strong>{{ device.state === "connected" ? "已连接" : "未连接" }}</strong>
        </p>
        <p>
          <span>有效测温</span
          ><strong>{{
            fresh && device.status?.sensor_valid ? "设备演示样本" : "暂无有效数据"
          }}</strong>
        </p>
        <p><span>网页控制</span><strong>只读，不发送控制</strong></p>
      </div>
      <p class="notice">当前固件提供虚拟演示数据。实机传感器与执行器仍待接入验证。</p>
      <button
        v-if="!s.deviceRecording"
        class="button primary full"
        :disabled="
          !fresh ||
          !device.status?.sensor_valid ||
          device.status.source !== 'virtual_demo' ||
          s.recording
        "
        @click="emit('deviceStart')"
      >
        开始记录设备演示
      </button>
      <button v-else class="button stop-button full" @click="s.stopRecording()">■ 结束记录</button>
      <button class="button secondary full" @click="emit('connect')">
        {{ device.state === "connected" ? "查看设备连接" : "连接 ESP32-S3" }}
      </button>
      <p v-if="s.deviceRecording" class="deviation-note">
        {{
          fresh
            ? `已采集 ${s.curve.samples.filter((p) => p.bt !== null).length} 个温度点`
            : "数据中断，已保留此前记录"
        }}
        · {{ draftStatus }}
      </p>
      <button class="text-button" @click="emit('record')">查看本锅记录 ↗</button>
    </div>
  </aside>
</template>

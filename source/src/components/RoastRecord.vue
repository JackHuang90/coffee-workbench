<script setup lang="ts">
/** 功能：呈现本锅记录、事实对比、多次品饮和下一锅计划。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { computed, ref } from "vue";
import { useRoastStore } from "../stores/roast";
import { compareRoasts, emptyJournal, localDate, summarizeRoast } from "../core/journal";
import { formatTime } from "../core/simulation";
import { eventLabels } from "../core/events";
import FlavorWheel from "./FlavorWheel.vue";
import type { MarkerKind, RoastCurve, RoastExperiment, Tasting } from "../core/types";
const props = defineProps<{
  saving: boolean;
  error: string;
  draftStatus: string;
  items: RoastCurve[];
}>();
const emit = defineEmits<{
  save: [];
  locate: [kind: MarkerKind];
  reference: [curve: RoastCurve];
  export: [];
}>();
const s = useRoastStore();
const showFlavors = ref(false),
  editingTastingId = ref<string | null>(null);
const section = ref("overview"),
  tastingDate = ref(localDate()),
  tastingMethod = ref(""),
  tastingNotes = ref("");
const journal = computed(() => s.curve.journal ?? emptyJournal());
const summary = computed(() => summarizeRoast(s.curve));
const comparisons = computed(() => (s.reference ? compareRoasts(s.curve, s.reference) : []));
const candidateIds = computed(() => [
  ...new Map(
    [...(s.reference ? [s.reference] : []), ...props.items].map((c) => [c.id, c]),
  ).values(),
]);
const duration = (v: number | null) => (v === null ? "—" : formatTime(v));
const number = (v: number | null, unit = "") => (v === null ? "—" : v.toFixed(1) + unit);
/** 功能：按需创建记录卡，打开查看本身不产生修改。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function ensure() {
  return s.curve.journal ?? (s.curve.journal = emptyJournal());
}
/** 功能：保存用户编辑的烘焙条件。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function field(key: "bean" | "machine" | "roastDate", event: Event) {
  ensure()[key] = (event.target as HTMLInputElement).value;
}
/** 功能：写入人工单变量实验计划，不转成控制命令。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function plan(key: keyof RoastExperiment, event: Event) {
  const j = ensure();
  j.experiment ??= { goal: "", change: "", keep: "" };
  j.experiment[key] = (event.target as HTMLTextAreaElement).value;
}
/** 功能：追加一次品饮观察，限制数量并保留不同日期。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function addTasting() {
  if (
    !tastingDate.value ||
    !tastingNotes.value.trim() ||
    (!editingTastingId.value && journal.value.tastings.length >= 100)
  )
    return;
  const entry = {
    id: editingTastingId.value ?? crypto.randomUUID(),
    date: tastingDate.value,
    method: tastingMethod.value.trim(),
    notes: tastingNotes.value.trim(),
  };
  const index = ensure().tastings.findIndex((t) => t.id === editingTastingId.value);
  if (index >= 0) ensure().tastings[index] = entry;
  else ensure().tastings.push(entry);
  editingTastingId.value = null;
  tastingNotes.value = "";
  tastingMethod.value = "";
}
/** 功能：将已保存品饮放回表单修正，不增加重复记录。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function editTasting(tasting: Tasting) {
  editingTastingId.value = tasting.id;
  tastingDate.value = tasting.date;
  tastingNotes.value = tasting.notes;
  tastingMethod.value = tasting.method;
}
/** 功能：根据明确的烘焙日期计算日历养豆天数。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function restDays(date: string) {
  const days = (Date.parse(date) - Date.parse(journal.value.roastDate)) / 86400000;
  return Number.isFinite(days) && days >= 0 ? `养豆 ${days} 天` : "养豆天数未确定";
}
/** 功能：从列表选择比较对象，保留记录卡窗口。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function compareWith(event: Event) {
  const c = candidateIds.value.find((c) => c.id === (event.target as HTMLSelectElement).value);
  if (c) s.reference = JSON.parse(JSON.stringify(c));
}
</script>
<template>
  <div class="roast-record">
    <div class="record-hero">
      <div>
        <span class="eyebrow">ROAST JOURNAL · 本锅记录</span>
        <h3>{{ s.curve.name || "未命名记录" }}</h3>
        <p>
          {{ journal.bean || "豆批尚未填写" }} <span>·</span>
          {{ journal.machine || "机器尚未填写" }}
        </p>
      </div>
      <span class="record-status">{{
        s.recording
          ? "记录中"
          : s.curve.markers.some((m) => m.kind === "DROP")
            ? "已标记出豆"
            : "待补全事件"
      }}</span>
    </div>
    <nav class="record-tabs" aria-label="记录卡内容">
      <button
        v-for="item in [
          ['overview', '本锅概览'],
          ['compare', '两锅对比'],
          ['tasting', '品饮记录'],
          ['plan', '下一锅计划'],
        ]"
        :key="item[0]"
        :aria-pressed="section === item[0]"
        @click="section = item[0]"
      >
        {{ item[1]
        }}<small v-if="item[0] === 'tasting' && journal.tastings.length">{{
          journal.tastings.length
        }}</small>
      </button>
    </nav>
    <section v-if="section === 'overview'" class="record-section">
      <div class="record-metrics">
        <div>
          <span>烘焙时长</span><strong>{{ duration(summary.elapsed) }}</strong>
        </div>
        <div>
          <span>发展时长</span><strong>{{ duration(summary.development) }}</strong>
        </div>
        <div>
          <span>发展比例</span><strong>{{ number(summary.dtr, "%") }}</strong>
        </div>
        <div>
          <span>失重率</span><strong>{{ number(summary.loss, "%") }}</strong>
        </div>
      </div>
      <div class="phase-summary">
        <div
          v-for="(phase, index) in [
            { name: '脱水', value: summary.drying },
            { name: '褐变', value: summary.browning },
            { name: '发展', value: summary.development },
          ]"
          :key="phase.name"
          :class="`phase-${index}`"
        >
          <span>{{ phase.name }}</span
          ><strong>{{ duration(phase.value) }}</strong>
        </div>
      </div>
      <p class="small-note">指标由已确认事件计算；缺少边界时显示「—」。</p>
      <div class="record-fields">
        <label
          >豆批 / 豆名<input
            :value="journal.bean"
            maxlength="120"
            placeholder="例如：埃塞 · 水洗 · 批次 01"
            @input="field('bean', $event)" /></label
        ><label
          >机器 / 探针<input
            :value="journal.machine"
            maxlength="120"
            placeholder="机器型号与探针位置"
            @input="field('machine', $event)" /></label
        ><label
          >烘焙日期<input
            type="date"
            :value="journal.roastDate"
            @input="field('roastDate', $event)" /></label
        ><label
          >入豆重量（g）<input
            v-model.number="s.curve.inputWeight"
            type="number"
            min="0.1"
            max="100000"
            step="0.1"
            placeholder="未称量"
            @change="s.curve.inputWeight = s.curve.inputWeight || null" /></label
        ><label
          >出豆重量（g）<input
            v-model.number="s.curve.outputWeight"
            type="number"
            min="0.1"
            max="100000"
            step="0.1"
            placeholder="未称量"
            @change="s.curve.outputWeight = s.curve.outputWeight || null"
        /></label>
      </div>
      <label class="record-notes"
        >风味与观察<textarea
          v-model="s.curve.notes"
          rows="3"
          maxlength="4000"
          placeholder="这锅做了什么调整？当时观察到了什么？"
        ></textarea>
      </label>
      <div class="record-events">
        <button
          v-for="marker in s.curve.markers"
          :key="marker.kind"
          @click="emit('locate', marker.kind)"
        >
          <span>{{ eventLabels[marker.kind] }}</span
          ><strong>{{ formatTime(marker.t) }}</strong
          ><small>定位 ↗</small>
        </button>
      </div>
      <details v-if="journal.actions.length" class="action-log">
        <summary>操作与中断记录 · {{ journal.actions.length }}</summary>
        <ol>
          <li v-for="(action, index) in [...journal.actions].reverse().slice(0, 30)" :key="index">
            <time>{{ formatTime(action.t) }}</time
            >{{ action.text }}
          </li>
        </ol>
        <p v-if="journal.actions.length > 30" class="small-note">
          显示最近 30 条，完整日志随 JSON 备份保留。
        </p>
      </details>
    </section>
    <section v-else-if="section === 'compare'" class="record-section">
      <div class="compare-heading">
        <div>
          <h3>两锅之间，发生了什么变化</h3>
          <p class="small-note">正值表示本锅更高或更长；时间均相对各自入豆。</p>
        </div>
        <select aria-label="记录卡比较对象" :value="s.reference?.id ?? ''" @change="compareWith">
          <option value="" disabled>选择比较对象</option>
          <option v-for="c in candidateIds" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <button
        v-if="journal.reference"
        class="text-button"
        @click="s.reference = JSON.parse(JSON.stringify(journal.reference))"
      >
        使用开始时的参考快照：{{ journal.reference.name }}
      </button>
      <div v-if="s.reference" class="compare-table">
        <div class="compare-row compare-labels">
          <span>指标</span><span>本锅</span><span>参考</span><span>变化</span>
        </div>
        <button
          v-for="row in comparisons"
          :key="row.key"
          class="compare-row"
          :disabled="!s.curve.markers.some((m) => m.kind === row.marker)"
          @click="emit('locate', row.marker)"
        >
          <strong>{{ row.label }}</strong
          ><span>{{ row.unit === "秒" ? duration(row.current) : number(row.current) }}</span
          ><span>{{ row.unit === "秒" ? duration(row.reference) : number(row.reference) }}</span
          ><strong :class="{ difference: row.delta !== null && Math.abs(row.delta) > 0.1 }">{{
            row.delta === null
              ? "—"
              : `${row.delta > 0 ? "+" : ""}${row.delta.toFixed(1)} ${row.unit}`
          }}</strong>
        </button>
      </div>
      <div v-else class="record-empty">从曲线库选一条参考，就能在这里看到差异。</div>
      <p class="small-note">
        点击指标可定位对应事件。数据差异不等于风味变化的原因，建议结合豆批、机器、装量和冲煮条件判断。
      </p>
      <div v-if="s.reference" class="comparison-context">
        <span>参考装量：{{ s.reference.inputWeight ?? "未填写" }} g</span
        ><span>本锅装量：{{ s.curve.inputWeight ?? "未填写" }} g</span
        ><span>参考最近品饮：{{ s.reference.journal?.tastings.at(-1)?.notes || "未记录" }}</span
        ><span>本锅最近品饮：{{ journal.tastings.at(-1)?.notes || "未记录" }}</span>
      </div>
    </section>
    <section v-else-if="section === 'tasting'" class="record-section tasting-layout">
      <div class="tasting-history">
        <h3>让杯中的感受留下来</h3>
        <p class="small-note">同一锅，可以在不同养豆天数多次品饮。</p>
        <div v-if="!journal.tastings.length" class="record-empty">
          <span aria-hidden="true">☕</span><strong>第一杯，从这里记起</strong>
          <p>留下冲煮方法和感受，下一次会更容易比较。</p>
        </div>
        <article
          v-for="tasting in [...journal.tastings].reverse()"
          :key="tasting.id"
          class="tasting-entry"
        >
          <div>
            <strong>{{ tasting.date }}</strong
            ><span>{{ restDays(tasting.date) }}</span>
          </div>
          <small>{{ tasting.method || "冲煮方式未填写" }}</small>
          <p>{{ tasting.notes }}</p>
          <button class="text-button" @click="editTasting(tasting)">编辑这次品饮</button>
        </article>
      </div>
      <form class="tasting-form" @submit.prevent="addTasting">
        <h3>{{ editingTastingId ? "编辑品饮记录" : "添加一次品饮" }}</h3>
        <label
          >品饮日期<input
            v-model="tastingDate"
            type="date"
            required
            :min="journal.roastDate || undefined" /></label
        ><label
          >冲煮方式与参数<input
            v-model="tastingMethod"
            maxlength="200"
            placeholder="例如：V60 · 15g / 240g · 92°C" /></label
        ><label
          >这杯给你的感受<textarea
            v-model="tastingNotes"
            rows="4"
            maxlength="2000"
            required
            placeholder="香气、酸甜、口感、余韵…也可以记下不满意的地方。"
          ></textarea></label
        ><button
          class="button primary"
          :disabled="!editingTastingId && journal.tastings.length >= 100"
        >
          {{ editingTastingId ? "保存品饮修改" : "＋ 加入品饮记录" }}</button
        ><button type="button" class="text-button" @click="showFlavors = !showFlavors">
          借助风味盘描述 ↗
        </button>
      </form>
      <div v-if="showFlavors" class="record-inline-flavors">
        <FlavorWheel
          :model-value="s.curve.flavorTags ?? []"
          @update:model-value="s.curve.flavorTags = $event"
        />
      </div>
    </section>
    <section v-else class="record-section experiment-layout">
      <div class="experiment-intro">
        <span class="eyebrow">NEXT ROAST</span>
        <h3>下一锅，只验证一个想法。</h3>
        <p>把这次品饮转成一个小实验，其他条件尽量保持一致。</p>
        <blockquote v-if="journal.tastings.length">{{ journal.tastings.at(-1)?.notes }}</blockquote>
        <button
          class="button secondary"
          :disabled="s.recording || s.curve.samples.length < 2 || !s.curve.name.trim()"
          @click="emit('reference', s.snapshot())"
        >
          把本锅设为下一锅参考 ↗
        </button>
      </div>
      <div class="experiment-fields">
        <label
          ><span>01 · 想改善什么</span
          ><textarea
            :value="journal.experiment?.goal ?? ''"
            rows="2"
            maxlength="500"
            placeholder="例如：希望甜感更清晰"
            @input="plan('goal', $event)"
          ></textarea></label
        ><label
          ><span>02 · 只改变哪个变量</span
          ><textarea
            :value="journal.experiment?.change ?? ''"
            rows="2"
            maxlength="500"
            placeholder="写下你想验证的一项调整"
            @input="plan('change', $event)"
          ></textarea></label
        ><label
          ><span>03 · 保持哪些条件</span
          ><textarea
            :value="journal.experiment?.keep ?? ''"
            rows="2"
            maxlength="500"
            placeholder="同豆批、装量、机器、冲煮方式…"
            @input="plan('keep', $event)"
          ></textarea>
        </label>
        <p class="small-note">计划保存在本锅记录中，不会自动修改设备参数。</p>
      </div>
    </section>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div class="record-footer">
      <span class="small-note">{{ draftStatus || "保存在当前浏览器，请定期备份" }}</span
      ><button
        class="button secondary"
        :disabled="s.curve.samples.length < 2"
        @click="emit('export')"
      >
        导出完整 JSON</button
      ><button
        class="button primary"
        :disabled="saving || s.recording || s.curve.samples.length < 2 || !s.curve.name.trim()"
        @click="emit('save')"
      >
        {{ saving ? "保存中…" : "保存本锅记录" }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 功能：管理本地曲线列表和导入检查，确认前保留现有草稿。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 用独立检查视图替代内嵌摘要。 */
import { nextTick, ref, watch } from "vue";
import type { RoastCurve } from "../core/types";
import { formatTime } from "../core/simulation";
import { MAX_TEXT_BYTES, MAX_JSON_TEXT_BYTES, parseCSV, parseJSON } from "../core/serialization";
import { importALOG } from "../core/alog";
import ImportPreview from "./ImportPreview.vue";
const props = defineProps<{
  items: RoastCurve[];
  loading: boolean;
  error: string;
}>();
const emit = defineEmits<{
  open: [curve: RoastCurve];
  reference: [curve: RoastCurve];
  remove: [curve: RoastCurve];
  rename: [curve: RoastCurve, name: string];
  import: [curve: RoastCurve];
  "preview-state": [active: boolean];
  retry: [];
  demo: [];
}>();
const preview = ref<RoastCurve | null>(null),
  importError = ref(""),
  fileName = ref(""),
  reading = ref(false),
  renameId = ref(""),
  renameName = ref(""),
  paste = ref(""),
  pasteFormat = ref("alog");
let previewTrigger: HTMLElement | null = null;
watch(preview, (value) => {
  emit("preview-state", !!value);
});
let importSequence = 0;
watch([paste, pasteFormat], () => {
  preview.value = null;
  importError.value = "";
  importSequence++;
  reading.value = false;
});
/** 功能：解析为待检查曲线，捕获失败但不替换活动曲线。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 记录返回预览前的焦点。 */
function parse(text: string, format: string, name: string) {
  previewTrigger = document.activeElement as HTMLElement | null;
  preview.value = null;
  importError.value = "";
  try {
    preview.value =
      format === "alog"
        ? importALOG(text, name)
        : format === "csv"
          ? parseCSV(text)
          : parseJSON(text);
    fileName.value = name;
  } catch (e) {
    importError.value = e instanceof Error ? e.message : "无法读取这份曲线。";
  }
}
/** 功能：返回曲线库输入并恢复操作焦点，不改变当前曲线。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
async function cancelPreview() {
  preview.value = null;
  await nextTick();
  if (previewTrigger?.isConnected) previewTrigger.focus();
}
async function choose(e: Event) {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  const seq = ++importSequence;
  preview.value = null;
  importError.value = "";
  reading.value = true;
  try {
    const limit = file.name.toLowerCase().endsWith(".json") ? MAX_JSON_TEXT_BYTES : MAX_TEXT_BYTES;
    if (file.size > limit)
      throw new Error(`文件超过 ${limit / 1024 / 1024} MiB，请使用更小的曲线文件。`);
    const text = await file.text();
    if (seq === importSequence)
      parse(
        text,
        file.name.toLowerCase().endsWith(".alog")
          ? "alog"
          : file.name.toLowerCase().endsWith(".csv")
            ? "csv"
            : "json",
        file.name,
      );
  } catch (e) {
    if (seq === importSequence)
      importError.value = e instanceof Error ? e.message : "文件读取失败，请重试。";
  } finally {
    if (seq === importSequence) reading.value = false;
    input.value = "";
  }
}
function rename(curve: RoastCurve) {
  if (renameName.value.trim()) {
    emit("rename", curve, renameName.value.trim());
    renameId.value = "";
  }
}
const date = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
</script>
<template>
  <section class="library-section">
    <div v-show="!preview">
      <div class="section-heading">
        <div>
          <p class="eyebrow">YOUR ROAST JOURNAL</p>
          <h2>把好曲线留住。</h2>
          <p class="subtle">此设备上的私人手记。慢慢积累每一锅的风味。</p>
        </div>
        <span class="library-count">{{ props.items.length }} 份手记</span>
      </div>
      <div v-if="error" class="notice error" role="alert">
        {{ error }}
        <button class="text-button" @click="emit('retry')">重试读取</button>
      </div>
      <p v-if="loading" role="status" class="empty-state">正在打开本地曲线库…</p>
      <div v-else-if="!items.length" class="empty-state">
        <span class="empty-bean">◒</span>
        <h3>还没有保存的曲线</h3>
        <p>回到「这一锅」，保存示例或录制一次新的练习。<br />也可以从下面导入你的曲线文件。</p>
        <button class="button secondary" @click="emit('demo')">看看示例曲线 ↗</button>
      </div>
      <ul v-else class="curve-list">
        <li v-for="curve in items" :key="curve.id">
          <div class="curve-list-main">
            <span class="curve-number">{{ date(curve.updatedAt) }}</span
            ><template v-if="renameId === curve.id"
              ><label class="sr-only" :for="`rename-${curve.id}`">新曲线名称</label
              ><input
                :id="`rename-${curve.id}`"
                v-model="renameName"
                maxlength="120"
                @keydown.enter="rename(curve)"
                @keydown.esc="renameId = ''"
              /><button class="text-button" :disabled="!renameName.trim()" @click="rename(curve)">
                确认改名</button
              ><button class="text-button" @click="renameId = ''">取消</button></template
            ><template v-else
              ><h3>{{ curve.name }}</h3>
              <p>{{ curve.notes || "尚未留下品饮笔记。" }}</p>
              <small
                >{{ formatTime(curve.samples.at(-1)?.t ?? 0) }} ·
                {{ curve.samples.length }} 个采样点 · {{ curve.markers.length }} 个事件</small
              ></template
            >
          </div>
          <div class="curve-actions">
            <button class="button secondary" @click="emit('open', curve)">打开</button
            ><button class="text-button" @click="emit('reference', curve)">作背景</button
            ><button
              class="text-button"
              @click="
                renameId = curve.id;
                renameName = curve.name;
              "
            >
              改名</button
            ><button class="text-button danger-text" @click="emit('remove', curve)">删除</button>
          </div>
        </li>
      </ul>
      <div class="import-panel">
        <div>
          <p class="eyebrow">BRING YOUR CURVE</p>
          <h3>让曲线有来有往</h3>
          <p>
            优先使用 Artisan 原生 .alog：保留原始曲线、事件与附加元数据。JSON / CSV
            是额外备份与基础交换选项。
          </p>
          <p class="small-note">
            CSV 表头：time_s,bt_c,et_c；时间为秒，温度为 °C，空温度视为缺失。至少 2 行数据；.alog /
            CSV 最大 2 MiB，含原生附件的 JSON 备份最大 8 MiB。
          </p>
        </div>
        <label class="button secondary file-button"
          >{{ reading ? "正在读取…" : "选择 Artisan .alog 文件"
          }}<input
            type="file"
            accept=".alog,.json,.csv,application/json,text/csv"
            :disabled="reading"
            @change="choose"
        /></label>
        <details class="paste-import">
          <summary>或直接粘贴数据</summary>
          <label for="import-format">数据格式</label
          ><select id="import-format" v-model="pasteFormat">
            <option value="alog">Artisan 原生 .alog</option>
            <option value="json">工作台 JSON 备份</option>
            <option value="csv">CSV</option></select
          ><label for="import-data" class="sr-only">粘贴曲线数据</label
          ><textarea
            id="import-data"
            v-model="paste"
            data-test="import-data"
            :maxlength="pasteFormat === 'json' ? MAX_JSON_TEXT_BYTES : MAX_TEXT_BYTES"
            rows="5"
            placeholder="time_s,bt_c,et_c&#10;0,180,200&#10;2,175,198"
          ></textarea
          ><button
            class="button secondary"
            data-test="preview-import"
            :disabled="!paste.trim()"
            @click="parse(paste, pasteFormat, '粘贴的数据')"
          >
            检查并预览
          </button>
        </details>
        <div v-if="importError" class="notice error" role="alert">
          {{ importError }}
        </div>
      </div>
      <p class="storage-note">
        浏览器数据可能因清理缓存或更换设备而消失。重要曲线请定期导出 .alog，并保留整库 JSON 备份。
      </p>
    </div>
    <ImportPreview
      v-if="preview"
      :curve="preview"
      :file-name="fileName"
      @cancel="cancelPreview"
      @confirm="emit('import', preview)"
    />
  </section>
</template>

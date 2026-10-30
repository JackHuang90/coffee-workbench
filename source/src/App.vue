<script setup lang="ts">
/**
 * 功能：协调曲线复盘、自动草稿、品饮计划及只读设备演示采集。
 * 首次编写日期：未知（历史代码）
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：HTTPS 页面默认直连，并在传输切换时释放旧连接。
 * - 2026-10-30：接入风味盘和导入检查弹窗标题，保留手动保存及草稿保护。
 * - 2026-10-30：连接对话框使用通用设备标题，兼容无需局域网的蓝牙入口。
 * - 2026-10-30：接入记录卡、自动草稿恢复、设备演示采集和图表定位。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useRoastStore } from "./stores/roast";
import { CurveLibrary } from "./data/library";
import {
  exportCSV,
  exportJSON,
  exportLibrary,
  upgradeCurve,
  validateCurve,
} from "./core/serialization";
import type { MarkerKind, RoastCurve } from "./core/types";
import { exportALOG } from "./core/alog";
import {
  createDeviceClient,
  defaultDeviceTransport,
  deviceAgeMs,
  deviceFresh,
} from "./core/device";
import type { DeviceTransport } from "./core/device";
import ConnectionPanel from "./components/ConnectionPanel.vue";
import ConsoleDialog from "./components/ConsoleDialog.vue";
import EventToolbar from "./components/EventToolbar.vue";
import PhaseJourney from "./components/PhaseJourney.vue";
import RoastChart from "./components/RoastChart.vue";
import WorkflowPanel from "./components/WorkflowPanel.vue";
import RoastRecord from "./components/RoastRecord.vue";
import { useDrafts } from "./composables/useDrafts";
import LibraryPanel from "./components/LibraryPanel.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import FlavorWheel from "./components/FlavorWheel.vue";

const s = useRoastStore(),
  tab = ref<"roast" | "library" | "about" | "advanced" | "connection" | "flavors">("roast"),
  mobileTab = ref("chart"),
  library = new CurveLibrary();
const inspectingImport = ref(false);
const drafts = useDrafts(s);
const draftLabel = computed(() =>
  s.dirty ? drafts.status.value : s.savedToLibrary ? "已保存到本地曲线库" : "",
);
const recoveryId = ref("");
const dataLabel = computed(() =>
  s.curve.source === "device-demo"
    ? "设备演示数据"
    : s.curve.source === "imported"
      ? "导入数据"
      : s.curve.source === "legacy" || s.curve.schemaVersion === 1
        ? "历史数据"
        : s.curve.source === "simulation"
          ? "本地仿真数据"
          : "示例模拟数据",
);

const deviceTransport = ref(defaultDeviceTransport());
const device = shallowRef(
  createDeviceClient(
    {
      onChange: (snapshot) => {
        deviceSnapshot.value = snapshot;
      },
    },
    deviceTransport.value,
  ),
);
const deviceSnapshot = ref(device.value.snapshot),
  deviceNow = ref(Date.now());
/** 功能：切换传输并清除旧连接数据，不自动探测新目标。首次编写日期：2026-10-29。变更日期：2026-10-30。修改记录：2026-10-29 首次编写；2026-10-30 切换传输前结束只读记录。 */
function changeDeviceTransport(transport: DeviceTransport) {
  if (transport === deviceTransport.value) return;
  if (s.deviceRecording) {
    s.stopRecording();
    s.logAction("切换连接方式，结束当前设备记录");
  }
  device.value.dispose();
  deviceTransport.value = transport;
  device.value = createDeviceClient(
    {
      onChange: (snapshot) => {
        deviceSnapshot.value = snapshot;
      },
    },
    transport,
  );
  deviceSnapshot.value = device.value.snapshot;
}
watch([deviceSnapshot, deviceNow], () =>
  s.appendDeviceSample(deviceSnapshot.value, deviceNow.value),
);
const deviceAge = computed(() => deviceAgeMs(deviceSnapshot.value, deviceNow.value));
const deviceIsFresh = computed(() => deviceFresh(deviceSnapshot.value, deviceNow.value));
const items = ref<RoastCurve[]>([]),
  loading = ref(false),
  saving = ref(false),
  libraryError = ref(""),
  message = ref(""),
  error = ref("");
const confirm = ref<{
  title: string;
  message: string;
  label: string;
  danger?: boolean;
  action: () => void;
} | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
let trackingTimer: ReturnType<typeof setInterval> | undefined;
watch(
  () => s.tracking.state,
  (state) => {
    clearInterval(trackingTimer);
    trackingTimer = undefined;
    if (state === "running" || state === "manual") {
      let previous = performance.now();
      trackingTimer = setInterval(() => {
        const now = performance.now(),
          dt = (now - previous) / 1000;
        previous = now;
        s.stepTracking(dt);
      }, 1000);
    }
  },
  { flush: "sync" },
);
/** 功能：切换工作台弹窗并停止回放，离开曲线库时重置预检标题。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 重置导入检查状态。 */
function setTab(value: typeof tab.value) {
  tab.value = value;
  if (value !== "library") inspectingImport.value = false;
  s.playing = false;
}
async function refresh() {
  loading.value = true;
  libraryError.value = "";
  try {
    items.value = await library.list();
  } catch (e) {
    libraryError.value = e instanceof Error ? e.message : "无法读取本地曲线库。";
  } finally {
    loading.value = false;
  }
}
function guard(action: () => void) {
  if (s.dirty) {
    s.playing = false;
    confirm.value = {
      title: "这份手记还没有保存",
      message: "继续会替换当前草稿。你可以取消，先保存或导出，再回来。",
      label: "放弃草稿并继续",
      danger: true,
      action,
    };
  } else action();
}
function start() {
  guard(() => {
    s.startRecording();
    message.value = "新记录已开始，请手动标记入豆。";
    error.value = "";
  });
}
function open(curve: RoastCurve) {
  guard(() => {
    s.openCurve(curve);
    setTab("roast");
    message.value = "已打开本地曲线。";
  });
}
function importCurve(curve: RoastCurve) {
  guard(() => {
    s.openCurve({ ...curve, id: crypto.randomUUID() }, true);
    setTab("roast");
    message.value = "已打开导入草稿，请明确保存到曲线库。";
  });
}
function loadDemo() {
  guard(() => {
    s.loadDemo();
    setTab("roast");
  });
}
/** 功能：提交正式曲线后清理对应自动草稿，保留提交期间的新编辑。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入自动草稿与操作记录。 */
async function save() {
  if (saving.value || s.recording) return;
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    const source = s.curve,
      value = s.snapshot();
    const originalId = value.id;
    value.name = value.name.trim();
    value.updatedAt = new Date().toISOString();
    if (value.id.startsWith("demo")) value.id = crypto.randomUUID();
    const checked = upgradeCurve(value);
    await library.save(checked);
    if (s.curve === source) {
      s.curve.schemaVersion = checked.schemaVersion;
      s.curve.source = checked.source;
      if (JSON.stringify(s.curve.markers) === JSON.stringify(value.markers))
        s.curve.markers = checked.markers;
      s.curve.id = checked.id;
      s.curve.updatedAt = checked.updatedAt;
      if (s.curve.name.trim() === checked.name) s.curve.name = checked.name;
      s.acceptSaved(checked);
    }
    if (!s.dirty) await drafts.remove(originalId);
    message.value = "已保存到当前浏览器的曲线库。";
    await refresh();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存失败，草稿仍保留。请导出备份后重试。";
  } finally {
    saving.value = false;
  }
}
async function rename(curve: RoastCurve, name: string) {
  error.value = "";
  try {
    await library.rename(curve.id, name);
    if (s.curve.id === curve.id && !s.dirty) {
      s.curve.name = name;
      s.acceptSaved(s.snapshot());
    }
    await refresh();
    message.value = "曲线名称已更新。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "改名失败，请重试。";
  }
}
function remove(curve: RoastCurve) {
  confirm.value = {
    title: "删除这份曲线？",
    message: `「${curve.name}」会从此浏览器永久删除。请先确认已有导出备份。`,
    label: "确认删除",
    danger: true,
    action: () => {
      void (async () => {
        try {
          await library.remove(curve.id);
          if (s.curve.id === curve.id) s.markUnsaved();
          await refresh();
          if (s.reference?.id === curve.id) s.reference = null;
          message.value = "已从本地曲线库删除。";
        } catch (e) {
          error.value = e instanceof Error ? e.message : "删除失败，请重试。";
        }
      })();
    },
  };
}
/** 功能：切换背景参考并记录采集中参考变更。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入自动草稿与操作记录。 */
function reference(curve: RoastCurve) {
  try {
    const checked = validateCurve(curve);
    if (s.recording) s.logAction(`更换参考曲线：${checked.name}`);
    s.reference = checked;
    setTab("roast");
    message.value = "已设为背景参考，不会执行其中的事件。";
  } catch (cause) {
    error.value = `此记录尚不能作为参考：${cause instanceof Error ? cause.message : "请补全有效数据"}`;
  }
}

function simulate(origin?: number) {
  if (s.trackingSession && s.tracking.state === "ready") {
    s.startTracking(origin);
    return;
  }
  guard(() => {
    s.startTracking(origin);
    message.value =
      s.tracking.state === "running" ? "闭环仿真已开始，事件仍需手动标记；没有硬件输出。" : "";
    error.value = "";
  });
}
async function backup() {
  try {
    const all = await library.list();
    const url = URL.createObjectURL(new Blob([exportLibrary(all)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "咖啡烘焙工作台-整库备份.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.value = `已导出 ${all.length} 份曲线的整库备份。`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "备份失败，请重试。";
  }
}
function download(format: "alog" | "json" | "csv") {
  error.value = "";
  try {
    const curve = validateCurve(s.snapshot());
    const native = format === "alog" ? exportALOG(curve) : null;
    const blob = new Blob(
      [native?.text ?? (format === "json" ? exportJSON(curve) : exportCSV(curve))],
      {
        type: format === "json" ? "application/json" : "text/plain;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${curve.name.replace(/[\\/:*?"<>|]/g, "-")}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.value = native?.warnings.length
      ? `已导出 .alog。${native.warnings.join("；")}`
      : "已生成导出文件。请检查浏览器下载。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "无法导出当前曲线。";
  }
}
function executeConfirm() {
  const action = confirm.value?.action;
  confirm.value = null;
  action?.();
}
/** 功能：离开前尽力暂存并保留未入库提醒。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入自动草稿与操作记录。 */
function beforeUnload(event: BeforeUnloadEvent) {
  void drafts.flush();
  if (s.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
}
/** 功能：显式恢复草稿，恢复时保持所有运行状态停止。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function recover() {
  const draft =
    drafts.pending.value.find((c) => c.id === recoveryId.value) ?? drafts.pending.value[0];
  if (draft)
    guard(() => {
      s.restoreDraft(draft);
      drafts.pending.value = drafts.pending.value.filter((c) => c.id !== draft.id);
      message.value = "已恢复记录；录制保持停止，中断期间未补录。";
    });
}
/** 功能：开始只读设备采集，仍通过草稿替换保护。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function startDevice() {
  guard(() => {
    if (s.startDeviceRecording(deviceSnapshot.value))
      message.value = "正在记录设备演示数据，不发送控制指令。";
  });
}
/** 功能：从差异或事件卡定位到主图局部区间。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function locate(kind: MarkerKind) {
  const marker = s.curve.markers.find((m) => m.kind === kind);
  if (!marker) return;
  s.chartWindow = { start: Math.max(0, marker.t - 90), end: marker.t + 90 };
  setTab("roast");
  mobileTab.value = "chart";
  if (!s.recording) s.cursor = s.curve.samples.at(-1)?.t ?? s.cursor;
}
watch(
  () => s.recording,
  (value, previous) => {
    if (previous && !value && s.curve.samples.length > 1) {
      void drafts.flush();
      message.value = "记录已结束，可以查看本锅记录、补充重量和品饮。";
    }
  },
);
onMounted(() => {
  void refresh();
  timer = setInterval(() => {
    s.tick();
    deviceNow.value = Date.now();
  }, 2000);
  window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  clearInterval(trackingTimer);
  s.stopTracking();
  library.close();
  device.value.dispose();
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>
<template>
  <div class="app-shell">
    <a class="skip-link" href="#main">跳至内容</a>
    <header class="site-header" :inert="tab !== 'roast' || !!confirm">
      <a class="brand" href="#main" aria-label="咖啡烘焙工作台首页" @click.prevent="setTab('roast')"
        ><span class="brand-bean bean-texture bean-dark" aria-hidden="true"></span>
        <h1>咖啡烘焙工作台</h1> </a
      ><span class="demo-badge"
        ><i></i
        >{{
          dataLabel + (deviceSnapshot.state === "connected" ? " · 已连接只读设备" : " · 未连接设备")
        }}</span
      ><button
        class="device-status connection-button"
        data-test="connection"
        @click="setTab('connection')"
      >
        {{
          deviceSnapshot.state === "connected"
            ? deviceIsFresh
              ? "● ESP32 只读"
              : "◌ ESP32 数据过期"
            : deviceSnapshot.state === "lost"
              ? "⚠ 设备连接中断"
              : "连接 ESP32"
        }}</button
      ><label class="curve-name"
        ><span class="sr-only">曲线名称</span
        ><input v-model="s.curve.name" data-test="name" aria-label="曲线名称" maxlength="120"
      /></label>
      <nav aria-label="工作台工具">
        <button data-test="nav-library" @click="setTab('library')"><span>▤</span> 曲线库</button
        ><button data-test="flavors" @click="setTab('flavors')">
          <span aria-hidden="true">◌</span> 风味盘</button
        ><button data-test="advanced" @click="setTab('advanced')"><span>✎</span> 本锅记录</button
        ><button aria-label="工作台设置与说明" @click="setTab('about')">⚙ <span>设置</span></button>
      </nav>
    </header>
    <main id="main" :inert="tab !== 'roast' || !!confirm">
      <div v-if="drafts.pending.value.length" class="recovery-bar" role="status">
        <div>
          <strong>有上次自动暂存的记录</strong><span>恢复后保持停止，不会自动继续录制。</span>
        </div>
        <select
          v-if="drafts.pending.value.length > 1"
          v-model="recoveryId"
          aria-label="选择恢复草稿"
        >
          <option value="">最近一份草稿</option>
          <option v-for="draft in drafts.pending.value" :key="draft.id" :value="draft.id">
            {{ draft.name || "未命名记录" }}
          </option></select
        ><button class="button primary" data-test="recover-draft" @click="recover">恢复记录</button
        ><button class="text-button" @click="drafts.pending.value = []">稍后处理</button>
      </div>
      <div v-if="drafts.failure.value" class="draft-error" role="alert">
        {{ drafts.failure.value }}<button @click="drafts.flush">重试暂存</button>
      </div>
      <PhaseJourney />
      <div class="mobile-tabs" role="tablist" aria-label="工作区面板">
        <button role="tab" :aria-selected="mobileTab === 'chart'" @click="mobileTab = 'chart'">
          曲线与事件</button
        ><button
          role="tab"
          :aria-selected="mobileTab === 'tracking'"
          @click="mobileTab = 'tracking'"
        >
          复盘与记录
        </button>
      </div>
      <div :class="['workspace', `mobile-${mobileTab}`]">
        <div class="chart-column">
          <RoastChart />
          <EventToolbar />
        </div>
        <WorkflowPanel
          :items="items"
          :device="deviceSnapshot"
          :fresh="deviceIsFresh"
          :draft-status="draftLabel"
          @start="start"
          @simulate="simulate"
          @reference="reference"
          @record="setTab('advanced')"
          @connect="setTab('connection')"
          @device-start="startDevice"
          @library="setTab('library')"
        />
      </div>
    </main>
    <footer class="console-footer" :inert="tab !== 'roast' || !!confirm">
      <span class="footer-status"><i></i>无硬件输出 · 事件由你确认</span
      ><span :class="['save-state', { unsaved: s.dirty }]">{{
        s.dirty ? drafts.status.value || "未保存" : s.savedToLibrary ? "已保存" : "示例 · 未入库"
      }}</span
      ><button
        class="text-button"
        :disabled="s.recording || s.curve.samples.length < 2"
        data-test="export-alog"
        @click="download('alog')"
      >
        ↓ Artisan .alog
      </button>
      <details class="extra-exports">
        <summary>其他导出</summary>
        <div>
          <button
            class="text-button"
            :disabled="s.recording || s.curve.samples.length < 2"
            @click="download('json')"
          >
            JSON 备份</button
          ><button
            class="text-button"
            :disabled="s.recording || s.curve.samples.length < 2"
            @click="download('csv')"
          >
            CSV 数值
          </button>
        </div>
      </details>
      <button
        data-test="save"
        class="button primary"
        :disabled="saving || s.recording || s.curve.samples.length < 2 || !s.curve.name.trim()"
        @click="save"
      >
        {{ saving ? "正在保存…" : "保存本锅" }}
      </button>
    </footer>
    <div v-if="message" class="toast notice success" role="status">
      <span>{{ message }}</span
      ><button class="dismiss" aria-label="关闭提示" @click="message = ''">×</button>
    </div>
    <div v-if="error && tab !== 'flavors'" class="toast notice error" role="alert">
      <span>{{ error }}</span
      ><button class="dismiss" aria-label="关闭错误提示" @click="error = ''">×</button>
    </div>
    <ConsoleDialog
      v-if="tab === 'library'"
      :inert="!!confirm"
      :title="inspectingImport ? '曲线导入检查' : '本地曲线库'"
      wide
      @close="setTab('roast')"
    >
      <div v-show="!inspectingImport" class="library-topline">
        <p>仅保存在当前浏览器，请定期备份。</p>
        <button class="button secondary" @click="backup">↓ 导出整库备份</button>
      </div>
      <LibraryPanel
        :items="items"
        :loading="loading"
        :error="libraryError"
        @preview-state="inspectingImport = $event"
        @retry="refresh"
        @open="open"
        @reference="reference"
        @remove="remove"
        @rename="rename"
        @import="importCurve"
        @demo="loadDemo"
      />
    </ConsoleDialog>
    <ConsoleDialog v-if="tab === 'flavors'" title="这一锅的风味盘" wide @close="setTab('roast')">
      <FlavorWheel
        :model-value="s.curve.flavorTags ?? []"
        @update:model-value="s.curve.flavorTags = $event"
      />
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <div class="flavor-save-row">
        <span class="small-note"
          >{{
            s.dirty
              ? "当前曲线有未保存的修改"
              : s.savedToLibrary
                ? "已保存到本地曲线库"
                : "当前为示例曲线"
          }}
          · {{ s.curve.name }}</span
        ><button
          class="button primary"
          data-test="save-flavors"
          :disabled="saving || s.recording || s.curve.samples.length < 2 || !s.curve.name.trim()"
          @click="save"
        >
          {{ saving ? "正在保存…" : "保存风味与曲线" }}
        </button>
      </div>
    </ConsoleDialog>
    <ConsoleDialog v-if="tab === 'advanced'" title="这一锅的记录" wide @close="setTab('roast')">
      <RoastRecord
        :saving="saving"
        :error="error"
        :items="items"
        :draft-status="draftLabel"
        @save="save"
        @locate="locate"
        @reference="reference"
        @export="download('json')"
      />
    </ConsoleDialog>
    <ConsoleDialog v-if="tab === 'connection'" title="连接 ESP32-S3" @close="setTab('roast')"
      ><ConnectionPanel
        :client="device"
        :transport="deviceTransport"
        :snapshot="deviceSnapshot"
        :age-ms="deviceAge"
        :fresh="deviceIsFresh"
        @transport="changeDeviceTransport"
    /></ConsoleDialog>
    <ConsoleDialog v-if="tab === 'about'" title="设置与工作台说明" @close="setTab('roast')">
      <div class="settings-content">
        <h3>先观察，再判断</h3>
        <p>
          咖啡烘焙工作台用于记录、回放和离线闭环仿真。HTTPS 网站可在浏览器允许时通过 Wi-Fi 只读直连
          ESP32-S3，也保留本地桥接兼容方式；可在“记录”模式采集设备演示遥测到主图，过期样本不写入。现有固件没有物理执行器绑定，不提供实机烘焙控制。
        </p>
        <h3>两种模拟，明确区分</h3>
        <p>
          曲线回放只展示已有数据；闭环仿真由 PID
          输出驱动独立热惯性模型，不会照抄目标曲线。仿真不代表设备性能，也不是实际烘焙参数建议。
        </p>
        <h3>事件与升温率</h3>
        <p>
          入豆、脱水结束、一爆开始与出豆定义三个阶段。回温点候选需要人工确认；不按通用温度自动识别脱水或爆裂。升温率与短期趋势使用
          30 秒连续窗口；按采样中位间隔判断缺口，缺失数据不连线。趋势最多预测 60
          秒，与目标曲线独立，仅供观察，不反馈给 PID。
        </p>
        <h3>兼容与备份</h3>
        <p>
          历史版本 1 只读加载，点击保存才升级为版本 2，保留原始样本、标识、笔记和事件。Artisan 原生
          .alog 可导入、保留元数据并导出；未修改导入文件保留原文，第三方新建/编辑文件可能出现
          Artisan 来源警告。JSON 用作手记/整库备份；CSV 仅交换 time_s,bt_c,et_c
          数值列。原生附件在显式保存时一同保存，不破坏旧记录。
        </p>
        <button class="button secondary" @click="backup">导出整库备份</button>
        <p class="small-note">所有数据仅保存在当前浏览器，没有服务器数据库或跨设备同步。</p>
      </div>
    </ConsoleDialog>
    <ConfirmDialog
      v-if="confirm"
      :title="confirm.title"
      :message="confirm.message"
      :confirm-label="confirm.label"
      :danger="confirm.danger"
      @cancel="confirm = null"
      @confirm="executeConfirm"
    />
  </div>
</template>

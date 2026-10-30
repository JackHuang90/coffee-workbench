/** 功能：管理曲线、仿真、只读设备记录与安全恢复。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 增加操作日志、参考快照和设备演示采集，恢复不自动运行。 */
import { computed, ref, watch } from "vue";
import { emptyJournal, localDate, snapshotReference } from "../core/journal";
import { deviceFresh } from "../core/device";
import type { DeviceSnapshot } from "../core/device";
import { TrackingController } from "../core/tracking";
import { displayGapSeconds } from "../core/trend";
import { defineStore } from "pinia";
import { createDemoCurve, phaseAt } from "../core/simulation";
import { upgradeCurve, validateCurve } from "../core/serialization";
import {
  eventOrder,
  eventLabels,
  interpolateSample,
  turningPointCandidate,
  validEventSequence,
} from "../core/events";
import type { MarkerKind, RoastCurve } from "../core/types";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const signature = (curve: RoastCurve) =>
  JSON.stringify({ ...curve, updatedAt: "" }, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
export const useRoastStore = defineStore("roast", () => {
  const curve = ref(createDemoCurve()),
    cursor = ref(522),
    playing = ref(false),
    recording = ref(false),
    speed = ref(1);
  const savedToLibrary = ref(false);
  const deviceRecording = ref(false);
  const workspaceMode = ref<"review" | "practice" | "record">("review");
  const alignment = ref<"CHARGE" | "FCs">("CHARGE");
  const chartWindow = ref<{ start: number; end: number } | null>(null);
  let deviceOrigin = 0,
    deviceLast = 0,
    deviceSession = 0;
  const deviceInterrupted = ref(false);
  let deviceIdentity = "";
  const baseline = ref(signature(curve.value)),
    reference = ref<RoastCurve | null>(createDemoCurve());
  const controller = new TrackingController();
  const tracking = ref(controller.snapshot);
  const trackingSession = ref(false);
  const trackingActive = computed(
    () => ["ready", "running", "manual"].includes(tracking.value.state) && trackingSession.value,
  );
  watch(reference, () => stopTracking(), { flush: "sync", deep: true });
  const referenceSamples = computed(() => {
    const currentOrigin = trackingSession.value
      ? 0
      : (curve.value.markers.find((m) => m.kind === alignment.value)?.t ??
        curve.value.samples[0]?.t ??
        0);
    const targetOrigin =
      reference.value?.markers.find(
        (m) => m.kind === (trackingSession.value ? "CHARGE" : alignment.value),
      )?.t ??
      reference.value?.samples[0]?.t ??
      0;
    return (reference.value?.samples ?? []).map((sample) => ({
      ...sample,
      t: sample.t + currentOrigin - targetOrigin,
    }));
  });
  const dirty = computed(() => signature(curve.value) !== baseline.value);
  const duration = computed(() =>
    trackingSession.value
      ? tracking.value.duration
      : recording.value && !deviceRecording.value
        ? 600
        : (curve.value.samples.at(-1)?.t ?? 0),
  );
  const samples = computed(() => curve.value.samples.filter((p) => p.t <= cursor.value));
  const current = computed(() => {
    if (deviceRecording.value && deviceInterrupted.value) return undefined;
    const last = samples.value.at(-1);
    return last && cursor.value - last.t <= displayGapSeconds(samples.value) ? last : undefined;
  });
  const phase = computed(() => phaseAt(curve.value.markers, cursor.value));
  function snapshot() {
    return clone(curve.value);
  }
  /** 功能：打开记录并清除先前采集与局部图表状态。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function openCurve(value: RoastCurve, asDraft = false) {
    stopTracking();
    deviceRecording.value = false;
    chartWindow.value = null;
    savedToLibrary.value = !asDraft && !value.id.startsWith("demo");
    curve.value = clone(value);
    baseline.value = asDraft ? "" : signature(value);
    cursor.value = value.samples.at(-1)?.t ?? 0;
    playing.value = false;
    recording.value = false;
  }
  function acceptSaved(value: RoastCurve) {
    baseline.value = signature(value);
    savedToLibrary.value = true;
  }
  function markUnsaved() {
    baseline.value = "";
    savedToLibrary.value = false;
  }
  function resetPlayback() {
    stopTracking();
    playing.value = false;
    cursor.value = curve.value.samples[0]?.t ?? 0;
  }
  function togglePlayback() {
    if (trackingActive.value) return;
    if (cursor.value >= duration.value) cursor.value = curve.value.samples[0]?.t ?? 0;
    playing.value = !playing.value;
  }
  /** 功能：推进本地回放或模拟采样，设备记录由独立遥测驱动。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function tick() {
    if (deviceRecording.value) return;
    if (trackingActive.value) return;
    if (!playing.value) return;
    cursor.value = Math.min(duration.value, cursor.value + 2 * speed.value);
    if (recording.value) {
      const last = curve.value.samples.at(-1)?.t ?? -1;
      curve.value.samples.push(
        ...createDemoCurve().samples.filter((p) => p.t > last && p.t <= cursor.value),
      );
    }
    if (cursor.value >= duration.value) {
      playing.value = false;
      recording.value = false;
    }
  }
  /** 功能：开始模拟记录，建立操作日志与参考快照。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function startRecording() {
    stopTracking();
    const demo = createDemoCurve(),
      now = new Date().toISOString();
    curve.value = {
      ...demo,
      schemaVersion: 2,
      source: "simulation",
      id: crypto.randomUUID(),
      name: "我的烘焙手记",
      notes: "",
      createdAt: now,
      updatedAt: now,
      samples: [clone(demo.samples[0]!)],
      markers: [],
    };
    baseline.value = "";
    savedToLibrary.value = false;
    cursor.value = 0;
    playing.value = true;
    recording.value = true;
    deviceRecording.value = false;
    workspaceMode.value = "practice";
    beginJournal("开始模拟记录");
  }
  /** 功能：停止采样并记下结束操作，保留已采集曲线。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function stopRecording() {
    if (recording.value) logAction("停止记录，保留已采集数据");
    deviceRecording.value = false;
    if (trackingSession.value) stopTracking();
    playing.value = false;
    recording.value = false;
  }
  /** 功能：校验事件顺序和采集有效性，数据中断时拒绝标记。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function canMark(kind: MarkerKind) {
    if (deviceRecording.value && deviceInterrupted.value) return false;
    if (!recording.value || curve.value.markers.some((m) => m.kind === kind)) return false;
    const required: Partial<Record<MarkerKind, MarkerKind>> = {
      TP: "CHARGE",
      DRY: "CHARGE",
      FCs: "DRY",
      FCe: "FCs",
      SCs: "FCs",
      SCe: "SCs",
      DROP: "CHARGE",
      COOL: "DROP",
    };
    if (required[kind] && !curve.value.markers.some((m) => m.kind === required[kind])) return false;
    return validEventSequence([...curve.value.markers, { kind, t: cursor.value }]);
  }
  function eventAt(kind: MarkerKind, t: number) {
    const value = interpolateSample(curve.value.samples, t);
    return {
      kind,
      t,
      bt: value?.bt ?? null,
      source: "manual" as const,
      temperatureSource: value?.bt != null ? value.basis : ("unavailable" as const),
    };
  }
  /** 功能：写入人工确认事件及其操作日志。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function mark(kind: MarkerKind) {
    if (!canMark(kind)) return false;
    curve.value.markers.push(eventAt(kind, cursor.value));
    logAction(`标记事件：${eventLabels[kind]}`);
    return true;
  }
  function confirmTurningPoint(t: number) {
    const charge = curve.value.markers.find((m) => m.kind === "CHARGE");
    if (
      !recording.value ||
      !charge ||
      curve.value.markers.some((m) => m.kind === "TP") ||
      turningPointCandidate(samples.value, charge.t)?.t !== t
    )
      return false;
    const next = [...curve.value.markers, eventAt("TP", t)].sort(
      (a, b) => eventOrder.indexOf(a.kind) - eventOrder.indexOf(b.kind),
    );
    if (!validEventSequence(next)) return false;
    curve.value.markers = next;
    return true;
  }
  /** 功能：撤销最后一个事件并保留修正日志。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function undoMarker() {
    if (!curve.value.markers.length) return false;
    const removed = curve.value.markers.pop();
    logAction(`撤销事件：${removed ? eventLabels[removed.kind] : ""}`);
    return true;
  }
  /** 功能：校验并修正事件时间，记录修正事实。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function editMarker(kind: MarkerKind, t: number) {
    if (
      !Number.isFinite(t) ||
      t < (curve.value.samples[0]?.t ?? 0) ||
      t > (curve.value.samples.at(-1)?.t ?? 0)
    )
      return false;
    if (!curve.value.markers.some((m) => m.kind === kind)) return false;
    const editable = curve.value.schemaVersion === 1 ? upgradeCurve(curve.value) : curve.value;
    const next = editable.markers.map((m) => (m.kind === kind ? eventAt(kind, t) : m));
    if (!validEventSequence(next)) return false;
    curve.value.schemaVersion = editable.schemaVersion;
    curve.value.source = editable.source;
    curve.value.markers = next;
    logAction(`修正事件：${eventLabels[kind]} → ${t.toFixed(1)} 秒`);
    return true;
  }
  /** 功能：开始闭环仿真并冻结参考，避免与设备采集混用。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function startTracking(origin?: number) {
    if (trackingSession.value && tracking.value.state === "ready") {
      tracking.value = controller.start();
      recording.value = true;
      return true;
    }
    const target = reference.value;
    if (!target) return false;
    const aligned = origin ?? target.markers.find((m) => m.kind === "CHARGE")?.t;
    tracking.value = controller.prepare(target.samples, aligned);
    if (tracking.value.state !== "ready") return false;
    const now = new Date().toISOString();
    curve.value = {
      schemaVersion: 2,
      source: "simulation",
      id: crypto.randomUUID(),
      name: "曲线跟踪仿真",
      notes: "独立热惯性模型与 PID 闭环仿真，非设备读数。",
      createdAt: now,
      updatedAt: now,
      samples: clone(tracking.value.samples),
      markers: [],
    };
    baseline.value = "";
    savedToLibrary.value = false;
    cursor.value = 0;
    playing.value = false;
    recording.value = true;
    trackingSession.value = true;
    tracking.value = controller.start();
    deviceRecording.value = false;
    workspaceMode.value = "practice";
    beginJournal("开始闭环仿真");
    return true;
  }
  function stepTracking(dt: number) {
    if (!trackingSession.value || !["running", "manual"].includes(tracking.value.state)) return;
    tracking.value = controller.step(dt);
    curve.value.samples = clone(tracking.value.samples);
    cursor.value = tracking.value.elapsed;
    if (["completed", "fault", "idle"].includes(tracking.value.state)) recording.value = false;
  }
  /** 功能：暂停仿真并记录操作。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function pauseTracking() {
    tracking.value = controller.pause();
    logAction("暂停仿真");
  }
  /** 功能：清零仿真输出并记录结束。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function stopTracking() {
    if (trackingSession.value) logAction("停止仿真");
    tracking.value = controller.stop();
    if (trackingSession.value) recording.value = false;
    trackingSession.value = false;
  }
  /** 功能：手动接管仿真并记录操作。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function takeManual() {
    tracking.value = controller.takeManual();
    logAction("手动接管仿真");
  }
  /** 功能：调整模拟加热请求并记入日志。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 接入记录卡与安全恢复工作流。 */
  function manualOutput(value: number) {
    tracking.value = controller.setManualOutput(value);
    logAction(`手动模拟加热请求：${tracking.value.output.toFixed(0)}%`);
  }
  function loadDemo() {
    openCurve(createDemoCurve());
    cursor.value = 522;
  }
  /** 功能：创建记录卡并冻结开始时参考。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  function beginJournal(text: string) {
    let frozenReference: RoastCurve | undefined;
    let referenceError = false;
    if (reference.value) {
      try {
        frozenReference = snapshotReference(validateCurve(reference.value));
      } catch {
        referenceError = true;
      }
    }
    curve.value.journal = {
      ...emptyJournal(),
      roastDate: localDate(),
      ...(frozenReference ? { reference: frozenReference } : {}),
    };
    chartWindow.value = null;
    logAction(text);
    if (referenceError) logAction("参考记录尚不完整，未保存参考快照；本锅记录可正常保存");
  }

  /** 功能：追加带时间的操作事实，超过上限保留首尾可追溯性。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  function logAction(text: string) {
    const journal = curve.value.journal ?? (curve.value.journal = emptyJournal());
    if (journal.actions.length >= 1000) journal.actions.splice(1, 1);
    journal.actions.push({ t: cursor.value, at: new Date().toISOString(), text });
  }
  /** 功能：恢复为静态草稿，不恢复连接、录制或仿真状态。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  function restoreDraft(value: RoastCurve) {
    openCurve(value, true);
    workspaceMode.value = "review";
    if (value.journal?.reference) reference.value = clone(value.journal.reference);
    logAction("从自动暂存恢复；录制已结束，中断期间未补录");
  }
  /** 功能：从有效设备演示样本开始只读采集。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  function startDeviceRecording(snapshot: DeviceSnapshot, now = Date.now()) {
    const status = snapshot.status;
    if (!deviceFresh(snapshot, now) || !status?.sensor_valid || status.source !== "virtual_demo")
      return false;
    stopTracking();
    const date = new Date().toISOString();
    curve.value = {
      schemaVersion: 2,
      source: "device-demo",
      id: crypto.randomUUID(),
      name: "设备演示记录",
      notes: "设备虚拟演示温度，非实机测量。",
      createdAt: date,
      updatedAt: date,
      samples: [{ t: 0, bt: status.bt, et: status.et }],
      markers: [],
    };
    cursor.value = 0;
    baseline.value = "";
    savedToLibrary.value = false;
    playing.value = false;
    recording.value = true;
    deviceRecording.value = true;
    deviceOrigin = status.uptime_ms;
    deviceLast = status.uptime_ms;
    deviceSession = status.session;
    deviceIdentity = snapshot.ip ?? snapshot.deviceName ?? "";
    deviceInterrupted.value = false;
    workspaceMode.value = "record";
    beginJournal("开始只读设备演示采集");
    return true;
  }
  /** 功能：仅追加新的有效遥测，缺失留断点，设备重置或会话变化停止采集。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  function appendDeviceSample(snapshot: DeviceSnapshot, now = Date.now()) {
    if (!deviceRecording.value) return;
    const status = snapshot.status;
    if (!deviceFresh(snapshot, now) || !status?.sensor_valid || status.source !== "virtual_demo") {
      if (!deviceInterrupted.value) {
        logAction("设备数据中断或过期，等待新的有效采样");
        deviceInterrupted.value = true;
      }
      return;
    }
    if (
      status.uptime_ms < deviceLast ||
      status.session !== deviceSession ||
      (snapshot.ip ?? snapshot.deviceName ?? "") !== deviceIdentity
    ) {
      stopRecording();
      logAction("设备时钟重置、设备或会话改变，已结束记录");
      return;
    }
    if (status.uptime_ms === deviceLast) return;
    const t = (status.uptime_ms - deviceOrigin) / 1000;
    if (t > 86400 || curve.value.samples.length >= 14998) {
      stopRecording();
      logAction("达到记录容量上限，已结束记录");
      return;
    }
    const lastT = curve.value.samples.at(-1)!.t;
    if (deviceInterrupted.value || status.uptime_ms - deviceLast > 3000) {
      curve.value.samples.push({ t: (lastT + t) / 2, bt: null, et: null });
      logAction("收到新采样；中断区间保留缺口，未补录");
    }
    curve.value.samples.push({ t, bt: status.bt, et: status.et });
    cursor.value = t;
    deviceLast = status.uptime_ms;
    deviceInterrupted.value = false;
  }
  return {
    deviceRecording,
    deviceInterrupted,
    workspaceMode,
    alignment,
    chartWindow,
    logAction,
    restoreDraft,
    startDeviceRecording,
    appendDeviceSample,
    tracking,
    trackingActive,
    trackingSession,
    startTracking,
    stepTracking,
    pauseTracking,
    stopTracking,
    takeManual,
    manualOutput,
    curve,
    savedToLibrary,
    cursor,
    playing,
    recording,
    speed,
    reference,
    referenceSamples,
    dirty,
    duration,
    samples,
    current,
    phase,
    snapshot,
    openCurve,
    acceptSaved,
    markUnsaved,
    resetPlayback,
    togglePlayback,
    tick,
    startRecording,
    stopRecording,
    mark,
    canMark,
    undoMarker,
    editMarker,
    confirmTurningPoint,
    loadDemo,
  };
});

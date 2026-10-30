/** 功能：记录卡校验、完成阶段指标和两锅事实比较。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import type { RoastCurve, RoastJournal, MarkerKind } from "./types";
import { interpolateSample } from "./events";
import { displayGapSeconds } from "./trend";

/** 功能：生成本地日历日期，不把 UTC 跨日误当烘焙日。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** 功能：提供未填写记录卡，避免把导入时间冒充烘焙日期。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function emptyJournal(): RoastJournal {
  return { bean: "", machine: "", roastDate: "", tastings: [], actions: [] };
}
/** 功能：创建无递归元数据的独立参考快照。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function snapshotReference(curve: RoastCurve): RoastCurve {
  const copy: RoastCurve = JSON.parse(JSON.stringify(curve));
  delete copy.journal;
  delete copy.nativeArtisan;
  return copy;
}
/** 功能：严格校验可移植记录卡，限制长度、数量和嵌套。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function validateJournal(
  input: unknown,
  checkCurve: (value: unknown) => RoastCurve,
): RoastJournal {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("记录卡须为对象");
    return value as Record<string, unknown>;
  };
  const text = (value: unknown, max: number): string => {
    if (typeof value !== "string" || value.length > max)
      throw new Error(`记录卡文本最多 ${max} 字符`);
    return value;
  };
  const date = (value: unknown, optional = false): string => {
    const v = text(value, 10);
    if (optional && !v) return v;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v
    )
      throw new Error("记录卡日期无效");
    return v;
  };
  const list = (value: unknown, max: number): unknown[] => {
    if (!Array.isArray(value) || value.length > max) throw new Error(`记录卡列表最多 ${max} 项`);
    return value;
  };
  const source = object(input);
  const result: RoastJournal = {
    bean: text(source.bean, 120),
    machine: text(source.machine, 120),
    roastDate: date(source.roastDate, true),
    tastings: list(source.tastings, 100).map((value) => {
      const t = object(value);
      const id = text(t.id, 128);
      if (!id.trim()) throw new Error("品饮记录标识不可为空");
      return { id, date: date(t.date), method: text(t.method, 200), notes: text(t.notes, 2000) };
    }),
    actions: list(source.actions, 1000).map((value) => {
      const a = object(value);
      if (typeof a.t !== "number" || !Number.isFinite(a.t) || a.t < 0 || a.t > 86400)
        throw new Error("操作时间无效");
      const at = text(a.at, 40);
      if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at)))
        throw new Error("操作日期无效");
      return { t: a.t, at, text: text(a.text, 300) };
    }),
  };
  if (new Set(result.tastings.map((t) => t.id)).size !== result.tastings.length)
    throw new Error("品饮记录标识重复");
  if (source.experiment !== undefined) {
    const e = object(source.experiment);
    result.experiment = {
      goal: text(e.goal, 500),
      change: text(e.change, 500),
      keep: text(e.keep, 500),
    };
  }
  if (source.reference !== undefined) {
    const r = object(source.reference);
    if (r.journal !== undefined || r.nativeArtisan !== undefined)
      throw new Error("参考快照不可包含嵌套记录卡或原生附件");
    result.reference = checkCurve(r);
  }
  return result;
}
/** 功能：仅用确认边界计算最终指标；缺失值保持为空。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function summarizeRoast(curve: RoastCurve) {
  const marker = (kind: MarkerKind) => curve.markers.find((m) => m.kind === kind);
  const seconds = (a: MarkerKind, b: MarkerKind) => {
    const start = marker(a)?.t,
      end = marker(b)?.t;
    return start !== undefined && end !== undefined && end >= start ? end - start : null;
  };
  const elapsed = seconds("CHARGE", "DROP"),
    development = seconds("FCs", "DROP");
  const drop = marker("DROP");
  return {
    elapsed,
    development,
    drying: seconds("CHARGE", "DRY"),
    browning: seconds("DRY", "FCs"),
    firstCrack: seconds("CHARGE", "FCs"),
    dtr: elapsed && development !== null ? (development / elapsed) * 100 : null,
    dropBT: drop ? (drop.bt ?? interpolateSample(curve.samples, drop.t)?.bt ?? null) : null,
    loss:
      curve.inputWeight && curve.outputWeight && curve.outputWeight <= curve.inputWeight
        ? (1 - curve.outputWeight / curve.inputWeight) * 100
        : null,
  };
}
/** 功能：返回两锅指标及差值，事件时差始终相对各自入豆计算。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function compareRoasts(current: RoastCurve, reference: RoastCurve) {
  const a = summarizeRoast(current),
    b = summarizeRoast(reference);
  return (
    [
      { key: "firstCrack", label: "一爆时间", unit: "秒", marker: "FCs" },
      { key: "development", label: "发展时长", unit: "秒", marker: "DROP" },
      { key: "dropBT", label: "出豆温度", unit: "°C", marker: "DROP" },
      { key: "loss", label: "失重率", unit: "百分点", marker: "DROP" },
    ] as const
  ).map((row) => ({
    ...row,
    current: a[row.key],
    reference: b[row.key],
    delta: a[row.key] !== null && b[row.key] !== null ? a[row.key]! - b[row.key]! : null,
  }));
}
/** 功能：按连续 20 秒有效样本解释绝对偏差走势，不提供控制建议。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function deviationTrend(
  current: RoastCurve["samples"],
  reference: RoastCurve["samples"],
  cursor: number,
): string {
  const points = current.filter((p) => p.t >= cursor - 20 && p.t <= cursor);
  const gap = displayGapSeconds(current);
  if (points.length < 3 || points.at(-1)!.t - points[0].t < 18 || cursor - points.at(-1)!.t > gap)
    return "连续数据不足，暂不判断";
  const referenceWindow = reference.filter((p) => p.t >= points[0].t && p.t <= cursor);
  const referenceGap = displayGapSeconds(reference);
  if (
    referenceWindow.some(
      (p, i) => p.bt === null || (i > 0 && p.t - referenceWindow[i - 1].t > referenceGap),
    )
  )
    return "参考存在缺测，暂不判断";
  const errors: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      target = interpolateSample(reference, p.t)?.bt;
    if (p.bt === null || target == null || (i > 0 && p.t - points[i - 1].t > gap))
      return "存在缺测，暂不判断";
    errors.push(Math.abs(p.bt - target));
  }
  const delta = errors.at(-1)! - errors[0];
  return delta < -0.5
    ? "过去 20 秒正在追近参考"
    : delta > 0.5
      ? "过去 20 秒偏差正在扩大"
      : "过去 20 秒偏差相对稳定";
}

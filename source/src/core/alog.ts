/** 功能：安全解析和保留 Artisan 原生曲线。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 使用独立扩展字段往返工作台风味标签。 */
import type { Marker, MarkerKind, NativeArtisanAttachment, RoastCurve, Sample } from "./types";
import { validateFlavorTags } from "./flavors";
import { fromValue, parsePythonLiteral, writePythonLiteral } from "./pythonLiteral";
import type { DictLiteral, Literal } from "./pythonLiteral";

const MARKERS: MarkerKind[] = ["CHARGE", "DRY", "FCs", "FCe", "SCs", "SCe", "DROP", "COOL"];
const MAX_SAMPLES = 15000;
export const EVENT_ASSOCIATION_TOLERANCE_SECONDS = 0.5;
// Keep the producer release honest; this matches package.json, not an Artisan version.
const GENERATOR_VERSION = "0.1.0";
const CONTROL_FIELDS = [
  "externalprogram",
  "externaloutprogram",
  "backgroundpath",
  "alarmaction",
  "alarmstrings",
  "pidcontrol",
  "PID",
  "eventbuttonaction",
  "eventbuttoncommand",
  "eventslideraction",
  "eventslidercommand",
];
const get = (doc: DictLiteral, key: string) =>
  doc.entries.find((entry) => entry.key === key)?.value;
const set = (doc: DictLiteral, key: string, value: Literal) => {
  const entry = doc.entries.find((entry) => entry.key === key);
  if (entry) entry.value = value;
  else doc.entries.push({ key, value });
};
const remove = (doc: DictLiteral, key: string) => {
  doc.entries = doc.entries.filter((entry) => entry.key !== key);
};
const array = (node: Literal | undefined, field: string): Literal[] => {
  if (!node || (node.kind !== "list" && node.kind !== "tuple"))
    throw new Error(`ALOG ${field}: 须为列表或元组`);
  return node.items;
};
const number = (node: Literal | undefined, field: string): number => {
  if (!node || node.kind !== "number" || !Number.isFinite(Number(node.raw)))
    throw new Error(`ALOG ${field}: 须为有限数值，不能为布尔或文本`);
  return Number(node.raw);
};
const text = (node: Literal | undefined): string | null =>
  node?.kind === "string" ? node.value : null;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Apply exactly one Artisan unicode_escape layer to known display fields only. */
export function decodeArtisanText(value: string): string {
  return value.replace(
    /\\(?:U[\da-fA-F]{8}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|[0-7]{1,3}|[\\'"abfnrtv])/g,
    (match) => {
      const code = match[1];
      const simple: Record<string, string> = {
        "\\": "\\",
        "'": "'",
        '"': '"',
        a: "\x07",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
      };
      if (Object.hasOwn(simple, code)) return simple[code];
      const n = parseInt(
        match.slice(code === "u" || code === "U" || code === "x" ? 2 : 1),
        /[uUx]/.test(code) ? 16 : 8,
      );
      return n <= 0x10ffff ? String.fromCodePoint(n) : match;
    },
  );
}
export function encodeArtisanText(value: string): string {
  let result = "";
  for (const ch of value) {
    const n = ch.codePointAt(0)!;
    if (ch === "\\") result += "\\\\";
    else if (ch === "\n") result += "\\n";
    else if (ch === "\r") result += "\\r";
    else if (ch === "\t") result += "\\t";
    else if (n < 32 || n > 126)
      result +=
        n <= 255
          ? `\\x${n.toString(16).padStart(2, "0")}`
          : n <= 65535
            ? `\\u${n.toString(16).padStart(4, "0")}`
            : `\\U${n.toString(16).padStart(8, "0")}`;
    else result += ch;
  }
  return result;
}
/** 功能：投影原生温度、事件和已知附加字段，保留原始时间基准。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 读取工作台风味扩展。 */
function projection(doc: DictLiteral) {
  const mode = text(get(doc, "mode"));
  if (mode !== "C" && mode !== "F") throw new Error("ALOG mode: 只支持 C / F 温标");
  const times = array(get(doc, "timex"), "timex").map((v, i) => number(v, `timex[${i}]`));
  const bt = array(get(doc, "temp2"), "temp2"),
    et = array(get(doc, "temp1"), "temp1");
  if (
    times.length < 2 ||
    times.length > MAX_SAMPLES ||
    bt.length !== times.length ||
    et.length !== times.length
  )
    throw new Error(`ALOG: timex/temp1/temp2 须有相同的 2–${MAX_SAMPLES} 个采样，不能截断`);
  if (
    times.some((t, i) => t < -86400 || t > 86400 || (i > 0 && t <= times[i - 1])) ||
    times.at(-1)! - times[0] > 86400
  )
    throw new Error("ALOG timex: 时间须严格递增，跨度最多 24 小时");
  const displayOriginSeconds = times[0];
  const temp = (node: Literal, field: string) => {
    const value = number(node, field);
    if (value === -1) return null;
    const c = mode === "F" ? ((value - 32) * 5) / 9 : value;
    if (c < -50 || c > 500) throw new Error(`ALOG ${field}: 显示温度须在 -50–500°C 范围`);
    return c;
  };
  const samples: Sample[] = times.map((t, i) => ({
    t: t - displayOriginSeconds,
    bt: temp(bt[i], `temp2[${i}]`),
    et: temp(et[i], `temp1[${i}]`),
  }));
  const indices = array(get(doc, "timeindex"), "timeindex").map((v, i) =>
    number(v, `timeindex[${i}]`),
  );
  if (indices.length !== 8) throw new Error("ALOG timeindex: 必须有 8 个事件槽；TP 不在该数组内");
  const markers: Marker[] = [];
  indices.forEach((index, slot) => {
    if (!Number.isInteger(index) || index < (slot === 0 ? -1 : 0) || index >= samples.length)
      throw new Error(`ALOG timeindex[${slot}]: 事件索引越界`);
    if ((slot === 0 && index === -1) || (slot !== 0 && index === 0)) return;
    const sample = samples[index];
    if (markers.length && sample.t < markers.at(-1)!.t)
      throw new Error("ALOG timeindex: 事件顺序与采样时间不一致");
    markers.push({
      kind: MARKERS[slot],
      t: sample.t,
      bt: sample.bt,
      source: "imported",
      temperatureSource: sample.bt === null ? "unavailable" : "sample",
    });
  });
  const decodedTitle = decodeArtisanText(text(get(doc, "title")) ?? ""),
    decodedNotes = decodeArtisanText(text(get(doc, "roastingnotes")) ?? "");
  const name = decodedTitle.trim().slice(0, 120) || "Artisan 导入曲线",
    notes = decodedNotes.slice(0, 4000);
  const weight = get(doc, "weight");
  let inputWeight: number | null = null,
    outputWeight: number | null = null;
  if (weight && (weight.kind === "list" || weight.kind === "tuple") && weight.items.length >= 3) {
    const unit = (text(weight.items[2]) ?? "").toLowerCase(),
      multiplier = ({ g: 1, kg: 1000, lb: 453.59237, lbs: 453.59237 } as Record<string, number>)[
        unit
      ];
    if (multiplier) {
      const readWeight = (item: Literal) => {
        const n = item.kind === "number" ? Number(item.raw) * multiplier : 0;
        return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
      };
      inputWeight = readWeight(weight.items[0]);
      outputWeight = readWeight(weight.items[1]);
      if (inputWeight && outputWeight && outputWeight > inputWeight) {
        inputWeight = null;
        outputWeight = null;
      }
    }
  }
  const tagsNode = get(doc, "coffee_workbench_flavor_tags");
  const flavorTags = tagsNode
    ? validateFlavorTags(array(tagsNode, "coffee_workbench_flavor_tags").map((node) => text(node)))
    : undefined;
  return {
    mode: mode as "C" | "F",
    samples,
    markers,
    displayOriginSeconds,
    name,
    notes,
    inputWeight,
    outputWeight,
    flavorTags,
    titleClipped: decodedTitle.trim().length > 120,
    notesClipped: decodedNotes.length > 4000,
  };
}

export function validateNativeAttachment(input: unknown): NativeArtisanAttachment {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("原生 Artisan 附件无效");
  const a = input as Record<string, unknown>;
  if (
    a.format !== "artisan-alog" ||
    a.version !== 1 ||
    typeof a.sourceText !== "string" ||
    typeof a.sourceName !== "string" ||
    a.sourceName.length > 240
  )
    throw new Error("原生 Artisan 附件版本、来源或文本无效");
  const p = projection(parsePythonLiteral(a.sourceText));
  if (
    typeof a.displayOriginSeconds !== "number" ||
    a.displayOriginSeconds !== p.displayOriginSeconds
  )
    throw new Error("原生 Artisan 附件显示时间原点与原始 timex 不一致");
  return {
    format: "artisan-alog",
    version: 1,
    sourceText: a.sourceText,
    displayOriginSeconds: p.displayOriginSeconds,
    sourceName: a.sourceName,
  };
}
/** 功能：把原生文件打开为不执行命令的曲线草稿。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 恢复存在的工作台风味标签。 */
export function importALOG(sourceText: string, sourceName = "Artisan .alog"): RoastCurve {
  const doc = parsePythonLiteral(sourceText),
    p = projection(doc),
    now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: p.name,
    notes: p.notes,
    ...(p.flavorTags === undefined ? {} : { flavorTags: p.flavorTags }),
    createdAt: now,
    updatedAt: now,
    source: "imported",
    samples: p.samples,
    markers: p.markers,
    inputWeight: p.inputWeight,
    outputWeight: p.outputWeight,
    nativeArtisan: {
      format: "artisan-alog",
      version: 1,
      sourceText,
      displayOriginSeconds: p.displayOriginSeconds,
      sourceName: sourceName.slice(0, 240),
    },
  };
}
export interface ALOGSummary {
  sourceName: string;
  sourceVersion: string | null;
  mode: "C" | "F";
  sampleCount: number;
  markerCount: number;
  fieldCount: number;
  extraChannelPairs: number;
  controlEventCount: number;
  unsupportedControlFields: string[];
  displayOriginSeconds: number;
  chargeTimeSeconds: number | null;
  warnings: string[];
}
const count = (node: Literal | undefined) =>
  node && (node.kind === "list" || node.kind === "tuple") ? node.items.length : 0;
export function summarizeALOG(curve: RoastCurve): ALOGSummary | null {
  if (!curve.nativeArtisan) return null;
  const attachment = validateNativeAttachment(curve.nativeArtisan),
    doc = parsePythonLiteral(attachment.sourceText),
    p = projection(doc);
  const extraChannelPairs = Math.max(
      count(get(doc, "extratimex")),
      count(get(doc, "extratemp1")),
      count(get(doc, "extratemp2")),
    ),
    controlEventCount = count(get(doc, "specialevents"));
  const unsupportedControlFields = CONTROL_FIELDS.filter((key) => {
    const node = get(doc, key);
    return (
      node &&
      !(node.kind === "string" && !node.value) &&
      !(node.kind === "constant" && !node.value) &&
      !(node.kind === "number" && Number(node.raw) === 0) &&
      !((node.kind === "list" || node.kind === "tuple") && !node.items.length)
    );
  });
  const warnings = [
    "原生时间与温标完整保留；工作台显示为 °C；内部视图以首个采样为 0 秒，图轴有入豆事件时标为入豆相对时间。导入的事件、报警与控制配置一律不执行。",
  ];
  if (extraChannelPairs)
    warnings.push(`${extraChannelPairs} 组附加通道仅保存在原生附件中，主图显示 BT / ET。`);
  if (controlEventCount)
    warnings.push(
      `${controlEventCount} 条自定义/控制事件仅保留为数据，不推定为火力或风量，不发送到设备。`,
    );
  if (unsupportedControlFields.length)
    warnings.push(`未执行的控制/外部配置：${unsupportedControlFields.join("、")}。`);
  const lengths = [
    "specialevents",
    "specialeventstype",
    "specialeventsvalue",
    "specialeventsStrings",
  ].map((key) => count(get(doc, key)));
  if (!lengths.every((n) => n === lengths[0]))
    warnings.push("自定义事件平行数组长度不一致；原样保留，不作事件映射或执行。");
  if (p.titleClipped || p.notesClipped)
    warnings.push("标题或笔记超出工作台编辑长度；显示已缩短，未编辑导出仍保留完整原文。");
  if (get(doc, "computed"))
    warnings.push("computed 为 Artisan 的派生统计；TP 不作为已记录事件导入。");
  return {
    sourceName: attachment.sourceName,
    sourceVersion: text(get(doc, "recording_version")) ?? text(get(doc, "version")),
    mode: p.mode,
    sampleCount: p.samples.length,
    markerCount: p.markers.length,
    fieldCount: doc.entries.length,
    extraChannelPairs,
    controlEventCount,
    unsupportedControlFields,
    displayOriginSeconds: attachment.displayOriginSeconds,
    chargeTimeSeconds: p.markers.find((m) => m.kind === "CHARGE")?.t ?? null,
    warnings,
  };
}
function checkedSamples(samples: Sample[]) {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_SAMPLES)
    throw new Error("导出需要 2–15000 个采样");
  samples.forEach((s, i) => {
    if (!Number.isFinite(s.t) || s.t < 0 || s.t > 86400 || (i && s.t <= samples[i - 1].t))
      throw new Error("导出采样时间须严格递增");
    for (const key of ["bt", "et"] as const)
      if (
        s[key] !== null &&
        (typeof s[key] !== "number" || !Number.isFinite(s[key]) || s[key]! < -50 || s[key]! > 500)
      )
        throw new Error("导出温度须为 -50–500°C 或缺失");
  });
}
function markerIndices(curve: RoastCurve, warnings: string[]) {
  const indices = [-1, 0, 0, 0, 0, 0, 0, 0],
    seen = new Set<MarkerKind>();
  let previous = -Infinity,
    previousSlot = -1;
  let turningPoint: number | null = null;
  for (const marker of curve.markers) {
    const slot = MARKERS.indexOf(marker.kind);
    if (
      (!MARKERS.includes(marker.kind) && marker.kind !== "TP") ||
      seen.has(marker.kind) ||
      !Number.isFinite(marker.t) ||
      marker.t < previous ||
      (marker.kind !== "TP" && slot <= previousSlot)
    )
      throw new Error("ALOG 事件须唯一、依次且时间递增");
    seen.add(marker.kind);
    previous = marker.t;
    if (slot >= 0) previousSlot = slot;
    let best = 0;
    for (let i = 1; i < curve.samples.length; i++)
      if (Math.abs(curve.samples[i].t - marker.t) < Math.abs(curve.samples[best].t - marker.t))
        best = i;
    const error = Math.abs(curve.samples[best].t - marker.t);
    if (
      marker.t < curve.samples[0].t ||
      marker.t > curve.samples.at(-1)!.t ||
      error > EVENT_ASSOCIATION_TOLERANCE_SECONDS + 1e-9
    )
      throw new Error(
        `${marker.kind} 与最近采样误差 ${error.toFixed(3)} 秒；允许上限 ${EVENT_ASSOCIATION_TOLERANCE_SECONDS} 秒。请将事件移至采样点再导出。`,
      );
    if (error > 1e-9)
      warnings.push(
        `${marker.kind} 关联到最近采样，时间误差 ${error.toFixed(3)} 秒（上限 ${EVENT_ASSOCIATION_TOLERANCE_SECONDS} 秒）。`,
      );
    if (marker.kind === "TP") turningPoint = best;
    else {
      if (slot !== 0 && best === 0)
        throw new Error(`${marker.kind} 无法关联第 0 个采样：Artisan 用 0 表示该事件缺失`);
      indices[slot] = best;
    }
  }
  return { indices, turningPoint };
}
/** 功能：导出原生或第三方曲线，未编辑时保留原文。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 独立保存风味标签，不覆盖 Artisan 杯测字段。 */
export function exportALOG(curve: RoastCurve): { text: string; warnings: string[] } {
  checkedSamples(curve.samples);
  const warnings: string[] = [];
  const attachment = curve.nativeArtisan ? validateNativeAttachment(curve.nativeArtisan) : null;
  const doc: DictLiteral = attachment
    ? parsePythonLiteral(attachment.sourceText)
    : { kind: "dict", entries: [] };
  const original = attachment ? projection(doc) : null;
  const mode = original?.mode ?? "C",
    origin = attachment?.displayOriginSeconds ?? 0;
  const convert = (v: number | null) => {
    if (v === null) return -1;
    const value = mode === "F" ? (v * 9) / 5 + 32 : v;
    if (value === -1)
      throw new Error("温度 -1 是 Artisan 缺失哨兵，无法表示该有效温度；请明确选择缺失或其他温度");
    return value;
  };
  let edited = !attachment;
  const update = (key: string, value: unknown) => {
    set(doc, key, fromValue(value));
    edited = true;
  };
  if (!original || curve.name !== original.name) update("title", encodeArtisanText(curve.name));
  if (!original || curve.notes !== original.notes)
    update("roastingnotes", encodeArtisanText(curve.notes));
  if (!original) update("mode", mode);
  if (original && curve.samples.length !== original.samples.length)
    throw new Error(
      "原生附件的采样数量发生变化；为避免破坏额外通道和事件索引，请另存为新曲线后导出",
    );
  if (
    original &&
    !same(
      curve.samples.map((s) => s.t),
      original.samples.map((s) => s.t),
    )
  )
    throw new Error("原生采样时间轴发生变化；为避免错配额外通道和事件索引，请另存为新曲线后导出");
  for (const [field, channel] of [
    ["timex", "t"],
    ["temp1", "et"],
    ["temp2", "bt"],
  ] as const) {
    if (
      !original ||
      !same(
        curve.samples.map((s) => s[channel]),
        original.samples.map((s) => s[channel]),
      )
    )
      update(
        field,
        curve.samples.map((s) => (channel === "t" ? s.t + origin : convert(s[channel]))),
      );
  }
  const eventShape = (markers: Marker[]) => markers.map(({ kind, t }) => ({ kind, t }));
  if (!original || !same(eventShape(curve.markers), eventShape(original.markers))) {
    const { indices, turningPoint } = markerIndices(curve, warnings);
    update("timeindex", indices);
    if (turningPoint !== null) {
      const computed = get(doc, "computed"),
        stats: DictLiteral = computed?.kind === "dict" ? computed : { kind: "dict", entries: [] };
      set(stats, "TP_idx", fromValue(turningPoint));
      set(doc, "computed", stats);
      warnings.push(
        "手动回温点写入 computed.TP_idx（派生元数据），不占用 timeindex 槽；Artisan 可能重新计算。",
      );
    }
  }
  if (
    !original ||
    (curve.inputWeight ?? null) !== original.inputWeight ||
    (curve.outputWeight ?? null) !== original.outputWeight
  ) {
    const validWeight = (value: number | null | undefined) =>
      value == null
        ? 0
        : typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000
          ? value
          : (() => {
              throw new Error("导出重量须为 0–100000g 正数或空");
            })();
    const input = validWeight(curve.inputWeight),
      output = validWeight(curve.outputWeight);
    if (input && output > input) throw new Error("出豆重量不能高于入豆重量");
    update("weight", [input, output, "g"]);
  }
  const flavorTags =
    curve.flavorTags === undefined ? undefined : validateFlavorTags(curve.flavorTags);
  if (!same(flavorTags ?? [], original?.flavorTags ?? []))
    update("coffee_workbench_flavor_tags", flavorTags ?? []);
  if (!edited && attachment)
    return {
      text: attachment.sourceText.startsWith("{") ? attachment.sourceText : writePythonLiteral(doc),
      warnings: ["原始 Artisan 文档未修改，保留原始温标、采样与全部元数据；不代表签名已验证。"],
    };
  if (get(doc, "signature") || get(doc, "hash")) {
    remove(doc, "signature");
    remove(doc, "hash");
    warnings.push("内容已编辑，原 Artisan signature / hash 已移除；此文件不是官方签名文件。");
  }
  const sourceKeys = [
    "version",
    "revision",
    "build",
    "artisan_os",
    "artisan_os_version",
    "artisan_os_arch",
    "recording_version",
    "recording_revision",
    "recording_build",
  ];
  const sourceProvenance: DictLiteral = {
    kind: "dict",
    entries: sourceKeys.flatMap((key) => {
      const value = get(doc, key);
      return value ? [{ key, value }] : [];
    }),
  };
  if (attachment) {
    warnings.push(
      "第三方编辑导出：保留原始 version 与 recording_* 作为来源，不代表本应用是 Artisan；正常版本/签名警告应由你确认或取消。",
    );
  } else {
    for (const key of [
      "specialevents",
      "specialeventstype",
      "specialeventsvalue",
      "specialeventsStrings",
      "extratimex",
      "extratemp1",
      "extratemp2",
    ])
      if (!get(doc, key)) set(doc, key, fromValue([]));
    warnings.push(
      "这是咖啡烘焙工作台生成的第三方 .alog，无 Artisan 官方版本或签名；未经过 Artisan 桌面 GUI 验证。",
    );
  }
  const producer = fromValue({
    generator: "咖啡烘焙工作台 / coffee-roasting-console",
    generator_version: GENERATOR_VERSION,
    third_party: true,
    profile_kind: curve.source ?? "legacy",
    action: attachment ? "modified" : "generated",
  }) as DictLiteral;
  if (attachment) set(producer, "source_provenance", sourceProvenance);
  // Do not replace any imported extension, even one that shares our namespace.
  let producerKey = "coffee_console";
  let suffix = 1;
  while (get(doc, producerKey)) producerKey = `coffee_console_edit_${suffix++}`;
  set(doc, producerKey, producer);
  const notes = decodeArtisanText(text(get(doc, "roastingnotes")) ?? "");
  const provenance = attachment
    ? `由咖啡烘焙工作台 ${GENERATOR_VERSION} 修改（第三方）；保留的 Artisan version / recording_* 只描述原始来源，不是本应用版本。事件与控制配置仅为数据，未执行。`
    : `由咖啡烘焙工作台 ${GENERATOR_VERSION} 生成（第三方）；来源：${curve.source ?? "legacy"}，不是 Artisan 录制。事件与控制配置仅为数据，未执行。`;
  if (!notes.includes(provenance))
    set(
      doc,
      "roastingnotes",
      fromValue(encodeArtisanText(`${notes}${notes ? "\n\n" : ""}${provenance}`)),
    );
  if (get(doc, "computed"))
    warnings.push("保留原 computed 派生统计；编辑后可能过时，应由 Artisan 重新计算。");
  const output = writePythonLiteral(doc);
  // Authored edits can expand escapes/provenance: do not emit files we cannot reopen.
  projection(parsePythonLiteral(output));
  return { text: output, warnings };
}

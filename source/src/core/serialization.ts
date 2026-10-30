/** 功能：校验与交换本地曲线数据。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 保留并校验可选风味标签；增加有界记录卡校验和单采样草稿支持。 */
import type { Marker, MarkerKind, RoastCurve, Sample } from "./types";
import { validateNativeAttachment } from "./alog";
import { validateFlavorTags } from "./flavors";
import { validateJournal } from "./journal";

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
// Native text is JSON-escaped alongside its editable projection in console backups.
export const MAX_JSON_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_SAMPLES = 15000;
const MAX_TIME = 86400;
const markerKinds: MarkerKind[] = [
  "CHARGE",
  "TP",
  "DRY",
  "FCs",
  "FCe",
  "SCs",
  "SCe",
  "DROP",
  "COOL",
];
const numberCell = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail(path, "必须为对象 / expected an object");
  return input as Record<string, unknown>;
}

function boundedString(input: unknown, path: string, maximum: number, allowEmpty = true): string {
  if (typeof input !== "string" || input.length > maximum || (!allowEmpty && !input.trim()))
    fail(path, `必须为${allowEmpty ? "" : "非空"}文本，最多 ${maximum} 字符 / invalid text`);
  return input;
}

function time(input: unknown, path: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > MAX_TIME)
    fail(path, `秒数必须在 0–${MAX_TIME} 之间 / invalid time`);
  return input;
}

function temperature(input: unknown, path: string): number | null {
  if (input === null) return null;
  if (typeof input !== "number" || !Number.isFinite(input) || input < -50 || input > 500)
    fail(path, "温度须为 -50–500°C 的有限数值或 null / invalid temperature");
  return input;
}

function isoDate(input: unknown, path: string): string {
  const value = boundedString(input, path, 40, false);
  // Require a full UTC ISO timestamp and reject dates normalized by Date.parse (e.g. Feb 30).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    fail(path, "须为完整 UTC ISO 日期 / invalid ISO date");
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    fail(path, "日期无效 / invalid ISO date");
  return value;
}

/** 功能：返回经过校验的独立可移植曲线，保留可选原生附件和风味标签。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 校验并保留风味标签、记录卡和设备演示来源；允许单样本草稿。 */
export function validateCurve(input: unknown, draft = false): RoastCurve {
  const source = record(input, "curve");
  if (source.schemaVersion !== 1 && source.schemaVersion !== 2)
    fail("schemaVersion", "仅支持版本 1 或 2 / unsupported schema");
  const id = boundedString(source.id, "id", 128, false);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) fail("id", "须为安全标识符 / invalid identifier");
  const name = boundedString(source.name, "name", 120, draft).trim();
  const notes = boundedString(source.notes, "notes", 4000);
  const createdAt = isoDate(source.createdAt, "createdAt");
  const updatedAt = isoDate(source.updatedAt, "updatedAt");
  if (
    !Array.isArray(source.samples) ||
    source.samples.length < (draft ? 1 : 2) ||
    source.samples.length > MAX_SAMPLES
  )
    fail("samples", `须有 2–${MAX_SAMPLES} 个采样点 / invalid sample count`);
  let previousTime = -1;
  const samples: Sample[] = Array.from(source.samples, (inputSample, index) => {
    const path = `samples[${index}]`;
    const sample = record(inputSample, path);
    const t = time(sample.t, `${path}.t`);
    if (t <= previousTime) fail(`${path}.t`, "时间须严格递增 / times must increase");
    previousTime = t;
    return {
      t,
      bt: temperature(sample.bt, `${path}.bt`),
      et: temperature(sample.et, `${path}.et`),
    };
  });
  if (!Array.isArray(source.markers) || source.markers.length > markerKinds.length)
    fail("markers", "事件列表无效 / invalid markers");
  let previousKind = -1;
  let previousMarkerTime = -1;
  const markers: Marker[] = Array.from(source.markers, (inputMarker, index) => {
    const path = `markers[${index}]`;
    const marker = record(inputMarker, path);
    const order = markerKinds.indexOf(marker.kind as MarkerKind);
    if (order < 0 || order <= previousKind)
      fail(`${path}.kind`, "事件须唯一且依次为 CHARGE → DRY → FCs → DROP / invalid event order");
    const t = time(marker.t, `${path}.t`);
    if (t < previousMarkerTime || t < samples[0].t || t > samples[samples.length - 1].t)
      fail(`${path}.t`, "事件须依时间顺序且位于采样区间内 / invalid event time");
    previousKind = order;
    previousMarkerTime = t;
    const result: Marker = { kind: markerKinds[order], t };
    if (source.schemaVersion === 2) {
      if (marker.bt !== undefined) result.bt = temperature(marker.bt, `${path}.bt`);
      if (marker.source !== undefined) {
        if (!["legacy", "manual", "imported", "example"].includes(String(marker.source)))
          fail(path, "事件来源无效");
        result.source = marker.source as Marker["source"];
      }
      if (marker.temperatureSource !== undefined) {
        if (!["sample", "interpolated", "unavailable"].includes(String(marker.temperatureSource)))
          fail(path, "事件温度来源无效");
        result.temperatureSource = marker.temperatureSource as Marker["temperatureSource"];
      }
    }
    return result;
  });
  const result: RoastCurve = {
    schemaVersion: source.schemaVersion,
    id,
    name,
    notes,
    createdAt,
    updatedAt,
    samples,
    markers,
  };
  if (source.schemaVersion === 2) {
    if (
      !["legacy", "simulation", "imported", "example", "device-demo"].includes(
        String(source.source),
      )
    )
      fail("source", "版本 2 须注明数据来源");
    result.source = source.source as RoastCurve["source"];
  }
  if (source.schemaVersion === 2 || draft) {
    for (const key of ["inputWeight", "outputWeight"] as const) {
      if (source[key] === undefined) continue;
      const value = source[key];
      if (
        value !== null &&
        (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100000)
      )
        fail(key, "重量须为 0–100000g 的正数或 null");
      result[key] = value as number | null;
    }
    if (result.inputWeight && result.outputWeight && result.outputWeight > result.inputWeight)
      fail("outputWeight", "出豆重量不可高于入豆重量");
  }
  if (source.nativeArtisan !== undefined)
    result.nativeArtisan = validateNativeAttachment(source.nativeArtisan);
  if (source.flavorTags !== undefined) result.flavorTags = validateFlavorTags(source.flavorTags);
  if (source.journal !== undefined) result.journal = validateJournal(source.journal, validateCurve);
  return result;
}

/** Explicit-save conversion only. Reading the library never writes or relabels events manual. */
export function upgradeCurve(curve: RoastCurve): RoastCurve {
  const clean = validateCurve(curve);
  if (clean.schemaVersion === 2) return clean;
  return validateCurve({
    ...clean,
    schemaVersion: 2,
    source: "legacy",
    inputWeight: curve.inputWeight,
    outputWeight: curve.outputWeight,
    markers: curve.markers.map((m) => ({ ...m, source: m.source ?? "legacy" })),
  });
}

export function exportLibrary(curves: RoastCurve[]): string {
  return JSON.stringify(
    {
      format: "coffee-roasting-library",
      version: 1,
      exportedAt: new Date().toISOString(),
      curves: curves.map((curve) => validateCurve(curve)),
    },
    null,
    2,
  );
}

function checkText(text: string, maximum = MAX_TEXT_BYTES): void {
  if (typeof text !== "string") fail("file", "须为文本 / expected text");
  if (text.length > maximum || new TextEncoder().encode(text).byteLength > maximum)
    fail(
      "file",
      `文件不可超过 ${maximum / 1024 / 1024} MiB (${maximum / 1024 / 1024} MB) / file too large`,
    );
}

export function parseJSON(text: string): RoastCurve {
  checkText(text, MAX_JSON_TEXT_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    fail("JSON", "无法解析，请检查文件格式 / invalid JSON");
  }
  return validateCurve(parsed);
}

export function exportJSON(curve: RoastCurve): string {
  const text = JSON.stringify(validateCurve(curve), null, 2);
  checkText(text, MAX_JSON_TEXT_BYTES);
  return text;
}

function csvNumber(cell: string, path: string, nullable: boolean): number | null {
  const value = cell.trim();
  if (nullable && value === "") return null;
  if (!numberCell.test(value)) fail(path, "数值格式无效 / invalid numeric cell");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(path, "须为有限数值 / invalid numeric cell");
  return parsed;
}

/** Deliberately basic numeric CSV: exact named headers, no quoting or metadata. */
export function parseCSV(text: string): RoastCurve {
  checkText(text);
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const headers = (lines.shift() ?? "").split(",");
  if (
    headers.length < 2 ||
    headers.length > 3 ||
    !headers.includes("time_s") ||
    !headers.some((header) => header === "bt_c" || header === "et_c") ||
    new Set(headers).size !== headers.length ||
    headers.some((header) => !["time_s", "bt_c", "et_c"].includes(header))
  )
    fail("CSV header", "须含 time_s 与 bt_c / et_c，且不可有重复或未知列 / unsupported headers");
  if (lines.length < 2 || lines.length > MAX_SAMPLES)
    fail("samples", `须有 2–${MAX_SAMPLES} 行采样 / invalid sample count`);
  const timeIndex = headers.indexOf("time_s");
  const btIndex = headers.indexOf("bt_c");
  const etIndex = headers.indexOf("et_c");
  let previousTime = -1;
  const samples: Sample[] = lines.map((line, index) => {
    const path = `CSV row ${index + 2}`;
    const cells = line.split(",");
    if (cells.length !== headers.length) fail(path, "列数与表头不一致 / wrong column count");
    const t = time(csvNumber(cells[timeIndex], `${path} time_s`, false), `${path} time_s`);
    if (t <= previousTime) fail(path, "时间须严格递增 / times must increase");
    previousTime = t;
    return {
      t,
      bt:
        btIndex < 0
          ? null
          : temperature(csvNumber(cells[btIndex], `${path} bt_c`, true), `${path} bt_c`),
      et:
        etIndex < 0
          ? null
          : temperature(csvNumber(cells[etIndex], `${path} et_c`, true), `${path} et_c`),
    };
  });
  const now = new Date().toISOString();
  return validateCurve({
    schemaVersion: 2,
    source: "imported",
    id: crypto.randomUUID(),
    name: "导入的烘焙曲线",
    notes: "",
    createdAt: now,
    updatedAt: now,
    samples,
    markers: [],
  });
}

export function exportCSV(curve: RoastCurve): string {
  const validated = validateCurve(curve);
  return `time_s,bt_c,et_c\n${validated.samples.map((sample) => `${sample.t},${sample.bt ?? ""},${sample.et ?? ""}`).join("\n")}\n`;
}

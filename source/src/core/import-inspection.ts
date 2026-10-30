/** 功能：汇总导入前通道、里程碑及声明的控制事件，只读分析不执行命令。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import type { RoastCurve, Sample } from "./types";
import type { Literal } from "./pythonLiteral";
import { parsePythonLiteral } from "./pythonLiteral";
import { decodeArtisanText, summarizeALOG } from "./alog";
import { eventLabels, interpolateSample } from "./events";

/** 功能：统计指定通道的有效点与温度范围，缺失值不参与统计。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function channelSummary(samples: Sample[], channel: "bt" | "et") {
  const values = samples
    .map((sample) => sample[channel])
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    valid: values.length,
    missing: samples.length - values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}

/** 功能：按 etypes 明确名称识别事件；缺失名称、损坏数组和无效索引保持未确认。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function controlSummary(curve: RoastCurve) {
  const result = { total: 0, heat: 0, air: 0, other: 0, unknown: 0, warnings: [] as string[] };
  if (!curve.nativeArtisan) return result;
  const doc = parsePythonLiteral(curve.nativeArtisan.sourceText);
  const get = (key: string) => doc.entries.find((entry) => entry.key === key)?.value;
  const list = (node: Literal | undefined) =>
    node?.kind === "list" || node?.kind === "tuple" ? node.items : [];
  const fields = [
    "specialevents",
    "specialeventstype",
    "specialeventsvalue",
    "specialeventsStrings",
  ];
  const [indices, types, values, descriptions] = fields.map((key) => list(get(key)));
  const names = list(get("etypes"));
  result.total = Math.max(indices.length, types.length, values.length, descriptions.length);
  if (!result.total) {
    if (
      fields.some((key) => {
        const node = get(key);
        return node && node.kind !== "list" && node.kind !== "tuple";
      })
    )
      result.warnings.push("事件字段格式无效，无法确认是否有火力或风量事件。");
    return result;
  }
  if (![types, values, descriptions].every((items) => items.length === indices.length)) {
    result.unknown = result.total;
    result.warnings.push("事件数组长度不一致，全部按未确认处理。");
    return result;
  }
  const numeric = (node: Literal | undefined) => (node?.kind === "number" ? Number(node.raw) : NaN);
  indices.forEach((node, i) => {
    const index = numeric(node),
      type = numeric(types[i]),
      value = numeric(values[i]);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= curve.samples.length ||
      !Number.isInteger(type) ||
      type < 0 ||
      type >= names.length ||
      !Number.isFinite(value) ||
      descriptions[i]?.kind !== "string"
    ) {
      result.unknown++;
      return;
    }
    const name = names[type];
    const label = name?.kind === "string" ? decodeArtisanText(name.value).trim().toLowerCase() : "";
    if (
      ["power", "heat", "heater", "burner", "gas", "火力", "加热", "功率", "燃气"].includes(label)
    )
      result.heat++;
    else if (
      ["air", "airflow", "air flow", "fan", "damper", "风量", "风门", "风机"].includes(label)
    )
      result.air++;
    else if (label && label !== "--") result.other++;
    else result.unknown++;
  });
  if (result.unknown)
    result.warnings.push(
      `${result.unknown} 条事件缺少明确类型名称或有效数据，未猜测为火力或风量。`,
    );
  return result;
}

/** 功能：构建独立于活动曲线的导入检查数据，关键时间使用入豆或首点基准。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function inspectImport(curve: RoastCurve) {
  const native = summarizeALOG(curve);
  const charge = curve.markers.find((marker) => marker.kind === "CHARGE");
  const origin = charge?.t ?? curve.samples[0]?.t ?? 0;
  return {
    native,
    originalUnit: native?.mode ?? "C",
    hasCharge: !!charge,
    origin,
    channels: { bt: channelSummary(curve.samples, "bt"), et: channelSummary(curve.samples, "et") },
    events: (["CHARGE", "FCs", "DROP"] as const).map((kind) => {
      const marker = curve.markers.find((item) => item.kind === kind);
      const sampled = marker ? interpolateSample(curve.samples, marker.t) : null;
      const bt = marker?.bt ?? sampled?.bt ?? null;
      return {
        kind,
        label: eventLabels[kind],
        seconds: marker ? marker.t - origin : null,
        bt,
        temperatureSource:
          bt === null
            ? "unavailable"
            : marker?.bt != null
              ? (marker.temperatureSource ?? "sample")
              : (sampled?.basis ?? "unavailable"),
      };
    }),
    controls: controlSummary(curve),
  };
}

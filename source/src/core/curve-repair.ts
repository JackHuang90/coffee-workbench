/** 功能：生成只用于显示的实测分段和有界贝塞尔估算段，不修改采样或控制数据。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import type { Sample } from "./types";
import { displayGapSeconds, medianCadence } from "./trend";

/** 功能：表示显示曲线中的时间与摄氏温度。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export interface TemperaturePoint {
  /** 与原始采样相同的秒数坐标。 */
  t: number;
  /** 摄氏温度；估算点不得写回原始记录。 */
  value: number;
}

/** 功能：描述两个实测端点之间的一段三次贝塞尔估算。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export interface BezierGap {
  /** 缺口左侧的真实测量。 */
  start: TemperaturePoint;
  /** 三分之一时间位置的受限控制点。 */
  control1: TemperaturePoint;
  /** 三分之二时间位置的受限控制点。 */
  control2: TemperaturePoint;
  /** 缺口右侧的真实测量。 */
  end: TemperaturePoint;
}

/** 功能：区分真实分段和可关闭的估算段。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export interface TemperatureGeometry {
  /** 原始测量的连续分段；单点仍保留。 */
  runs: TemperaturePoint[][];
  /** 有实测端点且长度符合显示策略的短缺口。 */
  gaps: BezierGap[];
  /** 允许补全的最大端点时间差，单位秒。 */
  maxGapSeconds: number;
}

/** 功能：拒绝缺失、非有限和超出工作台温度范围的读数。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function valid(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -50 && value <= 500;
}

/** 功能：按不等距采样的割线计算保形切线，转向或平台处切线归零。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function tangent(
  leftSlope: number,
  rightSlope: number,
  leftSpan: number,
  rightSpan: number,
): number {
  if (leftSlope * rightSlope <= 0) return 0;
  const w1 = 2 * rightSpan + leftSpan,
    w2 = rightSpan + 2 * leftSpan;
  return (w1 + w2) / (w1 / leftSlope + w2 / rightSlope);
}

/** 功能：分离实测与估算；非法时间拒绝绘制，缺失端点和长缺口不外推。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function temperatureGeometry(samples: Sample[], channel: "bt" | "et"): TemperatureGeometry {
  const cadence = medianCadence(samples);
  const result: TemperatureGeometry = {
    runs: [],
    gaps: [],
    maxGapSeconds: Math.min(30, Math.max(6, cadence * 3)),
  };
  if (
    samples.some(
      (sample, i) => !Number.isFinite(sample.t) || (i > 0 && sample.t <= samples[i - 1].t),
    )
  )
    return result;
  // Only established cadence detects a missing row; explicit nulls work even in tiny files.
  const continuity = Math.min(
    displayGapSeconds(samples),
    samples.length >= 5 ? cadence * 1.5 : Infinity,
  );
  let previousIndex = -1;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i],
      value = sample[channel];
    if (!valid(value)) continue;
    const point = { t: sample.t, value };
    const previous = samples[previousIndex];
    const continuous = previous && i === previousIndex + 1 && sample.t - previous.t <= continuity;
    if (continuous) result.runs.at(-1)!.push(point);
    else {
      result.runs.push([point]);
      const span = previous ? sample.t - previous.t : Infinity;
      const missing = i > previousIndex + 1 || (samples.length >= 5 && span > cadence * 1.5);
      if (previous && missing && span <= result.maxGapSeconds) {
        const start = { t: previous.t, value: previous[channel]! };
        const slope = (value - start.value) / span;
        const before = samples[previousIndex - 1],
          after = samples[i + 1];
        const leftSlope =
          before && valid(before[channel]) && previous.t - before.t <= continuity
            ? tangent(
                (start.value - before[channel]) / (previous.t - before.t),
                slope,
                previous.t - before.t,
                span,
              )
            : slope;
        const rightSlope =
          after && valid(after[channel]) && after.t - sample.t <= continuity
            ? tangent(
                slope,
                (after[channel] - value) / (after.t - sample.t),
                span,
                after.t - sample.t,
              )
            : slope;
        const clamp = (v: number) =>
          Math.max(Math.min(start.value, value), Math.min(Math.max(start.value, value), v));
        result.gaps.push({
          start,
          end: point,
          control1: { t: start.t + span / 3, value: clamp(start.value + (leftSlope * span) / 3) },
          control2: { t: sample.t - span / 3, value: clamp(value - (rightSlope * span) / 3) },
        });
      }
    }
    previousIndex = i;
  }
  return result;
}

/** 功能：计算缺口内估算温度，缺口外或无效时间返回空值。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function estimateGap(gap: BezierGap, t: number): number | null {
  if (!Number.isFinite(t) || t < gap.start.t || t > gap.end.t) return null;
  const u = (t - gap.start.t) / (gap.end.t - gap.start.t),
    v = 1 - u;
  return (
    v ** 3 * gap.start.value +
    3 * v * v * u * gap.control1.value +
    3 * v * u * u * gap.control2.value +
    u ** 3 * gap.end.value
  );
}

/** 功能：将实测分段转为 SVG 路径，不跨越缺口。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function measuredPath(
  geometry: TemperatureGeometry,
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  return geometry.runs
    .map((run) =>
      run.map((point, i) => `${i ? "L" : "M"}${x(point.t)},${y(point.value)}`).join(" "),
    )
    .join(" ");
}

/** 功能：投影单段三次贝塞尔曲线，由调用者使用虚线区分估算。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function gapPath(
  gap: BezierGap,
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  return `M${x(gap.start.t)},${y(gap.start.value)} C${x(gap.control1.t)},${y(gap.control1.value)} ${x(gap.control2.t)},${y(gap.control2.value)} ${x(gap.end.t)},${y(gap.end.value)}`;
}

import type { Sample } from "./types";

const WINDOW_SECONDS = 30;
const MIN_SPAN_SECONDS = 20;
const HORIZON_SECONDS = 60;
const validBT = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= -50 && value <= 500;

/** Display-only policy. Never use this tolerance to validate firmware target uploads. */
export function medianCadence(samples: Sample[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].t - samples[i - 1].t;
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  // A couple of isolated points cannot establish a trustworthy sample cadence.
  if (deltas.length < 4) return 2;
  deltas.sort((a, b) => a - b);
  const middle = Math.floor(deltas.length / 2);
  return deltas.length % 2 ? deltas[middle] : (deltas[middle - 1] + deltas[middle]) / 2;
}

/** Allow one missed native sample, with a conservative 5s floor and 15s ceiling. */
export function displayGapSeconds(samples: Sample[]): number {
  return Math.min(15, Math.max(5, medianCadence(samples) * 2.5));
}

export interface Forecast {
  points: Sample[];
  reason: string | null;
  slopeCPerMinute: number | null;
}

/**
 * Visual-only least-squares BT trend. Uses no sample after cursor, no ET, no target,
 * and never mutates source data. A 30s tail needs >=20s of uninterrupted valid BT.
 * At normal cadences require 10 points; lower native cadences adapt down to 6.
 * The 60s maximum projection stops rather than clamps when outside -50..500 C.
 */
export function forecastBT(
  samples: Sample[],
  options: { cursor: number; blockedReason?: string },
): Forecast {
  const unavailable = (reason: string): Forecast => ({ points: [], reason, slopeCPerMinute: null });
  if (options.blockedReason) return unavailable(options.blockedReason);
  if (!Number.isFinite(options.cursor)) return unavailable("当前位置无效");
  // Unknown chronology cannot be silently erased or interpreted as a later sample.
  if (samples.some((sample) => !Number.isFinite(sample.t))) return unavailable("采样时间无效");
  const observed = samples.filter((sample) => sample.t <= options.cursor);
  const last = observed.at(-1);
  if (!last || !validBT(last.bt)) return unavailable("最新豆温缺失，暂不预测");
  const maxGap = displayGapSeconds(observed);
  if (options.cursor - last.t > maxGap) return unavailable("最新采样已过期，暂不预测");
  const window: Sample[] = [last];
  for (let i = observed.length - 2; i >= 0; i--) {
    const sample = observed[i],
      next = observed[i + 1];
    if (last.t - sample.t > WINDOW_SECONDS + 1e-7) break;
    if (!validBT(sample.bt) || next.t <= sample.t || next.t - sample.t > maxGap) break;
    window.unshift(sample);
  }
  const requiredPoints = Math.max(
    6,
    Math.min(10, Math.floor(WINDOW_SECONDS / medianCadence(observed)) + 1),
  );
  if (window.length < requiredPoints || last.t - window[0].t < MIN_SPAN_SECONDS - 1e-7) {
    return unavailable(`需至少 20 秒连续有效豆温及 ${requiredPoints} 个采样点`);
  }
  // Center times relative to the latest sample to avoid large-time cancellation.
  const meanT = window.reduce((sum, sample) => sum + sample.t - last.t, 0) / window.length;
  const meanBT = window.reduce((sum, sample) => sum + sample.bt!, 0) / window.length;
  let covariance = 0,
    variance = 0;
  for (const sample of window) {
    const t = sample.t - last.t - meanT;
    covariance += t * (sample.bt! - meanBT);
    variance += t * t;
  }
  const slope = covariance / variance;
  if (!Number.isFinite(slope)) return unavailable("连续数据不足，暂不预测");
  const points: Sample[] = [];
  for (let offset = 0; offset <= HORIZON_SECONDS; offset += 2) {
    const bt = last.bt + slope * offset;
    if (!validBT(bt)) break;
    points.push({ t: last.t + offset, bt, et: null });
  }
  return {
    points,
    slopeCPerMinute: slope * 60,
    reason: points.length < 2 ? "趋势超出温度显示范围，暂不延伸" : null,
  };
}

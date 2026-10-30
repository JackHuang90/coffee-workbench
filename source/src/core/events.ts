import type { Marker, MarkerKind, Sample } from "./types";
import { displayGapSeconds } from "./trend";
export const eventLabels: Record<MarkerKind, string> = {
  CHARGE: "入豆",
  TP: "回温点",
  DRY: "脱水结束",
  FCs: "一爆开始",
  FCe: "一爆结束",
  SCs: "二爆开始",
  SCe: "二爆结束",
  DROP: "出豆",
  COOL: "冷却结束",
};
export const eventOrder = Object.keys(eventLabels) as MarkerKind[];
const valid = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -50 && v <= 500;
export function validEventSequence(events: Marker[]): boolean {
  return events.every(
    (e, i) =>
      Number.isFinite(e.t) &&
      e.t >= 0 &&
      eventOrder.includes(e.kind) &&
      (!i ||
        (eventOrder.indexOf(e.kind) > eventOrder.indexOf(events[i - 1].kind) &&
          e.t >= events[i - 1].t)),
  );
}
export function interpolateSample(
  samples: Sample[],
  t: number,
):
  | (Sample & {
      basis: "sample" | "interpolated";
    })
  | null {
  if (!Number.isFinite(t)) return null;
  const index = samples.findIndex((s) => s.t >= t);
  if (index < 0) return null;
  const right = samples[index];
  if (right.t === t)
    return {
      t,
      bt: valid(right.bt) ? right.bt : null,
      et: valid(right.et) ? right.et : null,
      basis: "sample",
    };
  const left = samples[index - 1];
  if (!left || right.t - left.t > displayGapSeconds(samples) || right.t <= left.t) return null;
  const value = (channel: "bt" | "et") =>
    valid(left[channel]) && valid(right[channel])
      ? left[channel]! + ((right[channel]! - left[channel]!) * (t - left.t)) / (right.t - left.t)
      : null;
  return { t, bt: value("bt"), et: value("et"), basis: "interpolated" };
}
export function phaseMetrics(markers: Marker[], cursor: number) {
  const at = (kind: MarkerKind) => markers.find((m) => m.kind === kind && m.t <= cursor)?.t;
  const charge = at("CHARGE"),
    dry = at("DRY"),
    crack = at("FCs"),
    drop = at("DROP");
  const end = drop ?? cursor,
    elapsed = charge === undefined ? null : Math.max(0, end - charge);
  const duration = (start: number | undefined, finish: number | undefined) =>
    start === undefined || finish === undefined || finish < start ? null : finish - start;
  const development = duration(crack, crack === undefined ? undefined : end);
  const durations = [
    duration(charge, dry ?? (crack === undefined ? end : undefined)),
    duration(dry, crack ?? end),
    development,
  ];
  return {
    elapsed,
    development,
    dtr: elapsed && development !== null ? (development / elapsed) * 100 : null,
    phases: ["脱水", "褐变", "发展"].map((name, i) => ({
      name,
      seconds: durations[i],
      ratio: elapsed && durations[i] !== null ? (durations[i]! / elapsed) * 100 : null,
    })),
  };
}
/** Candidate only: a charge dip >=3°C, then >=20s contiguous recovery and >=2°C rise. */
export function turningPointCandidate(samples: Sample[], charge: number): Sample | null {
  const window = samples.filter((s) => s.t >= charge && s.t <= charge + 240);
  if (window.length < 3 || !valid(window[0].bt)) return null;
  let min = 0;
  for (let i = 1; i < window.length; i++) {
    if (!valid(window[i].bt) || window[i].t - window[i - 1].t > 5 || window[i].t <= window[i - 1].t)
      return null;
    if (window[i].bt! < window[min].bt!) min = i;
  }
  const low = window[min],
    last = window.at(-1)!;
  if (min === 0 || window[0].bt! - low.bt! < 3 || last.t - low.t < 20 || last.bt! - low.bt! < 2)
    return null;
  const recovery = window.slice(min);
  if (recovery.some((s, i) => i > 0 && s.bt! < recovery[i - 1].bt! - 0.3)) return null;
  return { ...low };
}

import type { Marker, MarkerKind, Phase, RoastCurve, Sample } from "./types";
import { displayGapSeconds } from "./trend";

const WINDOW_SECONDS = 30;
const markerOrder: MarkerKind[] = ["CHARGE", "DRY", "FCs", "DROP"];
const markerPhase: Partial<Record<MarkerKind, Phase>> = {
  CHARGE: "drying",
  DRY: "browning",
  FCs: "development",
  DROP: "cooling",
};
const validTime = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 86400;
const validTemperature = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= -50 && value <= 500;

/** Deterministic teaching data, never measurements from a connected roaster. */
export function createDemoCurve(): RoastCurve {
  const rounded = (value: number) => Math.round(value * 10) / 10;
  const samples = Array.from({ length: 301 }, (_, index): Sample => {
    const t = index * 2;
    const bt =
      t <= 60
        ? 180 - 90 * Math.sin((Math.PI * t) / 120)
        : 90 + 112 * (1 - Math.exp(-(t - 60) / 300));
    const et = 195 + 0.04023 * t - 20 * (t / 60) * Math.exp(1 - t / 60);
    return { t, bt: rounded(bt), et: rounded(et) };
  });
  return {
    schemaVersion: 2,
    source: "example",
    id: "demo-ethiopia",
    name: "埃塞俄比亚 · 日晒",
    notes: "200g · 浅中烘焙示例。仅为确定性模拟，不代表真实设备读数。",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    samples,
    markers: [
      { kind: "CHARGE", t: 0 },
      { kind: "DRY", t: 240 },
      { kind: "FCs", t: 480 },
      { kind: "DROP", t: 600 },
    ],
  };
}

/** Events determine the phase; temperature and elapsed time never invent events. */
export function phaseAt(markers: Marker[], t: number): Phase {
  if (!Number.isFinite(t)) return "prep";
  let latest: Marker | undefined;
  for (const marker of markers) {
    if (!validTime(marker.t) || marker.t > t || !markerOrder.includes(marker.kind)) continue;
    if (
      !latest ||
      marker.t > latest.t ||
      (marker.t === latest.t && markerOrder.indexOf(marker.kind) > markerOrder.indexOf(latest.kind))
    )
      latest = marker;
  }
  return latest ? markerPhase[latest.kind]! : "prep";
}

export function formatTime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.floor(Math.max(0, seconds)) : 0;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** A rolling 30-second delta, with interpolation only inside contiguous valid data. */
export function channelRates(samples: Sample[], channel: "bt" | "et"): Array<number | null> {
  const maxGap = displayGapSeconds(samples);
  let segmentStart = 0;
  let baselineIndex = 0;
  return samples.map((sample, index) => {
    const value = sample[channel];
    if (!validTime(sample.t) || !validTemperature(value)) {
      segmentStart = index + 1;
      baselineIndex = segmentStart;
      return null;
    }
    const previous = samples[index - 1];
    if (
      previous &&
      (!validTime(previous.t) ||
        !validTemperature(previous[channel]) ||
        sample.t <= previous.t ||
        sample.t - previous.t > maxGap)
    ) {
      segmentStart = index;
      baselineIndex = index;
    }
    const target = sample.t - WINDOW_SECONDS;
    if (segmentStart > index || samples[segmentStart].t > target) return null;
    while (baselineIndex + 1 < index && samples[baselineIndex + 1].t <= target) baselineIndex++;
    const left = samples[baselineIndex];
    const right = samples[baselineIndex + 1];
    const leftValue = left[channel]!;
    const rightValue = right[channel]!;
    const baseline =
      leftValue + ((rightValue - leftValue) * (target - left.t)) / (right.t - left.t);
    return ((value - baseline) * 60) / WINDOW_SECONDS;
  });
}

export function rateOfRise(samples: Sample[]): Array<{ t: number; value: number | null }> {
  return channelRates(samples, "bt").map((value, index) => ({
    t: samples[index].t,
    value,
  }));
}

/** Pure, display-only extension. Never append these estimates to saved measurements. */
export function trend(samples: Sample[]): Sample[] {
  const last = samples.at(-1);
  if (!last || !validTime(last.t)) return [];
  const btRate = channelRates(samples, "bt").at(-1) ?? null;
  const etRate = channelRates(samples, "et").at(-1) ?? null;
  if (btRate === null && etRate === null) return [];
  return Array.from({ length: 31 }, (_, index) => {
    const offset = index * 2;
    return {
      t: last.t + offset,
      bt: btRate === null ? null : last.bt! + (btRate * offset) / 60,
      et: etRate === null ? null : last.et! + (etRate * offset) / 60,
    };
  });
}

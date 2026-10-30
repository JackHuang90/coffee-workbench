import { describe, expect, it } from "vitest";
import { forecastBT, displayGapSeconds, medianCadence } from "../src/core/trend";
import { channelRates } from "../src/core/simulation";
import { interpolateSample } from "../src/core/events";
import type { Sample } from "../src/core/types";
import officialProfile2 from "./fixtures/artisan/official-profile2.json";

const linear = (step = 1, count = 61): Sample[] =>
  Array.from({ length: count }, (_, i) => ({
    t: i * step,
    bt: 100 + i * step * 0.5,
    et: 200 + i * step,
  }));

describe("cadence-aware display, not firmware upload policy", () => {
  it("uses robust observed cadence and preserves the short-history five-second boundary", () => {
    const samples = linear(5.001, 30);
    samples.splice(10, 1);
    expect(medianCadence(samples)).toBeCloseTo(5.001);
    expect(displayGapSeconds(samples)).toBeCloseTo(12.5025);
    expect(
      displayGapSeconds([
        { t: 0, bt: 1, et: 1 },
        { t: 2, bt: 2, et: 2 },
        { t: 10, bt: 3, et: 3 },
      ]),
    ).toBe(5);
    expect(displayGapSeconds(linear(100, 20))).toBe(15);
  });
  it("does not break native five-second cadence or a single missed sample", () => {
    const samples = linear(5.001, 30);
    samples.splice(20, 1);
    expect(channelRates(samples, "bt").at(-1)).toBeCloseTo(30);
    const t = (samples[18].t + samples[19].t) / 2;
    expect(interpolateSample(samples, t)?.bt).toBeCloseTo(100 + t * 0.5);
    expect(interpolateSample(samples, (samples[19].t + samples[20].t) / 2)?.bt).not.toBeNull();
  });
  it("keeps the pinned official profile2 continuous at its real native cadence", () => {
    const samples = officialProfile2.timex.map((t, i) => ({
      t,
      bt: officialProfile2.temp2[i],
      et: officialProfile2.temp1[i],
    }));
    const before = structuredClone(samples);
    expect(medianCadence(samples)).toBeCloseTo(5.001, 3);
    expect(
      channelRates(samples, "bt")
        .slice(7)
        .every((value) => value !== null),
    ).toBe(true);
    expect(forecastBT(samples, { cursor: samples.at(-1)!.t }).points).toHaveLength(31);
    expect(samples).toEqual(before);
  });
  it("still breaks genuine gaps rather than weakening controller sampling limits", () => {
    const samples = linear().filter((p) => p.t < 40 || p.t > 48);
    expect(channelRates(samples, "bt").at(-1)).toBeNull();
    expect(interpolateSample(samples, 44)).toBeNull();
  });
});

describe("short horizon BT regression", () => {
  it("fits only observed data, starts at the actual latest BT and ends sixty seconds ahead", () => {
    const samples = linear();
    const before = structuredClone(samples);
    const result = forecastBT(samples, { cursor: 60 });
    expect(result.reason).toBeNull();
    expect(result.points[0]).toEqual({ t: 60, bt: 130, et: null });
    expect(result.points.at(-1)).toEqual({ t: 120, bt: 160, et: null });
    expect(result.slopeCPerMinute).toBeCloseTo(30);
    expect(samples).toEqual(before);
  });
  it("does not use data after the cursor, including future cadence and values", () => {
    const samples = linear();
    const baseline = forecastBT(samples, { cursor: 30 });
    samples.splice(31, 30, ...linear(0.1, 20).map((p) => ({ ...p, t: 31 + p.t, bt: 499 })));
    expect(forecastBT(samples, { cursor: 30 })).toEqual(baseline);
  });
  it("adapts the point minimum for native five-second profiles without relaxing the twenty-second span", () => {
    const result = forecastBT(linear(5.001, 10), { cursor: 45.009 });
    expect(result.reason).toBeNull();
    expect(result.points.at(-1)?.bt).toBeCloseTo(152.5045);
    expect(forecastBT(linear(5, 4), { cursor: 15 }).reason).toMatch(/20/);
    expect(forecastBT(linear(0.2, 90), { cursor: 17.8 }).points).toEqual([]);
  });
  it.each([null, NaN, Infinity, 501])("does not forecast through invalid recent BT %s", (value) => {
    const samples = linear();
    samples[45].bt = value;
    expect(forecastBT(samples, { cursor: 60 }).points).toEqual([]);
  });
  it("refuses a missing latest point, a stale cursor or an explicitly frozen session", () => {
    const samples = linear();
    samples[60].bt = null;
    expect(forecastBT(samples, { cursor: 60 }).reason).toMatch(/最新/);
    expect(forecastBT(linear(), { cursor: 66 }).reason).toMatch(/过期/);
    expect(forecastBT(linear(), { cursor: 60, blockedReason: "仿真已暂停" }).reason).toBe(
      "仿真已暂停",
    );
  });
  it("does not bridge a real gap or reversed chronological sample", () => {
    const samples = linear().filter((p) => p.t < 40 || p.t > 47);
    expect(forecastBT(samples, { cursor: 60 }).points).toEqual([]);
    const reversed = linear();
    reversed[45].t = 43;
    expect(forecastBT(reversed, { cursor: 60 }).points).toEqual([]);
  });
  it("uses regression rather than only the two endpoint values", () => {
    const samples = linear();
    samples[31].bt = 130;
    const result = forecastBT(samples, { cursor: 60 });
    expect(result.slopeCPerMinute).toBeLessThan(30);
    expect(result.slopeCPerMinute).toBeGreaterThan(20);
    expect(result.points[0].bt).toBe(130);
  });
  it("never extrapolates nonfinite or physically out-of-view bounded values", () => {
    const samples = linear().map((p) => ({ ...p, bt: 470 + p.t * 0.5 }));
    const result = forecastBT(samples, { cursor: 60 });
    expect(result.points.every((p) => p.bt !== null && p.bt >= -50 && p.bt <= 500)).toBe(true);
    expect(result.points.at(-1)?.t).toBeLessThanOrEqual(120);
  });
});

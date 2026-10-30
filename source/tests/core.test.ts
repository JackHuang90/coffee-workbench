import { describe, expect, it } from "vitest";
import { createDemoCurve, formatTime, phaseAt, rateOfRise, trend } from "../src/core/simulation";
import type { Marker, Sample } from "../src/core/types";

const linear = (end = 60): Sample[] =>
  Array.from({ length: end / 2 + 1 }, (_, i) => ({
    t: i * 2,
    bt: 100 + i,
    et: 200 + i * 2,
  }));

// A changed unit conversion, broken chronology, or crossed data gap must fail these tests.
describe("deterministic demo", () => {
  it("provides independent repeatable 10 minute samples with a charge dip", () => {
    const first = createDemoCurve();
    const second = createDemoCurve();
    expect(first).toEqual(second);
    expect(first.samples).not.toBe(second.samples);
    expect(first.id).toBe("demo-ethiopia");
    expect(first.samples).toHaveLength(301);
    expect(first.samples[0].t).toBe(0);
    expect(first.samples[300].t).toBe(600);
    expect(first.samples[30].bt).toBeLessThan(first.samples[0].bt!);
    expect(first.samples[261].bt).toBeCloseTo(178, 0);
    expect(first.samples[261].et).toBeCloseTo(216, 0);
    expect(first.markers).toEqual([
      { kind: "CHARGE", t: 0 },
      { kind: "DRY", t: 240 },
      { kind: "FCs", t: 480 },
      { kind: "DROP", t: 600 },
    ]);
  });
});

describe("phase and clock", () => {
  const markers: Marker[] = [
    { kind: "DROP", t: 600 },
    { kind: "DRY", t: 240 },
    { kind: "CHARGE", t: 0 },
    { kind: "FCs", t: 480 },
  ];
  it.each([
    [-1, "prep"],
    [0, "drying"],
    [239, "drying"],
    [240, "browning"],
    [480, "development"],
    [600, "cooling"],
  ])("finds the chronological phase at %ss", (t, expected) => {
    expect(phaseAt(markers, Number(t))).toBe(expected);
  });
  it("does not invent phases without manual events", () => {
    expect(phaseAt([], 600)).toBe("prep");
    expect(phaseAt(markers, Number.NaN)).toBe("prep");
    expect(markers[0].kind).toBe("DROP");
  });
  it("resolves same-second markers by phase order", () => {
    expect(
      phaseAt(
        [
          { kind: "DRY", t: 0 },
          { kind: "CHARGE", t: 0 },
        ],
        0,
      ),
    ).toBe("browning");
  });
  it.each([
    [0, "00:00"],
    [59.9, "00:59"],
    [60, "01:00"],
    [522, "08:42"],
    [3601, "60:01"],
    [-4, "00:00"],
    [Number.NaN, "00:00"],
    [Infinity, "00:00"],
  ])("formats %ss as %s", (input, expected) => {
    expect(formatTime(Number(input))).toBe(expected);
  });
});

describe("rate of rise", () => {
  it("requires a complete 30s window and returns degrees Celsius per minute", () => {
    const output = rateOfRise(linear());
    expect(output).toHaveLength(31);
    expect(output[14]).toEqual({ t: 28, value: null });
    expect(output[15]).toEqual({ t: 30, value: 30 });
    expect(output[30]).toEqual({ t: 60, value: 30 });
  });
  it("interpolates a 30s baseline with uneven sampling", () => {
    const samples = Array.from({ length: 12 }, (_, i) => ({
      t: i * 3,
      bt: 100 + i * 1.5,
      et: null,
    }));
    samples.push({ t: 35, bt: 117.5, et: null });
    expect(rateOfRise(samples).at(-1)).toEqual({ t: 35, value: 30 });
  });
  it.each([null, Number.NaN, Infinity, 501])("does not bridge invalid BT %s", (value) => {
    const samples = linear();
    samples[15].bt = value;
    const result = rateOfRise(samples);
    expect(result[15].value).toBeNull();
    expect(result[29].value).toBeNull();
    expect(result[30].value).toBeNull();
    samples.push({ t: 62, bt: 131, et: 262 });
    expect(rateOfRise(samples).at(-1)?.value).toBe(30);
  });
  it("resets on gaps greater than five seconds and on reversed time", () => {
    const samples = linear().filter((s) => s.t < 28 || s.t > 32);
    expect(rateOfRise(samples).at(-1)?.value).toBeNull();
    const reversed = linear();
    reversed[20].t = 35;
    expect(rateOfRise(reversed).at(-1)?.value).toBeNull();
  });
  it("allows ET to be unavailable without losing BT rate", () => {
    expect(rateOfRise(linear().map((s) => ({ ...s, et: null }))).at(-1)?.value).toBe(30);
    expect(rateOfRise([])).toEqual([]);
  });
});

describe("display-only trend", () => {
  it("extends independently fitted channels by exactly 60s without mutating source", () => {
    const samples = linear();
    const before = structuredClone(samples);
    const predicted = trend(samples);
    expect(predicted).toHaveLength(31);
    expect(predicted[0]).toEqual({ t: 60, bt: 130, et: 260 });
    expect(predicted.at(-1)).toEqual({ t: 120, bt: 160, et: 320 });
    expect(samples).toEqual(before);
  });
  it("requires at least 30 contiguous seconds per channel", () => {
    expect(trend(linear(28))).toEqual([]);
    expect(trend([])).toEqual([]);
    expect(trend(linear().filter((s) => s.t < 40 || s.t > 44))).toEqual([]);
  });
  it("never forecasts missing or invalid channels, without blocking the other", () => {
    const samples = linear();
    samples[25].bt = null;
    const result = trend(samples);
    expect(result.at(-1)).toEqual({ t: 120, bt: null, et: 320 });
    samples[30].et = Number.NaN;
    expect(trend(samples)).toEqual([]);
  });
  it("does not use earlier stale samples when the latest time is invalid", () => {
    const samples = linear();
    samples[30].t = Number.NaN;
    expect(trend(samples)).toEqual([]);
  });
});

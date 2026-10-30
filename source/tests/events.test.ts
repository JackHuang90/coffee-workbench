import { describe, expect, it } from "vitest";
import {
  eventLabels,
  interpolateSample,
  phaseMetrics,
  turningPointCandidate,
  validEventSequence,
} from "../src/core/events";
import { createDemoCurve } from "../src/core/simulation";
import { upgradeCurve, validateCurve, exportJSON, parseJSON } from "../src/core/serialization";
import type { Sample } from "../src/core/types";
describe("trustworthy v2 event and metric semantics", () => {
  it("keeps v1 read inert and preserves all raw content when explicitly upgrading", () => {
    const old = createDemoCurve();
    old.schemaVersion = 1;
    delete old.source;
    const before = structuredClone(old);
    const read = validateCurve(old);
    expect(read.schemaVersion).toBe(1);
    const upgraded = upgradeCurve(read);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.source).toBe("legacy");
    expect(upgraded.samples).toEqual(before.samples);
    expect(upgraded.id).toBe(before.id);
    expect(upgraded.notes).toBe(before.notes);
    expect(upgraded.markers.map(({ kind, t }) => ({ kind, t }))).toEqual(before.markers);
    expect(upgraded.markers.every((m) => m.source === "legacy")).toBe(true);
    expect(parseJSON(exportJSON(upgraded))).toEqual(upgraded);
    expect(old).toEqual(before);
  });
  it("interpolates only contiguous finite channels and labels interpolation", () => {
    const samples: Sample[] = [
      { t: 0, bt: 100, et: null },
      { t: 2, bt: 102, et: 200 },
      { t: 10, bt: 110, et: 210 },
    ];
    expect(interpolateSample(samples, 1)).toEqual({
      t: 1,
      bt: 101,
      et: null,
      basis: "interpolated",
    });
    expect(interpolateSample(samples, 2)?.basis).toBe("sample");
    expect(interpolateSample(samples, 5)).toBeNull();
    expect(interpolateSample(samples, 11)).toBeNull();
  });
  it("supports all Chinese event names and rejects contradictory expanded order", () => {
    expect(Object.values(eventLabels)).toEqual([
      "入豆",
      "回温点",
      "脱水结束",
      "一爆开始",
      "一爆结束",
      "二爆开始",
      "二爆结束",
      "出豆",
      "冷却结束",
    ]);
    expect(
      validEventSequence([
        { kind: "CHARGE", t: 0 },
        { kind: "TP", t: 60 },
        { kind: "DRY", t: 240 },
        { kind: "FCs", t: 480 },
        { kind: "DROP", t: 600 },
      ]),
    ).toBe(true);
    expect(
      validEventSequence([
        { kind: "CHARGE", t: 0 },
        { kind: "DRY", t: 50 },
        { kind: "TP", t: 60 },
      ]),
    ).toBe(false);
    expect(
      validEventSequence([
        { kind: "CHARGE", t: 0 },
        { kind: "DROP", t: 50 },
        { kind: "COOL", t: 49 },
      ]),
    ).toBe(false);
  });
  it("computes coherent phase shares and DTR from confirmed boundaries only", () => {
    const result = phaseMetrics(createDemoCurve().markers, 600);
    expect(result.elapsed).toBe(600);
    expect(result.development).toBe(120);
    expect(result.dtr).toBe(20);
    expect(result.phases.map((p) => p.seconds)).toEqual([240, 240, 120]);
    expect(result.phases.map((p) => p.ratio)).toEqual([40, 40, 20]);
    expect(phaseMetrics([], 600).dtr).toBeNull();
    expect(
      phaseMetrics(
        [
          { kind: "CHARGE", t: 100 },
          { kind: "FCs", t: 300 },
          { kind: "DROP", t: 500 },
        ],
        900,
      ).development,
    ).toBe(200);
  });
  it("suggests a turning point only after sustained recovery, never from a noisy wiggle or gap", () => {
    const samples = createDemoCurve().samples;
    expect(
      turningPointCandidate(
        samples.filter((s) => s.t <= 66),
        0,
      ),
    ).toBeNull();
    expect(
      turningPointCandidate(
        samples.filter((s) => s.t <= 90),
        0,
      )?.t,
    ).toBe(60);
    expect(
      turningPointCandidate(
        [
          { t: 0, bt: 100, et: null },
          { t: 2, bt: 99, et: null },
          { t: 4, bt: 99.1, et: null },
        ],
        0,
      ),
    ).toBeNull();
    const gap = samples.filter((s) => s.t < 68 || s.t > 80);
    expect(turningPointCandidate(gap, 0)).toBeNull();
  });
});
it("retains newly entered optional weights and manual corrections during explicit v1 save", () => {
  const old = createDemoCurve();
  old.schemaVersion = 1;
  delete old.source;
  old.inputWeight = 200;
  old.outputWeight = 170;
  old.markers[1] = {
    kind: "DRY",
    t: 241,
    bt: 140.2,
    source: "manual",
    temperatureSource: "interpolated",
  };
  const saved = upgradeCurve(old);
  expect(saved.inputWeight).toBe(200);
  expect(saved.outputWeight).toBe(170);
  expect(saved.markers[1]).toEqual(old.markers[1]);
  expect(saved.markers[0].source).toBe("legacy");
});

it("backs up the whole saved library without silently migrating its curves", async () => {
  const { exportLibrary } = await import("../src/core/serialization");
  const v1 = createDemoCurve();
  v1.schemaVersion = 1;
  delete v1.source;
  const v2 = upgradeCurve({ ...v1, id: "second" });
  const value = JSON.parse(exportLibrary([v1, v2]));
  expect(value.format).toBe("coffee-roasting-library");
  expect(value.curves).toEqual([v1, v2]);
  expect(v1.schemaVersion).toBe(1);
});

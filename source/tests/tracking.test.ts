import { describe, expect, it } from "vitest";
import { TrackingController } from "../src/core/tracking";
import type { Sample } from "../src/core/types";

const target = (duration = 120, start = 0): Sample[] =>
  Array.from({ length: duration / 2 + 1 }, (_, i) => ({
    t: start + i * 2,
    bt: 100 + i * 0.6,
    et: 150 + i * 0.6,
  }));
const prepared = (duration = 120) => {
  const controller = new TrackingController();
  controller.prepare(target(duration), 0);
  return controller;
};

describe("deterministic offline closed-loop simulation", () => {
  it("requires an explicitly chosen origin before becoming ready", () => {
    const c = new TrackingController();
    expect(c.snapshot.state).toBe("idle");
    expect(c.prepare(target()).state).toBe("fault");
    expect(c.snapshot.reason).toContain("起点");
    const state = c.prepare(target(120, 10), 20);
    expect(state.state).toBe("ready");
    expect(state.elapsed).toBe(0);
    expect(state.duration).toBe(110);
    expect(state.targetBt).toBe(103);
    expect(state.output).toBe(0);
  });

  it("interpolates the aligned target independently from the responding plant", () => {
    const c = prepared();
    c.start();
    const s = c.step(1);
    expect(s.elapsed).toBe(1);
    expect(s.targetBt).toBeCloseTo(100.3);
    expect(s.bt).not.toBe(s.targetBt);
    expect(s.samples).toHaveLength(2);
    expect(s.samples[1].t).toBe(1);
    expect(s.output).toBeGreaterThanOrEqual(0);
    expect(s.output).toBeLessThanOrEqual(100);
  });

  it("produces identical trajectories for identical clocks and inputs", () => {
    const a = prepared(),
      b = prepared();
    a.start();
    b.start();
    for (let i = 0; i < 20; i++) {
      a.step(0.5);
      b.step(0.5);
    }
    expect(a.snapshot).toEqual(b.snapshot);
  });

  it("manual heat changes the toy plant instead of replaying target samples", () => {
    const cold = prepared(),
      hot = prepared();
    cold.start();
    hot.start();
    cold.takeManual();
    hot.takeManual();
    cold.setManualOutput(0);
    hot.setManualOutput(100);
    for (let i = 0; i < 20; i++) {
      cold.step(1);
      hot.step(1);
    }
    expect(hot.snapshot.bt!).toBeGreaterThan(cold.snapshot.bt!);
    expect(hot.snapshot.et!).toBeGreaterThan(cold.snapshot.et!);
    expect(hot.snapshot.bt).not.toBe(hot.snapshot.targetBt);
  });

  it("pauses without advancing and resumes explicitly with zero paused output", () => {
    const c = prepared();
    c.start();
    c.step(2);
    const paused = c.pause();
    expect(paused.state).toBe("ready");
    expect(paused.output).toBe(0);
    expect(c.step(2)).toEqual(paused);
    c.start();
    expect(c.step(2).elapsed).toBe(4);
  });

  it("clamps manual output and ignores manual commands outside manual state", () => {
    const c = prepared();
    expect(c.setManualOutput(80).output).toBe(0);
    c.start();
    c.takeManual();
    expect(c.snapshot.output).toBe(0);
    expect(c.setManualOutput(120).output).toBe(100);
    expect(c.setManualOutput(-20).output).toBe(0);
    expect(c.setManualOutput(Number.NaN).state).toBe("fault");
    expect(c.snapshot.output).toBe(0);
  });

  it("stops with zero output and cannot restart or receive later commands", () => {
    const c = prepared();
    c.start();
    c.step(2);
    c.takeManual();
    c.setManualOutput(100);
    const stopped = c.stop();
    expect(stopped.state).toBe("idle");
    expect(stopped.output).toBe(0);
    c.start();
    c.step(1);
    c.setManualOutput(80);
    c.takeManual();
    expect(c.snapshot).toEqual(stopped);
  });

  it("completes safely at or beyond target end without extrapolation", () => {
    const c = prepared(4);
    c.start();
    c.step(2);
    const completed = c.step(3);
    expect(completed.state).toBe("completed");
    expect(completed.elapsed).toBe(4);
    expect(completed.targetBt).toBeCloseTo(101.2);
    expect(completed.output).toBe(0);
    c.start();
    c.step(1);
    c.setManualOutput(80);
    expect(c.snapshot).toEqual(completed);
  });

  it("clones prepared references and all returned snapshots", () => {
    const samples = target();
    const c = new TrackingController();
    c.prepare(samples, 0);
    samples[1].bt = 490;
    const s = c.snapshot;
    s.samples[0].bt = 480;
    s.output = 100;
    c.start();
    expect(c.step(2).targetBt).toBeCloseTo(100.6);
    expect(c.snapshot.samples[0].bt).toBe(100);
  });

  it.each([
    ["one point", [{ t: 0, bt: 100, et: null }]],
    [
      "null BT",
      [
        { t: 0, bt: 100, et: null },
        { t: 2, bt: null, et: null },
      ],
    ],
    [
      "NaN BT",
      [
        { t: 0, bt: 100, et: null },
        { t: 2, bt: NaN, et: null },
      ],
    ],
    [
      "infinite time",
      [
        { t: 0, bt: 100, et: null },
        { t: Infinity, bt: 102, et: null },
      ],
    ],
    [
      "duplicate time",
      [
        { t: 0, bt: 100, et: null },
        { t: 0, bt: 102, et: null },
      ],
    ],
    [
      "out of order",
      [
        { t: 2, bt: 100, et: null },
        { t: 0, bt: 102, et: null },
      ],
    ],
    [
      "long gap",
      [
        { t: 0, bt: 100, et: null },
        { t: 6, bt: 102, et: null },
      ],
    ],
  ])("faults target preflight for %s without nonzero output", (_name, samples) => {
    const c = new TrackingController();
    expect(c.prepare(samples as Sample[], 0).state).toBe("fault");
    expect(c.snapshot.output).toBe(0);
    const faulted = c.snapshot;
    c.start();
    c.step(2);
    expect(c.snapshot).toEqual(faulted);
  });

  it.each([-1, 0, 6, NaN, Infinity])("faults unsafe clock delta %s", (dt) => {
    const c = prepared();
    c.start();
    expect(c.step(dt).state).toBe("fault");
    expect(c.snapshot.output).toBe(0);
  });

  it.each([null, NaN, Infinity, -51, 501])(
    "faults missing or invalid supplied sensor value %s",
    (value) => {
      const c = prepared();
      c.start();
      expect(c.step(1, value).state).toBe("fault");
      expect(c.snapshot.output).toBe(0);
    },
  );

  it("uses valid supplied feedback in PID error rather than target-copy feedback", () => {
    const low = prepared(),
      high = prepared();
    low.start();
    high.start();
    expect(low.step(1, 50).output).toBeGreaterThan(high.step(1, 200).output);
  });

  it("does not wind up integral while saturated and cuts heat on reversed error", () => {
    const c = prepared();
    c.start();
    for (let i = 0; i < 40; i++) expect(c.step(1, 0).output).toBe(100);
    expect(c.step(1, 400).output).toBe(0);
  });

  it("preparing a replacement target while running immediately de-energizes", () => {
    const c = prepared();
    c.start();
    c.takeManual();
    c.setManualOutput(90);
    const next = c.prepare(target(20, 20), 20);
    expect(next.state).toBe("ready");
    expect(next.output).toBe(0);
    expect(next.elapsed).toBe(0);
    expect(next.samples).toHaveLength(1);
  });
});

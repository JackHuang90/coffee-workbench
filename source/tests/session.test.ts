import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRoastStore } from "../src/stores/roast";
describe("local roast session", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("plays, pauses and resets deterministic sample playback", () => {
    const s = useRoastStore();
    s.resetPlayback();
    expect(s.cursor).toBe(0);
    s.playing = true;
    s.tick();
    expect(s.cursor).toBe(2);
    s.playing = false;
    s.tick();
    expect(s.cursor).toBe(2);
    s.resetPlayback();
    expect(s.cursor).toBe(0);
  });
  it("records samples only while recording and keeps manual event order", () => {
    const s = useRoastStore();
    s.startRecording();
    expect(s.recording).toBe(true);
    expect(s.curve.samples).toHaveLength(1);
    expect(s.mark("DRY")).toBe(false);
    expect(s.mark("CHARGE")).toBe(true);
    expect(s.mark("CHARGE")).toBe(false);
    s.tick();
    s.tick();
    expect(s.curve.samples).toHaveLength(3);
    expect(s.mark("DRY")).toBe(true);
    expect(s.phase).toBe("browning");
    s.stopRecording();
    const count = s.curve.samples.length;
    s.tick();
    expect(s.curve.samples).toHaveLength(count);
    expect(s.dirty).toBe(true);
  });
  it("keeps explicit-save baseline and does not mutate opened documents", () => {
    const s = useRoastStore();
    const original = s.snapshot();
    s.openCurve(original);
    s.curve.name = "修改后";
    expect(s.dirty).toBe(true);
    expect(original.name).not.toBe("修改后");
    const saved = s.snapshot();
    s.acceptSaved(saved);
    expect(s.dirty).toBe(false);
    s.curve.notes = "new notes";
    s.acceptSaved(saved);
    expect(s.dirty).toBe(true);
  });
  it("does not allow an event marker outside a recording", () => {
    const s = useRoastStore();
    expect(s.mark("CHARGE")).toBe(false);
  });
  it("does not present an old sample as current during an imported-data gap", () => {
    const s = useRoastStore(),
      curve = s.snapshot();
    curve.samples = curve.samples.filter((p) => p.t <= 60 || p.t === 600);
    curve.markers = [];
    s.openCurve(curve);
    s.cursor = 522;
    expect(s.current).toBeUndefined();
    s.cursor = 62;
    expect(s.current?.t).toBe(60);
  });
});
describe("expanded manual event editing", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("captures available event temperature and supports undo without fabricating events", () => {
    const s = useRoastStore();
    s.startRecording();
    expect(s.mark("CHARGE")).toBe(true);
    expect(s.curve.markers[0]).toMatchObject({
      bt: 180,
      source: "manual",
      temperatureSource: "sample",
    });
    s.tick();
    expect(s.mark("DRY")).toBe(true);
    s.tick();
    expect(s.mark("FCs")).toBe(true);
    s.tick();
    expect(s.mark("FCe")).toBe(true);
    s.tick();
    expect(s.mark("DROP")).toBe(true);
    expect(s.mark("SCs")).toBe(false);
    expect(s.undoMarker()).toBe(true);
    expect(s.curve.markers.at(-1)?.kind).toBe("FCe");
    expect(s.editMarker("FCe", 1)).toBe(false);
    expect(s.editMarker("FCe", 5)).toBe(true);
    expect(s.curve.markers.at(-1)).toMatchObject({ t: 5, temperatureSource: "interpolated" });
  });
});
describe("simulation lifecycle boundaries", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("does not move playback after a completed simulation", () => {
    const s = useRoastStore();
    s.reference = {
      ...s.snapshot(),
      samples: [
        { t: 0, bt: 100, et: 110 },
        { t: 2, bt: 102, et: 112 },
      ],
      markers: [{ kind: "CHARGE", t: 0 }],
    };
    s.startTracking();
    s.stepTracking(2);
    expect(s.tracking.state).toBe("completed");
    s.cursor = 0;
    s.stepTracking(1);
    expect(s.cursor).toBe(0);
  });
  it("preserves explicit corrections and legacy provenance when editing v1", () => {
    const s = useRoastStore();
    const old = s.snapshot();
    old.schemaVersion = 1;
    delete old.source;
    s.openCurve(old);
    expect(s.editMarker("DRY", 241)).toBe(true);
    expect(s.curve.schemaVersion).toBe(2);
    expect(s.curve.source).toBe("legacy");
    expect(s.curve.markers[0].source).toBe("legacy");
    expect(s.curve.markers[1]).toMatchObject({
      source: "manual",
      t: 241,
      temperatureSource: "interpolated",
    });
  });
  it("cannot confirm an arbitrary turning point outside measured coverage", () => {
    const s = useRoastStore();
    s.startRecording();
    s.mark("CHARGE");
    expect(s.confirmTurningPoint(900)).toBe(false);
    expect(s.confirmTurningPoint(0)).toBe(false);
    expect(s.curve.markers).toHaveLength(1);
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRoastStore } from "../src/stores/roast";
import { DraftRepository } from "../src/data/drafts";
import { validateCurve } from "../src/core/serialization";
import { createDemoCurve } from "../src/core/simulation";
import type { DeviceSnapshot } from "../src/core/device";
import type { DeviceStatus } from "../src/core/device-schema.mjs";

const snapshot = (uptime: number, receivedAt = 1000): DeviceSnapshot => ({
  state: "connected",
  ip: null,
  receivedAt,
  readOnly: true,
  rttMs: null,
  diagnostic: "",
  status: {
    uptime_ms: uptime,
    session: 1,
    source: "virtual_demo",
    mode: "VIRTUAL_DEMO",
    sensor_valid: true,
    bt: 120,
    et: 160,
  } as DeviceStatus,
});
beforeEach(() => setActivePinia(createPinia()));
describe("recording and recovery", () => {
  it("does not let an incomplete reference block the next record's persistence", () => {
    const s = useRoastStore();
    s.startRecording();
    s.stopRecording();
    s.reference = s.snapshot();
    s.startRecording();
    s.tick();
    expect(() => validateCurve(s.snapshot())).not.toThrow();
    expect(s.curve.journal?.reference).toBeUndefined();
    expect(s.curve.journal?.actions.some((a) => a.text.includes("参考"))).toBe(true);
  });
  it("hides current readings when device capture becomes stale", () => {
    const s = useRoastStore();
    s.startDeviceRecording(snapshot(1000), 1000);
    expect(s.current?.bt).toBe(120);
    s.appendDeviceSample(snapshot(2000), 5000);
    expect(s.current).toBeUndefined();
    expect(s.deviceInterrupted).toBe(true);
    s.appendDeviceSample(snapshot(7000, 6000), 6000);
    expect(s.current?.bt).toBe(120);
    expect(s.deviceInterrupted).toBe(false);
  });
  it("retains edited legacy weights in a draft without migrating the library", async () => {
    const db = new DraftRepository(`legacy-draft-${crypto.randomUUID()}`);
    const c = createDemoCurve();
    c.schemaVersion = 1;
    delete c.source;
    c.inputWeight = 300;
    c.outputWeight = 255;
    await db.save(c);
    expect((await db.list())[0]).toMatchObject({
      schemaVersion: 1,
      inputWeight: 300,
      outputWeight: 255,
    });
    db.close();
  });
  it("preserves the first sample in isolated drafts and never overwrites another draft", async () => {
    const db = new DraftRepository(`draft-test-${crypto.randomUUID()}`);
    const a = createDemoCurve();
    a.samples = a.samples.slice(0, 1);
    a.markers = [];
    const b = { ...a, id: "second" };
    await db.save(a);
    await db.save(b);
    expect((await db.list()).length).toBe(2);
    await db.remove(a.id);
    expect((await db.list())[0].id).toBe("second");
    db.close();
  });
  it("restores an interrupted recording without resuming playback, simulation or device capture", () => {
    const s = useRoastStore();
    s.startRecording();
    s.mark("CHARGE");
    const draft = s.snapshot();
    s.restoreDraft(draft);
    expect(s.recording).toBe(false);
    expect(s.playing).toBe(false);
    expect(s.trackingActive).toBe(false);
    expect(s.deviceRecording).toBe(false);
    expect(s.curve.journal?.actions.at(-1)?.text).toContain("恢复");
  });
  it("pins a reference snapshot and records manual takeover", () => {
    const s = useRoastStore();
    s.startTracking();
    s.takeManual();
    expect(s.curve.journal?.actions.at(-1)?.text).toContain("手动");
    const prior = s.curve.journal?.reference?.samples[0].bt;
    s.reference!.samples[0].bt = 350;
    expect(s.curve.journal?.reference?.samples[0].bt).toBe(prior);
  });
  it("deduplicates telemetry, leaves gaps and stops on device clock reset", () => {
    const s = useRoastStore();
    expect(s.startDeviceRecording(snapshot(1000), 1000)).toBe(true);
    s.appendDeviceSample(snapshot(1000), 1000);
    expect(s.curve.samples.length).toBe(1);
    s.appendDeviceSample(snapshot(2000), 5000);
    expect(s.curve.samples.length).toBe(1);
    s.appendDeviceSample(snapshot(7000, 6000), 6000);
    expect(s.curve.samples.some((p) => p.bt === null)).toBe(true);
    s.appendDeviceSample(snapshot(100, 7000), 7000);
    expect(s.recording).toBe(false);
    expect(s.curve.source).toBe("device-demo");
    expect(s.curve.journal?.actions.at(-1)?.text).toContain("重置");
  });
});

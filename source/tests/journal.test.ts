import { describe, expect, it } from "vitest";
import { createDemoCurve } from "../src/core/simulation";
import { exportJSON, parseJSON } from "../src/core/serialization";
import {
  compareRoasts,
  summarizeRoast,
  snapshotReference,
  deviationTrend,
} from "../src/core/journal";

describe("portable roast journal", () => {
  it("does not describe a trend across missing reference samples between observation times", () => {
    const current = Array.from({ length: 11 }, (_, i) => ({ t: i * 2, bt: 100, et: null }));
    const reference = Array.from({ length: 21 }, (_, i) => ({
      t: i,
      bt: i === 5 ? null : 100,
      et: null,
    }));
    expect(deviationTrend(current, reference, 20)).toContain("缺测");
  });
  it("only reports completed development from confirmed boundaries", () => {
    const c = createDemoCurve();
    c.markers = [
      { kind: "CHARGE", t: 0 },
      { kind: "FCs", t: 400 },
    ];
    expect(summarizeRoast(c).development).toBeNull();
    expect(summarizeRoast(c).dtr).toBeNull();
  });
  it("compares event timing relative to each charge, independently of alignment", () => {
    const a = createDemoCurve(),
      b = createDemoCurve();
    a.markers = [
      { kind: "CHARGE", t: 20 },
      { kind: "FCs", t: 420 },
      { kind: "DROP", t: 500 },
    ];
    b.markers = [
      { kind: "CHARGE", t: 0 },
      { kind: "FCs", t: 380 },
      { kind: "DROP", t: 480 },
    ];
    expect(compareRoasts(a, b).find((x) => x.key === "firstCrack")?.delta).toBe(20);
    expect(compareRoasts(a, b).find((x) => x.key === "development")?.delta).toBe(-20);
  });
  it("preserves tastings and the next experiment in JSON without recursive references", () => {
    const c = createDemoCurve();
    c.journal = {
      bean: "耶加雪菲",
      machine: "小滚筒",
      roastDate: "2026-10-27",
      tastings: [{ id: "t1", date: "2026-10-30", method: "手冲", notes: "甜感清晰" }],
      experiment: { goal: "改善口感", change: "缩短发展 10 秒", keep: "同豆同装量" },
      actions: [],
    };
    c.journal.reference = snapshotReference(c);
    const restored = parseJSON(exportJSON(c));
    expect(restored.journal?.tastings[0]?.notes).toBe("甜感清晰");
    expect(restored.journal?.reference?.journal).toBeUndefined();
    expect(restored.journal?.experiment?.change).toBe("缩短发展 10 秒");
  });
  it("rejects oversized notes, invalid dates and recursive journal snapshots", () => {
    const c = createDemoCurve();
    const base = { bean: "", machine: "", roastDate: "", tastings: [], actions: [] };
    expect(() =>
      parseJSON(JSON.stringify({ ...c, journal: { ...base, roastDate: "2026-02-30" } })),
    ).toThrow();
    expect(() =>
      parseJSON(
        JSON.stringify({
          ...c,
          journal: {
            ...base,
            tastings: [{ id: "a", date: "2026-10-30", method: "", notes: "a".repeat(2001) }],
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseJSON(JSON.stringify({ ...c, journal: { ...base, reference: { ...c, journal: base } } })),
    ).toThrow();
  });
});

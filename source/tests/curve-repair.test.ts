/** 功能：验证贝塞尔短缺口补全的边界、单调性和原始数据保护。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { describe, expect, it } from "vitest";
import { temperatureGeometry, estimateGap } from "../src/core/curve-repair";
import type { Sample } from "../src/core/types";

describe("display-only Bezier gap repair", () => {
  it("fills bounded nulls independently by channel and never mutates source samples", () => {
    const samples: Sample[] = [98, 100, null, 106, 108].map((bt, i) => ({
      t: i * 2,
      bt,
      et: null,
    }));
    const before = JSON.stringify(samples),
      geometry = temperatureGeometry(samples, "bt");
    expect(geometry.gaps).toHaveLength(1);
    expect(geometry.runs.map((run) => run.length)).toEqual([2, 2]);
    const gap = geometry.gaps[0];
    expect(estimateGap(gap, 2)).toBe(100);
    expect(estimateGap(gap, 6)).toBe(106);
    expect(estimateGap(gap, 4)).toBeCloseTo(103);
    expect(estimateGap(gap, 1)).toBeNull();
    expect(estimateGap(gap, NaN)).toBeNull();
    expect(temperatureGeometry(samples, "et").gaps).toEqual([]);
    expect(JSON.stringify(samples)).toBe(before);
  });
  it.each([
    [0, 100, 101, 500],
    [500, 101, 100, 0],
    [110, 100, 110, 90],
    [90, 100, 100, 120],
  ])("keeps estimates inside endpoint range for steep and reversing slopes %j", (a, b, c, d) => {
    const samples = [a, b, null, c, d].map((bt, i) => ({ t: i * 2, bt, et: null }));
    const gap = temperatureGeometry(samples, "bt").gaps[0];
    let last = b;
    for (let t = 2; t <= 6; t += 0.05) {
      const value = estimateGap(gap, t)!;
      expect(value).toBeGreaterThanOrEqual(Math.min(b, c) - 1e-8);
      expect(value).toBeLessThanOrEqual(Math.max(b, c) + 1e-8);
      expect((value - last) * Math.sign(c - b)).toBeGreaterThanOrEqual(-1e-8);
      last = value;
    }
  });
  it("detects missing timestamps from established cadence and splits the measured line", () => {
    const samples = [0, 2, 4, 8, 10, 12].map((t) => ({ t, bt: 100 + t, et: 200 }));
    const geometry = temperatureGeometry(samples, "bt");
    expect(geometry.gaps).toHaveLength(1);
    expect(geometry.runs.map((run) => run.length)).toEqual([3, 3]);
    expect(estimateGap(geometry.gaps[0], 6)).toBeCloseTo(106);
    expect(temperatureGeometry(samples.slice(0, 3), "bt").gaps).toEqual([]);
  });
  it("does not extrapolate edges or bridge long outages and missing channels", () => {
    const samples = [0, 2, 4, 6, 8, 10, 50, 52].map((t) => ({
      t,
      bt: t === 0 || t === 52 ? null : 100 + t,
      et: null,
    }));
    expect(temperatureGeometry(samples, "bt").gaps).toEqual([]);
    expect(temperatureGeometry([], "bt").runs).toEqual([]);
    const slow = [0, 20, 40, 60, 80, 120, 140].map((t) => ({ t, bt: 100, et: null }));
    expect(temperatureGeometry(slow, "bt").maxGapSeconds).toBe(30);
    expect(temperatureGeometry(slow, "bt").gaps).toEqual([]);
  });
  it("rejects ambiguous chronology instead of sorting or inventing samples", () => {
    for (const times of [
      [0, 2, 2, 4],
      [0, 4, 2, 6],
      [0, NaN, 4],
    ]) {
      const geometry = temperatureGeometry(
        times.map((t) => ({ t, bt: 100, et: null })),
        "bt",
      );
      expect(geometry.gaps).toEqual([]);
      expect(geometry.runs).toEqual([]);
    }
  });
});

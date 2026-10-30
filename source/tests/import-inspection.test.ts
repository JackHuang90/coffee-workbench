/** 功能：验证导入检查真实统计和控制事件识别边界。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
import { describe, expect, it } from "vitest";
import { importALOG } from "../src/core/alog";
import { createDemoCurve } from "../src/core/simulation";
import * as inspection from "../src/core/import-inspection";

const raw = (extra = "") =>
  `{'title': '检查曲线', 'mode': 'F', 'timex': [-2, 0, 2, 4], 'temp1': [-1, -1, -1, -1], 'temp2': [212, -1, 392, 410], 'timeindex': [1, 0, 2, 0, 0, 0, 3, 0]${extra}}`;
describe("import inspection", () => {
  it("reads missing marker temperatures from actual samples and labels interpolation", () => {
    const curve = createDemoCurve();
    curve.markers = [
      { kind: "CHARGE", t: 0 },
      { kind: "FCs", t: 3 },
    ];
    curve.samples = [
      { t: 0, bt: 100, et: null },
      { t: 2, bt: 102, et: null },
      { t: 4, bt: 104, et: null },
    ];
    const result = inspection.inspectImport(curve);
    expect(result.events[0]).toMatchObject({ bt: 100, temperatureSource: "sample" });
    expect(result.events[1]).toMatchObject({ bt: 103, temperatureSource: "interpolated" });
  });
  it("counts valid BT and ET separately and previews events relative to charge", () => {
    const result = inspection.inspectImport(importALOG(raw()));
    expect(result.channels.bt).toEqual({ valid: 3, missing: 1, min: 100, max: 210 });
    expect(result.channels.et).toEqual({ valid: 0, missing: 4, min: null, max: null });
    expect(result.events.map((event) => [event.kind, event.seconds])).toEqual([
      ["CHARGE", 0],
      ["FCs", 2],
      ["DROP", 4],
    ]);
    expect(result.originalUnit).toBe("F");
  });
  it("uses declared event names, not fixed numeric type assumptions", () => {
    const result = inspection.inspectImport(
      importALOG(
        raw(
          ", 'etypes': ['Air', 'Power', 'Speed'], 'specialevents': [0, 1, 2], 'specialeventstype': [1, 0, 2], 'specialeventsvalue': [5, 6, 7], 'specialeventsStrings': ['', '', '']",
        ),
      ),
    );
    expect(result.controls).toMatchObject({ heat: 1, air: 1, other: 1, unknown: 0, total: 3 });
  });
  it("marks unmapped and structurally invalid events as unconfirmed", () => {
    const unmapped = inspection.inspectImport(
      importALOG(
        raw(
          ", 'specialevents': [1], 'specialeventstype': [0], 'specialeventsvalue': [5], 'specialeventsStrings': ['Power']",
        ),
      ),
    );
    expect(unmapped.controls).toMatchObject({ heat: 0, air: 0, unknown: 1 });
    const broken = inspection.inspectImport(
      importALOG(
        raw(
          ", 'etypes': ['Power'], 'specialevents': [1, 999], 'specialeventstype': [0], 'specialeventsvalue': [5, 6], 'specialeventsStrings': ['', '']",
        ),
      ),
    );
    expect(broken.controls).toMatchObject({ heat: 0, air: 0, unknown: 2 });
    expect(broken.controls.warnings.length).toBeGreaterThan(0);
  });
  it("keeps missing milestones missing and uses first sample when charge is absent", () => {
    const result = inspection.inspectImport(
      importALOG(raw().replace("[1, 0, 2, 0, 0, 0, 3, 0]", "[-1, 0, 0, 0, 0, 0, 0, 0]")),
    );
    expect(result.events.map((event) => event.seconds)).toEqual([null, null, null]);
    expect(result.hasCharge).toBe(false);
  });
});

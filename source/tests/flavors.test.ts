/** 功能：验证风味标签的持久化和原生交换，防止选择静默丢失。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
import { describe, expect, it } from "vitest";
import { createDemoCurve } from "../src/core/simulation";
import { exportJSON, parseJSON, upgradeCurve, validateCurve } from "../src/core/serialization";
import { exportALOG, importALOG } from "../src/core/alog";
import { CurveLibrary } from "../src/data/library";
import { parsePythonLiteral, literalToValue } from "../src/core/pythonLiteral";

describe("personal flavor selections", () => {
  it("preserves selected descriptors through validation, JSON and browser storage", async () => {
    const curve = { ...createDemoCurve(), flavorTags: ["jasmine", "cocoa"] };
    expect(parseJSON(exportJSON(curve)).flavorTags).toEqual(["jasmine", "cocoa"]);
    const library = new CurveLibrary("flavor-roundtrip");
    try {
      await library.save(curve);
      expect((await library.list())[0].flavorTags).toEqual(["jasmine", "cocoa"]);
    } finally {
      library.close();
    }
  });
  it("deduplicates recognized tags and rejects malformed or unknown descriptors", () => {
    expect(
      validateCurve({ ...createDemoCurve(), flavorTags: ["jasmine", "jasmine"] }).flavorTags,
    ).toEqual(["jasmine"]);
    for (const value of ["jasmine", [null], ["<script>"], Array(65).fill("jasmine")]) {
      expect(() => validateCurve({ ...createDemoCurve(), flavorTags: value })).toThrow(/风味/);
    }
    const old = { ...createDemoCurve(), schemaVersion: 1 as const, flavorTags: ["cocoa"] };
    expect(upgradeCurve(old).flavorTags).toEqual(["cocoa"]);
    expect(validateCurve(createDemoCurve())).not.toHaveProperty("flavorTags");
  });
  it("round-trips flavor tags in a dedicated alog extension and preserves unedited source", () => {
    const curve = { ...createDemoCurve(), flavorTags: ["jasmine", "cocoa"] };
    const text = exportALOG(curve).text;
    const restored = importALOG(text);
    expect(restored.flavorTags).toEqual(["jasmine", "cocoa"]);
    expect(exportALOG(restored).text).toBe(text);
    restored.flavorTags = [];
    expect(importALOG(exportALOG(restored).text).flavorTags).toEqual([]);
  });
  it("preserves Artisan cupping fields when adding personal descriptors", () => {
    const source =
      "{'title': '原生杯测', 'mode': 'C', 'timex': [0, 2], 'temp1': [200, 201], 'temp2': [180, 181], 'timeindex': [0, 0, 0, 0, 0, 0, 0, 0], 'flavors': [8, 7.5], 'flavorlabels': ['Body', 'Sweetness'], 'cuppingnotes': 'keep original'}";
    const curve = importALOG(source);
    curve.flavorTags = ["jasmine"];
    const result = literalToValue(parsePythonLiteral(exportALOG(curve).text)) as Record<
      string,
      unknown
    >;
    expect(result.flavors).toEqual([8, 7.5]);
    expect(result.flavorlabels).toEqual(["Body", "Sweetness"]);
    expect(result.cuppingnotes).toBe("keep original");
  });
});

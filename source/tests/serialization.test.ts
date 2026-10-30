import { describe, expect, it } from "vitest";
import {
  exportCSV,
  exportJSON,
  parseCSV,
  parseJSON,
  validateCurve,
} from "../src/core/serialization";
import type { RoastCurve } from "../src/core/types";

const valid = (): RoastCurve => ({
  schemaVersion: 1,
  id: "roast-123",
  name: "日晒埃塞俄比亚",
  notes: "200g",
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
  samples: [
    { t: 0, bt: 160, et: 200 },
    { t: 2, bt: null, et: 202 },
    { t: 4, bt: 150, et: null },
  ],
  markers: [
    { kind: "CHARGE", t: 0 },
    { kind: "DROP", t: 4 },
  ],
});

// Each malformed fixture targets a distinct validation boundary, not parser internals.
describe("bounded curve validation", () => {
  it("returns an independent normalized allowlisted shape", () => {
    const source = valid();
    const parsed = validateCurve({
      ...source,
      name: "  日晒埃塞俄比亚  ",
      secret: "discard",
      samples: source.samples.map((s) => ({ ...s, unexpected: 1 })),
      markers: source.markers.map((m) => ({ ...m, unknown: true })),
    });
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.samples).not.toBe(source.samples);
  });
  it.each([null, [], true, 1, "curve"])("rejects a non-record %s", (input) => {
    expect(() => validateCurve(input)).toThrow();
  });
  it.each([0, 3, "1", null])("rejects schema version %s", (schemaVersion) => {
    expect(() => validateCurve({ ...valid(), schemaVersion })).toThrow(/schemaVersion/);
  });
  it.each(["", "   ", "x".repeat(121)])("rejects an invalid name", (name) => {
    expect(() => validateCurve({ ...valid(), name })).toThrow(/name/);
  });
  it("bounds notes, IDs, and ISO dates", () => {
    expect(() => validateCurve({ ...valid(), notes: "x".repeat(4001) })).toThrow(/notes/);
    for (const id of ["", "../bad", "<script>", "x".repeat(129)])
      expect(() => validateCurve({ ...valid(), id })).toThrow(/id/);
    for (const createdAt of ["", "yesterday", "2026-02-30T00:00:00.000Z", "2026-10-28"])
      expect(() => validateCurve({ ...valid(), createdAt })).toThrow(/createdAt/);
    expect(() => validateCurve({ ...valid(), updatedAt: null })).toThrow(/updatedAt/);
  });
  it("rejects sparse arrays instead of silently preserving unvalidated holes", () => {
    const samples = new Array(2);
    samples[0] = { t: 0, bt: 100, et: 200 };
    expect(() => validateCurve({ ...valid(), samples, markers: [] })).toThrow(/samples/);
    expect(() => validateCurve({ ...valid(), markers: new Array(1) })).toThrow(/markers/);
  });
  it("requires two samples and accepts the documented maximum count", () => {
    expect(() => validateCurve({ ...valid(), samples: [] })).toThrow(/samples/);
    expect(() => validateCurve({ ...valid(), samples: [valid().samples[0]] })).toThrow(/samples/);
    const samples = Array.from({ length: 15000 }, (_, t) => ({
      t,
      bt: null,
      et: 200,
    }));
    expect(validateCurve({ ...valid(), samples }).samples).toHaveLength(15000);
    expect(() =>
      validateCurve({
        ...valid(),
        samples: [...samples, { t: 15000, bt: null, et: 200 }],
      }),
    ).toThrow(/15000/);
  });
  it.each([-1, Number.NaN, Infinity, 86401, "2", null])("rejects invalid sample time %s", (t) => {
    expect(() =>
      validateCurve({
        ...valid(),
        samples: [
          { t, bt: 150, et: 200 },
          { t: 4, bt: 160, et: 210 },
        ],
      }),
    ).toThrow(/samples/);
  });
  it("rejects duplicate or descending sample times", () => {
    for (const t of [0, -2])
      expect(() =>
        validateCurve({
          ...valid(),
          samples: [
            { t: 0, bt: 100, et: null },
            { t, bt: 101, et: null },
          ],
        }),
      ).toThrow(/samples/);
  });
  it.each([Number.NaN, Infinity, -51, 501, "", "100", undefined])(
    "rejects invalid temperature %s rather than coercing it",
    (bt) => {
      expect(() =>
        validateCurve({
          ...valid(),
          samples: [
            { t: 0, bt, et: 200 },
            { t: 4, bt: 160, et: 210 },
          ],
        }),
      ).toThrow(/samples/);
    },
  );
  it("accepts null channels and inclusive temperature/time boundaries", () => {
    const curve = validateCurve({
      ...valid(),
      samples: [
        { t: 0, bt: -50, et: null },
        { t: 86400, bt: 500, et: null },
      ],
      markers: [],
    });
    expect(curve.samples[1]).toEqual({ t: 86400, bt: 500, et: null });
  });
  it.each([
    [{ kind: "UNKNOWN", t: 0 }],
    [
      { kind: "CHARGE", t: 0 },
      { kind: "CHARGE", t: 2 },
    ],
    [
      { kind: "DROP", t: 0 },
      { kind: "DRY", t: 2 },
    ],
    [
      { kind: "CHARGE", t: 2 },
      { kind: "DRY", t: 0 },
    ],
    [{ kind: "CHARGE", t: -1 }],
    [{ kind: "DROP", t: 5 }],
    [{ kind: "DROP", t: "4" }],
  ])("rejects invalid marker sequence %j", (...markers) => {
    expect(() => validateCurve({ ...valid(), markers })).toThrow(/markers/);
  });
  it("accepts same-second ordered manual markers and subsets", () => {
    expect(
      validateCurve({
        ...valid(),
        markers: [
          { kind: "CHARGE", t: 0 },
          { kind: "DRY", t: 0 },
        ],
      }).markers,
    ).toHaveLength(2);
    expect(validateCurve({ ...valid(), markers: [{ kind: "FCs", t: 2 }] }).markers[0].kind).toBe(
      "FCs",
    );
  });
});

describe("JSON interchange", () => {
  it("round trips metadata, manual events and missing channels", () => {
    expect(parseJSON(exportJSON(valid()))).toEqual(valid());
  });
  it("reports malformed JSON without accepting nonfinite values", () => {
    expect(() => parseJSON("{bad")).toThrow(/JSON/);
    expect(() => parseJSON('{"schemaVersion":1,"samples":[NaN]}')).toThrow(/JSON/);
    expect(() =>
      exportJSON({
        ...valid(),
        samples: [
          { t: 0, bt: Infinity, et: null },
          { t: 2, bt: 1, et: null },
        ],
      }),
    ).toThrow();
  });
  it("rejects JSON text over 8 MiB before parsing, including UTF-8 multibyte input", () => {
    expect(() => parseJSON(" ".repeat(8388609))).toThrow(/8.*MB|8.*MiB/);
    expect(() => parseJSON("焙".repeat(2800000))).toThrow(/8.*MB|8.*MiB/);
  });
});

describe("basic CSV interchange", () => {
  it("round trips samples with blank cells for unavailable channels", () => {
    expect(exportCSV(valid())).toBe("time_s,bt_c,et_c\n0,160,200\n2,,202\n4,150,\n");
    const curve = parseCSV(exportCSV(valid()));
    expect(curve.samples).toEqual(valid().samples);
    expect(curve.name).toMatch(/[\u4e00-\u9fff]/);
    expect(curve.markers).toEqual([]);
  });
  it("accepts CRLF, BOM, and either optional channel without inventing data", () => {
    expect(parseCSV("\uFEFFtime_s,bt_c\r\n0,100\r\n2,\r\n").samples).toEqual([
      { t: 0, bt: 100, et: null },
      { t: 2, bt: null, et: null },
    ]);
    expect(parseCSV("et_c,time_s\n200,0\n201,2").samples).toEqual([
      { t: 0, bt: null, et: 200 },
      { t: 2, bt: null, et: 201 },
    ]);
  });
  it.each([
    "t,bt_c\n0,1\n2,2",
    "time_s\n0\n2",
    "time_s,bt_c,bt_c\n0,1,2\n2,2,3",
    "time_s,bt_c,extra\n0,1,2\n2,2,3",
  ])("rejects ambiguous or unsupported headers", (csv) => {
    expect(() => parseCSV(csv)).toThrow(/header/i);
  });
  it.each(["2junk", "NaN", "Infinity", "0x10", "1e999", "true"])(
    "rejects malformed numeric cell %s with its row",
    (cell) => {
      expect(() => parseCSV(`time_s,bt_c\n0,100\n2,${cell}`)).toThrow(/row 3/i);
    },
  );
  it.each([
    "time_s,bt_c\n0,100\n,101",
    "time_s,bt_c\n0,100\n2,101,200",
    "time_s,bt_c\n0,100\n0,101",
    "time_s,bt_c\n0,100\n2,501",
  ])("provides helpful row errors for bad data", (csv) => {
    expect(() => parseCSV(csv)).toThrow(/row 3/i);
  });
  it("bounds CSV input and refuses single-sample files", () => {
    expect(() => parseCSV(" ".repeat(2097153))).toThrow(/2.*MB|2.*MiB/);
    expect(() => parseCSV("time_s,bt_c\n0,100")).toThrow(/samples/);
  });
});

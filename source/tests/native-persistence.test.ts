import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createDemoCurve } from "../src/core/simulation";
import { validateCurve, upgradeCurve, exportJSON, parseJSON } from "../src/core/serialization";
import { CurveLibrary } from "../src/data/library";

const sourceText =
  "{'title': 'native', 'timex': [-1.25, 0.0, 1.0], 'temp1': [200, 201, 202], 'temp2': [180, 181, 182], 'timeindex': [1, 0, 0, 0, 0, 0, 0, 0], 'mode': 'C', 'unknown': ('keep', None)}";
const attached = () => ({
  ...createDemoCurve(),
  nativeArtisan: {
    format: "artisan-alog" as const,
    version: 1 as const,
    sourceText,
    displayOriginSeconds: -1.25,
    sourceName: "native.alog",
  },
});
const instances: CurveLibrary[] = [];
const repository = () => {
  const lib = new CurveLibrary("native-persistence");
  instances.push(lib);
  return lib;
};
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  instances.splice(0).forEach((lib) => lib.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("optional native attachment preservation", () => {
  it("keeps the original native document through validation, explicit upgrade and JSON backup", () => {
    const value = attached();
    expect(validateCurve(value).nativeArtisan).toEqual(value.nativeArtisan);
    expect(upgradeCurve({ ...value, schemaVersion: 1 }).nativeArtisan).toEqual(value.nativeArtisan);
    expect(parseJSON(exportJSON(value)).nativeArtisan).toEqual(value.nativeArtisan);
  });
  it("retains existing v1 and v2 records byte-for-byte on read and stores native attachment alongside them", async () => {
    const lib = repository();
    const old = { ...createDemoCurve(), schemaVersion: 1 as const, id: "legacy", notes: "旧版本" };
    delete old.source;
    const v2 = { ...createDemoCurve(), id: "v2", notes: "第二版" };
    await lib.save(old);
    await lib.save(v2);
    await lib.save({ ...attached(), id: "native" });
    lib.close();
    const all = await repository().list();
    expect(all.find((c) => c.id === "legacy")).toEqual(old);
    expect(all.find((c) => c.id === "v2")).toEqual(v2);
    expect(all.find((c) => c.id === "native")?.nativeArtisan?.sourceText).toBe(sourceText);
  });
  it("leaves the original native attachment intact when an explicit replacement exceeds quota", async () => {
    const lib = repository();
    const value = attached();
    await lib.save(value);
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await expect(lib.save({ ...value, notes: "not committed" })).rejects.toThrow(/空间不足/);
    expect(await lib.list()).toEqual([value]);
  });
  it("rejects malformed or executable native attachments instead of retaining unvalidated backup data", () => {
    expect(() =>
      validateCurve({
        ...attached(),
        nativeArtisan: { ...attached().nativeArtisan, sourceText: "__import__('os').system('no')" },
      }),
    ).toThrow();
  });
});

it("restores a large native attachment from its expanded JSON backup under a separate bounded JSON limit", () => {
  const base = sourceText.slice(0, -1);
  const opaque = Array.from(
    { length: 7 },
    (_, i) => `, 'opaque${i}': '${"\\\\".repeat(130000)}'`,
  ).join("");
  const value = {
    ...attached(),
    nativeArtisan: { ...attached().nativeArtisan, sourceText: `${base}${opaque}}` },
  };
  const serialized = exportJSON(value);
  expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(2 * 1024 * 1024);
  expect(parseJSON(serialized).nativeArtisan?.sourceText).toBe(value.nativeArtisan.sourceText);
});

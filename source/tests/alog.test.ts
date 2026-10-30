/** 功能：验证 Artisan 文件解析、元数据与原文往返。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 使用 unknown 显式描述未验证字段，配合 ESLint 检查。 */
import { describe, expect, it } from "vitest";
import { importALOG, exportALOG, summarizeALOG, validateNativeAttachment } from "../src/core/alog";
import { parsePythonLiteral, literalToValue, writePythonLiteral } from "../src/core/pythonLiteral";
import user from "./fixtures/artisan/user-sanitized-v3.0.2.alog?raw";
import profile1 from "./fixtures/artisan/official-profile1.alog?raw";
import profile2 from "./fixtures/artisan/official-profile2.alog?raw";
import profile3 from "./fixtures/artisan/official-profile3.alog?raw";
import profile4 from "./fixtures/artisan/official-profile4.alog?raw";
import oracle1 from "./fixtures/artisan/official-profile1.json";
import oracle2 from "./fixtures/artisan/official-profile2.json";
import oracle3 from "./fixtures/artisan/official-profile3.json";
import oracle4 from "./fixtures/artisan/official-profile4.json";
const basic = (extra = "") =>
  `{'title': 'test', 'roastingnotes': '', 'mode': 'C', 'timex': [-2.5, -1.5, 0.5], 'temp1': [220, -1, 224], 'temp2': [180, -1, 184], 'timeindex': [0, 0, 0, 0, 0, 0, 2, 0]${extra}}`;
/** 功能：将测试字面量转换为未知字段字典。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 将动态字段类型收紧为 unknown。 */
const plain = (text: string) => literalToValue(parsePythonLiteral(text)) as Record<string, unknown>;
describe("bounded Python literal grammar", () => {
  it("retains tuples, unknown nested fields, arbitrary finite integer lexemes and signed zero", () => {
    const input = `{'unknown': (None, True, False, {'large': 90071992547409931234, 'zero': -0.0, 'tuple': (1,)}), 'text': u'\\u5496\\u5561\\x20\\141\\U0001f33f', 'slash': 'C:\\\\new\\\\folder'}`;
    const parsed = parsePythonLiteral(input);
    expect(plain(writePythonLiteral(parsed))).toEqual(plain(input));
    expect(writePythonLiteral(parsed)).toContain("90071992547409931234");
    expect(writePythonLiteral(parsed)).toContain("-0.0");
    expect(plain(input).text).toBe("咖啡 a🌿");
  });
  it.each([
    "{'a': __import__('os').system('boom')}",
    "{'a': [x for x in []]}",
    "{'a': 1+2}",
    "{'a': float('nan')}",
    "{'a': 1e999}",
    "{'a': set()}",
    "{'a': b'bytes'}",
    "{'a': 1};boom()",
    "{'a': 1, 'a': 2}",
    "{'__proto__': {}}",
    "{'a': {'constructor': 1}}",
    "{'a': 'one' 'two'}",
    "{'a': f'hello'}",
    "{1:'bad'}",
    "{'a': 'unterminated}",
  ])("rejects executable, unsupported or unsafe literal %s", (input) =>
    expect(() => parsePythonLiteral(input)).toThrow(),
  );
  it.each(["\u00a0", "\u2028", "\ufeff"])(
    "rejects non-Python whitespace outside strings: %s",
    (separator) => {
      expect(() => parsePythonLiteral(`{'a':${separator}1}`)).toThrow();
      expect(() => parsePythonLiteral(`{'a':1}${separator}`)).toThrow();
      expect(plain(`{'a':'${separator}'}`).a).toBe(separator);
    },
  );
  it("caps depth and UTF-8 size before returning data", () => {
    expect(() => parsePythonLiteral(`{'a':${"[".repeat(65)}0${"]".repeat(65)}}`)).toThrow(
      /深度|depth/,
    );
    expect(() => parsePythonLiteral(`{'a':'${"你".repeat(710000)}'}`)).toThrow(/2 MiB|大小|size/);
  });
});
describe("native Artisan import and export", () => {
  it.each([
    [profile1, oracle1],
    [profile2, oracle2],
    [profile3, oracle3],
    [profile4, oracle4],
  ] as const)(
    "matches pinned official core JSON oracle and preserves full native document",
    (text, oracle) => {
      const raw = plain(text);
      for (const field of [
        "timex",
        "temp1",
        "temp2",
        "timeindex",
        "mode",
        "specialevents",
        "specialeventstype",
        "specialeventsvalue",
        "specialeventsStrings",
      ])
        expect(raw[field]).toEqual((oracle as Record<string, unknown>)[field]);
      const imported = importALOG(text);
      expect(imported.samples).toHaveLength((raw.timex as unknown[]).length);
      expect(exportALOG(imported).text).toBe(text);
      expect(plain(exportALOG(imported).text)).toEqual(raw);
    },
  );
  it("preserves all 794 user samples, 168 fields, negative source time and valid CHARGE index zero", () => {
    const curve = importALOG(user, "sample.alog"),
      raw = plain(user);
    expect(curve.samples).toHaveLength(794);
    expect(Object.keys(raw)).toHaveLength(168);
    expect(curve.samples[0].t).toBe(0);
    expect(curve.nativeArtisan?.displayOriginSeconds).toBe(-12.1597238767);
    expect(curve.markers.map((m) => [m.kind, m.t])).toEqual([
      ["CHARGE", 0],
      ["DRY", 252],
      ["FCs", 552],
      ["DROP", 792],
    ]);
    expect(curve.name).toBe("测试曲线");
    expect(exportALOG(curve).text).toBe(user);
    expect(summarizeALOG(curve)!.extraChannelPairs).toBe(1);
  });
  it("converts F display after recognizing missing -1 and does not rewrite source arrays", () => {
    const text = basic().replace("'mode': 'C'", "'mode': 'F'");
    const curve = importALOG(text);
    expect(curve.samples[0].bt).toBeCloseTo(((180 - 32) * 5) / 9);
    expect(curve.samples[1].bt).toBeNull();
    expect(exportALOG(curve).text).toBe(text);
  });
  it("does not map computed TP into a recorded marker or execute imported event data", () => {
    const curve = importALOG(
      basic(
        ", 'computed': {'TP_idx': 1}, 'externalprogram': 'evil()', 'specialevents': [1], 'specialeventstype': [0], 'specialeventsvalue': [1.1], 'specialeventsStrings': ['fetch(\"http://bad\")']",
      ),
    );
    expect(curve.markers.some((m) => m.kind === "TP")).toBe(false);
    expect(summarizeALOG(curve)!.controlEventCount).toBe(1);
    expect(summarizeALOG(curve)!.warnings.join(" ")).toMatch(/执行|控制/);
  });
  it("edits only named fields, drops invalid signature, keeps recording provenance and unknown nested fields", () => {
    const text = basic(
      ", 'signature':'signed', 'hash':'stale-hash', 'version':'4.2.0', 'revision':'original-revision', 'build':'original-build', 'artisan_os':'original-os', 'recording_version':'3.0.2', 'unknown': (None, {'n':90071992547409931234})",
    );
    const curve = importALOG(text);
    curve.name = "新的标题";
    const output = exportALOG(curve),
      raw = plain(output.text),
      before = plain(text);
    expect(raw.timex).toEqual(before.timex);
    expect(raw.temp1).toEqual(before.temp1);
    expect(raw.temp2).toEqual(before.temp2);
    expect(raw.unknown).toEqual(before.unknown);
    expect(raw.signature).toBeUndefined();
    expect(raw.hash).toBeUndefined();
    expect(raw.recording_version).toBe("3.0.2");
    expect(raw.version).toBe("4.2.0");
    expect(raw.revision).toBe("original-revision");
    expect(raw.build).toBe("original-build");
    expect(raw.artisan_os).toBe("original-os");
    const extension = raw.coffee_console as Record<string, unknown>;
    const provenance = extension.source_provenance as Record<string, unknown>;
    expect(provenance.version).toBe("4.2.0");
    expect(provenance.recording_version).toBe("3.0.2");
    expect(extension.third_party).toBe(true);
    expect(extension.generator_version).toBe("0.1.0");
    expect(importALOG(output.text).notes).toMatch(/修改.*第三方/);
    expect(importALOG(output.text).name).toBe("新的标题");
    expect(output.warnings.join(" ")).toMatch(/第三方|签名/);
  });
  it("changes a marker only within an explicit sample association tolerance", () => {
    const curve = importALOG(basic());
    curve.markers[1].t = 2.9;
    expect(exportALOG(curve).warnings.join(" ")).toMatch(/0.1|采样/);
    curve.markers[1].t = 1.8;
    expect(() => exportALOG(curve)).toThrow(/误差|采样/);
  });
  it("retains non-scalar extras and literal backslashes without repeated global unicode decoding", () => {
    const text = basic(
      ", 'unknown': {'literal':'\\\\u5496', 'tuple':(1,2,None)}, 'extratimex':[[0,1]], 'extratemp1':[[None, {'nested':1}]], 'extratemp2':[[1,2]]",
    );
    const curve = importALOG(text);
    curve.notes = "咖啡 C:\\new\\folder";
    const out = exportALOG(curve).text;
    expect(plain(out).unknown).toEqual(plain(text).unknown);
    expect(plain(out).extratemp1).toEqual(plain(text).extratemp1);
    expect(importALOG(out).notes).toContain("咖啡 C:\\new\\folder");
  });
  it.each([
    basic().replace("[220, -1, 224]", "[220, -1]"),
    basic().replace("[-2.5, -1.5, 0.5]", "[-2.5, -2.5, 0.5]"),
    basic().replace("[0, 0, 0, 0, 0, 0, 2, 0]", "[0, 0, 0, 0, 0, 0, 99, 0]"),
    basic().replace("'mode': 'C'", "'mode': 'K'"),
    basic().replace("[180, -1, 184]", "[True, -1, 184]"),
  ])("rejects unsupported core array/index/unit shapes without truncation", (text) =>
    expect(() => importALOG(text)).toThrow(),
  );
  it("validates native attachments and their explicit display origin", () => {
    const curve = importALOG(basic());
    expect(validateNativeAttachment(curve.nativeArtisan)).toEqual(curve.nativeArtisan);
    expect(() =>
      validateNativeAttachment({ ...curve.nativeArtisan, displayOriginSeconds: 999 }),
    ).toThrow();
    expect(() =>
      validateNativeAttachment({ ...curve.nativeArtisan, sourceText: "{'__proto__':1}" }),
    ).toThrow();
  });
  it("rejects an edited native output that would exceed its own import limits", () => {
    const prefix =
      basic().slice(0, -1) +
      Array.from({ length: 8 }, (_, i) => `, 'large${i}': '${"x".repeat(250000)}'`).join("") +
      ", 'tail': '";
    const source = prefix + "x".repeat(2 * 1024 * 1024 - prefix.length - 12) + "'}";
    const curve = importALOG(source);
    curve.name = "edited";
    expect(() => exportALOG(curve)).toThrow(/2 MiB|size/);
  });
  it("refuses native sample-time edits rather than leaving event and extra-channel associations stale", () => {
    const curve = importALOG(basic());
    curve.samples[1].t = 1.5;
    expect(() => exportALOG(curve)).toThrow(/时间轴/);
  });
  it("does not overwrite a native extension that happens to share our producer key", () => {
    const curve = importALOG(basic(", 'coffee_console': (123, {'other':'author'})"));
    curve.name = "edited";
    expect(plain(exportALOG(curve).text).coffee_console).toEqual([123, { other: "author" }]);
  });
  it("rejects valid temperatures that collide with Artisan missing sentinels", () => {
    const curve = importALOG(basic());
    delete curve.nativeArtisan;
    curve.samples[0].bt = -1;
    expect(() => exportALOG(curve)).toThrow(/哨兵/);
  });
  it("authors genuine unsigned third-party native files without forged Artisan versions", () => {
    const curve = importALOG(basic());
    delete curve.nativeArtisan;
    const out = exportALOG(curve),
      raw = plain(out.text);
    expect(out.text.startsWith("{")).toBe(true);
    expect(raw.mode).toBe("C");
    expect(raw.temp2).toEqual([180, -1, 184]);
    expect(raw.timeindex).toEqual([0, 0, 0, 0, 0, 0, 2, 0]);
    expect(raw.version).toBeUndefined();
    expect(raw.signature).toBeUndefined();
    expect(raw.recording_version).toBeUndefined();
    expect((raw.coffee_console as Record<string, unknown>).generator).toMatch(/coffee|咖啡/i);
    expect(importALOG(out.text).notes).toMatch(/第三方/);
  });
});

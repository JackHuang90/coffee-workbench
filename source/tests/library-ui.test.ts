import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";
import { CurveLibrary } from "../src/data/library";
import { createDemoCurve } from "../src/core/simulation";
import { exportJSON } from "../src/core/serialization";
import { useRoastStore } from "../src/stores/roast";

const clean = async () => {
  const lib = new CurveLibrary();
  for (const c of await lib.list()) await lib.remove(c.id);
  lib.close();
};
beforeEach(clean);
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
const start = () => {
  const pinia = createPinia();
  return {
    w: mount(App, { global: { plugins: [pinia] }, attachTo: document.body }),
    s: useRoastStore(pinia),
  };
};
const button = (w: ReturnType<typeof start>["w"], label: string) => {
  const found = w.findAll("button").find((b) => b.text() === label);
  if (!found) throw new Error(`missing button ${label}`);
  return found;
};

describe("library and import critical flows", () => {
  it("saves, reopens, renames and requires confirmation before deletion", async () => {
    const { w, s } = start();
    await w.get("[data-test=name]").setValue("手冲练习");
    await w.get("[data-test=save]").trigger("click");
    await vi.waitFor(() => expect(w.text()).toContain("已保存到当前浏览器"));
    expect(s.dirty).toBe(false);
    await w.get("[data-test=nav-library]").trigger("click");
    await vi.waitFor(() => expect(w.findAll(".curve-list>li")).toHaveLength(1));
    await button(w, "改名").trigger("click");
    await w.get(".curve-list input").setValue("甜感练习");
    await button(w, "确认改名").trigger("click");
    await vi.waitFor(() => expect(w.get(".curve-list").text()).toContain("甜感练习"));
    await button(w, "作背景").trigger("click");
    expect(s.reference?.name).toBe("甜感练习");
    await w.get("[data-test=nav-library]").trigger("click");
    await button(w, "打开").trigger("click");
    expect((w.get("[data-test=name]").element as HTMLInputElement).value).toBe("甜感练习");
    await w.get("[data-test=nav-library]").trigger("click");
    await button(w, "删除").trigger("click");
    expect(w.find("[role=dialog]").exists()).toBe(true);
    await w.get("[data-test=confirm-cancel]").trigger("click");
    expect(w.findAll(".curve-list>li")).toHaveLength(1);
    await button(w, "删除").trigger("click");
    await w.get("[data-test=confirm-ok]").trigger("click");
    await vi.waitFor(() => expect(w.text()).toContain("还没有保存的曲线"));
    expect(s.savedToLibrary).toBe(false);
    expect(s.dirty).toBe(true);
    w.unmount();
  });
  it("previews validated JSON before opening an unsaved draft without altering metadata", async () => {
    const { w, s } = start(),
      curve = createDemoCurve();
    curve.name = "原始手记";
    curve.notes = "原文保留";
    await w.get("[data-test=nav-library]").trigger("click");
    await w.get("#import-format").setValue("json");
    await w.get("[data-test=import-data]").setValue(exportJSON(curve));
    await w.get("[data-test=preview-import]").trigger("click");
    expect(w.get("[data-test=import-preview]").text()).toContain("校验通过");
    expect(s.curve.name).not.toBe("原始手记");
    await w.get("[data-test=confirm-import]").trigger("click");
    expect(s.curve.name).toBe("原始手记");
    expect(s.curve.notes).toBe("原文保留");
    expect(s.dirty).toBe(true);
    const lib = new CurveLibrary();
    expect(await lib.list()).toHaveLength(0);
    lib.close();
    w.unmount();
  });
  it("rejects invalid imports and previews basic CSV without executing events", async () => {
    const { w, s } = start();
    await w.get("[data-test=nav-library]").trigger("click");
    await w.get("[data-test=import-data]").setValue('{"bad":true}');
    await w.get("[data-test=preview-import]").trigger("click");
    expect(w.find("[role=alert]").exists()).toBe(true);
    expect(w.find("[data-test=import-preview]").exists()).toBe(false);
    await w.get("#import-format").setValue("csv");
    await w.get("[data-test=import-data]").setValue("time_s,bt_c,et_c\n0,180,200\n2,175,198");
    await w.get("[data-test=preview-import]").trigger("click");
    expect(w.get("[data-test=import-preview]").text()).toContain("2 个采样点");
    await w.get("[data-test=confirm-import]").trigger("click");
    expect(s.curve.markers).toEqual([]);
    expect(s.playing).toBe(false);
    w.unmount();
  });
  it("leaves the draft intact on a quota error and allows retry", async () => {
    const original = CurveLibrary.prototype.save;
    let fail = true;
    vi.spyOn(CurveLibrary.prototype, "save").mockImplementation(async function (
      this: CurveLibrary,
      c,
    ) {
      if (fail) throw new Error("存储空间不足，请导出备份。");
      return original.call(this, c);
    });
    const { w, s } = start();
    await w.get("[data-test=name]").setValue("不会丢失");
    await w.get("[data-test=save]").trigger("click");
    await vi.waitFor(() => expect(w.text()).toContain("存储空间不足"));
    expect(s.curve.name).toBe("不会丢失");
    expect(s.dirty).toBe(true);
    fail = false;
    await w.get("[data-test=save]").trigger("click");
    await vi.waitFor(() => expect(s.dirty).toBe(false));
    w.unmount();
  });
  it("supports Escape dismissal without discarding a draft", async () => {
    const { w, s } = start();
    await w.get("[data-test=name]").setValue("保留");
    await w.get("[data-test=start-recording]").trigger("click");
    await flushPromises();
    await w.get("[role=dialog]").trigger("keydown", { key: "Escape" });
    expect(w.find("[role=dialog]").exists()).toBe(false);
    expect(s.curve.name).toBe("保留");
    w.unmount();
  });
  it("does not attach a completed save to a replacement recording", async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(CurveLibrary.prototype, "save").mockImplementation(async () => pending);
    const { w, s } = start();
    await w.get("[data-test=name]").setValue("旧手记");
    await w.get("[data-test=save]").trigger("click");
    await w.get("[data-test=start-recording]").trigger("click");
    await w.get("[data-test=confirm-ok]").trigger("click");
    const replacement = s.curve.id;
    release();
    await flushPromises();
    expect(s.curve.id).toBe(replacement);
    expect(s.curve.name).toBe("我的烘焙手记");
    expect(s.dirty).toBe(true);
    w.unmount();
  });
  it("distinguishes an unsaved example from an explicitly saved library item", async () => {
    const { w } = start();
    expect(w.text()).toContain("示例 · 未入库");
    await w.get("[data-test=save]").trigger("click");
    await vi.waitFor(() => expect(w.text()).toContain("已保存到当前浏览器"));
    expect(w.get(".save-state").text()).toBe("已保存");
    w.unmount();
  });
  it("invalidates a pasted import preview when the input changes", async () => {
    const { w } = start();
    await w.get("[data-test=nav-library]").trigger("click");
    await w.get("#import-format").setValue("json");
    await w.get("[data-test=import-data]").setValue(exportJSON(createDemoCurve()));
    await w.get("[data-test=preview-import]").trigger("click");
    expect(w.find("[data-test=confirm-import]").exists()).toBe(true);
    await w.get("[data-test=import-data]").setValue("invalid new text");
    expect(w.find("[data-test=confirm-import]").exists()).toBe(false);
    w.unmount();
  });
});

it("loads v1 without migration, then explicitly saves v2 with raw data and new metadata intact", async () => {
  const legacy = createDemoCurve();
  legacy.schemaVersion = 1;
  delete legacy.source;
  legacy.id = "legacy-persisted";
  legacy.notes = "原始笔记：不可丢失";
  legacy.samples[100].et = null;
  const lib = new CurveLibrary();
  await lib.save(legacy);
  const { w, s } = start();
  await w.get("[data-test=nav-library]").trigger("click");
  await vi.waitFor(() => expect(w.findAll(".curve-list>li")).toHaveLength(1));
  await button(w, "打开").trigger("click");
  expect((await lib.list())[0]).toEqual(legacy);
  await w.get("[data-test=advanced]").trigger("click");
  const fields = w.findAll("input[type=number]");
  await fields[0].setValue("200");
  await fields[1].setValue("170");
  await w.get("[role=dialog]").trigger("keydown", { key: "Escape" });
  expect(s.editMarker("DRY", 241)).toBe(true);
  await w.get("[data-test=save]").trigger("click");
  await vi.waitFor(() => expect(s.dirty).toBe(false));
  const saved = (await lib.list())[0];
  expect(saved.schemaVersion).toBe(2);
  expect(saved.id).toBe(legacy.id);
  expect(saved.notes).toBe(legacy.notes);
  expect(saved.samples).toEqual(legacy.samples);
  expect(saved.inputWeight).toBe(200);
  expect(saved.outputWeight).toBe(170);
  expect(saved.markers[0].source).toBe("legacy");
  expect(saved.markers[1]).toMatchObject({
    t: 241,
    source: "manual",
    temperatureSource: "interpolated",
  });
  lib.close();
  w.unmount();
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";
import { useRoastStore } from "../src/stores/roast";
const raw =
  "{'title': '原生曲线', 'roastingnotes': '保留原文', 'timex': [-1.25, 0.0, 1.0], 'temp1': [200, 201, 202], 'temp2': [180, 181, 182], 'timeindex': [1, 0, 0, 0, 0, 0, 0, 0], 'mode': 'C', 'unknown': ('keep', None), 'specialevents': [], 'specialeventstype': [], 'specialeventsvalue': [], 'specialeventsStrings': []}";
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
describe("native Artisan UI integration", () => {
  it("makes alog primary and previews metadata without executing or saving imported controls", async () => {
    const { w, s } = start();
    await w.get("[data-test=nav-library]").trigger("click");
    expect(w.get("input[type=file]").attributes("accept")).toContain(".alog");
    await w.get("#import-format").setValue("alog");
    await w.get("[data-test=import-data]").setValue(raw);
    await w.get("[data-test=preview-import]").trigger("click");
    expect(w.get("[data-test=import-preview]").text()).toContain("Artisan");
    expect(w.get("[data-test=import-preview]").text()).toContain("3 个采样点");
    await w.get("[data-test=confirm-import]").trigger("click");
    expect(s.curve.nativeArtisan?.sourceText).toBe(raw);
    expect(s.curve.markers[0].t).toBe(1.25);
    expect(s.playing).toBe(false);
    expect(s.dirty).toBe(true);
    expect(w.get("[data-test=export-alog]").text()).toContain(".alog");
    w.unmount();
  });
  it("retains an unsaved draft if native import replacement is cancelled", async () => {
    const { w, s } = start();
    await w.get("[data-test=name]").setValue("不要覆盖");
    await w.get("[data-test=nav-library]").trigger("click");
    await w.get("#import-format").setValue("alog");
    await w.get("[data-test=import-data]").setValue(raw);
    await w.get("[data-test=preview-import]").trigger("click");
    await w.get("[data-test=confirm-import]").trigger("click");
    await w.get("[data-test=confirm-cancel]").trigger("click");
    expect(s.curve.name).toBe("不要覆盖");
    w.unmount();
  });
  it("opens a real connection entry but never asks hosted page for credentials", async () => {
    const { w, s } = start();
    const fetch = vi.spyOn(globalThis, "fetch");
    await w.get("[data-test=connection]").trigger("click");
    await flushPromises();
    expect(w.get("[role=dialog]").text()).toContain("本地桥");
    expect(w.find("input[type=password]").exists()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(s.recording).toBe(false);
    await w.get("[role=dialog]").trigger("keydown", { key: "Escape" });
    expect(w.find("[role=dialog]").exists()).toBe(false);
    w.unmount();
  });
});

it("exports a genuine .alog extension and surfaces third-party provenance", async () => {
  const { w } = start();
  let downloaded = "";
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:alog-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = this.download;
  });
  await w.get("[data-test=export-alog]").trigger("click");
  expect(downloaded).toMatch(/\.alog$/);
  expect(w.get(".toast[role=status]").text()).toContain("第三方");
  w.unmount();
});

it("restores keyboard focus to the connection entry without changing the draft", async () => {
  const { w, s } = start();
  const trigger = w.get("[data-test=connection]");
  (trigger.element as HTMLElement).focus();
  await trigger.trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(w.get('[aria-label="关闭对话框"]').element);
  await w.get("[role=dialog]").trigger("keydown", { key: "Escape" });
  await flushPromises();
  expect(document.activeElement).toBe(trigger.element);
  expect(s.curve.source).toBe("example");
  w.unmount();
});

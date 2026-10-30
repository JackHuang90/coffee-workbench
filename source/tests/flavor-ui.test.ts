/** 功能：验证风味盘真实选择、保存和重新打开行为。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { afterEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";
import { useRoastStore } from "../src/stores/roast";
import { CurveLibrary } from "../src/data/library";

afterEach(() => {
  document.body.innerHTML = "";
});
it("keeps save failures visible inside the flavor dialog and preserves unsaved selections", async () => {
  const pinia = createPinia(),
    w = mount(App, { global: { plugins: [pinia] }, attachTo: document.body });
  const s = useRoastStore(pinia);
  try {
    s.curve.inputWeight = 100;
    s.curve.outputWeight = 120;
    await w.get("[data-test=flavors]").trigger("click");
    await w.get("[data-flavor=jasmine]").trigger("click");
    await w.get("[data-test=save-flavors]").trigger("click");
    await flushPromises();
    expect(w.find("[role=dialog] [role=alert]").exists()).toBe(true);
    expect(w.get("[role=dialog] [role=alert]").text()).toContain("出豆重量");
    expect(s.curve.flavorTags).toEqual(["jasmine"]);
    expect(s.dirty).toBe(true);
  } finally {
    w.unmount();
  }
});
it("toggles descriptors with mouse and keyboard, saves them and reopens the same selections", async () => {
  const pinia = createPinia(),
    w = mount(App, { global: { plugins: [pinia] }, attachTo: document.body });
  const s = useRoastStore(pinia),
    library = new CurveLibrary();
  try {
    expect(w.find("[data-test=flavors]").exists()).toBe(true);
    await w.get("[data-test=flavors]").trigger("click");
    await w.get("[data-flavor=jasmine]").trigger("click");
    expect(s.curve.flavorTags).toEqual(["jasmine"]);
    expect(s.dirty).toBe(true);
    await w.get("[data-flavor=cocoa]").trigger("keydown", { key: "Enter" });
    expect(s.curve.flavorTags).toEqual(["jasmine", "cocoa"]);
    await w.get("[data-flavor=jasmine]").trigger("keydown", { key: " " });
    expect(s.curve.flavorTags).toEqual(["cocoa"]);
    await w.get("[data-test=save-flavors]").trigger("click");
    await vi.waitFor(() => expect(s.dirty).toBe(false));
    const saved = (await library.list()).find((curve) => curve.id === s.curve.id)!;
    expect(saved.flavorTags).toEqual(["cocoa"]);
    s.openCurve(saved);
    await flushPromises();
    expect(w.get("[data-flavor=cocoa]").attributes("aria-pressed")).toBe("true");
    expect(w.get("[data-flavor=jasmine]").attributes("aria-pressed")).toBe("false");
  } finally {
    w.unmount();
    library.close();
  }
});

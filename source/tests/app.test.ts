import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const start = () => mount(App, { global: { plugins: [createPinia()] }, attachTo: document.body });
describe("critical local journal flows", () => {
  it("labels the page simulation-only and has no device endpoint or actuator", async () => {
    const w = start();
    await flushPromises();
    expect(w.text()).toContain("模拟数据");
    expect(w.text()).toContain("未连接设备");
    expect(w.find("input[type=url]").exists()).toBe(false);
    w.unmount();
  });
  it("starts recording, marks charge and keeps first-sample draft separate from library", async () => {
    const w = start();
    await flushPromises();
    await w.get("[data-test=start-recording]").trigger("click");
    await w.get("[data-test=marker-CHARGE]").trigger("click");
    expect(w.text()).toContain("暂存");
    await w.get("[data-test=stop-recording]").trigger("click");
    expect(w.get("[data-test=save]").attributes("disabled")).toBeDefined();
    w.unmount();
  });
  it("supports library empty state and cancels unsaved replacement", async () => {
    const w = start();
    await flushPromises();
    await w.get("[data-test=name]").setValue("我的手记");
    await w.get("[data-test=start-recording]").trigger("click");
    expect(w.find("[role=dialog]").exists()).toBe(true);
    await w.get("[data-test=confirm-cancel]").trigger("click");
    expect((w.get("[data-test=name]").element as HTMLInputElement).value).toBe("我的手记");
    await w.get("[data-test=nav-library]").trigger("click");
    await flushPromises();
    await vi.waitFor(() => expect(w.text()).toContain("还没有保存的曲线"));
    w.unmount();
  });
});

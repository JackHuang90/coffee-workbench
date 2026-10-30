/** 功能：通过真实工作台验证蓝牙选择、取消及安全上下文引导。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";
const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const close of unmounts.splice(0)) close();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
/** 功能：在真实工作台中切换 BLE，只替换浏览器选择器边界。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
async function start(origin = "https://coffee.example", secure = true, supported = true) {
  vi.stubGlobal("location", { origin });
  vi.stubGlobal("isSecureContext", secure);
  const requestDevice = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("navigator", { bluetooth: supported ? { requestDevice } : undefined });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const w = mount(App, { global: { plugins: [createPinia()] }, attachTo: document.body });
  unmounts.push(() => w.unmount());
  await w.get("[data-test=connection]").trigger("click");
  await w.get("[data-test=transport]").setValue("ble");
  await flushPromises();
  return { w, requestDevice, fetcher };
}
describe("BLE connection panel", () => {
  it("offers Bluetooth without IP, Wi-Fi website binding, or background scanning", async () => {
    const { w, requestDevice, fetcher } = await start();
    expect(w.get("[data-test=transport]").find("option[value=ble]").exists()).toBe(true);
    expect(w.find("#device-ip").exists()).toBe(false);
    expect(w.find("[data-test=website-origin]").exists()).toBe(false);
    expect(w.find("[data-test=ble-connect]").exists()).toBe(true);
    expect(w.get("[role=dialog]").text()).toContain("无需设备 IP");
    expect(w.get("[role=dialog]").text()).toContain("MODBUS TCP");
    expect(requestDevice).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("opens the chooser only after the explicit button and exposes cancel during chooser wait", async () => {
    const { w, requestDevice } = await start();
    await w.get("[data-test=ble-connect]").trigger("click");
    expect(requestDevice).toHaveBeenCalledOnce();
    expect(w.get("[data-test=disconnect]").text()).toContain("取消");
    await w.get("[data-test=disconnect]").trigger("click");
    await flushPromises();
    expect(w.get("[data-test=ble-connect]").attributes("disabled")).toBeUndefined();
    expect(w.get("[role=dialog]").text()).toContain("已断开");
  });
  it("switching back to Wi-Fi cancels the chooser and restores IP/source fields without a request", async () => {
    const { w, requestDevice, fetcher } = await start();
    await w.get("[data-test=ble-connect]").trigger("click");
    await w.get("[data-test=transport]").setValue("direct");
    await flushPromises();
    expect(w.find("#device-ip").exists()).toBe(true);
    expect(w.find("[data-test=website-origin]").exists()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(requestDevice).toHaveBeenCalledOnce();
  });
  it.each([
    ["http://192.168.1.10:5173", false, true],
    ["https://coffee.example", true, false],
  ] as const)(
    "shows a Wi-Fi fallback without a BLE button for unsupported origin/runtime %s",
    async (origin, secure, supported) => {
      const { w, requestDevice } = await start(origin, secure, supported);
      expect(w.find("[data-test=ble-connect]").exists()).toBe(false);
      expect(w.find("#device-ip").exists()).toBe(false);
      expect(w.get("[role=dialog]").text()).toContain("HTTPS");
      expect(w.get("[role=dialog]").text()).toContain("localhost");
      expect(w.get("[role=dialog]").text()).toContain("Safari");
      await w.get("[data-test=ble-wifi-fallback]").trigger("click");
      expect(w.find("#device-ip").exists()).toBe(true);
      expect(requestDevice).not.toHaveBeenCalled();
    },
  );
});

/**
 * 功能：验证托管网页的显式连接、来源复制和设备数据隔离。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：首次编写，使用真实工作台及浏览器网络边界。
 * - 2026-10-30：验证 HTTP 本机和内网来源的连接入口、复制及无剪贴板时的手工回退。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";
import { useRoastStore } from "../src/stores/roast";
const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const close of unmounts.splice(0)) close();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
/** 功能：在指定的受控页面来源下挂载完整工作台。首次编写日期：2026-10-29。变更日期：2026-10-30。修改记录：2026-10-29 首次编写；2026-10-30 增加本机和内网 HTTP 场景。 */
function start(origin = "https://coffee.example:8443") {
  vi.stubGlobal("location", { origin });
  const pinia = createPinia(),
    w = mount(App, { global: { plugins: [pinia] }, attachTo: document.body });
  unmounts.push(() => w.unmount());
  return { w, s: useRoastStore(pinia) };
}
describe("hosted device connection panel", () => {
  it.each(["http://localhost:5173", "http://192.168.1.10:3000", "http://172.16.0.1"])(
    "offers HTTP direct input and copies the exact source including its nondefault port at %s",
    async (origin) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
      const { w } = start(origin);
      await w.get("[data-test=connection]").trigger("click");
      await flushPromises();
      expect((w.get("[data-test=transport]").element as HTMLSelectElement).value).toBe("direct");
      expect(w.find("#device-ip").exists()).toBe(true);
      expect(w.get("[data-test=copy-origin]").attributes("disabled")).toBeUndefined();
      await w.get("[data-test=copy-origin]").trigger("click");
      expect(copy).toHaveBeenCalledWith(origin);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("retains selectable HTTP source and gives manual-copy guidance when clipboard API is unavailable", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as unknown as Clipboard);
    const { w } = start("http://192.168.1.10:5173");
    await w.get("[data-test=connection]").trigger("click");
    await w.get("[data-test=copy-origin]").trigger("click");
    expect(w.get("[role=dialog]").text()).toContain("手工复制");
    expect((w.get("[data-test=website-origin]").element as HTMLInputElement).value).toBe(
      "http://192.168.1.10:5173",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not offer connect or copy for a public HTTP source", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { w } = start("http://coffee.example:5173");
    await w.get("[data-test=connection]").trigger("click");
    expect(w.find("#device-ip").exists()).toBe(false);
    expect(w.get("[data-test=copy-origin]").attributes("disabled")).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("opens direct connection without probing, and copies the exact current website origin", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { w } = start();
    await w.get("[data-test=connection]").trigger("click");
    await flushPromises();
    expect((w.get("[data-test=transport]").element as HTMLSelectElement).value).toBe("direct");
    expect(fetcher).not.toHaveBeenCalled();
    expect((w.get("[data-test=website-origin]").element as HTMLInputElement).value).toBe(
      "https://coffee.example:8443",
    );
    await w.get("[data-test=copy-origin]").trigger("click");
    expect(copy).toHaveBeenCalledWith("https://coffee.example:8443");
    expect(w.text()).toContain("已复制");
    expect(w.find("#device-ip").exists()).toBe(true);
  });
  it.each(["https://coffee.example:8443", "http://localhost:5173", "http://192.168.1.10:3000"])(
    "connects on submit from %s, renders null readings, and never changes the local curve or simulator",
    async (origin) => {
      const fetcher = vi.fn(async () =>
        Response.json({
          v: 1,
          mode: "LOCKED",
          source: "unavailable",
          state: "LOCKED",
          session: 42,
          last_seq: 0,
          uptime_ms: 1000,
          bt: null,
          et: null,
          target_bt: null,
          sensor_valid: false,
          elapsed_ms: 0,
          curve_id: "",
          curve_hash: 0,
          requested_pct: 0,
          virtual_applied_pct: 0,
          physical_actual_pct: null,
          physical_enabled: false,
          pending_request_id: null,
          last_accepted_seq: 0,
          reason: "",
          owner: "none",
          control_mode: "LOCKED",
          fan_requested_pct: 0,
          authorization_remaining_ms: 0,
          authorization_generation: 0,
          hardware_profile: "unverified",
          limits: {
            max_points: 1024,
            max_duration_ms: 1800000,
            max_gap_ms: 5000,
            lease_ms: 5000,
            sensor_fresh_ms: 1000,
          },
        }),
      );
      vi.stubGlobal("fetch", fetcher);
      const { w, s } = start(origin);
      const before = JSON.stringify(s.snapshot());
      await w.get("[data-test=connection]").trigger("click");
      await w.get("#device-ip").setValue("192.168.1.50");
      await w.get(".connection-form").trigger("submit");
      await flushPromises();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(w.get(".device-readings").text()).toContain("—");
      expect(w.get(".native-facts").text()).toContain("LOCKED");
      expect(JSON.stringify(s.snapshot())).toBe(before);
      expect(s.tracking.state).toBe("idle");
      await w.get("[data-test=disconnect]").trigger("click");
      expect(w.find(".device-readings").exists()).toBe(false);
    },
  );
  it("allows cancellation during a browser permission wait and never displays late data", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { w } = start();
    await w.get("[data-test=connection]").trigger("click");
    await w.get("#device-ip").setValue("192.168.1.50");
    await w.get(".connection-form").trigger("submit");
    expect(w.get("[data-test=disconnect]").attributes("disabled")).toBeUndefined();
    await w.get("[data-test=disconnect]").trigger("click");
    release(Response.json({ v: 1 }));
    await flushPromises();
    expect(w.find(".device-readings").exists()).toBe(false);
    expect(w.text()).toContain("已断开");
  });
  it("retains the pending target and cancel action when the connection dialog is reopened", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const { w } = start();
    await w.get("[data-test=connection]").trigger("click");
    await w.get("#device-ip").setValue("192.168.1.50");
    await w.get(".connection-form").trigger("submit");
    await w.get('[aria-label="关闭对话框"]').trigger("click");
    await w.get("[data-test=connection]").trigger("click");
    expect((w.get("#device-ip").element as HTMLInputElement).value).toBe("192.168.1.50");
    expect(w.get("#device-ip").attributes("disabled")).toBeDefined();
    expect(w.get(".connection-form button[type=submit]").attributes("disabled")).toBeDefined();
    await w.get("[data-test=disconnect]").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("已断开");
  });
  it("switches to explicit bridge guidance without contacting localhost from HTTPS", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { w } = start();
    await w.get("[data-test=connection]").trigger("click");
    await w.get("[data-test=transport]").setValue("bridge");
    await flushPromises();
    expect(w.get("[role=dialog]").text()).toContain("npm run bridge");
    expect(w.find("#device-ip").exists()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    await w.get("[data-test=transport]").setValue("direct");
    expect(w.find("#device-ip").exists()).toBe(true);
  });
});

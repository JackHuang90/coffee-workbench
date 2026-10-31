import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import Panel from "../src/components/BleProvisioningPanel.vue";
import type { BleProvisioningClient, SetupState } from "../src/core/ble-provisioning";
const wrappers: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});
function setup(testReply?: Promise<SetupState>) {
  let saves = 0;
  const request = vi.fn(async (op: string) => {
    if (op === "test") return testReply ?? { revision: 7, state: "Ready", authorized: true };
    if (op === "save") {
      if (++saves === 1) throw new Error("storage_failed");
      return {};
    }
    return { authorized: true, connected: true, state: "Ready", revision: 7, ip: "192.168.1.8" };
  });
  const client = { request, dispose: vi.fn() } as unknown as BleProvisioningClient;
  const w = mount(Panel, { props: { client, connected: true } });
  wrappers.push(w);
  return { w, request };
}
describe("BLE setup form", () => {
  it("freezes configuration while its tested candidate is being saved", async () => {
    let finish!: (value: SetupState) => void;
    const saving = new Promise<SetupState>((resolve) => (finish = resolve));
    const { w, request } = setup();
    request.mockImplementation(async (op: string) => {
      if (op === "save") return saving;
      return { authorized: true, connected: true, state: "Ready", revision: 7, ip: "192.168.1.8" };
    });
    await w.get("[data-test=setup-open]").trigger("click");
    await flushPromises();
    await w.get("[data-test=setup-ssid]").setValue("Coffee");
    await w.get("form").trigger("submit");
    await flushPromises();
    await w.get("[data-test=setup-save]").trigger("click");
    await flushPromises();
    expect(w.get("fieldset").attributes("disabled")).toBeDefined();
    finish({});
    await flushPromises();
    expect(w.get("fieldset").attributes("disabled")).toBeUndefined();
    expect(w.text()).toContain("已保存 Wi-Fi 配置");
  });

  it("does not publish an old save result into a reconnected panel", async () => {
    let saved = false;
    let finish!: (value: SetupState) => void;
    const reading = new Promise<SetupState>((resolve) => (finish = resolve));
    const { w, request } = setup();
    const ready = {
      authorized: true,
      connected: true,
      state: "Ready",
      revision: 7,
      ip: "192.168.1.8",
    };
    request.mockImplementation(async (op: string) => {
      if (op === "save") {
        saved = true;
        return {};
      }
      if (saved) return reading;
      return ready;
    });
    await w.get("[data-test=setup-open]").trigger("click");
    await flushPromises();
    await w.get("[data-test=setup-ssid]").setValue("Coffee");
    await w.get("form").trigger("submit");
    await flushPromises();
    await w.get("[data-test=setup-save]").trigger("click");
    await flushPromises();
    await w.setProps({ connected: false });
    saved = false;
    await w.setProps({ connected: true });
    await w.get("[data-test=setup-open]").trigger("click");
    await flushPromises();
    finish(ready);
    await flushPromises();
    expect(w.text()).not.toContain("已保存 Wi-Fi 配置");
  });

  it("does not qualify a different candidate revision reported during polling", async () => {
    vi.useFakeTimers();
    const { w, request } = setup();
    let started = false;
    request.mockImplementation(async (op: string) => {
      if (op === "test") {
        started = true;
        return { revision: 7 };
      }
      return { authorized: true, connected: true, state: "Ready", revision: started ? 8 : 6 };
    });
    await w.get("[data-test=setup-open]").trigger("click");
    await flushPromises();
    await w.get("[data-test=setup-ssid]").setValue("Coffee");
    await w.get("form").trigger("submit");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(750);
    await flushPromises();
    expect(w.get("[data-test=setup-save]").attributes("disabled")).toBeDefined();
  });

  it("expires the local authorization gate and clears unsent credentials", async () => {
    vi.useFakeTimers();
    const { w } = setup();
    await w.get("[data-test=setup-open]").trigger("click");
    await flushPromises();
    await w.get("[data-test=setup-ssid]").setValue("Coffee");
    await w.get("[data-test=setup-password]").setValue("not-sent");
    await vi.advanceTimersByTimeAsync(120000);
    expect(w.get("[data-test=setup-test]").attributes("disabled")).toBeDefined();
    expect((w.get("[data-test=setup-password]").element as HTMLInputElement).value).toBe("");
  });

  it("initializes only on click, clears password after send, saves exact tested revision and retries failure", async () => {
    const { w, request } = setup();
    expect(request).not.toHaveBeenCalled();
    await w.get("[data-test=setup-open]").trigger("click");
    await flushPromises();
    await w.get("[data-test=setup-ssid]").setValue("Coffee");
    await w.get("[data-test=setup-password]").setValue("secret123");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect((w.get("[data-test=setup-password]").element as HTMLInputElement).value).toBe("");
    await w.get("[data-test=setup-save]").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("storage_failed");
    await w.get("[data-test=setup-save]").trigger("click");
    await flushPromises();
    expect(request).toHaveBeenCalledWith("save", "revision=7");
    expect(w.text()).toContain("设备 IP");
  });
  it("editing during test prevents a late success from enabling save and disconnect clears password", async () => {
    let resolve!: (s: SetupState) => void;
    const reply = new Promise<SetupState>((r) => (resolve = r));
    const { w } = setup(reply);
    await w.get("[data-test=setup-open]").trigger("click");
    await flushPromises();
    await w.get("[data-test=setup-ssid]").setValue("Coffee");
    await w.get("form").trigger("submit");
    await w.get("[data-test=setup-ssid]").setValue("Edited");
    resolve({ revision: 7, state: "Ready", authorized: true });
    await flushPromises();
    expect(w.get("[data-test=setup-save]").attributes("disabled")).toBeDefined();
    await w.get("[data-test=setup-password]").setValue("erase-me");
    await w.setProps({ connected: false });
    expect(w.find("[data-test=setup-password]").exists()).toBe(false);
  });
});

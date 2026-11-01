// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeSetupFrames,
  SetupFrameAssembler,
  BleProvisioningClient,
} from "../src/core/ble-provisioning";
class Characteristic extends EventTarget {
  value?: DataView;
  writes: Uint8Array[] = [];
  async startNotifications() {
    return this;
  }
  async writeValueWithResponse(bytes: Uint8Array) {
    this.writes.push(bytes.slice());
  }
  send(data: unknown, sequence = 1) {
    for (const frame of encodeSetupFrames(
      new TextEncoder().encode(JSON.stringify(data)),
      sequence,
    )) {
      this.value = new DataView(frame.buffer as ArrayBuffer);
      this.dispatchEvent(new Event("characteristicvaluechanged"));
    }
  }
}
afterEach(() => vi.useRealTimers());
describe("setup wire protocol", () => {
  it.each([
    ["write", "读取配网写入特征"],
    ["notify", "读取配网通知特征"],
    ["subscribe", "订阅配网回复"],
  ])("bounds a blocked %s initialization and ignores its late completion", async (phase, label) => {
    vi.useFakeTimers();
    const c = new Characteristic();
    let release!: (value: Characteristic) => void;
    const blocked = new Promise<Characteristic>((resolve) => {
      release = resolve;
    });
    let lookups = 0;
    if (phase === "subscribe") c.startNotifications = () => blocked;
    const client = new BleProvisioningClient({
      getCharacteristic: async () => {
        lookups++;
        if ((phase === "write" && lookups === 1) || (phase === "notify" && lookups === 2))
          return blocked;
        return c;
      },
    });
    const request = client.request("state");
    const rejection = expect(request).rejects.toThrow(label);
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    release(c);
    await vi.advanceTimersByTimeAsync(20000);
    expect(c.writes).toHaveLength(0);
    await expect(client.request("state")).rejects.toThrow("关闭");
    client.dispose();
  });

  it("does not replay an ambiguous failed write", async () => {
    const c = new Characteristic();
    const write = vi.fn(async () => {
      throw new DOMException("GATT Server is disconnected.", "NetworkError");
    });
    c.writeValueWithResponse = write;
    const client = new BleProvisioningClient({ getCharacteristic: async () => c });
    await expect(client.request("save", "revision=7")).rejects.toThrow("disconnected");
    expect(write).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("cancels a busy retry before another browser write begins", async () => {
    vi.useFakeTimers();
    const c = new Characteristic();
    const write = vi.fn(async () => {
      throw new DOMException("GATT operation already in progress.", "NetworkError");
    });
    c.writeValueWithResponse = write;
    const client = new BleProvisioningClient({ getCharacteristic: async () => c });
    const request = client.request("state");
    const rejected = expect(request).rejects.toThrow("取消");
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledOnce();
    client.dispose();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledOnce();
  });

  it("retries a rejected busy GATT write without duplicating accepted fragments", async () => {
    vi.useFakeTimers();
    const c = new Characteristic();
    let attempts = 0;
    const write = c.writeValueWithResponse.bind(c);
    c.writeValueWithResponse = async (bytes) => {
      if (++attempts <= 2)
        throw new DOMException("Connection already in progress.", "NetworkError");
      await write(bytes);
    };
    const client = new BleProvisioningClient({ getCharacteristic: async () => c });
    const request = client.request("state");
    void request.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.writes.length).toBeGreaterThan(0);
    c.send({ id: 1, code: 200, data: { authorized: false } });
    expect((await request).authorized).toBe(false);
    expect(attempts).toBe(c.writes.length + 2);
    client.dispose();
  });

  it("preserves browser GATT diagnostics without including the submitted credentials", async () => {
    const c = new Characteristic();
    const cause = new DOMException("GATT Error: Not paired.", "NetworkError");
    c.writeValueWithResponse = async () => {
      throw cause;
    };
    const client = new BleProvisioningClient({ getCharacteristic: async () => c });
    const error = await client
      .request("test", "password=test-only-secret")
      .catch((e) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("NetworkError");
    expect((error as Error).message).toContain("GATT Error: Not paired.");
    expect((error as Error).message).not.toContain("test-only-secret");
    expect((error as Error).cause).toBe(cause);
    client.dispose();
  });

  it("times out a stuck acknowledged write without waiting for the browser", async () => {
    vi.useFakeTimers();
    const c = new Characteristic();
    c.writeValueWithResponse = async () => {
      await new Promise(() => {});
    };
    const client = new BleProvisioningClient({ getCharacteristic: async () => c });
    const request = client.request("test", "ssid=Coffee");
    const rejection = expect(request).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    await expect(client.request("state")).rejects.toThrow("写入尚未结束");
    client.dispose();
  });

  it("cancels immediately while characteristic discovery is blocked", async () => {
    let release!: (c: Characteristic) => void;
    const blocked = new Promise<Characteristic>((resolve) => {
      release = resolve;
    });
    const client = new BleProvisioningClient({ getCharacteristic: () => blocked });
    const request = client.request("state");
    await Promise.resolve();
    client.dispose();
    const outcome = await Promise.race([
      request.then(
        () => "resolved",
        () => "cancelled",
      ),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 20)),
    ]);
    release(new Characteristic());
    expect(outcome).toBe("cancelled");
  });

  it("encodes little endian bounded frames and reconstructs multibyte UTF8", () => {
    const bytes = new TextEncoder().encode("咖啡".repeat(150));
    const frames = encodeSetupFrames(bytes, 0x1234);
    expect(Array.from(frames[0]!.slice(0, 8))).toEqual([82, 1, 52, 18, 132, 3, 0, 0]);
    expect(frames.every((f) => f.length <= 20)).toBe(true);
    const a = new SetupFrameAssembler();
    let result: Uint8Array | null = null;
    for (const f of frames) result = a.push(f, 0);
    expect(result).toEqual(bytes);
    expect(() => encodeSetupFrames(new Uint8Array(4096), 1)).toThrow();
  });
  it("rejects duplicates and fixed ten second assembly timeout", () => {
    const frames = encodeSetupFrames(new Uint8Array(40), 1);
    const a = new SetupFrameAssembler();
    a.push(frames[0]!, 0);
    expect(() => a.push(frames[0]!, 1)).toThrow();
    a.push(frames[0]!, 0);
    a.push(frames[1]!, 9000);
    expect(() => a.checkTimeout(10000)).toThrow();
  });
  it("cancels requests and ignores late response without affecting telemetry", async () => {
    const c = new Characteristic();
    const client = new BleProvisioningClient({ getCharacteristic: async () => c });
    const request = client.request("state");
    const assertion = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(c.writes.length).toBeGreaterThan(0));
    client.dispose();
    c.send({ id: 1, code: 200, data: { authorized: true } });
    await assertion;
    await expect(client.request("state")).rejects.toThrow();
  });
  it("reports legacy firmware without disconnecting GATT", async () => {
    const client = new BleProvisioningClient({
      getCharacteristic: async () => {
        throw new Error("NotFoundError");
      },
    });
    await expect(client.request("state")).rejects.toThrow("升级");
    client.dispose();
  });
  it("correlates replies, rejects action errors, and permits save retry", async () => {
    const c = new Characteristic();
    const client = new BleProvisioningClient({ getCharacteristic: async () => c });
    let request = client.request("test", "ssid=Coffee&password=secret");
    await vi.waitFor(() => expect(c.writes.length).toBeGreaterThan(0));
    c.send({ id: 99, code: 200, data: { revision: 99 } });
    c.send({ id: 1, code: 400, data: { error: "invalid_wifi_password" } }, 2);
    await expect(request).rejects.toThrow("invalid_wifi_password");
    c.writes = [];
    request = client.request("save", "revision=2");
    await vi.waitFor(() => expect(c.writes.length).toBeGreaterThan(0));
    c.send({ id: 2, code: 500, data: { error: "storage_failed" } }, 3);
    await expect(request).rejects.toThrow("storage_failed");
    c.writes = [];
    request = client.request("save", "revision=2");
    await vi.waitFor(() => expect(c.writes.length).toBeGreaterThan(0));
    c.send({ id: 3, code: 200, data: { revision: 2 } }, 4);
    expect((await request).revision).toBe(2);
    client.dispose();
  });
});

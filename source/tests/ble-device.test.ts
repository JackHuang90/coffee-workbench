// @vitest-environment node
/** 功能：验证真实 BLE 客户端的只读协议、取消竞态和过期清理。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写；补齐阶段 Promise 的测试边界类型。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BleDeviceClient, BLE_SERVICE_UUID, BLE_STATUS_UUID } from "../src/core/ble-device";
import { createDeviceClient } from "../src/core/device";
/** 功能：建立可由测试释放的外部浏览器操作。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
/** 功能：提供完整固件状态，不通过被测解码器计算期望值。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function status(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    mode: "VIRTUAL_DEMO",
    source: "virtual_demo",
    state: "IDLE",
    session: 42,
    last_seq: 0,
    uptime_ms: 1000,
    bt: 123.4,
    et: null,
    target_bt: null,
    sensor_valid: true,
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
    control_mode: "CURVE_DEMO",
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
    ...overrides,
  };
}
/** 功能：在蓝牙浏览器边界提供通知，生产客户端仍执行全部解析和校验。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function radio() {
  const characteristic = Object.assign(new EventTarget(), {
    value: undefined as DataView | undefined,
    startNotifications: vi.fn(async () => characteristic),
  });
  const service = { getCharacteristic: vi.fn(async () => characteristic) };
  const gatt = {
    connected: false,
    connect: vi.fn(async () => {
      gatt.connected = true;
      return gatt;
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false;
    }),
    getPrimaryService: vi.fn(async () => service),
  };
  const device = Object.assign(new EventTarget(), { name: "Coffee-1234", gatt });
  const bluetooth = { requestDevice: vi.fn(async () => device) };
  const send = (payload: Uint8Array, sequence = 1, start = 0, end = payload.length) => {
    for (let offset = start; offset < end; offset += 12) {
      const part = payload.slice(offset, Math.min(offset + 12, end)),
        bytes = new Uint8Array(8 + part.length),
        view = new DataView(bytes.buffer);
      bytes.set([0x52, 1]);
      view.setUint16(2, sequence, true);
      view.setUint16(4, payload.length, true);
      view.setUint16(6, offset, true);
      bytes.set(part, 8);
      characteristic.value = view;
      characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    }
  };
  const sample = (overrides: Record<string, unknown> = {}, sequence = 1) =>
    send(new TextEncoder().encode(JSON.stringify(status(overrides))), sequence);
  vi.stubGlobal("navigator", { bluetooth });
  return { characteristic, service, gatt, device, bluetooth, send, sample };
}
const clients: BleDeviceClient[] = [];
/** 功能：创建真实客户端并登记释放。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function client(origin = "https://coffee.example") {
  const c = new BleDeviceClient({ origin });
  clients.push(c);
  return c;
}
/** 功能：排空外部操作的有限 Promise 链，不使用墙钟等待。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
async function settle() {
  for (let n = 0; n < 20; n++) await Promise.resolve();
}
beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
});
afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("read-only browser BLE", () => {
  it.each([
    ["chooser", "选择设备"],
    ["connect", "建立连接"],
    ["service", "查找服务"],
    ["subscribe", "订阅状态"],
  ])("preserves the browser error and failure stage at %s", async (stage, label) => {
    const r = radio(),
      failure = new DOMException("Connection failed for unknown reason.", "NetworkError");
    if (stage === "chooser") r.bluetooth.requestDevice.mockRejectedValueOnce(failure);
    if (stage === "connect") r.gatt.connect.mockRejectedValueOnce(failure);
    if (stage === "service") r.gatt.getPrimaryService.mockRejectedValueOnce(failure);
    if (stage === "subscribe") r.characteristic.startNotifications.mockRejectedValueOnce(failure);
    const c = client();
    const result = await c.connect({ ip: "" }).catch((cause: Error) => cause);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain(
      "NetworkError: Connection failed for unknown reason.",
    );
    expect((result as Error).message).toContain(label);
    expect(c.snapshot.diagnostic).toContain(label);
    expect(c.snapshot.state).toBe("lost");
    expect(c.snapshot.status).toBeNull();
  });

  it("never revives an early sample after a delayed subscription acknowledgement", async () => {
    vi.useFakeTimers();
    const r = radio(),
      ack = deferred<typeof r.characteristic>();
    r.characteristic.startNotifications.mockReturnValue(ack.promise);
    const c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.sample();
    await vi.advanceTimersByTimeAsync(4000);
    ack.resolve(r.characteristic);
    await pending;
    expect(c.snapshot.state).toBe("connected");
    expect(c.snapshot.status).toBeNull();
    expect(r.gatt.disconnect).not.toHaveBeenCalled();
    r.sample({ uptime_ms: 5000 }, 2);
    expect(c.snapshot.status?.uptime_ms).toBe(5000);
  });

  it("resynchronizes an incomplete established telemetry frame without dropping setup or GATT", async () => {
    vi.useFakeTimers();
    const r = radio(),
      c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.sample();
    await pending;
    const setup = c.provisioning;
    r.send(new TextEncoder().encode(JSON.stringify(status({ uptime_ms: 2000 }))), 2, 0, 12);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.snapshot.state).toBe("connected");
    expect(c.snapshot.status).toBeNull();
    expect(r.gatt.disconnect).not.toHaveBeenCalled();
    expect(c.provisioning).toBe(setup);
    r.sample({ uptime_ms: 4000 }, 3);
    expect(c.snapshot.status?.uptime_ms).toBe(4000);
  });

  it("keeps the first chooser attempt alive when the browser hides the page", async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", doc);
    const r = radio(),
      chooser = deferred<typeof r.device>();
    r.bluetooth.requestDevice.mockReturnValue(chooser.promise);
    const c = client(),
      pending = c.connect({ ip: "" });
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    chooser.resolve(r.device);
    await settle();
    r.sample();
    await pending;
    expect(c.snapshot.state).toBe("connected");
    expect(r.bluetooth.requestDevice).toHaveBeenCalledOnce();
    expect(r.gatt.disconnect).not.toHaveBeenCalled();
  });

  it("retries a transient connection busy error within the same chooser selection", async () => {
    vi.useFakeTimers();
    const r = radio();
    r.gatt.connect.mockRejectedValueOnce(
      new DOMException("Connection already in progress.", "NetworkError"),
    );
    const c = client(),
      pending = c.connect({ ip: "" });
    void pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    r.sample();
    await pending;
    expect(c.snapshot.state).toBe("connected");
    expect(r.bluetooth.requestDevice).toHaveBeenCalledOnce();
    expect(r.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it("retries the observed Windows connection attempt failure without a second chooser", async () => {
    vi.useFakeTimers();
    const r = radio();
    r.gatt.connect.mockRejectedValueOnce(
      new DOMException("Connection Error: Connection attempt failed.", "NetworkError"),
    );
    const c = client(),
      pending = c.connect({ ip: "" });
    void pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    r.sample();
    await pending;
    expect(c.snapshot.state).toBe("connected");
    expect(r.bluetooth.requestDevice).toHaveBeenCalledOnce();
    expect(r.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it("limits the failed connection recovery to one additional attempt", async () => {
    vi.useFakeTimers();
    const r = radio();
    r.gatt.connect.mockRejectedValue(
      new DOMException("Connection Error: Connection attempt failed.", "NetworkError"),
    );
    const c = client(),
      pending = c.connect({ ip: "" });
    const rejected = expect(pending).rejects.toThrow("Connection attempt failed");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(r.gatt.connect).toHaveBeenCalledTimes(2);
    expect(c.snapshot.state).toBe("lost");
    expect(c.snapshot.status).toBeNull();
  });

  it("cancels connection recovery before it can start another connection", async () => {
    vi.useFakeTimers();
    const r = radio();
    r.gatt.connect.mockRejectedValueOnce(
      new DOMException("Connection Error: Connection attempt failed.", "NetworkError"),
    );
    const c = client(),
      pending = c.connect({ ip: "" });
    void pending.catch(() => {});
    await settle();
    await c.disconnect();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(r.gatt.connect).toHaveBeenCalledTimes(1);
    expect(c.snapshot.state).toBe("offline");
  });

  it("lazy setup discovery shares GATT and legacy absence preserves telemetry", async () => {
    const r = radio(),
      c = client();
    r.service.getCharacteristic.mockImplementation(async (uuid?: string) => {
      if (uuid !== BLE_STATUS_UUID) throw new Error("NotFoundError");
      return r.characteristic;
    });
    const pending = c.connect({ ip: "" });
    await settle();
    r.sample();
    await pending;
    expect(r.service.getCharacteristic).toHaveBeenCalledTimes(1);
    await expect(c.provisioning!.request("state")).rejects.toThrow("升级");
    expect(r.gatt.disconnect).not.toHaveBeenCalled();
    r.sample({ uptime_ms: 1100, bt: 125 }, 2);
    expect(c.snapshot.status?.bt).toBe(125);
    expect(r.gatt.connect).toHaveBeenCalledTimes(1);
    await c.disconnect();
    expect(c.provisioning).toBeUndefined();
  });

  it("never opens a chooser on construction/discovery and calls it synchronously on explicit connect", async () => {
    const r = radio(),
      c = client();
    expect(await c.discover()).toBe(true);
    expect(r.bluetooth.requestDevice).not.toHaveBeenCalled();
    const pending = c.connect({ ip: "" });
    expect(r.bluetooth.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [BLE_SERVICE_UUID] }],
    });
    await settle();
    expect(c.snapshot.state).toBe("connecting");
    r.sample();
    await pending;
    expect(c.snapshot.status?.bt).toBe(123.4);
    expect(c.snapshot.ip).toBeNull();
    expect(c.snapshot.deviceName).toBe("Coffee-1234");
    expect(r.service.getCharacteristic).toHaveBeenCalledWith(BLE_STATUS_UUID);
    await c.refresh();
    expect(r.bluetooth.requestDevice).toHaveBeenCalledOnce();
  });
  it("selects BLE through the existing factory", async () => {
    radio();
    const c = createDeviceClient({ origin: "https://coffee.example" }, "ble");
    expect(c).toBeInstanceOf(BleDeviceClient);
    c.dispose();
  });
  it("handles a synchronous chooser rejection without an orphaned rejection", async () => {
    const r = radio();
    r.bluetooth.requestDevice.mockImplementation(() => {
      throw new DOMException("No user gesture", "SecurityError");
    });
    const c = client();
    await expect(c.connect({ ip: "" })).rejects.toThrow();
    expect(c.snapshot.state).toBe("lost");
    await settle();
  });
  it.each(["http://192.168.1.10:5173", "http://coffee.example", "file:///test"])(
    "rejects an ordinary insecure page %s despite navigator.bluetooth",
    async (origin) => {
      const r = radio(),
        c = client(origin);
      expect(await c.discover()).toBe(false);
      await expect(c.connect({ ip: "" })).rejects.toThrow();
      expect(r.bluetooth.requestDevice).not.toHaveBeenCalled();
    },
  );
  it.each(["http://localhost:5173", "http://127.0.0.1:8787", "https://coffee.example"])(
    "supports secure browser contexts at %s",
    async (origin) => {
      radio();
      expect(await client(origin).discover()).toBe(true);
    },
  );
  it("requires both runtime secure context and Web Bluetooth", async () => {
    radio();
    vi.stubGlobal("isSecureContext", false);
    expect(await client().discover()).toBe(false);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {});
    expect(await client().discover()).toBe(false);
  });
  it("receives early notifications during startNotifications and initially ignores a valid mid-frame", async () => {
    const r = radio(),
      c = client();
    r.characteristic.startNotifications.mockImplementation(async () => {
      r.send(new TextEncoder().encode("{}"), 1, 1);
      r.sample({}, 2);
      return r.characteristic;
    });
    await c.connect({ ip: "" });
    expect(c.snapshot.state).toBe("connected");
  });
  it("does not display an early sample before subscription confirmation", async () => {
    const r = radio(),
      late = deferred<typeof r.characteristic>();
    r.characteristic.startNotifications.mockReturnValue(
      late.promise as Promise<typeof r.characteristic>,
    );
    const c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.sample();
    expect(c.snapshot.state).toBe("connecting");
    expect(c.snapshot.status).toBeNull();
    late.resolve(r.characteristic);
    await pending;
    expect(c.snapshot.state).toBe("connected");
  });
  it.each(["chooser", "connect", "subscribe"])(
    "a late %s from a cancelled attempt cannot close a new session on the same device object",
    async (stage) => {
      const r = radio(),
        late = deferred<
          typeof r.device | typeof r.gatt | typeof r.service | typeof r.characteristic
        >();
      if (stage === "chooser")
        r.bluetooth.requestDevice.mockReturnValueOnce(late.promise as Promise<typeof r.device>);
      if (stage === "connect")
        r.gatt.connect.mockReturnValueOnce(late.promise as Promise<typeof r.gatt>);
      if (stage === "subscribe")
        r.characteristic.startNotifications.mockReturnValueOnce(
          late.promise as Promise<typeof r.characteristic>,
        );
      const c = client(),
        old = c.connect({ ip: "" });
      await settle();
      await c.disconnect();
      await old;
      const fresh = c.connect({ ip: "" });
      await settle();
      r.sample();
      await fresh;
      const disconnects = r.gatt.disconnect.mock.calls.length;
      late.resolve(
        stage === "chooser" ? r.device : stage === "connect" ? r.gatt : r.characteristic,
      );
      await settle();
      r.sample({ uptime_ms: 2000 }, 2);
      expect(c.snapshot.state).toBe("connected");
      expect(c.snapshot.status?.uptime_ms).toBe(2000);
      expect(r.gatt.connected).toBe(true);
      expect(r.gatt.disconnect).toHaveBeenCalledTimes(disconnects);
    },
  );
  it.each(["chooser", "connect", "subscribe"])(
    "a disposed client with pending %s cannot disconnect a new client using the same GATT object",
    async (stage) => {
      const r = radio(),
        late = deferred<
          typeof r.device | typeof r.gatt | typeof r.service | typeof r.characteristic
        >();
      if (stage === "chooser")
        r.bluetooth.requestDevice.mockReturnValueOnce(late.promise as Promise<typeof r.device>);
      if (stage === "connect")
        r.gatt.connect.mockReturnValueOnce(late.promise as Promise<typeof r.gatt>);
      if (stage === "subscribe")
        r.characteristic.startNotifications.mockReturnValueOnce(
          late.promise as Promise<typeof r.characteristic>,
        );
      const oldClient = client(),
        old = oldClient.connect({ ip: "" });
      await settle();
      oldClient.dispose();
      await old;
      const newClient = client(),
        fresh = newClient.connect({ ip: "" });
      await settle();
      r.sample();
      await fresh;
      const disconnects = r.gatt.disconnect.mock.calls.length;
      late.resolve(
        stage === "chooser" ? r.device : stage === "connect" ? r.gatt : r.characteristic,
      );
      await settle();
      expect(r.gatt.connected).toBe(true);
      expect(r.gatt.disconnect).toHaveBeenCalledTimes(disconnects);
      r.sample({ uptime_ms: 2000 }, 2);
      expect(newClient.snapshot.state).toBe("connected");
      expect(newClient.snapshot.status?.uptime_ms).toBe(2000);
    },
  );
  it("closes a late old GATT connection after its replacement client has also been disposed", async () => {
    const r = radio(),
      late = deferred<typeof r.gatt>();
    r.gatt.connect.mockReturnValueOnce(
      late.promise.then((server) => {
        server.connected = true;
        return server;
      }),
    );
    const oldClient = client(),
      old = oldClient.connect({ ip: "" });
    await settle();
    oldClient.dispose();
    await old;
    const replacement = client(),
      fresh = replacement.connect({ ip: "" });
    await settle();
    r.sample();
    await fresh;
    replacement.dispose();
    expect(r.gatt.connected).toBe(false);
    late.resolve(r.gatt);
    await settle();
    expect(r.gatt.connected).toBe(false);
    expect(oldClient.snapshot.state).toBe("offline");
    expect(replacement.snapshot.state).toBe("offline");
  });
  it.each(["disconnect", "pagehide", "dispose"])(
    "settles chooser cancellation on %s and never connects or disconnects an unowned late result",
    async (action) => {
      const win = new EventTarget(),
        doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
      vi.stubGlobal("window", win);
      vi.stubGlobal("document", doc);
      const r = radio(),
        chooser = deferred<typeof r.device>();
      r.bluetooth.requestDevice.mockReturnValue(chooser.promise);
      const c = client(),
        pending = c.connect({ ip: "" });
      if (action === "disconnect") await c.disconnect();
      else if (action === "dispose") c.dispose();
      else if (action === "pagehide") win.dispatchEvent(new Event("pagehide"));
      else {
        doc.visibilityState = "hidden";
        doc.dispatchEvent(new Event("visibilitychange"));
      }
      await pending;
      chooser.resolve(r.device);
      await settle();
      expect(c.snapshot.state).toBe("offline");
      expect(c.snapshot.status).toBeNull();
      expect(r.gatt.disconnect).not.toHaveBeenCalled();
      expect(r.gatt.connect).not.toHaveBeenCalled();
    },
  );
  it.each(["connect", "service", "characteristic", "subscribe"])(
    "cleans late completion at the %s stage",
    async (stage) => {
      const r = radio(),
        late = deferred<
          typeof r.device | typeof r.gatt | typeof r.service | typeof r.characteristic
        >();
      if (stage === "connect")
        r.gatt.connect.mockReturnValue(late.promise as Promise<typeof r.gatt>);
      if (stage === "service")
        r.gatt.getPrimaryService.mockReturnValue(late.promise as Promise<typeof r.service>);
      if (stage === "characteristic")
        r.service.getCharacteristic.mockReturnValue(
          late.promise as Promise<typeof r.characteristic>,
        );
      if (stage === "subscribe")
        r.characteristic.startNotifications.mockReturnValue(
          late.promise as Promise<typeof r.characteristic>,
        );
      const c = client(),
        pending = c.connect({ ip: "" });
      await settle();
      await c.disconnect();
      await pending;
      late.resolve(
        stage === "connect" ? r.gatt : stage === "service" ? r.service : r.characteristic,
      );
      await settle();
      r.sample();
      expect(c.snapshot.state).toBe("offline");
      expect(c.snapshot.status).toBeNull();
      expect(r.gatt.disconnect).toHaveBeenCalled();
    },
  );
  it("limits chooser wait to 60 seconds and leaves an eventual unowned selection untouched", async () => {
    vi.useFakeTimers();
    const r = radio(),
      late = deferred<typeof r.device>();
    r.bluetooth.requestDevice.mockReturnValue(late.promise);
    const c = client(),
      pending = c.connect({ ip: "" }),
      check = expect(pending).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(59999);
    expect(c.snapshot.state).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1);
    await check;
    late.resolve(r.device);
    await settle();
    expect(c.snapshot.state).toBe("lost");
    expect(r.gatt.connect).not.toHaveBeenCalled();
    expect(r.gatt.disconnect).not.toHaveBeenCalled();
  });
  it.each(["connect", "service", "subscribe", "firstframe"])(
    "limits post-chooser %s to a total 15 seconds",
    async (stage) => {
      vi.useFakeTimers();
      const r = radio();
      if (stage === "connect") r.gatt.connect.mockReturnValue(new Promise(() => {}));
      if (stage === "service") r.gatt.getPrimaryService.mockReturnValue(new Promise(() => {}));
      if (stage === "subscribe")
        r.characteristic.startNotifications.mockReturnValue(new Promise(() => {}));
      const c = client(),
        pending = c.connect({ ip: "" }),
        check = expect(pending).rejects.toThrow("超时");
      await settle();
      await vi.advanceTimersByTimeAsync(15000);
      await check;
      expect(c.snapshot.state).toBe("lost");
      expect(c.snapshot.status).toBeNull();
      expect(r.gatt.disconnect).toHaveBeenCalled();
    },
  );
  it("clears stale data without closing GATT and recovers on a new complete sample", async () => {
    vi.useFakeTimers();
    const r = radio(),
      c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.sample();
    await pending;
    await vi.advanceTimersByTimeAsync(2000);
    r.sample({}, 2);
    await vi.advanceTimersByTimeAsync(999);
    expect(c.snapshot.state).toBe("connected");
    await vi.advanceTimersByTimeAsync(1);
    expect(c.snapshot.state).toBe("connected");
    expect(c.snapshot.status).toBeNull();
    expect(r.gatt.connected).toBe(true);
    r.sample({ uptime_ms: 5000 }, 3);
    expect(c.snapshot.status?.uptime_ms).toBe(5000);
    await vi.advanceTimersByTimeAsync(60000);
    expect(r.bluetooth.requestDevice).toHaveBeenCalledOnce();
  });
  it("renews freshness for advancing samples and permits uptime rollover", async () => {
    vi.useFakeTimers();
    const r = radio(),
      c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.sample({ uptime_ms: 0xffffff00 }, 65535);
    await pending;
    await vi.advanceTimersByTimeAsync(2000);
    r.sample({ uptime_ms: 100 }, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.snapshot.state).toBe("connected");
    expect(c.snapshot.status?.uptime_ms).toBe(100);
  });
  it.each([{ session: 43 }, { uptime_ms: 900 }])(
    "clears telemetry for firmware reset %j",
    async (next) => {
      const r = radio(),
        c = client(),
        pending = c.connect({ ip: "" });
      await settle();
      r.sample();
      await pending;
      r.sample(next, 2);
      expect(c.snapshot.state).toBe("lost");
      expect(c.snapshot.status).toBeNull();
      expect(c.snapshot.diagnostic).toContain("重启");
    },
  );
  it.each([
    new Uint8Array([0xc3, 0x28]),
    new TextEncoder().encode("{invalid"),
    new TextEncoder().encode('{"v":2}'),
  ])("rejects malformed UTF8, JSON, or schema and removes listeners", async (bytes) => {
    const r = radio(),
      c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.send(bytes);
    await pending;
    expect(c.snapshot.state).toBe("lost");
    r.sample({}, 2);
    expect(c.snapshot.status).toBeNull();
    expect(r.gatt.connected).toBe(false);
  });
  it("disconnects a truncated frame after two seconds without another notification", async () => {
    vi.useFakeTimers();
    const r = radio(),
      c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.send(new Uint8Array([1, 2]), 1, 0, 1);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(c.snapshot.state).toBe("lost");
    expect(c.snapshot.status).toBeNull();
  });
  it("clears immediately when the device disconnects and rejects queued notifications", async () => {
    const r = radio(),
      c = client(),
      pending = c.connect({ ip: "" });
    await settle();
    r.sample();
    await pending;
    r.device.dispatchEvent(new Event("gattserverdisconnected"));
    r.sample({ uptime_ms: 2000 }, 2);
    expect(c.snapshot.state).toBe("lost");
    expect(c.snapshot.status).toBeNull();
  });
});

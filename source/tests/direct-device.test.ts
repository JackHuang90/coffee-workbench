// @vitest-environment node
/**
 * 功能：验证浏览器只读直连的目标边界、响应约束和连接生命周期。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：首次编写，覆盖许可等待、取消竞态与设备时钟校验。
 * - 2026-10-30：增加本机和内网 HTTP 来源、规范端口与来源拒绝的行为覆盖。
 * - 2026-10-30：增加 HTTPS 域名标签和 255 字符来源边界，校验与固件白名单一致。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectDeviceClient, createDeviceClient, deviceFresh } from "../src/core/device";

/**
 * 功能：提供完整 v1 固件状态及测试场景覆盖值。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：首次编写。
 */
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
const clients: DirectDeviceClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
/**
 * 功能：创建使用受控网络边界的真实直连客户端。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：首次编写。
 */
function client(fetcher: typeof fetch = async () => Response.json(status())) {
  const c = new DirectDeviceClient({
    origin: "https://coffee.example",
    fetch: fetcher,
    pollMs: 10000,
  });
  clients.push(c);
  return c;
}
describe("direct browser device connection", () => {
  it.each([
    "https://*.example.com",
    "https://-bad.example",
    "https://bad-.example",
    "https://example.com.",
    "https://bad_name.example",
    "https://bad..example",
    `https://${"a".repeat(64)}.example`,
    `https://${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(56)}`,
  ])("rejects HTTPS origins the firmware cannot whitelist: %s", async (origin) => {
    const fetcher = vi.fn();
    const c = new DirectDeviceClient({ origin, fetch: fetcher });
    clients.push(c);
    expect(await c.discover()).toBe(false);
    await expect(c.connect({ ip: "192.168.1.50" })).rejects.toThrow();
    expect(c.snapshot.state).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "https://2026.example.com",
    "https://xn--bcher-kva.example:8443",
    "https://8.8.8.8",
    `https://${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(55)}`,
  ])("retains normal HTTPS DNS, IPv4 and boundary-length origins: %s", async (origin) => {
    const c = new DirectDeviceClient({
      origin,
      fetch: async () => Response.json(status()),
      pollMs: 10000,
    });
    clients.push(c);
    await c.connect({ ip: "192.168.1.50" });
    expect(c.snapshot.state).toBe("connected");
  });
  it.each([
    "http://localhost",
    "http://localhost:5173",
    "http://localhost:65535",
    "http://127.0.0.1",
    "http://127.20.30.40:5173",
    "http://10.0.0.2:3000",
    "http://172.16.0.2",
    "http://172.31.255.1:8080",
    "http://192.168.1.9:5173",
  ])("allows local HTTP page %s without probing until an explicit connection", async (origin) => {
    const fetcher = vi.fn(async () => Response.json(status()));
    const c = createDeviceClient({ origin, fetch: fetcher, pollMs: 10000 });
    expect(c).toBeInstanceOf(DirectDeviceClient);
    clients.push(c as DirectDeviceClient);
    expect(await c.discover()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    await c.connect({ ip: "192.168.1.50" });
    expect(c.snapshot.state).toBe("connected");
    expect(c.snapshot.status?.session).toBe(42);
    expect(fetcher).toHaveBeenCalledWith(
      "http://192.168.1.50/api/v1/status",
      expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error" }),
    );
  });
  it.each([
    "http://coffee.example",
    "http://coffee.localhost:5173",
    "http://localhost.evil.test",
    "http://localhost.",
    "http://device.local",
    "http://8.8.8.8",
    "http://172.32.1.2",
    "http://172.15.1.2",
    "http://192.169.1.2",
    "http://169.254.1.2",
    "http://100.64.1.2",
    "http://0.0.0.0",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://127.00.0.1",
    "http://192.168.001.1",
    "http://[::1]:5173",
    "https://[::1]",
    "http://user@localhost:5173",
    "http://user:pass@192.168.1.2",
    "http://localhost:5173/path",
    "http://localhost:5173/",
    "http://localhost:5173?x=1",
    "http://localhost:5173#x",
    "http://localhost:80",
    "http://localhost:05173",
    "http://localhost:0",
    "http://localhost:65536",
    "http://LOCALHOST:5173",
    " http://localhost:5173",
    "http://local%68ost:5173",
    "https://127.1",
    "https://0xc0a80101",
    "https://coffee.example:443",
    "file:///tmp/page.html",
    "null",
  ])("rejects unsupported or noncanonical page origin %s without fetch", async (origin) => {
    const fetcher = vi.fn();
    const c = new DirectDeviceClient({ origin, fetch: fetcher });
    clients.push(c);
    expect(await c.discover()).toBe(false);
    await expect(c.connect({ ip: "192.168.1.50" })).rejects.toThrow();
    expect(c.snapshot.state).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts browser-normalized default port origins and keeps nondefault ports exact", async () => {
    for (const origin of [
      new URL("http://localhost:80/workbench").origin,
      "http://192.168.1.10:8080",
      "https://2026.example.com:8443",
    ]) {
      const c = new DirectDeviceClient({ origin, fetch: async () => Response.json(status()) });
      clients.push(c);
      await c.connect({ ip: "192.168.1.50" });
      expect(c.snapshot.state).toBe("connected");
    }
  });
  it("keeps 127.0.0.1 bridge defaults while permitting an explicit switch to HTTP direct", async () => {
    const fetcher = vi.fn(async () => Response.json(status()));
    const local = createDeviceClient({ origin: "http://127.0.0.1:8787", fetch: fetcher });
    expect(local).not.toBeInstanceOf(DirectDeviceClient);
    expect(fetcher).not.toHaveBeenCalled();
    local.dispose();
    const direct = createDeviceClient(
      { origin: "http://127.0.0.1:8787", fetch: fetcher, pollMs: 10000 },
      "direct",
    );
    clients.push(direct as DirectDeviceClient);
    await direct.connect({ ip: "192.168.1.50" });
    expect(direct.snapshot.state).toBe("connected");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("defaults HTTPS to direct and never probes LAN or localhost during construction/discovery", async () => {
    const fetcher = vi.fn();
    const c = createDeviceClient({ origin: "https://coffee.example", fetch: fetcher });
    expect(c).toBeInstanceOf(DirectDeviceClient);
    expect(await c.discover()).toBe(true);
    expect(c.snapshot.state).toBe("offline");
    expect(fetcher).not.toHaveBeenCalled();
    c.dispose();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["192.168.1.5", "10.0.0.3", "172.16.0.7", "172.31.255.1"])(
    "connects only to the fixed read-only status endpoint at %s",
    async (ip) => {
      const fetcher = vi.fn(async () => Response.json(status()));
      const c = client(fetcher);
      await c.connect({ ip });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]).toEqual([
        `http://${ip}/api/v1/status`,
        expect.objectContaining({
          method: "GET",
          mode: "cors",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        }),
      ]);
      expect(c.snapshot.state).toBe("connected");
      expect(c.snapshot.status?.et).toBeNull();
      expect(c.snapshot.status?.physical_enabled).toBe(false);
      expect(deviceFresh(c.snapshot)).toBe(true);
    },
  );
  it.each([
    "127.0.0.1",
    "localhost",
    "169.254.1.1",
    "100.64.1.1",
    "8.8.8.8",
    "172.32.1.1",
    "172.15.1.1",
    "192.168.001.5",
    "3232235781",
    "0xc0a80105",
    "192.168.1.5:80",
    "http://192.168.1.5",
    "192.168.1.5/x",
    "192.168.1.5@evil.test",
    " 192.168.1.5",
    "192.168.1.256",
    "[::1]",
  ])("rejects noncanonical or nonprivate target %s without network traffic", async (ip) => {
    const fetcher = vi.fn();
    const c = client(fetcher);
    await expect(c.connect({ ip })).rejects.toThrow("私有 IPv4");
    expect(fetcher).not.toHaveBeenCalled();
    expect(c.snapshot.status).toBeNull();
  });
  it.each([{ session: 43 }, { uptime_ms: 900 }])(
    "hides data after reboot/session or clock regression %j",
    async (next) => {
      let value = status();
      const c = client(async () => Response.json(value));
      await c.connect({ ip: "192.168.1.5" });
      value = status(next);
      await expect(c.refresh()).rejects.toThrow("重启");
      expect(c.snapshot.state).toBe("lost");
      expect(c.snapshot.status).toBeNull();
      await c.connect({ ip: "192.168.1.5" });
      expect(c.snapshot.state).toBe("connected");
    },
  );
  it("accepts the uint32 uptime wrap but rejects a clock stalled for over three seconds", async () => {
    vi.useFakeTimers();
    let value = status({ uptime_ms: 0xffffff00 });
    const c = client(async () => Response.json(value));
    await c.connect({ ip: "192.168.1.5" });
    value = status({ uptime_ms: 200 });
    await c.refresh();
    expect(c.snapshot.state).toBe("connected");
    await vi.advanceTimersByTimeAsync(3001);
    await expect(c.refresh()).rejects.toThrow("停止更新");
    expect(c.snapshot.status).toBeNull();
  });
  it.each([
    status({ v: 2 }),
    status({ physical_enabled: true }),
    status({ bt: null, sensor_valid: false, et: 55 }),
    { ok: true },
  ])("rejects schema violations", async (value) => {
    const c = client(async () => Response.json(value));
    await expect(c.connect({ ip: "192.168.1.5" })).rejects.toThrow("协议");
    expect(c.snapshot.status).toBeNull();
  });
  it.each([302, 403, 500])("rejects HTTP status %i", async (code) => {
    const c = client(async () => new Response("{}", { status: code }));
    await expect(c.connect({ ip: "192.168.1.5" })).rejects.toThrow("状态请求");
    expect(c.snapshot.state).toBe("lost");
  });
  it("bounds streamed response bytes and cancels oversized bodies", async () => {
    const cancel = vi.fn();
    const c = client(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(16385));
            },
            cancel,
          }),
        ),
    );
    await expect(c.connect({ ip: "192.168.1.5" })).rejects.toThrow("上限");
    expect(cancel).toHaveBeenCalledOnce();
    expect(c.snapshot.status).toBeNull();
  });
  it("allows an initial permission wait, then times out even when a transport ignores abort", async () => {
    vi.useFakeTimers();
    let complete!: (r: Response) => void;
    let signal: AbortSignal | undefined;
    const c = client(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    });
    const connecting = c.connect({ ip: "192.168.1.5" });
    const check = expect(connecting).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.snapshot.state).toBe("connecting");
    await vi.advanceTimersByTimeAsync(55000);
    await check;
    expect(signal?.aborted).toBe(true);
    complete(Response.json(status()));
    await Promise.resolve();
    expect(c.snapshot.state).toBe("lost");
  });
  it("bounds a stalled response body and subsequent polls to a short timeout", async () => {
    vi.useFakeTimers();
    let hang = false;
    const cancel = vi.fn();
    const c = client(async () =>
      hang ? new Response(new ReadableStream({ cancel })) : Response.json(status()),
    );
    await c.connect({ ip: "192.168.1.5" });
    hang = true;
    const refreshing = c.refresh();
    const check = expect(refreshing).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(5000);
    await check;
    expect(cancel).toHaveBeenCalled();
    expect(c.snapshot.status).toBeNull();
  });
  it.each(["disconnect", "pagehide", "visibilitychange", "dispose"])(
    "cancels pending permission wait on %s and ignores late completion",
    async (action) => {
      const browserWindow = new EventTarget();
      const browserDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
      vi.stubGlobal("window", browserWindow);
      vi.stubGlobal("document", browserDocument);
      let complete!: (r: Response) => void;
      const c = client(
        async () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      );
      const pending = c.connect({ ip: "192.168.1.5" });
      if (action === "disconnect") await c.disconnect();
      else if (action === "dispose") c.dispose();
      else if (action === "pagehide") browserWindow.dispatchEvent(new Event("pagehide"));
      else {
        browserDocument.visibilityState = "hidden";
        browserDocument.dispatchEvent(new Event("visibilitychange"));
      }
      await pending;
      complete(Response.json(status()));
      await Promise.resolve();
      expect(c.snapshot.state).toBe("offline");
      expect(c.snapshot.status).toBeNull();
    },
  );
  it("a newer connect wins over a cancelled request even if the old response arrives last", async () => {
    let complete!: (r: Response) => void;
    const c = client(async (input) =>
      String(input).includes("192.168.1.5/")
        ? new Promise<Response>((resolve) => {
            complete = resolve;
          })
        : Response.json(status({ session: 99 })),
    );
    const old = c.connect({ ip: "192.168.1.5" });
    await c.connect({ ip: "192.168.1.6" });
    await old;
    complete(Response.json(status()));
    await Promise.resolve();
    expect(c.snapshot.ip).toBe("192.168.1.6");
    expect(c.snapshot.status?.session).toBe(99);
  });
  it("does not overlap polling and stops automatic retries after a generic browser failure", async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(status()))
      .mockImplementation(
        () =>
          new Promise<Response>((_resolve, reject) => {
            fail = reject;
          }),
      );
    const c = client(fetcher);
    await c.connect({ ip: "192.168.1.5" });
    const pending = c.refresh();
    const check = expect(pending).rejects.toThrow("无法确定");
    await c.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fail(new TypeError("Failed to fetch"));
    await check;
    expect(c.snapshot.diagnostic).toMatch(/CORS/);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(c.snapshot.status).toBeNull();
  });
  it("keeps bridge compatibility available only when explicitly selected or served locally", async () => {
    const fetcher = vi.fn();
    const c = createDeviceClient({ origin: "https://coffee.example", fetch: fetcher }, "bridge");
    expect(await c.discover()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    c.dispose();
    const local = createDeviceClient({ origin: "http://127.0.0.1:8787", fetch: fetcher });
    expect(local).not.toBeInstanceOf(DirectDeviceClient);
    local.dispose();
  });
});

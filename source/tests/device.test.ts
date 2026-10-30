// @vitest-environment node
/** 功能：验证网页桥接客户端与设备状态生命周期。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 为测试 HTTP 适配器提供 Node 类型，去除 any。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { LocalDeviceClient, deviceFresh, deviceAgeMs } from "../src/core/device";
import { createLocalBridge } from "../tools/local-bridge.mjs";
const status = (overrides: Record<string, unknown> = {}) => ({
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
});
const closers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});
/** 功能：建立受控设备与桥接服务器并登记清理。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 明确测试请求适配器的参数类型。 */
async function setup() {
  let current = status(),
    delay = false;
  const requests: string[] = [];
  const upstream = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    if (!delay) res.end(JSON.stringify(current));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const addr = upstream.address();
  if (!addr || typeof addr === "string") throw Error("socket");
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        upstream.closeAllConnections();
        upstream.close(() => resolve());
      }),
  );
  const bridge = createLocalBridge({
    timeoutMs: 100,
    request: ((options: http.RequestOptions, callback?: (response: http.IncomingMessage) => void) =>
      http.request(
        { ...options, host: "127.0.0.1", port: addr.port },
        callback,
      )) as typeof http.request,
  });
  await bridge.listen(0);
  closers.push(() => bridge.close());
  // A browser sends exact Origin automatically on POST. This adapter adds only that header.
  const browserFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...init?.headers, Origin: bridge.origin } });
  const client = new LocalDeviceClient({
    origin: bridge.origin,
    fetch: browserFetch,
    pollMs: 10000,
  });
  closers.push(() => client.dispose());
  return {
    client,
    requests,
    setStatus: (v: Record<string, unknown>) => {
      current = status(v);
    },
    stall: () => {
      delay = true;
    },
  };
}
describe("local device client", () => {
  it("never probes localhost or sends credentials from hosted HTTPS", async () => {
    const fetcher = vi.fn();
    const c = new LocalDeviceClient({
      origin: "https://coffee.example",
      fetch: fetcher as typeof fetch,
    });
    closers.push(() => c.dispose());
    expect(await c.discover()).toBe(false);
    await expect(c.connect({ ip: "192.168.1.5" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(c.snapshot.state).toBe("unavailable");
  });
  it("discovers local bridge and exposes actual read-only status separately from simulation", async () => {
    const { client, requests } = await setup();
    expect(await client.discover()).toBe(true);
    expect(client.snapshot.state).toBe("offline");
    await client.connect({ ip: "192.168.1.5" });
    expect(client.snapshot.state).toBe("connected");
    expect(client.snapshot.status?.et).toBeNull();
    expect(client.snapshot.status?.physical_enabled).toBe(false);
    expect(deviceFresh(client.snapshot)).toBe(true);
    expect(deviceAgeMs(client.snapshot)).toBeGreaterThanOrEqual(0);
    expect(requests).toEqual(["/api/v1/status"]);
    await client.disconnect();
    expect(client.snapshot.status).toBeNull();
    expect(client.snapshot.state).toBe("offline");
  });
  it("fails closed on reset then requires explicit reconnect", async () => {
    const { client, setStatus } = await setup();
    await client.discover();
    await client.connect({ ip: "192.168.1.5" });
    setStatus({
      session: 43,
      owner: "modbus_power",
      control_mode: "ARTISAN_POWER_DEMO",
      state: "ARTISAN_POWER",
    });
    await expect(client.refresh()).rejects.toThrow();
    expect(client.snapshot.state).toBe("lost");
    expect(deviceFresh(client.snapshot)).toBe(false);
    expect(client.snapshot.status).toBeNull();
    await client.connect({ ip: "192.168.1.5" });
    expect(client.snapshot.status?.owner).toBe("modbus_power");
  });
  it("cancels pending requests and prevents late poll from reconnecting after disconnect", async () => {
    const { client, stall } = await setup();
    await client.discover();
    await client.connect({ ip: "192.168.1.5" });
    stall();
    const refreshing = client.refresh().catch(() => {});
    await client.disconnect();
    await refreshing;
    expect(client.snapshot.state).toBe("offline");
    expect(client.snapshot.receivedAt).toBeNull();
  });
  it("waits for disconnect acknowledgement before reconnect so a late disconnect cannot clear the new target", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === "/bridge/session")
        return Response.json({
          bridge: "roast-studio-local",
          version: 1,
          readOnly: true,
          csrfToken: "a".repeat(64),
        });
      if (path === "/bridge/disconnect") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return Response.json({ connected: false });
      }
      return Response.json({
        connected: true,
        readOnly: true,
        ip: "192.168.1.5",
        rttMs: 1,
        status: status(),
      });
    };
    const client = new LocalDeviceClient({
      origin: "http://127.0.0.1:8787",
      fetch: fetcher,
      pollMs: 10000,
    });
    await client.discover();
    await client.connect({ ip: "192.168.1.5" });
    const disconnected = client.disconnect();
    const reconnect = client.connect({ ip: "192.168.1.5" });
    await Promise.resolve();
    expect(calls.at(-1)).toBe("/bridge/disconnect");
    release();
    await disconnected;
    await reconnect;
    expect(client.snapshot.state).toBe("connected");
    const closing = client.disconnect();
    release();
    await closing;
    client.dispose();
    release();
  });
  it.each(["disconnect", "pagehide", "visibilitychange", "dispose"])(
    "a later %s cancels reconnect waiting for an earlier disconnect",
    async (action) => {
      const browserWindow = new EventTarget();
      const browserDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
      vi.stubGlobal("window", browserWindow);
      vi.stubGlobal("document", browserDocument);
      const calls: string[] = [];
      let release!: () => void;
      let firstDisconnect = true;
      const fetcher: typeof fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        if (path === "/bridge/session")
          return Response.json({
            bridge: "roast-studio-local",
            version: 1,
            readOnly: true,
            csrfToken: "a".repeat(64),
          });
        if (path === "/bridge/disconnect") {
          if (firstDisconnect) {
            firstDisconnect = false;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return Response.json({ connected: false });
        }
        return Response.json({
          connected: true,
          readOnly: true,
          ip: "192.168.1.5",
          rttMs: 1,
          status: status(),
        });
      };
      const client = new LocalDeviceClient({
        origin: "http://127.0.0.1:8787",
        fetch: fetcher,
        pollMs: 10000,
      });
      closers.push(() => client.dispose());
      await client.discover();
      const d1 = client.disconnect();
      const connecting = client.connect({ ip: "192.168.1.5" });
      let d2: Promise<void> | undefined;
      if (action === "disconnect") d2 = client.disconnect();
      else if (action === "pagehide") browserWindow.dispatchEvent(new Event("pagehide"));
      else if (action === "visibilitychange") {
        browserDocument.visibilityState = "hidden";
        browserDocument.dispatchEvent(new Event("visibilitychange"));
      } else client.dispose();
      release();
      await Promise.all([d1, d2, connecting]);
      expect(calls).toEqual(["/bridge/session", "/bridge/disconnect"]);
      expect(client.snapshot.state).toBe("offline");
      expect(client.snapshot.status).toBeNull();
    },
  );
  it("marks old data stale and exposes an age without converting null into zero", async () => {
    const { client } = await setup();
    await client.discover();
    await client.connect({ ip: "192.168.1.5" });
    const sample = client.snapshot;
    expect(deviceFresh(sample, sample.receivedAt! + 3001)).toBe(false);
    expect(deviceAgeMs(sample, sample.receivedAt! + 3001)).toBe(3001);
    expect(sample.status?.target_bt).toBeNull();
  });
  it("rejects malformed discovery without considering a random local site a bridge", async () => {
    const c = new LocalDeviceClient({
      origin: "http://127.0.0.1:8787",
      fetch: async () => new Response("<html>not bridge</html>", { status: 200 }),
    });
    closers.push(() => c.dispose());
    expect(await c.discover()).toBe(false);
    expect(c.snapshot.state).toBe("unavailable");
  });
});

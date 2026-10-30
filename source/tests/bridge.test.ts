// @vitest-environment node
/**
 * 功能：以真实回环 socket 和生产固件 HTTP 处理器验证只读桥接边界。
 * 首次编写日期：未知（历史代码）
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：原生 HTTP oracle 纳入配网依赖、CXX 编译器选择及 Windows；异步运行子进程，避免阻塞同一服务事件循环。
 * - 2026-10-30：为请求适配器和响应边界补充类型，移除测试 any。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, execFileSync, spawnSync, spawn } from "node:child_process";
import { createLocalBridge, isPrivateIPv4 } from "../tools/local-bridge.mjs";
import { validateDeviceStatus } from "../src/core/device-schema.mjs";
import type { DeviceStatus } from "../src/core/device-schema.mjs";

/** 功能：描述桥接测试可观察的状态或错误响应。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写，以可选字段表达不同响应。 */
interface BridgeResponse {
  /** 状态请求成功时携带的设备遥测。 */
  status?: DeviceStatus;
  /** 已连接设备的局域网地址。 */
  ip?: string;
  /** 断连响应中的连接状态。 */
  connected?: boolean;
  /** 请求失败时返回的机器可读原因。 */
  error?: string;
}

export function status(overrides: Record<string, unknown> = {}) {
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
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
/** 功能：建立测试专用的临时网页、设备和回环桥接。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 为 HTTP 适配器和响应载荷标注准确类型。 */
async function fixture(
  handler: http.RequestListener = (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(status()));
  },
  timeoutMs = 500,
) {
  const dir = await mkdtemp(join(tmpdir(), "roast-bridge-"));
  await writeFile(join(dir, "index.html"), "<h1>local console</h1>");
  await writeFile(join(dir, "safe.js"), 'console.log("local")');
  const upstream = http.createServer(handler);
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        upstream.closeAllConnections();
        upstream.close(() => resolve());
      }),
  );
  closers.push(() => rm(dir, { recursive: true, force: true }));
  const address = upstream.address();
  if (!address || typeof address === "string") throw Error("socket");
  // Dependency injection is test-local; production CLI has no target override.
  const bridge = createLocalBridge({
    staticDir: dir,
    timeoutMs,
    request: ((options: http.RequestOptions, callback?: (response: http.IncomingMessage) => void) =>
      http.request(
        { ...options, host: "127.0.0.1", port: address.port },
        callback,
      )) as typeof http.request,
  });
  await bridge.listen(0);
  closers.push(() => bridge.close());
  const origin = bridge.origin;
  const raw = await request<{ csrfToken: string }>(origin, "GET", "/bridge/session");
  const csrf = raw.body.csrfToken;
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    request<BridgeResponse>(origin, "POST", path, body, {
      Origin: origin,
      "X-Roast-CSRF": csrf,
      ...headers,
    });
  return { bridge, origin, csrf, post };
}
/** 功能：读取测试 HTTP 响应，默认保留 unknown 载荷。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 允许调用点明确声明已知测试端点的载荷类型。 */
function request<T = unknown>(
  origin: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Promise<{ status: number; body: T; headers: http.IncomingHttpHeaders }>(
    (resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        origin + path,
        {
          method,
          headers: {
            ...(payload
              ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
              : {}),
            ...headers,
          },
        },
        (res) => {
          let text = "";
          res.on("data", (v) => (text += v));
          res.on("end", () => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
          });
        },
      );
      req.on("error", reject);
      req.end(payload);
    },
  );
}
describe("local bridge boundary", () => {
  it("serves same-origin UI and reads exact firmware endpoint without Origin or command traffic", async () => {
    const seen: Array<Pick<http.IncomingMessage, "method" | "url" | "headers">> = [];
    const { origin, post } = await fixture((req, res) => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      res.end(JSON.stringify(status()));
    });
    const ui = await request(origin, "GET", "/");
    expect(ui.status).toBe(200);
    expect(ui.body).toContain("local console");
    expect(ui.headers["content-security-policy"]).toContain("default-src 'self'");
    const connected = await post("/bridge/connect", { ip: "192.168.1.50" });
    expect(connected.status).toBe(200);
    expect(connected.body.status?.et).toBeNull();
    expect(connected.body.ip).toBe("192.168.1.50");
    expect(JSON.stringify(connected)).not.toContain("not-logged-token");
    await post("/bridge/poll");
    expect(seen).toHaveLength(2);
    expect(
      seen.every(
        (r) =>
          r.method === "GET" &&
          r.url === "/api/v1/status" &&
          !r.headers.origin &&
          !r.headers.authorization,
      ),
    ).toBe(true);
    expect((await post("/bridge/disconnect")).body.connected).toBe(false);
    expect((await post("/bridge/poll")).status).toBe(409);
  });
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "8.8.8.8",
    "localhost",
    "192.168.01.2",
    "2130706433",
    "0x7f000001",
    "192.168.1.1:80",
    "http://192.168.1.1",
    "192.168.1.1/",
    "10.0.0.0",
    "10.255.255.255",
    "172.32.1.2",
    "100.64.0.1",
    "0.0.0.0",
  ])("rejects noncanonical or unsafe target %s", async (ip) => {
    expect(isPrivateIPv4(ip)).toBe(false);
    const { post } = await fixture();
    expect((await post("/bridge/connect", { ip })).status).toBe(400);
  });
  it.each(["10.1.2.3", "172.16.0.1", "172.31.250.9", "192.168.1.5"])(
    "accepts canonical RFC1918 %s",
    (ip) => expect(isPrivateIPv4(ip)).toBe(true),
  );
  it("rejects remote Host, cross Origin, missing CSRF, forwarded host and non-same-origin fetch metadata", async () => {
    const { origin, post } = await fixture();
    expect(
      (await request(origin, "GET", "/bridge/session", undefined, { Host: "attacker.test" }))
        .status,
    ).toBe(403);
    expect(
      (await post("/bridge/connect", { ip: "192.168.1.5" }, { Origin: "https://attacker.test" }))
        .status,
    ).toBe(403);
    expect((await post("/bridge/connect", { ip: "192.168.1.5" }, { Origin: "null" })).status).toBe(
      403,
    );
    expect(
      (await post("/bridge/connect", { ip: "192.168.1.5" }, { "X-Roast-CSRF": "" })).status,
    ).toBe(403);
    expect(
      (await post("/bridge/connect", { ip: "192.168.1.5" }, { "Sec-Fetch-Site": "cross-site" }))
        .status,
    ).toBe(403);
    expect(
      (await post("/bridge/connect", { ip: "192.168.1.5" }, { "X-Forwarded-Host": "localhost" }))
        .status,
    ).toBe(403);
    expect((await request(origin, "POST", "/bridge/disconnect", {})).status).toBe(403);
  });
  it("rejects raw non-ASCII CSRF bytes without terminating the bridge process", async () => {
    const moduleURL = pathToFileURL(resolve("tools/local-bridge.mjs")).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {createLocalBridge} from ${JSON.stringify(moduleURL)}; const bridge=createLocalBridge(); await bridge.listen(0); console.log(bridge.origin);`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill();
        }),
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const origin = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("bridge startup timeout")), 3000);
      child.stdout.once("data", (chunk) => {
        clearTimeout(timeout);
        resolve(String(chunk).trim());
      });
      child.once("error", (cause) => {
        clearTimeout(timeout);
        reject(cause);
      });
    });
    const target = new URL(origin);
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: Number(target.port) });
      let received = "";
      socket.setTimeout(3000, () => socket.destroy(Error("raw response timeout")));
      socket.on("error", reject);
      socket.on("data", (chunk) => (received += chunk));
      socket.on("end", () => resolve(received));
      socket.on("connect", () =>
        socket.write(
          Buffer.concat([
            Buffer.from(
              `POST /bridge/disconnect HTTP/1.1\r\nHost: ${target.host}\r\nOrigin: ${origin}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\nX-Roast-CSRF: `,
            ),
            Buffer.alloc(64, 0xe9),
            Buffer.from("\r\n\r\n{}"),
          ]),
        ),
      );
    });
    expect(response, stderr).toMatch(/^HTTP\/1\.1 403 /);
    expect((await request(origin, "GET", "/bridge/session")).status).toBe(200);
    expect(child.exitCode).toBeNull();
  });
  it("exposes no generic command, arbitrary URL/path, query target, traversal or CORS API", async () => {
    const { origin, post } = await fixture();
    expect((await post("/bridge/command", { command: "ARM" })).status).toBe(404);
    expect(
      (await post("/bridge/connect", { ip: "192.168.1.5", url: "http://example.com" })).status,
    ).toBe(400);
    for (const path of [
      "/bridge/session?target=8.8.8.8",
      "/../package.json",
      "/%2e%2e/package.json",
      "/firmware/include/local_config.h",
    ])
      expect((await request(origin, "GET", path)).status).toBe(404);
    expect((await request(origin, "OPTIONS", "/bridge/connect")).status).toBe(405);
  });
  it("rejects token/unknown inputs and oversized JSON without retaining credentials", async () => {
    const { post } = await fixture();
    expect(
      (await post("/bridge/connect", { ip: "192.168.1.5", token: "should-never-be-retained" }))
        .status,
    ).toBe(400);
    expect((await post("/bridge/connect", { ip: "x".repeat(3000) })).status).toBe(400);
  });
  it("reports stale or backward device time and rejects remote fetch access to discovery", async () => {
    let now = 0;
    const time = vi.spyOn(performance, "now").mockImplementation(() => now);
    let current = status();
    const { post, origin } = await fixture((_req, res) => res.end(JSON.stringify(current)));
    await post("/bridge/connect", { ip: "192.168.1.5" });
    now = 3101;
    expect((await post("/bridge/poll")).body.error).toBe("device_stale");
    await post("/bridge/connect", { ip: "192.168.1.5" });
    current = status({ uptime_ms: 999 });
    expect((await post("/bridge/poll")).body.error).toBe("device_reset");
    expect(
      (
        await request(origin, "GET", "/bridge/session", undefined, {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
    ).toBe(403);
    time.mockRestore();
  });
  it("does not follow redirects and drops the connection on malformed status", async () => {
    let redirect = true;
    const { post } = await fixture((_req, res) => {
      if (redirect) {
        res.writeHead(302, { Location: "http://8.8.8.8/" });
        res.end();
      } else res.end(JSON.stringify(status({ owner: "future_owner" })));
    });
    expect((await post("/bridge/connect", { ip: "192.168.1.5" })).body.error).toBe(
      "device_http_error",
    );
    redirect = false;
    expect((await post("/bridge/connect", { ip: "192.168.1.5" })).body.error).toBe(
      "device_schema_error",
    );
    expect((await post("/bridge/poll")).status).toBe(409);
  });
  it("fails closed on timeout and does not reconnect automatically", async () => {
    const { post } = await fixture(() => {}, 30);
    expect((await post("/bridge/connect", { ip: "192.168.1.5" })).body.error).toBe(
      "device_timeout",
    );
    expect((await post("/bridge/poll")).status).toBe(409);
  });
  it("detects reset, backward uptime and stale unchanged uptime without replaying control", async () => {
    let current = status();
    const { post } = await fixture((_req, res) => res.end(JSON.stringify(current)));
    await post("/bridge/connect", { ip: "192.168.1.5" });
    current = status({ session: 43 });
    expect((await post("/bridge/poll")).body.error).toBe("device_reset");
    expect((await post("/bridge/poll")).status).toBe(409);
  });
  it("cancels a pending poll on disconnect and never reports that response as connected", async () => {
    let count = 0;
    const { post } = await fixture((_req, res) => {
      if (count++ === 0) res.end(JSON.stringify(status()));
    });
    await post("/bridge/connect", { ip: "192.168.1.5" });
    const poll = post("/bridge/poll");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await post("/bridge/disconnect")).status).toBe(200);
    expect((await poll).body.error).toBe("device_cancelled");
    expect((await post("/bridge/poll")).status).toBe(409);
  });
});
describe("frozen firmware status schema", () => {
  it("accepts locked/null and Artisan-owned virtual status as read-only data", () => {
    expect(
      validateDeviceStatus(
        status({
          owner: "modbus_power",
          state: "ARTISAN_POWER",
          control_mode: "ARTISAN_POWER_DEMO",
        }),
      ).owner,
    ).toBe("modbus_power");
    expect(
      validateDeviceStatus(
        status({
          mode: "LOCKED",
          source: "unavailable",
          state: "LOCKED",
          control_mode: "LOCKED",
          sensor_valid: false,
          bt: null,
        }),
      ).bt,
    ).toBeNull();
  });
  it.each([
    { state: "STAGING" },
    { sensor_valid: false },
    { v: 2 },
    { bt: NaN },
    { bt: 501 },
    { physical_enabled: true },
    { physical_actual_pct: 0 },
    { owner: "unknown" },
    { source: "real" },
    { session: 0 },
    { last_seq: 1.5 },
    { authorization_remaining_ms: 300001 },
    { limits: { max_points: 9999 } },
  ])("rejects unsupported or unsafe status %j", (override) =>
    expect(() => validateDeviceStatus(status(override))).toThrow(),
  );
});

const nativeCompiler = process.env.CXX || "g++";
const hasCompiler = spawnSync(nativeCompiler, ["--version"], { stdio: "ignore" }).status === 0;
describe("firmware native HTTP oracle", () => {
  it.skipIf(!hasCompiler)(
    "runs actual HttpRequest + respond through bridge sockets in LOCKED and VIRTUAL_DEMO",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "frozen-http-oracle-"));
      closers.push(() => rm(dir, { recursive: true, force: true }));
      const children: Promise<void>[] = [];
      const nativeOutcomes: Array<{ ms: number; code: string | number | null; bytes: number }> = [];
      closers.push(async () => {
        await Promise.all(children);
      });
      for (const demo of [0, 1]) {
        const executable = join(dir, `status-${demo}${process.platform === "win32" ? ".exe" : ""}`);
        execFileSync(
          nativeCompiler,
          [
            "-std=c++17",
            `-DROAST_VIRTUAL_DEMO=${demo}`,
            "-Ifirmware/include",
            "tests/helpers/frozen-http-status.cpp",
            "firmware/src/core.cpp",
            "firmware/src/protocol.cpp",
            "firmware/src/http.cpp",
            "firmware/src/provisioning.cpp",
            "-o",
            executable,
          ],
          { cwd: resolve("."), timeout: 30000 },
        );
        for (const artisan of demo ? [false, true] : [false]) {
          const { post } = await fixture((req, res) => {
            let wire = `${req.method} ${req.url} HTTP/1.1\r\n`;
            for (let i = 0; i < req.rawHeaders.length; i += 2)
              wire += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
            wire += "\r\n";
            // Keep the native oracle off the loop that delivers the bridge's sockets.
            let completed!: () => void;
            children.push(
              new Promise<void>((resolve) => {
                completed = resolve;
              }),
            );
            const started = performance.now();
            const child = execFile(
              executable,
              artisan ? ["artisan"] : [],
              { timeout: 1500, encoding: "buffer" },
              (cause, output) => {
                nativeOutcomes.push({
                  ms: Math.round(performance.now() - started),
                  code: cause?.code ?? null,
                  bytes: output.length,
                });
                if (cause) {
                  res.writeHead(400);
                  res.end();
                } else res.end(output);
                completed();
              },
            );
            child.stdin?.end(wire);
          }, 2000); // Use the production bridge budget: this fixture also starts a native process.
          const result = await post("/bridge/connect", { ip: "192.168.1.50" });
          expect(result.status, JSON.stringify({ body: result.body, nativeOutcomes })).toBe(200);
          expect(result.body.status?.mode).toBe(demo ? "VIRTUAL_DEMO" : "LOCKED");
          expect(result.body.status?.owner).toBe(artisan ? "modbus_power" : "none");
          expect(result.body.status?.physical_enabled).toBe(false);
          if (artisan) expect(result.body.status?.authorization_remaining_ms).toBe(300000);
        }
      }
    },
    30000,
  );
});

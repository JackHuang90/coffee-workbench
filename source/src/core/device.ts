/**
 * 功能：提供只读设备状态工具、本地桥接客户端及网页传输选择。
 * 首次编写日期：未知（历史代码）
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：新增 HTTPS 直连默认选择，保留本地桥接兼容。
 * - 2026-10-30：新增网页 BLE 只读工厂和独立设备名称，不伪造 IPv4。
 */
import { validateDeviceStatus } from "./device-schema.mjs";
import type { DeviceStatus } from "./device-schema.mjs";
import { DirectDeviceClient } from "./direct-device";
import { BleDeviceClient } from "./ble-device";
export { BleDeviceClient } from "./ble-device";
import type { DeviceClient } from "./direct-device";
export { DirectDeviceClient } from "./direct-device";
export type { DeviceClient } from "./direct-device";
export { validateDeviceStatus } from "./device-schema.mjs";
export type { DeviceStatus } from "./device-schema.mjs";

/** 功能：统一只读设备遥测和传输展示元数据。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 增加可选 BLE 设备名称。 */
export interface DeviceSnapshot {
  /** 当前连接状态；未连接或丢失时遥测为空。 */
  state: "unavailable" | "offline" | "connecting" | "connected" | "lost";
  /** Wi-Fi 目标 IPv4；BLE 不使用地址输入。 */
  ip: string | null;
  /** 通过公共 v1 协议校验的最新完整状态。 */
  status: DeviceStatus | null;
  /** 最新完整新样本的接收时间，单位为 Unix 毫秒。 */
  receivedAt: number | null;
  /** HTTP 往返延迟毫秒数；通知传输没有此值。 */
  rttMs: number | null;
  /** 面向用户的当前连接说明或失败原因。 */
  diagnostic: string;
  /** 所有网页传输均只能读取设备状态。 */
  readOnly: true;
  /** BLE 设备显示名；不作为 IPv4 或设备身份认证。 */
  deviceName?: string;
}
export interface DeviceClientOptions {
  onChange?: (snapshot: DeviceSnapshot) => void;
  origin?: string;
  fetch?: typeof fetch;
  pollMs?: number;
}
const diagnostics: Record<string, string> = {
  device_timeout: "设备响应超时；已停止轮询，请检查网络后手动重连。",
  device_network_error: "无法读取设备；已断开，不会自动重连。",
  device_reset: "检测到设备重启或时钟重置；请确认设备状态后手动重连。",
  device_stale: "设备时间停止更新；旧数据已隐藏，请手动重连。",
  device_schema_error: "设备协议或状态不符合已验证的固件 v1；只读连接已关闭。",
  device_http_error: "设备拒绝状态请求或返回重定向；请检查 IP 与固件网络设置。",
  device_response_too_large: "设备响应超过安全上限；连接已关闭。",
  invalid_private_ip: "请输入规范的私有 IPv4 地址（例如 192.168.1.50），不含端口或路径。",
  origin_or_csrf_rejected: "本地页面校验失败，请从终端显示的 127.0.0.1 地址重新打开。",
  not_connected: "连接已断开，请手动重新连接。",
};
const unavailable =
  "当前页面未启用本地桥接。兼容模式需要运行本地桥，并打开终端显示的 127.0.0.1 页面。";
const empty = (
  state: DeviceSnapshot["state"],
  diagnostic: string,
  ip: string | null = null,
): DeviceSnapshot => ({
  state,
  ip,
  status: null,
  receivedAt: null,
  rttMs: null,
  diagnostic,
  readOnly: true,
});
export function deviceAgeMs(snapshot: DeviceSnapshot, now = Date.now()): number | null {
  return snapshot.receivedAt === null ? null : Math.max(0, now - snapshot.receivedAt);
}
/** Transport freshness is separate from firmware's sensor_valid flag. */
export function deviceFresh(snapshot: DeviceSnapshot, now = Date.now()): boolean {
  const age = deviceAgeMs(snapshot, now);
  return snapshot.state === "connected" && snapshot.status !== null && age !== null && age < 3000;
}
function canonicalLocalOrigin(value: string): boolean {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(value);
  return !!match && Number(match[1]) <= 65535;
}
/** 功能：表示用户选择的只读传输方式。首次编写日期：2026-10-29。变更日期：2026-10-30。修改记录：2026-10-29 首次编写；2026-10-30 增加网页 BLE。 */
export type DeviceTransport = "direct" | "bridge" | "ble";
/** 功能：HTTPS 页面默认直连，精确本地桥接页面沿用桥接模式。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
export function defaultDeviceTransport(
  origin = typeof location === "undefined" ? "" : location.origin,
): DeviceTransport {
  return canonicalLocalOrigin(origin) ? "bridge" : "direct";
}
/** 功能：创建选定连接器但不发起设备请求。首次编写日期：2026-10-29。变更日期：2026-10-30。修改记录：2026-10-29 首次编写；2026-10-30 增加不自动扫描的 BLE 客户端。 */
export function createDeviceClient(
  options: DeviceClientOptions = {},
  transport: DeviceTransport = defaultDeviceTransport(options.origin),
): DeviceClient {
  return transport === "ble"
    ? new BleDeviceClient(options)
    : transport === "bridge"
      ? new LocalDeviceClient(options)
      : new DirectDeviceClient(options);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Read-only adapter: it cannot emit ARM, START, PING, STOP or any firmware command. */
export class LocalDeviceClient {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly pollMs: number;
  private readonly onChange?: DeviceClientOptions["onChange"];
  private data: DeviceSnapshot = empty("unavailable", unavailable);
  private csrf = "";
  private epoch = 0;
  // User intent outlives individual requests (including a queued disconnect ACK).
  private intent = 0;
  private pending?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private disconnecting?: Promise<void>;
  constructor(options: DeviceClientOptions = {}) {
    this.origin = options.origin ?? (typeof location === "undefined" ? "" : location.origin);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.pollMs = Math.max(500, options.pollMs ?? 1000);
    this.onChange = options.onChange;
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.visibility);
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.pageHide);
  }
  get snapshot(): DeviceSnapshot {
    return { ...this.data, status: this.data.status ? structuredClone(this.data.status) : null };
  }
  private publish(next: DeviceSnapshot) {
    if (this.disposed) return;
    this.data = next;
    this.onChange?.(this.snapshot);
  }
  private cancel() {
    this.epoch++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending?.abort();
    this.pending = undefined;
  }
  private visibility = () => {
    if (document.visibilityState === "hidden") void this.disconnect();
  };
  private pageHide = () => {
    void this.disconnect();
  };
  private schedule() {
    clearTimeout(this.timer);
    if (this.data.state === "connected" && !this.disposed)
      this.timer = setTimeout(() => {
        void this.refresh().catch(() => {});
      }, this.pollMs);
  }
  private async call(
    path: string,
    body?: Record<string, unknown>,
    keepalive = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    this.pending = controller;
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await this.fetcher(this.origin + path, {
        method: body ? "POST" : "GET",
        headers: body
          ? { "Content-Type": "application/json", "X-Roast-CSRF": this.csrf }
          : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        keepalive,
      });
      const text = await response.text();
      if (text.length > 16384) throw new Error("device_response_too_large");
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("device_schema_error");
      }
      if (!response.ok)
        throw new Error(
          isRecord(value) &&
            typeof value.error === "string" &&
            Object.hasOwn(diagnostics, value.error)
            ? value.error
            : "device_network_error",
        );
      return value;
    } finally {
      clearTimeout(timeout);
      if (this.pending === controller) this.pending = undefined;
    }
  }
  async discover(): Promise<boolean> {
    if (this.disposed) return false;
    if (!canonicalLocalOrigin(this.origin)) {
      this.publish(empty("unavailable", unavailable));
      return false;
    }
    if (this.csrf) return true;
    this.cancel();
    const epoch = this.epoch;
    try {
      const value = await this.call("/bridge/session");
      if (epoch !== this.epoch || this.disposed) return false;
      if (
        !isRecord(value) ||
        value.bridge !== "roast-studio-local" ||
        value.version !== 1 ||
        value.readOnly !== true ||
        typeof value.csrfToken !== "string" ||
        !/^\w{64}$/.test(value.csrfToken)
      )
        throw new Error("device_schema_error");
      this.csrf = value.csrfToken;
      this.publish(empty("offline", "本地桥接已就绪。连接仅读取状态，不会启动设备。"));
      return true;
    } catch {
      if (epoch === this.epoch)
        this.publish(
          empty("unavailable", "未找到本地桥接。请运行 npm run bridge，并打开终端显示的地址。"),
        );
      return false;
    }
  }
  async connect({ ip }: { ip: string }): Promise<void> {
    if (this.disposed) throw new Error("连接器已关闭。");
    const intent = ++this.intent;
    const current = () => intent === this.intent && !this.disposed;
    if (this.disconnecting) await this.disconnecting;
    if (!current()) return;
    if (!this.csrf) {
      const ready = await this.discover();
      if (!current()) return;
      if (!ready) throw new Error(unavailable);
    }
    this.cancel();
    const epoch = this.epoch;
    this.publish(empty("connecting", "正在读取设备状态…", ip));
    try {
      const value = await this.call("/bridge/connect", { ip });
      if (current()) this.accept(value, ip, epoch);
    } catch (cause) {
      if (!current()) return;
      this.fail(cause, epoch, ip);
      throw this.report(cause);
    }
  }
  private accept(value: unknown, ip: string, epoch: number) {
    if (epoch !== this.epoch || this.disposed) return;
    if (
      !isRecord(value) ||
      value.connected !== true ||
      value.readOnly !== true ||
      value.ip !== ip ||
      typeof value.rttMs !== "number" ||
      !Number.isFinite(value.rttMs) ||
      value.rttMs < 0 ||
      value.rttMs > 10000
    )
      throw new Error("device_schema_error");
    const status = validateDeviceStatus(value.status);
    this.publish({
      state: "connected",
      ip,
      status,
      receivedAt: Date.now(),
      rttMs: value.rttMs,
      readOnly: true,
      diagnostic: status.owner.startsWith("modbus")
        ? "Artisan 正在持有设备；网页仅观察，不接管、不续期。"
        : status.mode === "LOCKED"
          ? "设备处于 LOCKED：传感器/物理输出未启用，仅供诊断。"
          : "已连接 VIRTUAL_DEMO；温度和输出是固件虚拟数据，不是实际烘焙反馈。",
    });
    this.schedule();
  }
  private report(cause: unknown): Error {
    const code = cause instanceof Error ? cause.message : "device_network_error";
    return new Error(diagnostics[code] ?? diagnostics.device_network_error);
  }
  private fail(cause: unknown, epoch: number, ip: string | null) {
    if (epoch !== this.epoch || this.disposed) return;
    this.cancel();
    this.publish(empty("lost", this.report(cause).message, ip));
    // The bridge has no autonomous polling or control lease to keep alive.
  }
  async refresh(): Promise<void> {
    if (this.disposed || this.data.state !== "connected" || !this.data.ip) return;
    if (this.pending) return;
    clearTimeout(this.timer);
    const epoch = this.epoch,
      ip = this.data.ip;
    try {
      this.accept(await this.call("/bridge/poll", {}), ip, epoch);
    } catch (cause) {
      this.fail(cause, epoch, ip);
      throw this.report(cause);
    }
  }
  async disconnect(): Promise<void> {
    // Even a second disconnect/pagehide must invalidate a connect waiting for the first ACK.
    this.intent++;
    if (this.disconnecting) return this.disconnecting;
    this.cancel();
    if (this.disposed) return;
    this.publish(
      empty(
        this.csrf ? "offline" : "unavailable",
        this.csrf ? "已断开；轮询已停止。重新连接需要你确认。" : unavailable,
      ),
    );
    const pending = (async () => {
      if (this.csrf && canonicalLocalOrigin(this.origin)) {
        try {
          await this.call("/bridge/disconnect", {}, true);
        } catch {
          /* No control exists to continue; local state remains disconnected. */
        }
      }
    })();
    this.disconnecting = pending;
    try {
      await pending;
    } finally {
      if (this.disconnecting === pending) this.disconnecting = undefined;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    void this.disconnect();
    this.disposed = true;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.visibility);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.pageHide);
  }
}

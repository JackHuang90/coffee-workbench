/**
 * 功能：通过浏览器跨域 GET 读取明确指定的局域网设备，不执行设备命令或网络发现。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：首次编写，实现有界只读请求、许可等待与连接生命周期。
 * - 2026-10-30：复用来源校验，允许本机及私有内网 HTTP 网页按用户操作直连。
 */
import { validateDeviceStatus } from "./device-schema.mjs";
import type { DeviceStatus } from "./device-schema.mjs";
import type { DeviceClientOptions, DeviceSnapshot } from "./device";
import { isAllowedDevicePageOrigin } from "./device-origin";

const readyMessage = "Wi-Fi 直连已就绪。点击连接后才会请求设备；浏览器可能询问局域网访问权限。";
const unavailableMessage =
  "此页面来源不支持直连。请从 HTTPS 网站、本机或私有内网 HTTP 地址打开；也可使用本地桥接页面。";
const messages: Record<string, string> = {
  invalid_private_ip: "请输入规范的私有 IPv4 地址（例如 192.168.1.50），不含端口或路径。",
  device_timeout: "设备响应超时或浏览器授权尚未完成；已停止请求。请检查后手动重连。",
  device_network_error:
    "浏览器无法读取设备，无法确定是网络、CORS、局域网权限还是网站安全策略限制。请核对下方连接排查后手动重连。",
  device_reset: "检测到设备重启或时钟重置；旧数据已隐藏，请确认设备状态后手动重连。",
  device_stale: "设备时间停止更新；旧数据已隐藏，请手动重连。",
  device_schema_error: "设备协议或状态不符合已验证的固件 v1；只读连接已关闭。",
  device_http_error: "设备拒绝状态请求或返回重定向；请检查 IP、允许的网站与固件网络设置。",
  device_response_too_large: "设备响应超过安全上限；连接已关闭。",
};

/**
 * 功能：定义直连和兼容桥接共用的只读连接生命周期。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：首次编写，沿用既有桥接方法签名。
 */
export interface DeviceClient {
  /** 最新快照；调用方不得通过修改它控制设备。 */
  readonly snapshot: DeviceSnapshot;
  /** 功能：检查当前页面的连接方式是否可用。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  discover(): Promise<boolean>;
  /** 功能：按用户指定的私有 IPv4 开始只读连接。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  connect(target: { ip: string }): Promise<void>;
  /** 功能：刷新现有连接，禁止并发轮询。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  refresh(): Promise<void>;
  /** 功能：撤销连接意图并清除遥测。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  disconnect(): Promise<void>;
  /** 功能：取消请求并移除页面监听器。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  dispose(): void;
}

/**
 * 功能：严格识别 RFC1918 数字 IPv4，不允许 URL、端口、主机名或隐式进制。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：首次编写。
 */
function privateIPv4(ip: string): boolean {
  if (typeof ip !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(ip))
    return false;
  const p = ip.split(".").map(Number);
  return (
    p.every((n) => n <= 255) &&
    (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168))
  );
}

/**
 * 功能：产生没有可展示旧遥测的状态快照。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：首次编写。
 */
function empty(
  state: DeviceSnapshot["state"],
  diagnostic: string,
  ip: string | null = null,
): DeviceSnapshot {
  return { state, ip, status: null, receivedAt: null, rttMs: null, diagnostic, readOnly: true };
}

/**
 * 功能：管理直接设备连接，隔离取消后的响应并检查会话和设备时钟。
 * 首次编写日期：2026-10-29
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：首次编写；首次等待最多 60 秒，后续读取最多 4.5 秒，正文最多 16 KiB。
 * - 2026-10-30：构造器使用统一页面来源规则，放行明确的本机及内网 HTTP。
 */
export class DirectDeviceClient implements DeviceClient {
  /** 当前页面是否属于允许的 HTTPS、本机 HTTP 或私有内网 HTTP 来源。 */
  private readonly available: boolean;
  /** 浏览器网络接口，可由测试替换边界。 */
  private readonly fetcher: typeof fetch;
  /** 两次完整读取之间的等待毫秒数。 */
  private readonly pollMs: number;
  /** 向页面发布隔离快照的回调。 */
  private readonly onChange?: DeviceClientOptions["onChange"];
  /** 当前连接和遥测；断开后立刻清空。 */
  private data: DeviceSnapshot;
  /** 每次新连接或取消后递增，用于丢弃旧响应。 */
  private epoch = 0;
  /** 当前唯一读取的中止器。 */
  private pending?: AbortController;
  /** 下一轮请求的定时器，仅在前次成功后设置。 */
  private timer?: ReturnType<typeof setTimeout>;
  /** 上一次设备时钟前进的单调时间，单位毫秒。 */
  private lastProgressAt = 0;
  /** 释放后禁止任何状态更新或新请求。 */
  private disposed = false;

  /** 功能：初始化客户端和页面生命周期监听，不发送请求。首次编写日期：2026-10-29。变更日期：2026-10-30。修改记录：2026-10-29 首次编写；2026-10-30 共用本机、内网 HTTP 和 HTTPS 来源校验。 */
  constructor(options: DeviceClientOptions = {}) {
    const origin = options.origin ?? (typeof location === "undefined" ? "" : location.origin);
    this.available = isAllowedDevicePageOrigin(origin);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.pollMs = Math.max(500, options.pollMs ?? 1000);
    this.onChange = options.onChange;
    this.data = empty(
      this.available ? "offline" : "unavailable",
      this.available ? readyMessage : unavailableMessage,
    );
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.visibility);
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.pageHide);
  }
  /** 功能：返回与内部状态隔离的快照。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  get snapshot(): DeviceSnapshot {
    return { ...this.data, status: this.data.status ? structuredClone(this.data.status) : null };
  }
  /** 功能：发布快照，释放后不再更新页面。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private publish(value: DeviceSnapshot): void {
    if (!this.disposed) {
      this.data = value;
      this.onChange?.(this.snapshot);
    }
  }
  /** 功能：撤销未完成读取与定时轮询。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private cancel(): void {
    this.epoch++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending?.abort();
    this.pending = undefined;
  }
  /** 功能：切后台时断开，不在恢复可见时自动重连。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private visibility = () => {
    if (document.visibilityState === "hidden") void this.disconnect();
  };
  /** 功能：离开页面时取消连接意图。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private pageHide = () => {
    void this.disconnect();
  };
  /** 功能：仅在完整成功响应后安排下一次读取。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.data.state === "connected" && !this.disposed)
      this.timer = setTimeout(() => {
        void this.refresh().catch(() => {});
      }, this.pollMs);
  }
  /** 功能：将已知错误翻译为诊断；不猜测浏览器 TypeError 的具体原因。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private report(cause: unknown): Error {
    return new Error(
      messages[cause instanceof Error ? cause.message : ""] ?? messages.device_network_error,
    );
  }
  /** 功能：检查页面资格，不探测内网或本地服务。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  async discover(): Promise<boolean> {
    return this.available && !this.disposed;
  }

  /**
   * 功能：按固定地址读取有界 JSON；中止竞赛覆盖权限弹窗、响应头和响应正文。
   * 首次编写日期：2026-10-29
   * 变更日期：2026-10-29
   * 修改记录：
   * - 2026-10-29：首次编写；取消正文读取，拒绝重定向及超大响应。
   */
  private async call(ip: string, initial: boolean): Promise<DeviceStatus> {
    const controller = new AbortController();
    this.pending = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timedOut = false;
    let rejectAbort!: (reason: Error) => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => {
      void reader?.cancel().catch(() => {});
      rejectAbort(new Error(timedOut ? "device_timeout" : "device_cancelled"));
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      initial ? 60000 : 4500,
    );
    const request = (async () => {
      const response = await this.fetcher(`http://${ip}/api/v1/status`, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new Error("device_cancelled");
      }
      if (response.status !== 200 || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new Error("device_http_error");
      }
      const length = Number(response.headers.get("content-length"));
      if (length > 16384) {
        void response.body?.cancel().catch(() => {});
        throw new Error("device_response_too_large");
      }
      if (!response.body) throw new Error("device_schema_error");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0,
        text = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw new Error("device_cancelled");
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 16384) throw new Error("device_response_too_large");
          text += decoder.decode(value, { stream: true });
        }
        try {
          return validateDeviceStatus(JSON.parse(text + decoder.decode()));
        } catch {
          throw new Error("device_schema_error");
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    })();
    try {
      return await Promise.race([request, interrupted]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", onAbort);
      if (this.pending === controller) this.pending = undefined;
    }
  }
  /** 功能：验证时钟连续性并发布真实设备遥测，不写入本地仿真。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private accept(status: DeviceStatus, ip: string, epoch: number, started: number): void {
    if (epoch !== this.epoch || this.disposed) return;
    const now = performance.now(),
      previous = this.data.status;
    if (previous) {
      const delta = (status.uptime_ms - previous.uptime_ms) >>> 0;
      if (status.session !== previous.session || delta > 0x7fffffff)
        throw new Error("device_reset");
      if (delta === 0 && now - this.lastProgressAt > 3000) throw new Error("device_stale");
      if (delta > 0) this.lastProgressAt = now;
    } else this.lastProgressAt = now;
    this.publish({
      state: "connected",
      ip,
      status,
      receivedAt: Date.now(),
      rttMs: Math.round(now - started),
      readOnly: true,
      diagnostic: status.owner.startsWith("modbus")
        ? "Artisan 正在持有设备；网页仅观察，不接管、不续期。"
        : status.mode === "LOCKED"
          ? "设备处于 LOCKED：传感器/物理输出未启用，仅供诊断。"
          : "已连接 VIRTUAL_DEMO；温度和输出是固件虚拟数据，不是实际烘焙反馈。",
    });
    this.schedule();
  }
  /** 功能：失败时清空旧数据，停止重试并要求用户重新连接。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  private fail(cause: unknown, ip: string | null): never {
    this.cancel();
    const error = this.report(cause);
    this.publish(empty("lost", error.message, ip));
    throw error;
  }
  /** 功能：处理显式连接意图，取消旧请求并校验唯一允许的私有 IPv4 目标。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  async connect({ ip }: { ip: string }): Promise<void> {
    if (this.disposed) throw new Error("连接器已关闭。");
    this.cancel();
    const epoch = this.epoch;
    if (!this.available) {
      this.publish(empty("unavailable", unavailableMessage));
      throw new Error(unavailableMessage);
    }
    if (!privateIPv4(ip)) this.fail(new Error("invalid_private_ip"), null);
    this.publish(
      empty("connecting", "正在读取设备状态…如浏览器询问，请允许此网站访问局域网。", ip),
    );
    const started = performance.now();
    try {
      this.accept(await this.call(ip, true), ip, epoch, started);
    } catch (cause) {
      if (epoch === this.epoch && !this.disposed) this.fail(cause, ip);
    }
  }
  /** 功能：读取一次当前目标；正在读取时不重叠，也不复活取消后的连接。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  async refresh(): Promise<void> {
    if (this.disposed || this.pending || this.data.state !== "connected" || !this.data.ip) return;
    clearTimeout(this.timer);
    const epoch = this.epoch,
      ip = this.data.ip,
      started = performance.now();
    try {
      this.accept(await this.call(ip, false), ip, epoch, started);
    } catch (cause) {
      if (epoch === this.epoch && !this.disposed) this.fail(cause, ip);
    }
  }
  /** 功能：取消权限等待或轮询并清空设备数据，不向设备发送命令。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  async disconnect(): Promise<void> {
    this.cancel();
    this.publish(
      empty(
        this.available ? "offline" : "unavailable",
        this.available ? "已断开；轮询已停止。重新连接需要你确认。" : unavailableMessage,
      ),
    );
  }
  /** 功能：停止连接并移除监听器，防止卸载后更新。首次编写日期：2026-10-29。变更日期：2026-10-29。修改记录：2026-10-29 首次编写。 */
  dispose(): void {
    if (this.disposed) return;
    void this.disconnect();
    this.disposed = true;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.visibility);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.pageHide);
  }
}

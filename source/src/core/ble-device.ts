/** 功能：浏览器直接订阅 BLE 状态，不扫描、不写入、不授予控制权。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import type { DeviceClientOptions, DeviceSnapshot } from "./device";
import type { DeviceClient } from "./direct-device";
import { validateDeviceStatus } from "./device-schema.mjs";
import type { DeviceStatus } from "./device-schema.mjs";
import { BleProvisioningClient } from "./ble-provisioning";
import { BleFrameAssembler } from "./ble-framing";
export const BLE_SERVICE_UUID = "b4e7a001-9d56-4f1b-a6e0-7d31c2f84590";
export const BLE_STATUS_UUID = "b4e7a002-9d56-4f1b-a6e0-7d31c2f84590";
/** 功能：声明本模块需要的只读通知接口，不暴露特征写入。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
interface BleCharacteristic extends EventTarget {
  /** 浏览器最近收到的通知字节。 */
  readonly value?: DataView;
  /** 功能：订阅设备通知。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  startNotifications(): Promise<BleCharacteristic>;
}
/** 功能：声明唯一只读 GATT 服务的特征查询。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
interface BleService {
  /** 功能：查找状态通知特征。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  getCharacteristic(uuid: string): Promise<BleCharacteristic>;
}
/** 功能：声明浏览器 GATT 连接操作。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
interface BleGatt {
  /** 功能：连接用户选择的设备。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  connect(): Promise<BleGatt>;
  /** 功能：释放当前设备连接。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  disconnect(): void;
  /** 功能：只查找本项目状态服务。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  getPrimaryService(uuid: string): Promise<BleService>;
}
/** 功能：表示浏览器选择器授权的设备及断开事件。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
interface BleDevice extends EventTarget {
  /** 设备广播名称，仅作展示，不当作身份认证。 */
  readonly name?: string;
  /** 设备的 GATT 连接入口，未提供时无法订阅。 */
  readonly gatt?: BleGatt;
}
/** 功能：声明只按服务过滤的显式浏览器选择器。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
interface BleBluetooth {
  /** 功能：在用户手势中显示设备选择器。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  requestDevice(options: { filters: Array<{ services: string[] }> }): Promise<BleDevice>;
}
/** 功能：区分连接意图的当前所有权和取消后的历史所有权。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写，取消后允许清理无活动所有者的迟到连接。 */
interface BleOwnership {
  /** 所属连接意图尚未取消或释放时为真。 */
  active: boolean;
}
/** 同一页面内跨客户端实例共享的 GATT 所有权；弱引用不会延长设备寿命。 */
const gattOwners = new WeakMap<BleGatt, BleOwnership>();
const readyMessage = "蓝牙已就绪。点击「选择蓝牙设备」后选择 Coffee-…，无需设备 IP 或路由器。";
const unavailableMessage =
  "蓝牙直连需要支持 Web Bluetooth 的浏览器以及 HTTPS 或可信 localhost 页面。可尝试桌面 Chrome / Edge 或 Android Chrome；Safari、iOS / iPadOS、Firefox 不保证支持。也可切换 Wi-Fi 直连。";
const messages: Record<string, string> = {
  ble_timeout: "蓝牙选择、连接或首帧等待超时；已清空数据，请手动重连。",
  ble_frame_timeout: "蓝牙分片等待超时；旧数据已隐藏，请手动重连。",
  ble_stale: "蓝牙状态已超过 3 秒没有完整新样本；旧数据已隐藏，请手动重连。",
  ble_reset: "检测到设备重启或时钟重置；旧数据已隐藏，请手动重连。",
  ble_disconnected: "蓝牙设备已断开；旧数据已隐藏，请手动重连。",
  ble_schema: "蓝牙状态协议、UTF-8 或 JSON 无效；只读连接已关闭。",
  ble_frame_invalid: "蓝牙分片格式或长度无效；只读连接已关闭。",
  ble_frame_order: "蓝牙分片重复、缺失或顺序无效；只读连接已关闭。",
};
/** 功能：读取运行时 Web Bluetooth 能力，不发起发现或选择。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function browserBluetooth(): BleBluetooth | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { bluetooth?: BleBluetooth }).bluetooth;
}
/** 功能：要求真实安全上下文与 HTTPS / 可信本机来源，独立于 Wi-Fi HTTP 白名单。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function isBleSupported(
  origin = typeof location === "undefined" ? "" : location.origin,
): boolean {
  if (
    globalThis.isSecureContext !== true ||
    typeof browserBluetooth()?.requestDevice !== "function"
  )
    return false;
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" ||
            url.hostname.endsWith(".localhost") ||
            /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname) ||
            url.hostname === "[::1]")))
    );
  } catch {
    return false;
  }
}
/** 功能：创建无旧遥测的状态，BLE 从不伪造 IPv4。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function empty(state: DeviceSnapshot["state"], diagnostic: string): DeviceSnapshot {
  return {
    state,
    ip: null,
    status: null,
    receivedAt: null,
    rttMs: null,
    diagnostic,
    readOnly: true,
  };
}
/** 功能：将有界 BLE 通知转换为现有只读快照，并隔离取消后的异步结果。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export class BleDeviceClient implements DeviceClient {
  /** 构造时检测的浏览器和页面资格。 */
  private readonly available: boolean;
  /** 向界面发布隔离快照的回调。 */
  private readonly onChange?: DeviceClientOptions["onChange"];
  /** 当前只读状态及无 IPv4 的 BLE 元数据。 */
  private data: DeviceSnapshot;
  /** 当前连接意图编号，取消或失败都会递增。 */
  private epoch = 0;
  /** 当前意图拥有的设备；旧操作不得关闭新的同设备会话。 */
  private device?: BleDevice;
  /** 本次意图的 GATT 所有权令牌；取消后仍用于识别迟到的旧连接。 */
  private ownership?: BleOwnership;
  /** 当前订阅的状态特征。 */
  private characteristic?: BleCharacteristic;
  /** 当前特征监听器，在订阅前注册并在取消时移除。 */
  private notification?: EventListener;
  /** 当前设备断开监听器，捕获所属连接编号。 */
  private deviceDisconnected?: EventListener;
  /** 使等待中的公开 connect 立即结束的中止回调。 */
  private interrupt?: (cause: Error) => void;
  /** 选择器或总连接阶段的截止定时器。 */
  private setupTimer?: ReturnType<typeof setTimeout>;
  /** 当前分片从开始起固定两秒的截止定时器。 */
  private frameTimer?: ReturnType<typeof setTimeout>;
  /** 完整且设备时钟前进的样本的三秒截止定时器。 */
  private staleTimer?: ReturnType<typeof setTimeout>;
  /** 单连接独占的严格分片组装器。 */
  private readonly assembler = new BleFrameAssembler();
  /** 当前订阅是否已被浏览器确认；确认前不展示提前到达的状态。 */
  private subscribed = false;
  /** 最近完整且设备时钟前进的状态，也涵盖订阅确认前的通知。 */
  private latest?: DeviceStatus;
  /** 最近完整新样本的接收时间，订阅确认不会延长新鲜度。 */
  private latestReceivedAt: number | null = null;
  /** 已释放时拒绝更新页面和打开选择器。 */
  private disposed = false;
  private service?: BleService;
  private setupClient?: BleProvisioningClient;
  /** Discover setup characteristics only after an explicit setup action. */
  get provisioning(): BleProvisioningClient | undefined {
    if (!this.service || !this.subscribed) return undefined;
    return (this.setupClient ??= new BleProvisioningClient(this.service));
  }

  /** 功能：初始化能力与生命周期监听，不搜索设备。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  constructor(options: DeviceClientOptions = {}) {
    this.available = isBleSupported(options.origin);
    this.onChange = options.onChange;
    this.data = empty(
      this.available ? "offline" : "unavailable",
      this.available ? readyMessage : unavailableMessage,
    );
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.visibility);
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.pageHide);
  }
  /** 功能：返回不能修改内部状态的快照副本。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  get snapshot(): DeviceSnapshot {
    return { ...this.data, status: this.data.status ? structuredClone(this.data.status) : null };
  }
  /** 功能：页面隐藏时立即断开，恢复前台不会自动连接。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private visibility = () => {
    if (document.visibilityState === "hidden") void this.disconnect();
  };
  /** 功能：离开页面时释放设备和遥测。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private pageHide = () => {
    void this.disconnect();
  };
  /** 功能：仅向尚未释放的客户端发布状态。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private publish(value: DeviceSnapshot): void {
    if (!this.disposed) {
      this.data = value;
      this.onChange?.(this.snapshot);
    }
  }
  /** 功能：检查所属连接是否仍有效。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private current(epoch: number): boolean {
    return epoch === this.epoch && !this.disposed;
  }
  /** 功能：清理所属或已无活动所有者的 GATT，保护其他客户端仍在使用的同设备连接。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写，跨实例取消清理校验所有者身份及活动状态。 */
  private releaseLate(device: BleDevice, owner: BleOwnership): void {
    const gatt = device.gatt;
    if (gatt) {
      const latest = gattOwners.get(gatt);
      if (latest === owner || !latest?.active) {
        try {
          gatt.disconnect();
        } catch {
          /* 浏览器已释放的连接无需再次处理。 */
        }
      }
    }
  }
  /** 功能：撤销当前意图，先移除监听再断开，并清空所有有界计时。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private cancel(): void {
    this.setupClient?.dispose();
    this.setupClient = undefined;
    this.service = undefined;
    this.epoch++;
    clearTimeout(this.setupTimer);
    clearTimeout(this.frameTimer);
    clearTimeout(this.staleTimer);
    this.setupTimer = this.frameTimer = this.staleTimer = undefined;
    this.interrupt?.(new Error("ble_cancelled"));
    this.interrupt = undefined;
    if (this.notification)
      this.characteristic?.removeEventListener("characteristicvaluechanged", this.notification);
    if (this.deviceDisconnected)
      this.device?.removeEventListener("gattserverdisconnected", this.deviceDisconnected);
    const device = this.device,
      owner = this.ownership;
    if (owner) owner.active = false;
    this.device = undefined;
    this.ownership = undefined;
    this.characteristic = undefined;
    this.notification = undefined;
    this.deviceDisconnected = undefined;
    this.assembler.reset();
    this.subscribed = false;
    this.latest = undefined;
    this.latestReceivedAt = null;
    if (device && owner) this.releaseLate(device, owner);
  }
  /** 功能：把协议或浏览器错误转换为可读诊断。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private report(cause: unknown): Error {
    return new Error(
      messages[cause instanceof Error ? cause.message : ""] ??
        "蓝牙选择已取消或连接失败；请检查蓝牙权限、固件与设备距离后手动重连。",
    );
  }
  /** 功能：停止失败连接并隐藏所有旧数据，不自动重试。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private lose(cause: unknown): void {
    const error = this.report(cause);
    this.cancel();
    this.publish(empty("lost", error.message));
  }
  /** 功能：仅返回能力检测结果，不打开选择器。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  async discover(): Promise<boolean> {
    return this.available && !this.disposed;
  }
  /** 功能：验证设备会话与时钟进度，完整新样本才更新数据和三秒期限。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private accept(status: DeviceStatus, epoch: number): void {
    if (!this.current(epoch)) return;
    const previous = this.latest;
    if (previous) {
      const delta = (status.uptime_ms - previous.uptime_ms) >>> 0;
      if (status.session !== previous.session || delta > 0x7fffffff) throw new Error("ble_reset");
      if (delta === 0) return;
    }
    clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      if (this.current(epoch)) this.lose(new Error("ble_stale"));
    }, 3000);
    this.latest = status;
    this.latestReceivedAt = Date.now();
    this.publishLatest();
  }
  /** 功能：只在订阅确认后展示最新样本，保持原始接收时间。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private publishLatest(): void {
    if (!this.subscribed || !this.latest) return;
    const status = this.latest;
    this.publish({
      state: "connected",
      ip: null,
      deviceName: this.device?.name || "Coffee BLE",
      status,
      receivedAt: this.latestReceivedAt,
      rttMs: null,
      readOnly: true,
      diagnostic: status.owner.startsWith("modbus")
        ? "蓝牙只读连接；Artisan 正在持有设备，网页不接管、不续期。"
        : status.mode === "LOCKED"
          ? "蓝牙只读连接 · LOCKED：传感器和物理输出未启用。"
          : "蓝牙只读连接 · VIRTUAL_DEMO：温度和输出是虚拟数据，不是实际烘焙反馈。",
    });
  }
  /** 功能：消费通知并有界组装，严格 UTF-8 / JSON 与公共状态校验失败时断开。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  private receive(value: DataView | undefined, epoch: number, first: () => void): void {
    if (!this.current(epoch)) return;
    try {
      if (!value) throw new Error("ble_frame_invalid");
      const wasAssembling = this.assembler.assembling,
        bytes = this.assembler.push(value);
      if (!wasAssembling && this.assembler.assembling) {
        this.frameTimer = setTimeout(() => {
          if (this.current(epoch)) {
            try {
              this.assembler.checkTimeout();
            } catch (cause) {
              this.lose(cause);
            }
          }
        }, 2000);
      }
      if (!bytes) return;
      clearTimeout(this.frameTimer);
      this.frameTimer = undefined;
      let status: DeviceStatus;
      try {
        status = validateDeviceStatus(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
      } catch {
        throw new Error("ble_schema");
      }
      this.accept(status, epoch);
      first();
    } catch (cause) {
      this.lose(cause);
    }
  }
  /** 功能：在点击调用栈中同步打开选择器，再有界等待 GATT 和首帧；忽略 IPv4 参数。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  async connect(_target: { ip: string }): Promise<void> {
    if (this.disposed) throw new Error("连接器已关闭。");
    this.cancel();
    const epoch = this.epoch,
      owner = { active: true };
    if (!this.available) {
      this.publish(empty("unavailable", unavailableMessage));
      throw new Error(unavailableMessage);
    }
    this.publish(empty("connecting", "请在浏览器选择 Coffee-… 蓝牙设备；可随时取消。"));
    try {
      const chooser = browserBluetooth()!.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
      });
      const interrupted = new Promise<never>((_resolve, reject) => {
        this.interrupt = reject;
      });
      this.setupTimer = setTimeout(() => this.interrupt?.(new Error("ble_timeout")), 60000);
      const operation = (async () => {
        const device = await chooser;
        if (!this.current(epoch)) return;
        this.device = device;
        clearTimeout(this.setupTimer);
        this.setupTimer = setTimeout(() => this.interrupt?.(new Error("ble_timeout")), 15000);
        if (!device.gatt) throw new Error("ble_disconnected");
        this.ownership = owner;
        gattOwners.set(device.gatt, owner);
        this.deviceDisconnected = () => {
          if (this.current(epoch)) this.lose(new Error("ble_disconnected"));
        };
        device.addEventListener("gattserverdisconnected", this.deviceDisconnected);
        const server = await device.gatt.connect();
        if (!this.current(epoch)) {
          this.releaseLate(device, owner);
          return;
        }
        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        if (!this.current(epoch)) {
          this.releaseLate(device, owner);
          return;
        }
        const characteristic = await service.getCharacteristic(BLE_STATUS_UUID);
        if (!this.current(epoch)) {
          this.releaseLate(device, owner);
          return;
        }
        this.characteristic = characteristic;
        let first!: () => void;
        const firstFrame = new Promise<void>((resolve) => {
          first = resolve;
        });
        this.notification = () => this.receive(characteristic.value, epoch, first);
        characteristic.addEventListener("characteristicvaluechanged", this.notification);
        await characteristic.startNotifications();
        if (!this.current(epoch)) {
          this.releaseLate(device, owner);
          return;
        }
        this.service = service;
        this.subscribed = true;
        this.publishLatest();
        await Promise.race([firstFrame, interrupted]);
      })();
      await Promise.race([operation, interrupted]);
      if (this.current(epoch)) {
        clearTimeout(this.setupTimer);
        this.setupTimer = undefined;
        this.interrupt = undefined;
      }
    } catch (cause) {
      if (this.current(epoch)) {
        this.lose(cause);
        throw this.report(cause);
      }
    }
  }
  /** 功能：通知模式无需轮询，刷新不写入特征或发送命令。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  async refresh(): Promise<void> {}
  /** 功能：立即取消选择和订阅并清空遥测。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  async disconnect(): Promise<void> {
    this.cancel();
    this.publish(
      empty(
        this.available ? "offline" : "unavailable",
        this.available ? "蓝牙已断开；重新连接需要点击选择设备。" : unavailableMessage,
      ),
    );
  }
  /** 功能：断开并移除页面事件，禁止后续连接。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  dispose(): void {
    if (this.disposed) return;
    void this.disconnect();
    this.disposed = true;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.visibility);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.pageHide);
  }
}

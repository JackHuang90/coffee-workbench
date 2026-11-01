/** BLE Wi-Fi setup uses the existing GATT service; credentials never enter storage or logs. */
import { retryGattBusy } from "./ble-gatt";
export const BLE_SETUP_WRITE_UUID = "b4e7a003-9d56-4f1b-a6e0-7d31c2f84590";
export const BLE_SETUP_NOTIFY_UUID = "b4e7a004-9d56-4f1b-a6e0-7d31c2f84590";
export interface SetupCharacteristic extends EventTarget {
  readonly value?: DataView;
  startNotifications(): Promise<SetupCharacteristic>;
  writeValueWithResponse?(value: Uint8Array<ArrayBuffer>): Promise<void>;
}
export interface SetupService {
  getCharacteristic(uuid: string): Promise<SetupCharacteristic>;
}
export type SetupOp = "state" | "unlock" | "scan" | "test" | "save" | "close";
export interface SetupState {
  state?: string;
  revision?: number;
  ssid?: string;
  mode?: string;
  ip?: string;
  mask?: string;
  gateway?: string;
  dns?: string;
  error?: string;
  scanning?: boolean;
  networks?: Array<{ ssid: string; rssi?: number; secure?: boolean }>;
  origins?: string[];
  authorized?: boolean;
  pending?: boolean;
  remaining_ms?: number;
  configured?: boolean;
  connected?: boolean;
}
export function encodeSetupFrames(
  payload: Uint8Array,
  sequence: number,
): Uint8Array<ArrayBuffer>[] {
  if (payload.length < 1 || payload.length > 4095) throw new Error("配网消息长度无效");
  const result: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < payload.length; offset += 12) {
    const part = payload.subarray(offset, offset + 12);
    const frame = new Uint8Array(8 + part.length);
    const view = new DataView(frame.buffer);
    frame.set([0x52, 1]);
    view.setUint16(2, sequence, true);
    view.setUint16(4, payload.length, true);
    view.setUint16(6, offset, true);
    frame.set(part, 8);
    result.push(frame);
  }
  return result;
}
export class SetupFrameAssembler {
  private buffer?: Uint8Array;
  private offset = 0;
  private sequence = 0;
  private previous?: number;
  private started = 0;
  get assembling() {
    return !!this.buffer;
  }
  reset() {
    this.buffer = undefined;
    this.offset = 0;
    this.previous = undefined;
  }
  checkTimeout(now = performance.now()) {
    if (this.buffer && now - this.started >= 10000) {
      this.reset();
      throw new Error("配网分片超时");
    }
  }
  push(value: Uint8Array | DataView, now = performance.now()): Uint8Array | null {
    try {
      this.checkTimeout(now);
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (bytes.length < 9 || bytes.length > 244 || bytes[0] !== 82 || bytes[1] !== 1)
        throw new Error("配网分片无效");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const seq = view.getUint16(2, true),
        total = view.getUint16(4, true),
        offset = view.getUint16(6, true),
        part = bytes.subarray(8);
      if (total < 1 || total > 4095 || offset + part.length > total)
        throw new Error("配网消息过长或无效");
      if (!this.buffer) {
        if (
          offset !== 0 ||
          (this.previous !== undefined &&
            (((seq - this.previous) & 65535) === 0 || ((seq - this.previous) & 65535) > 32767))
        )
          throw new Error("配网分片顺序无效");
        this.buffer = new Uint8Array(total);
        this.offset = 0;
        this.sequence = seq;
        this.started = now;
      }
      if (offset !== this.offset || seq !== this.sequence || total !== this.buffer.length)
        throw new Error("配网分片顺序无效");
      this.buffer.set(part, offset);
      this.offset += part.length;
      if (this.offset !== total) return null;
      const result = this.buffer;
      this.buffer = undefined;
      this.previous = seq;
      return result;
    } catch (error) {
      this.reset();
      throw error;
    }
  }
}
/** Requests are serialized, including characteristic discovery and each acknowledged write. */
export class BleProvisioningClient {
  private closed = false;
  private writing = false;
  private generation = 0;
  private id = 0;
  private sequence = 0;
  private initialization?: Promise<void>;
  private writer?: SetupCharacteristic;
  private notifier?: SetupCharacteristic;
  private queue: Promise<unknown> = Promise.resolve();
  private assembler = new SetupFrameAssembler();
  private frameTimer?: ReturnType<typeof setTimeout>;
  private pending?: {
    id: number;
    resolve: (data: SetupState) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private cancelRequest!: (error: Error) => void;
  private cancelled = new Promise<never>((_resolve, reject) => {
    this.cancelRequest = reject;
  });
  constructor(private service: SetupService) {
    void this.cancelled.catch(() => {});
  }
  private async start() {
    if (!this.initialization) {
      let phase = "读取配网写入特征";
      // Windows 的特征发现/订阅本身也可能不返回；迟到完成不得继续发送配置。
      const timer = setTimeout(
        () =>
          this.close(
            new Error(`蓝牙配网准备超时（${phase}）；配网会话已关闭，请断开蓝牙后重新连接。`),
          ),
        15000,
      );
      const initialize = (async () => {
        let writer: SetupCharacteristic, notifier: SetupCharacteristic;
        try {
          writer = await this.service.getCharacteristic(BLE_SETUP_WRITE_UUID);
          if (this.closed) throw new Error("配网会话已关闭");
          phase = "读取配网通知特征";
          notifier = await this.service.getCharacteristic(BLE_SETUP_NOTIFY_UUID);
        } catch (cause) {
          if (
            cause instanceof Error &&
            (cause.name === "NotFoundError" || /NotFound|not found/i.test(cause.message))
          )
            throw new Error("此固件不支持蓝牙配网，请升级固件；设备遥测仍可使用。", { cause });
          throw new Error("无法访问蓝牙配网特征，请检查浏览器蓝牙权限后重试。", { cause });
        }
        if (this.closed) throw new Error("配网会话已关闭");
        if (!writer.writeValueWithResponse)
          throw new Error("浏览器不支持加密配网写入，请更新浏览器。");
        this.writer = writer;
        this.notifier = notifier;
        notifier.addEventListener("characteristicvaluechanged", this.receive);
        phase = "订阅配网回复";
        await notifier.startNotifications();
        if (this.closed) {
          notifier.removeEventListener("characteristicvaluechanged", this.receive);
          throw new Error("配网会话已关闭");
        }
      })();
      this.initialization = Promise.race([initialize, this.cancelled]).finally(() =>
        clearTimeout(timer),
      );
    }
    await this.initialization;
  }
  private fail(error: Error) {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  private receive = () => {
    if (this.closed || !this.notifier?.value) return;
    try {
      const assembling = this.assembler.assembling;
      const bytes = this.assembler.push(this.notifier.value);
      if (bytes) {
        clearTimeout(this.frameTimer);
        const reply: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!reply || typeof reply !== "object") throw new Error("配网响应无效");
        const r = reply as { id: number; code: number; data: SetupState };
        if (
          !Number.isInteger(r.id) ||
          !Number.isInteger(r.code) ||
          !r.data ||
          typeof r.data !== "object"
        )
          throw new Error("配网响应无效");
        if (r.id !== this.pending?.id) return;
        const pending = this.pending;
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (r.code >= 400) pending.reject(new Error(r.data.error || `配网失败 (${r.code})`));
        else pending.resolve(r.data);
      } else if (!assembling) {
        this.frameTimer = setTimeout(() => {
          this.assembler.reset();
          this.fail(new Error("配网分片超时"));
        }, 10000);
      }
    } catch {
      clearTimeout(this.frameTimer);
      this.fail(new Error("配网响应无效或分片超时"));
    }
  };
  request(op: SetupOp, body = ""): Promise<SetupState> {
    const generation = this.generation;
    const run = async () => {
      if (this.closed || generation !== this.generation) throw new Error("配网会话已关闭");
      if (this.writing) throw new Error("上一笔蓝牙写入尚未结束，请断开蓝牙后重新连接。");
      await this.start();
      if (this.closed) throw new Error("配网会话已关闭");
      this.id = (this.id % 65535) + 1;
      const id = this.id;
      const result = new Promise<SetupState>((resolve, reject) => {
        this.pending = {
          id,
          resolve,
          reject,
          timer: setTimeout(() => this.fail(new Error("配网请求超时，请重试")), 15000),
        };
      });
      void result.catch(() => {});
      try {
        const frames = encodeSetupFrames(
          new TextEncoder().encode(`${id}\n${op}\n${body}`),
          ++this.sequence & 65535,
        );
        for (const frame of frames) {
          if (this.closed || !this.pending) break;
          this.writing = true;
          const write = Promise.resolve()
            .then(() =>
              retryGattBusy(
                () => this.writer!.writeValueWithResponse!(frame),
                () => !this.closed && !!this.pending,
              ),
            )
            .finally(() => {
              this.writing = false;
            });
          await Promise.race([write, result.then(() => undefined)]);
        }
        return await result;
      } catch (error) {
        if (this.pending) {
          const detail = error instanceof DOMException ? `（${error.name}: ${error.message}）` : "";
          const failure = new Error(`配网写入失败${detail}，请检查蓝牙配对权限并重试`, {
            cause: error,
          });
          this.fail(failure);
          throw failure;
        }
        throw error;
      }
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return Promise.race([result, this.cancelled]);
  }
  /** 只结束配网客户端；遥测的 GATT 由外层连接器管理。 */
  private close(reason: Error) {
    if (this.closed) return;
    this.closed = true;
    this.cancelRequest(reason);
    this.generation++;
    this.notifier?.removeEventListener("characteristicvaluechanged", this.receive);
    clearTimeout(this.frameTimer);
    this.assembler.reset();
    this.fail(reason);
    this.writer = undefined;
    this.notifier = undefined;
  }
  dispose() {
    this.close(new Error("配网已取消或蓝牙已断开"));
  }
}

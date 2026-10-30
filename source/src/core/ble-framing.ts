/** 功能：组装有界只读 BLE 状态分片。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
/** 功能：隔离消息并验证 BLE 帧边界。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export class BleFrameAssembler {
  /** 当前独占消息的有界缓冲区；完成后移交调用方。 */
  private buffer: Uint8Array | null = null;
  /** 当前消息预期的下一字节偏移。 */
  private offset = 0;
  /** 当前消息的 16 位序号。 */
  private sequence = 0;
  /** 最近完整消息序号；首次订阅之前为空。 */
  private previous: number | null = null;
  /** 当前帧开始的单调毫秒时间，不随分片延长。 */
  private startedAt = 0;
  /** 功能：报告是否存在尚未完成的帧。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  get assembling(): boolean {
    return this.buffer !== null;
  }
  /** 功能：丢弃所有消息和订阅同步状态。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  reset(): void {
    this.buffer = null;
    this.offset = 0;
    this.previous = null;
    this.startedAt = 0;
  }
  /** 功能：在没有后续通知时也可检查固定两秒组装期限。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  checkTimeout(nowMs = performance.now()): void {
    if (this.buffer && nowMs - this.startedAt >= 2000) {
      this.reset();
      throw new Error("ble_frame_timeout");
    }
  }
  /** 功能：验证头部、顺序和长度，完成时返回原始 UTF-8 字节；任何错误都会清空组装。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  push(notification: Uint8Array | DataView, nowMs = performance.now()): Uint8Array | null {
    try {
      this.checkTimeout(nowMs);
      const bytes = new Uint8Array(
        notification.buffer,
        notification.byteOffset,
        notification.byteLength,
      );
      if (bytes.length < 9 || bytes.length > 244 || bytes[0] !== 0x52 || bytes[1] !== 1)
        throw new Error("ble_frame_invalid");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        sequence = view.getUint16(2, true),
        total = view.getUint16(4, true),
        offset = view.getUint16(6, true),
        payload = bytes.subarray(8);
      if (total < 1 || total > 1023 || offset + payload.length > total)
        throw new Error("ble_frame_invalid");
      if (!this.buffer) {
        if (offset !== 0) {
          if (this.previous === null) return null;
          throw new Error("ble_frame_order");
        }
        if (this.previous !== null) {
          const delta = (sequence - this.previous) & 0xffff;
          if (delta === 0 || delta > 0x7fff) throw new Error("ble_frame_order");
        }
        this.buffer = new Uint8Array(total);
        this.offset = 0;
        this.sequence = sequence;
        this.startedAt = nowMs;
      }
      if (offset !== this.offset || sequence !== this.sequence || total !== this.buffer.length)
        throw new Error("ble_frame_order");
      this.buffer.set(payload, this.offset);
      this.offset += payload.length;
      if (this.offset !== total) return null;
      const result = this.buffer;
      this.buffer = null;
      this.offset = 0;
      this.previous = sequence;
      return result;
    } catch (cause) {
      this.reset();
      throw cause;
    }
  }
}

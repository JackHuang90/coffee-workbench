// @vitest-environment node
/** 功能：验证 BLE 分片边界及顺序，防止混帧和过期消息。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { describe, expect, it } from "vitest";
import { BleFrameAssembler } from "../src/core/ble-framing";
/** 功能：制作独立的线协议测试输入。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function fragment(
  payload: Uint8Array,
  sequence = 1,
  total = payload.length,
  offset = 0,
): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length),
    view = new DataView(bytes.buffer);
  bytes.set([0x52, 1]);
  view.setUint16(2, sequence, true);
  view.setUint16(4, total, true);
  view.setUint16(6, offset, true);
  bytes.set(payload, 8);
  return bytes;
}
describe("BLE frame assembler", () => {
  it.each([12, 236])(
    "assembles UTF8 bytes with %i payload bytes and accepts sequence rollover",
    (size) => {
      const source = new TextEncoder().encode("烘焙".repeat(170)),
        assembler = new BleFrameAssembler();
      let result: Uint8Array | null = null;
      for (let offset = 0; offset < source.length; offset += size)
        result = assembler.push(
          fragment(source.slice(offset, offset + size), 65535, source.length, offset),
          offset,
        );
      expect(result).toEqual(source);
      expect(assembler.push(fragment(new Uint8Array([123, 125]), 0), 1100)).toEqual(
        new Uint8Array([123, 125]),
      );
    },
  );
  it("ignores valid mid-frame subscription data only until the first start", () => {
    const a = new BleFrameAssembler();
    expect(a.push(fragment(new Uint8Array([2]), 17, 2, 1), 0)).toBeNull();
    expect(a.assembling).toBe(false);
    expect(a.push(fragment(new Uint8Array([1]), 18, 2, 0), 1)).toBeNull();
    expect(a.push(fragment(new Uint8Array([2]), 18, 2, 1), 2)).toEqual(new Uint8Array([1, 2]));
    expect(() => a.push(fragment(new Uint8Array([2]), 19, 2, 1), 3)).toThrow();
  });
  it.each(["duplicate", "skip", "sequence", "length", "newstart"])(
    "clears a partial assembly after %s",
    (kind) => {
      const a = new BleFrameAssembler();
      a.push(fragment(new Uint8Array([1]), 1, 3), 0);
      const broken = fragment(
        new Uint8Array([2]),
        kind === "sequence" ? 2 : 1,
        kind === "length" ? 4 : 3,
        kind === "duplicate" || kind === "newstart" ? 0 : kind === "skip" ? 2 : 1,
      );
      expect(() => a.push(broken, 1)).toThrow();
      expect(a.assembling).toBe(false);
      expect(a.push(fragment(new Uint8Array([9]), 10), 2)).toEqual(new Uint8Array([9]));
    },
  );
  it.each([
    new Uint8Array(8),
    new Uint8Array(245),
    fragment(new Uint8Array([1]), 1, 0),
    fragment(new Uint8Array([1]), 1, 1024),
    fragment(new Uint8Array([1]), 1, 1, 1),
    new Uint8Array([0x53, 1, 1, 0, 1, 0, 0, 0, 1]),
    new Uint8Array([0x52, 2, 1, 0, 1, 0, 0, 0, 1]),
  ])("rejects malformed headers even while awaiting a start", (bytes) => {
    expect(() => new BleFrameAssembler().push(bytes, 0)).toThrow();
  });
  it("enforces a two second deadline rather than extending it for every fragment", () => {
    const a = new BleFrameAssembler();
    a.push(fragment(new Uint8Array([1]), 1, 3), 0);
    a.push(fragment(new Uint8Array([2]), 1, 3, 1), 1999);
    expect(() => a.checkTimeout(2000)).toThrow();
    expect(a.assembling).toBe(false);
  });
  it("checks timeout on receipt and respects DataView offsets", () => {
    const a = new BleFrameAssembler();
    a.push(fragment(new Uint8Array([1]), 1, 2), 0);
    expect(() => a.push(fragment(new Uint8Array([2]), 1, 2, 1), 2000)).toThrow();
    const padded = new Uint8Array([0, 0, ...fragment(new Uint8Array([7])), 0]);
    expect(a.push(new DataView(padded.buffer, 2, 9), 2001)).toEqual(new Uint8Array([7]));
  });
  it("rejects repeated or backwards complete message sequences and resets explicitly", () => {
    const a = new BleFrameAssembler();
    a.push(fragment(new Uint8Array([1]), 5), 0);
    expect(() => a.push(fragment(new Uint8Array([2]), 5), 1)).toThrow();
    a.reset();
    expect(a.push(fragment(new Uint8Array([2]), 4), 2)).toEqual(new Uint8Array([2]));
  });
});

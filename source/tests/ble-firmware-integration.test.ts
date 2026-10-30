// @vitest-environment node
/**
 * 功能：通过原生固件生成状态和BLE分片，验证网页生产解码器能读取同一数据契约。
 * 首次编写日期：2026-10-30
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-30：首次编写，覆盖最小MTU、两种固件模式、序号回绕及传输损坏。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { BleFrameAssembler } from "../src/core/ble-framing";
import { validateDeviceStatus } from "../src/core/device-schema.mjs";

const compiler = process.env.CXX || "g++";
const hasCompiler = spawnSync(compiler, ["--version"], { stdio: "ignore" }).status === 0;
let directory = "";
const executables = new Map<number, string>();

/** 功能：运行生产编码器，分离原始状态与实际通知字节。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function nativeFrames(demo: number, mtu: number, sequence: number) {
  const lines = execFileSync(executables.get(demo)!, [String(mtu), String(sequence)], {
    encoding: "utf8",
    timeout: 5000,
  })
    .trim()
    .split(/\r?\n/);
  const original = lines.shift()!;
  return { original, packets: lines.map((line) => Uint8Array.from(Buffer.from(line, "hex"))) };
}

/** 功能：将固件通知交给网页真实组装器，不另建测试版解码器。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function assemble(packets: Uint8Array[], decoder = new BleFrameAssembler()) {
  let complete: Uint8Array | null = null;
  packets.forEach((packet, index) => {
    const result = decoder.push(packet, index * 5);
    if (result) complete = result;
  });
  expect(complete).not.toBeNull();
  return new TextDecoder("utf-8", { fatal: true }).decode(complete!);
}

describe.skipIf(!hasCompiler)("native BLE firmware to browser interoperability", () => {
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "coffee-ble-"));
    for (const demo of [0, 1]) {
      const output = join(directory, `ble-${demo}${process.platform === "win32" ? ".exe" : ""}`);
      execFileSync(
        compiler,
        [
          "-std=c++17",
          `-DROAST_VIRTUAL_DEMO=${demo}`,
          "-Ifirmware/include",
          "firmware/tests/ble_runner.cpp",
          "firmware/src/core.cpp",
          "firmware/src/protocol.cpp",
          "firmware/src/ble.cpp",
          "-o",
          output,
        ],
        { cwd: resolve("."), timeout: 30000 },
      );
      executables.set(demo, output);
    }
  }, 60000);
  afterAll(() => {
    if (!directory) return;
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("coffee-ble-"))
      throw new Error("unexpected native test directory");
    rmSync(target, { recursive: true, force: true });
  });

  it.each([
    [0, 23],
    [1, 23],
    [0, 247],
    [1, 247],
  ])("preserves firmware mode%d at ATT MTU%d", (demo, mtu) => {
    const { original, packets } = nativeFrames(demo, mtu, 65535);
    expect(packets.length).toBeGreaterThan(1);
    expect(
      packets.every((packet) => packet.length >= 9 && packet.length <= Math.min(mtu - 3, 244)),
    ).toBe(true);
    const decoded = assemble(packets);
    expect(decoded).toBe(original);
    const status = validateDeviceStatus(JSON.parse(decoded));
    expect(status.mode).toBe(demo ? "VIRTUAL_DEMO" : "LOCKED");
    expect(status.session).toBe(12345);
    expect(status.uptime_ms).toBe(1000);
    expect(status.owner).toBe("none");
    expect(status.physical_enabled).toBe(false);
    expect(status.physical_actual_pct).toBeNull();
    if (!demo) {
      expect(status.sensor_valid).toBe(false);
      expect(status.bt).toBeNull();
      expect(status.et).toBeNull();
    } else {
      expect(status.sensor_valid).toBe(true);
      expect(status.bt).toBeTypeOf("number");
      expect(status.et).toBeTypeOf("number");
    }
  });

  it("accepts native message sequence rollover without changing JSON", () => {
    const decoder = new BleFrameAssembler(),
      last = nativeFrames(1, 247, 65535),
      first = nativeFrames(1, 247, 0);
    expect(assemble(last.packets, decoder)).toBe(last.original);
    expect(assemble(first.packets, decoder)).toBe(first.original);
  });

  it("rejects a missing native fragment instead of showing a mixed snapshot", () => {
    const { packets } = nativeFrames(1, 23, 1),
      decoder = new BleFrameAssembler();
    expect(decoder.push(packets[0]!, 0)).toBeNull();
    expect(() => decoder.push(packets[2]!, 10)).toThrow();
    expect(decoder.assembling).toBe(false);
  });

  it("rejects a native frame whose declared payload size changed in transit", () => {
    const { packets } = nativeFrames(1, 247, 1),
      decoder = new BleFrameAssembler(),
      damaged = packets[1]!.slice();
    damaged[4] = damaged[4]! ^ 1;
    expect(decoder.push(packets[0]!, 0)).toBeNull();
    expect(() => decoder.push(damaged, 5)).toThrow();
    expect(decoder.assembling).toBe(false);
  });
});

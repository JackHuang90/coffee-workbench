// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { encodeSetupFrames, SetupFrameAssembler } from "../src/core/ble-provisioning";

const compiler = process.env.CXX || "g++";
const hasCompiler = spawnSync(compiler, ["--version"], { stdio: "ignore" }).status === 0;
let directory = "";
let executable = "";

describe.skipIf(!hasCompiler)("real firmware / browser Wi-Fi setup framing", () => {
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "coffee-setup-"));
    executable = join(directory, `setup${process.platform === "win32" ? ".exe" : ""}`);
    execFileSync(
      compiler,
      [
        "-std=c++17",
        "-Ifirmware/include",
        "firmware/tests/setup_runner.cpp",
        "firmware/src/ble_setup.cpp",
        "-o",
        executable,
      ],
      { timeout: 30000 },
    );
  }, 40000);
  afterAll(() => {
    if (!directory) return;
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("coffee-setup-"))
      throw new Error("unexpected test directory");
    rmSync(target, { recursive: true, force: true });
  });

  it.each([1, 65535, 0])("accepts browser UTF-8 requests in firmware at sequence %i", (seq) => {
    const body = new URLSearchParams({
      ssid: "咖啡工坊 ☕",
      password: "test-only&=中文",
      mode: "dhcp",
      origins: "https://coffee.example",
    });
    const request = `42\ntest\n${body}`;
    const frames = encodeSetupFrames(new TextEncoder().encode(request), seq);
    const decoded = execFileSync(executable, ["decode"], {
      input: frames.map((f) => Buffer.from(f).toString("hex")).join("\n"),
      encoding: "utf8",
      timeout: 5000,
    });
    expect(decoded).toBe(request);
  });

  it.each([12, 236])("decodes actual firmware response frames with %i payload bytes", (size) => {
    const response = JSON.stringify({
      id: 42,
      code: 200,
      data: {
        authorized: true,
        state: "Ready",
        revision: 7,
        ssid: "咖啡工坊 ☕",
        networks: Array.from({ length: 12 }, (_, i) => ({
          ssid: "网络".repeat(8) + i,
          rssi: -40 - i,
        })),
      },
    });
    const lines = execFileSync(executable, ["encode", String(size)], {
      input: response,
      encoding: "utf8",
      timeout: 5000,
    })
      .trim()
      .split("\n");
    const assembler = new SetupFrameAssembler();
    let result: Uint8Array | null = null;
    for (const line of lines)
      result = assembler.push(Uint8Array.from(Buffer.from(line.trim(), "hex")), 0);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(result!)).toBe(response);
  });

  it("cannot deliver a test command with a missing browser fragment", () => {
    const frames = encodeSetupFrames(
      new TextEncoder().encode("1\ntest\nssid=Coffee&password=test-only-password&mode=dhcp"),
      1,
    );
    frames.splice(1, 1);
    const result = spawnSync(executable, ["decode"], {
      input: frames.map((f) => Buffer.from(f).toString("hex")).join("\n"),
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});

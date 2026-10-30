import type { Sample } from "./types";
export type TrackingState = "idle" | "ready" | "running" | "manual" | "completed" | "fault";
export interface TrackingConfig {
  /** Teaching-model gains; these are not hardware tuning recommendations. */
  kp: number;
  ki: number;
  kd: number;
  ambient: number;
  heatPower: number;
  heatLoss: number;
  transferRate: number;
}
export interface TrackingSnapshot {
  state: TrackingState;
  elapsed: number;
  duration: number;
  targetBt: number | null;
  bt: number | null;
  et: number | null;
  error: number | null;
  /** Simulated heat request only, in percent. Never a device command. */
  output: number;
  reason: string;
  /** Separate simulated trajectory, with time relative to the confirmed origin. */
  samples: Sample[];
}
const MAX_GAP = 5;
const MAX_SAMPLES = 15000;
const defaults: TrackingConfig = {
  kp: 4,
  ki: 0.08,
  kd: 0.6,
  ambient: 25,
  heatPower: 4.2,
  heatLoss: 0.016,
  transferRate: 0.035,
};
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const validTemp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= -50 && value <= 500;
const empty = (): TrackingSnapshot => ({
  state: "idle",
  elapsed: 0,
  duration: 0,
  targetBt: null,
  bt: null,
  et: null,
  error: null,
  output: 0,
  reason: "尚未准备仿真目标。",
  samples: [],
});
/**
 * Offline teaching simulation, deliberately independent of playback and wall time.
 * No timers, network, serial ports, firmware or physical output exist in this module.
 * Callers must stop/dispose their own scheduling when replacing a document or target.
 */
export class TrackingController {
  private value = empty();
  private target: Sample[] = [];
  private origin = 0;
  private integral = 0;
  private previousFeedback: number | null = null;
  private readonly config: TrackingConfig;
  private readonly configValid: boolean;
  constructor(config: Partial<TrackingConfig> = {}) {
    this.config = { ...defaults, ...config };
    this.configValid =
      Object.entries(this.config).every(
        ([key, value]) =>
          Number.isFinite(value) &&
          (key === "ambient" ? value >= -50 && value <= 100 : value >= 0 && value <= 1000),
      ) && this.config.heatPower > 0;
  }
  get snapshot(): TrackingSnapshot {
    return { ...this.value, samples: this.value.samples.map((sample) => ({ ...sample })) };
  }
  /** Explicit CHARGE time or a user-confirmed sample origin is required. */
  prepare(samples: Sample[], origin?: number): TrackingSnapshot {
    this.value = empty();
    this.target = [];
    this.integral = 0;
    this.previousFeedback = null;
    if (!this.configValid) return this.fault("仿真参数无效；输出已归零。");
    if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_SAMPLES)
      return this.fault("目标需要 2–15000 个采样点。");
    let previous = -1;
    for (const sample of samples) {
      if (
        !sample ||
        !Number.isFinite(sample.t) ||
        sample.t < 0 ||
        sample.t > 86400 ||
        sample.t <= previous
      )
        return this.fault("目标时间须为有限、非负且严格递增的秒数。");
      if (previous >= 0 && sample.t - previous > MAX_GAP)
        return this.fault("目标采样间断超过 5 秒，不能跨越缺口仿真。");
      if (!validTemp(sample.bt)) return this.fault("目标豆温缺失或无效，不能开始仿真。");
      if (sample.et !== null && !validTemp(sample.et)) return this.fault("目标环境温无效。");
      previous = sample.t;
    }
    if (
      origin === undefined ||
      !Number.isFinite(origin) ||
      origin < samples[0].t ||
      origin >= samples[samples.length - 1].t
    )
      return this.fault("请确认入豆事件或选择有效采样起点；起点之后须有目标覆盖。");
    this.target = samples.map((sample) => ({ ...sample }));
    this.origin = origin;
    const first = this.interpolate(origin)!;
    this.value = {
      state: "ready",
      elapsed: 0,
      duration: samples[samples.length - 1].t - origin,
      targetBt: first.bt,
      bt: first.bt,
      et: first.et ?? Math.min(500, first.bt! + 25),
      error: 0,
      output: 0,
      reason: "目标已校验，等待开始仿真。",
      samples: [],
    };
    this.value.samples.push({ t: 0, bt: this.value.bt, et: this.value.et });
    return this.snapshot;
  }
  start(): TrackingSnapshot {
    if (this.value.state === "ready") {
      this.value.state = "running";
      this.value.reason = "闭环仿真运行中；无硬件输出。";
      this.previousFeedback = null;
    }
    return this.snapshot;
  }
  pause(): TrackingSnapshot {
    if (this.isActive()) {
      this.value.state = "ready";
      this.value.output = 0;
      this.value.reason = "仿真已暂停；输出归零，可继续。";
      this.previousFeedback = null;
    }
    return this.snapshot;
  }
  stop(): TrackingSnapshot {
    this.value.state = "idle";
    this.value.output = 0;
    this.value.reason = "仿真已停止；输出归零，请重新准备目标。";
    this.integral = 0;
    this.previousFeedback = null;
    return this.snapshot;
  }
  takeManual(): TrackingSnapshot {
    if (this.value.state === "running") {
      this.value.state = "manual";
      this.value.output = 0;
      this.value.reason = "手动仿真接管；PID 已停用，无硬件输出。";
      this.integral = 0;
      this.previousFeedback = null;
    }
    return this.snapshot;
  }
  setManualOutput(percent: number): TrackingSnapshot {
    if (this.value.state !== "manual") return this.snapshot;
    if (!Number.isFinite(percent)) return this.fault("手动仿真输出无效；输出已归零。");
    this.value.output = clamp(percent);
    return this.snapshot;
  }
  /**
   * dt is independent simulation time. Missing/invalid optional feedback is a fault;
   * omitting it uses the toy plant's BT. This input is for deterministic testing,
   * not an implemented hardware channel. Large clock gaps never get replayed.
   */
  step(dtSeconds: number, measuredOverride?: number | null): TrackingSnapshot {
    if (!this.isActive()) return this.snapshot;
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || dtSeconds > MAX_GAP)
      return this.fault("仿真时钟间断或无效（允许 0–5 秒）；输出已归零。");
    if (arguments.length > 1 && !validTemp(measuredOverride))
      return this.fault("反馈豆温缺失或无效；输出已归零。");
    if (this.value.samples.length >= MAX_SAMPLES)
      return this.fault("仿真样本已达上限；请保存后重新开始。");
    const dt = Math.min(dtSeconds, this.value.duration - this.value.elapsed);
    const elapsed = this.value.elapsed + dt;
    const target = this.interpolate(this.origin + elapsed);
    if (!target || !validTemp(target.bt)) return this.fault("目标覆盖中断；输出已归零。");
    const feedback = measuredOverride === undefined ? this.value.bt! : measuredOverride!;
    if (!validTemp(feedback)) return this.fault("仿真反馈无效；输出已归零。");
    if (this.value.state === "running") {
      const error = target.bt - feedback;
      const derivative =
        this.previousFeedback === null ? 0 : -(feedback - this.previousFeedback) / dt;
      const feedForward =
        ((Math.max(0, feedback - this.config.ambient) * this.config.heatLoss) /
          this.config.heatPower) *
        100;
      const proposedIntegral = clamp(this.integral + this.config.ki * error * dt, -100, 100);
      const raw =
        feedForward + this.config.kp * error + proposedIntegral + this.config.kd * derivative;
      // Conditional integration prevents accumulating error while the actuator is saturated.
      if (!((raw > 100 && error > 0) || (raw < 0 && error < 0))) this.integral = proposedIntegral;
      this.value.output = clamp(
        feedForward + this.config.kp * error + this.integral + this.config.kd * derivative,
      );
      this.previousFeedback = feedback;
    }
    // Integrate a two-state toy thermal plant with bounded substeps, not target values.
    let bt = this.value.bt!,
      et = this.value.et!;
    const count = Math.ceil(dt / 0.1),
      h = dt / count;
    for (let i = 0; i < count; i++) {
      const etChange =
        (this.config.heatPower * this.value.output) / 100 -
        this.config.heatLoss * (et - this.config.ambient);
      const btChange = this.config.transferRate * (et - bt);
      et += etChange * h;
      bt += btChange * h;
    }
    if (!validTemp(bt) || !validTemp(et)) return this.fault("仿真热模型超出有效范围；输出已归零。");
    this.value.elapsed = elapsed;
    this.value.targetBt = target.bt;
    this.value.bt = bt;
    this.value.et = et;
    this.value.error = target.bt - (measuredOverride === undefined ? bt : measuredOverride!);
    this.value.samples.push({ t: elapsed, bt, et });
    if (elapsed >= this.value.duration) {
      this.value.state = "completed";
      this.value.output = 0;
      this.value.reason = "已到达目标末端；仿真结束，输出归零。";
    }
    return this.snapshot;
  }
  private isActive(): boolean {
    return this.value.state === "running" || this.value.state === "manual";
  }
  private fault(reason: string): TrackingSnapshot {
    this.value.state = "fault";
    this.value.output = 0;
    this.value.reason = reason;
    this.integral = 0;
    this.previousFeedback = null;
    return this.snapshot;
  }
  private interpolate(t: number): Sample | null {
    if (!this.target.length || t < this.target[0].t || t > this.target[this.target.length - 1].t)
      return null;
    let low = 0,
      high = this.target.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2),
        sample = this.target[middle];
      if (sample.t === t) return { ...sample };
      if (sample.t < t) low = middle + 1;
      else high = middle - 1;
    }
    const left = this.target[high],
      right = this.target[low];
    if (
      !left ||
      !right ||
      right.t - left.t > MAX_GAP ||
      !validTemp(left.bt) ||
      !validTemp(right.bt)
    )
      return null;
    const ratio = (t - left.t) / (right.t - left.t);
    return {
      t,
      bt: left.bt + (right.bt - left.bt) * ratio,
      et: validTemp(left.et) && validTemp(right.et) ? left.et + (right.et - left.et) * ratio : null,
    };
  }
}

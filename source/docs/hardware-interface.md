# Simulation boundary and future ESP32-S3 interface

> Historical pre-firmware proposal. Current frozen contract is [firmware/docs/protocol.md](../firmware/docs/protocol.md); current web connection is [local-connection.md](local-connection.md), read-only. Do not interpret the proposal below as deployed transport behavior.

## What exists in this source tree

`src/core/tracking.ts` is a deterministic, offline teaching simulator. It has no timer, transport, network, serial API, sensor driver, ESP firmware, or physical output. The web app must display **仿真** and **未连接 ESP32-S3**. Real tracking must remain disabled until a separately reviewed hardware implementation exists. There is no compiled firmware to include in the current delivery.

The simulator is separate from journal playback. Its two-state toy thermal plant evolves ET and BT from simulated heat, heat loss and heat transfer; it never assigns the target BT to the simulated BT after initialization. Its gains and model parameters are illustrative, not roaster tuning advice. ET fallback when absent is explicitly synthetic model initialization, never a claimed sensor reading. `samples` are elapsed-relative simulated readings, not edits to the reference.

## Pure controller contract

```ts
new TrackingController(config?: Partial<TrackingConfig>)
controller.prepare(samples: Sample[], origin?: number): TrackingSnapshot
controller.start(): TrackingSnapshot
controller.pause(): TrackingSnapshot
controller.stop(): TrackingSnapshot
controller.takeManual(): TrackingSnapshot
controller.setManualOutput(percent: number): TrackingSnapshot
controller.step(dtSeconds: number, measuredOverride?: number | null): TrackingSnapshot
controller.snapshot: TrackingSnapshot
```

All snapshots are independent copies. Fields are `state`, `elapsed`, `duration`, `targetBt`, `bt`, `et`, `error` (target minus feedback), `output` (simulated heat percent), `reason`, and `samples`. No fan feedback is invented. Config keys are `kp`, `ki`, `kd`, `ambient`, `heatPower`, `heatLoss`, and `transferRate`; these are toy-model parameters.

- `prepare` requires a CHARGE time or an explicitly user-confirmed first-sample time. Omission is a fault, not silent alignment. Origin must leave positive coverage. All target times must be finite, strictly increasing, 0–86400 seconds; 2–15000 samples, no gaps over 5 seconds, valid BT at every point. ET may be null. No extrapolation or interpolation across missing BT is allowed.
- `idle → ready → running` is explicit. `pause` returns to `ready`, retaining elapsed time and zeroing output. Resume requires `start`. Manual takeover is available only from `running`, disables PID and initially zeros output. Manual heat is clamped to 0–100%.
- `stop → idle`, target end `→ completed`, invalid target/feedback/timing/model `→ fault`. All zero output. Idle, completed and fault states ignore `start`, manual commands and `step`; a fresh `prepare` is required.
- `step` uses the caller's deterministic simulation dt, not wall time. Allowed dt is greater than 0 and at most 5 seconds. A large missed interval faults rather than rapidly replaying old commands. The optional feedback override is only a deterministic test seam; omission reads the toy BT, whereas explicitly supplied null/invalid feedback faults.
- PID uses bounded output, bounded integral and conditional integration to avoid windup while saturated. The thermal plant integrates in ≤0.1-second substeps. Samples stop at the target end; the last output is zero. The 15000-sample cap faults safely rather than growing memory unboundedly.

The Vue lifecycle owner must stop scheduling on pause/stop/fault/completion, on target/reference changes, before replacing/importing/resetting a document, and on unmount. Preparing a replacement itself zeros the controller immediately. Browser scheduling is only for visible offline animation; it is not a safety controller.

## Future hardware design (not implemented)

A future ESP32-S3 firmware must own the local monotonic scheduler, validated thermocouple/sensor acquisition, bounded PID/output scheduling, command expiry, and watchdogs. The browser may upload a validated immutable target and explicit mode requests, but must not stream individual heater ticks or rely on cloud/browser timers for safety.

A future reviewed message envelope should contain a protocol version, session ID, monotonic sequence number, target hash, command kind, validity deadline, and explicit units. Reject unknown versions, stale/replayed sequences, non-finite/out-of-range values, malformed targets and expired commands. Authentication and local authorization must be designed before accepting control requests. Imported curve files are inert data and must never carry executable commands.

Minimum local safety behavior to specify and validate against the actual roaster:

1. On boot, disconnect, sensor failure/staleness, watchdog expiry, controller fault or session end, transition to a defined safe state with heater off. Cooling/fan behavior must be engineered for the machine, not inferred from this toy model.
2. Independent temperature limits and hardware interlocks must remain effective without the web page, Wi-Fi or cloud service. Emergency stop is a physical local function; a browser button is not a substitute.
3. Confirm every requested mode transition and report measured BT/ET, sensor timestamps/validity, active session/mode, requested output and independently observed actuator feedback separately. Absent output feedback remains unavailable, never “success”.
4. Manual takeover must revoke automatic control locally. Re-enabling automatic tracking requires an explicit acknowledged re-arm; changing targets while active first stops the old session.
5. Test disconnects, frozen UI, lost/reordered commands, sensor open/short circuits, reboot/brownout, watchdog expiry, target exhaustion and output failure before connecting a heater.

Actual pins, output polarity, sensor devices, temperature limits, watchdog periods, fan-safe state, firmware binary and flash steps remain unspecified until the user's real hardware is known and separately authorized. This document does not silently manufacture or deploy firmware.

# ESP32-S3 firmware rebuild — 2026-10-28

This is new source, not restoration of the lost firmware. The deployed Vue/Pinia console remains an offline simulator; it does not yet upload these profiles. The user's desired end state is recorded/imported BT-curve replay under device-local control with Artisan interoperability. This release establishes tested firmware architecture and two real SDK builds, **not a qualified roasting machine**.

## Release scope and safety boundary

- C++17 portable controller and bounded protocol shared by native tests and ESP32-S3 build. Reference carrier: ESP32-S3-DevKitC-1 configuration, 16 MB flash/8 MB OPI PSRAM; actual carrier must be identified before flashing.
- `ROAST_VIRTUAL_DEMO=0`: LOCKED. No physical sensor bound, BT/ET unavailable, all output-changing commands rejected, output zero. `=1`: permanently labelled VIRTUAL_DEMO, toy thermal plant and virtual output only. Neither image has actuator GPIO/DAC/SSR/UART bindings or a runtime unlock path.
- The hardware profile is unverified. No assignment of GPIO, analog drivers, PT100/K input, airflow, emergency cutoff, or mains switching is inferred. Successful compilation establishes no physical safety.
- Two future mutually exclusive profiles: instrument PID receives qualified SV commands (S3 schedules target, instrument owns heater PID), OR direct S3 PID owns a qualified heater driver. Never two PIDs controlling the same actuator. Cooling/fan safe behavior requires physical engineering and is not represented by simulated heater-off.

## Architecture and interfaces

`include/roast/core.hpp` + `src/core.cpp`: fixed-capacity curve staging/commit; linear interpolation; controller state machine and conditional-integral PID; output port contract; fake plant. Times use uint32 monotonic milliseconds with wrap-safe subtraction and bounded intervals. Hard limits: 1024 points, 30 min, 5 s adjacent gap, -20..280 C target, 300 C software sensor limit, 0..100% virtual demand, 1 s sensor freshness, 1 s scheduler gap, 5 s command lease. These are demonstration limits, not tuning/safety recommendations for hardware.

`include/roast/protocol.hpp` + `src/protocol.cpp`: bounded ASCII command envelope and JSON responses, no third-party JSON parser required. Commands include session, strictly increasing sequence and expiry; bounded parsing rejects NaN, overflow, trailing data and oversized packets. A random boot/session ID prevents stale commands after restart. Curve data are inert integer milliseconds/deci-Celsius, staged sequentially and atomically committed by hash. Repeated sequence numbers are rejected, never reapplied.

`include/roast/modbus.hpp` + `src/modbus.cpp`: bounded Modbus TCP FC03 normalized register reads and FC06 **stop-only unless explicitly USB-granted virtual Artisan mode** registers; no start/rearm through unauthenticated Artisan Modbus. Invalid sensors return exception, never fabricated zero. Distinct demo status bit. Incremental MBAP framing handles truncation and timeout.

`include/roast/rtu.hpp` + `src/rtu.cpp`: optional parameterized Modbus RTU read-PV codec/state machine tested against fake byte streams, not connected to UART. Candidate seller addresses are not a verified device profile; no write/SV/shutdown operation is implemented.

`src/main.cpp`: Arduino USB CDC serial, bounded nonblocking transport budgets, persistent Wi-Fi setup through an embedded protected hotspot, HTTP GET status and authenticated bounded demo POST command endpoint, Modbus TCP (explicit USB-granted virtual modes added below). Current builds default to per-device WPA2 setup; only status GET/OPTIONS accepts exact configured HTTPS or permitted localhost/loopback/private-IPv4 HTTP origins, never wildcard CORS. See [provisioning](provisioning.md); no network commands energize anything. Watchdog and loop lapse result in zero virtual output/fault; reboot requires fresh explicit session and arm.

## State and acknowledgement contract

LOCKED; IDLE; READY; ARMED; RUNNING; PAUSED; MANUAL; COMPLETED; FAULT. Only DEMO supports explicit enable/prepare/arm/start. Curve commit leaves READY, arm starts a short lease, start uses device time, pause zeros output and freezes elapsed. Resume requires ARM then START. Manual takeover revokes automatic operation and zeros request before MANUAL output. Re-entering auto requires STOP then explicit ARM/START (elapsed resets). STOP zeros demand and disarms. Faults latch until explicit STOP after the cause clears. Sensor invalidity/staleness, deadline/liveness expiry, loop gap, maximum duration, and overtemperature terminate operation. Restart never restores an armed state. USB unplug is not reliably observable; the expiring lease detects lost client liveness.

ACK means command validated and software state committed, not physical actuation. Status reports pending request ID, last accepted ID, requested percent, virtual-applied percent, physical actual=null, physical enabled=false, source=unavailable|virtual_demo. No acknowledgement is physical feedback.

## Alternatives and chosen scope

1. Direct hardware control now: rejected because wiring, drivers, registers and safety chain are unverified.
2. Only an empty ESP sketch: rejected because it does not implement local replay/control.
3. Portable tested local controller plus locked/demo SDK images: chosen under the explicit rebuild request; reaches a meaningful software milestone without guessing electrical details.

## Verification and release

TDD for curve/protocol/controller/RTU/Modbus; native locked and demo builds exercise the same source as ESP32. End-to-end client covers upload → commit → arm → start → measured toy-plant feedback → manual → stop. Adversarial cases cover sizes, checksums, duplicate/replay, truncation, timeouts, non-finite input, wrap, stale sensor, pause/rearm and immutable commit. Compile both actual S3 targets using pinned PlatformIO/platform/framework/compiler. Retain ELF, application, bootloader, partition binaries and generated offset evidence; hash manifest and offline image verification. Do not upload/flash/monitor, erase flash or burn efuses. Independent review before packaging. Parent handles source/Git archive and remote checkpoint persistence; no Site publication.

## Added Artisan interoperability scope (explicit user follow-up)

The user requested not just Artisan temperature reads but IP/port virtual control. USB alone can grant one of two mutually exclusive, permanently virtual modes for a fixed **5 minutes**:

- `ARTISAN_POWER`: Artisan's external PID or sliders own requested virtual heater power. Firmware PID is off. SV writes reject.
- `ARTISAN_SV`: Artisan sends BT setpoint; the firmware's sole virtual PID owns virtual heat. Direct heat writes reject; Artisan external PID must be disabled.

Virtual fan requests are supported in both; the toy plant adjusts its heat-loss term, not any fan hardware. Grants require fresh toy sensors, an inactive controller, and local USB authorization. Modbus cannot create or renew a grant. Valid Modbus control writes/heartbeat renew only a 5-second liveness lease; **FC03 reads do not renew it**. Either lease expiry or fixed grant expiry zeros virtual heat/fan, faults, releases ownership and rejects late writes. New explicit STOP then USB grant is required. USB/HTTP automatic-curve ownership is explicit; a competing channel is rejected. STOP is the only cross-owner operation and can only revoke control. No two PID owners coexist.

Modbus TCP itself is unauthenticated and unencrypted: this deliberately local demo must be used only on a trusted isolated LAN. A grant permits the connected Modbus client, not authenticated identity. The adapter closes old clients at a new grant boundary to discard pre-grant queued frames; this does not make the protocol secure against a malicious LAN peer. Physical control remains out of scope and absent.

## Web BLE status adapter (2026-10-30)

`ble.cpp` owns bounded framing, immutable snapshots, pacing and subscription generations. `esp_ble.cpp` uses the Arduino 3.3.12 SDK's bundled NimBLE implementation. A short critical section protects the shared connection/subscription/MTU record; it never contains a wireless call or a Controller read. Only the main loop serializes controller status. It submits a single fixed-size message using a zero-wait queue and waits for the previous receipt before submitting another.

A static relay task forwards each message to the NimBLE host event queue. This confines SDK queue waits to that task. The host event rechecks the subscription generation and MTU, then submits exactly one custom notification and returns its result. Host callbacks and notification submission therefore serialize in the same task; no connection/CCCD maps are read from the main loop. A failed enqueue does not advance the stream. Memory congestion is retried with bounded pacing; excessive delay disconnects only BLE.

BLE initialization and initial Wi-Fi provisioning precede enrollment of the application watchdog and the Controller's first tick. Once running, the Controller tick remains first, followed by existing USB/network work and bounded BLE work. BLE is active without Wi-Fi credentials and does not stop on first-boot SoftAP. The pinned SDK enables software Wi-Fi/BLE coexistence; its radio timing, SoftAP coexistence and on-device stack high-water marks still require bench testing. Build and native protocol evidence cannot establish those hardware properties.

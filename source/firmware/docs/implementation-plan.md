# Safe ESP32-S3 Firmware Implementation Plan

> Execute this scoped rebuild with test-first implementation and independent review.

**Goal:** Deliver a genuinely compiled, portable-core-tested LOCKED and VIRTUAL_DEMO S3 firmware release without physical actuator bindings.
**Architecture:** Fixed-capacity portable C++17 controller/protocol plus Arduino transport adapter. The same controller drives native simulation and the on-device demo.
**Tech Stack:** C++17, PlatformIO 6.2.0, pinned official espressif32 platform, Arduino ESP32; no dynamic JSON dependency.
**Spec:** `design.md`; bounded wire protocol in `protocol.md`.

- [x] Commit design and command contract before product code.
- [x] Add failing native tests for bounded curve upload/hash, interpolation, PID, safety state transitions, monotonic wrap and replay protection; implement core and ASCII protocol.
- [x] Add failing fake-stream tests for RTU reader and normalized Modbus TCP framing/registers; implement read-only physical codec and explicitly USB-granted virtual-only network control (user-requested extension).
- [x] Install verified official pinned toolchain into project-local ignored `.tools`; implement nonblocking Arduino USB/optional Wi-Fi transport; compile locked and demo reference images.
- [x] Exercise native end-to-end simulated client and production-lock variations, sanitizers, existing web regression suite; review code independently and fix findings.
- [ ] Verify actual binaries offline, retain build offsets/provenance/logs and SHA256 manifest; document exact flash commands only for confirmed reference mapping. Commit source; parent packages source+Git+binaries and persists remote checkpoint.

Review focus: output cannot escape compile-time lock; stale/expired traffic cannot rearm; partial curve updates cannot replace active profile; bounds/checksums/NaN/clock wrap cannot create demand; HTTP/serial/Modbus work budgets cannot starve safety.

Final artifact verification is recorded in artifacts/manifest.json and SHA256SUMS; source/Git packaging and remote persistence are coordinated by the parent task. See validation.md for evidence and unverified hardware limits.

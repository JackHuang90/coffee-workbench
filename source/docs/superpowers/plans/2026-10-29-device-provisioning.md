> 公开版本说明：本页历史部署域名和平台标识已脱敏；示例域名不代表可访问站点。

# Device provisioning and browser LAN connection implementation plan

> **For agentic workers:** Use test-driven implementation and independent review. Independent firmware and web work may run concurrently under superpowers:dispatching-parallel-agents. Progress is recorded below.

**Goal:** First-boot hotspot provisioning with DHCP/static IPv4, durable settings, BOOT recovery and RGB status, plus hosted-web read-only LAN connectivity without local Node.

**Architecture:** Existing Arduino firmware gets a bounded provisioning subsystem and origin-aware read-only HTTP status. Vue selects direct LAN transport on HTTPS and retains the existing bridge transport. The frozen v1 device status schema remains the integration contract.

**Tech Stack:** C++17, pinned Arduino ESP32/PlatformIO, Preferences/NVS, existing Vue 3/TypeScript/Vitest.

**Spec:** `../specs/2026-10-29-device-provisioning-design.md`.

## Global constraints

- No physical actuator binding or unlock; preserve LOCKED and VIRTUAL_DEMO.
- No unsolicited LAN probe: explicit connect click only, private numeric IPv4:80, fixed `/api/v1/status`, no redirects/credentials.
- Configurable exact HTTPS origins; browser access applies only to read-only status, never command/configuration mutation.
- BOOT GPIO0 low-active, 5 seconds then release; WS2812 GPIO48 with configurable GRB/brightness. RESET remains ordinary restart.
- No network-blocking waits in controller loop. No automatic flashing or device erase. User subsequently authorized creating and publishing a replacement Site; preserve its default owner-private audience.
- Date for source annotations: 2026-10-29 Asia/Shanghai; follow comment-code-changes for touched source types/functions.
- Board evidence and actual hardware validation are distinct. Never report successful native/reference build as real board validation.

## Review focus

1. Wrong Wi-Fi password or failed persistent save leaves a usable setup portal and previous valid settings.
2. Static-to-DHCP transitions discard old IP state; AP and STA address overlap remains recoverable.
3. Browser permission time and cancel/reconnect races never resurrect a disconnected session.
4. AP+STA cannot expose configuration writes to router-side or cross-site clients.
5. Boot-held-during-startup, bounce and timer wrap do not erase settings accidentally.

## Task 1 — Firmware provisioning and origin-aware status

**Ownership:** `firmware/**` except saved user evidence. Parent owns top-level docs and integration.

**Interfaces:** preserve current `GET /api/v1/status` JSON. Accept browser Origin only when configured exact origin is allowed; emit appropriate CORS and Vary. Legacy no-Origin status requests remain valid. No Origin authorization on command endpoint. Provisioning API is private to device hotspot; API field names chosen consistently by firmware page and server.

- [x] Write and run failing native tests for config validation, durable-record recovery, origin allow/deny/preflight, BOOT threshold/release and network state transitions.
- [x] Implement portable bounded core and native HTTP boundary tests; integrate nonblocking ESP Wi-Fi/NVS/AP portal and embedded mobile form, scan/manual SSID, DHCP/static, origin list, test then save.
- [x] Add board configuration for supplied GPIO0/WS2812 GPIO48; keep identity/AP credentials over network reset; clear configuration only with physical long press.
- [x] Run all existing native suites and new suites, and both pinned ESP locked/demo SDK builds if runtime available. Record exact failures/tool limitations; fix introduced failures.
- [x] Update firmware README, build/flash protocol docs and validation evidence without claiming physical verification.

## Task 2 — Web direct LAN transport and connection UI

**Ownership:** `src/**`, `tests/**` and web build config only if needed; do not edit firmware or bridge tool without coordination.

**Interfaces:** implement a common connection client contract preserving discover/connect/refresh/disconnect/dispose/snapshot; `connect({ip})` only sends GET to `http://<private-ip>/api/v1/status` for direct transport, feeds existing validateDeviceStatus. Existing bridge compatibility remains testable.

- [x] Add failing behavior tests: no fetch before click; target validation; actual connected status; reset/stale/malformed status; timeout and late completion; pagehide; error diagnosis; local bridge compatibility.
- [x] Add direct client and transport selection, reuse schema and lifecycle logic where sound. Permission timeout is longer for first request and bounded, polling does not issue overlapping requests.
- [x] Update connection dialog and app labels: direct Wi-Fi default on hosted HTTPS, current origin copy, provisioning instructions, manual bridge compatibility, accurate mobile support and recoverable errors. Preserve compact existing layout and local data.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`; cover real rendered connection panel on desktop/mobile.

## Task 3 — Integration, documentation and release verification

**Ownership:** parent.

- [x] Preserve original board images and verify hashes; update design to include user-requested web scope and supplied GPIO evidence.
- [x] Establish baseline test/tool results, review firmware/web diffs and execute cross-boundary tests using the actual C++ HTTP handler where possible.
- [x] Update README and `docs/local-connection.md` for first-time setup, network recovery, source whitelist and compatibility path.
- [x] Run final web suite/build and firmware tests/builds, inspect browser layout, obtain independent review and fix material findings with regression tests.
- [x] Deliver source changes/build outputs and publish the user-authorized replacement Site with clear actual-board status. Do not flash hardware.

## Progress and decisions

- 2026-10-29: User explicitly requested firmware provisioning and then same-change web connection implementation. Proceed within that authorized scope; do not add repeated permission gates for reversible source edits.
- 2026-10-29: User board evidence saved byte-for-byte; GPIO0 BOOT / GPIO48 WS2812 adopted, N16R8 retained despite mixed sample photos. No physical flashing authorized or performed.
- 2026-10-29: Existing frozen firmware restriction applied to earlier project phase; the current user request authorizes these firmware modifications.
- 2026-10-29: Work on `codex/wifi-provisioning` in the existing checkout; source tree was clean except this task's design before beginning.
- 2026-10-29: User authorized a replacement Site after deleting the old one, and Chrome debugging on their existing localhost:5173 dev server. Created `[deployment-id-redacted]`, default owner-private, expected origin `https://coffee-workbench.example`. Reused the running server.
- 2026-10-29: Chrome 375/320-pixel checks revealed select text clipping from inherited fixed height; corrected local component sizing and confirmed 320-pixel view has no dialog horizontal overflow.
- 2026-10-29: Windows native fixtures exposed POSIX-only socket headers/pipe select and a synchronous HTTP oracle event-loop blockage. Corrected fixture portability; Modbus loopback 10 tests pass. Firmware physical behavior remains unverified.

- 2026-10-29: Final native, Python, embedded-page and three SDK checks passed; independent review findings closed. See docs/verification-provisioning.md. Final Site publication proceeds through the dedicated verified checkout; no hardware flashing.
- 2026-10-29: The outer Git repository was externally replaced with an inner repository during work. Existing structure retained; artifact provenance records actual HEAD/dirty state and source hashes instead of claiming the earlier branch is still present.

- 2026-10-29: Replacement Site published successfully at https://coffee-workbench.example, source commit fd5310ecdfc9a6082be86e80efe84121352d02d2. Chrome verified hosted direct mode, origin copy, invalid target rejection, bridge help, and 375px layout; no live device request was attempted.

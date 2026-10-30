# 咖啡烘焙工作台

A compact, browser-local coffee roasting console built with Vue 3, TypeScript and Pinia. The v2 layout follows the user-approved warm coffee-console concept, not a marketing landing page.

## What is implemented

- Compact header, phase strip, BT/ET/ΔBT/ΔET metrics, integrated temperature/RoR chart, event toolbar and tracking panel. Mobile has curve/tracking panels.
- Chinese event labels, optional expanded events, chronological time editing, undo, and a noise/gap-aware **candidate** turning point requiring manual confirmation.
- Deterministic playback and manual-event recording, separate from a genuine **offline closed-loop simulation**. Bounded PID output drives an independent toy thermal model.
- Explicit simulation start/pause/stop/manual takeover; terminal states, missing feedback, invalid time and reference replacement zero the simulated output. No timer or I/O exists in the control core.
- Existing IndexedDB `roast-studio-library` retained. Read v1 without writes; explicit save upgrades to v2 without losing original samples, ID, notes or legacy events.
- Local library save/open/rename/delete; whole-library JSON backup; strict per-curve JSON and numeric CSV import preview/export.
- Original interactive flavor wheel: 8 families / 32 descriptors, with keyboard and touch controls. Tags follow the curve through explicit library saves, JSON backups and the workbench extension in `.alog`; native Artisan cupping fields remain intact.
- Import inspection before opening a draft: original units, separate BT/ET valid counts, charge/first crack/drop, and explicitly named heat/air events. Cancelling leaves the current draft unchanged.
- Optional short-gap Bézier estimates in import previews and the main chart. Dashed estimates preserve raw samples, valid counts, exports and control inputs; long gaps and missing endpoints remain unfilled. See [verification and display policy](docs/verification-flavor-import.md).

**Real actuator control remains disabled.** The HTTPS website, localhost HTTP development page, and private IPv4 HTTP page can read device status directly over the local network in supported browsers, after their exact origin is configured on the device. Public HTTP websites remain unavailable. A local bridge remains an optional compatibility path. Physical sensors/outputs have not been qualified. Simulation outputs are not physical commands or tuning advice. No server database or cloud hardware scheduler is used.

## Develop and verify

Use Node 22.13+ on the 22.x line, or Node 24+, and the pinned package versions. Formatting and lint tools are development dependencies; the browser application has no new runtime dependencies.

```sh
npm ci
npm run format:check
npm run lint
npm test
npm run typecheck
npm run build
```

`npm run format` applies `.prettierrc`: two spaces, double quotes, semicolons, a 100-column target and LF line endings. `npm run lint:fix` applies ESLint's available fixes. Run `npm run check` for formatting, zero-warning lint, type checking/build and tests together. The native compiler requirement below also applies to this combined check.

ESLint uses the [flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files) with JavaScript, TypeScript and [Vue recommended rules](https://eslint.vuejs.org/user-guide/). Prettier owns formatting; `eslint-config-prettier` disables overlapping style rules. Browser modules and Node scripts receive separate globals, while tests may use both environments. No explicit `any` is permitted in the checked TypeScript files.

Formatting covers Vue, TypeScript, JavaScript, CSS, HTML, JSON and Markdown, including the standalone firmware portal JavaScript test. C++/Python firmware sources need their own tooling. Dependency/build/cache directories, device credentials, lockfiles and original third-party/protocol fixtures are excluded. `.gitattributes` preserves LF for formatted sources across Windows and Unix checkouts while keeping fixture bytes untouched.

The native HTTP oracle in `npm test` uses a C++17-capable `g++`, or the executable named by `CXX`. On Windows, use `CXX` to select a modern compiler if an older toolchain occurs first in PATH. A missing compiler is reported as a skipped oracle, not firmware verification. The firmware's full native suite also accepts `CXX`.

`dist/` is static deployment output. Deploy it to a static host of your choice and configure its exact origin on the device. Node is a development/build requirement; users of a hosted direct-connection page do not run Node.

## Documentation

- [Approved v2 design](docs/console-v2-design.md)
- [Implementation plan and ledger](docs/superpowers/plans/2026-10-28-console-v2.md)
- [Supplementary JSON/CSV backup formats](docs/data-formats.md)
- [Original pre-firmware hardware boundary (historical)](docs/hardware-interface.md)
- [Verification record and honest browser coverage](docs/verification.md)
- [Wi-Fi provisioning and direct browser connection](docs/local-connection.md)
- [Direct browser BLE connection and compatibility](docs/bluetooth-connection.md)
- [Development-board configuration and pin evidence](firmware/docs/hardware/user-board-2026-10-29/README.md)

Implementation and validation notes are retained under `docs/`. The public repository starts with a sanitized source snapshot. This repository does not claim recovery of code predating that reconstruction. Browser storage is not a backup; export important curves before clearing site data or changing devices.

## Native Artisan and local LAN connection (this phase)

- Import and export real Artisan `.alog` Python-literal files; bounded parsing never evaluates code. Native source text/unknown metadata remain an optional inert attachment. Unchanged native exports preserve the original document; edited/new exports disclose third-party provenance and never forge an official signature.
- BT trend is a separate visual-only, up-to-60-second regression projection; target/reference is still independent. Display gap detection follows observed cadence without relaxing firmware upload rules.
- Header **连接 ESP32** supports direct Wi-Fi access on the HTTPS Site and local HTTP pages. First provision the ESP hotspot with router credentials, DHCP/static IPv4 and the exact allowed website origin; then put the browser and ESP on the same router and explicitly connect to the device IP. Local HTTP origins require the updated 2026-10-30 firmware. Only read-only telemetry is supported; there is no ARM/START, upload, heartbeat, physical control, token collection or arbitrary proxy.
- The same panel also offers direct BLE in supported browsers on HTTPS or localhost. It uses the same v1 status schema without a router, device IP or Node helper. A firmware with the BLE service is required; Artisan remains on Wi-Fi. See the Bluetooth guide for browser and real-hardware verification limits.
- Firmware stores tested network settings only after explicit save. BOOT (GPIO0) held for 5 seconds and then released restores provisioning; RESET preserves settings. WS2812 (GPIO48) indicates network state. [Firmware setup](firmware/docs/provisioning.md) includes the local USB `SETUP` query for a development board's individual hotspot password.
- If browser/platform policy prevents direct LAN access, explicitly select the compatibility bridge, run `npm run bridge`, and open its printed `http://127.0.0.1:8787` page. This is optional; the hosted page never silently probes localhost.
- Existing v1/v2 records use the same database and store. Reads never rewrite them. Explicit save retains native attachments; quota/transaction failures leave the old stored record intact. Different origins (hosted Site and localhost) have separate browser libraries: use an explicit export/import to transfer curves.

See [native files](docs/artisan-files.md), [local connection](docs/local-connection.md), and the [provisioning design](docs/superpowers/specs/2026-10-29-device-provisioning-design.md). The earlier firmware freeze applied to the previous phase; this phase changes firmware under the user's explicit request while preserving the v1 status schema. See [firmware protocol](firmware/docs/protocol.md) and [Artisan setup](firmware/docs/artisan.md). Neither firmware mode has physical actuator bindings. Automated checks and Windows Chrome coverage are recorded separately from actual-board and Artisan desktop GUI verification.

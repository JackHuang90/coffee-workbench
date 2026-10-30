# Artisan Web Interoperability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Native `.alog` interchange, restored visual trend and a real safe read-only LAN connection path.
**Architecture:** Separate native serialization, forecast math, and local bridge boundaries; one UI owner integrates them into the retained Vue console.
**Tech Stack:** Vue 3, TypeScript, Pinia, Node built-ins, Vitest, existing IndexedDB.
**Spec:** `docs/superpowers/specs/2026-10-28-artisan-web-design.md`

## Global Constraints

- No firmware or artifact edits; no actual hardware traffic.
- No eval/Function; all native imported metadata and control strings remain inert.
- No credentials in hosted Site/browser storage/disk/logs; no network broadening.
- Old v1/v2 records stay intact until explicit save, native attachment is optional and bounded.
- Keep UI framework, compact layout and bean art.

## Review Focus

- Unknown nested native fields and tuples survive roundtrip; edits do not rewrite unrelated values.
- C/F, negative time, zero CHARGE and missing values project without altering raw samples.
- Lower-rate native profiles render continuously without weakening firmware upload interval rules.
- Disconnect, timeout or device reset cannot manufacture fresh data or resume control.
- Keyboard dialog behavior, unsaved drafts and reference changes remain safe.

### Task 1: Native Artisan boundary

Files: `src/core/alog.ts`, `src/core/pythonLiteral.ts`, `tests/alog.test.ts`, `tests/fixtures/artisan/*`, native attachment type and validation.

- [x] Write/observe failing parser and roundtrip tests from official + sanitized fixtures.
- [x] Implement bounded grammar and isolated raw attachment with editable projection.
- [x] Validate unchanged/full semantic roundtrip, edited signature/provenance and marker association limits.

### Task 2: Local same-origin connection boundary

Files: `tools/local-bridge.mjs`, `src/core/device.ts`, `tests/bridge.test.ts`, `tests/device.test.ts`, `docs/local-connection.md`.

- [x] Write/observe failing socket and client tests.
- [x] Implement loopback-only built UI server, exact origin/CSRF guard and fixed private IPv4 status mapping.
- [x] Test no Origin upstream, strict schema/nulls/owners, no mutations or heartbeat, cancel/timeout/reset.

### Task 3: Cadence and forecast

Files: `src/core/trend.ts`, `src/components/RoastChart.vue`, `src/core/simulation.ts`, `src/core/events.ts`, `tests/trend.test.ts`.

- [x] Write/observe failing continuous-window, missing/gap and 5-second fixture tests.
- [x] Add cadence-aware display policy and distinct switch/legend/bounded forward projection.
- [x] Confirm no future samples and no feedback/controller behavior change.

### Task 4: UI, persistence and verification

Files: `src/App.vue`, `src/components/LibraryPanel.vue`, `src/components/ConnectionPanel.vue`, `src/data/library.ts`, tests and README.

- [x] Test primary alog preview/export, native attachment preservation and v1/v2 reads/quota failures.
- [x] Integrate connection dialog with hosted/local distinction and local-only secret entry.
- [x] Add focused accessibility/dirty-close/reference tests, run full tests/typecheck/build.
- [x] Obtain independent review, fix observed defects, provide parent source checkpoint and browser QA instructions.

## Execution ledger / review rulings

- Baseline firmware frozen at `22a1692`; implementation branch `feature/artisan-web-bridge`. Design checkpoint `db1b107`; first integrated source checkpoint `774c89a`.
- Tasks 1–4 implemented in separately owned files with failing regression tests observed before their fixes. No firmware or generated firmware artifact changed.
- Ruling: read-only bridge, no device credential field or control API — frozen status GET needs no bearer and connection must not acquire/renew ownership. Device telemetry remains independent from local simulation.
- Ruling: native projection preserves all samples by subtracting first raw time; chart clocks subtract projected CHARGE for explicit charge-relative labels. Raw attachment is never rewritten during viewing. Native timestamp/count edits reject instead of guessing event/extra associations.
- Ruling: JSON backup cap raised to 8 MiB to accommodate escaped ≤2 MiB native text plus editable projection; native/parser resource caps remain unchanged.
- Independent review fixes: non-ASCII CSRF crash, edited-source writer/integrity provenance, expanded JSON restoration, and cancellation of queued reconnect after later disconnect/background intent. Each has focused regression coverage.
- Parent browser QA attempted through supported Sites preview; CDP timeout prevents new visual approval. No browser-policy workaround. Fresh full validation and final reviewer result are recorded in verification-artisan-web.md and the final handoff.

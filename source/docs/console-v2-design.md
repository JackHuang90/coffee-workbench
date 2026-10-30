# 咖啡烘焙工作台 v2 — approved design

## Purpose and boundaries

A compact, desktop-first observation and simulation console inspired by the approved image `../roast-v2-design/coffee-console-concept-zh.png`. Preserve Vue 3 / TypeScript / Pinia and the existing Site and IndexedDB `roast-studio-library`. No backend, device connection, firmware, or real actuator commands.

## Layout

A 48 px single-line header with Chinese name, source/device badges and library/settings actions; 34 px phase strip; a metric band; a main chart occupying approximately 74% width with a compact tracking side panel; event toolbar and concise footer. At 1440×900 and 1366×768 the core workflow fits the first viewport. Advanced editing, library and settings are accessible dialogs. Mobile uses chart/tracking tabs and wraps the event toolbar at touch-friendly sizes.

## Semantics

Chinese event names: 入豆 / 回温点 / 脱水结束 / 一爆开始 / 一爆结束 / 二爆开始 / 二爆结束 / 出豆 / 冷却结束. Expanded events are optional but cannot contradict chronological order. Events store timestamp, available BT and source; interpolated data is explicitly marked. Candidate TP requires sustained recovery and is never auto-confirmed. DRY and cracks are manual. Phase and DTR derive from confirmed events; invalid or absent boundaries are unavailable.

BT, ET, ΔBT/RoR, ΔET, time, phase duration/ratio, development time/DTR, target/error use finite valid contiguous data only. Never invent sensor readings, weight or auxiliary channels.

## Data compatibility and simulation

Read schema v1 without writing; on explicit save write v2, retaining id, notes, raw samples and events, with legacy provenance. Whole-library JSON backup available; no destructive database migration. Numeric CSV and strict JSON only, never eval; no unproven Artisan-import claim.

Closed-loop simulation is separate from playback: preflight target times/finite BT/coverage, align CHARGE or explicit first sample, linear interpolation through contiguous segments, toy thermal plant responds to bounded anti-windup PID output. States idle/ready/running/manual/completed/fault; pause/stop/manual takeover explicit. Stopped/faulted/ended outputs are zero. Missing data, long gaps and target end fail/finish safely. Changing target, importing/resetting or component teardown stops simulation. Clear 仿真 / 未连接 ESP32-S3 labeling, real tracking disabled. Future hardware interface is documentation only; local firmware must own scheduler, sensors, watchdog and outputs.

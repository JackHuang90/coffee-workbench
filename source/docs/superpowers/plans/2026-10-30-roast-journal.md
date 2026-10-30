# Roast Journal Workflow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** 串联持续暂存、记录卡、两锅比较、品饮与下一锅计划。
**Architecture:** Extend the optional portable journal contract, isolate draft storage from the existing library, use pure comparison helpers, then compose focused Vue panels around the existing chart and store.
**Tech Stack:** Vue 3, Pinia, TypeScript, IndexedDB, Vitest.
**Spec:** ../specs/2026-10-30-roast-journal.md

## Global Constraints

- No actuator commands or automatic resume; current device protocol supplies virtual demo only.
- Preserve raw samples and native Artisan attachment, old schemas and existing library.
- Chinese warm visual language; responsive and keyboard-accessible controls.

## Review Focus

- Refresh during first sample or pending write must preserve a recoverable draft.
- Missing CHARGE/FCs/DROP must not yield misleading completed metrics.
- Changes during async save must not mark newer edits as saved.
- Device stale/duplicate/reset samples must not create plausible continuous readings.
- Nested references and malformed new metadata must be bounded on import.

### Task 1: Portable journal and comparison

Files: src/core/types.ts, journal.ts, serialization.ts; tests/journal.test.ts.
Interfaces: summarizeRoast(curve), compareRoasts(current, reference), snapshotReference(curve), validateJournal(input).

- [x] Write and run tests for missing events, relative-time comparison and bounded metadata roundtrip (RED).
- [x] Implement optional metadata, tastings, plan, log and immutable reference snapshot; validate on JSON import/export.
- [x] Run targeted tests (GREEN).

### Task 2: Recording and recovery

Files: stores/roast.ts, data/drafts.ts, composables/useDrafts.ts; tests/recording-workflow.test.ts.
Interfaces: DraftRepository.save/list/remove; store restoreDraft/startDeviceRecording/appendDeviceSample/logAction.

- [x] Test isolated drafts, safe recovery and duplicate/stale/reset telemetry (RED).
- [x] Persist debounced changes and immediate recording/event boundaries; preserve snapshot reference and action journal.
- [x] Run targeted store/storage tests (GREEN).

### Task 3: Workflow interface and chart

Files: App.vue, components/WorkflowPanel.vue, RoastRecord.vue, RoastChart.vue, SessionPanel.vue, style.css.

- [x] Build mode navigation, record card with comparison/tasting/plan, draft recovery bar and accurate source labels.
- [x] Add aligned reference, pointer readout and one-crack zoom with click-to-locate metrics.
- [x] Verify UI flows in Vitest, then Chrome desktop and narrow viewport.

### Task 4: Final verification

- [x] Run formatting, lint, build and complete tests with bundled C++ compiler.
- [x] Request independent branch review, fix material findings with focused regression tests.
- [x] Save verification report and screenshots; deliver local preview and limitation on actual hardware.

## Execution record

Tasks 1–3: complete in 6cc3fde; targeted tests observed RED→GREEN.
Task 4: independent review completed; all three important findings fixed with focused RED→GREEN regressions. Final npm run check: 33 files / 529 tests passed, formatting/lint/build passed.
See ../../verification-roast-journal.md for browser evidence and hardware scope ruling.

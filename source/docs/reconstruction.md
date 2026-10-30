# Roast Studio web reconstruction

**Goal:** rebuild the approved browser experience and make it maintainable and privately deployable.

**Visual direction:** cream paper, warm coffee/terracotta and muted sage, generous type and spacing, botanical coffee-bean illustrations. Desktop and phone reference images were inspected before implementation. Their static controls are replaced only by real local journal actions; device controls remain absent.

**Architecture:** Vue 3 + TypeScript single-file components, Pinia session state, deterministic pure data functions, IndexedDB repository. Static Vite output; no runtime external service or font dependency.

## Implementation sequence

1. Establish pinned tooling, shared curve schema and documented boundary. Preserve the Site ID and save an early source checkpoint.
2. Test then implement core simulation/phase/RoR logic and strict JSON/CSV import, including invalid values, gaps, ordering and oversize data.
3. Test then implement IndexedDB CRUD and the session store. Keep explicit saves and unsaved warnings; do not silently replace a draft.
4. Build focused responsive components: header/journal, phase strip, charts, simulation controls, library and import preview. Local dialog actions remain keyboard-accessible.
5. Run focused tests, complete test suite, TypeScript and static production build. Report browser verification separately from automated DOM tests.

## Important limits

- The old implementation was unavailable. This is new source, not recovered code.
- Simulation and imported references cannot control hardware. No firmware, device transport, network address form or remote data store is included.
- CSV is a deliberately basic interchange format: time in seconds and temperatures in Celsius. JSON preserves journal metadata and events.
- All data stays in this browser and origin. Explicit exports are the portable backup.

# Native Artisan `.alog` interchange

The primary interchange format is Artisan's UTF-8 Python-literal dictionary, **not JSON renamed to `.alog`**. The app does not evaluate Python, JavaScript, expressions, imported programs or event controls. JSON remains a console backup format; numeric CSV remains a deliberately reduced exchange format.

## Source preservation and editable view

A native attachment keeps the original text, source filename and explicit display origin. It is stored as optional data alongside the existing v1/v2 curve schema; no separate database migration rewrites old curves. Unedited `.alog` export returns the original bytes (except allowed leading ASCII whitespace is normalized to a valid native dictionary when necessary; BOM and non-Python whitespace are rejected). Numeric lexemes, tuples, unknown nested metadata, source C/F arrays, missing `-1`, extras and negative/fractional raw `timex` are not normalized away.

The console's editable view is Celsius. Its stored projection uses `display time = original timex − first timex`; all pre-charge samples are retained. CHARGE remains its own sample-associated marker, so charge-relative chart labels use `display time − CHARGE display time`. Firmware target conversion is a **separate operation**, never an `.alog` save operation.

- `temp1` = ET; `temp2` = BT. Missing `-1` is recognized before any Fahrenheit conversion.
- `timeindex` has eight slots: CHARGE, DRY, FCs, FCe, SCs, SCe, DROP, COOL. CHARGE index `0` is valid and `−1` means missing. For every other slot, `0` means missing.
- `computed.TP_idx` is derived metadata, not an imported manual event. A manually added TP may export there with an explicit warning; Artisan may recompute it.
- Edited events must associate with a sample within **0.5 seconds**. The export reports every nonzero rounding error and refuses larger errors, or non-CHARGE markers at the unrepresentable index zero. It never truncates time silently.
- Extra channels and all custom/control-event arrays remain inert native data. Category zero is not assumed to be heater or fan; internal Artisan event values are not assumed to be direct percentages.
- Display strings receive exactly one additional Artisan `unicode_escape` layer only for known title/notes fields. Arbitrary unknown strings are not decoded or executed.

The working title/notes fields have existing 120/4000 character limits. Import preview warns when a native field is longer; unedited native export preserves the full original. Changed supported fields replace only their corresponding native fields. Sample count or timestamp changes with a native attachment are refused to avoid corrupting extra-channel or event indices. A temperature that collides with Artisan's `-1` missing sentinel cannot be silently exported as valid temperature.

## Provenance and signatures

Unedited imported metadata is preserved without claiming its signature was verified. Edited exports remove stale `signature` and `hash`, retain truthful original `version/revision/build/artisan_os` and `recording_*` provenance, copy source-writer fields into a labelled source-provenance object, and append visible “modified by” third-party provenance in `roastingnotes`. Retained Artisan version fields describe the source only, not this app. In particular, a source version ≥4.2 remains present so ordinary official-build signature warnings are not silently suppressed. New exports do not invent official Artisan versions/builds/signatures. An inert `coffee_console` generator extension includes the actual application release (`0.1.0`), third-party status and source kind; a fresh suffixed key is used if that name already exists, so imported extensions are never overwritten. Normal Artisan version/signature warnings must not be bypassed. Preserved `computed` statistics may become stale after edits and are explicitly disclosed.

## Parser limits and unsupported constructs

The parser accepts dictionaries with unique string keys, lists, tuples, finite signed decimal/exponent numbers, quoted strings (including legacy `u` prefix and supported Python escapes), `True`, `False`, `None`. It preserves numeric lexemes rather than rounding unknown large metadata integers through JavaScript numbers. Unsupported bytes, sets, complex numbers, executable expressions, calls, comprehensions, attributes, duplicate keys and prototype-related keys are rejected. Limits: 2 MiB UTF-8 source, 64 levels, 200,000 value nodes, 50,000 items per list/tuple, 4,096 keys per dictionary, 256 Ki characters per string. Core sample arrays must be aligned, strictly increasing, 2–15,000 points and span at most 24 hours. Unsafe core values are rejected rather than coerced/truncated.

## Evidence and boundaries

Tests use four official `.alog` fixtures and their JSON _test oracles_ pinned to Artisan v4.2.0 commit `9334ed75f42a73526bd6da8905164706f06d34fa`, plus a privacy-sanitized derivative of the supplied 3.0.2 sample (168 fields / 794 points). The private original is not included. `tests/fixtures/artisan/PROVENANCE.json` retains upstream attribution and blob identities. These fixtures are from the upstream GPL-3.0 repository; no Artisan implementation source was copied into the app.

Parser/export tests and Python `ast.literal_eval` oracle comparisons verify format/semantic handling. They do **not** establish actual Artisan GUI import/re-save, device replay, board operation or physical safety. Load exported files in Artisan with devices disconnected and event replay disabled before relying on a new third-party profile.

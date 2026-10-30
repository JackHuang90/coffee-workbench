# Artisan web interoperability verification

## Implemented boundary

Vue 3 / TypeScript / Pinia and the compact console/bean artwork are retained. Native `.alog` is primary interchange; JSON/CSV remain supplementary. A distinct visual-only BT forecast is restored. The actual LAN path is a user-run same-origin Node bridge, loopback-only, fixed private IPv4:80, and **read-only**. Hosted pages never send localhost/LAN requests or collect credentials. Neither the bridge nor the client sends firmware commands or heartbeat.

Firmware source/artifacts remain frozen at `22a1692283096d159cbc8dc640ddec826be78c91`. Native test harnesses compile unchanged firmware HTTP/parser/controller code only into a temporary directory; they do not replace or rebuild the distributed ESP32 binaries.

## Evidence

- Native parser/export tests cover four pinned official `.alog`+JSON oracle pairs and the sanitized 168-field/794-point user derivative: raw semantic preservation, C/F, missing -1, negative/fractional time, CHARGE index0, eight-slot event mapping, extra/nonscalar unknown fields, tuple/numeric lexemes, bounded grammar and malicious constructs.
- Python `ast.literal_eval` independently checks unchanged and edited native exports. The user's private real file was also run through the actual importer/exporter outside the repository: 168 fields/794 points, unchanged bytes and equal Python values. The private file is not a source fixture or a deployed asset.
- Existing IndexedDB v1/v2 reads are nonmutating; explicit saves preserve optional native attachments. Quota/transaction failures preserve the prior record. Expanded native JSON backups have an independent 8 MiB import/export limit; the native source stays limited to 2 MiB.
- Cadence-aware gaps, 30-second regression with at least 20 seconds / 6–10 samples, max 60-second visual horizon, missing/latest stale/frozen data, no future samples and separate target/prediction UI are tested. Firmware/control target limits are not relaxed.
- Actual Node localhost sockets verify Host/Origin/CSRF, RFC1918-only canonical addresses, no redirects/arbitrary path, timeout/reset/stale/null/owner handling, exact no-Origin firmware requests, no token/command surface and cancellation. A native C++ oracle uses frozen `HttpRequest`/`respond`/Controller for LOCKED, DEMO and USB-authorized Artisan-owner statuses.
- Mounted Vue tests verify native preview, primary export, unsaved replacement cancellation, unchanged draft on connection opening, hosted no-fetch/no-credential behavior, keyboard dismissal/focus return and prior reference-change protections.

## Review fixes

Independent review found and regression-tested: malformed non-ASCII CSRF headers could crash the local Node process; edited imports needed to retain truthful source writer metadata while removing both signature/hash; native text JSON-escaping could exceed the old backup import limit; and a waiting reconnect needed cancellation when a later disconnect/background intent arrived. Native cross-review also tightened Python whitespace and refused timestamp edits that could invalidate native event/extra-channel associations. Generated `.alog` output is revalidated against the same resource caps before download.

## Browser and physical verification limits

The parent started the supported Sites preview. CUA/CDP access to the existing preview tab timed out and reset its kernel, so **this phase has no new actual-browser visual approval**. No Chromium restart, policy bypass or alternative browser-control path was used. Mounted DOM tests are not a substitute for pixel/viewport QA.

No actual ESP32 Wi-Fi/USB hardware, actual Artisan desktop GUI import/re-save/normal warning dialogs, Windows runtime, sensor calibration or physical-roaster safety has been verified. Both frozen firmware images have no physical actuator binding. Native parser/schema/socket evidence does not establish those untested claims. The source+Git archive and private source sample are delivered separately by the parent.

## Reproduction

```sh
npm ci
npm test
npm run typecheck
npm run build
git diff --check
git diff --name-only 22a1692283096d159cbc8dc640ddec826be78c91 -- firmware
```

Use Node 22.12+. Native C++ oracle tests run when g++ is present and explicitly skip otherwise; g++ was present in this execution. No new production dependency was needed.

## Final source checks (2026-10-28)

Fresh full run: **301 tests / 17 files passed**, TypeScript check passed, Vite production build passed, `git diff --check` clean. Frozen firmware path diff is empty. A built-UI localhost smoke check returned index plus both emitted JS/CSS assets with the intended self-only connection CSP.

Independent whole-feature reviewer approved the final implementation and fix wave with no outstanding Critical/Important findings. Its affected-suite rerun passed 156 tests, followed by 11 final cancellation tests; source and mock coverage is not browser/physical verification. Official fixture source/license notices and the complete GPL-3.0 license text accompany the test inputs. No private original sample is tracked or deployed.

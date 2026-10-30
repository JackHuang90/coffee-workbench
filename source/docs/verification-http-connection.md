> 公开版本说明：本页历史部署域名和平台标识已脱敏；示例域名不代表可访问站点。

# HTTP local connection verification — 2026-10-30

The former HTTPS-only application gate now accepts exact `localhost`, canonical IPv4 loopback addresses and RFC1918 IPv4 addresses over HTTP. Public HTTP origins remain rejected. HTTPS origins remain supported. The web client and firmware use the same eligible-origin policy; the firmware still requires each origin to be configured explicitly, including non-default ports.

## Verification

- Web workspace: 23 files / 426 tests passed. This workspace also contains concurrent flavor/import work; those unrelated changes are excluded from this Site update.
- Publication checkout: 19 files / 415 tests passed against the existing published application plus this correction.
- Firmware: 11 native suites in each of two configurations (22 executions), embedded setup-page JavaScript, and 22 Python tests passed. All three pinned SDK builds and stack audits passed; maximum application per-function stack was 1632 bytes against the 2048-byte limit. Details are in `firmware/docs/validation.md`.
- Release collection verified source/build provenance and produced updated non-actuating reference images. All 30 SHA256SUMS entries matched before the 2026-10-30 ZIP was created.
- Chrome at `http://localhost:5173/` shows the direct connection form, reports it ready, and displays the exact HTTP origin for configuration. No device request was submitted. Screenshot: `.sites-runtime/qa/http-localhost-2026-10-30.jpg`.
- Independent review found an HTTPS-host validation mismatch; regression cases were added and the shared web helper was corrected. Final scoped review found no remaining substantive issue.

## Use and limits

Install the updated firmware, add `http://localhost:5173` (or the exact LAN webpage origin) to the setup page's allowed websites, test and save. Existing saved HTTPS origins remain valid. Merely updating the webpage does not authorize a new origin on an older firmware image.

No physical ESP32 was flashed, erased or contacted during this correction. Actual connection still depends on the configured source, reachable device, same network and browser permissions. Mobile hardware and browsers were not exercised.

## Publication

Published the owner-private Site successfully at https://coffee-workbench.example on 2026-10-30 (Asia/Shanghai). Source commit: `83dd095d3b3f585a6a6619f426314c4e328e6589`; deployment: `[deployment-id-redacted]`. The official publication workflow completed `vue-tsc --noEmit` and the Vite production build, pushed that exact source state and packaged its output. Chrome verified that the published HTTPS connection dialog still opens and shows the exact published website origin. Publication did not include concurrent flavor/import work. The local completion record and plan checklist were updated after publication.

Updated reference firmware archive: `firmware/coffee-workbench-esp32s3-2026-10-30.zip`.

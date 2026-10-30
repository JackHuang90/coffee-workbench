# Verification evidence and limits

This firmware is a new implementation. No old native core or lost test suite was
restored. The tests in this directory were written for this rebuild.

## 2026-10-30 explicit local HTTP origins

- Observed RED before production changes: `test_local_origins` failed the first
  localhost HTTP normalization assertion. The same suite then passed unchanged.
- `tools/test_native.py` passed all 22 C++ executions (11 suites in each
  LOCKED/DEMO mode), the actual embedded setup-page script behavior test, and
  all 22 Python cases, including converter and real loopback Modbus checks.
- New behavior coverage includes HTTP localhost / 127/8 / RFC1918 range boundaries,
  case and default-port normalization, rejection of public HTTP and ambiguous
  numeric IP forms, form-to-record byte roundtrip, failed-form preservation,
  exact configured GET/OPTIONS, port mismatch, no implicit LAN permission, and
  continued denial of cross-origin commands and setup writes.
- All pinned SDK incremental targets passed: `s3_locked`, `s3_virtual_demo`,
  and RGB-disabled `s3_network_compilecheck`. Each application object audit
  reported a maximum frame of 1632 bytes against the 2048-byte limit.
- No artifact collection, publication, commit or device flashing was performed
  by this firmware change. Physical-board and actual-browser LAN access remain
  separate acceptance work; this run did not use ASAN/UBSAN.

## 2026-10-29 provisioning verification

- Windows GCC 16.2.0: `tools/test_native.py` passed all 20 C++ executions
  (10 suites in each LOCKED/DEMO mode), the embedded setup-page JavaScript
  behavior test, and all 22 Python tests including actual loopback sockets.
- New tests cover address/origin validation, corrupt/torn double-slot recovery,
  candidate failure and save failure, backoff, button bounce/hold/release/startup
  and clock wrap, AP subnet selection, status CORS/preflight and command denial,
  AP-only form authorization, malformed/duplicate/oversized forms, transactional
  candidate parsing, bounded DNS packets, and candidate revision isolation.
- The actual embedded page script runs with deferred HTTP responses in a small
  DOM boundary fixture: edit-during-test, replacement from another tab, and new
  hotspot session with reused revision all keep Save disabled until a fresh test.
- Red assertions were observed for old-origin rejection, stale edited-form save,
  stale candidate revision, reused revision after session change, AP subnet
  collision, transactional form replacement and missing DNS response behavior.
- Pinned Arduino 3.3.12 / PlatformIO Espressif32 8.0.0 builds passed for
  `s3_locked`, `s3_virtual_demo`, and RGB-disabled `s3_network_compilecheck`.
- Object audit found a 6800-byte aggregate temporary in the new portal reset;
  in-place reset removed it. All three targets then reported a maximum
  application frame of 1632 bytes, below the existing 2048-byte limit.
- SDK source inspection identified implicit waits in legacy Wi-Fi disconnect/
  begin and RGB helpers. The adapter uses asynchronous disconnect plus polled
  readiness, zeroed DHCP configuration, IDF connection enqueue, bounded UDP DNS,
  and stable-buffer asynchronous RMT output. No delay loop waits for networking.
- This Windows run did not run ASAN/UBSAN. No actual board or mobile-browser
  test is represented by these results. RF/NVS failure timing, full task stack,
  hotspot handoff and physical LED colors still require bench acceptance.

## Reproducible checks

- `tools/test_native.sh` or cross-platform `tools/test_native.py`: LOCKED and VIRTUAL_DEMO C++17 suites for core state/PID,
  line protocol, HTTP parser, HTTP→controller integration, reply-drain/generation
  boundary, Artisan ownership, and RTU/Modbus; Python converter/build-tool/socket
  integration suites. Tests compile the production portable C++ source.
- `ASAN_OPTIONS=detect_leaks=0 SANITIZE=1 tools/test_native.sh`: C++ suites with
  AddressSanitizer/UndefinedBehaviorSanitizer. LeakSanitizer alone is incompatible
  with this container's ptrace environment; memory bounds and UB checks stay on.
- RTU/Modbus tests exercise 20000 malformed byte streams and 20000 malformed TCP
  packets per mode, with reply-buffer guards, CRC/size/range checks, truncation,
  duplicate STOP, timeout and uint32 clock wrap.
- Curve converter tests regenerate a real exported web fixture, validate v1/v2,
  origin, finite values, millisecond/deci-C units, gaps, count/duration/hash, and
  pass the result through the same C++ core's upload→start→feedback→manual→stop.
- Native actual loopback socket tests connect to `127.0.0.1` on ephemeral ports,
  not hardware or external LAN. They exercise Modbus reads, local USB authorization
  (through the real protocol), virtual power/fan/SV writes, mode/owner/range errors,
  packet framing and a real elapsed 5-second lease timeout despite FC03 reads.
- Existing web regression commands remain `npm run test` and `npm run build`.
  Web direct-LAN changes are verified separately by the parent task.

## Actual SDK evidence

`tools/build_release.py` clean-builds locked, demo and RGB-disabled provisioning
compile-check environments, collects only the two release environments, verifies
Espressif images offline and merges the SDK-provided flash offsets. It refuses
stale source/build-input mismatches. Inspect the output `artifacts/manifest.json`,
`SHA256SUMS`, package metadata, clean build logs, per-image ELF, image-info logs,
flash maps and source/build-input hashes rather than inferring success from this
document. Current builds enable first-use protected hotspot provisioning; old
release artifacts are not evidence for the current source.

The application object stack audit rejects a single Xtensa function frame over
2048 bytes. Independent review found an early `Curve{}` temporary produced an
8304-byte `BEGIN` stack frame, larger than Arduino's 8192-byte loop stack; the
in-place staging reset removed it, and the regression guard now inspects actual
object code. This is not a measured on-board stack high-water or total-call-chain
proof. Review also caught and corrected manual-reentry, fault-reset, source/owner
attribution and same-mode regrant/queued-packet boundaries; their regressions are
retained rather than relying on compilation alone.

## Not established

No board was attached, flashed, monitored or commanded. No Arduino sketch was
uploaded; no eFuses/secure boot/flash encryption changed. Actual USB enumeration,
Wi-Fi radio/IP behavior, Artisan desktop configuration, RTU electrical timing,
physical sensors/actuators and hardware safety remain unverified. Official Artisan
settings/command syntax were researched, but a working continuous GUI heartbeat
setup was not verified. Virtual short-session controls are not a claim of complete
unattended Artisan roasting. Both images lack physical output bindings, and no
runtime command can turn them into a physical controller.

## Web BLE verification — 2026-10-30

- All 13 native C++ suites passed in both LOCKED and VIRTUAL_DEMO modes (26 executions), together with the setup-page JavaScript checks and all 22 Python tests. The compiler and PATH both used the bundled modern w64devkit toolchain.
- `test_ble.cpp` exercises the production framing/scheduler with MTU23/247/517, byte order, 1..1023-byte messages, invalid limits, stable snapshots, 5 ms pacing, asynchronous receipt clock skew, sequence/millis rollover, session boundaries, stale queue rejection and unrenewed Artisan leases.
- `test_ble_adapter.cpp` runs the actual ESP adapter against explicit SDK/RTOS boundary doubles: startup/NPL initialization ordering, no notification before subscription, single-client rejection, callback-to-main queue flow, ENOMEM/mbuf allocation failure without offset advancement, subscription changes while a packet is queued, queue timeout, reconnect and MTU changes. This is a boundary simulation, not execution of NimBLE or an RF test. It reproduced the startup null-dispatch defect before its fix.
- Final SDK builds passed for `s3_locked`, `s3_virtual_demo` and `s3_network_compilecheck`; recorded source-input hashes match the final sources. Each application object stack audit passed with maximum frame 1632 bytes against the 2048-byte limit. BLE main-loop tick uses 336 bytes, initialization 128 and the host send callback 96; these are individual compiled function frames, not total task-stack measurements.
- Flash use is 1,334,263 / 1,341,431 / 1,339,971 bytes respectively, within the 3,145,728-byte app partition. Each build reports 93,920 bytes of static RAM use. Dynamic Wi-Fi/BLE heap and concurrent task stack use still require hardware measurement.

Evidence is retained under `.tools/ble-native-final.log`, `.tools/ble-<environment>-build.log`, `.tools/ble-<environment>-stack.json` and `.tools/ble-final-provenance.json`; the first failing regressions are also retained. Parent integration exercises `ble_runner.cpp` output with the browser production assembler and status schema. No board was flashed or connected, and BLE radio, SoftAP coexistence, mobile browsers and physical roasting remain unverified.

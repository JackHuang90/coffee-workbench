# Build, artifact verification, and conditional flash reference

## What these images are

This is a **new rebuild**, not recovered firmware. `s3_locked` is permanently
LOCKED: no temperature source, no physical output, no transport unlock.
`s3_virtual_demo` runs a clearly labelled virtual thermal plant and local curve
controller. **Both images have no physical heater/fan/DAC/SSR/RS485 binding.**
Software tests and compilation do not qualify mains wiring or a roasting machine.

The configuration is an ESP32-S3-DevKitC-1 **reference** with overrides for 16 MB
quad-I/O flash and 8 MB octal PSRAM (`qio_opi`). User-supplied board documentation identifies BOOT GPIO0 and a GPIO48 WS2812
RGB LED; color order and memory still need a physical check (the photos mix
N8R2 and N16R8 module examples). N16R8 describes memory, not USB wiring, carrier pins, power,
flash voltage, sensor wiring, or a safe output circuit. Confirm the actual
board/module and carrier documentation before flashing; preserve any existing
firmware/calibration first. No physical board, Artisan application, or flash
operation was used during this release.

## Reproduce (Linux/macOS shell)

From `firmware/`, use project-local tools and temporary storage. Install only
published official packages with normal checksum verification enabled:

```sh
mkdir -p .tools/tmp .tools/cache/pip .tools/pio
python3 -m venv .tools/venv
TMPDIR="$PWD/.tools/tmp" PIP_CACHE_DIR="$PWD/.tools/cache/pip" \
  .tools/venv/bin/python -m pip install platformio==6.2.0
TMPDIR="$PWD/.tools/tmp" PLATFORMIO_CORE_DIR="$PWD/.tools/pio" \
  .tools/venv/bin/pio run -e s3_locked -e s3_virtual_demo -e s3_network_compilecheck
.tools/venv/bin/python tools/build_release.py
```

`platformio.ini` pins official PlatformIO Espressif32 8.0.0 and resolved packages.
The release script clean-builds all three targets before collecting images.
The artifact manifest records exact framework, GCC, flags, source hashes and
Git commit/dirty state; no claim of bit-for-bit reproducibility across different
hosts or compiler timestamps is made. `s3_network_compilecheck` compiles provisioning with RGB disabled. All three
current targets start a protected setup hotspot when no valid configuration is saved.
It is not distributed as a release binary. Release collection refuses an existing
`include/local_config.h` so credentials cannot leak into delivered images.

Official sources used for configuration:
[PlatformIO Espressif32 releases](https://github.com/platformio/platform-espressif32/releases),
[ESP32-S3 DevKitC-1 hardware reference](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/hw-reference/esp32s3/user-guide-devkitc-1.html),
[Espressif esptool basic commands](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html).

## Inspect offline before any device operation

```sh
cd artifacts
sha256sum -c SHA256SUMS
```

Each release subdirectory contains `application.bin`, `application.elf`,
`bootloader.bin`, `partitions.bin`, any additional boot image required by the
framework, `reference-merged.bin`, `flash-map.json`, evaluated
`build_metadata.json`, and offline `image-info`/merge logs. The top-level manifest
has per-file sizes/SHA256 and a source-snapshot digest. `application.bin` is **not**
a whole-chip image and must never be written at offset zero. Actual offsets are
derived from the SDK build, not guessed from another ESP32 family.

## Conditional reference flash instructions — not executed

**Do not flash until the exact board/memory/USB configuration is confirmed.**
Disconnect all actuator wiring and high-voltage power for a software-only bench
check. A software image cannot make an unqualified electrical assembly safe.
Choose exactly one directory, `s3_locked` (recommended first) OR
`s3_virtual_demo` (virtual data only); never mix binaries between them.

The generated `flash-map.json` is authoritative. For the evaluated reference
configuration it is expected to be bootloader `0x0`, partition table `0x8000`,
boot-app initialization `0xe000`, application `0x10000`. Inspect the released map
and logs: use only the values actually recorded there. The framework uses a DIO
boot image header for this QIO application configuration; retain its evaluated
`image_flash_mode=dio` instead of overriding the image header to QIO.

Using the SDK's esptool and an explicitly selected device port, after confirming
those offsets, the multi-image reference command is:

```sh
# From firmware/, replace YOUR_CONFIRMED_PORT. No command was executed for you.
.tools/pio/packages/tool-esptool/esptool \
  --chip esp32s3 --port YOUR_CONFIRMED_PORT --baud 460800 \
  write-flash --flash-mode dio --flash-freq 80m --flash-size 16MB \
  0x0 artifacts/s3_locked/bootloader.bin \
  0x8000 artifacts/s3_locked/partitions.bin \
  0xe000 artifacts/s3_locked/boot_app0.bin \
  0x10000 artifacts/s3_locked/application.bin
```

Alternatively, the **offline-generated** `reference-merged.bin` is a reference
image beginning at offset `0x0`; verify its hash and merge log before use. The
multi-image command is preferred because its component offsets are explicit.
The merged image contains 0xFF padding between components: writing it may
overwrite NVS or other data in those padded regions even without a whole-chip
erase command. Treat it as an offline convenience artifact, not the default
flashing path; preserve data from the confirmed board first.
No instructions to erase the entire flash, alter eFuses, disable secure boot,
change flash encryption, or bypass device protections are included. Existing
secure-boot/encrypted devices need their owner's qualified signing/provisioning
workflow; these unsigned reference images are not suitable for them.

## USB and Wi-Fi provisioning

USB uses ESP32-S3 native USB CDC. `HELLO` / `STATUS` expose the unchanged v1
contract. `NETWORK` reports current connection and address without credentials.
The explicit local-only `SETUP` command reports the device hotspot name/password,
its active flag and actual setup URL; use this once on a development board to
prepare its Wi-Fi label/QR. No router password is printed.

All current targets enable provisioning by default. First boot opens a per-device
WPA2 hotspot; configure Wi-Fi, optional static IPv4, and allowed website
origins (HTTPS, or explicitly listed localhost/loopback/private-IPv4 HTTP) in its embedded page. Test first, then save. There is no credential
compile step or automatic import of old `ROAST_WIFI_SSID` definitions. Network
records live in `coffee-net`, identity in `coffee-id`; recovery does not erase
all NVS. See [the complete flow](provisioning.md).

The board defaults are BOOT GPIO0 low-active and WS2812 GPIO48, GRB order,
brightness 12/255 (clamped to 32). Build flags can override `ROAST_BOOT_PIN`,
`ROAST_RGB_PIN`, `ROAST_RGB_ORDER`, `ROAST_RGB_BRIGHTNESS`, or disable the LED with
`ROAST_RGB_ENABLE=0`. These are source/compile choices, not measurements of the
user's actual hardware. RESET/EN restarts normally; BOOT recovery is recognized
only after firmware has observed a release, then a debounced five-second hold
and release. Do not hold BOOT during power-on to enter provisioning.

HTTP GET status and OPTIONS accept only exact saved HTTPS or permitted local
HTTP origins; HTTP hosts are localhost, 127/8, 10/8, 172.16/12 or 192.168/16
strict dotted-decimal IPv4. Ports remain part of each configured origin. Command
POST still rejects every Origin and additionally needs an explicitly configured
`ROAST_HTTP_TOKEN` of at least 16 characters; the default empty token disables
HTTP commands. No new control permission is supplied by the website allowlist.
Modbus virtual control still requires USB authorization and a live lease.
Changing network configuration or recovering via BOOT revokes existing sessions.

HTTP uses one connection, 64-byte nonblocking work steps, bounded headers and
body, and a separate Flash-backed setup page sender. Scanning is asynchronous,
connection tests last at most 30 seconds, reconnect waits grow to 30 seconds;
ordinary reconnection never automatically opens the setup hotspot. Wi-Fi state
is polled from the main loop; no callback changes controller or NVS state.
Only explicit setup/reset writes NVS and those flows force outputs stopped first.
SDK Wi-Fi/NVS/GPIO call duration and total task stack high-water mark still need
measurement on the physical board; no native test proves those hardware timings.

On Windows, an equivalent local build uses `.tools/venv/Scripts/python.exe -m
platformio run -e s3_locked -e s3_virtual_demo -e s3_network_compilecheck`.
Use `CXX` pointing to a modern C++17 compiler for `python tools/test_native.py`.

## Remaining physical qualification

Before useful real roasting: confirm the carrier; exact RTU device/registers and
input type; independent temperature measurement; validated SSR/current-loop
conversion; external DAC for 0–4.5 V ESC if applicable; safe fan/brake semantics;
independent overtemperature/airflow/cutoff chain; sensor failure and brownout
behavior; actual actuator feedback; and one sole heater PID owner. Neither this
release nor a protocol write can authorize or activate such a profile.

If task-watchdog initialization/configuration or refresh fails at runtime, all
mutating USB/HTTP commands are rejected with `watchdog_unavailable` and the
controller is held stopped. Hardware watchdog timing itself is not bench-tested.

### Provenance interpretation

The upstream prebuilt Arduino library supplies an ESP application-description
label/date such as `arduino-lib-builder`. Those fields describe upstream library
metadata, **not this rebuild’s source revision or build time**. Use the release
manifest’s Git commit, build-input/source SHA256, compiler flags and actual ELF
hash for this project. Runtime telemetry and directory names distinguish LOCKED
from VIRTUAL_DEMO.

Release collection rejects stale source/build-input mismatches and actual Xtensa
application-object function frames larger than 2048 bytes. Each image includes a
`stack-audit.json` from disassembled object code. This is not a proof of total
call-chain, SDK/interrupt stack usage, or measured on-board stack high-water mark.

The 2026-10-30 Web BLE build uses the BLE library already bundled in the pinned Arduino 3.3.12 SDK; no external Bluetooth package is required. All three environments compile the same notify-only adapter. The SDK selects NimBLE and enables software Wi-Fi/BLE coexistence. Release manifests include `web_ble` with the service/status UUIDs and `hardware_tested:false`. BLE is for webpage telemetry only; Artisan's Wi-Fi setup and authorization remain unchanged. No board flash or radio test is part of generating this package.

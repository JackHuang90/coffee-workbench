# Roast protocol v1 (rebuild)

USB serial uses LF-terminated ASCII, maximum 255 bytes excluding LF; CR is allowed only immediately before LF. Oversized/malformed lines are discarded until LF; partial lines expire after 1 second. Replies are one bounded JSON object plus LF. `HELLO` and `STATUS` are read-only, require no session. Every control line has:

`R1 <session_u32> <seq_u32> <deadline_u32_ms> <verb> [arguments]`

Session is the device's per-boot random nonzero value from HELLO; sequence must be strictly larger than last consumed sequence (no wrapping); deadline is current device monotonic millis through at most 5000 ms ahead (wrap-safe). A syntactically valid, session-matching, owner-authorized envelope consumes its sequence even if its command fails. `last_seq` is the consumed sequence; `last_accepted_seq` only advances on successful software acknowledgement. On a transport timeout, discover state before issuing a new sequence; never assume success. Session is replay protection, not authentication; USB is a local trust boundary. HTTP commands add a bearer secret and reject every Origin header (including same-origin POST); read-only status accepts exact configured HTTPS or permitted local HTTP origins and preserves no-Origin clients; Modbus TCP cannot grant/arm itself; optional virtual control requires explicit local USB authorization as described below.

Verbs (case sensitive; unsigned decimal except signed BT):

- `BEGIN <id> <count> <hash>`: ID 1..24 ASCII letters/digits/_/-, 2..1024 points. Only stopped states; opens staging without replacing committed profile.
- `POINT <index> <t_ms> <bt_deciC>`: strict sequential index; first time 0; strictly increasing times, gaps ≤5000 ms, end ≤1800000 ms; BT -200..2800. Fails without mutating that index.
- `COMMIT`: count and hash must match; atomic replacement, state READY. Hash is 32-bit FNV-1a starting 2166136261, bytewise little-endian uint32 time then little-endian two's-complement int16 BT for every point, wrapping modulo 2^32. Hash is accidental-corruption detection, not cryptographic authentication. ID is metadata; committed hash identifies exact samples.
- `ABORT`: discard staging, preserve committed profile.
- `ARM`: DEMO only, valid committed curve/fresh virtual sensor, explicit transition from READY/IDLE/PAUSED/COMPLETED; outputs zero. PAUSED resume retains elapsed; other arms reset elapsed.
- `START`: only ARMED and live lease; starts/resumes local timeline.
- `PING`: renews 5000-ms control lease only; never arms/starts.
- `PAUSE`: RUNNING/MANUAL→PAUSED, zero demand, elapsed frozen, ARM then START needed after automatic pause. Pausing MANUAL keeps automatic control revoked: STOP is required before any ARM/START.
- `MANUAL`: RUNNING→MANUAL, PID revoked, demand zero.
- `OUTPUT <percent>`: MANUAL only, integer 0..100, virtual demand.
- `STOP`: zero demand, disarm, IDLE (LOCKED stays LOCKED); discard staging. No automatic resume.

All control verbs, including upload and STOP, reject LOCKED (`hardware_locked`) with demand remaining zero. Device-local faults/stops do not need a transport command. `HELLO`/`STATUS` always expose `mode`, `state`, `session`, `last_seq`, `uptime_ms`, `bt`/`et` (null if unavailable), `target_bt`, `elapsed_ms`, `curve_id/hash`, `requested_pct`, `virtual_applied_pct`, `physical_actual_pct:null`, `physical_enabled:false`, and fault reason. ACK contains `ok`, `code`, `seq`, and state; no physical acknowledgement is implied. A single owner session is shared across USB/HTTP: coordinate sequence numbers, not simultaneous writers.

Current builds enable persistent hotspot provisioning by default; see [provisioning](provisioning.md). `NETWORK` is a local USB-only adapter query for compiled/configured/connected state and address. `SETUP` explicitly queries hotspot name, password, URL and identity readiness; it never exposes the router password and is not implemented as an HTTP command.

HTTP `GET /api/v1/status` remains the v1 read-only JSON contract. A request without Origin remains valid. An Origin must exactly match a configured canonical HTTPS or permitted local HTTP origin (including non-default port); `null`, wildcard, prefix/suffix matches and unconfigured origins reject. Allowed responses include exact `Access-Control-Allow-Origin` and `Vary: Origin`. OPTIONS on this status path requires allowed Origin plus `Access-Control-Request-Method: GET`, permits only the `Accept` requested header, and handles `Access-Control-Request-Private-Network: true`. It does not grant credentials, arbitrary headers, or control methods.

Allowed HTTP origin hosts are exactly `localhost`, strict dotted-decimal IPv4 in 127/8, 10/8, 172.16/12, or 192.168/16. No implicit localhost/LAN permission is added. Public HTTP domains/IPs, localhost subdomains, `.local` HTTP names, IPv6, userinfo, wildcards, control characters, backslashes and ambiguous numeric IPv4 forms reject. Full URLs normalize to lowercase scheme/host with paths removed and default HTTP 80 / HTTPS 443 ports omitted; other ports 1–65535 remain part of the exact origin. Thus `http://localhost:5173` does not authorize port 5174 or `http://127.0.0.1:5173`.

`POST /api/v1/command` remains a Content-Length ≤255 ASCII command with bearer token and no Origin. No default command token is provisioned. The separate setup parser has 2048-byte headers and 4096-byte URL-encoded forms; its mutations require active setup mode, the AP local address and peer subnet, exact Host, exact `http://<AP-IP>` Origin, and a random per-hotspot `X-Setup-Token`. No website allowlist entry grants setup access. HTTP is not routed through a generic proxy or redirecting fetch.

Modbus TCP port 502 when Wi-Fi configured, unit 1. FC03 addresses: 0 BT signed deci-C, 1 ET signed deci-C, 2 target signed deci-C, 3 requested percent x10, 4 status bits (bit0 sensor valid, bit1 active, bit2 fault, bit3 physical locked, bit15 virtual demo), 5 state enum, 6 elapsed seconds, 7 protocol version=1. FC03 initially 8 registers, extended to 12 below; any unavailable temperature in requested range returns exception 04, invalid range exception 02. FC06 address 100 value 0 requests STOP in demo only; additional explicitly USB-granted virtual registers are specified below. LOCKED writes always reject. No remote grant/start, PID gains, pin maps, physical SV or physical actuator control registers. Artisan setup can read normalized channels but actual Artisan application/hardware interoperability remains unverified.

## Explicit control ownership and Artisan VIRTUAL_DEMO modes

`STATUS.owner` is `none`, `usb`, `http`, `modbus_power`, or `modbus_sv`. Successful curve commands acquire the USB/HTTP owner; commands from another channel reject `control_owned_by_other_channel`. `STOP` is the only cross-owner action: it only zeros/disarms/releases. `last_seq` remains a shared replay-prevention counter, not a channel-ownership token. Replies with `ok:false` never imply applied commands. `last_accepted_seq` concerns R1 software acknowledgements, not Modbus traffic or actuator observation.

The following no-argument R1 commands **must arrive over local USB**, never HTTP or Modbus:

- `ARTISAN_POWER`: requires IDLE/READY and fresh virtual sensors, clears demand and grants Modbus virtual heater/fan control. Device PID disabled.
- `ARTISAN_SV`: same, but grants SV/fan control and enables the device's single virtual PID. Initial SV is current virtual BT; direct heat commands disabled.

Each grant lasts exactly 300000 ms (5 minutes); status `authorization_remaining_ms` counts down, never silently extends. `authorization_generation` increases on every grant (even same-mode regrants), never resets on STOP, and forces old TCP/framing state to be discarded. It is a deliberately short interoperability demonstration, not a full roast authorization. Valid FC06 writes refresh a 5000-ms liveness lease only. Configure a periodic heartbeat/control action faster than 5 seconds; otherwise the session faults and virtual heat/fan become zero. FC03 telemetry polling does NOT maintain control. USB/HTTP PING cannot maintain a Modbus-owned session. On any timeout/fault, late writes reject; explicit STOP and a new USB grant are needed. STOP cannot clear FAULT until sensor validity/freshness has recovered.

Additional status: `control_mode`=`LOCKED`/`CURVE_DEMO`/`ARTISAN_POWER_DEMO`/`ARTISAN_SV_DEMO`; `fan_requested_pct`; `hardware_profile:unverified`; bounded `limits`. Fan is a virtual request and toy cooling term, never physical feedback.

### Extended Modbus map (zero-based addresses)

FC03 count 1..12, addresses 0..11. Addresses 0..7 above remain unchanged. Address8 virtual fan percent x10;9 owner enum (none0,USB1,HTTP2,ModbusPower3,ModbusSV4);10 control mode (curve0,power1,SV2);11 grant remaining whole seconds. State enums add9=ARTISAN_POWER,10=ARTISAN_SV. Status active bit covers those modes. All physical-lock bits remain set even in virtual mode.

FC06 writes (unit1), every accepted write is only software/virtual acknowledgement:

| Address | Value / units                                 | Allowed owner                      |
| ------- | --------------------------------------------- | ---------------------------------- |
| 100     | 0 STOP                                        | any channel, DEMO only; cannot arm |
| 101     | signed int16 BT target, -200..2800 deci-C     | ModbusSV only                      |
| 102     | unsigned 0..1000 = virtual heater percent x10 | ModbusPower only                   |
| 103     | unsigned 0..1000 = virtual fan percent x10    | either granted Modbus mode         |
| 104     | 1 heartbeat; renews liveness only             | either granted Modbus mode         |

Invalid address→02, invalid value→03, wrong mode/owner/unavailable/expired/LOCKED→04. FC06 cannot create a grant, switch mode, unlock hardware, alter pin mappings, tune a physical controller, or renew the fixed authorization window. TCP is unauthenticated; trusted isolated LAN only. No exposure to the internet or router port forwarding.

## Web BLE read-only status (2026-10-30)

The bundled NimBLE service is available independently of Wi-Fi provisioning, including first-boot SoftAP. Device name: `Coffee-` plus a device suffix. It accepts one BLE client. Artisan continues to use Wi-Fi Modbus TCP; there is no Artisan BLE adapter, command characteristic, upload or BLE keepalive.

- Service: `b4e7a001-9d56-4f1b-a6e0-7d31c2f84590`.
- Status characteristic: `b4e7a002-9d56-4f1b-a6e0-7d31c2f84590`, NOTIFY only, with the SDK-generated subscription descriptor.
- Each notification begins with eight bytes: `52 01`, then little-endian uint16 message sequence, total JSON byte length, and byte offset. The remaining bytes are the existing v1 `statusJson` UTF-8 JSON, unchanged.
- JSON length is 1..1023 bytes. Notification length is 9..244 bytes and at most negotiated ATT MTU minus 3. MTU23 therefore carries up to 12 JSON bytes per notification. Sequence numbers wrap after 65535.
- A stable snapshot starts at most once per second. Each main-loop tick queues at most one chunk, with at least 5 ms between successful sends and attempts. The snapshot is held unchanged until completion. Only successful host acceptance advances the offset.
- Connecting/disconnecting or switching subscription invalidates queued fragments. Current-session packets waiting over 100 ms, invalid packet limits, or a snapshot still incomplete after 1.5 seconds cause BLE disconnection. Temporary host buffer exhaustion retries within these bounds. The browser additionally enforces assembly and sample freshness deadlines.

Only the main loop reads the Controller. BLE connection callbacks and the host send event cannot issue controller commands, renew a lease, or call `transportLost`. Disconnecting BLE leaves another channel's owner and lease intact. Browser device permission allows viewing existing status; it does not authenticate firmware identity, and HTTP website-origin configuration does not apply to BLE. No Wi-Fi passwords or provisioning secrets appear in this status.

Native interoperability entry point: `roast::ble::encodeFragment(const uint8_t* json, size_t length, uint16_t sequence, size_t offset, uint16_t mtu, uint8_t* out, size_t capacity)` returns the notification length, or zero without changing output on invalid input. `tests/ble_runner.cpp <mtu> <sequence>` prints actual controller status followed by one hex notification per line for the browser production decoder tests.

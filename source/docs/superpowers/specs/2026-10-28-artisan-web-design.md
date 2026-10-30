# Artisan interoperability and local connection design

The user explicitly requested implementation after the frozen ESP32 release. This extends the existing Vue 3 / TypeScript / Pinia console, preserving its compact coffee visual language and existing v1/v2 local records. Firmware and its artifacts remain unchanged at 22a1692283096d159cbc8dc640ddec826be78c91.

## Decisions and scope

- Native Artisan `.alog` is the primary curve interchange. A bounded recursive Python-literal parser (never evaluation) preserves a full inert native attachment, including tuple identity, unknown fields, raw negative/fractional times and original C/F arrays. A separate Celsius projection is editable in the console; charge-relative display is explicit. Unchanged native export is semantically identical; edited exports update only relevant fields and remove invalid signatures with honest third-party provenance. JSON/CSV remain secondary formats.
- Forecast is not the target/reference: a visual-only dashed BT projection uses a continuous recent regression window, up to 60 seconds ahead. Missing values, stale points and cadence-scaled gaps suppress it with a reason. No forecast is fed to any controller.
- Since frozen firmware rejects every browser Origin, direct remote Site-to-LAN fetch cannot work reliably. The chosen Node built-in localhost bridge serves the same built UI and a narrow read-only connection API on 127.0.0.1. Hosted UI only explains local setup. Connect never arms/starts, and no arbitrary command proxy or USB-only grants are exposed. This bounded phase does not add device control; local simulation stays separate from device telemetry.
- Credentials are entered only in locally served UI, retained by bridge memory only, cleared on disconnect, never persisted/logged. Fixed private numeric IPv4:80 targets only; exact Host/Origin and CSRF validation, no redirects, DNS, wildcard CORS or tunnels. Read-only polling does not renew firmware control leases. Unknown schemas fail closed.

## Alternatives

Direct hosted browser access conflicts with the unchanged no-Origin firmware contract; weakening CORS or adding a cloud relay is rejected. A firmware-hosted UI would require changing the frozen firmware and is out of scope. A local same-origin bridge supplies real LAN connectivity without those compromises. Full HTTP virtual control is deferred because read-only connection plus existing independent local simulation meets this phase without introducing remote ownership/heartbeat hazards.

## Verification boundaries

Test the literal parser against sanitized user input and pinned official examples plus Python literal oracles; reject executable/prototype/depth/size inputs. Test old local data preservation and quota failures. Test trend cadence and gaps. Test actual localhost HTTP sockets against mocked firmware and app adapter, including target/Host/Origin/CSRF validation, null telemetry, owner/mode, timeout/reset/disconnect. Independent review and parent browser QA precede release. No actual ESP, Artisan GUI, Windows runtime or physical-roaster verification is claimed.

# HTTP local website connection correction

User explicitly requested fixing the overly strict HTTPS-only gate. Preserve browser security controls and the existing read-only connection; no physical flashing or real-device claim.

## Agreed contract

- HTTPS keeps existing supported hosts. HTTP accepts exact localhost, canonical four-part decimal 127/8 and RFC1918 IPv4 only. Reject public HTTP sites, opaque origins, userinfo, wildcard, IPv6 and numeric aliases. Website ports match exactly after normalizing default80/443.
- Firmware normalizes configuration URLs to origins and persists only explicit configured sources. GET status/OPTIONS receive exact CORS permission; no control or setup-write expansion.
- Frontend uses one shared eligibility helper for the client and origin-copy UI. No discovery or device request before a click. Keep existing 127.0.0.1 bridge default with an explicit direct-mode choice.
- Update setup instructions to explain firmware upgrade + adding actual local origin. Browser/network permission remains separate from application eligibility.
- Other in-progress flavor/import changes are outside this correction. Preserve those files; publish this correction on the existing Site source checkout without pulling unrelated unfinished source into it.

## Verification and delivery

- [x] Firmware red/green coverage: normalization, private/loopback boundaries, persistence, exact GET/preflight and deny cases.
- [x] Web red/green coverage: HTTP availability, no request until click, copy fallback, rejected public HTTP, unchanged bridge behavior.
- [x] Run relevant/full checks, all three SDK builds and stack audit; collect updated reference firmware with source hashes.
- [x] Chrome verifies localhost:5173 now shows direct form and current HTTP source; no live device probe without a device address.
- [x] Independent review, publish existing owner-private Site, provide current firmware and exact-origin instructions.

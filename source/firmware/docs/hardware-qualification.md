# Physical hardware qualification — no approved profile

Neither released image contains a physical sensor or actuator HAL binding. The
`OutputPort` contract is explicitly virtual; future hardware control is a new
reviewed implementation, not a macro/pin-map switch in this release.

Known user context is not sufficient to choose electrical interfaces:

- ESP32-S3 N16R8 identifies 16 MB flash and 8 MB octal PSRAM, not the carrier. Verify
  module marking, carrier schematic, USB connector and memory config. Do not use
  suggested GPIO35–37 without verifying PSRAM occupancy; USB/strap pins also need
  carrier-specific review.
- The Taiquan TC4S-81TC-RS485 seller information describes 100–240VAC supply,
  4–20mA control and RS485. Seller `.aset` values (9600 8N1, slave1, PV0/SV2)
  are candidate settings, **not an exact-model register map or safe shutdown
  command**. This firmware does not embed them as a physical binding.
- Omron E5CC-QX2ASM-802 and -800 differ in RS485 availability; voltage-pulse SSR
  outputs are not direct 4–20mA control. Model/manual verification is mandatory.
- The SSR photo marked TRT-1LA2210/10A conflicts with a 40 A listing. Exact phase-angle
  input, isolation, thermal design, load rating and failure mode remain unverified.
- The ESC uses 0–4.5V analog speed, not assumed RC PWM; no UBEC, direction/brake
  truth table uncertain. ESP32-S3 has no built-in DAC for this: a qualified external
  DAC/driver and safe power/domain/interface design are needed.
- PT100 wire count, input configuration and the alternative K-probe wiring are
  unknown. No real BT/ET is fabricated in the LOCKED image.
- A 1200 W/mains heater must have qualified independent overtemperature, airflow,
  emergency stop and energy-disconnect protection; fan-safe cooling on failure
  must be engineered. Virtual zero heat/fan is NOT a physical fail-safe sequence.

## Select exactly one heater control architecture later

1. **Instrument-PID profile:** verified sensor reads and verified, bounded SV
   commands to the instrument; instrument is the only heater PID. S3 owns the
   validated curve timeline and supervisory safety. Never assume an SV command
   shuts off the heater.
2. **Direct-S3-PID profile:** qualified physical sensor acquisition, independent
   cutoffs and a correctly isolated SSR/current-loop driver; S3 is the only heater
   PID. Instrument, if present, must not independently regulate the same actuator.

Before either profile: verify independent feedback, fault states, temperatures,
control limits, watchdog response, stale sensors, noisy/late RS485, reversed
polarity, stuck outputs, reboot/brownout and disconnected clients on a safe test
rig. Confirm actual outputs with measurement, not successful command ACKs. The
current source, compilation, native simulation and manifests provide no such
physical qualification.

/** Frozen protocol v1 schema shared by the local bridge and browser client.
 * No imported curve data or arbitrary device fields become executable commands.
 */
export function validateDeviceStatus(value) {
  const fail = () => {
    throw new Error("device_schema_error");
  };
  const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!record(value)) fail();
  const one = (key, values) => {
    if (!values.includes(value[key])) fail();
    return value[key];
  };
  const number = (key, min, max, integer = false) => {
    const n = value[key];
    if (
      typeof n !== "number" ||
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (integer && !Number.isInteger(n))
    )
      fail();
    return n;
  };
  const nullableTemperature = (key) => (value[key] === null ? null : number(key, -50, 500));
  const text = (key, pattern) => {
    if (typeof value[key] !== "string" || !pattern.test(value[key])) fail();
    return value[key];
  };
  if (
    value.v !== 1 ||
    value.physical_enabled !== false ||
    value.physical_actual_pct !== null ||
    value.pending_request_id !== null ||
    typeof value.sensor_valid !== "boolean"
  )
    fail();
  const expectedLimits = {
    max_points: 1024,
    max_duration_ms: 1800000,
    max_gap_ms: 5000,
    lease_ms: 5000,
    sensor_fresh_ms: 1000,
  };
  if (
    !record(value.limits) ||
    Object.entries(expectedLimits).some(([key, expected]) => value.limits[key] !== expected)
  )
    fail();
  const result = {
    v: 1,
    mode: one("mode", ["LOCKED", "VIRTUAL_DEMO"]),
    source: one("source", ["unavailable", "virtual_demo"]),
    state: one("state", [
      "LOCKED",
      "IDLE",
      "READY",
      "ARMED",
      "RUNNING",
      "PAUSED",
      "MANUAL",
      "COMPLETED",
      "FAULT",
      "ARTISAN_POWER",
      "ARTISAN_SV",
    ]),
    session: number("session", 1, 0xffffffff, true),
    last_seq: number("last_seq", 0, 0xffffffff, true),
    uptime_ms: number("uptime_ms", 0, 0xffffffff, true),
    bt: nullableTemperature("bt"),
    et: nullableTemperature("et"),
    target_bt: nullableTemperature("target_bt"),
    sensor_valid: value.sensor_valid,
    elapsed_ms: number("elapsed_ms", 0, 0xffffffff, true),
    curve_id: text("curve_id", /^[A-Za-z0-9_-]{0,24}$/),
    curve_hash: number("curve_hash", 0, 0xffffffff, true),
    requested_pct: number("requested_pct", 0, 100),
    virtual_applied_pct: number("virtual_applied_pct", 0, 100),
    physical_actual_pct: null,
    physical_enabled: false,
    pending_request_id: null,
    last_accepted_seq: number("last_accepted_seq", 0, 0xffffffff, true),
    reason: text("reason", /^[A-Za-z0-9_ -]{0,128}$/),
    owner: one("owner", ["none", "usb", "http", "modbus_power", "modbus_sv"]),
    control_mode: one("control_mode", [
      "LOCKED",
      "CURVE_DEMO",
      "ARTISAN_POWER_DEMO",
      "ARTISAN_SV_DEMO",
    ]),
    fan_requested_pct: number("fan_requested_pct", 0, 100),
    authorization_remaining_ms: number("authorization_remaining_ms", 0, 300000, true),
    authorization_generation: number("authorization_generation", 0, 0xffffffff, true),
    hardware_profile: one("hardware_profile", ["unverified"]),
    limits: expectedLimits,
  };
  if (!result.sensor_valid && (result.bt !== null || result.et !== null)) fail();
  if (result.last_accepted_seq > result.last_seq) fail();
  if (
    result.mode === "LOCKED" &&
    (result.source !== "unavailable" ||
      result.control_mode !== "LOCKED" ||
      result.state !== "LOCKED" ||
      result.owner !== "none" ||
      result.requested_pct !== 0 ||
      result.virtual_applied_pct !== 0 ||
      result.fan_requested_pct !== 0)
  )
    fail();
  if (
    result.mode === "VIRTUAL_DEMO" &&
    (result.source !== "virtual_demo" ||
      result.control_mode === "LOCKED" ||
      result.state === "LOCKED")
  )
    fail();
  return result;
}

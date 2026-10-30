export interface DeviceStatus {
  v: 1;
  mode: "LOCKED" | "VIRTUAL_DEMO";
  source: "unavailable" | "virtual_demo";
  state:
    | "LOCKED"
    | "IDLE"
    | "READY"
    | "ARMED"
    | "RUNNING"
    | "PAUSED"
    | "MANUAL"
    | "COMPLETED"
    | "FAULT"
    | "ARTISAN_POWER"
    | "ARTISAN_SV";
  session: number;
  last_seq: number;
  uptime_ms: number;
  bt: number | null;
  et: number | null;
  target_bt: number | null;
  sensor_valid: boolean;
  elapsed_ms: number;
  curve_id: string;
  curve_hash: number;
  requested_pct: number;
  virtual_applied_pct: number;
  physical_actual_pct: null;
  physical_enabled: false;
  pending_request_id: null;
  last_accepted_seq: number;
  reason: string;
  owner: "none" | "usb" | "http" | "modbus_power" | "modbus_sv";
  control_mode: "LOCKED" | "CURVE_DEMO" | "ARTISAN_POWER_DEMO" | "ARTISAN_SV_DEMO";
  fan_requested_pct: number;
  authorization_remaining_ms: number;
  authorization_generation: number;
  hardware_profile: "unverified";
  limits: {
    max_points: 1024;
    max_duration_ms: 1800000;
    max_gap_ms: 5000;
    lease_ms: 5000;
    sensor_fresh_ms: 1000;
  };
}
export function validateDeviceStatus(value: unknown): DeviceStatus;

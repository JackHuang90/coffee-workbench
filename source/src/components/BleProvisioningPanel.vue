<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import type { BleProvisioningClient, SetupOp, SetupState } from "../core/ble-provisioning";
import { isAllowedDevicePageOrigin } from "../core/device-origin";
const props = defineProps<{ client: BleProvisioningClient; connected: boolean }>();
const opened = ref(false),
  busy = ref(false),
  saving = ref(false),
  error = ref(""),
  message = ref(""),
  state = ref<SetupState>({});
const form = reactive({
  ssid: "",
  password: "",
  mode: "dhcp",
  ip: "",
  mask: "255.255.255.0",
  gateway: "",
  dns: "",
  origins: isAllowedDevicePageOrigin(location.origin) ? location.origin : "",
});
let edits = 0,
  life = 0;
const tested = ref<number | null>(null);
let suppress = false;
watch(
  form,
  () => {
    if (!suppress) {
      edits++;
      tested.value = null;
    }
  },
  { flush: "sync" },
);
const authorized = computed(() => state.value.authorized === true);
const canSave = computed(() => tested.value !== null && authorized.value && !busy.value);
let authorizationTimer: ReturnType<typeof setTimeout> | undefined;
function acceptState(value: SetupState) {
  state.value = value;
  if (value.authorized !== undefined) {
    clearTimeout(authorizationTimer);
    if (value.authorized) {
      authorizationTimer = setTimeout(
        () => {
          state.value.authorized = false;
          state.value.networks = [];
          form.password = "";
          tested.value = null;
          message.value = "配网许可已过期，请重新短按 BOOT 确认。";
        },
        Math.min(120000, Math.max(0, value.remaining_ms ?? 120000)),
      );
    } else {
      tested.value = null;
      form.password = "";
    }
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
let wake: (() => void) | undefined;
function reset() {
  life++;
  clearTimeout(timer);
  clearTimeout(authorizationTimer);
  wake?.();
  wake = undefined;
  form.password = "";
  tested.value = null;
  state.value = {};
  opened.value = false;
  busy.value = false;
  saving.value = false;
  error.value = "";
  message.value = "";
}
watch(
  () => props.connected,
  (connected) => {
    if (!connected) reset();
  },
);
watch(() => props.client, reset);
onBeforeUnmount(reset);
function pause() {
  return new Promise<void>((resolve) => {
    wake = resolve;
    timer = setTimeout(() => {
      wake = undefined;
      resolve();
    }, 750);
  });
}
async function action(op: SetupOp, body = "", poll?: (value: SetupState) => boolean) {
  const current = life;
  busy.value = true;
  error.value = "";
  try {
    let value = await props.client.request(op, body);
    if (current !== life) return;
    acceptState(value);
    const deadline = performance.now() + 35000;
    while (poll && !poll(value)) {
      if (performance.now() >= deadline) throw new Error("等待设备超时，请重试。");
      await pause();
      if (current !== life) return;
      value = await props.client.request("state");
      if (current !== life) return;
      acceptState(value);
    }
    return value;
  } catch (cause) {
    if (current === life) {
      error.value = cause instanceof Error ? cause.message : "配网失败，请重试。";
      if (/author|授权/.test(error.value)) {
        state.value.authorized = false;
        tested.value = null;
      }
    }
  } finally {
    if (current === life) busy.value = false;
  }
}
async function open() {
  opened.value = true;
  const value = await action("state");
  if (!value) return;
  suppress = true;
  for (const key of ["ssid", "mode", "ip", "mask", "gateway", "dns"] as const) {
    if (value[key]) form[key] = value[key]!;
  }
  if (value.origins?.length) form.origins = value.origins.join("\n");
  suppress = false;
}
async function unlock() {
  message.value = "请先松开 BOOT，再短按并松开（50 毫秒至 5 秒内），不要长按。";
  await action("unlock", "", (v) => v.authorized === true || v.pending === false);
}
async function scan() {
  await action("scan", "", (v) => v.scanning === false);
}
async function test() {
  tested.value = null;
  const body = new URLSearchParams({ ...form }).toString();
  suppress = true;
  form.password = "";
  suppress = false;
  const revisionEdits = edits;
  let requestedRevision: number | undefined;
  const value = await action("test", body, (v) => {
    if (requestedRevision === undefined && Number.isInteger(v.revision))
      requestedRevision = v.revision;
    return v.state === "Ready" || v.state === "Failed" || v.state === "SaveFailed";
  });
  if (!value) return;
  if (
    value.state === "Ready" &&
    value.authorized &&
    Number.isInteger(value.revision) &&
    value.revision === requestedRevision &&
    edits === revisionEdits
  ) {
    tested.value = value.revision!;
    message.value = "测试成功，可以保存当前配置。";
  } else if (value.state === "Failed")
    error.value = value.error || "连接失败，请检查 Wi-Fi 密码与地址。";
  else if (edits !== revisionEdits) message.value = "表单已修改，请重新输入密码并测试。";
  else if (value.revision !== requestedRevision)
    error.value = "设备候选配置已改变，请重新测试当前表单。";
}
async function save() {
  if (!canSave.value) return;
  const current = life;
  saving.value = true;
  try {
    const value = await action("save", `revision=${tested.value}`);
    if (!value || current !== life) return;
    tested.value = null;
    const refreshed = await action("state");
    if (refreshed && current === life) message.value = "已保存 Wi-Fi 配置。";
  } finally {
    if (current === life) saving.value = false;
  }
}
async function close() {
  await action("close");
  reset();
}
async function copyIp() {
  if (!state.value.connected || !state.value.ip) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error();
    await navigator.clipboard.writeText(state.value.ip);
    message.value = "已复制设备 IP。";
  } catch {
    message.value = "请选中设备 IP 手工复制。";
  }
}
</script>
<template>
  <section class="ble-setup">
    <button
      v-if="!opened"
      data-test="setup-open"
      class="button secondary"
      :disabled="!connected"
      @click="open"
    >
      Wi-Fi 设置
    </button>
    <template v-else-if="connected">
      <h3>蓝牙配网</h3>
      <p>
        使用当前蓝牙连接设置 2.4 GHz
        Wi-Fi。系统可能提示蓝牙配对；请按系统提示完成。配对不验证设备身份，请在身边核对设备并短按
        BOOT 确认。
      </p>
      <button class="button secondary" :disabled="busy" @click="unlock">
        {{ authorized ? "重新确认配网许可" : "请求配网许可 · 短按 BOOT" }}
      </button>
      <p role="status">
        {{ authorized ? "设备已授权当前连接（有效期 120 秒）" : "等待现场按键确认" }} ·
        {{ message }}
      </p>
      <form autocomplete="off" @submit.prevent="test">
        <fieldset :disabled="saving">
          <label
            >Wi-Fi 名称（隐藏网络可手填）<input
              v-model="form.ssid"
              data-test="setup-ssid"
              maxlength="32"
              required
              autocomplete="off"
          /></label>
          <button
            type="button"
            class="button secondary"
            :disabled="!authorized || busy"
            @click="scan"
          >
            扫描附近 Wi-Fi
          </button>
          <select
            v-if="state.networks?.length"
            aria-label="扫描结果"
            @change="form.ssid = ($event.target as HTMLSelectElement).value"
          >
            <option value="">选择 Wi-Fi 或手动填写</option>
            <option v-for="(network, index) in state.networks" :key="index" :value="network.ssid">
              {{ network.ssid || "隐藏网络（请手填名称）" }} · {{ network.rssi }} dBm
            </option>
          </select>
          <label
            >Wi-Fi 密码（开放网络留空；发送后立即清空）<input
              v-model="form.password"
              data-test="setup-password"
              type="password"
              maxlength="64"
              autocomplete="new-password"
          /></label>
          <label
            >地址分配<select v-model="form.mode">
              <option value="dhcp">DHCP 自动获取</option>
              <option value="static">固定 IPv4</option>
            </select></label
          >
          <template v-if="form.mode === 'static'"
            ><label v-for="field in ['ip', 'mask', 'gateway', 'dns'] as const" :key="field"
              >{{ { ip: "IPv4 地址", mask: "子网掩码", gateway: "网关", dns: "DNS" }[field]
              }}<input v-model="form[field]" inputmode="decimal" maxlength="15" required /></label
          ></template>
          <label
            >允许的网站来源（每行一个，最多四个；包含协议及端口）<textarea
              v-model="form.origins"
              rows="3"
              placeholder="https://example.com"
            />
          </label>
          <p class="small-note">
            请核对以上来源后测试；只允许列出的网站读取 Wi-Fi
            状态。修改任意字段后须重新测试。密码不写入网页存储。
          </p>
          <div class="button-row">
            <button
              data-test="setup-test"
              class="button primary"
              type="submit"
              :disabled="!authorized || busy || !form.ssid"
            >
              {{ busy ? "等待设备…" : "测试连接（约 30 秒）" }}</button
            ><button
              data-test="setup-save"
              type="button"
              class="button primary"
              :disabled="!canSave"
              @click="save"
            >
              保存并完成
            </button>
          </div>
        </fieldset>
      </form>
      <p v-if="state.error" role="alert">{{ state.error }}</p>
      <p v-if="state.connected && state.ip">
        设备 IP：<input
          :value="state.ip"
          readonly
          aria-label="设备 IP"
          @focus="($event.target as HTMLInputElement).select()"
        /><button class="button secondary" @click="copyIp">复制 IP</button>
      </p>
      <p v-else-if="state.ip">候选地址：{{ state.ip }}（尚未确认连接）</p>
      <button class="button secondary" :disabled="busy" @click="close">关闭配网许可</button>
    </template>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.ble-setup,
form,
fieldset,
label {
  display: grid;
  gap: 8px;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.ble-setup {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid #d8cdbd;
  border-radius: 8px;
}
input,
select,
textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid #d8cdbd;
  border-radius: 7px;
  background: #fffaf4;
  color: inherit;
  font: inherit;
}
p {
  overflow-wrap: anywhere;
}
.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>

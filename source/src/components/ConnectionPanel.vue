<script setup lang="ts">
/**
 * 功能：展示只读设备连接、热点配网引导及浏览器访问限制。
 * 首次编写日期：未知（历史代码）
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-29：默认展示 Wi-Fi 直连，新增来源复制及显式桥接兼容入口；重开面板保留待处理目标。
 * - 2026-10-29：解除下拉框全局固定高度，窄屏改用整行显示，避免文字裁切。
 * - 2026-10-30：连接资格与来源复制共用校验，支持本机及内网 HTTP 和无剪贴板 API 时手工复制。
 * - 2026-10-30：新增网页 BLE 显式选择和取消、独立安全上下文提示及设备名称展示；Artisan 保留 Wi-Fi。
 */
import { computed, ref, watch } from "vue";
import BleProvisioningPanel from "./BleProvisioningPanel.vue";
import { defaultDeviceTransport } from "../core/device";
import { isBleSupported } from "../core/ble-device";
import { isAllowedDevicePageOrigin } from "../core/device-origin";
import type { DeviceClient, DeviceSnapshot, DeviceTransport } from "../core/device";
/** 功能：定义连接面板的展示状态和传输依赖。首次编写日期：2026-10-29。变更日期：2026-10-30。修改记录：2026-10-29 首次编写；2026-10-30 扩展 BLE 传输展示。 */
interface Props {
  /** 执行显式连接和断开的客户端。 */
  client: DeviceClient;
  /** 页面选定的 Wi-Fi、蓝牙或桥接模式。 */
  transport: DeviceTransport;
  /** 最近收到的设备状态，不包含本地曲线。 */
  snapshot: DeviceSnapshot;
  /** 最近响应距离当前时间的毫秒数。 */
  ageMs: number | null;
  /** 当前响应是否仍在展示新鲜度期限内。 */
  fresh: boolean;
}
const props = defineProps<Props>();
const emit = defineEmits<{ transport: [value: DeviceTransport] }>();
const ip = ref(props.snapshot.ip ?? ""),
  busy = ref(false),
  error = ref("");
const connecting = computed(() => busy.value || props.snapshot.state === "connecting");
const websiteOrigin = location.origin,
  originCopy = ref("");
const allowedOrigin = isAllowedDevicePageOrigin(websiteOrigin);
const bridgeHere = defaultDeviceTransport(websiteOrigin) === "bridge";
const canConnect = computed(() =>
  props.transport === "ble"
    ? isBleSupported(websiteOrigin) && props.snapshot.state !== "unavailable"
    : props.transport === "bridge"
      ? bridgeHere
      : allowedOrigin && props.snapshot.state !== "unavailable",
);
let intent = 0;
const status = computed(() => props.snapshot.status);
const stateLabels = computed(() => ({
  unavailable:
    props.transport === "ble"
      ? "当前浏览器或页面不支持蓝牙直连"
      : props.transport === "bridge"
        ? "本地桥接 · 请打开本地页面"
        : "此页面来源不支持直连",
  offline:
    props.transport === "ble"
      ? "蓝牙直连 · 未连接"
      : props.transport === "direct"
        ? "Wi-Fi 直连 · 未连接"
        : "本地桥接 · 未连接",
  connecting: props.transport === "ble" ? "正在选择或连接蓝牙设备…" : "正在读取设备状态…",
  connected: "已连接 · 只读",
  lost: "连接中断 · 需要手动重连",
}));
const sourceLabel = computed(() =>
  status.value?.mode === "VIRTUAL_DEMO"
    ? "设备虚拟数据（非传感器实测）"
    : status.value?.mode === "LOCKED"
      ? "锁定固件状态（无物理输出）"
      : "尚无设备数据",
);
watch(
  () => props.client,
  () => {
    intent++;
    busy.value = false;
    error.value = "";
  },
);
/** 功能：仅在用户提交或点击选择后连接，在首个 await 前调用客户端以保留 BLE 用户手势。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-29 支持直连和取消竞态；2026-10-30 共用 BLE 显式选择入口。 */
async function connect() {
  const current = ++intent,
    client = props.client;
  busy.value = true;
  error.value = "";
  try {
    await client.connect({ ip: ip.value.trim() });
  } catch (e) {
    if (current === intent)
      error.value = e instanceof Error ? e.message : "连接失败，请查看连接排查。";
  } finally {
    if (current === intent) busy.value = false;
  }
}
/** 功能：取消当前连接和许可等待，清空先前错误。首次编写日期：未知（历史代码）。变更日期：2026-10-29。修改记录：2026-10-29 断开使旧表单结果失效。 */
async function disconnect() {
  intent++;
  error.value = "";
  busy.value = true;
  try {
    await props.client.disconnect();
  } finally {
    busy.value = false;
  }
}
/** 功能：复制允许的精确网站来源，API 缺失或失败时提供手工复制提示。首次编写日期：2026-10-29。变更日期：2026-10-30。修改记录：2026-10-29 首次编写；2026-10-30 支持本机及内网 HTTP 来源，显式处理剪贴板 API 缺失。 */
async function copyOrigin() {
  if (!allowedOrigin) return;
  const fallback = "浏览器无法自动复制，请选中上方来源手工复制。";
  if (!navigator.clipboard?.writeText) {
    originCopy.value = fallback;
    return;
  }
  try {
    await navigator.clipboard.writeText(websiteOrigin);
    originCopy.value = "已复制，请粘贴到设备配网页的「允许的网站」。";
  } catch {
    originCopy.value = fallback;
  }
}
/**
 * 功能：格式化设备温度；空值显示破折号，不把无效读数转换为零。
 * 首次编写日期：未知（历史代码）
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：补齐函数说明，保持原有显示行为。
 */
const temperature = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)} °C`);
</script>
<template>
  <div class="connection-content">
    <label class="connection-mode"
      >连接方式<select
        data-test="transport"
        :value="transport"
        @change="emit('transport', ($event.target as HTMLSelectElement).value as DeviceTransport)"
      >
        <option value="direct">Wi-Fi 直连 · 无需安装软件</option>
        <option value="ble">蓝牙直连 · 无需设备 IP</option>
        <option value="bridge">本地桥接 · 兼容方式</option>
      </select></label
    >
    <p class="pill" role="status">{{ stateLabels[snapshot.state] }}</p>
    <p>
      本地仿真和设备遥测互相独立。这里仅查看状态，不上传曲线、不启动、不接管
      Artisan，也不发送保活心跳。
    </p>
    <div v-if="transport === 'ble'" class="bluetooth-guidance">
      <p>
        使用支持网页 BLE 的固件，点击选择 <code>Coffee-…</code> 设备。无需设备
        IP、路由器或额外软件；蓝牙只用于此网页，Artisan 继续通过 Wi-Fi 连接。
      </p>
      <p class="small-note">
        需要支持 Web Bluetooth 的浏览器与 HTTPS 或可信 localhost 页面。可尝试桌面 Chrome / Edge 或
        Android Chrome；Safari、iOS / iPadOS 与 Firefox 不保证支持。普通内网 HTTP
        页面不能使用此蓝牙入口，设备的 Wi-Fi 网站来源设置不影响蓝牙权限。
      </p>
      <button
        data-test="ble-wifi-fallback"
        class="button secondary"
        type="button"
        @click="emit('transport', 'direct')"
      >
        改用 Wi-Fi 直连
      </button>
    </div>
    <BleProvisioningPanel
      v-if="transport === 'ble' && snapshot.state === 'connected' && client.provisioning"
      :client="client.provisioning"
      :connected="snapshot.state === 'connected'"
    />
    <template v-if="transport === 'bridge' && !bridgeHere">
      <h3>先在同一台电脑启动本地桥</h3>
      <ol class="setup-steps">
        <li>解压对话附件交付的完整源码包，安装 Node.js 22.12+。在源码文件夹打开终端。</li>
        <li><code>npm ci</code>，再运行 <code>npm run bridge</code>。</li>
        <li>
          将
          <code>http://127.0.0.1:8787</code>
          复制到此电脑浏览器地址栏直接打开（不要从其他网站跳转），点击「连接 ESP32」。
        </li>
        <li>输入 ESP32 的内网 IPv4。端口固定 80；电脑与设备须在同一可信内网。</li>
      </ol>
      <p class="notice">
        兼容模式需要在本地桥提供的页面连接。选择此模式不会从托管网站探测
        localhost；无需修改浏览器安全设置。
      </p>
    </template>
    <template v-if="canConnect">
      <div v-if="transport === 'ble'" class="button-row">
        <button
          data-test="ble-connect"
          class="button primary"
          type="button"
          :disabled="connecting || snapshot.state === 'connected'"
          @click="connect"
        >
          {{ connecting ? "等待选择或连接…" : "选择蓝牙设备" }}
        </button>
        <button
          v-if="connecting || snapshot.state === 'connected' || snapshot.state === 'lost'"
          data-test="disconnect"
          class="button secondary"
          type="button"
          @click="disconnect"
        >
          {{ connecting ? "取消连接" : "断开" }}
        </button>
      </div>
      <form v-else class="connection-form" @submit.prevent="connect">
        <label for="device-ip">ESP32-S3 内网 IPv4</label>
        <div class="button-row">
          <input
            id="device-ip"
            v-model="ip"
            inputmode="decimal"
            autocomplete="off"
            placeholder="192.168.1.50"
            :disabled="connecting || snapshot.state === 'connected'"
            required
            maxlength="15"
          /><span class="port-label">: 80</span
          ><button
            class="button primary"
            type="submit"
            :disabled="connecting || !ip.trim() || snapshot.state === 'connected'"
          >
            {{ connecting ? "请稍候…" : "只读连接" }}</button
          ><button
            v-if="
              snapshot.state === 'connected' ||
              snapshot.state === 'lost' ||
              snapshot.state === 'connecting'
            "
            data-test="disconnect"
            class="button secondary"
            type="button"
            @click="disconnect"
          >
            {{ snapshot.state === "connecting" ? "取消连接" : "断开" }}
          </button>
        </div>
      </form>
      <p class="small-note">
        {{
          transport === "ble"
            ? "蓝牙遥测只读；Wi-Fi 设置需现场短按 BOOT 授权。"
            : "当前固件状态接口只读、不需要令牌，所以此处不收集密码。"
        }}连接后切到后台/关闭页面会断开；返回页面不会自动重连。
      </p>
      <div v-if="status" class="device-readings">
        <div>
          <span>豆温 BT</span><strong>{{ temperature(status.bt) }}</strong>
        </div>
        <div>
          <span>炉温 ET</span><strong>{{ temperature(status.et) }}</strong>
        </div>
        <div>
          <span>目标 BT（设备）</span><strong>{{ temperature(status.target_bt) }}</strong>
        </div>
      </div>
      <dl v-if="status" class="native-facts">
        <div>
          <dt>数据来源</dt>
          <dd>{{ sourceLabel }}</dd>
        </div>
        <div>
          <dt>固件 / 状态</dt>
          <dd>{{ status.mode }} / {{ status.state }}</dd>
        </div>
        <div>
          <dt>控制归属</dt>
          <dd>{{ status.owner }} · {{ status.control_mode }} · 网页只读</dd>
        </div>
        <div>
          <dt>物理输出</dt>
          <dd>锁定 · 无物理执行器绑定 / 实际输出未知</dd>
        </div>
        <div>
          <dt>样本有效性</dt>
          <dd>
            {{ status.sensor_valid ? "固件报告虚拟采样有效" : "采样无效 / 不可用" }} ·
            {{ status.reason || "无故障原因" }}
          </dd>
        </div>
        <div>
          <dt>连接质量</dt>
          <dd>
            <template v-if="transport === 'ble'"
              >{{ snapshot.deviceName || "Coffee BLE" }} · 蓝牙通知</template
            ><template v-else>{{ snapshot.ip }}:80 · RTT {{ snapshot.rttMs ?? "—" }} ms</template> ·
            响应{{ fresh ? "新鲜" : "已过期"
            }}{{ ageMs === null ? "" : `（${(ageMs / 1000).toFixed(1)} 秒前）` }}
          </dd>
        </div>
        <div>
          <dt>虚拟请求</dt>
          <dd>
            热量 {{ status.requested_pct }}% · 风机 {{ status.fan_requested_pct }}% · 不代表实际输出
          </dd>
        </div>
      </dl>
    </template>
    <p
      v-if="error || snapshot.diagnostic"
      :class="['notice', error || snapshot.state === 'lost' ? 'error' : '']"
      :role="error || snapshot.state === 'lost' ? 'alert' : 'status'"
    >
      {{ error || snapshot.diagnostic }}
    </p>
    <div v-if="transport === 'direct'" class="website-binding">
      <label for="website-origin">设备配网时允许的网站</label>
      <div class="button-row">
        <input
          id="website-origin"
          data-test="website-origin"
          :value="websiteOrigin"
          readonly
          @focus="($event.target as HTMLInputElement).select()"
        /><button
          data-test="copy-origin"
          type="button"
          class="button secondary"
          :disabled="!allowedOrigin"
          @click="copyOrigin"
        >
          复制来源
        </button>
      </div>
      <p class="small-note" role="status">
        {{
          originCopy ||
          (allowedOrigin
            ? "将此来源填入设备配网页的「允许的网站」，保留协议和非默认端口，不含页面路径。"
            : "请从 HTTPS 网站、本机或私有内网 HTTP 页面复制来源；设备白名单不接受当前地址。")
        }}
      </p>
    </div>
    <details v-if="transport !== 'ble'" class="connection-help">
      <summary>首次配网与恢复 Wi-Fi</summary>
      <ol class="setup-steps">
        <li>
          使用支持热点配网的固件。首次启动后连接
          <code>Coffee-Setup-…</code> 热点，输入设备标签上的独立密码；开发板可通过 USB
          查询热点凭据。
        </li>
        <li>
          打开系统配网弹窗；未弹出时访问
          <code>http://192.168.4.1</code>。若地址已调整，使用热点连接信息中的网关地址。
        </li>
        <li>
          选择路由器的 2.4 GHz Wi-Fi，填写密码。默认 DHCP 自动获取地址；需要固定 IPv4 时填写
          IP、子网掩码、网关与 DNS。
        </li>
        <li>在「允许的网站」粘贴上方网站来源。测试连接成功后点「保存并完成」，记下设备实际 IP。</li>
        <li>
          手机或电脑切回同一路由器 Wi-Fi，再回到此网站输入设备
          IP，点击「只读连接」并按浏览器提示允许局域网访问。
        </li>
      </ol>
      <p>
        恢复配网：设备正常启动后先松开 BOOT，再长按 5
        秒，紫灯快闪后松开。此操作清除网络和网站来源设置，保留设备热点身份。RESET
        只重启并保留配置；不要按住 BOOT 上电或按 RESET。
      </p>
    </details>
    <details
      v-if="transport === 'direct'"
      class="connection-help"
      :open="snapshot.state === 'lost'"
    >
      <summary>浏览器连接排查</summary>
      <p>
        点击连接前不会请求内网或扫描设备。支持从 HTTPS 网站、本机或私有内网 HTTP
        页面尝试直连；浏览器权限与安全策略仍可能阻止请求。HTTP
        页面若无法自动复制来源，可选中文字手工复制。请先用桌面 Chrome / Edge 或 Android Chrome
        验证；iOS、iPadOS 与微信内置浏览器的支持不能保证。
      </p>
      <ol class="setup-steps">
        <li>确认网页所在设备与 ESP32 在同一局域网，IP 与配网页结果一致，路由器未启用访客隔离。</li>
        <li>确认设备保存的「允许的网站」与上方来源完全一致，包括协议和端口。</li>
        <li>
          检查浏览器的网站权限是否允许局域网访问。首次连接最多等待 60 秒；拒绝或失败后不会自动重试。
        </li>
        <li>
          若仍失败，可能是设备 CORS、浏览器混合内容限制或托管网站 CSP /
          权限策略。网页无法从通用网络错误区分这些原因；可改用本地桥接兼容方式。
        </li>
      </ol>
      <p>无需关闭浏览器安全检查，也不要映射路由器端口或使用公网代理。</p>
    </details>
    <details class="connection-help">
      <summary>RGB 工作状态（按优先级显示）</summary>
      <p>
        GPIO48
        WS2812，低亮度。单灯优先显示下列较高项；实际颜色顺序需在板卡核对。灯态仅反映固件已有状态，网页本地仿真不会改变设备灯态。
      </p>
      <ol>
        <li>故障：红色三闪。</li>
        <li>BOOT 恢复待松开：紫色快闪。</li>
        <li>配网确认：紫黄交替。</li>
        <li>启动：白色呼吸，最多 1.5 秒。</li>
        <li>曲线接收：紫色快闪。</li>
        <li>设备虚拟温控：橙色呼吸。</li>
        <li>曲线已装载：紫色双闪。</li>
        <li>最近传输：青色短闪。</li>
        <li>配网已授权：紫色单闪。</li>
        <li>蓝牙已订阅：青色常亮；已连接未订阅：青色快闪。</li>
        <li>Wi-Fi 连接中：黄色快闪。</li>
        <li>已配网离线：黄色双闪。</li>
        <li>Wi-Fi 在线：绿色常亮。</li>
        <li>未配网：蓝色慢闪。</li>
      </ol>
      <p>
        LOCKED / VIRTUAL_DEMO 不代表物理输出成功；配网测试会停止设备虚拟会话，保存前必须测试成功。
      </p>
    </details>
    <details class="connection-help">
      <summary>Artisan 与设备状态</summary>
      <p>
        Artisan 读取：MODBUS TCP，设备 IP，端口 502，单元 1；Input 1（ET）寄存器 1、Input
        2（BT）寄存器 0，FC03、signed int16、÷10、°C。详细限制见
        <code>firmware/docs/artisan.md</code>。
      </p>
      <p>
        LOCKED / VIRTUAL_DEMO
        均未绑定物理执行器；虚拟演示不等于实机安全认证。网页可通过现场确认的蓝牙会话配置
        Wi-Fi，不刷机，也不更改 Artisan 控制会话。
      </p>
    </details>
  </div>
</template>
<style scoped>
.connection-mode,
.website-binding {
  display: grid;
  gap: 8px;
}
.connection-mode select,
.website-binding input {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid #d8cdbd;
  border-radius: 7px;
  background: #fffaf4;
  color: inherit;
  font: inherit;
}
.website-binding .button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.website-binding input {
  flex: 1;
  min-width: 150px;
}
.website-binding p {
  margin: 0;
  line-height: 1.6;
}
.connection-mode {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
}
.connection-help p {
  overflow-wrap: anywhere;
}
.connection-mode select {
  height: auto;
  min-height: 40px;
  padding: 8px 30px 8px 10px;
  line-height: 1.4;
}
@media (max-width: 400px) {
  .connection-mode {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

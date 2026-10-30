> 公开版本说明：本页历史部署域名和平台标识已脱敏；示例域名不代表可访问站点。

# 网页 BLE 连接验证 — 2026-10-30

## 交付范围

网页新增 BLE 只读状态入口，与原有 Wi-Fi 共用 v1 状态定义。ESP32-S3 广播 `Coffee-…`，提供单客户端、通知专用的自定义 GATT 服务。Artisan 继续使用 Wi-Fi / Modbus TCP，本次没有新增 Artisan 蓝牙、控制指令、曲线上传或保活心跳。

## 自动化与构建

| 检查                      | 结果                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| 当前工作区网页测试        | 29 文件、510 项通过                                                                        |
| 隔离发布副本测试          | 23 文件、486 项通过；只合入本轮连接改动                                                    |
| TypeScript / Vue 类型检查 | 通过                                                                                       |
| 发布构建                  | 官方 Sites 构建流程执行 vue-tsc 与 Vite，成功；静态 JS 194.69kB，gzip72.31kB               |
| 固件原生测试              | 13 个 C++ 套件分别在两种模式执行，共26次；22项 Python 测试及配网页 JavaScript 检查通过     |
| C++ → TypeScript 协议集成 | 7项通过，使用真实固件状态编码、BLE编码器、网页重组器及状态校验器                           |
| ESP32-S3 SDK              | LOCKED、VIRTUAL_DEMO、network compilecheck 三种构建通过，最终编译输入哈希与源码匹配        |
| 栈帧预算                  | 三种构建最大应用函数栈帧1632字节，低于2048字节预算；BLE tick336、初始化128、发送事件96字节 |
| 固件产物                  | collect-only成功；30条 SHA256SUMS 全部通过                                                 |
| 开发服务监听              | 排除固件缓存和发布副本，实际监听目录检查未发现被排除路径；本地页面重新加载成功             |

LOCKED、DEMO、compilecheck 的程序大小分别为1,334,263、1,341,431、1,339,971字节；静态 RAM 均为93,920字节。发布构建沿用 N16R8 参考设置，不代表已确认实体板的全部电气参数。

关键日志在本地 `firmware/.tools/ble-final-web-test.log`、`ble-native-final.log`、`ble-<environment>-build.log`、`ble-<environment>-stack.json`、`ble-final-provenance.json`、`ble-collect.log`；发布副本测试日志在 `.sites-runtime/ble-publish-tests.log`。

## 审查与回归

- 先观察失败，再修复跨网页客户端取消/重连的迟到 GATT 连接：旧请求不能断开新连接；全部释放后也不会遗留连接。
- 修复固件异步回执时间领先造成的无符号时间差回绕，保持至少5ms的分片发送间隔。
- 修复 NPL 事件早于 BLE 栈初始化的问题；实际适配器在 SDK 边界替身下的回归测试覆盖启动顺序、订阅、单客户端限制、队列失效、拥塞重试、过期断连、重新连接及 MTU23/247。
- 独立代码审查确认上述问题已解决，无剩余实质发现。硬件共存表现不能由代码审查推断。

## 浏览器检查

Windows Chrome 的 `http://localhost:5173` 已检查连接弹窗、三种传输切换、BLE 无 IP 输入、明确点击选择设备，以及“蓝牙已就绪”能力提示。375×812窄屏检查通过，能够滚动并使用连接入口；这不是手机实机测试。没有点击系统设备选择器连接任何未知设备。

截图保存在本地 `.sites-runtime/qa/ble-localhost-desktop-2026-10-30.jpg` 与 `ble-localhost-mobile-2026-10-30.jpg`。线上 HTTPS 版本已在 Chrome 刷新并检查：BLE 选项、选择设备按钮、“蓝牙已就绪”提示及 Artisan 保留 Wi-Fi 说明均正确；截图为 `.sites-runtime/qa/ble-published-2026-10-30.jpg`。

## 发布记录

- URL：<https://coffee-workbench.example>
- 现有站点保持 owner-private 访问范围，未扩大共享。
- 源码提交：`6e64499ba39d04239fddbaaf55659e6e794b1325`
- 部署：`[deployment-id-redacted]`，状态 `succeeded`。
- 保存版本：`[deployment-id-redacted]~appgver_1a6bfc85a19c8191a22cff6c3dc1e2ff`。
- 发布完成时间：2026-10-30 00:55（Asia/Shanghai）。本节及最终计划勾选为发布后本地验收记录，不触发重复部署。

## 固件包

本地包：`.sites-runtime/releases/coffee-workbench-esp32s3-ble-2026-10-30.zip`（16,513,245字节）。保留此前仅 HTTP 更新的旧包，使用不同文件名。

- ZIP SHA256：`65b247f50a4be2fb883b29ed2736ab732d44ea67fe1b0942550b9cc3317f0b56`
- 固件源码快照 SHA256：`ebab4160f49f76cb9bdf9e9d4080dc2c5b4ed60f103094f2a9ca118e13797256`
- 包内 `firmware/artifacts/manifest.json` 标明 BLE UUID、只读属性、源码溯源和未实机验证状态；`SHA256SUMS` 可复核产物。

## 验证边界

没有烧录或连接实体开发板，没有验证手机蓝牙、射频距离、Wi-Fi/BLE 长时间共存、SoftAP 配网同时连接 BLE 或真实 Artisan 桌面通信。普通局域网 HTTP 不满足 Web Bluetooth 安全上下文要求；应使用 HTTPS 或本机 localhost。Safari / iOS / iPadOS / Firefox 使用原有 Wi-Fi 路径，详见[蓝牙使用说明](bluetooth-connection.md)。

所有遥测仍与网页本地仿真分离，参考固件没有物理执行器绑定；本次不构成实际烘焙控制验证。

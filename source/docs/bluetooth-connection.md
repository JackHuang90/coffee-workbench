# 网页蓝牙直连

网页可选择 Wi-Fi 或 BLE 蓝牙读取 ESP32-S3 状态。蓝牙不需要 Node、桥接程序、路由器或设备 IP，也不需要先完成 Wi-Fi 配网。Artisan 继续使用已有 Wi-Fi / Modbus TCP 连接；本次没有新增 Artisan 蓝牙。

## 使用步骤

1. 安装含 BLE 功能的新版参考固件。旧的仅 Wi-Fi 固件不会出现在本项目蓝牙设备列表中。
2. 在支持 Web Bluetooth 的浏览器中打开工作台的 HTTPS 地址。开发电脑也可使用 `http://localhost:5173`。
3. 打开“连接 ESP32”，选择“蓝牙直连”，再点击选择设备按钮。在浏览器弹出的列表中选择自己的 `Coffee-…` 设备。
4. 收到第一份完整有效状态后才显示已连接。这里读取的温度、模式和控制归属与 Wi-Fi 使用同一套数据定义，LOCKED 的无效温度不会变为0，VIRTUAL_DEMO 仍是虚拟数据。
5. 切换连接方式、断开、关闭或隐藏页面都会清除当前遥测并断开蓝牙。失败后需要手动重连；关闭连接弹窗本身不会停止前台读取。

## 支持范围

| 使用环境                                       | 网页 BLE                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| Windows / macOS 的 Chrome、Edge                | 浏览器提供 Web Bluetooth 且蓝牙可用时支持           |
| Android Chrome                                 | 浏览器提供 Web Bluetooth 且蓝牙可用时支持           |
| iPhone / iPad Safari、桌面 Safari、Firefox     | 不支持；使用原有 Wi-Fi 方式                         |
| 普通内网 HTTP，例如 `http://192.168.1.10:5173` | Wi-Fi 方式可以尝试；BLE 需要 HTTPS 或本机 localhost |
| 微信等内置浏览器                               | 不保证；用支持的完整浏览器打开                      |

浏览器可能因操作系统权限、企业策略或页面权限策略禁用蓝牙，网页会显示当前能力或连接错误。手机打开电脑的开发页时，不能用 `localhost` 代替电脑 IP；它指的是手机自己。需要蓝牙时可直接打开已发布的 HTTPS 站点。

设备选择是浏览器授权，与 Wi-Fi 的“允许的网站”列表不同。BLE 不携带 HTTP 网站来源，因此不受该列表控制；本服务只提供原有状态，不公开配网密码，也没有控制命令特征。不要把设备名称或浏览器授权当作设备身份认证。

## Wi-Fi、蓝牙与 Artisan

同一台设备的 Wi-Fi 和 BLE 可以共同提供只读状态；BLE 只接受一个客户端，不能保证两个浏览器同时占用它。网页不会给 Artisan 的控制会话续期，也不会抢占其控制权。Artisan 配置仍见 [Artisan Wi-Fi 设置](../firmware/docs/artisan.md)。

两种连接在不同时间采样时，数字可能略有时间差；蓝牙不会另做温度平滑或修改单位。丢失片段、格式错误、设备重启、组帧超时或连续3秒没有完整新样本都会清空显示。Wi-Fi 配网扫描和热点流量会与 BLE 共享射频资源，实际共存表现需要板上验证；RGB 仍表示原有网络状态，不是蓝牙或温度有效性指示。

## 当前验证边界

本次验证覆盖协议编解码、网页生命周期、源码编译和浏览器界面。尚未对实体开发板、手机蓝牙、射频距离或长时间同时使用 Wi-Fi/BLE 做测试；也没有新增真实传感器或执行器接线。不能把连接功能完成等同于实际烘焙设备已经可用。

## 参考

- [Chrome Web Bluetooth 文档](https://developer.chrome.com/docs/capabilities/bluetooth)：安全上下文、用户点击与 GATT 通信。
- [浏览器兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Bluetooth.json)：Safari / Firefox 支持状态。
- [Espressif 共存说明](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/coexist.html)：STA 与 SoftAP 下的 Wi-Fi/BLE 差异。

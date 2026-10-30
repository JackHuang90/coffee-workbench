# 网页 BLE 只读连接设计

用户已将范围明确为：蓝牙只支持网页，Artisan 继续使用 Wi-Fi，不增加 Artisan 蓝牙、小工具或定制版。沿用网页现有只读功能与固件 LOCKED / VIRTUAL_DEMO 边界。

## 方案与范围

网页使用浏览器 Web Bluetooth 直接连接 ESP32-S3 的自定义 GATT 服务，无需 Node、桥接软件、路由器或设备 IP。Wi-Fi HTTP 与 BLE 通知从同一个 Controller 状态生成相同 v1 JSON，网页复用现有状态校验和展示。Artisan 的 Modbus TCP、寄存器映射和授权逻辑不变。

已讨论并排除 Artisan BLE 辅助工具及定制驱动，用户明确不要 Artisan 蓝牙。也不模拟其他品牌设备。新增蓝牙适配层不授予控制权、不上传曲线、不续期、不执行 HTTP/USB 命令。

## 浏览器与用户流程

- 保持现有默认 Wi-Fi / 本地桥接选择，新增“蓝牙直连”。进入页面、切换方式和打开弹窗均不扫描、不连接设备。
- 用户点击“选择蓝牙设备”才同步调用 requestDevice，过滤本项目服务；选择后订阅通知，完整校验第一份状态后才显示已连接。
- 蓝牙无需 IP 输入，不显示 Wi-Fi 网站来源配置；说明 HTTPS / localhost 要求与设备固件要求。不支持时给出 Wi-Fi 替代入口。
- Windows/macOS Chrome、Edge、Android Chrome 以运行时能力检测为准。Safari/iOS/iPadOS 与 Firefox 不承诺 Web Bluetooth。普通内网 HTTP 不能因 Wi-Fi 来源已放行而获得蓝牙能力。
- 点击取消、切换方式、页面隐藏或卸载时断开、移除监听并清空数据。迟到的选择器结果、连接结果和通知不能复活旧连接。失败不自动重连。
- 选择器等待最多60秒，后续 GATT 建连/首帧最多15秒；已连接连续3秒无完整新样本即清空并断开。接收进度和设备 uptime 均需前进；设备重启需要手动重连。

## 固定传输约定

- Service UUID: `b4e7a001-9d56-4f1b-a6e0-7d31c2f84590`。
- 状态 NOTIFY characteristic: `b4e7a002-9d56-4f1b-a6e0-7d31c2f84590`，只有通知与订阅描述符，无控制写入特征。
- 设备名称 `Coffee-` 加设备标识后缀。默认支持一个 BLE 客户端；Wi-Fi 与 BLE 可共存。多 BLE 中央设备同时连接不在本次范围。
- 每个通知8字节头：byte0=0x52，byte1=1；byte2..3为LE uint16消息序号；byte4..5为LE uint16总长度；byte6..7为LE uint16偏移；后续为JSON原始UTF-8字节。
- 完整JSON长度1..1023字节；通知长度9..244字节且不得超当前ATT MTU减3；支持最小MTU23。序号可回绕；同一消息只能接受连续偏移、相同序号与长度，不能混接片段。
- 帧内超时2秒、总长度/通知长度越界、重复/乱序/截断、错误版本、UTF-8/JSON/协议校验失败均清空并断开。订阅开始可能遇到半帧：在首个offset0之前忽略有界合法片段，仍受首帧超时约束；组装开始后不得跳过缺片。
- 固件每秒最多开始一份新快照；一次快照发送途中保持内容不变；每次调度只发送一个有界通知，最小间隔5ms，不能阻塞控制循环。
- BLE回调只维护连接/订阅状态；Controller只由主循环访问。读取不调用控制保活或transportLost；BLE断开不会停止其他通道所有者。
- BLE不依赖Wi-Fi已配网，首次启动也可选设备。配网热点与BLE同开保留有界调度；官方标注SoftAP连接共存性能有局限，需实机测试，不能宣称已验证。不得仅因尚未配网而关闭蓝牙。

## 连接授权与数据语义

BLE由浏览器设备选择授权，不携带HTTP Origin；Wi-Fi允许网站列表不作用于BLE。服务仅公开当前既有只读状态，不包含路由器密码、热点密码或其他秘密。不能把浏览器设备权限当作固件身份认证。

保留v1原始温度、单位、有效性、虚拟标记、session与uptime。BLE不重新计算温度或RoR，不更改Artisan采样/温度解码；两种网页方式采用同一展示语义。模拟数据仍明确标记；尚无物理传感器/执行器绑定。

## 验证和交付

先添加失败测试，覆盖真实编解码、最小MTU、多片、坏帧、消息边界、超时、取消竞态、设备重启与未授权自动连接；C++生产编码器输出须由TS生产解码器消费一次。完整网页测试/构建、固件原生测试、三环境SDK构建和栈检查。Chrome验证蓝牙入口与不支持情形，不未经选择连接未知蓝牙设备。

更新固件、使用文档与现有私有Site，保留并排除并行风味/导入改动。没有板子联调的情况下，只报告代码、构建与界面验证，不能声称射频、手机或真实烘焙已验证。

## 依据（2026-10-30查阅）

- [ESP32-S3只支持BLE](https://docs.espressif.com/projects/esp-idf/en/v5.2/esp32s3/api-guides/bluetooth.html)
- [ESP32-S3 Wi-Fi/BLE共存及SoftAP限制](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/coexist.html)
- [Chrome Web Bluetooth安全上下文与用户手势](https://developer.chrome.com/docs/capabilities/bluetooth)
- [浏览器兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Bluetooth.json)
- [Artisan Modbus](https://artisan-scope.org/devices/modbus/)

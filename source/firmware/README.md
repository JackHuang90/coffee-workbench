# Roast Studio · ESP32-S3 固件（全新重建）

**这不是可直接接电加热的烘焙机固件。** 已实现并编译设备本地曲线/PID/协议软件，但实际载板、传感器接线、SSR/模拟输出、独立过温/风量/断电保护尚未核验。两种交付镜像都没有物理执行器绑定，不能通过命令解锁。

| 镜像              | 温度来源                         | 允许操作                                        | 真实加热/风机 |
| ----------------- | -------------------------------- | ----------------------------------------------- | ------------- |
| `s3_locked`       | 无，显示 `null`                  | 查看状态                                        | 永远禁用      |
| `s3_virtual_demo` | 明示 `VIRTUAL_DEMO` 的虚拟热模型 | 曲线上传/本地跟踪；USB显式授权的Artisan虚拟控制 | 永远禁用      |

## 已实现

- 同一 C++17 核心运行于原生测试和真实 ESP32-S3 SDK 构建：固定容量曲线上传、校验/hash、原子提交、本地单调时钟、插值与限幅/抗积分饱和 PID。
- 显式 ARM/START、暂停、手动接管、STOP、传感器新鲜度、控制租约、调度间断故障、重启不自动启动。手动接管后必须 STOP 才能重新自动控制。
- USB有界文本协议；默认开启首次热点配网，支持 DHCP/固定 IPv4、持久重连、BOOT 长按恢复和 RGB 状态。HTTP 状态及 Artisan 归一化 Modbus TCP（IP/port502/unit1）沿用现有软件安全边界。路由器密码无需编译进固件。
- 网站来源可显式配置 HTTPS 或本机/私有 IPv4 的 HTTP（如 `http://localhost:5173`）；只读状态按协议、主机和端口精确匹配，不自动允许其他内网页面。
- 网页可通过 Web Bluetooth 直接订阅相同只读状态，无需先配 Wi-Fi 或填写 IP；设备名为 `Coffee-` 加标识后缀。使用 SDK 自带 NimBLE，单个 BLE 客户端；Artisan 继续使用 Wi-Fi Modbus TCP。浏览器须支持 Web Bluetooth，并从 HTTPS 或 localhost 页面由用户点击选择设备，详见[网页蓝牙连接](../docs/bluetooth-connection.md)。
- Artisan虚拟POWER/SV两种互斥模式：只能由本地USB授权，固定5分钟；5秒内无有效控制写入就归零并撤销。Artisan和固件不会同时运行同一个加热PID。
- 现有网页 v1/v2 曲线JSON的**离线**转换工具；不自动发送、不自动启动、不把导入文件当代码。原生端到端测试使用真实网页导出样例。
- 参数化只读Modbus RTU采集模块和假数据流测试，但**没有绑定RS485/UART或猜测仪表寄存器**。

## 从哪里开始

2026-10-31 新增：网页蓝牙配网（扫描→测试→保存，设备短按 BOOT 确认）、独立加密配网通道，以及启动/网络/蓝牙/曲线传输/虚拟温控 RGB 灯态。需同步更新网页和固件，见[网页操作](../docs/bluetooth-connection.md)与[灯态表](docs/provisioning.md#恢复配网和灯态)。

1. [首次配网和恢复](docs/provisioning.md)：设备热点、允许的网站、BOOT 与 RGB 说明。
2. [构建、校验与有条件烧录说明](docs/build-and-flash.md)：先确认真实载板，不要将application.bin当作0地址全量固件。
3. [协议与状态机](docs/protocol.md)：USB `HELLO`/`STATUS`，本地控制时序、owner及超时；ACK不是物理动作确认。
4. [Artisan IP/端口与虚拟控制](docs/artisan.md)：ET/BT地址、signed/scaling及虚拟写寄存器。实际Artisan桌面/ESP联网尚未实测。
5. [网页曲线离线转换](docs/curve-import.md)：先确认CHARGE/时间原点，再生成有界目标。设备固件不直接解析原始`.alog`。
6. [硬件资格核验清单](docs/hardware-qualification.md)：真实闭环烘焙尚未完成的必要条件。

## 测试

```sh
./tools/test_native.sh
# Windows 或其他平台（设置 CXX 指向 C++17 编译器）
python tools/test_native.py
ASAN_OPTIONS=detect_leaks=0 SANITIZE=1 ./tools/test_native.sh
```

最后一条启用 AddressSanitizer/UndefinedBehaviorSanitizer，需支持它们的工具链；本次 Windows 验证未运行 sanitizer。Native测试不是硬件在环测试。源码及Git历史由主交付包一并保存；`.tools`和编译缓存不属于源码。

**尚未验证：** 实际载板启动、USB枚举、物理Wi-Fi、Artisan桌面联机、真实温度/加热/风机、继电器粘连、传感器断线和电源失效下的硬件安全。不能用编译成功替代这些验证。公网 HTTPS 网页的直接连接受浏览器局域网授权、托管策略和设备来源设置共同限制；保留本地桥接兼容方式，不关闭浏览器安全限制。

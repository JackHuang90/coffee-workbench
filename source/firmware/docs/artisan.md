# Artisan 通过 IP / 端口连接 ESP32-S3（本次仅虚拟验证）

**可以实现的部分：** 固件包含真正的 Modbus TCP 服务，支持 BT/ET 读取、状态读取，以及经本地 USB 明确授权后的**虚拟火力、虚拟风量或虚拟 SV**控制。相同 C++ 控制器和协议已通过真实 localhost TCP socket 测试。

**没有验证的部分：** 尚未在用户的 ESP32-S3 板、Wi-Fi 网络或实际 Artisan GUI 上运行。LOCKED 固件没有物理温度数据；VIRTUAL_DEMO 的全部温度与输出都是软件模型。两种固件都没有实际加热器、风机、DAC、SSR 或仪表写入绑定，不能用于真实烘焙。这里的寄存器是本项目自定义映射，**不是台泉 TC4S 或欧姆龙 E5CC 的寄存器表**。

## 1. 先启用自己的 Wi-Fi 配置

当前源码构建默认启用首次热点配网；没有路由器凭据时开启设备独立 WPA2 热点。旧发布物仍应按其对应说明使用。验证当前参考板网络功能时：

1. 按构建文档确认实际板型、16 MB flash / OPI PSRAM；独立断开负载。本任务没有执行刷机。
2. 按 [首次配网](provisioning.md) 连接设备热点。热点凭据见设备标签；开发板可通过本地 USB `SETUP` 查询。填入 Wi-Fi 和 DHCP/固定地址，先测试再保存，无需编译凭据。
3. 虚拟 Artisan 控制必须使用 `s3_virtual_demo`，且仍需下述显式 USB 授权。普通状态读取和 Modbus 不需要 HTTP bearer token。
4. 电脑和 ESP 在允许互访的受信任局域网。使用配网完成页、路由器列表或 USB `NETWORK` 的实际设备 IP。
5. TCP 服务端口 **502**，unit/device/slave ID **1**。没有 TLS 或 Modbus 口令，不做公网端口转发。

USB 基线一直可用：115200 的 CDC 文本会话中 `HELLO` / `STATUS` 只读查看状态。USB 使用本项目 ASCII 命令，**不是 Modbus RTU 或 Artisan TC4 串口仿真**。

## 2. Artisan 的温度通道设置

在 Artisan 的设备设置中选择 **MODBUS**，连接方式选 **TCP**。填写实际 ESP IP、port `502`、device/slave ID `1`。官方支持 TCP、FC03、单寄存器有符号 `sInt16` 与 1/10 除数；参考 [Artisan MODBUS 设备文档](https://artisan-scope.org/devices/modbus/)。

| Artisan 主通道     | Device / slave ID | Function | Register（零基址） | Decoder              | Divider  | Unit |
| ------------------ | ----------------: | -------: | -----------------: | -------------------- | -------- | ---- |
| Input 1：ET 环境温 |                 1 |        3 |              **1** | sInt16（1 register） | **1/10** | C    |
| Input 2：BT 豆温   |                 1 |        3 |              **0** | sInt16（1 register） | **1/10** | C    |

不要把 BT 填成 `1` 或 `400001`：Artisan 的 Register 栏使用零基地址；官方帮助将 register 0 对应 conventional number 400001。[官方 Modbus 帮助（v4.2.0）](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/doc/help_dialogs/Output_html/modbus_help.html)。主输入顺序 ET→BT 已对照 [官方 comm.py（v4.2.0）](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/src/artisanlib/comm.py) 的 `readMODBUS` 路径。

LOCKED 模式读取 BT/ET 返回 Modbus exception `04`，不会伪造 0°C。VIRTUAL_DEMO 模式读取模型温度，status 寄存器 4 的 bit 15 永远为 1。**Artisan 通道名/配置文件请标注“虚拟演示”，不要保存成真实炉温记录。**

## 3. 只读状态映射（FC03）

一帧最多读 12 个寄存器；地址 0..11。跨越无效温度的读取会整体返回 exception 04；例如 LOCKED 下可单独读 4..11，但不要把 0..11 一起当作必定有效。

|  地址 | 内容                      | 单位/编码                                                                                                               |
| ----: | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0 / 1 | BT / ET                   | signed int16，0.1°C                                                                                                     |
|     2 | 当前目标 BT / SV          | signed int16，0.1°C；无目标则 exception 04                                                                              |
|     3 | 虚拟火力请求              | 0..1000，除以 10 得 %                                                                                                   |
|     4 | 状态位                    | bit0 有效新鲜传感器；bit1 活动控制；bit2 故障；bit3 物理锁定（始终为1）；bit15 虚拟演示                                 |
|     5 | 软件状态                  | 0 LOCKED，1 IDLE，2 READY，3 ARMED，4 RUNNING，5 PAUSED，6 MANUAL，7 COMPLETED，8 FAULT，9 ARTISAN_POWER，10 ARTISAN_SV |
| 6 / 7 | 曲线经过秒数 / 协议版本   | uint16；版本=1                                                                                                          |
|     8 | 虚拟风量请求              | 0..1000，除以 10 得 %                                                                                                   |
|     9 | 当前控制权                | 0 无，1 USB，2 HTTP，3 Artisan Power，4 Artisan SV                                                                      |
|    10 | 控制模式                  | 0 设备曲线，1 Artisan Power，2 Artisan SV                                                                               |
|    11 | 本次 Artisan 授权剩余秒数 | 向下取整；固定最多 300 秒，写入不会延长                                                                                 |

请求百分比及 Modbus FC06 回显仅代表**软件接受请求**，不是执行器反馈。真实输出反馈不可用；HTTP/USB 状态明确为 `physical_actual_pct:null`、`physical_enabled:false`。

## 4. 本地 USB 明确授权后，短时验证虚拟控制

默认没有 Artisan 控制权，Modbus 自身不能启动或授权。先用 USB `HELLO` 读出 session、`last_seq`、`uptime_ms`，随后发一条经过核实的 R1 命令：

```text
R1 <session> <新的递增seq> <当前uptime_ms加不超过5000> ARTISAN_POWER
```

或者选择 **`ARTISAN_SV`**，二者只能选一个。尖括号是待填写字段，不是可直接粘贴的值；每次重启 session 改变。必须检查返回 `ok:true` 和状态/owner，再允许 Artisan 的虚拟写入。HTTP 不能授予 Artisan 权限。已有控制权冲突时先 STOP，不能偷偷抢占。

- `ARTISAN_POWER`：Artisan 请求虚拟火力/风量；设备本地 PID 不参与火力计算。
- `ARTISAN_SV`：Artisan只设置 SV/风量，由 ESP 的**单个演示 PID**计算虚拟火力；不要同时启用 Artisan 自身的加热功率 PID。
- 两种模式均为固定 **5 分钟授权**，且最后一次成功写入/心跳后最多 **5 秒**。只读温度不会续期；到期本地故障、火力/风量请求归零、释放控制权，需要再次本地明确授权，绝不自动重启。

### FC06 写寄存器

| 地址 | 值                                        | 允许的模式                                                |
| ---: | ----------------------------------------- | --------------------------------------------------------- |
|  100 | `0` STOP，停止并释放控制权                | DEMO；传感器故障原因仍存在时保留故障锁存并回 exception 04 |
|  101 | signed deci-°C，-200..2800，即 -20..280°C | Artisan SV                                                |
|  102 | `0..1000` 虚拟火力请求                    | Artisan Power                                             |
|  103 | `0..1000` 虚拟风量请求                    | 两种 Artisan 模式                                         |
|  104 | `1` 心跳                                  | 两种 Artisan 模式                                         |

无授权、错模式、过期、LOCKED 等返回 exception 04；非法值 exception 03；未知地址 exception 02。没有 GPIO、任意仪表寄存器、物理 SV、PID 参数或远程解锁寄存器。

### Artisan 按钮/滑块示例（虚拟）

按钮 Action 选择 **MODBUS Command**，例如：

```text
writeSingle(1,102,500)   # 虚拟火力 50%，仅 Power
writeSingle(1,103,300)   # 虚拟风量 30%
writeSingle(1,101,1800)  # 虚拟 SV 180°C，仅 SV
writeSingle(1,104,1)    # 一次心跳
writeSingle(1,100,0)    # 停止
```

以上每行的 `#` 注释仅为说明，**不要粘贴注释到 Artisan 命令栏**。滑块可设范围 `0..100`、Factor `10`、Offset `0`，火力 Action 为 `writeSingle(1,102,{})`，风量为 `writeSingle(1,103,{})`。`{}` 由 Artisan 用滑块值×Factor+Offset 替换后转为整数；这是官方文档语法，不是本项目执行任意代码。[官方滑块帮助](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/doc/help_dialogs/Output_html/eventsliders_help.html)、[官方按钮帮助](https://github.com/artisan-roaster-scope/artisan/blob/v4.2.0/doc/help_dialogs/Output_html/eventbuttons_help.html)。

**连续心跳的重要限制：** 尚未确认并实测 Artisan GUI 中可靠的通用周期 Modbus 心跳配置。上述按钮/滑块用于短时虚拟联调，不代表已经打通无人值守连续控制。手动心跳按钮不是完整方案；也不要另起一个脱离 Artisan 的常驻保活程序掩盖 Artisan 已关闭/冻结。设备会按 5 秒规则归零，后续需要验证真正与控制会话存活绑定的客户端，再讨论实机。

## 5. 已验证什么、如何复测

运行 `python3 firmware/tests/test_modbus_socket.py`（仓库根目录）会编译 LOCKED / DEMO 原生测试程序，监听 **127.0.0.1 的操作系统分配端口**。Python 客户端通过真实 socket/IP/port 发送 Modbus，服务端链接生产 `core.cpp`、`protocol.cpp`、`modbus.cpp`，不是另一份 JS 模型。测试涵盖：BT/ET/状态、明确 USB 授权、虚拟火力/风量、SV 与 Power 互斥、STOP、无授权拒绝、边界值、分片/连续帧、坏帧/超时，以及持续读温度仍不能阻止 5 秒失联归零。

这些证据证明**软件协议与控制器的原生集成**，不等于 ESP Wi-Fi 射频、USB枚举、Artisan GUI 配置、外部温控仪或实际负载已验证。Artisan 官方设置资料查阅于 2026-10-28，固定参考 v4.2.0；界面随版本可能不同。

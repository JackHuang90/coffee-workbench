# 构建、镜像校验与刷机说明

## 镜像用途

这是重新构建的参考固件。`s3_locked` 固定处于 LOCKED 状态，温度无有效来源、物理输出禁用；`s3_virtual_demo` 使用明确标示的虚拟热模型，可验证本地曲线与虚拟温控。两种镜像都没有绑定真实加热器、风机、DAC、SSR 或 RS485。

参考板型为 ESP32-S3-DevKitC-1，配置 16 MB Flash、8 MB 八线 PSRAM（`qio_opi`）、BOOT GPIO0 和 GPIO48 WS2812。用户提供的图片含不同内存型号示例，实际模组、载板、USB、引脚和颜色顺序仍需核对。N16R8 仅表示内存规格。本次仅生成和检查文件，没有连接开发板或执行刷机。

## 构建方法

Linux/macOS 在 `firmware` 目录中使用独立工具环境，安装官方已发布且正常校验的包：

```sh
mkdir -p .tools/tmp .tools/cache/pip .tools/pio
python3 -m venv .tools/venv
TMPDIR="$PWD/.tools/tmp" PIP_CACHE_DIR="$PWD/.tools/cache/pip" \
  .tools/venv/bin/python -m pip install platformio==6.2.0
TMPDIR="$PWD/.tools/tmp" PLATFORMIO_CORE_DIR="$PWD/.tools/pio" \
  .tools/venv/bin/pio run -e s3_locked -e s3_virtual_demo -e s3_network_compilecheck
.tools/venv/bin/python tools/build_release.py
```

本机 Windows 工具已放在 `D:\SDK\esp32_opt`。从仓库根目录执行：

```powershell
. ./toolchain.local/Activate.ps1
Set-Location ./source/firmware
pio run -e s3_locked -e s3_virtual_demo -e s3_network_compilecheck
python tools/test_native.py
$env:ROAST_TOOLS_DIR = 'D:\SDK\esp32_opt'
python tools/build_release.py --collect-only
```

`--collect-only` 仅收集已成功构建的镜像，仍会检查源码与构建输入一致性。没有该参数时，发布工具先清理并重新构建三个环境。`ROAST_TOOLS_DIR` 用于指定外部工具目录；未设置时使用项目内 `.tools`。

`platformio.ini` 固定 PlatformIO Espressif32 8.0.0、Arduino 3.3.12 和 GCC 等包版本。清单记录实际框架、编译器、参数、源码摘要及 Git 版本和工作区状态。不同主机或编译时间不保证生成逐字节一致的文件。`s3_network_compilecheck` 用于验证关闭 RGB 的构建，不作为发布镜像。

发布收集拒绝 `include/local_config.h` 与内嵌 Wi-Fi 凭据定义。网站来源由用户配网时明确设置。参考来源：[PlatformIO 发布说明](https://github.com/platformio/platform-espressif32/releases)、[官方开发板说明](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/hw-reference/esp32s3/user-guide-devkitc-1.html)、[esptool 命令](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html)。

## 刷机前校验

`artifacts` 内的 `SHA256SUMS` 覆盖发布文件，可用以下命令核验：

```sh
sha256sum -c SHA256SUMS
```

每种镜像单独包含 `application.bin`、`application.elf`、`bootloader.bin`、`partitions.bin`、SDK 所需的启动初始化文件、`reference-merged.bin`、`flash-map.json`、构建元数据、镜像检查日志及栈审计结果。顶层清单记录文件大小、SHA256 和源码快照摘要。

**`application.bin` 是应用分区镜像，不能写到地址 0。** 实际偏移以该目录的 `flash-map.json` 为准，不能从其他 ESP32 型号推断。

## 刷机参考步骤

先确认具体模组、内存和 USB 配置，并备份设备已有固件与校准数据。软件台架检查时断开执行器和高压供电。选用同一目录中的整套文件；首次检查可选 `s3_locked`，需要虚拟数据时选 `s3_virtual_demo`，不要混用两种构建的文件。

本参考配置实际评估的偏移为启动加载器 `0x0`、分区表 `0x8000`、启动初始化 `0xe000`、应用 `0x10000`，仍应先核对当前文件映射。应用使用 QIO 配置，但启动镜像头为 DIO，保留评估得到的 `image_flash_mode=dio`。

以下命令仅供用户核对后执行，未替用户运行；将端口替换成已确认的开发板端口，并使用实际安装的 esptool 路径：

```sh
esptool --chip esp32s3 --port YOUR_CONFIRMED_PORT --baud 460800 \
  write-flash --flash-mode dio --flash-freq 80m --flash-size 16MB \
  0x0 artifacts/s3_locked/bootloader.bin \
  0x8000 artifacts/s3_locked/partitions.bin \
  0xe000 artifacts/s3_locked/boot_app0.bin \
  0x10000 artifacts/s3_locked/application.bin
```

对于分区表未改变、且已经安装同一项目旧版固件的设备，可按当前 `flash-map.json` 仅更新应用分区，保留已保存的网络和热点身份；执行前仍需核对实际布局并备份。

`reference-merged.bin` 是从 `0x0` 起的离线合并镜像。合并文件的填充区域可能覆盖 NVS 等数据，因此优先采用上面的独立分区文件。不要因方便就擦除整片 Flash。现有安全启动或加密设备需要原有签名/配网流程，这些未签名参考文件不适用。

## USB、热点与蓝牙配网

USB 使用 ESP32-S3 原生 USB CDC，波特率 115200。`HELLO`、`STATUS` 保留 v1 协议；`NETWORK` 查询连接和地址，不含密码。显式本地 `SETUP` 查询返回设备热点名、密码、活动标记和实际配网页地址，可用于给开发板准备标签或二维码，不会打印路由器密码。

无有效配置时开启设备专属 WPA2 热点。也可直接用新版网页蓝牙配网：选择 `Coffee-…` → Wi-Fi 设置 → 请求授权 → 在设备旁短按 BOOT → 扫描或填写网络 → 测试 → 保存。需要同步更新网页和固件。支持 DHCP、固定 IPv4 和明确的网站来源；网络存于 `coffee-net`，热点身份存于 `coffee-id`，恢复不会清空其他 NVS 数据。详见[配网与灯态](provisioning.md)和[网页蓝牙说明](../../docs/bluetooth-connection.md)。

蓝牙使用固定 Arduino SDK 自带的 NimBLE，无需额外蓝牙包。遥测特征仍只发送状态，新增独立配网特征要求加密写入和 120 秒现场 BOOT 授权。Just Works 配对保护传输但不验证设备身份。通知发送前检查加密和连接代际；密码不回显、不进入浏览器存储或日志；构建拒绝可能打印特征内容的 VERBOSE 日志级别。Artisan 继续使用 Wi-Fi/Modbus TCP 和原有授权。

默认灯为 GPIO48、GRB、亮度 12/255，各通道硬上限 32；可通过 `ROAST_BOOT_PIN`、`ROAST_RGB_PIN`、`ROAST_RGB_ORDER`、`ROAST_RGB_BRIGHTNESS` 覆盖，或用 `ROAST_RGB_ENABLE=0` 关闭灯。RESET/EN 普通重启保留配置。BOOT 只有在启动后稳定释放，再按住五秒并松开时才恢复网络；短按用于网页发起的配网确认。不要在上电时按住 BOOT 进入配网。

HTTP 状态查询只允许明确保存的 HTTPS 或受限本机/内网 HTTP 来源，协议、主机和端口精确匹配。网站许可不授予控制权。温控 POST 继续拒绝带 Origin 的请求，且要求至少 16 字符的显式 `ROAST_HTTP_TOKEN`；默认空值关闭 HTTP 控制。Modbus 虚拟控制仍需 USB 授权和有效租约。修改网络或恢复配网会撤销现有控制会话。

主循环优先运行控制 tick；网络和蓝牙任务分步有界执行，扫描异步，测试最长 30 秒，日常重连退避最多 30 秒且不自动开放热点。Wi-Fi、NVS 和控制状态由主循环修改。SDK 实际调用时长及任务栈余量仍需板上测量。

## 硬件验证与溯源边界

真实烘焙仍需确认载板、仪表和寄存器、独立温度测量、SSR/电流环或 DAC 转换、风机和制动语义、独立过温/风量/断电链、传感器故障及欠压响应、执行器反馈与唯一加热 PID 控制权。这些参考镜像没有授权或启用真实执行器。

任务看门狗初始化或刷新失败时，改变状态的 USB/HTTP 命令返回 `watchdog_unavailable`，控制器保持停止。硬件看门狗时序尚未台架测量。

SDK 预编译库内类似 `arduino-lib-builder` 的应用标签和日期描述的是上游库，不能代表本项目源码版本或构建时间。应以发布清单的 Git 版本、源码和构建输入 SHA256、实际 ELF 摘要、参数及运行时 LOCKED/VIRTUAL_DEMO 标记为准。

发布收集拒绝源码/输入不一致的旧镜像，以及实际 Xtensa 应用对象中超过 2048 字节的单函数栈帧。`stack-audit.json` 来自反汇编结果，不证明完整调用链、SDK/中断用栈或板上测得的最高栈占用。无线配对、Wi-Fi 连接与 RGB 实际颜色仍需实体设备验收。

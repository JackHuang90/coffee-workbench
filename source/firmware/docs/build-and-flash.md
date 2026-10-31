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

Windows 工具目录以下使用 `C:\Tools\esp32` 作为示例，请替换为自己的本地路径；不要将实际工具位置写入公开文档。从仓库根目录执行：

```powershell
$env:ROAST_TOOLS_DIR = 'C:\Tools\esp32'
. ./toolchain.local/Activate.ps1 -ToolsRoot $env:ROAST_TOOLS_DIR
Set-Location ./source/firmware
pio run -e s3_locked -e s3_virtual_demo -e s3_network_compilecheck
python tools/test_native.py
python tools/build_release.py --collect-only
```

`--collect-only` 仅收集已成功构建的镜像，仍会检查源码与构建输入一致性。没有该参数时，发布工具先清理并重新构建三个环境。`ROAST_TOOLS_DIR` 用于指定外部工具目录；未设置时使用项目内 `.tools`。

`platformio.ini` 固定 PlatformIO Espressif32 8.0.0、Arduino 3.3.12 和 GCC 等包版本。清单记录实际框架、编译器、参数、源码摘要及 Git 版本和工作区状态。不同主机或编译时间不保证生成逐字节一致的文件。`s3_network_compilecheck` 用于验证关闭 RGB 的构建，不作为发布镜像。

发布收集拒绝 `include/local_config.h` 与内嵌 Wi-Fi 凭据定义。网站来源由用户配网时明确设置。参考来源：[PlatformIO 发布说明](https://github.com/platformio/platform-espressif32/releases)、[官方开发板说明](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/hw-reference/esp32s3/user-guide-devkitc-1.html)、[esptool 命令](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html)。

## 刷机前校验

GitHub Release 的 `coffee-workbench-firmware.zip` 只包含以下文件，不附带日志、配置、ELF、构建元数据或文档：

```text
SHA256SUMS
s3_locked/
  bootloader.bin
  partitions.bin
  boot_app0.bin
  application.bin
  reference-merged.bin
s3_virtual_demo/
  （与 s3_locked 相同的五个 .bin 文件）
```

在解压目录中执行以下命令，校验包内全部固件文件；Release 附件中的另一份 `SHA256SUMS` 用于校验下载的 ZIP 文件：

```sh
sha256sum -c SHA256SUMS
```

本地构建工具仍会在 `artifacts/` 内生成 ELF、`flash-map.json`、构建元数据、镜像检查日志及栈审计结果，用于内部验证；这些文件不会进入 Release 固件 ZIP。刷机说明保留在源码仓库，Release 提供对应提交版本的文档链接。

**`application.bin` 是应用分区镜像，不能写到地址 0。** 下载包按对应 Release 链接的文档填写地址；本地构建还可用 `flash-map.json` 核对，不能从其他 ESP32 型号推断。下文命令中的 `artifacts/s3_locked/` 指本地构建路径；使用下载包时改为解压目录中的 `s3_locked/`。

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

## 使用网页通过 USB 刷机

无需安装 PlatformIO，也可以用电脑浏览器打开[乐鑫官方 ESP Tool（esptool-js）](https://espressif.github.io/esptool-js/)，选择本地 `.bin` 文件刷入开发板。这里的“在线刷机”是**浏览器通过 USB 串口写入固件**；开发板不需要先连 Wi-Fi，也不是通过本项目的蓝牙配网或 Wi-Fi OTA 更新。当前项目没有提供 OTA 服务。

### 准备固件与连接

1. 打开项目的 [GitHub Releases](https://github.com/JackHuang90/coffee-workbench/releases)，选择需要的构建版本，下载 `coffee-workbench-firmware.zip` 和同一个 Release 的 `SHA256SUMS`；不需要下载前端包或 GitHub 自动生成的源码 ZIP。
2. 核对压缩包的 SHA256 后解压。Windows PowerShell 可运行 `Get-FileHash .\coffee-workbench-firmware.zip -Algorithm SHA256`，将结果与下载的 `SHA256SUMS` 中同名条目比较。Linux/macOS 可按前面的校验方式检查；下载包内部的逐文件校验应在解压根目录中执行，本地构建的完整产物则在 `artifacts/` 目录中校验。
3. 选定解压后的镜像目录：`s3_locked/` 用于锁定状态检查；`s3_virtual_demo/` 用于网页虚拟温控演示。本地构建时，这两个目录位于 `artifacts/` 下。后续全部文件都从同一个目录选择。两者均禁用物理执行器，板型仍须符合前文的 ESP32-S3 / 16 MB Flash / 8 MB OPI PSRAM 参考配置。
4. 使用桌面版 Chrome 或 Edge 和支持数据传输的 USB 线连接开发板。若板上有多个 USB 接口，按载板说明选择支持下载的接口。关闭 PlatformIO 串口监视器、其他串口终端及占用该端口的浏览器标签页。
5. 在 ESP Tool 的 **Program** 区域选择烧录波特率，例如 `460800`；不稳定时改为 `115200`。点击 **Connect**，在系统弹窗中选择开发板对应的串口。常规桌面 USB 串口连接无需勾选 **WebUSB (CH340)**。确认日志识别为 **ESP32-S3**，若型号或 Flash 容量与参考配置不符，应先核对硬件，不能靠改网页选项适配。

若连接一直停在 `Connecting...` 或报 `Failed to connect with the device`，说明尚未完成与芯片下载引导程序的握手，此时还与所选固件文件及烧录地址无关。先尝试手动进入下载模式：

1. 断开网页连接；必要时刷新页面，选择 `115200` 波特率，保持 **WebUSB (CH340)** 未勾选。
2. **按住 BOOT 不松开 → 按一下并松开 RESET/EN → 继续按住 BOOT**。
3. 保持 BOOT 按下，点击网页 **Connect** 并选择对应串口；等日志识别出 `ESP32-S3` 后再松开 BOOT。这可以避免连接期间的自动复位让芯片退出下载模式。
4. 若仍失败，打开 **Show Debug log** 保存完整日志，核对所选 USB 接口及串口。串口已出现并不证明已经与 ESP32 握手成功；例如 `VendorID 0x1a86 ProductID 0x55d3` 表示 WCH USB 转串口通道，不是 ESP32-S3 原生 USB。若板上另有明确标注的原生 USB/OTG 下载接口，可按载板说明换口并重新选择端口，不要凭接口外观判断。

USB 原生下载口可能以新的串口重新出现，需要重新选择。这个操作与运行中长按 BOOT 恢复配网不同。只有供电、没有串口时，先检查数据线、USB 接口，以及该载板 USB 转串口芯片是否需要安装驱动。手动下载模式仍无法握手时，应进一步检查启动日志、端口、供电或驱动，而不是先擦除 Flash。

### 连接成功后的操作（本次用户反馈）

2026-11-01，用户反馈在标注为 **USB/OTG** 的接口上，按住 BOOT 并复位、保持按下直到连接成功后，页面出现以下关键日志（省略设备 MAC）：

```text
Serial port WebSerial VendorID 0x1a86 ProductID 0x55d3
Detecting chip type...
ESP32-S3
Chip is ESP32-S3 (QFN56) (revision v0.2)
Features: Wi-Fi,BLE,Embedded PSRAM 8MB (AP_3v3)
Uploading stub...
Running stub...
Stub running...
Flash ID: 184020
```

这表示芯片已识别，烧录辅助程序已上传并运行，**连接成功，可以松开 BOOT，继续使用当前接口**；此时还不表示固件已写入成功。接口上的 USB/OTG 标注与日志中的 WCH USB 转串口标识分别保留为实物信息，不能仅凭标注认定当前使用的是 ESP32-S3 原生 USB 通道。

接下来体验工作台虚拟温度、曲线和配网功能时：

1. 进入解压后的 **`s3_virtual_demo/`**，四个文件全部从这个目录选择。需要锁定状态检查时改用 `s3_locked/`，不要混用两个目录。
2. 用 **Add File** 添加 `bootloader.bin`、`partitions.bin`、`boot_app0.bin`、`application.bin`，分别填写 `0x0`、`0x8000`、`0xe000`、`0x10000`，详见下表。下载包不附带配置文件，须阅读对应 Release 链接的文档；本地构建还可核对 `flash-map.json`。
3. **Flash Mode / Flash Frequency / Flash Size 全部选 `keep`**，保持已连接的波特率，不勾选 **Erase all**，也不额外添加合并镜像。
4. 点击 **Program**，等待四个文件均写入完成且没有错误；写入期间保持供电，不按 RESET。
5. 完成后点击 **Disconnect**，确认 BOOT 已松开，再按一下 **RESET/EN** 正常启动。
6. 打开你自己部署的咖啡烘焙工作台，通过蓝牙选择 `Coffee-…` 设备，再按需进行 Wi-Fi 扫描、测试和保存；现场授权时按提示短按 BOOT。完整流程见[刷完后怎么连接工作台](#刷完后怎么连接工作台)。

上述用户反馈目前只确认连接与辅助程序启动；尚未反馈四个文件写入完成或实机功能验收。虚拟演示固件的物理加热和风机输出仍禁用。

### 首次安装或写入整套分区文件

已备份旧固件和重要数据、并确认板型后，在 **Program** 区域用 **Add File** 添加文件，填写 **Flash Address**。当前参考布局如下；将来布局有变时以对应 Release 链接的源码版本文档为准，本地构建还可核对所选目录的 `flash-map.json`：

| Flash Address | 同一镜像目录内的文件 | 用途           |
| ------------- | -------------------- | -------------- |
| `0x0`         | `bootloader.bin`     | 启动加载器     |
| `0x8000`      | `partitions.bin`     | 分区表         |
| `0xe000`      | `boot_app0.bin`      | 启动初始化数据 |
| `0x10000`     | `application.bin`    | 应用固件       |

1. 检查每一行的地址与文件，不要上传 `.elf`、ZIP 或 JSON，也不要在这四行之外再添加 `reference-merged.bin`。
2. 当前官方页面的 **Flash Mode**、**Flash Frequency** 和 **Flash Size** 均可选择 `keep`，保留已构建镜像的头部配置。若明确手动填写，则当前参考烧录配置为 `dio`、`80m`、`16MB`。本地构建可核对 `build_metadata.json` 的 `image_flash_mode`、`image_flash_frequency`、`flash_size`；下载包不附带该文件，优先选择 `keep`。不要因 `platformio.ini` 中出现 `qio` 就覆盖启动镜像的 DIO 配置。
3. **不勾选 Erase all，也不点击 Erase Flash**。正常写入仍会擦除所写文件覆盖的 Flash 扇区，但不需要额外擦除整片 Flash；使用上述分区文件不会主动写入 `0x9000–0xdfff` 的 NVS 区域。若旧固件采用其他布局，不能据此保证旧数据仍可使用。
4. 点击 **Program**，保持供电及连接，等待所有文件写入完成、页面不再报告错误；若日志提供哈希验证结果，也应确认通过。
5. 点击 **Disconnect**，确认 BOOT 已松开，再按一下 RESET/EN 或重新上电，从 Flash 正常启动。手动进入下载模式后，尤其需要这一步。

### 已安装本项目时，只更新应用

确认设备已有同一项目固件，且其分区布局与新 Release 一致后，可以只保留一行：**`application.bin` → `0x10000`**。应用地址仍须与对应版本文档一致，保持 `keep`，不勾选 **Erase all**，然后点击 **Program**。这会更新应用而保留其他分区；不能用这种方式首次安装，也不能用它处理分区布局变化。

### 单文件合并镜像的用法

若已备份数据，并接受覆盖合并镜像范围内的原有内容，可只添加一行：**`reference-merged.bin` → `0x0`**，保留镜像头部配置后点击 **Program**。不要同时选择独立分区文件。

即使不勾选 **Erase all**，合并镜像的填充区域仍会覆盖 NVS，可能丢失已保存的 Wi-Fi 配置和设备热点身份；需要保留这些信息时优先使用独立分区文件或仅更新应用。`application.bin` 不是合并镜像，绝不能照此写到 `0x0`。

### 刷完后怎么连接工作台

断开刷机网页的串口连接并重启后，打开你自己部署的咖啡烘焙工作台，按[网页蓝牙配网说明](../../docs/bluetooth-connection.md)选择 `Coffee-…` 设备，再按需扫描、测试和保存 Wi-Fi。授权时按网页提示在设备旁**短按 BOOT**。也可使用设备热点配网页，具体见[配网与灯态](provisioning.md)。

`s3_locked` 不会产生有效温度，`s3_virtual_demo` 提供虚拟温度；看到虚拟曲线不代表真实传感器或加热器已经验证。

你可能还见过 [ESP Web Tools](https://esphome.github.io/esp-web-tools/) 或 ESPHome Web。ESP Web Tools 的安装按钮需要对应项目提供固件清单；其官方演示安装的是 ESPHome，并非本项目固件。本项目当前发布的是本地选择文件用的 ZIP 和镜像，没有提供专用的一键网页安装清单，按上面的 ESP Tool 步骤即可。

参考：[esptool-js 官方说明（浏览器支持与串口刷写）](https://github.com/espressif/esptool-js)、[ESP32-S3 官方下载模式说明](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/advanced-topics/boot-mode-selection.html)、[ESP Web Tools 固件清单说明](https://esphome.github.io/esp-web-tools/)。上述实物连接日志来自用户反馈；编写文档时未代用户执行擦除或刷写开发板。

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

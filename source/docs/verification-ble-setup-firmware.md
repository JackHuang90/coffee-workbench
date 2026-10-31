# 固件 BLE Wi-Fi 配网验证记录

日期：2026-10-31

## 已实现内容

- 新增 `roast/ble_setup.hpp` / `src/ble_setup.cpp`：使用固定容量缓冲，消息上限为4095字节；沿用8字节分片头；组装期限固定为10秒；检查顺序、重复和长度；120秒授权计时支持毫秒回绕。
- 在原有 Coffee 服务中新增要求加密写入的 a003 特征及配网通知 a004 特征。遥测 a002 特征仍仅提供通知。BLE回调仅将有界分片复制到16项静态 FreeRTOS 队列；请求解析和网络、Controller、NVS操作均由主循环执行。
- 使用连接代际和授权/传输代际隔离旧分片及排队通知。每次发送配网通知前，重新检查连接是否仍然加密。配网响应使用独立序号，并遵守 MTU23至247的分片上限。
- `EspProvisioning::setupAction` 供 HTTP/BLE 共用，复用测试、按 revision 保存、NVS失败重试及异步扫描逻辑。测试会调用 forceStop 并递增网络 epoch，不授予控制权限。`bleState` 不包含门户 token 或任何密码；未授权时只返回最少状态，不提供扫描或配置详情。
- BOOT短按只在启动后稳定释放、消抖及合格按压之后产生一次事件；保留原有五秒恢复逻辑。长按恢复不会产生短按确认。
- 移除 EspProvisioning 对 RGB/RMT 的控制，由 main 中的新驱动独占指示灯。

## 公共整合接口

- `roast::ble::attachProvisioning(net::EspProvisioning*)`：在网络初始化后调用。
- `roast::ble::linkState()`：返回 connected、subscribed、setupPending、setupAuthorized、lastActivityAt；无活动时 lastActivityAt 为0。
- 现有 `ble::begin()` 和 `ble::tick(const Controller&, uint32_t)` 保持原接口。
- `EspProvisioning::state()`、`resetArmed()`、`hasError()`：为指示灯提供只读输入。
- `EspProvisioning::takeSetupConfirmation()`：消费主循环持有的短按事件，由 BLE tick 调用。
- `SetupAssembler::push(bytes,length,now)`：返回消息是否完整；`data()/size()/clear()` 用于读取或清空固定缓冲。
- `setupFrame(sequence,total,offset,data,payload,out,capacity)`：返回编码后的长度，失败时返回0。

## 验证依据

先观察失败再实现：新增配网测试最初因缺少 `ble_setup.hpp` 编译失败；按键测试因缺少 `takeShortPress` 失败；适配器测试因缺少 linkState 和加密配网特征失败。实现后重新运行并通过。

原生编译器：`<工具目录>/w64devkit/bin/g++.exe`，使用 C++17 和 `-Wall -Wextra -Werror`。

- `tests/test_ble_setup.cpp + src/ble_setup.cpp`：通过。覆盖授权与撤销、等待确认及已授权超时、连接代际、毫秒回绕、完整分片、重复/错序拒绝、固定期限和4095字节边界。
- `tests/test_provisioning.cpp + src/provisioning.cpp`：通过。保留候选配置及保存代数、校验、恢复按键和NVS记录核心测试；增加短按事件、单次消费和长按不确认测试。
- `tests/test_ble_adapter.cpp + src/{esp_ble,ble,ble_setup,core,protocol}.cpp`，使用 SDK 替身：虚拟演示模式0和1均通过。保留生命周期和拥塞测试；覆盖特征加密标志、拒绝未加密写入、未授权命令返回403、响应请求ID、不回显密码、加密通知保护和断线。
- 对本任务修改文件执行 `git diff --check`：通过，仅有 Git 换行转换提示。
- 主任务负责完整原生套件、SDK两种镜像及禁用RGB构建、发布包收集；完整结果参见主任务的整合验证记录。

## SDK 安全检查

已检查固定 Arduino3.3.12 的源码，位置为 `<工具目录>/pio/packages/framework-arduinoespressif32/libraries/BLE/src`。

- `BLECharacteristic::PROPERTY_WRITE_ENC` 直接映射到 NimBLE 的 `BLE_GATT_CHR_F_WRITE_ENC`，与 PROPERTY_WRITE 一起设置。回调同时检查 `desc.sec_state.encrypted`。
- `BLESecurity::setAuthenticationMode(false,false,true)` 启用 Secure Connections，不要求绑定或MITM；`setCapability(BLE_HS_IO_NO_INPUT_OUTPUT)` 使用 Just Works；关闭强制认证，避免在回调中等待安全握手。
- 无线主机通过 `ble_gap_conn_find` 在每次配网通知前检查实际加密状态。
- SDK 的 `BLECharacteristic::setValue` 会在应用回调之前，以 VERBOSE 日志输出特征原始字节。因此，固件拒绝 ARDUHAL_LOG_LEVEL 为 VERBOSE 的构建；普通较低日志级别仍可使用。

Just Works 提供传输加密，不验证设备身份，也不能防御主动中间人攻击。本版通过现场 BOOT 确认验证设备持有。BLE配对及手机兼容性、实机Wi-Fi/NVS行为、按键时序仍需板上验收；原生测试和SDK构建不代表无线或硬件验证通过。未烧录或擦除任何实体设备。

## 独立复核后的通知调度修复

复核发现：配网响应原先始终优先排入发送队列。在 MTU23 下，持续的配网响应或其内存拥塞会阻塞已开始的遥测帧，使其超过1.5秒期限，并断开共用的BLE连接。

先在真实 `esp_ble.cpp` 适配器测试中复现：同时订阅遥测和配网，在 MTU23 下开始一帧遥测，再令配网通知持续返回 ENOMEM 达1.7秒。修复前测试在 `telemetryProgress>1` 断言失败，证实配网重试独占了通知调度。

修复后，两条就绪通道交替获得发送尝试，SDK拒绝一次通知也会让出下一次机会；已经到期的遥测帧优先执行原有过期处理。正常无遥测拥塞时，MTU23的1023字节最大遥测帧最多需要约860毫秒的分片机会，低于1.5秒期限。配网仍使用10秒期限；原有加密检查和代际隔离保留。

回归测试验证：配网拥塞期间遥测仍持续发送、完整组装且连接不被断开；解除拥塞后配网响应也可完成。使用 `-Wall -Wextra -Werror` 的适配器测试在虚拟演示模式0和1均通过。真实SDK重编译由主任务执行。

# RGB 实现验证 — 2026-10-31

独立灯态模块由 `firmware/include/roast/indicator.hpp`、
`firmware/src/indicator.cpp`、`firmware/include/roast/esp_indicator.hpp` 和
`firmware/src/esp_indicator.cpp` 实现。纯灯态引擎不访问控制器、网络、BLE 协议栈或物理输出。

## 整合接口约定

在主循环所属对象中创建一个长期存活的 `roast::indicator::EspIndicator`，
启动时调用一次 `begin(now)`，随后在每轮循环调用 `tick(inputs, now)`。
返回值为 `Frame { State state; Color color; }`；`stateName(state)` 提供稳定的诊断名称。
颜色采用 0..255 范围的标准 RGB 值；仅硬件适配层应用配置中的物理亮度上限。

`Inputs` 包含 `boot`、`reset`、`error`、`configured`、`wifiConnecting`、
`wifiConnected`、`bleConnected`、`bleSubscribed`、`setupPending`、
`setupAuthorized`、`curveReceiving`、`curveLoaded`、`simulationRunning` 和
`dataTransfer`。启动后可以持续传入 `boot=true`：引擎会在 `begin` 后 1500 ms
永久结束本次启动指示，即使这段时间内它被其他灯态遮盖。无符号减法可处理启动期间的毫秒计时回绕。

通过 `Controller::receivingCurve()` 传入控制器真实的曲线暂存状态。
`curveLoaded` 应表示实际存在已提交的曲线；引擎按约定优先级显示，因此只要曲线保持装载，
重复的曲线已装载指示就会遮盖优先级较低的网络状态。闪烁中的熄灭间隔仍属于当前选中的高优先级灯态，
不会在此期间显示低优先级状态。

仅在 VIRTUAL_DEMO 控制器实际运行时传入 `simulationRunning`
（按实际情况对应 Running、Manual、ArtisanPower 或 ArtisanSv）。作为额外边界，
LOCKED 构建会完全忽略该标志。BLE 连接或网页本地仿真均不会设置此状态。
`dataTransfer` 是主循环调用方提供、已限制持续时间的短活动脉冲；纯函数不会锁存此标志，
也不会因轮询而延长它。

## 灯态说明

按优先级从高到低排列：

| 状态               | 灯效                                         |
| ------------------ | -------------------------------------------- |
| 故障               | 红色三闪，每次亮 120 ms，周期 1800 ms        |
| BOOT 恢复          | 紫色快闪，亮灭各 120 ms                      |
| 配网确认           | 紫色与黄色每 300 ms 交替                     |
| 启动               | 白色亮度呼吸，1500 ms 后结束                 |
| 曲线接收           | 紫色快闪，亮灭各 120 ms                      |
| 虚拟温控           | 橙色亮度呼吸，周期 2000 ms                   |
| 曲线已装载         | 紫色双闪，每次亮 120 ms，周期 1600 ms        |
| 最近传输           | 调用方的短活动脉冲有效期间，青色亮灭各 80 ms |
| 配网已授权         | 紫色单闪，亮 160 ms，周期 1600 ms            |
| BLE 已订阅         | 青色常亮                                     |
| BLE 已连接、未订阅 | 青色快闪，亮灭各 120 ms                      |
| Wi-Fi 连接中       | 黄色快闪，亮灭各 120 ms                      |
| 已配网、离线       | 黄色双闪，每次亮 120 ms，周期 1600 ms        |
| Wi-Fi 已连接       | 绿色常亮                                     |
| 未配网             | 蓝色慢闪，亮灭各 700 ms                      |

授权指示的优先级低于曲线和传输活动，高于连接状态，因此既能保持可见，
也不会遮盖故障、配网确认、曲线接收或虚拟运行。Wi-Fi 已连接输入会阻止显示已配网离线指示。

## 驱动边界

沿用 `board.hpp` 的覆盖配置：默认 GPIO48、GRB 颜色顺序、亮度 12，
每个颜色通道的硬上限为 32，并支持 `ROAST_RGB_ENABLE=0`。
适配层独立于 `ROAST_WIFI_ENABLE`，支持现有 SDK 的全部六种颜色顺序覆盖。
不可复制的适配对象在整个异步传输期间持有自己的 24 符号 RMT 缓冲区。
修改缓冲区前先检查上次传输是否完成，发送使用 `rmtWriteAsync`，
并确保至少 10 ms 的帧间隔，其中包含 WS2812 所需的低电平锁存间隔。
量化后的颜色相同时不会重复发送。不使用延时或阻塞写入；原生构建不依赖 Arduino。

## 验证证据

先验证测试失败：初始占位渲染函数在 `render(in,0).state==State::Error`
断言处按预期失败。实现后，`firmware/tests/test_indicator.cpp` 在
`ROAST_VIRTUAL_DEMO=0` 和 `=1` 两种模式下均通过
`-std=c++17 -Wall -Wextra -Wpedantic -Werror` 编译和运行，
同时验证原生构建中的 ESP 适配层条件编译。
测试覆盖多输入同时有效时的优先级、精确脉冲边界、不同闪烁次数、连续呼吸亮度、
启动到期、计时回绕、重新初始化、活动结束、在线连接常亮，以及 LOCKED 构建拒绝显示仿真运行。

另一项先失败后通过的测试专门验证：传输闪烁能与 BLE 已订阅时的青色常亮区分。
原常亮占位实现会在 80 ms 处失败；最终实现会在调用方提供的 200 ms 活动窗口中，
于 0 ms 点亮、80 ms 熄灭、160 ms 再次点亮。

最终以整合验证记录为准。

最终整合验证已通过固件原生套件、547 项网页测试，以及三个 SDK 构建
（LOCKED、VIRTUAL_DEMO 和 RGB 禁用编译检查）。物理 GPIO、颜色顺序和按键行为仍需真机验收；
构建与原生测试不等同于物理灯效已经通过验证。

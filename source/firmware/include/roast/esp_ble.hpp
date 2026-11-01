/** 功能：网页只读蓝牙适配器入口，不提供控制命令。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
#pragma once
#include <cstdint>
#include <cstddef>
namespace roast { class Controller; }
namespace roast::net { class EspProvisioning; }
namespace roast::ble {
/** 功能：在启动阶段初始化NimBLE广播，不依赖Wi-Fi配网。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
bool begin();
struct LinkState {bool connected=false,subscribed=false,setupPending=false,setupAuthorized=false;uint32_t lastActivityAt=0;};
void attachProvisioning(net::EspProvisioning*);
LinkState linkState();
/** 功能：仅响应显式USB查询，输出版本2、无设备标识的被动诊断及配网流程计数；容量不足清空输出并返回0。now单位为毫秒，预留用于版本兼容。 */
size_t diagnostics(char* out,size_t capacity,uint32_t now);
/** 功能：主循环生成只读状态并零等待排入一个通知；从不续期或撤销控制。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void tick(const Controller& controller,uint32_t now);
}

#pragma once
#include <cstddef>
#include <cstdint>
/** 功能：提供不依赖硬件的配网校验、存储恢复与定时决策。
 * 首次编写日期：2026-10-29；变更日期：2026-10-30
 * 修改记录：2026-10-29：首次编写，所有配置文本采用固定容量。
 * - 2026-10-30：增加明确本机/内网HTTP来源支持。 */
namespace roast::net {
/** 功能：保存经过校验的网络参数。首次编写日期：2026-10-29；变更日期：2026-10-30；修改记录：2026-10-29：首次编写；2026-10-30：来源增加受限HTTP，存储布局不变。 */
struct Config {
 char ssid[33]{}; // 最多32字节的无线网络名称。
 char password[65]{}; // 仅写入持久配置，永不通过网页或状态回显。
 bool staticIp=false; // 为真时使用固定IPv4，否则清除旧静态地址并使用DHCP。
 char ip[16]{}; // 固定主机地址。
 char mask[16]{}; // 连续子网掩码。
 char gateway[16]{}; // 同网段网关。
 char dns[16]{}; // 可达性由实际网络决定的DNS地址。
 uint8_t originCount=0; // 显式配置的HTTPS或本机/内网HTTP来源数量。
 char origins[4][256]{}; // 无路径、无默认端口的精确来源；不自动授权同网段其他主机。
};
/** 功能：区分配置验证结果。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
enum class Error { None, Ssid, Password, Address, Origin };
/** 功能：解析无前导零的十进制IPv4。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
bool ipv4(const char*,uint32_t&);
/** 功能：保留不重叠的当前热点网段，冲突时选择可恢复私有网关；无候选返回0。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
uint32_t apGateway(uint32_t current,uint32_t station,uint32_t mask);
/** 功能：从HTTPS或本机/内网HTTP URL提取标准来源，拒绝用户信息、通配符及模糊IP。首次编写日期：2026-10-29；变更日期：2026-10-30；修改记录：2026-10-29：首次编写；2026-10-30：HTTP仅接受localhost、127/8和RFC1918四段十进制IPv4，默认80/443端口按协议省略。 */
bool normalizeOrigin(const char*,char (&out)[256]);
/** 功能：验证网络配置及全部字符串边界。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
Error validate(const Config&);
/** 功能：执行只读状态的精确来源匹配。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
bool originAllowed(const Config&,const char*);
/** 功能：表达双槽NVS记录；空配置墓碑避免恢复时整片擦除。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
struct Record {
 uint32_t version=1; // 持久格式版本。
 uint32_t sequence=0; // 支持回绕比较的提交序号。
 uint32_t present=0; // 0为已清除网络配置的有效墓碑。
 Config config{}; // 完整网络配置；墓碑为全零。
 uint32_t checksum=0; // 前述字节的损坏检测校验，不作为加密或认证。
};
/** 功能：构造完整记录及校验。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
Record makeRecord(const Config&,uint32_t,bool);
/** 功能：检查版本、校验和配置内容。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
bool recordValid(const Record&);
/** 功能：选择最近的完整槽；无有效记录返回-1。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
int selectRecord(const Record*,const Record*);
/** 功能：上电先释放、消抖、长按五秒后松开确认恢复。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
class ResetButton {
 public:
 /** 功能：输入低有效按钮的按下状态；确认时只返回一次真。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool update(bool pressed,uint32_t now);
 /** 功能：报告等待松开确认状态。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool armed()const{return armed_;}
 private:
 bool initial_=true; // 尚未记录首个输入。
 bool raw_=true; // 当前未消抖输入。
 bool stable_=true; // 已消抖的输入。
 bool released_=false; // 固件启动后是否稳定释放过。
 bool armed_=false; // 五秒阈值已到达，等待稳定释放。
 uint32_t changed_=0; // 原始输入最后变化时间，毫秒。
 uint32_t pressed_=0; // 稳定按下的起始时间，毫秒。
};
/** 功能：描述网络/配网状态。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
enum class State { Setup, Connecting, Testing, Ready, Failed, SaveFailed, Saved, Online, Offline };
/** 功能：交给ESP主循环执行的网络动作。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
enum class Action { None, ConnectSaved, ConnectCandidate, Disconnect, CloseAp };
/** 功能：非阻塞测试、保存和有上限的重连退避。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
class Machine {
 public:
 /** 功能：初始化已保存或未配网的启动状态。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void begin(bool saved,uint32_t now);
 /** 功能：启动候选网络的30秒连接测试。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void test(uint32_t now);
 /** 功能：根据实际连接状态计算下一步动作。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 Action tick(uint32_t now,bool connected);
 /** 功能：仅在测试成功且持久化成功后启动热点关闭倒计时。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void saved(bool success,uint32_t now);
 /** 功能：读取用于界面的网络状态。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 State state()const{return state_;}
 /** 功能：仅允许测试成功的候选配置被提交。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool canSave()const{return state_==State::Ready||state_==State::SaveFailed;}
 /** 功能：只允许提交当前标签页测试得到的候选代数。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool canSave(uint32_t revision)const{return revision&&revision==revision_&&canSave();}
 /** 功能：返回当前候选的非零代数。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 uint32_t revision()const{return revision_;}
 private:
 State state_=State::Setup; // 当前可观察状态。
 bool pending_=false; // 连接动作等待交给适配器执行。
 bool trying_=false; // 当前30秒尝试仍在进行。
 bool closeAp_=false; // 保存后的热点关闭动作是否尚未发出。
 uint32_t at_=0; // 当前尝试、等待或保存的起始毫秒。
 uint32_t wait_=1000; // 当前退避，最高30秒。
 uint32_t revision_=0; // 仅一次门户会话内有意义的候选代数。
};
/** 功能：枚举RGB网络提示颜色，Off用于闪烁的暗相。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
enum class Light { Off, Blue, Yellow, Green, Red, Purple };
/** 功能：按键确认优先的无阻塞灯态计算。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
Light light(State,bool,uint32_t);
}

/** 功能：独立于无线SDK的只读BLE分片与调度契约。
 * 首次编写日期：2026-10-30；变更日期：2026-10-30
 * 修改记录：2026-10-30：首次编写，限定状态大小、MTU、快照寿命与订阅边界。 */
#pragma once
#include <cstddef>
#include <cstdint>
namespace roast::ble {
/** 功能：编码一片状态；失败返回0且不修改输出。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
size_t encodeFragment(const uint8_t* json,size_t length,uint16_t sequence,size_t offset,uint16_t mtu,uint8_t* out,size_t capacity);
/** 功能：维护单连接订阅代际；同步由适配器负责。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct Session {
 // 每次连接或订阅边界变化时递增，用于拒绝旧排队通知。
 uint32_t epoch=0;
 // 当前连接句柄；65535表示没有客户端。
 uint16_t connection=65535;
 // 当前ATT MTU，新连接从23开始。
 uint16_t mtu=23;
 // 当前客户端是否启用状态通知。
 bool subscribed=false;
 /** 功能：接受首个客户端并拒绝额外客户端。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 bool connect(uint16_t id);
 /** 功能：清除匹配连接，保持其他客户端断开无副作用。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void disconnect(uint16_t id);
 /** 功能：订阅边界切换时废弃前一代消息。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void subscribe(uint16_t id,bool enabled);
};
/** 功能：描述排队通知在实际发送前的最终处理，Close用于当前会话的非法通知，排队过期仅丢弃。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
enum class Delivery { Drop,Close,Send };
/** 功能：重验会话代际、通知大小、MTU和100ms排队寿命。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
Delivery assessDelivery(const Session& session,uint32_t epoch,size_t length,uint32_t queuedAt,uint32_t now);
/** 功能：保留一份稳定状态，每秒开始至多一帧并以5ms间隔等待发送确认。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class Stream {
 public:
 /** 功能：应用连接快照；代际变化立即丢弃部分消息。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void observe(const Session& session);
 /** 功能：判断是否可开始新快照。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 bool due(uint32_t now)const;
 /** 功能：复制完整状态到固定存储；无效输入不开始。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 bool begin(const char* json,size_t length,uint32_t now);
 /** 功能：编码待发送片段但不前移偏移，等待主机入队结果。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 size_t next(uint32_t now,uint8_t* out,size_t capacity);
 /** 功能：发送成功时前移一片并启动最小间隔。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void accepted(uint32_t now);
 /** 功能：在浏览器2秒组帧期限前报告持续拥塞或未完成帧。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 bool expired(uint32_t now)const;
 /** 功能：有界清空当前快照及待确认片，保留连接、序号和开始频率。 */
 void discard();
 private:
 // 最新同步会话；仅由主循环调用流对象。
 Session session_{};
 // 当前不可变JSON内容，不需要结尾零字符。
 uint8_t json_[1023]{};
 // 当前消息字节数，0表示无在途消息。
 size_t length_=0;
 // 已确认进入主机发送队列的JSON字节数。
 size_t offset_=0;
 // 最近准备片段的正文长度，确认后归零。
 size_t prepared_=0;
 // 当前消息序号，16位自然回绕。
 uint16_t sequence_=65535;
 // 最近开始快照的时间，用于1秒频率与消息寿命。
 uint32_t startedAt_=0;
 // 最近成功入队时间，用于5ms节流。
 uint32_t sentAt_=0;
 // 是否已开始过快照，处理启动及millis回绕。
 bool started_=false;
 // 是否已经发送过片段，处理第一个立即发送。
 bool sent_=false;
};
}

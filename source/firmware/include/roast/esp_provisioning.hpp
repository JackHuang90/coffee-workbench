#pragma once
#if ROAST_WIFI_ENABLE
#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <WiFiUdp.h>
#include <esp32-hal-rmt.h>
#include "roast/provisioning.hpp"
#include "roast/portal.hpp"
#include "roast/core.hpp"
namespace roast::net {
/** 功能：主循环内的ESP32 Wi-Fi/NVS/GPIO适配；不在事件线程改写控制器。
 * 首次编写日期：2026-10-29；变更日期：2026-10-30
 * 修改记录：2026-10-29：首次编写，配置动作撤销控制授权，普通循环不等待联网。
 * - 2026-10-30：handle来源错误与新增本机/内网HTTP策略一致。 */
class EspProvisioning {
 public:
 /** 功能：加载身份和双槽配置，启动STA或首次AP。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void begin(Controller&,uint32_t);
 /** 功能：轮询网络、按钮、DNS与灯态，每次不等待连接或扫描。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void tick(uint32_t);
 /** 功能：在热点接口提供页面和测试/保存/扫描动作；返回HTTP状态码。首次编写日期：2026-10-29；变更日期：2026-10-30；修改记录：2026-10-29：首次编写；2026-10-30：来源校验失败返回invalid_website_origin，权限检查不变。 */
 int handle(const PortalRequest&,bool,uint32_t,const char*&,const char*&);
 /** 功能：本地USB显式查询热点凭据，无路由器密码。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 size_t setupInfo(char*,size_t)const;
 /** 功能：提供已提交的精确来源配置。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 const Config& config()const{return committed_;}
 /** 功能：判断本应用是否有已提交网络。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool configured()const{return configured_;}
 /** 功能：判断配置热点是否已成功开启。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool apActive()const{return ap_;}
 /** 功能：读取配置变更代数以关闭旧连接。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 uint32_t epoch()const{return epoch_;}
 private:
 Controller* controller_=nullptr; // 仅主循环访问，用于配置时撤销控制。
 Preferences store_; // 本应用网络记录命名空间。
 WiFiUDP dns_; // 只绑定热点地址，每轮处理最多一个DNS报文。
 uint8_t dnsPacket_[512]{}; // 有界DNS收发工作区。
 rmt_data_t ledData_[24]{}; // 异步WS2812发送完成前保持稳定的缓冲。
 bool ledReady_=false; // 仅在setup中初始化一次RMT，不在tick中等待。
 Config committed_{}; // 最后成功提交的网络配置。
 Config candidate_{}; // 只在显式测试成功后允许提交的候选配置。
 const Config* pendingConnection_=nullptr; // 等待旧STA异步断开后才配置的新连接。
 Record scratch_{}; // 静态工作区避免大记录堆叠到loop栈。
 Machine machine_; // 可原生测试的网络定时核心。
 ResetButton button_; // 可原生测试的按键消抖与确认核心。
 char ssid_[32]{}; // 设备专属热点名，MAC后缀不是秘密。
 char password_[17]{}; // 独立持久的随机热点密码。
 char token_[33]{}; // 每次热点会话的随机防伪值。
 char response_[4096]{}; // 状态/扫描JSON工作区，不装入页面内容。
 char error_[96]{}; // 非敏感用户可见错误码。
 bool configured_=false; // 是否有已提交的网络。
 bool storage_=false; // 配置NVS空间是否可写。
 bool identity_=false; // 热点身份是否成功持久化。
 bool ap_=false; // 热点当前是否可用。
 bool scanning_=false; // 异步扫描是否尚未结束。
 bool wasConnected_=false; // 上次观察到的连接状态，掉线撤销租约。
 uint32_t scanAt_=0; // 异步扫描开始毫秒。
 uint32_t epoch_=0; // 配置变化时递增，不自动授权。
 uint32_t sequence_=0; // 已提交记录序号。
 uint32_t migrationAt_=0; // 已向浏览器公告的热点迁移开始毫秒。
 uint32_t migrationGateway_=0; // 非零时表示十秒后切换的热点地址。
 bool deferTest_=false; // 静态网段迁移完成前暂停候选测试。
 int slot_=-1; // 当前有效NVS槽。
 Light lastLight_=Light::Off; // 上次发送的RGB颜色，避免重复驱动。
 /** 功能：生成并持久化设备独立热点密码。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool identity();
 /** 功能：写入另一个NVS槽并回读确认，失败保留旧记录。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool persist(const Config&,bool);
 /** 功能：开启WPA2热点和门户DNS并生成新会话值。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void openAp();
 /** 功能：按已知路由子网选择不重叠的私有热点网段。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool selectAp(uint32_t,uint32_t);
 /** 功能：把已公告的网关应用到热点及DNS。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool applyAp(uint32_t);
 /** 功能：清除旧STA地址并发起异步连接。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void connect(const Config&,uint32_t);
 /** 功能：旧连接已经断开时执行无等待的SDK地址与连接请求。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void startConnection();
 /** 功能：逻辑清除本应用网络配置，保留设备身份和业务数据。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void resetNetwork(uint32_t);
 /** 功能：生成无密码的门户状态及最多12条扫描结果。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void stateJson(uint32_t);
 /** 功能：处理最多一个有界热点DNS查询。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void dnsWork();
 /** 功能：上一帧完成后异步发送WS2812颜色，无无限等待。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void showLight(Light);
};
}
#endif

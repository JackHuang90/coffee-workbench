/** 功能：用SDK自带NimBLE建立只读通知服务；蓝牙任务持有无线操作，主循环持有Controller。
 * 首次编写日期：2026-10-30；变更日期：2026-10-30
 * 修改记录：2026-10-30：首次编写，通过单槽消息与代际隔离回调、拥塞及重新订阅。 */
#include "roast/esp_ble.hpp"
#include "roast/ble.hpp"
#include "roast/ble_setup.hpp"
#include "roast/esp_provisioning.hpp"
#include <BLESecurity.h>
#include <cstring>
#include "roast/protocol.hpp"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLECharacteristic.h>
#include <freertos/queue.h>
#include <nimble/nimble_port.h>
#include <host/ble_hs_mbuf.h>
#include <cstdio>
#include <algorithm>
// Arduino BLE's VERBOSE setValue logger includes raw GATT values. Refuse such builds.
#if defined(ARDUHAL_LOG_LEVEL) && defined(ARDUHAL_LOG_LEVEL_VERBOSE) && ARDUHAL_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_VERBOSE
#error "BLE provisioning requires credential-safe SDK logging (below VERBOSE)"
#endif
#if !defined(CONFIG_NIMBLE_ENABLED)
#error "The pinned Arduino 3.3.12 S3 SDK must provide NimBLE"
#endif
namespace roast::ble {
namespace {
// 浏览器服务筛选UUID与唯一只读状态通知UUID。
constexpr const char* serviceUuid="b4e7a001-9d56-4f1b-a6e0-7d31c2f84590";
constexpr const char* statusUuid="b4e7a002-9d56-4f1b-a6e0-7d31c2f84590";
/** 功能：固定大小通知信封，附带订阅代际及最长排队寿命。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct Packet {
 // 排队时的订阅代际；任何连接或订阅边界都会使其无效。
 bool setup=false;
 uint32_t generation=0;
 uint32_t epoch=0;
 // 排队时的毫秒时钟，过旧消息断开而不继续显示旧状态。
 uint32_t queuedAt=0;
 // 有效通知字节数；0表示请求断开当前过期会话。
 size_t length=0;
 // 最多244字节的通知，包括8字节协议头。
 uint8_t bytes[244]{};
};
/** 功能：将单次实际发送结果返回主循环。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct Receipt {
 // 对应原始消息代际，防止旧确认前移新消息。
 bool setup=false;
 uint32_t epoch=0;
 // 无线主机成功接受消息时的时间。
 uint32_t sentAt=0;
 // 只有NimBLE实际接受通知时为真。
 bool accepted=false;
};
// 以下共享会话仅在短临界区内读写；无线函数不在临界区内调用。
portMUX_TYPE sessionMux=portMUX_INITIALIZER_UNLOCKED;
// 当前连接、订阅与MTU，由蓝牙任务更新，主循环只复制。
Session session;
uint32_t connectionEpoch=0;
bool setupSubscribed=false;
uint32_t lastActivityAt=0;
net::EspProvisioning* provisioning=nullptr;
SetupAuthorization setupAuthorization;
SetupAssembler setupAssembler;
struct Incoming {uint32_t epoch=0,at=0,generation=0;size_t length=0;uint8_t bytes[244]{};};
StaticQueue_t incomingControl;
uint8_t incomingStorage[16*sizeof(Incoming)];
QueueHandle_t incoming=nullptr;
uint32_t incomingFailures=0;
uint32_t seenFailures=0,seenConnection=0;
uint16_t setupHandle=0,setupSequence=0;
char setupResponse[4096]{};
size_t setupLength=0,setupOffset=0;
uint32_t setupResponseAt=0;
bool previousAuthorization=false;
bool preferSetup=true;
uint32_t pendingSetupEpoch=0;
size_t pendingSetupPayload=0;

// 固定单槽队列及其静态存储；队列操作始终为零等待。
StaticQueue_t outgoingControl;
// 返回发送结果队列的控制结构。
StaticQueue_t receiptControl;
// 单个通知信封的队列存储。
uint8_t outgoingStorage[sizeof(Packet)];
// 单个发送结果的队列存储。
uint8_t receiptStorage[sizeof(Receipt)];
// 主循环至无线中继的通知队列。
QueueHandle_t outgoing=nullptr;
// 无线主机至主循环的结果队列。
QueueHandle_t receipts=nullptr;
// 一个可重复投递的NimBLE主机事件；仅在上一结果被主循环读走后再次投递。
ble_npl_event sendEvent;
// 静态中继任务承接可能等待的SDK事件队列投递；主循环仅操作自己的零等待单槽队列。
StaticTask_t relayControl;
// 中继任务固定栈，不使用Arduino主循环的栈预算。
StackType_t relayStack[1024];
// 中继交付主机的单一信封；结果被取走前不会再次写入。
Packet hostPacket;
// 通知属性句柄在广播前确定，此后只读。
uint16_t statusHandle=0;
// 主循环专有状态，包括稳定快照、输出帧与拥塞重试节流。
Stream stream;
// 状态序列化缓冲，避免给主循环栈增加1KB临时变量。
char statusBuffer[kResponseSize]{};
// BLE初始化和广播已经成功，才启用调度。
bool ready=false;
// 等待无线主机结果期间不会排队第二个信封。
bool pending=false;
// 是否已尝试入队，用于首次立即发送及后续节流。
bool attempted=false;
// 最近一次入队时间，所有重试至少间隔5ms。
uint32_t attemptedAt=0;
/** 功能：在短临界区复制会话，不访问SDK对象或Controller。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
Session readSession(){portENTER_CRITICAL(&sessionMux);const Session copy=session;portEXIT_CRITICAL(&sessionMux);return copy;}
/** 功能：在蓝牙任务使当前订阅失效并请求断开，保留Wi-Fi控制所有权。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void closeSession(const Session& current){
 portENTER_CRITICAL(&sessionMux);session.subscribe(current.connection,false);portEXIT_CRITICAL(&sessionMux);
 ble_gap_terminate(current.connection,BLE_ERR_REM_USER_CONN_TERM);
}
/** 功能：蓝牙任务中发送一片；重验代际/MTU/队列寿命，内存不足返回重试。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void sendOnHost(ble_npl_event*){
 const Packet& packet=hostPacket;
 Receipt receipt;receipt.epoch=packet.epoch;receipt.setup=packet.setup;const Session current=readSession();
 ble_gap_conn_desc desc{};
 bool setupCanSend=false;
 if(packet.setup){portENTER_CRITICAL(&sessionMux);setupCanSend=setupSubscribed&&connectionEpoch==packet.epoch&&incomingFailures==packet.generation;portEXIT_CRITICAL(&sessionMux);setupCanSend=setupCanSend&&current.connection!=65535&&ble_gap_conn_find(current.connection,&desc)==0&&desc.sec_state.encrypted;}
 const Delivery delivery=packet.setup?(setupCanSend&&uint32_t(millis()-packet.queuedAt)<100?Delivery::Send:Delivery::Drop):assessDelivery(current,packet.epoch,packet.length,packet.queuedAt,millis());
 if(delivery==Delivery::Close)closeSession(current);
 if(delivery==Delivery::Send){
   os_mbuf* buffer=ble_hs_mbuf_from_flat(packet.bytes,packet.length);
   if(buffer){
    // NimBLE consumes the mbuf even when notify returns an error. No indication waits.
    const int result=ble_gatts_notify_custom(current.connection,packet.setup?setupHandle:statusHandle,buffer);
    receipt.accepted=result==0;receipt.sentAt=millis();
    if(result&&result!=BLE_HS_ENOMEM&&result!=BLE_HS_EBUSY&&result!=BLE_HS_EAGAIN)closeSession(current);
   }
 }
 xQueueOverwrite(receipts,&receipt);
}
/** 功能：独立任务转交单槽消息到NimBLE事件队列，隔离SDK可能等待的投递。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void relayToHost(void*){
 for(;;){if(xQueueReceive(outgoing,&hostPacket,portMAX_DELAY)==pdTRUE)ble_npl_eventq_put(nimble_port_get_dflt_eventq(),&sendEvent);}
}
/** 功能：连接回调只维护传输状态；只接纳一个客户端。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class ServerCallbacks final:public BLEServerCallbacks {
 /** 功能：登记首个连接，额外连接直接拒绝。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void onConnect(BLEServer*,ble_gap_conn_desc* info)override {
  portENTER_CRITICAL(&sessionMux);const bool accepted=session.connect(info->conn_handle);if(accepted){++connectionEpoch;setupSubscribed=false;lastActivityAt=0;}portEXIT_CRITICAL(&sessionMux);
  if(!accepted)ble_gap_terminate(info->conn_handle,BLE_ERR_REM_USER_CONN_TERM);
 }
 /** 功能：匹配断开时重置连接代际，禁止复用旧订阅。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void onDisconnect(BLEServer*,ble_gap_conn_desc* info)override {
  portENTER_CRITICAL(&sessionMux);if(session.connection==info->conn_handle){++connectionEpoch;setupSubscribed=false;lastActivityAt=0;}session.disconnect(info->conn_handle);portEXIT_CRITICAL(&sessionMux);
 }
 /** 功能：同步当前连接实际MTU，编码时始终遵守最新上限。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void onMtuChanged(BLEServer*,ble_gap_conn_desc* info,uint16_t mtu)override {
  portENTER_CRITICAL(&sessionMux);if(session.connection==info->conn_handle)session.mtu=std::max(uint16_t{23},mtu);portEXIT_CRITICAL(&sessionMux);
 }
};
/** 功能：订阅回调只记录通知启停，不执行读取或写控制命令。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class StatusCallbacks final:public BLECharacteristicCallbacks {
 /** 功能：在订阅边界使旧快照与排队通知失效。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void onSubscribe(BLECharacteristic*,ble_gap_conn_desc* info,uint16_t value)override {
  portENTER_CRITICAL(&sessionMux);session.subscribe(info->conn_handle,(value&1)!=0);portEXIT_CRITICAL(&sessionMux);
 }
};
// Callbacks copy only bounded encrypted fragments; network/controller work stays on loop.
class SetupCallbacks final:public BLECharacteristicCallbacks {
 void onWrite(BLECharacteristic* c,ble_gap_conn_desc* info)override {
  if(!info->sec_state.encrypted)return;
  const auto value=c->getValue();if(value.length()<9||value.length()>244){portENTER_CRITICAL(&sessionMux);++incomingFailures;portEXIT_CRITICAL(&sessionMux);return;}
  Incoming item;bool accepted=false;
  portENTER_CRITICAL(&sessionMux);accepted=session.connection==info->conn_handle;if(accepted){item.epoch=connectionEpoch;item.generation=incomingFailures;lastActivityAt=millis();}portEXIT_CRITICAL(&sessionMux);
  if(!accepted)return;
  item.at=millis();item.length=value.length();std::memcpy(item.bytes,value.c_str(),item.length);
  if(xQueueSend(incoming,&item,0)!=pdTRUE){portENTER_CRITICAL(&sessionMux);++incomingFailures;portEXIT_CRITICAL(&sessionMux);}
 }
 void onSubscribe(BLECharacteristic*,ble_gap_conn_desc* info,uint16_t value)override {
  portENTER_CRITICAL(&sessionMux);if(session.connection==info->conn_handle){setupSubscribed=(value&1)!=0;++incomingFailures;}portEXIT_CRITICAL(&sessionMux);
 }
};
SetupCallbacks setupCallbacks;
// 回调对象具有固件全寿命，避免悬空指针或运行时创建。
ServerCallbacks serverCallbacks;
// 唯一状态特征订阅回调的全寿命实例。
StatusCallbacks statusCallbacks;
}
/** 功能：启动只读BLE并配置可发现设备名；运行前失败只关闭BLE功能。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
bool begin(){
 if(ready)return true;
 outgoing=xQueueCreateStatic(1,sizeof(Packet),outgoingStorage,&outgoingControl);
 receipts=xQueueCreateStatic(1,sizeof(Receipt),receiptStorage,&receiptControl);
 incoming=xQueueCreateStatic(16,sizeof(Incoming),incomingStorage,&incomingControl);
 if(!outgoing||!receipts||!incoming)return false;
 char name[24]{};std::snprintf(name,sizeof(name),"Coffee-%06lX",static_cast<unsigned long>(ESP.getEfuseMac()&0xffffff));
 if(!BLEDevice::init(name))return false;
 ble_npl_event_init(&sendEvent,sendOnHost,nullptr); // NPL dispatch table is installed by BLEDevice::init.
 BLEDevice::setMTU(247);
 BLESecurity::setAuthenticationMode(false,false,true);
 BLESecurity::setCapability(BLE_HS_IO_NO_INPUT_OUTPUT);
 BLESecurity::setForceAuthentication(false);
 BLEServer* server=BLEDevice::createServer();if(!server)return false;
 server->setCallbacks(&serverCallbacks);server->advertiseOnDisconnect(true);
 BLEService* service=server->createService(serviceUuid);if(!service)return false;
 BLECharacteristic* characteristic=service->createCharacteristic(statusUuid,BLECharacteristic::PROPERTY_NOTIFY);if(!characteristic)return false;
 characteristic->setAccessPermissions(0); // NimBLE derives access solely from NOTIFY; no READ/WRITE flags.
 characteristic->setCallbacks(&statusCallbacks);
 auto* setupWrite=service->createCharacteristic("b4e7a003-9d56-4f1b-a6e0-7d31c2f84590",BLECharacteristic::PROPERTY_WRITE|BLECharacteristic::PROPERTY_WRITE_ENC);
 auto* setupNotify=service->createCharacteristic("b4e7a004-9d56-4f1b-a6e0-7d31c2f84590",BLECharacteristic::PROPERTY_NOTIFY);
 if(!setupWrite||!setupNotify)return false;
 setupWrite->setCallbacks(&setupCallbacks);setupNotify->setCallbacks(&setupCallbacks);
 service->start();server->start();statusHandle=characteristic->getHandle();setupHandle=setupNotify->getHandle();
 if(!statusHandle)return false;
 if(!xTaskCreateStatic(relayToHost,"ble-status-relay",sizeof(relayStack),nullptr,1,relayStack,&relayControl))return false;
 BLEAdvertising* advertising=BLEDevice::getAdvertising();if(!advertising)return false;
 advertising->addServiceUUID(serviceUuid);advertising->setScanResponse(true);
 ready=advertising->start();return ready;
}
void attachProvisioning(net::EspProvisioning* value){provisioning=value;}
LinkState linkState(){const auto current=readSession();LinkState out;out.connected=current.connection!=65535;out.subscribed=current.subscribed;out.setupPending=out.connected&&setupAuthorization.pending();out.setupAuthorized=out.connected&&setupAuthorization.authorized(millis());portENTER_CRITICAL(&sessionMux);out.lastActivityAt=lastActivityAt;portEXIT_CRITICAL(&sessionMux);return out;}
namespace {
void setupReply(uint16_t id,int code,const char* data,uint32_t now){
 const int n=std::snprintf(setupResponse,sizeof(setupResponse),"{\"id\":%u,\"code\":%d,\"data\":%s}",unsigned(id),code,data);
 if(n<=0||size_t(n)>kSetupMax){const int fallback=std::snprintf(setupResponse,sizeof(setupResponse),"{\"id\":%u,\"code\":503,\"data\":{\"error\":\"response_limit\"}}",unsigned(id));setupLength=size_t(fallback);}else setupLength=size_t(n);
 setupOffset=0;setupResponseAt=now;++setupSequence;
}
void setupRequest(uint32_t now){
 char* message=const_cast<char*>(setupAssembler.data());char* op=std::strchr(message,'\n');if(!op)return;*op++=0;char* form=std::strchr(op,'\n');if(!form)return;*form++=0;
 uint32_t id=0;for(const char* p=message;*p;++p){if(*p<'0'||*p>'9'||id>6553)return;id=id*10+unsigned(*p-'0');}if(!id||id>65535)return;
 const bool state=std::strcmp(op,"state")==0,unlock=std::strcmp(op,"unlock")==0,close=std::strcmp(op,"close")==0;
 if((state||unlock||close||std::strcmp(op,"scan")==0)&&*form){setupReply(id,400,"{\"error\":\"unexpected_body\"}",now);return;}
 if(unlock||close){
  portENTER_CRITICAL(&sessionMux);seenFailures=++incomingFailures;portEXIT_CRITICAL(&sessionMux);
 }
 if(unlock)setupAuthorization.request(now);
 if(close)setupAuthorization.close();
 previousAuthorization=setupAuthorization.authorized(now);
 const bool allowed=setupAuthorization.authorized(now);
 if(!state&&!unlock&&!close&&!allowed){setupReply(id,403,"{\"error\":\"physical_confirmation_required\"}",now);return;}
 const char* body="{\"error\":\"wifi_unavailable\"}";int code=503;
#if ROAST_WIFI_ENABLE
 if(provisioning){if(state||unlock||close){body=provisioning->bleState(now,allowed,setupAuthorization.pending(),setupAuthorization.remaining(now));code=200;}else code=provisioning->setupAction(op,form,now,body);}
#endif
 setupReply(id,code,body,now);
}
void setupTick(const Session& current,uint32_t now){
 uint32_t epoch,failures;portENTER_CRITICAL(&sessionMux);epoch=connectionEpoch;failures=incomingFailures;portEXIT_CRITICAL(&sessionMux);
 const bool wasAuthorized=previousAuthorization,wasPending=setupAuthorization.pending();setupAuthorization.observe(epoch,current.connection!=65535,now);
 bool confirmation=false;
#if ROAST_WIFI_ENABLE
 if(provisioning)confirmation=provisioning->takeSetupConfirmation();
#endif
 if((wasAuthorized&&!setupAuthorization.authorized(now))||(wasPending&&!setupAuthorization.pending())||confirmation){portENTER_CRITICAL(&sessionMux);failures=++incomingFailures;portEXIT_CRITICAL(&sessionMux);}
 const bool boundary=epoch!=seenConnection||failures!=seenFailures;
 if(boundary){setupAssembler.clear();setupLength=setupOffset=0;seenConnection=epoch;seenFailures=failures;}
 if(confirmation)setupAuthorization.confirm(now);
 previousAuthorization=setupAuthorization.authorized(now);
 Incoming item;unsigned limit=16;while(limit--&&xQueueReceive(incoming,&item,0)==pdTRUE){if(item.epoch==epoch&&item.generation==failures&&uint32_t(now-item.at)<10000&&setupAssembler.push(item.bytes,item.length,item.at)){setupRequest(now);setupAssembler.clear();break;}item=Incoming{};}
 if(setupLength&&uint32_t(now-setupResponseAt)>=10000){std::memset(setupResponse,0,sizeof(setupResponse));setupLength=0;}
}
}
/** 功能：同步快照、处理确认并最多排入一个有界通知；无等待或控制副作用。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void tick(const Controller& controller,uint32_t now){
 if(!ready)return;
 const Session current=readSession();stream.observe(current);setupTick(current,now);
 Receipt receipt;
 if(xQueueReceive(receipts,&receipt,0)==pdTRUE){pending=false;if(receipt.setup){if(receipt.epoch==seenConnection&&receipt.accepted&&pendingSetupEpoch==setupSequence)setupOffset+=pendingSetupPayload;}else if(receipt.epoch==current.epoch&&receipt.accepted)stream.accepted(receipt.sentAt);if(receipt.accepted){portENTER_CRITICAL(&sessionMux);lastActivityAt=receipt.sentAt;portEXIT_CRITICAL(&sessionMux);}}
 if(setupLength&&setupOffset>=setupLength){std::memset(setupResponse,0,sizeof(setupResponse));setupLength=setupOffset=0;}
 if(pending||current.connection==65535)return;
 if(attempted&&uint32_t(now-attemptedAt)<5)return;
 bool canSetup;portENTER_CRITICAL(&sessionMux);canSetup=setupSubscribed;portEXIT_CRITICAL(&sessionMux);
 // Each ready channel gets alternate attempts, including after SDK backpressure.
 // At MTU23, even a 1023-byte telemetry frame needs at most 860ms without
 // telemetry-side congestion, below its 1500ms deadline; setup has 10 seconds.
 Packet status;status.epoch=current.epoch;status.queuedAt=now;
 bool statusReady=false,statusExpired=false;
 if(current.subscribed){
  if(stream.due(now)){const size_t size=statusJson(controller,now,statusBuffer,sizeof(statusBuffer));stream.begin(statusBuffer,size,now);}
  status.length=stream.next(now,status.bytes,sizeof(status.bytes));statusExpired=stream.expired(now);statusReady=status.length||statusExpired;
 }
 const bool setupReady=canSetup&&setupLength;
 if(setupReady&&(!statusReady||(preferSetup&&!statusExpired))){
  Packet packet;packet.setup=true;packet.epoch=seenConnection;packet.generation=seenFailures;packet.queuedAt=now;const size_t count=std::min(setupLength-setupOffset,size_t(std::min(uint16_t(244),uint16_t(current.mtu-3)))-8);
  packet.length=setupFrame(setupSequence,setupLength,setupOffset,reinterpret_cast<const uint8_t*>(setupResponse)+setupOffset,count,packet.bytes,sizeof(packet.bytes));
  if(packet.length&&xQueueSend(outgoing,&packet,0)==pdTRUE){pending=true;attempted=true;attemptedAt=now;pendingSetupEpoch=setupSequence;pendingSetupPayload=count;preferSetup=false;}
 }else if(statusReady&&xQueueSend(outgoing,&status,0)==pdTRUE){pending=true;attempted=true;attemptedAt=now;preferSetup=true;}
}
}

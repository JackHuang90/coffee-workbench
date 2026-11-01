/** 功能：仅替换蓝牙/RTOS边界，运行真实esp_ble.cpp；强制SDK先初始化NPL、模拟有界队列与拥塞。
 * 首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
#pragma once
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#define CONFIG_NIMBLE_ENABLED 1
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(x) (++*(x))
#define portEXIT_CRITICAL(x) (--*(x))
using portMUX_TYPE=int;
using StackType_t=uint8_t;
constexpr int pdTRUE=1;
constexpr uint32_t portMAX_DELAY=0xffffffffu;
constexpr int BLE_ERR_REM_USER_CONN_TERM=19,BLE_HS_ENOMEM=6,BLE_HS_EBUSY=15,BLE_HS_EAGAIN=1;
/** 功能：标识测试中没有待处理消息的阻塞点。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct RelayIdle {};
/** 功能：模拟单槽队列的真实复制语义。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct StaticQueue_t {
 // 调用方提供的固定存储。
 uint8_t* storage=nullptr;
 // 每项复制字节数。
 size_t size=0;
 // 当前是否已有一个待取项目。
 bool full=false;
 unsigned capacity=1,head=0,used=0;
};
using QueueHandle_t=StaticQueue_t*;
/** 功能：记录静态任务创建，无需操作系统线程。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct StaticTask_t {};
/** 功能：记录原生SDK事件处理函数。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct ble_npl_event {
 // 等待测试驱动调度的生产回调。
 void (*callback)(ble_npl_event*)=nullptr;
};
/** 功能：模拟SDK连接信息中适配器实际读取的句柄。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct ble_gap_conn_desc {
 // 当前模拟客户端的连接句柄。
 uint16_t conn_handle=0;
 struct {bool encrypted=false,bonded=false;} sec_state;
};
/** 功能：保存主机将要消费的通知内容。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct os_mbuf {
 // 从通知复制的字节，主机调用后消费。
 std::vector<uint8_t> bytes;
};
namespace ble_test {
// 模拟主机时钟与NPL初始化顺序。
inline uint32_t now=0;
// NPL函数表是否已经由SDK初始化。
inline bool initialized=false;
inline bool encrypted=true;
// 最近成功入队的生产通知列表。
inline std::vector<std::vector<uint8_t>> notifications;
// 下一次主机通知调用的返回码；0表示成功。
inline int notifyResult=0;
inline int setupNotifyResult=0;
inline std::vector<uint16_t> notificationHandles;
// 模拟固定mbuf池分配失败。
inline bool exhaustBuffers=false;
// 已请求断开的连接数量。
inline unsigned disconnects=0;
// 创建的中继任务函数，测试按需调度。
inline void (*relay)(void*)=nullptr;
// 排入NimBLE主机但尚未执行的事件。
inline ble_npl_event* queuedEvent=nullptr;
// 声明给浏览器的特征权限。
inline uint32_t properties=0;
// SDK最终特征访问权限。
inline uint16_t permissions=0xffff;
// 已启动的广播设备名。
inline std::string deviceName;
}
/** 功能：提供测试时钟。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline uint32_t millis(){return ble_test::now;}
/** 功能：模拟硬件标识。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
struct EspStub {
 /** 功能：返回固定公开设备后缀。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 uint64_t getEfuseMac(){return 0x123456;}
};
// 模拟ESP设备身份接口。
inline EspStub ESP;
/** 功能：连接队列固定存储并检查单槽限制。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline QueueHandle_t xQueueCreateStatic(unsigned count,size_t size,uint8_t* storage,StaticQueue_t* queue){*queue={storage,size,false,count,0,0};return queue;}
/** 功能：模拟非阻塞复制入队。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline int xQueueSend(QueueHandle_t q,const void* value,uint32_t wait){assert(wait==0);if(q->used==q->capacity)return 0;std::memcpy(q->storage+((q->head+q->used)%q->capacity)*q->size,value,q->size);++q->used;q->full=q->used==q->capacity;return pdTRUE;}
/** 功能：模拟取队列，仅在中继阻塞点退出测试调度。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline int xQueueReceive(QueueHandle_t q,void* value,uint32_t wait){if(!q->used){if(wait==portMAX_DELAY)throw RelayIdle{};assert(wait==0);return 0;}std::memcpy(value,q->storage+q->head*q->size,q->size);q->head=(q->head+1)%q->capacity;--q->used;q->full=false;return pdTRUE;}
/** 功能：模拟单槽结果覆盖。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline int xQueueOverwrite(QueueHandle_t q,const void* value){std::memcpy(q->storage,value,q->size);q->head=0;q->used=1;q->full=true;return pdTRUE;}
/** 功能：保存中继任务并检查非零固定栈。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline StaticTask_t* xTaskCreateStatic(void (*fn)(void*),const char*,uint32_t size,void*,unsigned,StackType_t*,StaticTask_t* task){assert(size>=1024);ble_test::relay=fn;return task;}
/** 功能：模拟SDK NPL函数表契约，未初始化时失败。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline void ble_npl_event_init(ble_npl_event* event,void (*fn)(ble_npl_event*),void*){assert(ble_test::initialized&&"NPL event initialization requires BLEDevice::init first");event->callback=fn;}
/** 功能：返回主机事件队列标记。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline void* nimble_port_get_dflt_eventq(){return nullptr;}
/** 功能：保存已排入主机的事件，模拟延迟执行。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline void ble_npl_eventq_put(void*,ble_npl_event* event){assert(!ble_test::queuedEvent);ble_test::queuedEvent=event;}
/** 功能：复制mbuf或模拟池耗尽。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline os_mbuf* ble_hs_mbuf_from_flat(const void* data,size_t size){if(ble_test::exhaustBuffers)return nullptr;const auto* bytes=static_cast<const uint8_t*>(data);return new os_mbuf{{bytes,bytes+size}};}
/** 功能：消费mbuf，返回拥塞结果并记录成功通知。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline int ble_gatts_notify_custom(uint16_t connection,uint16_t handle,os_mbuf* buffer){assert(connection==7&&(handle==42||handle==44));const int result=handle==44&&ble_test::setupNotifyResult?ble_test::setupNotifyResult:ble_test::notifyResult;if(!result){ble_test::notifications.push_back(buffer->bytes);ble_test::notificationHandles.push_back(handle);}delete buffer;return result;}
/** 功能：记录当前BLE连接的断开请求。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
inline int ble_gap_terminate(uint16_t,int){++ble_test::disconnects;return 0;}
class BLEServer;
class BLECharacteristic;
/** 功能：模拟SDK服务器回调接口。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class BLEServerCallbacks {
 public:
 /** 功能：定义连接回调边界，默认无副作用。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 virtual void onConnect(BLEServer*,ble_gap_conn_desc*){}
 /** 功能：定义断开回调边界，默认无副作用。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 virtual void onDisconnect(BLEServer*,ble_gap_conn_desc*){}
 /** 功能：定义MTU回调边界，默认无副作用。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 virtual void onMtuChanged(BLEServer*,ble_gap_conn_desc*,uint16_t){}
};
/** 功能：模拟SDK特征订阅回调接口。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class BLECharacteristicCallbacks {
 public:
 /** 功能：定义订阅回调边界，默认无副作用。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 virtual void onSubscribe(BLECharacteristic*,ble_gap_conn_desc*,uint16_t){}
 virtual void onWrite(BLECharacteristic*,ble_gap_conn_desc*){}
};
/** 功能：保存适配器实际注册的权限及回调。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class BLECharacteristic {
 public:
 // 模拟SDK通知属性位。
 static constexpr uint32_t PROPERTY_NOTIFY=0x10, PROPERTY_WRITE=8, PROPERTY_WRITE_ENC=0x100;
 uint32_t properties=0;
 uint16_t handle=42;
 std::string value;
 std::string getValue()const{return value;}
 // 注册的生产订阅回调。
 BLECharacteristicCallbacks* callbacks=nullptr;
 /** 功能：保存特征访问权限供验证。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void setAccessPermissions(uint16_t value){ble_test::permissions=value;}
 /** 功能：保存生产特征回调对象。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void setCallbacks(BLECharacteristicCallbacks* value){callbacks=value;}
 /** 功能：返回已注册特征的固定句柄。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 uint16_t getHandle()const{return handle;}
};
/** 功能：模拟服务中唯一通知特征。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class BLEService {
 public:
 // 服务拥有的唯一通知特征。
 BLECharacteristic characteristic,setupWrite,setupNotify;
 /** 功能：记录生产注册的特征属性。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 BLECharacteristic* createCharacteristic(const char* uuid,uint32_t value){ble_test::properties=value;auto* c=std::strstr(uuid,"a003")?&setupWrite:std::strstr(uuid,"a004")?&setupNotify:&characteristic;c->properties=value;c->handle=c==&setupNotify?44:42;return c;}
 /** 功能：模拟成功注册服务或服务器。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void start(){}
};
/** 功能：模拟注册服务与连接回调。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class BLEServer {
 public:
 // 注册的生产连接回调。
 BLEServerCallbacks* callbacks=nullptr;
 // 测试服务器拥有的单服务。
 BLEService service;
 /** 功能：保存生产服务器回调对象。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void setCallbacks(BLEServerCallbacks* value){callbacks=value;}
 /** 功能：接收SDK断开广播策略配置。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void advertiseOnDisconnect(bool){}
 /** 功能：返回唯一测试服务。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 BLEService* createService(const char*){return &service;}
 /** 功能：模拟成功注册服务或服务器。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void start(){}
};
/** 功能：模拟广播初始化返回值。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class BLEAdvertising {
 public:
 /** 功能：接收服务UUID广播配置。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void addServiceUUID(const char*){}
 /** 功能：接收扫描响应配置。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 void setScanResponse(bool){}
 /** 功能：模拟成功启动广播。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 bool start(){return true;}
};
/** 功能：模拟SDK先初始化后注册的生命周期。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
class BLESecurityCallbacks;
class BLEDevice {
 public:
 // SDK全局服务器实例。
 inline static BLEServer server;
 inline static BLESecurityCallbacks* securityCallbacks=nullptr;
 static void setSecurityCallbacks(BLESecurityCallbacks* callbacks){securityCallbacks=callbacks;}
 // SDK全局广播实例。
 inline static BLEAdvertising advertising;
 /** 功能：安装NPL可调用状态并保存设备名。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 static bool init(const char* name){ble_test::initialized=true;ble_test::deviceName=name;return true;}
 /** 功能：接收本地MTU配置，实际协商由回调驱动。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 static void setMTU(unsigned){}
 /** 功能：返回固定测试服务器。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 static BLEServer* createServer(){return &server;}
 /** 功能：返回固定测试广播对象。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
 static BLEAdvertising* getAdvertising(){return &advertising;}
};

inline int ble_gap_conn_find(uint16_t handle,ble_gap_conn_desc* d){d->conn_handle=handle;d->sec_state.encrypted=ble_test::encrypted;return 0;}

constexpr int BLE_GAP_EVENT_DISCONNECT=1;
struct ble_gap_event {int type=0;struct {int reason=0;ble_gap_conn_desc conn{};} disconnect;};
using ble_gap_event_fn=int(ble_gap_event*,void*);
struct ble_gap_event_listener {ble_gap_event_fn* fn=nullptr;void* arg=nullptr;};
namespace ble_test {inline ble_gap_event_listener* gapListener=nullptr;}
inline int ble_gap_event_listener_register(ble_gap_event_listener* listener,ble_gap_event_fn* fn,void* arg){listener->fn=fn;listener->arg=arg;ble_test::gapListener=listener;return 0;}

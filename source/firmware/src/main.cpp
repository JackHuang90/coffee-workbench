/** 功能：USB、HTTP、Modbus、只读BLE与配网主循环；继续只绑定虚拟/空输出。
 * 首次编写日期：未知（历史代码）；变更日期：2026-10-30
 * 修改记录：2026-10-29：加入热点配网、独立页面传输和只读CORS，保持控制tick优先。
 * - 2026-10-30：加入只读BLE；无线初始化先于看门狗与首个控制tick。 */
#include <Arduino.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <new>
#include <cstring>
#include <cstdio>
#include <algorithm>
#include "roast/core.hpp"
#include "roast/protocol.hpp"
#include "roast/http.hpp"
#include "roast/modbus.hpp"
#include "roast/reply_drain.hpp"
#include "roast/esp_ble.hpp"
#include "roast/esp_indicator.hpp"
#if __has_include("local_config.h")
#include "local_config.h"
#endif
#ifndef ROAST_WIFI_ENABLE
#define ROAST_WIFI_ENABLE 0
#endif
#ifndef ROAST_HTTP_TOKEN
#define ROAST_HTTP_TOKEN ""
#endif
#if ROAST_WIFI_ENABLE
#include <WiFi.h>
#include <lwip/sockets.h>
#include "roast/esp_provisioning.hpp"
#endif
static_assert(ROAST_VIRTUAL_DEMO==0||ROAST_VIRTUAL_DEMO==1,"Only LOCKED or VIRTUAL_DEMO builds exist");
namespace {
roast::VirtualPlant plant;
roast::NullOutput nullOutput;
alignas(roast::Controller) unsigned char controllerStorage[sizeof(roast::Controller)];
roast::Controller* controller=nullptr;
roast::LineFramer usbFrame;
char usbTx[roast::kResponseSize+2]{};size_t usbSize=0,usbSent=0;
bool watchdogAdded=false;
roast::indicator::EspIndicator rgb;
size_t networkStatusJson(char* out,size_t capacity);
#if ROAST_WIFI_ENABLE
roast::net::EspProvisioning provisioning;
#endif
void queueUsb(const char* data,size_t length){
 length=std::min(length,sizeof(usbTx)-2);std::memcpy(usbTx,data,length);usbTx[length++]='\n';usbSize=length;usbSent=0;
}
/** 功能：加入显式USB SETUP凭据查询。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：加入显式USB SETUP凭据查询。 */
void usbWork(uint32_t now){
 if(usbSent<usbSize){
  const int room=Serial.availableForWrite();
  if(room>0){const size_t amount=std::min({usbSize-usbSent,static_cast<size_t>(room),size_t{64}});usbSent+=Serial.write(reinterpret_cast<const uint8_t*>(usbTx+usbSent),amount);}
  return; // Backpressure: never execute another command before its response can be queued.
 }
 if(usbFrame.expire(now)){const char* msg="{\"ok\":false,\"code\":\"frame_timeout\"}";queueUsb(msg,std::strlen(msg));return;}
 for(unsigned budget=0;budget<64&&Serial.available()>0;budget++){
  const auto result=usbFrame.feed(static_cast<char>(Serial.read()),now);
  if(result==roast::LineFramer::Result::Rejected){const char* msg="{\"ok\":false,\"code\":\"bad_frame\"}";queueUsb(msg,std::strlen(msg));break;}
  if(result==roast::LineFramer::Result::Line){
   // 显式USB只读诊断不依赖控制授权，也不加入正常遥测。
   if(std::strcmp(usbFrame.data(),"BLEDIAG")==0){char response[roast::kResponseSize]{};queueUsb(response,roast::ble::diagnostics(response,sizeof(response),now));break;}
   #if ROAST_WIFI_ENABLE
   if(std::strcmp(usbFrame.data(),"SETUP")==0){char response[roast::kResponseSize]{};queueUsb(response,provisioning.setupInfo(response,sizeof(response)));break;}
#endif
   if(std::strcmp(usbFrame.data(),"NETWORK")==0){char response[roast::kResponseSize]{};queueUsb(response,networkStatusJson(response,sizeof(response)));break;}
   if(!watchdogAdded&&std::strcmp(usbFrame.data(),"HELLO")!=0&&std::strcmp(usbFrame.data(),"STATUS")!=0){const char* msg="{\"ok\":false,\"code\":\"watchdog_unavailable\"}";queueUsb(msg,std::strlen(msg));break;}
   char response[roast::kResponseSize]{};size_t length=roast::respond(*controller,usbFrame.data(),usbFrame.size(),now,response,sizeof(response),roast::CommandSource::Usb);queueUsb(response,length);break;}
 }
}
#if ROAST_WIFI_ENABLE
WiFiServer httpServer(80),modbusServer(502);
WiFiClient httpClient,modbusClient;
roast::HttpRequest httpRequest;roast::net::PortalRequest portalRequest;roast::TcpFramer modbusFrame;
char httpTx[roast::kResponseSize+1024]{};size_t httpSize=0,httpSent=0;uint32_t httpAt=0;
const char* httpBody=nullptr;size_t httpBodySize=0,httpBodySent=0;
uint32_t networkEpoch=0;
uint8_t modbusTx[260]{};size_t modbusSize=0,modbusSent=0;uint32_t modbusAt=0;
bool serversRunning=false;
roast::AuthorizationBoundary modbusBoundary;
roast::ReplyDrain modbusDrain;
// Bypass Print's potentially blocking TCP retry loop. One nonblocking 64-byte send per loop.
size_t sendSome(WiFiClient& client,const void* data,size_t length){
 const int sent=lwip_send(client.fd(),data,std::min(length,size_t{64}),MSG_DONTWAIT);
 return sent>0?static_cast<size_t>(sent):0;
}
/** 功能：丢弃旧HTTP请求及页面发送状态。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：增加门户和独立正文清理。 */
void closeHttp(){httpClient.stop();httpRequest.reset();portalRequest.reset();httpSize=httpSent=0;httpBody=nullptr;httpBodySize=httpBodySent=0;}
void closeModbus();
/** 功能：排队固定响应或Flash页面，状态CORS只使用已授权来源。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：独立有界头部与页面发送，不扩容命令正文。 */
void httpReply(int code,const char* reason,const char* body,size_t length,const char* type="application/json",bool portal=false){
 char cors[640]{};
 if(portal&&code==302)std::snprintf(cors,sizeof(cors),"Location: http://%s/\r\n",WiFi.softAPIP().toString().c_str());
 if(!portal&&httpRequest.corsOrigin()[0])std::snprintf(cors,sizeof(cors),"Access-Control-Allow-Origin: %s\r\n%s%s",httpRequest.corsOrigin(),httpRequest.preflight()?"Access-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: Accept\r\n":"",httpRequest.preflight()&&httpRequest.privateNetwork()?"Access-Control-Allow-Private-Network: true\r\n":"");
 const int header=std::snprintf(httpTx,sizeof(httpTx),"HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %u\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nVary: Origin\r\n%s\r\n",code,reason,type,static_cast<unsigned>(length),cors);
 if(header<0||static_cast<size_t>(header)>=sizeof(httpTx)){closeHttp();return;}
 httpSize=static_cast<size_t>(header);httpSent=0;httpBodySize=length;httpBodySent=0;
 if(!portal){if(httpSize+length>sizeof(httpTx)){closeHttp();return;}std::memcpy(httpTx+httpSize,body,length);httpBody=httpTx+httpSize;}else httpBody=body;
}
/** 功能：单连接有界HTTP调度；门户请求单独解析，AP+STA按socket本地接口隔离。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：接入门户与预检，不阻塞控制tick。 */
void httpWork(uint32_t now){
 if(!httpClient){httpClient=httpServer.accept();if(httpClient){httpRequest.reset();portalRequest.reset();httpSize=httpSent=0;httpBodySize=httpBodySent=0;httpAt=now;}}
 if(!httpClient)return;
 if(static_cast<uint32_t>(now-httpAt)>(httpSize?15000u:3500u)){closeHttp();return;}
 if(httpSize){if(httpSent<httpSize)httpSent+=sendSome(httpClient,httpTx+httpSent,httpSize-httpSent);else if(httpBodySent<httpBodySize)httpBodySent+=sendSome(httpClient,httpBody+httpBodySent,httpBodySize-httpBodySent);if(httpSent==httpSize&&httpBodySent==httpBodySize)closeHttp();return;}
 auto result=httpRequest.expire(now);auto portal=portalRequest.expire(now);
 using P=roast::net::PortalRequest::Result;
 for(unsigned budget=0;budget<64&&httpClient.available()>0;budget++){
  if(portal!=P::Pending&&portal!=P::Legacy)break;
  if(portal==P::Legacy&&result!=roast::HttpRequest::Result::Pending)break;
  const char c=static_cast<char>(httpClient.read());portal=portalRequest.feed(c,now);result=httpRequest.feed(c,now,ROAST_HTTP_TOKEN,&provisioning.config());
 }
 if(portal==P::Pending)return;
 if(portal==P::Complete){
  const char* body=nullptr;const char* type=nullptr;
  const auto peer=httpClient.remoteIP();const auto ap=WiFi.softAPIP();
  const bool localAp=provisioning.apActive()&&httpClient.localIP()==ap&&peer[0]==ap[0]&&peer[1]==ap[1]&&peer[2]==ap[2]&&peer[3]!=0&&peer[3]!=255;
  const int code=provisioning.handle(portalRequest,localAp,now,body,type);
  if(networkEpoch!=provisioning.epoch()){networkEpoch=provisioning.epoch();closeModbus();}
  httpReply(code,code<400?"OK":"Setup Rejected",body,std::strlen(body),type,true);return;
 }
 if(portal!=P::Legacy){const char* error="{\"ok\":false,\"code\":\"portal_rejected\"}";httpReply(portal==P::TooLarge?413:400,"Bad Request",error,std::strlen(error));return;}
 if(result==roast::HttpRequest::Result::Pending)return;
 if(result==roast::HttpRequest::Result::Complete){
  char response[roast::kResponseSize]{};size_t length=0;
  if(httpRequest.preflight()){httpReply(204,"No Content","",0);return;}
  if(httpRequest.command()){
   if(!watchdogAdded){const char* error="{\"ok\":false,\"code\":\"watchdog_unavailable\"}";httpReply(503,"Service Unavailable",error,std::strlen(error));return;}
   if(!roast::kDemoBuild){const char* locked="{\"ok\":false,\"code\":\"hardware_locked\"}";httpReply(403,"Forbidden",locked,std::strlen(locked));return;}
   length=roast::respond(*controller,httpRequest.body(),httpRequest.bodySize(),now,response,sizeof(response),roast::CommandSource::Http);
  }else length=roast::statusJson(*controller,now,response,sizeof(response));
  httpReply(200,"OK",response,length);return;
 }
 int code=400;const char* reason="Bad Request";
 using R=roast::HttpRequest::Result;
 if(result==R::Forbidden){code=403;reason="Forbidden";}
 if(result==R::NotFound){code=404;reason="Not Found";}
 if(result==R::MethodNotAllowed){code=405;reason="Method Not Allowed";}
 if(result==R::TooLarge){code=413;reason="Content Too Large";}
 if(result==R::Timeout){code=408;reason="Request Timeout";}
 const char* error="{\"ok\":false,\"code\":\"http_rejected\"}";httpReply(code,reason,error,std::strlen(error));
}
void closeModbus(){modbusClient.stop();modbusFrame.reset();modbusSize=modbusSent=0;modbusDrain.cancel();}
void modbusWork(uint32_t now){
 if(modbusDrain.active()){
  const auto action=modbusDrain.poll(now,static_cast<bool>(modbusClient),modbusSent<modbusSize);
  if(action==roast::ReplyDrain::Action::SendOnly){modbusSent+=sendSome(modbusClient,modbusTx+modbusSent,modbusSize-modbusSent);if(modbusSent==modbusSize)closeModbus();}
  else closeModbus();
  return; // Revoked: acknowledge only; never read or execute another request.
 }
 if(!modbusClient){modbusClient=modbusServer.accept();if(modbusClient){modbusFrame.reset();modbusSize=modbusSent=0;modbusAt=now;}}
 if(!modbusClient)return;
 if(static_cast<uint32_t>(now-modbusAt)>roast::kLeaseMs+1000||modbusFrame.expire(now)){closeModbus();return;}
 if(modbusSize){modbusSent+=sendSome(modbusClient,modbusTx+modbusSent,modbusSize-modbusSent);if(modbusSent==modbusSize){modbusFrame.reset();modbusSize=modbusSent=0;modbusAt=now;}return;}
 for(unsigned budget=0;budget<64&&modbusClient.available()>0;budget++){
  const auto result=modbusFrame.feed(static_cast<uint8_t>(modbusClient.read()),now);
  if(result==roast::TcpFramer::Result::Rejected){closeModbus();return;}
  if(result==roast::TcpFramer::Result::Complete){modbusSize=roast::handleModbus(modbusFrame.data(),modbusFrame.size(),modbusTx,sizeof(modbusTx),*controller,now);modbusSent=0;if(!modbusSize)closeModbus();return;}
 }
}
/** 功能：在主循环接入配网调度并隔离旧客户端。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：在主循环接入配网调度并隔离旧客户端。 */
void networkWork(uint32_t now){
 provisioning.tick(now);
 if(networkEpoch!=provisioning.epoch()){networkEpoch=provisioning.epoch();closeHttp();closeModbus();}
 const auto snapshot=controller->snapshot(now);
 const bool owned=snapshot.owner==roast::Owner::ModbusPower||snapshot.owner==roast::Owner::ModbusSv;
 const auto boundary=modbusBoundary.observe(owned,snapshot.authorizationGeneration);
 if(boundary!=roast::AuthorizationBoundary::Event::None){
  // New grants discard all preauthorization traffic immediately. A revocation
  // may drain one bounded reply already queued (e.g. the FC06 STOP ACK).
  if(boundary==roast::AuthorizationBoundary::Event::NewGrant||!modbusClient||modbusSent==modbusSize)closeModbus();
  else modbusDrain.begin(now);
  if(serversRunning){modbusServer.end();modbusServer.begin();}
 }
 if(WiFi.status()!=WL_CONNECTED&&!provisioning.apActive()){if(serversRunning){closeHttp();closeModbus();httpServer.end();modbusServer.end();serversRunning=false;controller->transportLost(now);}return;}
 if(!serversRunning){httpServer.begin();modbusServer.begin();serversRunning=true;}
 httpWork(now);if(WiFi.status()==WL_CONNECTED)modbusWork(now);else closeModbus();
}
#endif
/** 功能：从持久配网读取状态而不输出密码。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：从持久配网读取状态而不输出密码。 */
size_t networkStatusJson(char* out,size_t capacity){
 bool configured=false,connected=false;char ip[20]="null";
#if ROAST_WIFI_ENABLE
 configured=provisioning.configured();connected=WiFi.status()==WL_CONNECTED;
 if(connected){const auto address=WiFi.localIP();std::snprintf(ip,sizeof(ip),"\"%u.%u.%u.%u\"",address[0],address[1],address[2],address[3]);}
#endif
 const int n=std::snprintf(out,capacity,"{\"v\":1,\"kind\":\"network\",\"wifi_compiled\":%s,\"configured\":%s,\"connected\":%s,\"local_ip\":%s,\"http_port\":80,\"modbus_port\":502,\"physical_enabled\":false}",ROAST_WIFI_ENABLE?"true":"false",configured?"true":"false",connected?"true":"false",ip);
 if(n<0||static_cast<size_t>(n)>=capacity){if(capacity)out[0]=0;return 0;}return static_cast<size_t>(n);
}
// Main-loop snapshots only: indicator never changes control or network state.
void indicatorWork(uint32_t now){
 const auto snapshot=controller->snapshot(now);
 const auto link=roast::ble::linkState();
 roast::indicator::Inputs inputs;
 inputs.boot=true;
 inputs.error=!watchdogAdded||snapshot.state==roast::State::Fault;
 inputs.bleConnected=link.connected;inputs.bleSubscribed=link.subscribed;
 inputs.setupPending=link.setupPending;inputs.setupAuthorized=link.setupAuthorized;
 inputs.curveReceiving=controller->receivingCurve();
 inputs.curveLoaded=controller->curve().count>0;
 inputs.simulationRunning=roast::kDemoBuild&&(snapshot.state==roast::State::Running||snapshot.state==roast::State::ArtisanPower||snapshot.state==roast::State::ArtisanSv||snapshot.state==roast::State::Manual);
 inputs.dataTransfer=link.lastActivityAt&&uint32_t(now-link.lastActivityAt)<200;
#if ROAST_WIFI_ENABLE
 inputs.reset=provisioning.resetArmed();
 inputs.error=inputs.error||provisioning.hasError();
 inputs.configured=provisioning.configured();
 inputs.wifiConnected=WiFi.status()==WL_CONNECTED;
 inputs.wifiConnecting=provisioning.state()==roast::net::State::Connecting||provisioning.state()==roast::net::State::Testing;
#endif
 rgb.tick(inputs,now);
}
}
/** 功能：默认启动配网和只读BLE并保持空/虚拟输出。首次编写日期：未知（历史代码）；变更日期：2026-10-30；修改记录：2026-10-29：默认启动持久配网并保持空/虚拟输出。2026-10-30：无线启动在看门狗及控制计时前完成。 */
void setup(){
 rgb.begin(millis());
 roast::indicator::Inputs starting;starting.boot=true;rgb.tick(starting,millis());
 Serial.begin(115200); // Native USB CDC. No UART/RS485 or actuator pins are initialized.
 Serial.setTxTimeoutMs(0); // Never block the control scheduler on host backpressure.
 uint32_t session=esp_random();if(!session)session=1;
 roast::OutputPort& port=roast::kDemoBuild?static_cast<roast::OutputPort&>(plant):static_cast<roast::OutputPort&>(nullOutput);
 controller=new(controllerStorage) roast::Controller(port,session);
 roast::ble::begin(); // Failure leaves Wi-Fi/USB available; no reboot or control authorization.
 rgb.tick(starting,millis());
#if ROAST_WIFI_ENABLE
 provisioning.begin(*controller,millis());
 roast::ble::attachProvisioning(&provisioning);
#endif
 esp_task_wdt_config_t wdt{};wdt.timeout_ms=2000;wdt.idle_core_mask=0;wdt.trigger_panic=true;
 esp_err_t configured=esp_task_wdt_init(&wdt);
 if(configured==ESP_ERR_INVALID_STATE)configured=esp_task_wdt_reconfigure(&wdt);
 if(configured==ESP_OK){const esp_err_t add=esp_task_wdt_add(nullptr);watchdogAdded=add==ESP_OK||esp_task_wdt_status(nullptr)==ESP_OK;}
 if(!watchdogAdded)controller->forceStop(millis(),"watchdog_unavailable");
 controller->tick(millis(),roast::kDemoBuild?plant.step(millis()):roast::Sensor{});
 char status[roast::kResponseSize]{};queueUsb(status,roast::statusJson(*controller,millis(),status,sizeof(status)));
}
/** 功能：保留tick优先和无联网等待。首次编写日期：未知（历史代码）；变更日期：2026-10-30；修改记录：2026-10-29：保留tick优先和无联网等待。2026-10-30：每轮增加有界只读BLE调度。 */
void loop(){
 const uint32_t now=millis();
 if(watchdogAdded&&esp_task_wdt_reset()!=ESP_OK)watchdogAdded=false;
 if(!watchdogAdded)controller->forceStop(now,"watchdog_unavailable");
 controller->tick(now,roast::kDemoBuild?plant.step(now):roast::Sensor{});
 usbWork(now);
#if ROAST_WIFI_ENABLE
 networkWork(now);
#endif
 roast::ble::tick(*controller,now);
 indicatorWork(now);
 yield(); // No delay loops or waits for USB/Wi-Fi connection.
}

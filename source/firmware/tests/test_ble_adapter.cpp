/** 功能：执行真实BLE适配器，验证初始化顺序、队列边界、拥塞及控制隔离。
 * 首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
#include "ble_sdk_stub.hpp"
#include "BLESecurity.h"
#include "roast/esp_ble.hpp"
#include "roast/core.hpp"
#include "roast/ble_setup.hpp"
#include <iostream>
#include <cstdlib>
/** 功能：单步调度中继并执行一个主机事件。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void pump(){try{ble_test::relay(nullptr);}catch(const RelayIdle&){}if(ble_test::queuedEvent){auto* event=ble_test::queuedEvent;ble_test::queuedEvent=nullptr;event->callback(event);}}
// 只读取生产诊断JSON的整数字段，不构造替代协议实现。
unsigned long diagnosticNumber(const char* json,const char* key){const std::string field=std::string("\"")+key+"\":";const char* value=std::strstr(json,field.c_str());assert(value);return std::strtoul(value+field.size(),nullptr,10);}
/** 功能：运行适配器状态路径，使用真实Controller及编码器。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
int main(){
 char diagnostic[1024]{};char tiny[8];std::memset(tiny,'x',sizeof(tiny));
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),0)>0);assert(std::strstr(diagnostic,"\"kind\":\"ble_diagnostics\""));assert(std::strstr(diagnostic,"\"connections\":0"));assert(std::strstr(diagnostic,"\"diagnostic_version\":2"));assert(std::strstr(diagnostic,"\"last_auth_status\":-1"));assert(!roast::ble::diagnostics(tiny,sizeof(tiny),0)&&tiny[0]==0);assert(!roast::ble::diagnostics(nullptr,0,0));assert(diagnosticNumber(diagnostic,"setup_writes")==0);assert(diagnosticNumber(diagnostic,"setup_replies")==0);
 assert(roast::ble::begin());assert(!roast::ble::linkState().connected);assert(BLEDevice::server.service.setupWrite.properties&(BLECharacteristic::PROPERTY_WRITE_ENC));assert(ble_test::properties==0x10&&ble_test::permissions==0);assert(ble_test::deviceName=="Coffee-123456");
 // 订阅恢复若先于应用连接登记到达，仅标记被忽略，不改变既有订阅策略。
 auto& earlySetup=BLEDevice::server.service.setupNotify;ble_gap_conn_desc earlyPeer{7,{}};earlySetup.callbacks->onSubscribe(&earlySetup,&earlyPeer,1);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),0));assert(diagnosticNumber(diagnostic,"setup_reject_stage")==13);assert(std::strstr(diagnostic,"\"setup_subscribed\":false"));assert(diagnosticNumber(diagnostic,"connections")==0);assert(BLESecurity::requests==0);
 roast::VirtualPlant plant;roast::Controller controller(plant,77);controller.tick(0,plant.step(0));
 auto& server=BLEDevice::server;auto& characteristic=server.service.characteristic;ble_gap_conn_desc peer{7,{}},extra{8,{}};
 server.callbacks->onConnect(&server,&peer);server.callbacks->onConnect(&server,&extra);assert(ble_test::disconnects==1);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),0));assert(std::strstr(diagnostic,"\"connected\":true"));assert(std::strstr(diagnostic,"\"connections\":2"));assert(std::strstr(diagnostic,"\"local_close_reason\":\"extra_connection\""));
 assert(BLEDevice::securityCallbacks);assert(!BLEDevice::securityCallbacks->onConfirmPIN(123456));assert(!BLEDevice::securityCallbacks->onAuthorizationRequest(7,42,true));
 peer.sec_state.encrypted=peer.sec_state.bonded=true;BLEDevice::securityCallbacks->onAuthenticationComplete(&peer,0);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),0));assert(std::strstr(diagnostic,"\"encrypted\":true"));assert(std::strstr(diagnostic,"\"bonded\":true"));assert(std::strstr(diagnostic,"\"auth_events\":1"));assert(std::strstr(diagnostic,"\"last_auth_status\":0"));
 peer.sec_state.encrypted=peer.sec_state.bonded=false;BLEDevice::securityCallbacks->onAuthenticationComplete(&peer,17);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),0));assert(std::strstr(diagnostic,"\"auth_events\":2"));assert(std::strstr(diagnostic,"\"last_auth_status\":17"));
 roast::ble::tick(controller,0);pump();assert(ble_test::notifications.empty());
 characteristic.callbacks->onSubscribe(&characteristic,&peer,1);
 roast::ble::tick(controller,0);assert(ble_test::notifications.empty());pump();assert(ble_test::notifications.size()==1);assert(ble_test::notifications.back().size()==20);
 ble_test::now=5;roast::ble::tick(controller,5);ble_test::notifyResult=BLE_HS_ENOMEM;pump();assert(ble_test::notifications.size()==1);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),5));assert(std::strstr(diagnostic,"\"last_notify_error\":6"));
 ble_test::notifyResult=0;ble_test::now=10;roast::ble::tick(controller,10);pump();assert(ble_test::notifications.size()==2);assert(ble_test::notifications.back()[6]==12);
 ble_test::now=15;roast::ble::tick(controller,15);
 characteristic.callbacks->onSubscribe(&characteristic,&peer,0);characteristic.callbacks->onSubscribe(&characteristic,&peer,1);pump();assert(ble_test::notifications.size()==2);
 ble_test::now=1000;controller.tick(1000,plant.step(1000));roast::ble::tick(controller,1000);pump();assert(ble_test::notifications.size()==3&&ble_test::notifications.back()[6]==0);
 ble_test::now=1005;roast::ble::tick(controller,1005);ble_test::exhaustBuffers=true;pump();assert(ble_test::notifications.size()==3);
 ble_test::now=1010;roast::ble::tick(controller,1010);ble_test::exhaustBuffers=false;pump();assert(ble_test::notifications.size()==4&&ble_test::notifications.back()[6]==12);
 ble_test::now=1015;roast::ble::tick(controller,1015);ble_test::now=1116;pump();assert(ble_test::disconnects==1);assert(ble_test::notifications.size()==4);
 assert(controller.snapshot(1116).owner==roast::Owner::None);
 server.callbacks->onDisconnect(&server,&peer);server.callbacks->onConnect(&server,&peer);
 ble_test::now=2000;controller.tick(2000,plant.step(2000));roast::ble::tick(controller,2000);pump();assert(ble_test::notifications.size()==4);
 characteristic.callbacks->onSubscribe(&characteristic,&peer,1);server.callbacks->onMtuChanged(&server,&peer,247);roast::ble::tick(controller,2000);pump();assert(ble_test::notifications.size()==5&&ble_test::notifications.back().size()==244);
 characteristic.callbacks->onSubscribe(&characteristic,&peer,0);ble_test::now=2010;roast::ble::tick(controller,2010);pump();
 auto& setupWrite=server.service.setupWrite;auto& setupNotify=server.service.setupNotify;
 assert(BLESecurity::requests==0); // Ordinary telemetry must not force pairing.
 BLESecurity::startRc=23;setupNotify.callbacks->onSubscribe(&setupNotify,&peer,1);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),2010));assert(std::strstr(diagnostic,"\"security_start_rc\":23"));assert(std::strstr(diagnostic,"\"setup_subscribed\":true"));BLESecurity::startRc=0;
 assert(BLESecurity::requests==1&&BLESecurity::handle==peer.conn_handle&&BLESecurity::bonding);
 setupNotify.callbacks->onSubscribe(&setupNotify,&extra,1);
 assert(BLESecurity::requests==1); // Another peer cannot initiate security on this session.
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),2010));assert(diagnosticNumber(diagnostic,"setup_reject_stage")==13);assert(std::strstr(diagnostic,"\"setup_subscribed\":true"));
 uint8_t command[32];const char* request="12\nscan\n";const size_t commandSize=roast::ble::setupFrame(12,8,0,reinterpret_cast<const uint8_t*>(request),8,command,sizeof(command));
 setupWrite.value.assign(reinterpret_cast<char*>(command),commandSize);const auto before=ble_test::notifications.size();
 setupWrite.callbacks->onWrite(&setupWrite,&peer);assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),2020));assert(diagnosticNumber(diagnostic,"setup_writes")==1);assert(diagnosticNumber(diagnostic,"setup_queued")==0);assert(diagnosticNumber(diagnostic,"setup_reject_stage")==1);ble_test::now=2020;roast::ble::tick(controller,2020);pump();assert(ble_test::notifications.size()==before);
 peer.sec_state.encrypted=true;setupWrite.callbacks->onWrite(&setupWrite,&peer);assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),2030));assert(diagnosticNumber(diagnostic,"setup_writes")==2);assert(diagnosticNumber(diagnostic,"setup_write_length")==commandSize);assert(diagnosticNumber(diagnostic,"setup_queued")==1);assert(diagnosticNumber(diagnostic,"setup_complete_requests")==0);ble_test::now=2030;roast::ble::tick(controller,2030);pump();assert(ble_test::notifications.size()==before+1);
 roast::ble::SetupAssembler assembled;const auto& response=ble_test::notifications.back();assert(assembled.push(response.data(),response.size(),2030));assert(std::strstr(assembled.data(),"\"id\":12"));assert(std::strstr(assembled.data(),"\"code\":403"));assert(!std::strstr(assembled.data(),"password"));assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),2030));assert(diagnosticNumber(diagnostic,"setup_complete_requests")==1);assert(diagnosticNumber(diagnostic,"setup_replies")==1);assert(diagnosticNumber(diagnostic,"setup_last_code")==403);assert(diagnosticNumber(diagnostic,"setup_notifications")==1);assert(diagnosticNumber(diagnostic,"setup_reject_stage")==8);
 ble_test::now=2040;roast::ble::tick(controller,2040);pump();assert(ble_test::notifications.size()==before+1);
 setupWrite.callbacks->onWrite(&setupWrite,&peer);ble_test::encrypted=false;ble_test::now=2050;roast::ble::tick(controller,2050);pump();assert(ble_test::notifications.size()==before+1);
 ble_test::encrypted=true;server.callbacks->onDisconnect(&server,&peer);ble_test::now=2060;roast::ble::tick(controller,2060);pump();assert(!roast::ble::linkState().setupAuthorized);assert(!roast::ble::linkState().connected);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),2060));assert(std::strstr(diagnostic,"\"encrypted\":false"));assert(std::strstr(diagnostic,"\"bonded\":false"));assert(std::strstr(diagnostic,"\"subscribed\":false"));assert(std::strstr(diagnostic,"\"setup_subscribed\":false"));
 // A congested setup response must not starve an in-progress MTU23 telemetry frame.
 server.callbacks->onConnect(&server,&peer);characteristic.callbacks->onSubscribe(&characteristic,&peer,1);setupNotify.callbacks->onSubscribe(&setupNotify,&peer,1);
 ble_test::now=3000;roast::ble::tick(controller,3000);pump();const auto telemetryStart=ble_test::notificationHandles.size();const auto disconnectStart=ble_test::disconnects;
 setupWrite.callbacks->onWrite(&setupWrite,&peer);ble_test::setupNotifyResult=BLE_HS_ENOMEM;
 for(uint32_t now=3005;now<=4700;now+=5){ble_test::now=now;roast::ble::tick(controller,now);pump();}
 size_t telemetryProgress=0;for(size_t i=telemetryStart;i<ble_test::notificationHandles.size();++i)if(ble_test::notificationHandles[i]==42)++telemetryProgress;
 assert(telemetryProgress>1);assert(ble_test::disconnects==disconnectStart);
 roast::ble::SetupAssembler concurrentTelemetry;bool telemetryComplete=false;for(size_t i=telemetryStart-1;i<ble_test::notifications.size()&&!telemetryComplete;++i)if(ble_test::notificationHandles[i]==42){const auto& fragment=ble_test::notifications[i];telemetryComplete=concurrentTelemetry.push(fragment.data(),fragment.size(),4700);}assert(telemetryComplete);
 ble_test::setupNotifyResult=0;
 for(uint32_t now=4705;now<=5000;now+=5){ble_test::now=now;roast::ble::tick(controller,now);pump();}
 assert(ble_test::disconnects==disconnectStart);bool setupDelivered=false;for(size_t i=telemetryStart;i<ble_test::notificationHandles.size();++i)if(ble_test::notificationHandles[i]==44)setupDelivered=true;assert(setupDelivered);
 // Global SDK congestion may expire snapshots; it must never tear down BLE.
 const auto beforeStall=ble_test::notifications.size();const uint16_t stalledSequence=ble_test::notifications.back()[2]|uint16_t(ble_test::notifications.back()[3])<<8;ble_test::notifyResult=BLE_HS_ENOMEM;
 for(uint32_t now=5005;now<=7005;now+=5){ble_test::now=now;roast::ble::tick(controller,now);pump();}
 assert(ble_test::disconnects==disconnectStart);assert(ble_test::notifications.size()==beforeStall);assert(roast::ble::linkState().connected);
 ble_test::notifyResult=0;ble_test::now=7010;roast::ble::tick(controller,7010);pump();assert(ble_test::notifications.size()==beforeStall+1);assert(ble_test::notifications.back()[6]==0&&ble_test::notifications.back()[7]==0);assert((ble_test::notifications.back()[2]|uint16_t(ble_test::notifications.back()[3])<<8)!=stalledSequence);
 for(uint32_t now=7015;now<=7600;now+=5){ble_test::now=now;roast::ble::tick(controller,now);pump();}
 roast::ble::SetupAssembler recovered;bool recoveredComplete=false;for(size_t i=beforeStall;i<ble_test::notifications.size()&&!recoveredComplete;++i)if(ble_test::notificationHandles[i]==42){const auto& fragment=ble_test::notifications[i];recoveredComplete=recovered.push(fragment.data(),fragment.size(),7600);}assert(recoveredComplete);assert(ble_test::disconnects==disconnectStart);
 ble_gap_event disconnected{};disconnected.type=BLE_GAP_EVENT_DISCONNECT;disconnected.disconnect.conn=peer;disconnected.disconnect.reason=531;
 assert(ble_test::gapListener);assert(ble_test::gapListener->fn(&disconnected,ble_test::gapListener->arg)==0);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),7600));assert(std::strstr(diagnostic,"\"last_disconnect_reason\":531"));assert(std::strstr(diagnostic,"\"disconnections\":2"));
 for(const char* forbidden:{"mac","conn_handle","ssid","ip\"","password","token","curve","Coffee-"})assert(!std::strstr(diagnostic,forbidden));
 ble_test::notifyResult=99;ble_test::now=8000;roast::ble::tick(controller,8000);pump();assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),8000));assert(std::strstr(diagnostic,"\"last_notify_error\":99"));assert(std::strstr(diagnostic,"\"local_close_reason\":\"notify_error\""));
 characteristic.callbacks->onSubscribe(&characteristic,&peer,1);server.callbacks->onMtuChanged(&server,&peer,247);ble_test::now=9000;roast::ble::tick(controller,9000);server.callbacks->onMtuChanged(&server,&peer,23);pump();assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),9000));assert(std::strstr(diagnostic,"\"local_close_reason\":\"invalid_notification\""));assert(std::strstr(diagnostic,"\"mtu\":23"));
 const std::string firstDiagnostic=diagnostic;assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),9001));assert(firstDiagnostic==diagnostic); // 查询不清空或改写诊断状态。
 size_t fields=0;for(const char* p=diagnostic;*p;++p)if(*p==':')++fields;assert(fields==24);
 // 全部整数字段均扩展为带负号的11字符上界，覆盖所有32位计数与状态码。
 std::string maximumDiagnostic=diagnostic;for(size_t i=0;i<maximumDiagnostic.size();++i)if(maximumDiagnostic[i]==':'&&i+1<maximumDiagnostic.size()&&(maximumDiagnostic[i+1]=='-'||(maximumDiagnostic[i+1]>='0'&&maximumDiagnostic[i+1]<='9'))){const size_t begin=++i;size_t end=begin;while(end<maximumDiagnostic.size()&&(maximumDiagnostic[end]=='-'||(maximumDiagnostic[end]>='0'&&maximumDiagnostic[end]<='9')))++end;maximumDiagnostic.replace(begin,end-begin,"-2147483648");i=begin+10;}for(size_t at=0;(at=maximumDiagnostic.find(":true",at))!=std::string::npos;at+=6)maximumDiagnostic.replace(at,5,":false");assert(maximumDiagnostic.size()<sizeof(diagnostic));std::cout<<"BLE diagnostics v2 conservative maximum bytes: "<<maximumDiagnostic.size()<<"\n";
 const unsigned long queuedBefore=diagnosticNumber(diagnostic,"setup_queued"),writesBefore=diagnosticNumber(diagnostic,"setup_writes");
 for(unsigned i=0;i<17;++i)setupWrite.callbacks->onWrite(&setupWrite,&peer);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),9001));assert(diagnosticNumber(diagnostic,"setup_writes")==writesBefore+17);assert(diagnosticNumber(diagnostic,"setup_queued")==queuedBefore+16);assert(diagnosticNumber(diagnostic,"setup_reject_stage")==4);
 setupWrite.value="short";setupWrite.callbacks->onWrite(&setupWrite,&peer);assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),9001));assert(diagnosticNumber(diagnostic,"setup_write_length")==5);assert(diagnosticNumber(diagnostic,"setup_reject_stage")==2);
 // 与独立客户端相同的 state 请求：8字节正文及8字节分片头。
 ble_test::notifyResult=0;ble_test::now=9010;roast::ble::tick(controller,9010);pump();
 const char* stateRequest="1\nstate\n";const size_t stateSize=roast::ble::setupFrame(21,8,0,reinterpret_cast<const uint8_t*>(stateRequest),8,command,sizeof(command));setupWrite.value.assign(reinterpret_cast<char*>(command),stateSize);
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),9010));const auto repliesBeforeState=diagnosticNumber(diagnostic,"setup_replies"),completeBeforeState=diagnosticNumber(diagnostic,"setup_complete_requests");const auto notificationBeforeState=ble_test::notifications.size();
 setupWrite.callbacks->onWrite(&setupWrite,&peer);for(uint32_t now=9020;now<=9100;now+=5){ble_test::now=now;roast::ble::tick(controller,now);pump();}
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),9100));assert(diagnosticNumber(diagnostic,"setup_write_length")==16);assert(diagnosticNumber(diagnostic,"setup_complete_requests")==completeBeforeState+1);assert(diagnosticNumber(diagnostic,"setup_replies")==repliesBeforeState+1);assert(diagnosticNumber(diagnostic,"setup_last_code")==503);
 roast::ble::SetupAssembler stateReply;bool stateComplete=false;for(size_t i=notificationBeforeState;i<ble_test::notifications.size()&&!stateComplete;++i)if(ble_test::notificationHandles[i]==44){const auto& frame=ble_test::notifications[i];stateComplete=stateReply.push(frame.data(),frame.size(),9100);}assert(stateComplete);assert(std::strstr(stateReply.data(),"\"id\":1")); // 原生替身未启用Wi-Fi，状态动作返回503但必须有完整响应。
 // 回调可在主循环取now后到达：新入队分片不能因无符号下溢被当成过期。
 assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),9100));const auto repliesBeforeClock=diagnosticNumber(diagnostic,"setup_replies"),completeBeforeClock=diagnosticNumber(diagnostic,"setup_complete_requests");
 ble_test::now=10000;setupWrite.callbacks->onWrite(&setupWrite,&peer);roast::ble::tick(controller,9999);pump();assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),10000));assert(diagnosticNumber(diagnostic,"setup_complete_requests")==completeBeforeClock+1);assert(diagnosticNumber(diagnostic,"setup_replies")==repliesBeforeClock+1);
 for(uint32_t now=10005;now<=10100;now+=5){ble_test::now=now;roast::ble::tick(controller,now);pump();}
 // 出队时真实年龄已到10秒，即使循环now落后1ms也必须丢弃。
 ble_test::now=11000;setupWrite.callbacks->onWrite(&setupWrite,&peer);ble_test::now=21000;roast::ble::tick(controller,20999);pump();assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),21000));assert(diagnosticNumber(diagnostic,"setup_complete_requests")==completeBeforeClock+1);assert(diagnosticNumber(diagnostic,"setup_replies")==repliesBeforeClock+1);assert(diagnosticNumber(diagnostic,"setup_reject_stage")==5);
 // 已加密且绑定的SDK订阅恢复可早于应用onConnect，两条通知都应恢复。
 auto subscriptions=[&](bool status,bool setup){assert(roast::ble::diagnostics(diagnostic,sizeof(diagnostic),22000));assert(std::strstr(diagnostic,status?"\"subscribed\":true":"\"subscribed\":false"));assert(std::strstr(diagnostic,setup?"\"setup_subscribed\":true":"\"setup_subscribed\":false"));assert(!roast::ble::linkState().setupAuthorized);};
 server.callbacks->onDisconnect(&server,&peer);earlyPeer.sec_state.encrypted=earlyPeer.sec_state.bonded=true;peer.sec_state=earlyPeer.sec_state;extra.sec_state=earlyPeer.sec_state;const auto securityBeforeRestore=BLESecurity::requests;
 characteristic.callbacks->onSubscribe(&characteristic,&earlyPeer,1);earlySetup.callbacks->onSubscribe(&earlySetup,&earlyPeer,1);server.callbacks->onConnect(&server,&peer);subscriptions(true,true);assert(BLESecurity::requests==securityBeforeRestore);
 // 只靠恢复位就能发送state响应，不需要客户端额外stop/start订阅。
 ble_test::now=22000;const auto beforeRestoreNotifications=ble_test::notifications.size();setupWrite.callbacks->onWrite(&setupWrite,&peer);
 for(uint32_t now=22000;now<=22300;now+=5){ble_test::now=now;roast::ble::tick(controller,now);pump();}
 roast::ble::SetupAssembler restoredReply;bool restoredComplete=false;for(size_t i=beforeRestoreNotifications;i<ble_test::notifications.size()&&!restoredComplete;++i)if(ble_test::notificationHandles[i]==44){const auto& frame=ble_test::notifications[i];restoredComplete=restoredReply.push(frame.data(),frame.size(),22300);}assert(restoredComplete);assert(std::strstr(restoredReply.data(),"\"id\":1"));assert(!roast::ble::linkState().setupAuthorized);assert(BLESecurity::requests==securityBeforeRestore);
 // 正常后到启停仍生效，活动会话上其他客户端不能污染两个通知位。
 characteristic.callbacks->onSubscribe(&characteristic,&peer,0);earlySetup.callbacks->onSubscribe(&earlySetup,&peer,0);subscriptions(false,false);characteristic.callbacks->onSubscribe(&characteristic,&peer,1);earlySetup.callbacks->onSubscribe(&earlySetup,&peer,1);subscriptions(true,true);
 characteristic.callbacks->onSubscribe(&characteristic,&extra,0);earlySetup.callbacks->onSubscribe(&earlySetup,&extra,0);server.callbacks->onConnect(&server,&extra);subscriptions(true,true);
 // 断线后复用同一内部handle，不能沿用上次通知位。
 server.callbacks->onDisconnect(&server,&peer);server.callbacks->onConnect(&server,&peer);subscriptions(false,false);server.callbacks->onDisconnect(&server,&peer);
 // 早到缓存形成后又收到断线，必须清掉；之后同一handle也不能恢复。
 characteristic.callbacks->onSubscribe(&characteristic,&earlyPeer,1);earlySetup.callbacks->onSubscribe(&earlySetup,&earlyPeer,1);server.callbacks->onDisconnect(&server,&earlyPeer);server.callbacks->onConnect(&server,&peer);subscriptions(false,false);server.callbacks->onDisconnect(&server,&peer);
 // 缓存与实际接纳的连接不匹配时清理，不能留给下一次连接。
 characteristic.callbacks->onSubscribe(&characteristic,&earlyPeer,1);earlySetup.callbacks->onSubscribe(&earlySetup,&earlyPeer,1);server.callbacks->onConnect(&server,&extra);subscriptions(false,false);server.callbacks->onDisconnect(&server,&extra);server.callbacks->onConnect(&server,&peer);subscriptions(false,false);server.callbacks->onDisconnect(&server,&peer);
 // 只有同时加密且绑定才允许缓存，且不额外发起配对。
 for(unsigned flags:{1u,2u}){earlyPeer.sec_state.encrypted=flags==1;earlyPeer.sec_state.bonded=flags==2;peer.sec_state=earlyPeer.sec_state;characteristic.callbacks->onSubscribe(&characteristic,&earlyPeer,1);earlySetup.callbacks->onSubscribe(&earlySetup,&earlyPeer,1);server.callbacks->onConnect(&server,&peer);subscriptions(false,false);server.callbacks->onDisconnect(&server,&peer);}assert(BLESecurity::requests==securityBeforeRestore);
 // 同一恢复代际的最后一次通知位为准（包括取消订阅）。
 earlyPeer.sec_state.encrypted=earlyPeer.sec_state.bonded=true;peer.sec_state=earlyPeer.sec_state;earlySetup.callbacks->onSubscribe(&earlySetup,&earlyPeer,1);characteristic.callbacks->onSubscribe(&characteristic,&earlyPeer,1);earlySetup.callbacks->onSubscribe(&earlySetup,&earlyPeer,0);server.callbacks->onConnect(&server,&peer);subscriptions(true,false);
 std::cout<<"BLE adapter lifecycle, queue and congestion passed\n";
}

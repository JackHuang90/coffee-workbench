#include <Arduino.h>
#if ROAST_WIFI_ENABLE
/** 功能：ESP32配网、持久化与RGB适配。首次编写日期：2026-10-29；变更日期：2026-10-30；修改记录：2026-10-29：首次编写；公开函数契约及日期见头文件；2026-10-30：来源错误不再限定HTTPS，与本机/内网HTTP策略一致。 */
#include "roast/esp_provisioning.hpp"
#include "roast/board.hpp"
#include "roast/setup_page.hpp"
#include <esp_system.h>
#include <esp_wifi.h>
#include <cstring>
#include <cctype>
#include <cstdio>
#include <algorithm>
namespace roast::net {
namespace {
/** 功能：生成固定长度的密码学随机十六进制会话值。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
void randomHex(char* out,size_t length){static const char digits[]="0123456789abcdef";for(size_t i=0;i<length;i+=8){const uint32_t random=esp_random();for(size_t j=0;j<8&&i+j<length;++j)out[i+j]=digits[(random>>(j*4))&15];}out[length]=0;}
/** 功能：将无线文本编码为JSON字符串，不生成HTML。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
String quote(const char* value){String out="\"";for(const unsigned char* p=reinterpret_cast<const unsigned char*>(value);*p;++p){if(*p=='"'||*p=='\\'){out+='\\';out+=static_cast<char>(*p);}else if(*p<32){char escape[7];std::snprintf(escape,sizeof(escape),"\\u%04x",*p);out+=escape;}else out+=static_cast<char>(*p);}out+='"';return out;}
/** 功能：按网络字节顺序转换IP供核心校验。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
uint32_t number(IPAddress address){return (uint32_t(address[0])<<24)|(uint32_t(address[1])<<16)|(uint32_t(address[2])<<8)|address[3];}
/** 功能：把核心网络状态映射为固定非敏感名称。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
const char* stateName(State state){switch(state){case State::Setup:return "Setup";case State::Connecting:return "Connecting";case State::Testing:return "Testing";case State::Ready:return "Ready";case State::Failed:return "Failed";case State::SaveFailed:return "SaveFailed";case State::Saved:return "Saved";case State::Online:return "Online";case State::Offline:return "Offline";}return "Failed";}
}
bool EspProvisioning::identity(){
 Preferences id;if(!id.begin("coffee-id",false))return false;
 const uint64_t mac=ESP.getEfuseMac();std::snprintf(ssid_,sizeof(ssid_),"Coffee-Setup-%06lX",static_cast<unsigned long>((mac>>24)&0xffffff));
 bool okay=false;
 if(id.isKey("ap-pass")){const String saved=id.getString("ap-pass","");if(saved.length()==16){saved.toCharArray(password_,sizeof(password_));okay=true;for(char ch:password_)if(ch&&!std::isxdigit(static_cast<unsigned char>(ch)))okay=false;}}
 else {randomHex(password_,16);okay=id.putString("ap-pass",password_)==16&&id.getString("ap-pass","")==password_;}
 id.end();return okay;
}
bool EspProvisioning::persist(const Config& config,bool present){
 if(!storage_)return false;
 const int target=slot_==0?1:0;const char* key=target==0?"slot0":"slot1";
 scratch_=makeRecord(config,sequence_+1,present);
 const uint32_t expected=scratch_.checksum;
 if(store_.putBytes(key,&scratch_,sizeof(scratch_))!=sizeof(scratch_))return false;
 if(store_.getBytes(key,&scratch_,sizeof(scratch_))!=sizeof(scratch_)||!recordValid(scratch_)||scratch_.checksum!=expected)return false;
 slot_=target;sequence_=scratch_.sequence;return true;
}
void EspProvisioning::begin(Controller& controller,uint32_t now){
 controller_=&controller;pinMode(ROAST_BOOT_PIN,INPUT_PULLUP);WiFi.persistent(false);WiFi.setAutoReconnect(false);if(!WiFi.mode(WIFI_STA)){std::strcpy(error_,"wifi_start_failed");return;}identity_=identity();storage_=store_.begin("coffee-net",false);
 if(storage_){Record first{};const bool a=store_.getBytesLength("slot0")==sizeof(first)&&store_.getBytes("slot0",&first,sizeof(first))==sizeof(first);const bool b=store_.getBytesLength("slot1")==sizeof(scratch_)&&store_.getBytes("slot1",&scratch_,sizeof(scratch_))==sizeof(scratch_);slot_=selectRecord(a?&first:nullptr,b?&scratch_:nullptr);if(slot_>=0){const Record& selected=slot_==0?first:scratch_;sequence_=selected.sequence;configured_=selected.present;if(configured_)committed_=selected.config;}}
 if(!configured_&&ROAST_DEFAULT_ORIGIN[0]&&normalizeOrigin(ROAST_DEFAULT_ORIGIN,committed_.origins[0]))committed_.originCount=1;
 machine_.begin(configured_,now);
 if(!configured_)openAp();
 if(!identity_||!storage_)std::strcpy(error_,"storage_unavailable_use_USB_SETUP");
}
bool EspProvisioning::selectAp(uint32_t station,uint32_t mask){return applyAp(apGateway(number(WiFi.softAPIP()),station,mask));}
bool EspProvisioning::applyAp(uint32_t chosen){
 if(!chosen)return false;
 const IPAddress address((chosen>>24)&255,(chosen>>16)&255,(chosen>>8)&255,chosen&255);
 if(number(WiFi.softAPIP())==chosen)return true;
 dns_.stop();if(!WiFi.softAPConfig(address,address,IPAddress(255,255,255,0)))return false;
 dns_.begin(address,53);return true;
}
void EspProvisioning::openAp(){
 if(!identity_){std::strcpy(error_,"identity_storage_failed");return;}
 WiFi.mode(WIFI_AP_STA);randomHex(token_,32);
 if(!WiFi.softAP(ssid_,password_,1,false,2)){std::strcpy(error_,"hotspot_start_failed");return;}
 ap_=true;if(!selectAp(0,0)){ap_=false;WiFi.softAPdisconnect(true);std::strcpy(error_,"hotspot_address_failed");}
 else dns_.begin(WiFi.softAPIP(),53);
}
void EspProvisioning::connect(const Config& config,uint32_t now){
 controller_->forceStop(now,"network_configuration");WiFi.disconnectAsync(false,false);WiFi.scanDelete();scanning_=false;pendingConnection_=&config;
}
void EspProvisioning::startConnection(){
 if(!pendingConnection_||WiFi.STA.connected())return;
 const Config& config=*pendingConnection_;pendingConnection_=nullptr;bool okay=false;
 if(config.staticIp){IPAddress ip,mask,gateway,dns;ip.fromString(config.ip);mask.fromString(config.mask);gateway.fromString(config.gateway);dns.fromString(config.dns);okay=WiFi.STA.config(ip,gateway,mask,dns);}
 else okay=WiFi.STA.config(IPAddress(0,0,0,0),IPAddress(0,0,0,0),IPAddress(0,0,0,0),IPAddress(0,0,0,0),IPAddress(0,0,0,0));
 if(!okay){std::strcpy(error_,"address_configuration_failed");return;}
 // The pinned SDK's legacy begin()/connect() can wait for disconnect. The
 // interface was started in setup; these IDF calls enqueue work without waits.
 wifi_config_t wifi{};std::memcpy(wifi.sta.ssid,config.ssid,std::strlen(config.ssid));std::memcpy(wifi.sta.password,config.password,std::strlen(config.password));wifi.sta.threshold.rssi=-127;wifi.sta.threshold.authmode=config.password[0]?WIFI_AUTH_WPA2_PSK:WIFI_AUTH_OPEN;wifi.sta.pmf_cfg.capable=true;
 if(esp_wifi_set_config(WIFI_IF_STA,&wifi)!=ESP_OK||esp_wifi_connect()!=ESP_OK)std::strcpy(error_,"connection_start_failed");
}
void EspProvisioning::resetNetwork(uint32_t now){
 controller_->forceStop(now,"network_reset");++epoch_;
 if(!persist(Config{},false)){std::strcpy(error_,"network_clear_failed");return;}
 const char* previous=slot_==0?"slot1":"slot0";
 if(store_.isKey(previous)&&!store_.remove(previous)){std::strcpy(error_,"old_network_clear_failed");return;}
 pendingConnection_=nullptr;configured_=false;committed_=Config{};candidate_=Config{};WiFi.disconnectAsync(false,false);WiFi.scanDelete();scanning_=false;error_[0]=0;
 if(ROAST_DEFAULT_ORIGIN[0]&&normalizeOrigin(ROAST_DEFAULT_ORIGIN,committed_.origins[0]))committed_.originCount=1;
 migrationGateway_=0;deferTest_=false;machine_.begin(false,now);openAp();
}
void EspProvisioning::tick(uint32_t now){
 if(button_.update(digitalRead(ROAST_BOOT_PIN)==LOW,now))resetNetwork(now);
 startConnection();
 const bool connected=!pendingConnection_&&WiFi.status()==WL_CONNECTED&&number(WiFi.localIP())!=0;
 if(wasConnected_&&!connected)controller_->transportLost(now);
 wasConnected_=connected;
 if(ap_&&connected&&!migrationGateway_){const uint32_t next=apGateway(number(WiFi.softAPIP()),number(WiFi.localIP()),number(WiFi.subnetMask()));if(!next)std::strcpy(error_,"hotspot_subnet_conflict");else if(next!=number(WiFi.softAPIP())){migrationGateway_=next;migrationAt_=now;}}
 if(migrationGateway_&&static_cast<uint32_t>(now-migrationAt_)>=10000){const uint32_t next=migrationGateway_;migrationGateway_=0;if(!applyAp(next))std::strcpy(error_,"hotspot_address_failed");deferTest_=false;}
 switch(deferTest_?Action::None:machine_.tick(now,connected)){case Action::ConnectSaved:connect(committed_,now);break;case Action::ConnectCandidate:connect(candidate_,now);break;case Action::Disconnect:pendingConnection_=nullptr;WiFi.disconnectAsync(false,false);if(ap_)std::strcpy(error_,"connection_timeout_check_password_and_address");break;case Action::CloseAp:dns_.stop();WiFi.softAPdisconnect(true);ap_=false;WiFi.mode(WIFI_STA);break;case Action::None:break;}
 if(ap_)dnsWork();
 if(scanning_&&(WiFi.scanComplete()!=WIFI_SCAN_RUNNING||static_cast<uint32_t>(now-scanAt_)>15000)){scanning_=false;if(WiFi.scanComplete()==WIFI_SCAN_RUNNING){WiFi.scanDelete();std::strcpy(error_,"scan_timeout");}}

}
void EspProvisioning::dnsWork(){
 const int length=dns_.parsePacket();if(length<=0)return;
 if(length>static_cast<int>(sizeof(dnsPacket_))){dns_.clear();return;}
 const auto peer=dns_.remoteIP();const auto port=dns_.remotePort();const auto ap=WiFi.softAPIP();
 if(peer[0]!=ap[0]||peer[1]!=ap[1]||peer[2]!=ap[2]){dns_.clear();return;}
 const int received=dns_.read(dnsPacket_,sizeof(dnsPacket_));dns_.clear();if(received!=length)return;
 const size_t bytes=captiveDnsReply(dnsPacket_,static_cast<size_t>(length),sizeof(dnsPacket_),number(ap));
 if(bytes&&dns_.beginPacket(peer,port)){dns_.write(dnsPacket_,bytes);dns_.endPacket();}
}
void EspProvisioning::stateJson(uint32_t,bool ble,bool authorized,bool pending,uint32_t remaining){
 if(ble&&!authorized){std::snprintf(response_,sizeof(response_),"{\"state\":\"%s\",\"configured\":%s,\"connected\":%s,\"authorized\":false,\"pending\":%s,\"remaining_ms\":0}",stateName(machine_.state()),configured_?"true":"false",WiFi.status()==WL_CONNECTED?"true":"false",pending?"true":"false");return;}
 const State state=machine_.state();const Config& c=(state==State::Testing||state==State::Ready||state==State::SaveFailed||state==State::Saved)?candidate_:committed_;
 const bool connected=WiFi.status()==WL_CONNECTED;String json;json.reserve(sizeof(response_));json="{\"state\":";json+=quote(stateName(state));json+=",\"revision\":";json+=String(machine_.revision());if(!ble){json+=",\"token\":";json+=quote(token_);}json+=",\"ssid\":";json+=quote(c.ssid);json+=",\"mode\":";json+=quote(c.staticIp?"static":"dhcp");json+=",\"ip\":";json+=quote(connected?WiFi.localIP().toString().c_str():c.ip);json+=",\"mask\":";json+=quote(c.mask);json+=",\"gateway\":";json+=quote(connected?WiFi.gatewayIP().toString().c_str():c.gateway);json+=",\"dns\":";json+=quote(c.dns);json+=",\"setup_url\":";json+=quote((String("http://")+WiFi.softAPIP().toString()).c_str());json+=",\"error\":";json+=quote(error_);json+=",\"scanning\":";json+=scanning_?"true":"false";json+=",\"origins\":[";
 for(unsigned i=0;i<c.originCount;++i){if(i)json+=',';json+=quote(c.origins[i]);}json+=']';
 if(migrationGateway_){const IPAddress next((migrationGateway_>>24)&255,(migrationGateway_>>16)&255,(migrationGateway_>>8)&255,migrationGateway_&255);json+=",\"reconnect_url\":";json+=quote((String("http://")+next.toString()+"/").c_str());}
 const int count=WiFi.scanComplete();if(count>=0){json+=",\"networks\":[";for(int i=0;i<std::min(count,12);++i){if(i)json+=',';json+="{\"ssid\":";json+=quote(WiFi.SSID(i).c_str());json+=",\"rssi\":";json+=String(WiFi.RSSI(i));json+='}';}json+=']';}else json+=",\"networks\":[]";if(ble){json+=",\"authorized\":true,\"pending\":false,\"remaining_ms\":";json+=String(remaining);json+=",\"configured\":";json+=configured_?"true":"false";json+=",\"connected\":";json+=connected?"true":"false";}json+='}';
 if(json.length()>=sizeof(response_))std::strcpy(response_,"{\"error\":\"response_limit\"}");else json.toCharArray(response_,sizeof(response_));
}
int EspProvisioning::handle(const PortalRequest& request,bool apInterface,uint32_t now,const char*& body,const char*& type){
 type="application/json; charset=utf-8";body=response_;std::strcpy(response_,"{\"error\":\"setup_forbidden\"}");
 const String address=WiFi.softAPIP().toString();if(!request.authorized(apInterface,address.c_str(),token_,ap_)){
  if(ap_&&apInterface&&!request.post()&&std::strncmp(request.path(),"/setup",6)){std::strcpy(response_,"{\"redirect\":\"setup\"}");return 302;}return 403;
 }
 if(!request.post()){
  if(!std::strcmp(request.path(),"/setup/state")){stateJson(now);return 200;}
  if(!std::strcmp(request.path(),"/")||!std::strcmp(request.path(),"/setup")){body=setupPage;type="text/html; charset=utf-8";return 200;}
  std::strcpy(response_,"{\"redirect\":\"setup\"}");return 302;
 }
 if(std::strncmp(request.path(),"/setup/",7)){std::strcpy(response_,"{\"error\":\"not_found\"}");return 404;}
 return setupAction(request.path()+7,request.body(),now,body);
}
const char* EspProvisioning::bleState(uint32_t now,bool authorized,bool pending,uint32_t remaining){stateJson(now,true,authorized,pending,remaining);return response_;}
int EspProvisioning::setupAction(const char* op,const char* form,uint32_t now,const char*& body){
 body=response_;char path[32];std::snprintf(path,sizeof(path),"/setup/%s",op);
 if(!std::strcmp(path,"/setup/test")){
  if(machine_.state()==State::Testing||machine_.state()==State::Saved){std::strcpy(response_,"{\"error\":\"connection_busy\"}");return 409;}
  const Error result=parseForm(form,scratch_.config);if(result!=Error::None){const char* message=result==Error::Origin?"invalid_website_origin":result==Error::Address?"invalid_static_ipv4":result==Error::Password?"invalid_wifi_password":"invalid_ssid_or_form";std::snprintf(response_,sizeof(response_),"{\"error\":\"%s\"}",message);return 400;}
  candidate_=scratch_.config;error_[0]=0;controller_->forceStop(now,"network_configuration");++epoch_;machine_.test(now);
  if(candidate_.staticIp){uint32_t station,mask;ipv4(candidate_.ip,station);ipv4(candidate_.mask,mask);const uint32_t next=apGateway(number(WiFi.softAPIP()),station,mask);if(next&&next!=number(WiFi.softAPIP())){migrationGateway_=next;migrationAt_=now;deferTest_=true;}}
  if(migrationGateway_){const IPAddress next((migrationGateway_>>24)&255,(migrationGateway_>>16)&255,(migrationGateway_>>8)&255,migrationGateway_&255);std::snprintf(response_,sizeof(response_),"{\"ok\":true,\"revision\":%lu,\"reconnect_url\":\"http://%s/\"}",static_cast<unsigned long>(machine_.revision()),next.toString().c_str());}else std::snprintf(response_,sizeof(response_),"{\"ok\":true,\"revision\":%lu}",static_cast<unsigned long>(machine_.revision()));return 202;
 }
 if(!std::strcmp(path,"/setup/save")){
  uint32_t ticket=0;bool valid=!std::strncmp(form,"revision=",9)&&form[9];if(valid){for(const char* p=form+9;*p;++p){if(*p<'0'||*p>'9'||ticket>429496729u||(ticket==429496729u&&*p>'5')){valid=false;break;}ticket=ticket*10+static_cast<uint32_t>(*p-'0');}}
  if(migrationGateway_||!valid||!machine_.canSave(ticket)||WiFi.status()!=WL_CONNECTED){std::strcpy(response_,"{\"error\":\"test_connection_first\"}");return 409;}
  const bool success=persist(candidate_,true);machine_.saved(success,now);if(!success){std::strcpy(error_,"persistent_save_failed");std::strcpy(response_,"{\"error\":\"persistent_save_failed\"}");return 503;}
  committed_=candidate_;configured_=true;error_[0]=0;std::strcpy(response_,"{\"ok\":true}");return 200;
 }
 if(!std::strcmp(path,"/setup/scan")){
  if(scanning_||machine_.state()==State::Testing||machine_.state()==State::Saved){std::strcpy(response_,"{\"error\":\"scan_busy\"}");return 409;}
  WiFi.scanDelete();const int result=WiFi.scanNetworks(true,false,false,120);if(result==WIFI_SCAN_FAILED){std::strcpy(response_,"{\"error\":\"scan_failed\"}");return 503;}scanning_=result==WIFI_SCAN_RUNNING;scanAt_=now;std::strcpy(response_,"{\"ok\":true}");return 202;
 }
 std::strcpy(response_,"{\"error\":\"not_found\"}");return 404;
}
size_t EspProvisioning::setupInfo(char* out,size_t capacity)const{
 const int n=std::snprintf(out,capacity,"{\"kind\":\"setup\",\"active\":%s,\"ssid\":\"%s\",\"password\":\"%s\",\"url\":\"http://%s\",\"identity_ready\":%s}",ap_?"true":"false",ssid_,identity_?password_:"",WiFi.softAPIP().toString().c_str(),identity_?"true":"false");return n>0&&static_cast<size_t>(n)<capacity?static_cast<size_t>(n):0;
}
}
#endif

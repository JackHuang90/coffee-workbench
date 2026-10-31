/** 功能：验证配网配置、持久记录、恢复按钮与重连行为。
 * 首次编写日期：2026-10-29；变更日期：2026-10-29
 * 修改记录：2026-10-29：首次编写，覆盖会破坏网络恢复与来源隔离的分支。 */
#include "roast/provisioning.hpp"
#include <cassert>
#include <cstring>
#include <iostream>
using namespace roast::net;
/** 功能：执行真实核心的回归用例。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
int main(){
 Config c{}; std::strcpy(c.ssid,"Coffee router"); std::strcpy(c.password,"secret-pass");
 assert(validate(c)==Error::None);
 c.staticIp=true; std::strcpy(c.ip,"192.168.1.20");std::strcpy(c.mask,"255.255.255.0");std::strcpy(c.gateway,"192.168.1.1");std::strcpy(c.dns,"1.1.1.1");
 assert(validate(c)==Error::None);
 std::strcpy(c.mask,"255.0.255.0");assert(validate(c)==Error::Address);std::strcpy(c.mask,"255.255.255.0");
 std::strcpy(c.gateway,"192.168.2.1");assert(validate(c)==Error::Address);std::strcpy(c.gateway,"192.168.1.1");
 std::strcpy(c.ip,"192.168.1.0");assert(validate(c)==Error::Address);std::strcpy(c.ip,"192.168.1.255");assert(validate(c)==Error::Address);
 std::strcpy(c.ip,"192.168.1.1");assert(validate(c)==Error::Address);std::strcpy(c.ip,"192.168.1.20");
 uint32_t ip=0;assert(!ipv4("1.2.3.256",ip));assert(!ipv4("01.2.3.4",ip));assert(!ipv4("1.2.3.4x",ip));
 assert(apGateway(0xc0a80401,0x0a000002,0xffffff00)==0xc0a80401);
 assert(apGateway(0xc0a80401,0xc0a80402,0xffffff00)==0xc0a82501);
 assert(apGateway(0xc0a80401,0xc0a80102,0xffff0000)==0xac1ff001);
 assert(apGateway(0xc0a82501,0x0a000002,0xffffff00)==0xc0a82501);
 char origin[256]{}; assert(normalizeOrigin("https://Example.COM:443/page?a=1#x",origin));assert(std::strcmp(origin,"https://example.com")==0);
 assert(normalizeOrigin("https://example.com:8443/a",origin));assert(std::strcmp(origin,"https://example.com:8443")==0);
 for(const char* bad:{"http://example.com","null","https://*.example.com","https://user@example.com","https://example.com:0","https://example.com:99999","https://example.com\r\nX: y","https://-bad.com"})assert(!normalizeOrigin(bad,origin));
 c.originCount=1;std::strcpy(c.origins[0],"https://example.com");assert(originAllowed(c,"https://example.com"));assert(!originAllowed(c,"https://example.com.evil"));assert(!originAllowed(c,"https://EXAMPLE.com"));assert(!originAllowed(c,"null"));
 const Record old=makeRecord(c,10,true);Record next=makeRecord(c,11,true);assert(recordValid(old));assert(selectRecord(&old,&next)==1);
 next.config.password[0]^=1;assert(!recordValid(next));assert(selectRecord(&old,&next)==0);
 next=makeRecord(c,11,false);assert(selectRecord(&old,&next)==1&&!next.present);next.version=99;assert(selectRecord(nullptr,&next)==-1);
 next=makeRecord(c,0,true);const Record wrap=makeRecord(c,UINT32_MAX,true);assert(selectRecord(&wrap,&next)==1);
 ResetButton button;assert(!button.update(true,0));assert(!button.update(true,6000));assert(!button.armed());
 button.update(false,6100);button.update(false,6160);button.update(true,6200);button.update(true,6260);button.update(true,11259);assert(!button.armed());button.update(true,11260);assert(button.armed());
 assert(!button.update(false,11261));assert(button.update(false,11321));assert(!button.update(false,11400));
 ResetButton bounce;bounce.update(false,0);bounce.update(false,60);bounce.update(true,100);bounce.update(false,120);bounce.update(false,200);assert(!bounce.armed());
 ResetButton wrapping;wrapping.update(false,UINT32_MAX-200);wrapping.update(false,UINT32_MAX-140);wrapping.update(true,UINT32_MAX-100);wrapping.update(true,UINT32_MAX-40);wrapping.update(true,4960);assert(wrapping.armed());assert(!wrapping.update(false,4961));assert(wrapping.update(false,5021));
 ResetButton shortButton;shortButton.update(false,0);shortButton.update(false,50);shortButton.update(true,100);shortButton.update(true,150);shortButton.update(false,200);shortButton.update(false,250);assert(shortButton.takeShortPress());assert(!shortButton.takeShortPress());assert(!button.takeShortPress());assert(!bounce.takeShortPress());
 Machine m;m.begin(false,0);assert(m.state()==State::Setup);assert(m.tick(1,false)==Action::None);
 m.test(10);assert(m.tick(10,false)==Action::ConnectCandidate);assert(m.tick(30009,false)==Action::None);assert(m.tick(30010,false)==Action::Disconnect);assert(m.state()==State::Failed);assert(!m.canSave());
 m.test(31000);assert(m.tick(31000,false)==Action::ConnectCandidate);m.tick(32000,true);assert(m.canSave());m.saved(false,32000);assert(m.canSave()&&m.state()==State::SaveFailed);m.saved(true,33000);assert(m.state()==State::Saved);assert(m.tick(62999,true)==Action::None);assert(m.tick(63000,true)==Action::CloseAp);
 m.begin(true,0);assert(m.tick(0,false)==Action::ConnectSaved);assert(m.tick(30000,false)==Action::Disconnect);assert(m.tick(30999,false)==Action::None);assert(m.tick(31000,false)==Action::ConnectSaved);m.tick(32000,true);assert(m.state()==State::Online);assert(m.tick(33000,false)==Action::None);assert(m.tick(34000,false)==Action::ConnectSaved);
 assert(light(State::Online,true,0)==Light::Purple);assert(light(State::Online,false,0)==Light::Green);assert(light(State::Setup,false,0)==Light::Blue);
 Machine tickets;tickets.begin(false,0);tickets.test(10);const uint32_t first=tickets.revision();tickets.tick(10,false);tickets.tick(20,true);assert(tickets.canSave(first));tickets.test(30);tickets.tick(30,false);tickets.tick(40,true);assert(!tickets.canSave(first));assert(tickets.canSave(tickets.revision()));
 std::cout<<"Provisioning core passed\n";
}

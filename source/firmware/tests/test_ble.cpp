/** 功能：测试生产编码器的MTU/边界与调度契约。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
#include "roast/ble.hpp"
#include "roast/protocol.hpp"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>
/** 功能：断言真实编码器的字节序、边界与重组内容。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
int main(){
 using namespace roast::ble;
 uint8_t out[244]{};const uint8_t json[]="{\"v\":1}";
 assert(encodeFragment(json,7,0x1234,0,23,out,sizeof(out))==15);
 const uint8_t expected[]={0x52,1,0x34,0x12,7,0,0,0,'{','"','v','"',':','1','}'};
 assert(std::memcmp(out,expected,sizeof(expected))==0);
 for(size_t size:{size_t{1},size_t{12},size_t{13},size_t{1023}}){
  const std::string input(size,'x');
  for(uint16_t mtu:{uint16_t{23},uint16_t{247},uint16_t{517}}){
   std::string actual;size_t offset=0;
   while(offset<size){const size_t n=encodeFragment(reinterpret_cast<const uint8_t*>(input.data()),size,65535,offset,mtu,out,sizeof(out));
    assert(n>8&&n<=244&&n<=size_t(mtu-3));assert(out[2]==255&&out[3]==255);
    assert((unsigned(out[4])|(unsigned(out[5])<<8))==size);assert((unsigned(out[6])|(unsigned(out[7])<<8))==offset);
    actual.append(reinterpret_cast<char*>(out+8),n-8);offset+=n-8;
   }assert(actual==input);
  }
 }
 std::memset(out,0xa5,sizeof(out));
 assert(!encodeFragment(json,0,0,0,23,out,sizeof(out)));
 assert(!encodeFragment(json,1024,0,0,23,out,sizeof(out)));
 assert(!encodeFragment(json,7,0,7,23,out,sizeof(out)));
 assert(!encodeFragment(json,7,0,0,22,out,sizeof(out)));
 assert(!encodeFragment(json,7,0,0,23,out,14));
 assert(!encodeFragment(nullptr,7,0,0,23,out,sizeof(out)));
 assert(!encodeFragment(json,7,0,0,23,nullptr,244));
 assert(out[0]==0xa5);
 Session session;Stream stream;stream.observe(session);assert(!stream.due(0));
 assert(assessDelivery(session,session.epoch,20,0,0)==Delivery::Drop);
 assert(session.connect(7));assert(!session.connect(8));assert(session.connection==7);
 stream.observe(session);assert(!stream.due(0));
 session.subscribe(8,true);assert(!session.subscribed);
 session.subscribe(7,true);stream.observe(session);assert(stream.due(0));
 assert(assessDelivery(session,session.epoch,20,0,100)==Delivery::Send);
 assert(assessDelivery(session,session.epoch,20,0,101)==Delivery::Close);
 assert(assessDelivery(session,session.epoch,21,0,0)==Delivery::Close);
 assert(assessDelivery(session,session.epoch,8,0,0)==Delivery::Close);
 assert(assessDelivery(session,session.epoch,0,0,0)==Delivery::Close);
 assert(assessDelivery(session,session.epoch,20,0xfffffff0u,40)==Delivery::Send);
 Session largeMtu=session;largeMtu.mtu=517;
 assert(assessDelivery(largeMtu,largeMtu.epoch,244,0,0)==Delivery::Send);
 assert(assessDelivery(largeMtu,largeMtu.epoch,245,0,0)==Delivery::Close);
 assert(!stream.begin("",0,0));assert(!stream.begin("x",1024,0));
 std::string snapshot(30,'a');assert(stream.begin(snapshot.data(),snapshot.size(),0));snapshot.assign(30,'b');
 assert(!stream.begin("new",3,0));assert(stream.next(0,out,sizeof(out))==20);assert(out[8]=='a'&&out[6]==0);
 assert(stream.next(100,out,sizeof(out))==20&&out[6]==0); // No advancement before acceptance.
 stream.accepted(100);assert(!stream.next(104,out,sizeof(out)));assert(stream.next(105,out,sizeof(out))==20&&out[6]==12);
 stream.accepted(105);assert(!stream.next(104,out,sizeof(out)));assert(stream.next(110,out,sizeof(out))==14&&out[6]==24);stream.accepted(110);
 assert(!stream.due(999)&&stream.due(1000));assert(stream.begin("abc",3,1000));assert(stream.next(1000,out,sizeof(out))==11&&out[2]==1);
 const auto oldEpoch=session.epoch;session.subscribe(7,false);session.subscribe(7,true);assert(session.epoch!=oldEpoch);
 assert(assessDelivery(session,oldEpoch,20,0,0)==Delivery::Drop);
 stream.observe(session);assert(!stream.next(1000,out,sizeof(out)));assert(!stream.due(1000));assert(stream.due(2000));
 assert(stream.begin("abc",3,2000));assert(!stream.expired(3499)&&stream.expired(3500));
 session.disconnect(8);assert(session.connection==7);session.disconnect(7);stream.observe(session);assert(!stream.expired(3500)&&!stream.next(3500,out,sizeof(out)));
 assert(session.connect(7)&&!session.subscribed&&session.mtu==23);session.subscribe(7,true);stream.observe(session);
 assert(stream.begin("abc",3,0xfffffff0u));assert(!stream.expired(100));assert(stream.next(0xfffffff0u,out,sizeof(out)));stream.accepted(0xfffffff0u);
 assert(!stream.due(900)&&stream.due(984));
 // Natural 16-bit sequence wrap must not stop status delivery.
 Session rollover;Stream rolling;assert(rollover.connect(1));rollover.subscribe(1,true);rolling.observe(rollover);
 for(uint32_t i=0;i<=65536;i++){assert(rolling.begin("x",1,i*1000));assert(rolling.next(i*1000,out,sizeof(out))==9);assert((unsigned(out[2])|(unsigned(out[3])<<8))==uint16_t(i));rolling.accepted(i*1000);}
 // Real status reads and BLE disconnects cannot refresh Artisan's control lease.
 roast::VirtualPlant plant;roast::Controller controller(plant,77);controller.tick(0,plant.step(0));
 char status[roast::kResponseSize]{};const char* request="R1 77 1 1000 ARTISAN_POWER";
 roast::respond(controller,request,std::strlen(request),0,status,sizeof(status),roast::CommandSource::Usb);
 const char* error=nullptr;
 if(roast::kDemoBuild){assert(controller.modbusWrite(102,500,0,error));assert(controller.snapshot(0).owner==roast::Owner::ModbusPower);}
 for(uint32_t now=100;now<=5100;now+=100){
  controller.tick(now,plant.step(now));const auto before=controller.snapshot(now);
  const auto size=roast::statusJson(controller,now,status,sizeof(status));assert(size&&size<=1023);
  if(now==100){rollover.disconnect(1);rolling.observe(rollover);}
  const auto after=controller.snapshot(now);assert(after.owner==before.owner&&after.requested==before.requested&&after.authorizationRemainingMs==before.authorizationRemainingMs);
  if(roast::kDemoBuild&&now<5000)assert(after.owner==roast::Owner::ModbusPower&&after.requested==50);
 }
 if(roast::kDemoBuild){assert(controller.snapshot(5100).state==roast::State::Fault);assert(controller.snapshot(5100).owner==roast::Owner::None);assert(controller.snapshot(5100).requested==0);}
 std::cout<<"BLE framing passed\n";
}

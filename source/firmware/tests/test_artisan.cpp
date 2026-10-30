#include "roast/core.hpp"
#include "roast/protocol.hpp"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>
using namespace roast;
static std::string request(Controller& c,uint32_t seq,const char* verb,uint32_t now,CommandSource source=CommandSource::Usb){char line[256],out[kResponseSize];std::snprintf(line,sizeof line,"R1 77 %u %u %s",seq,now+1000,verb);assert(respond(c,line,std::strlen(line),now,out,sizeof out,source));return out;}
int main(){
 const char* error=nullptr;
 {VirtualPlant plant;Controller c(plant,77);c.tick(100,plant.step(100));
  assert(request(c,1,"ARTISAN_POWER",100,CommandSource::Http).find("local_usb_authorization_required")!=std::string::npos);
  assert(!c.modbusWrite(102,500,100,error));
  auto result=request(c,1,"ARTISAN_POWER",100);
  if(!kDemoBuild){assert(result.find("hardware_locked")!=std::string::npos);assert(c.snapshot(100).state==State::Locked);assert(!c.modbusWrite(101,900,100,error));assert(!c.modbusWrite(103,500,100,error));assert(!c.modbusWrite(104,1,100,error));assert(!c.snapshot(100).sensorFresh);std::cout<<"locked artisan tests passed\n";return 0;}
  assert(result.find("virtual_artisan_granted_5min")!=std::string::npos);assert(c.snapshot(100).owner==Owner::ModbusPower);assert(c.snapshot(100).controlMode==ControlMode::ArtisanPower);assert(c.snapshot(100).authorizationRemainingMs==300000);assert(c.snapshot(100).authorizationGeneration==1);
  assert(request(c,2,"PING",100).find("control_owned_by_other_channel")!=std::string::npos);assert(c.snapshot(100).lastSeq==1);
  assert(request(c,2,"BEGIN x 2 0",100,CommandSource::Http).find("control_owned_by_other_channel")!=std::string::npos);
  assert(!c.modbusWrite(101,900,100,error));assert(!strcmp(error,"wrong_artisan_control_mode"));
  assert(!c.modbusWrite(102,1001,100,error));assert(!strcmp(error,"invalid_value"));assert(!c.modbusWrite(103,1001,100,error));assert(!c.modbusWrite(104,0,100,error));
  assert(c.modbusWrite(102,500,100,error));assert(c.modbusWrite(103,300,100,error));assert(c.snapshot(100).requested==50&&c.snapshot(100).fanRequested==30);
  for(uint32_t now=200;now<300100;now+=100){c.tick(now,plant.step(now));if(now%1000==0)assert(c.modbusWrite(104,1,now,error));assert(c.snapshot(now).requested==50);}
  c.tick(300100,plant.step(300100));auto s=c.snapshot(300100);assert(s.state==State::Fault&&s.owner==Owner::None&&s.requested==0&&s.fanRequested==0&&s.authorizationRemainingMs==0);assert(!c.modbusWrite(102,500,300100,error));assert(!c.modbusWrite(104,1,300100,error));
  assert(request(c,2,"ARTISAN_SV",300100).find("bad_state")!=std::string::npos);
  assert(request(c,3,"STOP",300100).find("stopped")!=std::string::npos);
  assert(request(c,4,"ARTISAN_SV",300100).find("virtual_artisan_granted_5min")!=std::string::npos);assert(c.snapshot(300100).owner==Owner::ModbusSv);assert(c.snapshot(300100).authorizationGeneration==2);
  assert(!c.modbusWrite(102,500,300100,error));assert(!c.modbusWrite(101,2801,300100,error));assert(!c.modbusWrite(101,uint16_t(int16_t(-201)),300100,error));
  assert(c.modbusWrite(101,2800,300100,error));c.tick(300200,plant.step(300200));assert(c.snapshot(300200).requested>0&&c.snapshot(300200).target==280);
  assert(request(c,5,"STOP",300200,CommandSource::Http).find("stopped")!=std::string::npos);s=c.snapshot(300200);assert(s.owner==Owner::None&&s.requested==0&&s.fanRequested==0);assert(!c.modbusWrite(101,900,300200,error));
 }
 {VirtualPlant plant;Controller c(plant,77);uint32_t start=0xfffffff0u;c.tick(start,plant.step(start));request(c,1,"ARTISAN_POWER",start);assert(c.modbusWrite(102,600,start,error));for(uint32_t dt=100;dt<=5100;dt+=100){c.tick(start+dt,plant.step(start+dt));c.snapshot(start+dt);}auto s=c.snapshot(start+5100);assert(s.state==State::Fault&&s.requested==0&&s.owner==Owner::None);assert(!c.modbusWrite(102,600,start+5100,error));}
 {VirtualPlant plant;Controller c(plant,77);c.tick(0,plant.step(0));assert(request(c,1,"BEGIN x 2 0",0,CommandSource::Http).find("staging")!=std::string::npos);assert(c.snapshot(0).owner==Owner::Http);assert(request(c,2,"ARTISAN_POWER",0).find("control_owned_by_other_channel")!=std::string::npos);assert(request(c,2,"STOP",0).find("stopped")!=std::string::npos);assert(c.snapshot(0).owner==Owner::None);}
 std::cout<<"demo artisan ownership tests passed\n";
}

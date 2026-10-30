#include "roast/core.hpp"
#include "roast/protocol.hpp"
#include <cassert>
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
using namespace roast;
struct Port:OutputPort {float value=0; void writeVirtual(float v)override{assert(std::isfinite(v)&&v>=0&&v<=100);value=v;}};
static Sensor sensor(uint32_t now,float bt=25){return {bt,bt+5,now,true};}
static const char* err=nullptr;
static void profile(Controller& c,uint32_t now=0){Point pts[]={{0,250},{5000,500},{10000,600}};assert(c.begin("test",3,hashCurve(pts,3),now,err));for(size_t i=0;i<3;i++)assert(c.point(i,pts[i].ms,pts[i].btDeciC,err));assert(c.commit(now,err));}
static void armed(Controller& c,uint32_t now=0){c.tick(now,sensor(now));profile(c,now);assert(c.command("ARM",0,now,err));assert(c.command("START",0,now,err));}
static void checkZero(const Controller& c,uint32_t now){auto s=c.snapshot(now);assert(s.requested==0&&s.virtualApplied==0);}
int main(){
 {Point a[]={{0,-200},{5000,2800}}; assert(hashCurve(a,2)==hashPoint(hashPoint(2166136261u,a[0]),a[1]));}
 if(!kDemoBuild){Port p;Controller c(p,42);c.tick(100,sensor(100));const char* e=nullptr;assert(c.snapshot(100).state==State::Locked);assert(!c.snapshot(100).sensorFresh);assert(!c.command("ARM",0,100,e));assert(!c.begin("x",2,0,100,e));assert(!c.command("OUTPUT",100,100,e));c.forceStop(100);checkZero(c,100); char out[kResponseSize];const char* line="R1 42 1 100 STOP";respond(c,line,strlen(line),100,out,sizeof out,CommandSource::Usb);assert(strstr(out,"hardware_locked"));std::cout<<"locked core tests passed\n";return 0;}
 {Port p;Controller c(p);profile(c);auto hash=c.curve().hash;assert(!c.begin("bad id",2,0,0,err));assert(c.begin("next",2,0,0,err));assert(!c.point(1,0,250,err));assert(!c.point(0,1,250,err));assert(c.point(0,0,250,err));assert(!c.point(1,5001,250,err));assert(!c.point(1,1000,3000,err));assert(c.point(1,1000,250,err));assert(!c.commit(0,err));assert(c.curve().hash==hash);assert(c.command("ABORT",0,0,err));}
 {Port p;Controller c(p);armed(c);c.tick(100,sensor(100));assert(c.snapshot(100).requested>0);assert(!c.command("OUTPUT",40,100,err));assert(!c.begin("new",2,0,100,err));assert(c.command("PAUSE",0,100,err));checkZero(c,100);c.tick(10000,sensor(10000));assert(c.snapshot(10000).elapsedMs==100);assert(!c.command("START",0,10000,err));assert(c.command("ARM",0,10000,err));assert(c.command("START",0,10000,err));c.tick(10100,sensor(10100));assert(c.snapshot(10100).elapsedMs==200);assert(c.command("MANUAL",0,10100,err));checkZero(c,10100);assert(c.command("OUTPUT",40,10100,err));assert(p.value==40);assert(!c.command("OUTPUT",101,10100,err));assert(!c.command("ARM",0,10100,err));assert(c.command("PAUSE",0,10100,err));assert(!c.command("ARM",0,10100,err));assert(!strcmp(err,"stop_required_after_manual"));assert(c.command("STOP",0,10100,err));checkZero(c,10100);assert(!c.command("START",0,10100,err));assert(c.command("ARM",0,10100,err));assert(c.command("START",0,10100,err));assert(c.snapshot(10100).elapsedMs==0);}
 {Port p;Controller c(p);armed(c);c.tick(1001,sensor(1001));assert(c.snapshot(1001).state==State::Fault);checkZero(c,1001);assert(!c.command("ARM",0,1001,err));}
 {Port p;Controller c(p);armed(c);c.tick(100,{25,30,100,false});assert(c.snapshot(100).state==State::Fault);}
 {Port p;Controller c(p);armed(c);c.tick(100,sensor(100,std::numeric_limits<float>::quiet_NaN()));assert(c.snapshot(100).state==State::Fault);}
 {Port p;Controller c(p);armed(c);c.tick(100,sensor(100,301));assert(c.snapshot(100).state==State::Fault);}
 {Port p;Controller c(p);armed(c);for(uint32_t t=100;t<=5100;t+=100)c.tick(t,sensor(t));assert(c.snapshot(5100).state==State::Fault);assert(!strcmp(c.snapshot(5100).reason,"lease_expired"));}
 {Port p;Controller c(p);armed(c);c.transportLost(100);assert(c.snapshot(100).state==State::Fault);checkZero(c,100);Controller reboot(p,2);assert(reboot.snapshot(0).state==State::Idle);assert(!reboot.command("START",0,0,err));}
 {Port p;Controller c(p);uint32_t start=0xffffff00u;armed(c,start);c.tick(start+500,sensor(start+500));assert(c.snapshot(start+500).elapsedMs==500);assert(c.acceptEnvelope(1,1,start+1000,start+500,err));assert(!c.acceptEnvelope(1,1,start+1000,start+500,err));assert(!c.acceptEnvelope(2,2,start+1000,start+500,err));assert(!c.acceptEnvelope(1,2,start+499,start+500,err));assert(!c.acceptEnvelope(1,2,start+5501,start+500,err));}
 {Port p;Controller c(p);armed(c);for(uint32_t t=100;t<=10000;t+=100){if(t%1000==0)assert(c.command("PING",0,t,err));c.tick(t,sensor(t));assert(c.snapshot(t).requested>=0&&c.snapshot(t).requested<=100);}assert(c.snapshot(10000).state==State::Completed);checkZero(c,10000);}
 {Port p;Controller c(p);c.tick(0,sensor(0));profile(c);c.tick(2000,sensor(0));assert(!c.command("ARM",0,2000,err));}
 {VirtualPlant p;Controller c(p,123);c.tick(0,p.step(0));profile(c);assert(c.command("ARM",0,0,err));assert(c.command("START",0,0,err));float maxBt=25;for(uint32_t t=100;t<=10000;t+=100){if(t%1000==0)c.command("PING",0,t,err);c.tick(t,p.step(t));maxBt=c.snapshot(t).sensor.bt;}assert(maxBt>25.5);checkZero(c,10000);}
 {Port p;Controller c(p);armed(c);assert(c.command("MANUAL",0,0,err));for(uint32_t t=100;t<=10000;t+=100){if(t%1000==0)c.command("PING",0,t,err);c.tick(t,sensor(t));}assert(c.snapshot(10000).state==State::Completed);assert(!c.begin("replacement",2,0,10000,err));assert(!c.command("ARM",0,10000,err));assert(c.command("STOP",0,10000,err));assert(c.begin("replacement",2,0,10000,err));}
 {Port p;Controller c(p);armed(c);c.tick(100,{25,30,100,false});assert(!c.command("STOP",0,100,err));assert(c.snapshot(100).state==State::Fault);c.tick(200,sensor(200));assert(c.command("STOP",0,200,err));assert(c.snapshot(200).state==State::Idle);}
 std::cout<<"demo core tests passed\n";
}

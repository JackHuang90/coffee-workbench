#include "roast/indicator.hpp"
#include "roast/core.hpp"
#include <cassert>
#include <cstring>
#include <iostream>
using namespace roast::indicator;
static constexpr Color off{},red{255,0,0},purple{255,0,255},yellow{255,255,0},cyan{0,255,255};
// Catches reversed/omitted precedence branches, including simultaneous real states.
static void priorities(){
 Inputs in{};
 in.boot=in.reset=in.error=in.configured=in.wifiConnecting=in.wifiConnected=true;
 in.bleConnected=in.bleSubscribed=in.setupPending=in.setupAuthorized=true;
 in.curveReceiving=in.curveLoaded=in.simulationRunning=in.dataTransfer=true;
 assert(render(in,0).state==State::Error);in.error=false;
 assert(render(in,0).state==State::Reset);in.reset=false;
 assert(render(in,0).state==State::SetupPending);in.setupPending=false;
 assert(render(in,0).state==State::Boot);in.boot=false;
 assert(render(in,0).state==State::CurveReceiving);in.curveReceiving=false;
 if(roast::kDemoBuild)assert(render(in,0).state==State::SimulationRunning);
 else assert(render(in,0).state==State::CurveLoaded);
 in.simulationRunning=false;
 assert(render(in,0).state==State::CurveLoaded);in.curveLoaded=false;
 assert(render(in,2200).state==State::DataTransfer);in.dataTransfer=false;
 assert(render(in,2000).state==State::SetupAuthorized);in.setupAuthorized=false;
 assert(render(in,2000).state==State::BleSubscribed);in.bleSubscribed=false;
 assert(render(in,2000).state==State::BleConnected);in.bleConnected=false;
 assert(render(in,0).state==State::WifiConnecting);in.wifiConnecting=false;
 assert(render(in,0).state==State::WifiConnected);in.wifiConnected=false;
 assert(render(in,0).state==State::ConfiguredOffline);in.configured=false;
 assert(render(in,0).state==State::Unconfigured);
}
// Catches merged blink counts, timing edges and loss of a breathing envelope.
static void phases(){
 Inputs in{};in.error=true;
 for(uint32_t t:{0u,240u,480u})assert(render(in,t).color==red);
 for(uint32_t t:{120u,360u,600u,1799u})assert(render(in,t).color==off);
 assert(render(in,1800).color==red);
 in={};in.reset=true;assert(render(in,0).color==purple);assert(render(in,120).color==off);
 in={};in.setupPending=true;assert(render(in,0).color==purple);assert(render(in,300).color==yellow);
 in={};in.boot=true;const auto low=render(in,0).color;const auto high=render(in,750).color;
 assert(low.r==low.g&&low.g==low.b&&low.r>0&&high.r>low.r);
 assert(render(in,1499).state==State::Boot);assert(render(in,1500).state==State::Unconfigured);
 in={};in.curveReceiving=true;assert(render(in,0).color==purple);assert(render(in,120).color==off);
 in={};in.curveLoaded=true;
 assert(render(in,0).color==purple);assert(render(in,120).color==off);
 assert(render(in,240).color==purple);assert(render(in,360).color==off);assert(render(in,1599).color==off);
 in={};in.setupAuthorized=true;assert(render(in,0).color==purple);assert(render(in,160).color==off);assert(render(in,240).color==off);
 in={};in.dataTransfer=true;assert(render(in,1500).color==cyan);in.dataTransfer=false;assert(render(in,1501).state==State::Unconfigured);
 in={};in.bleSubscribed=true;assert(render(in,2000).color==cyan);assert(render(in,2120).color==cyan);
 // Activity must remain distinguishable on an already subscribed cyan link.
 in.dataTransfer=true;assert(render(in,2000).color==cyan);assert(render(in,2080).color==off);assert(render(in,2160).color==cyan);
 in.dataTransfer=false;assert(render(in,2080).color==cyan);
 in={};in.bleConnected=true;assert(render(in,2000).color==cyan);assert(render(in,2120).color==off);
 in={};in.wifiConnecting=true;assert(render(in,0).color==yellow);assert(render(in,120).color==off);
 in={};in.configured=true;assert(render(in,0).color==yellow);assert(render(in,120).color==off);assert(render(in,240).color==yellow);assert(render(in,360).color==off);
 in={};in.wifiConnected=true;assert((render(in,999).color==Color{0,255,0}));
 in={};assert((render(in,0).color==Color{0,0,255}));assert(render(in,700).color==off);
 in={};in.simulationRunning=true;
 if(roast::kDemoBuild){const auto a=render(in,0).color,b=render(in,1000).color;assert(b.r>a.r&&b.g>a.g&&b.r>b.g&&b.g>0&&b.b==0);}
 else assert(render(in,1000).state==State::Unconfigured);
}
// Catches BLE activity starving Wi-Fi, lost window edges, and blink animations
// starting halfway through their pattern when a communication slot opens.
static void connectivityWindows(){
 const Color green{0,255,0},blue{0,0,255};
 Inputs in{};in.wifiConnected=in.bleConnected=in.bleSubscribed=true;
 assert(render(in,0).state==State::WifiConnected&&render(in,0).color==green);
 assert(render(in,1999).color==green);
 assert(render(in,2000).state==State::BleSubscribed&&render(in,2000).color==cyan);
 assert(render(in,2999).color==cyan);assert(render(in,3000).color==green);
 for(unsigned cycle=0;cycle<4;++cycle){
  unsigned greenFrames=0,cyanFrames=0;
  for(uint32_t dt=0;dt<3000;++dt){
   const uint32_t now=cycle*3000+dt;
   // Actual telemetry is active for 200ms each second, including both slots.
   in.dataTransfer=now%1000<200;
   const auto frame=render(in,now);
   greenFrames+=frame.color==green;cyanFrames+=frame.color==cyan;
  }
  assert(greenFrames==2000&&cyanFrames>0);
 }
 in.dataTransfer=false;in.wifiConnected=false;in.configured=true;
 assert(render(in,0).color==yellow);assert(render(in,120).color==off);
 assert(render(in,240).color==yellow);assert(render(in,360).color==off);
 assert(render(in,3000).color==yellow);assert(render(in,3240).color==yellow);
 in.wifiConnecting=true;assert(render(in,0).state==State::WifiConnecting);
 assert(render(in,3000).color==yellow);assert(render(in,3120).color==off);
 in.wifiConnecting=false;in.configured=false;
 assert(render(in,0).color==blue);assert(render(in,700).color==off);
 assert(render(in,2000).color==cyan);
 in.bleSubscribed=false;assert(render(in,2000).color==cyan);assert(render(in,2120).color==off);
 in.bleSubscribed=true;in.setupAuthorized=true;in.wifiConnected=true;
 assert(render(in,0).color==green);assert(render(in,2000).color==purple);
 assert(render(in,2160).color==off);assert(render(in,5000).color==purple);
 // An authorization pulse must survive even sustained or perfectly aligned
 // periodic activity; otherwise the local BLE phase would hide it forever.
 for(unsigned cycle=0;cycle<4;++cycle){
  const uint32_t base=cycle*3000;
  in.dataTransfer=true;
  assert(render(in,base).color==green);
  assert(render(in,base+2000).color==purple);
  assert(render(in,base+2159).color==purple);
  assert(render(in,base+2160).color==cyan);
  for(uint32_t dt=0;dt<3000;++dt){
   in.dataTransfer=(base+dt)%1000<200;
   if(dt==2000||dt==2159)assert(render(in,base+dt).color==purple);
  }
 }
 in.dataTransfer=true;
 // Safety and active business indications must preempt both communication slots.
 for(uint32_t t:{0u,1999u,2000u,2999u,3000u}){
  in.error=true;assert(render(in,t).state==State::Error);in.error=false;
  in.reset=true;assert(render(in,t).state==State::Reset);in.reset=false;
  in.setupPending=true;assert(render(in,t).state==State::SetupPending);in.setupPending=false;
  in.curveReceiving=true;assert(render(in,t).state==State::CurveReceiving);in.curveReceiving=false;
  in.curveLoaded=true;assert(render(in,t).state==State::CurveLoaded);in.curveLoaded=false;
 }
}
// Catches overflow in startup deadline and boot spuriously restarting after wrap.
static void rollover(){
 Engine normal,wrapped;normal.begin(100);wrapped.begin(0xffffff00u);Inputs in{};in.boot=true;
 for(uint32_t dt:{0u,255u,256u,750u,1499u,1500u,1800u}){
  const auto a=normal.tick(in,100+dt),b=wrapped.tick(in,0xffffff00u+dt);
  assert(a.state==b.state&&a.color==b.color);
 }
 assert(wrapped.tick(in,0xffffff10u).state!=State::Boot);
 wrapped.begin(20);assert(wrapped.tick(in,20).state==State::Boot);
}
int main(){connectivityWindows();priorities();phases();rollover();assert(std::strcmp(stateName(State::Error),"error")==0);std::cout<<"indicator tests passed\n";}

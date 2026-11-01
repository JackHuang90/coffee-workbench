#include "roast/indicator.hpp"
#include "roast/core.hpp"
namespace roast::indicator {
namespace {
constexpr Color off{},red{255,0,0},purple{255,0,255},yellow{255,255,0},cyan{0,255,255};
Color blink(Color color,uint32_t time,uint32_t period,uint32_t on){return time%period<on?color:off;}
Color pulses(Color color,uint32_t time,unsigned count,uint32_t period){
 const uint32_t phase=time%period;
 return phase<count*240&&phase%240<120?color:off;
}
Color breathe(Color color,uint32_t time,uint32_t period){
 const uint32_t phase=time%period;
 const uint32_t ramp=phase<=period/2?phase:period-phase;
 const uint32_t level=32+223*ramp/(period/2);
 return {uint8_t(color.r*level/255),uint8_t(color.g*level/255),uint8_t(color.b*level/255)};
}
State networkState(const Inputs& in){
 if(in.wifiConnecting)return State::WifiConnecting;
 if(in.configured&&!in.wifiConnected)return State::ConfiguredOffline;
 if(in.wifiConnected)return State::WifiConnected;
 return State::Unconfigured;
}
State select(const Inputs& in,uint32_t elapsed){
 if(in.error)return State::Error;
 if(in.reset)return State::Reset;
 if(in.setupPending)return State::SetupPending;
 if(in.boot&&elapsed<1500)return State::Boot;
 if(in.curveReceiving)return State::CurveReceiving;
 if(kDemoBuild&&in.simulationRunning)return State::SimulationRunning;
 if(in.curveLoaded)return State::CurveLoaded;
 if(in.dataTransfer)return State::DataTransfer;
 if(in.setupAuthorized)return State::SetupAuthorized;
 if(in.bleSubscribed)return State::BleSubscribed;
 if(in.bleConnected)return State::BleConnected;
 return networkState(in);
}
}
Frame render(const Inputs& in,uint32_t elapsed){
 State state=select(in,elapsed);uint32_t phase=elapsed;Color color{};
 // Reserve two seconds for network status and one for BLE. Telemetry activity
 // cannot starve the network window; critical/business states above BLE still
 // own the whole lamp. Restart each window's animation so no pulse is clipped.
 const bool bleState=state==State::DataTransfer||state==State::SetupAuthorized||
                     state==State::BleSubscribed||state==State::BleConnected;
 if((in.bleConnected||in.bleSubscribed)&&bleState){
  phase=elapsed%3000;
  if(phase<2000)state=networkState(in);
  else{
   phase-=2000;
   // A 1Hz telemetry burst can align with every BLE window. Reserve the
   // authorization pulse so repeated activity cannot hide the physical grant.
   if(in.setupAuthorized&&phase<160)state=State::SetupAuthorized;
  }
 }
 switch(state){
 case State::Error:color=pulses(red,phase,3,1800);break;
 case State::Reset:case State::CurveReceiving:color=blink(purple,phase,240,120);break;
 case State::SetupPending:color=phase%600<300?purple:yellow;break;
 case State::Boot:color=breathe({255,255,255},phase,1500);break;
 case State::SimulationRunning:color=breathe({255,96,0},phase,2000);break;
 case State::CurveLoaded:color=pulses(purple,phase,2,1600);break;
 case State::DataTransfer:color=blink(cyan,phase,160,80);break;
 case State::BleSubscribed:color=cyan;break;
 case State::SetupAuthorized:color=blink(purple,phase,1600,160);break;
 case State::BleConnected:color=blink(cyan,phase,240,120);break;
 case State::WifiConnecting:color=blink(yellow,phase,240,120);break;
 case State::ConfiguredOffline:color=pulses(yellow,phase,2,1600);break;
 case State::WifiConnected:color={0,255,0};break;
 case State::Unconfigured:color=blink({0,0,255},phase,1400,700);break;
 }
 return {state,color};
}
const char* stateName(State state){
 switch(state){
 case State::Error:return "error";
 case State::Reset:return "reset";
 case State::SetupPending:return "setup_pending";
 case State::Boot:return "boot";
 case State::CurveReceiving:return "curve_receiving";
 case State::SimulationRunning:return "simulation_running";
 case State::CurveLoaded:return "curve_loaded";
 case State::DataTransfer:return "data_transfer";
 case State::SetupAuthorized:return "setup_authorized";
 case State::BleSubscribed:return "ble_subscribed";
 case State::BleConnected:return "ble_connected";
 case State::WifiConnecting:return "wifi_connecting";
 case State::ConfiguredOffline:return "configured_offline";
 case State::WifiConnected:return "wifi_connected";
 case State::Unconfigured:return "unconfigured";
 }
 return "unknown";
}
void Engine::begin(uint32_t now){startedAt_=now;bootExpired_=false;}
Frame Engine::tick(const Inputs& inputs,uint32_t now){
 const uint32_t elapsed=now-startedAt_;if(elapsed>=1500)bootExpired_=true;
 Inputs bounded=inputs;bounded.boot=inputs.boot&&!bootExpired_;
 return render(bounded,elapsed);
}
}

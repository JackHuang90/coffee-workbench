#pragma once
#include <cstdint>
namespace roast::indicator {
struct Inputs {
 bool boot=false,reset=false,error=false,configured=false,wifiConnecting=false,wifiConnected=false;
 bool bleConnected=false,bleSubscribed=false,setupPending=false,setupAuthorized=false;
 bool curveReceiving=false,curveLoaded=false,simulationRunning=false,dataTransfer=false;
};
enum class State : uint8_t {
 Error,Reset,SetupPending,Boot,CurveReceiving,SimulationRunning,CurveLoaded,DataTransfer,
 SetupAuthorized,BleSubscribed,BleConnected,WifiConnecting,ConfiguredOffline,WifiConnected,Unconfigured
};
struct Color {
 uint8_t r=0,g=0,b=0;
 bool operator==(Color other)const{return r==other.r&&g==other.g&&b==other.b;}
 bool operator!=(Color other)const{return !(*this==other);}
};
struct Frame { State state=State::Unconfigured;Color color{}; };
// Pure selection/animation. elapsedMs is the unsigned elapsed time since begin.
Frame render(const Inputs& inputs,uint32_t elapsedMs);
const char* stateName(State state);
// Main-loop clock adapter; boot expires once, even across subsequent clock wraps.
class Engine {
 public:
 void begin(uint32_t now);
 Frame tick(const Inputs& inputs,uint32_t now);
 private:
 uint32_t startedAt_=0;bool bootExpired_=false;
};
}

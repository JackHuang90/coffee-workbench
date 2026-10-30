#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#ifndef ROAST_VIRTUAL_DEMO
#define ROAST_VIRTUAL_DEMO 0
#endif
namespace roast {
constexpr bool kDemoBuild = ROAST_VIRTUAL_DEMO == 1;
constexpr size_t kMaxPoints=1024;
constexpr uint32_t kMaxDurationMs=1800000, kMaxGapMs=5000, kFreshMs=1000, kLeaseMs=5000, kLoopGapMs=1000;
struct Point { uint32_t ms=0; int16_t btDeciC=0; };
struct Curve { std::array<Point,kMaxPoints> points{}; size_t count=0; uint32_t hash=0; char id[25]{}; };
uint32_t hashPoint(uint32_t hash, Point p);
uint32_t hashCurve(const Point* points,size_t count);
const char* stateName(uint8_t state);
enum class CommandSource:uint8_t { Usb, Http };
enum class Owner:uint8_t { None, Usb, Http, ModbusPower, ModbusSv };
enum class ControlMode:uint8_t { Curve, ArtisanPower, ArtisanSv };
const char* ownerName(Owner owner);
const char* controlModeName(ControlMode mode);
constexpr uint32_t kArtisanGrantMs=300000;
enum class State:uint8_t { Locked, Idle, Ready, Armed, Running, Paused, Manual, Completed, Fault, ArtisanPower, ArtisanSv };
struct Sensor { float bt=0,et=0; uint32_t at=0; bool valid=false; };
struct Snapshot {
 bool demo=kDemoBuild; State state=State::Locked; uint32_t session=0,lastSeq=0,lastAcceptedSeq=0,now=0,elapsedMs=0;
 Sensor sensor{}; bool sensorFresh=false,targetValid=false; float target=0,requested=0,virtualApplied=0;
 Owner owner=Owner::None;ControlMode controlMode=ControlMode::Curve;float fanRequested=0;uint32_t authorizationRemainingMs=0,authorizationGeneration=0;
 uint32_t curveHash=0; char curveId[25]{}; const char* reason="boot";
};
// A normalized virtual-only port. No physical actuator implementation ships.
class OutputPort { public: virtual ~OutputPort()=default; virtual void writeVirtual(float percent)=0; virtual void writeFanVirtual(float percent){(void)percent;} };
class NullOutput final:public OutputPort { public:void writeVirtual(float) override {} };
class Controller {
 public:
 explicit Controller(OutputPort& output,uint32_t session=1);
 void tick(uint32_t now,Sensor sensor);
 bool begin(const char* id,size_t count,uint32_t hash,uint32_t now,const char*& error);
 bool point(size_t index,uint32_t ms,int16_t bt,const char*& error);
 bool commit(uint32_t now,const char*& error);
 bool command(const char* verb,int argument,uint32_t now,const char*& error);
 bool acceptEnvelope(uint32_t session,uint32_t seq,uint32_t deadline,uint32_t now,const char*& error);
 bool authorize(CommandSource source,const char* verb,const char*& error)const;
 void confirmSequence(uint32_t seq,CommandSource source,const char* verb);
 bool modbusWrite(uint16_t address,uint16_t value,uint32_t now,const char*& error);
 Snapshot snapshot(uint32_t now) const;
 void transportLost(uint32_t now);
 void forceStop(uint32_t now,const char* reason="stopped");
 const Curve& curve()const{return active_;}
 private:
 OutputPort& output_; Curve active_{},staging_{}; size_t expected_=0; uint32_t expectedHash_=0;
 bool stagingOpen_=false,haveTick_=false,pausedArm_=false,autoRevoked_=false; State state_=kDemoBuild?State::Idle:State::Locked;
 uint32_t session_,lastSeq_=0,lastAcceptedSeq_=0,lastTick_=0,elapsed_=0,leaseAt_=0;
 Sensor sensor_{}; float request_=0,integral_=0,previousBt_=0; bool havePrevious_=false;
 const char* reason_="boot";
 Owner owner_=Owner::None;ControlMode controlMode_=ControlMode::Curve;
 uint32_t grantAt_=0,grantGeneration_=0;float artisanTarget_=25,fan_=0;
 bool active()const; bool fresh(uint32_t now)const; bool targetAt(uint32_t t,float& target)const;
 void output(float request);void fanOutput(float request);void runPid(float target,uint32_t dt); void fault(const char* reason); void resetPid();
};
class VirtualPlant final:public OutputPort {
 public: void writeVirtual(float percent)override;void writeFanVirtual(float percent)override; Sensor step(uint32_t now); float demand()const{return demand_;}
 private: float bt_=25,et_=25,demand_=0,fan_=0; uint32_t last_=0; bool initialized_=false;
};
}

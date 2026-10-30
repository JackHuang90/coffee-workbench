#include "roast/core.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
namespace roast {
static_assert(ROAST_VIRTUAL_DEMO==0||ROAST_VIRTUAL_DEMO==1,"explicit locked or virtual demo only");
namespace {
bool elapsedMore(uint32_t now,uint32_t since,uint32_t limit){return uint32_t(now-since)>limit;}
bool legalSensor(const Sensor& s){return s.valid&&std::isfinite(s.bt)&&std::isfinite(s.et)&&s.bt>=-50&&s.et>=-50&&s.bt<=300&&s.et<=300;}
bool legalId(const char* id){if(!id)return false;size_t i=0;for(;i<25&&id[i];++i){char c=id[i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;}return i>0&&i<=24&&id[i]==0;}
}
uint32_t hashPoint(uint32_t h,Point p){for(unsigned i=0;i<4;++i){h^=uint8_t(p.ms>>(i*8));h*=16777619u;}uint16_t bt=uint16_t(p.btDeciC);for(unsigned i=0;i<2;++i){h^=uint8_t(bt>>(i*8));h*=16777619u;}return h;}
uint32_t hashCurve(const Point* points,size_t count){uint32_t h=2166136261u;for(size_t i=0;i<count;++i)h=hashPoint(h,points[i]);return h;}
const char* stateName(uint8_t s){static const char* names[]={"LOCKED","IDLE","READY","ARMED","RUNNING","PAUSED","MANUAL","COMPLETED","FAULT","ARTISAN_POWER","ARTISAN_SV"};return s<11?names[s]:"INVALID";}
const char* ownerName(Owner o){static const char* n[]={"none","usb","http","modbus_power","modbus_sv"};return n[unsigned(o)];}
const char* controlModeName(ControlMode m){static const char* n[]={"CURVE_DEMO","ARTISAN_POWER_DEMO","ARTISAN_SV_DEMO"};return n[unsigned(m)];}
Controller::Controller(OutputPort& out,uint32_t session):output_(out),session_(session?session:1){output(0);}
bool Controller::active()const{return state_==State::Running||state_==State::Manual||state_==State::ArtisanPower||state_==State::ArtisanSv;}
bool Controller::fresh(uint32_t now)const{return kDemoBuild&&legalSensor(sensor_)&&!elapsedMore(now,sensor_.at,kFreshMs);}
void Controller::output(float request){request_=kDemoBuild&&std::isfinite(request)?std::clamp(request,0.0f,100.0f):0;output_.writeVirtual(request_);}
void Controller::fanOutput(float request){fan_=kDemoBuild&&std::isfinite(request)?std::clamp(request,0.0f,100.0f):0;output_.writeFanVirtual(fan_);}
void Controller::resetPid(){integral_=0;previousBt_=0;havePrevious_=false;}
void Controller::fault(const char* reason){output(0);fanOutput(0);owner_=Owner::None;resetPid();state_=kDemoBuild?State::Fault:State::Locked;reason_=reason;pausedArm_=false;}
void Controller::forceStop(uint32_t now,const char* reason){output(0);fanOutput(0);owner_=Owner::None;controlMode_=ControlMode::Curve;resetPid();state_=kDemoBuild?State::Idle:State::Locked;reason_=reason;elapsed_=0;lastTick_=now;stagingOpen_=false;pausedArm_=false;autoRevoked_=false;}
void Controller::transportLost(uint32_t now){(void)now;if(active()||state_==State::Armed)fault("transport_lost");}
bool Controller::targetAt(uint32_t t,float& target)const{if(active_.count<2||t>active_.points[active_.count-1].ms)return false;size_t lo=0,hi=active_.count-1;while(lo+1<hi){size_t mid=(lo+hi)/2;if(active_.points[mid].ms<=t)lo=mid;else hi=mid;}const Point&a=active_.points[lo],&b=active_.points[hi];if(t<a.ms||b.ms<=a.ms)return false;float f=float(t-a.ms)/float(b.ms-a.ms);target=(float(a.btDeciC)+(b.btDeciC-a.btDeciC)*f)/10.0f;return std::isfinite(target);}
void Controller::tick(uint32_t now,Sensor sensor){
 if(!kDemoBuild){sensor_={};output(0);lastTick_=now;haveTick_=true;return;}
 sensor_=sensor;const uint32_t dt=now-lastTick_;const bool hadTick=haveTick_;lastTick_=now;haveTick_=true;
 if(!(active()||state_==State::Armed)){output(0);return;}
 if(!fresh(now)){fault("sensor_invalid_or_stale");return;}
 if(controlMode_!=ControlMode::Curve&&uint32_t(now-grantAt_)>=kArtisanGrantMs){fault("artisan_authorization_expired");return;}
 if(elapsedMore(now,leaseAt_,kLeaseMs)){fault("lease_expired");return;}
 if(hadTick&&dt>kLoopGapMs){fault("scheduler_gap");return;}
 if(!active()||dt==0)return;
 if(dt>kMaxDurationMs-elapsed_){fault("duration_limit");return;}
 elapsed_+=dt;
 if(controlMode_!=ControlMode::Curve){if(state_==State::ArtisanSv)runPid(artisanTarget_,dt);return;}
 const uint32_t end=active_.points[active_.count-1].ms;
 if(elapsed_>=end){elapsed_=end;output(0);resetPid();state_=State::Completed;reason_="curve_completed";return;}
 float target=0;if(!targetAt(elapsed_,target)){fault("target_unavailable");return;}
 if(state_==State::Manual)return;
 runPid(target,dt);
}
void Controller::runPid(float target,uint32_t dt){
 const float seconds=float(dt)/1000.0f,error=target-sensor_.bt;
 const float derivative=havePrevious_?-(sensor_.bt-previousBt_)/seconds:0;
 const float proposed=std::clamp(integral_+0.08f*error*seconds,-100.0f,100.0f);
 const float raw=2.0f*error+proposed+0.4f*derivative;
 if(!((raw>100&&error>0)||(raw<0&&error<0)))integral_=proposed;
 const float value=2.0f*error+integral_+0.4f*derivative;
 if(!std::isfinite(value)){fault("pid_nonfinite");return;}
 output(value);previousBt_=sensor_.bt;havePrevious_=true;
}
bool Controller::begin(const char* id,size_t count,uint32_t hash,uint32_t now,const char*& e){(void)now;
 if(!kDemoBuild){e="hardware_locked";return false;}
 if(active()||state_==State::Armed||state_==State::Paused||state_==State::Fault){e="bad_state";return false;}
 if(autoRevoked_){e="stop_required_after_manual";return false;}
 if(!legalId(id)||count<2||count>kMaxPoints){e="invalid_profile";return false;}
 // Reset metadata in place: a Curve{} temporary exceeds the ESP loop stack.
 // Entries beyond count are inaccessible and overwritten sequentially.
 staging_.count=0;staging_.hash=0;staging_.id[0]=0;std::strcpy(staging_.id,id);expected_=count;expectedHash_=hash;stagingOpen_=true;e="staging";return true;
}
bool Controller::point(size_t index,uint32_t ms,int16_t bt,const char*& e){
 if(!kDemoBuild){e="hardware_locked";return false;}
 if(!stagingOpen_||index!=staging_.count||index>=expected_){e="point_order";return false;}
 if(ms>kMaxDurationMs||bt<-200||bt>2800||(index==0&&ms!=0)||(index>0&&(ms<=staging_.points[index-1].ms||ms-staging_.points[index-1].ms>kMaxGapMs))){e="invalid_point";return false;}
 staging_.points[index]={ms,bt};++staging_.count;e="point_staged";return true;
}
bool Controller::commit(uint32_t now,const char*& e){
 if(!kDemoBuild){e="hardware_locked";return false;}
 if(!stagingOpen_||staging_.count!=expected_){e="incomplete_profile";return false;}
 const uint32_t hash=hashCurve(staging_.points.data(),staging_.count);if(hash!=expectedHash_){e="hash_mismatch";return false;}
 staging_.hash=hash;active_=staging_;stagingOpen_=false;forceStop(now,"profile_committed");state_=State::Ready;e="profile_committed";return true;
}
bool Controller::acceptEnvelope(uint32_t session,uint32_t seq,uint32_t deadline,uint32_t now,const char*& e){
 if(session!=session_){e="wrong_session";return false;}
 if(seq==0||seq<=lastSeq_){e="replayed_sequence";return false;}
 if(uint32_t(deadline-now)>kLeaseMs){e="expired_or_future_deadline";return false;}
 lastSeq_=seq;e="envelope_accepted";return true;
}
bool Controller::command(const char* verb,int argument,uint32_t now,const char*& e){
 if(!kDemoBuild){e="hardware_locked";return false;}
 auto fail=[&](const char* code){e=code;return false;};
 if(!std::strcmp(verb,"STOP")){if(state_==State::Fault&&!fresh(now))return fail("fault_cause_present");forceStop(now);e="stopped";return true;}
 if(!std::strcmp(verb,"ARTISAN_POWER")||!std::strcmp(verb,"ARTISAN_SV")){
  if(state_!=State::Idle&&state_!=State::Ready)return fail("bad_state");
  if(!fresh(now))return fail("sensor_invalid_or_stale");
  if(grantGeneration_==UINT32_MAX)return fail("grant_generation_exhausted_reboot_required");
  ++grantGeneration_;
  const bool power=!std::strcmp(verb,"ARTISAN_POWER");forceStop(now,"artisan_local_usb_grant");
  owner_=power?Owner::ModbusPower:Owner::ModbusSv;controlMode_=power?ControlMode::ArtisanPower:ControlMode::ArtisanSv;
  state_=power?State::ArtisanPower:State::ArtisanSv;grantAt_=leaseAt_=lastTick_=now;artisanTarget_=sensor_.bt;e="virtual_artisan_granted_5min";return true;
 }
 if(!std::strcmp(verb,"ABORT")){stagingOpen_=false;e="staging_aborted";return true;}
 if(!std::strcmp(verb,"PING")){leaseAt_=now;e="lease_renewed";return true;}
 if(!std::strcmp(verb,"ARM")){
  if(autoRevoked_)return fail("stop_required_after_manual");
  if(!(state_==State::Ready||state_==State::Idle||state_==State::Paused||state_==State::Completed))return fail("bad_state");
  if(stagingOpen_||active_.count<2)return fail("profile_not_ready");
  if(!fresh(now))return fail("sensor_invalid_or_stale");
  pausedArm_=state_==State::Paused;if(!pausedArm_)elapsed_=0;output(0);resetPid();state_=State::Armed;leaseAt_=now;lastTick_=now;reason_="explicitly_armed";e="armed";return true;
 }
 if(!std::strcmp(verb,"START")){
  if(state_!=State::Armed)return fail("bad_state");
  if(!fresh(now)||elapsedMore(now,leaseAt_,kLeaseMs)){fault("start_precondition");return fail("start_precondition");}
  state_=State::Running;lastTick_=now;reason_=pausedArm_?"resumed":"started";e=reason_;return true;
 }
 if(!std::strcmp(verb,"PAUSE")){if(!active())return fail("bad_state");output(0);resetPid();state_=State::Paused;reason_="paused";e=reason_;return true;}
 if(!std::strcmp(verb,"MANUAL")){if(state_!=State::Running)return fail("bad_state");output(0);resetPid();state_=State::Manual;autoRevoked_=true;reason_="manual_takeover";e=reason_;return true;}
 if(!std::strcmp(verb,"OUTPUT")){if(state_!=State::Manual)return fail("bad_state");if(argument<0||argument>100)return fail("invalid_output");if(!fresh(now)||elapsedMore(now,leaseAt_,kLeaseMs)){fault("manual_precondition");return fail("manual_precondition");}output(float(argument));e="virtual_output_requested";return true;}
 return fail("unknown_command");
}
Snapshot Controller::snapshot(uint32_t now)const{Snapshot s;s.state=state_;s.session=session_;s.lastSeq=lastSeq_;s.lastAcceptedSeq=lastAcceptedSeq_;s.now=now;s.elapsedMs=elapsed_;s.sensor=sensor_;s.sensorFresh=fresh(now);s.targetValid=targetAt(elapsed_,s.target);s.requested=request_;s.virtualApplied=request_;s.owner=owner_;s.authorizationGeneration=grantGeneration_;s.controlMode=controlMode_;s.fanRequested=fan_;if(controlMode_!=ControlMode::Curve){s.targetValid=controlMode_==ControlMode::ArtisanSv;s.target=artisanTarget_;s.curveHash=0;std::strcpy(s.curveId,controlModeName(controlMode_));if(owner_!=Owner::None&&uint32_t(now-grantAt_)<kArtisanGrantMs)s.authorizationRemainingMs=kArtisanGrantMs-uint32_t(now-grantAt_);}else{s.curveHash=active_.hash;std::strcpy(s.curveId,active_.id);}s.reason=reason_;return s;}
bool Controller::authorize(CommandSource source,const char* verb,const char*& e)const{
 if((!std::strcmp(verb,"ARTISAN_POWER")||!std::strcmp(verb,"ARTISAN_SV"))&&source!=CommandSource::Usb){e="local_usb_authorization_required";return false;}
 if(!std::strcmp(verb,"STOP"))return true; // Any channel may only revoke, never take over, another owner.
 const Owner incoming=source==CommandSource::Usb?Owner::Usb:Owner::Http;
 if(owner_!=Owner::None&&owner_!=incoming){e="control_owned_by_other_channel";return false;}return true;
}
void Controller::confirmSequence(uint32_t seq,CommandSource source,const char* verb){
 lastAcceptedSeq_=seq;
 if(owner_==Owner::None&&std::strcmp(verb,"STOP")&&std::strcmp(verb,"PING"))owner_=source==CommandSource::Usb?Owner::Usb:Owner::Http;
}
bool Controller::modbusWrite(uint16_t address,uint16_t value,uint32_t now,const char*& e){
 if(!kDemoBuild){e="hardware_locked";return false;}
 if(address==100){if(value!=0){e="invalid_value";return false;}return command("STOP",0,now,e);}
 if(address<101||address>104){e="invalid_address";return false;}
 const int16_t signedValue=static_cast<int16_t>(value);
 if((address==101&&(signedValue<-200||signedValue>2800))||((address==102||address==103)&&value>1000)||(address==104&&value!=1)){e="invalid_value";return false;}
 if(owner_!=Owner::ModbusPower&&owner_!=Owner::ModbusSv){e="local_usb_authorization_required";return false;}
 if(!fresh(now)||elapsedMore(now,leaseAt_,kLeaseMs)||uint32_t(now-grantAt_)>=kArtisanGrantMs){fault("artisan_authorization_or_lease_expired");e="artisan_authorization_or_lease_expired";return false;}
 if((address==101&&owner_!=Owner::ModbusSv)||(address==102&&owner_!=Owner::ModbusPower)){e="wrong_artisan_control_mode";return false;}
 if(address==101)artisanTarget_=float(signedValue)/10.0f;
 if(address==102)output(float(value)/10.0f);
 if(address==103)fanOutput(float(value)/10.0f);
 leaseAt_=now;e="virtual_modbus_request_accepted";return true;
}
void VirtualPlant::writeFanVirtual(float percent){fan_=std::isfinite(percent)?std::clamp(percent,0.0f,100.0f):0;}
void VirtualPlant::writeVirtual(float percent){demand_=std::isfinite(percent)?std::clamp(percent,0.0f,100.0f):0;}
Sensor VirtualPlant::step(uint32_t now){if(!initialized_){initialized_=true;last_=now;return {bt_,et_,now,true};}uint32_t dt=now-last_;last_=now;if(dt>kLoopGapMs)return {bt_,et_,now,false};unsigned steps=(dt+49)/50;if(steps){float h=float(dt)/1000.0f/steps;for(unsigned i=0;i<steps;++i){et_+=(3.0f*demand_/100.0f-(0.018f+0.018f*fan_/100.0f)*(et_-25))*h;bt_+=0.045f*(et_-bt_)*h;}}return {bt_,et_,now,true};}
}

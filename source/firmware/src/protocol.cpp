#include "roast/protocol.hpp"
#include <climits>
#include <cstdio>
#include <cstring>
namespace roast {
namespace {
size_t checked(int n,char* out,size_t cap){if(n<0||size_t(n)>=cap){if(cap)out[0]=0;return 0;}return size_t(n);}
size_t ack(const Controller& c,uint32_t now,uint32_t seq,bool ok,const char* code,char* out,size_t cap){return checked(std::snprintf(out,cap,"{\"v\":1,\"ok\":%s,\"code\":\"%s\",\"seq\":%lu,\"state\":\"%s\",\"physical_enabled\":false,\"physical_actual_pct\":null}",ok?"true":"false",code,(unsigned long)seq,stateName(uint8_t(c.snapshot(now).state))),out,cap);}
bool uintToken(const char* s,uint32_t& n){if(!s||!*s)return false;n=0;for(;*s;s++){if(*s<'0'||*s>'9')return false;uint32_t d=uint32_t(*s-'0');if(n>(UINT32_MAX-d)/10)return false;n=n*10+d;}return true;}
bool intToken(const char* s,int& n){bool negative=s&&*s=='-';if(negative)++s;uint32_t u;if(!uintToken(s,u)||u>uint32_t(INT_MAX))return false;n=negative?-int(u):int(u);return true;}
}
size_t statusJson(const Controller& controller,uint32_t now,char* out,size_t cap){
 const Snapshot s=controller.snapshot(now);char bt[24]="null",et[24]="null",target[24]="null";
 if(s.sensorFresh){std::snprintf(bt,sizeof bt,"%.2f",double(s.sensor.bt));std::snprintf(et,sizeof et,"%.2f",double(s.sensor.et));}
 if(s.targetValid)std::snprintf(target,sizeof target,"%.2f",double(s.target));
 return checked(std::snprintf(out,cap,"{\"v\":1,\"mode\":\"%s\",\"source\":\"%s\",\"state\":\"%s\",\"session\":%lu,\"last_seq\":%lu,\"uptime_ms\":%lu,\"bt\":%s,\"et\":%s,\"target_bt\":%s,\"sensor_valid\":%s,\"elapsed_ms\":%lu,\"curve_id\":\"%s\",\"curve_hash\":%lu,\"requested_pct\":%.2f,\"virtual_applied_pct\":%.2f,\"physical_actual_pct\":null,\"physical_enabled\":false,\"pending_request_id\":null,\"last_accepted_seq\":%lu,\"reason\":\"%s\",\"owner\":\"%s\",\"control_mode\":\"%s\",\"fan_requested_pct\":%.2f,\"authorization_remaining_ms\":%lu,\"authorization_generation\":%lu,\"hardware_profile\":\"unverified\",\"limits\":{\"max_points\":1024,\"max_duration_ms\":1800000,\"max_gap_ms\":5000,\"lease_ms\":5000,\"sensor_fresh_ms\":1000}}",s.demo?"VIRTUAL_DEMO":"LOCKED",s.demo?"virtual_demo":"unavailable",stateName(uint8_t(s.state)),(unsigned long)s.session,(unsigned long)s.lastSeq,(unsigned long)s.now,bt,et,target,s.sensorFresh?"true":"false",(unsigned long)s.elapsedMs,s.curveId,(unsigned long)s.curveHash,double(s.requested),double(s.virtualApplied),(unsigned long)s.lastAcceptedSeq,s.reason,ownerName(s.owner),s.demo?controlModeName(s.controlMode):"LOCKED",double(s.fanRequested),(unsigned long)s.authorizationRemainingMs,(unsigned long)s.authorizationGeneration),out,cap);
}
size_t respond(Controller& c,const char* line,size_t length,uint32_t now,char* out,size_t cap,CommandSource source){
 auto fail=[&](const char* code,uint32_t seq=0){return ack(c,now,seq,false,code,out,cap);};
 if(!out||!cap)return 0;
 if(!line||length==0)return fail("empty_line");
 if(length>kMaxLine)return fail("line_too_long");
 char buf[kMaxLine+1];for(size_t i=0;i<length;++i){if(line[i]<32||line[i]>126)return fail("invalid_ascii");buf[i]=line[i];}buf[length]=0;
 if(!std::strcmp(buf,"STATUS")||!std::strcmp(buf,"HELLO"))return statusJson(c,now,out,cap);
 // Never commit a command when its acknowledgement cannot be retained.
 if(cap<kResponseSize){out[0]=0;return 0;}
 char* tokens[10]{};size_t count=0;char* at=buf;
 while(*at){while(*at==' ')++at;if(!*at)break;if(count==10)return fail("too_many_tokens");tokens[count++]=at;while(*at&&*at!=' ')++at;if(*at)*at++=0;}
 uint32_t session=0,seq=0,deadline=0;
 if(count<5||std::strcmp(tokens[0],"R1")||!uintToken(tokens[1],session)||!uintToken(tokens[2],seq)||!uintToken(tokens[3],deadline))return fail("invalid_envelope");
 const char* verb=tokens[4];uint32_t a=0,b=0;int argument=0;
 bool begin=!std::strcmp(verb,"BEGIN"),point=!std::strcmp(verb,"POINT"),output=!std::strcmp(verb,"OUTPUT");
 if(begin){if(count!=8||!uintToken(tokens[6],a)||!uintToken(tokens[7],b))return fail("invalid_arguments",seq);}
 else if(point){if(count!=8||!uintToken(tokens[5],a)||!uintToken(tokens[6],b)||!intToken(tokens[7],argument)||argument<INT16_MIN||argument>INT16_MAX)return fail("invalid_arguments",seq);}
 else if(output){if(count!=6||!intToken(tokens[5],argument))return fail("invalid_arguments",seq);}
 else if(count!=5)return fail("invalid_arguments",seq);
 const char* code="unknown_command";if(!c.authorize(source,verb,code))return fail(code,seq);if(!c.acceptEnvelope(session,seq,deadline,now,code))return fail(code,seq);
 bool ok=false;
 if(begin)ok=c.begin(tokens[5],a,b,now,code);
 else if(point)ok=c.point(a,b,int16_t(argument),code);
 else if(!std::strcmp(verb,"COMMIT"))ok=c.commit(now,code);
 else ok=c.command(verb,argument,now,code);
 if(ok)c.confirmSequence(seq,source,verb);
 return ack(c,now,seq,ok,code,out,cap);
}
void LineFramer::reset(){length_=0;since_=0;started_=false;dropping_=false;delivered_=false;buffer_[0]=0;}
bool LineFramer::expire(uint32_t now){if(started_&&!delivered_&&uint32_t(now-since_)>1000){length_=0;started_=false;dropping_=true;return true;}return false;}
LineFramer::Result LineFramer::feed(char byte,uint32_t now){
 if(delivered_)reset();
 expire(now);
 if(byte=='\n'){
  if(dropping_){reset();return Result::Rejected;}
  if(length_&&buffer_[length_-1]=='\r')--length_;
  buffer_[length_]=0;delivered_=true;started_=false;return Result::Line;
 }
 if(dropping_)return Result::None;
 if(!started_){started_=true;since_=now;}
 if(length_==kMaxLine){dropping_=true;length_=0;return Result::None;}buffer_[length_++]=byte;return Result::None;
}
}

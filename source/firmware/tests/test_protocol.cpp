#include "roast/protocol.hpp"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
using namespace roast;
int main(){
 NullOutput p;Controller c(p,42);c.tick(100,{25,30,100,true});char out[kResponseSize];
 auto call=[&](const std::string& x,uint32_t now=100){assert(respond(c,x.data(),x.size(),now,out,sizeof out,CommandSource::Usb)>0);return std::string(out);};
 assert(call("HELLO").find("physical_enabled\":false")!=std::string::npos);
 assert(call("STATUS").find("max_points\":1024")!=std::string::npos);
 assert(call("STATUS").find(kDemoBuild?"VIRTUAL_DEMO":"LOCKED")!=std::string::npos);
 assert(call(std::string(256,'a')).find("line_too_long")!=std::string::npos);
 assert(call("R1 42 1 100 OUTPUT nan").find("invalid_arguments")!=std::string::npos);
 assert(call("R1 42 1 100 OUTPUT 4294967296").find("invalid_arguments")!=std::string::npos);
 assert(call("R1 42 1 100 STOP junk").find("invalid_arguments")!=std::string::npos);
 assert(call("R2 42 1 100 STOP").find("invalid_envelope")!=std::string::npos);
 assert(call("R1 41 1 100 STOP").find("wrong_session")!=std::string::npos);
 assert(call("R1 42 1 99 STOP").find("expired_or_future_deadline")!=std::string::npos);
 assert(call("R1 42 1 5101 STOP").find("expired_or_future_deadline")!=std::string::npos);
 assert(call("R1 42 4294967296 100 STOP").find("invalid_envelope")!=std::string::npos);
 std::string embedded="R1 42 1 100 STOP";embedded.push_back('\0');embedded+="x";assert(call(embedded).find("invalid_ascii")!=std::string::npos);
 auto valid=call("R1 42 1 100 STOP");assert(valid.find(kDemoBuild?"stopped":"hardware_locked")!=std::string::npos);
 assert(call("R1 42 1 100 STOP").find("replayed_sequence")!=std::string::npos);
 assert(call("R1 42 2 100 UNKNOWN").find(kDemoBuild?"unknown_command":"hardware_locked")!=std::string::npos);
 assert(call("R1 42 2 100 STOP").find("replayed_sequence")!=std::string::npos);
 assert(c.snapshot(100).lastSeq==2);
 assert(c.snapshot(100).lastAcceptedSeq==(kDemoBuild?1u:0u));
 char tiny[2];auto before=c.snapshot(100).lastSeq;assert(respond(c,"R1 42 3 100 STOP",16,100,tiny,sizeof tiny,CommandSource::Usb)==0);assert(c.snapshot(100).lastSeq==before);assert(respond(c,"STATUS",6,100,tiny,sizeof tiny,CommandSource::Usb)==0);assert(tiny[0]=='\0');
 LineFramer f;for(char x:std::string("STATUS\r"))assert(f.feed(x,100)==LineFramer::Result::None);assert(f.feed('\n',101)==LineFramer::Result::Line);assert(f.size()==6&&!strcmp(f.data(),"STATUS"));
 assert(f.feed('X',200)==LineFramer::Result::None);assert(f.expire(1201));for(char x:std::string("HELLO"))f.feed(x,1201);assert(f.feed('\n',1201)==LineFramer::Result::Rejected);assert(f.feed('A',1202)==LineFramer::Result::None);assert(f.feed('\n',1202)==LineFramer::Result::Line);
 for(size_t i=0;i<256;++i){f.feed('A',1203);}
 assert(f.feed('\n',1203)==LineFramer::Result::Rejected);for(char x:std::string("HELLO"))f.feed(x,1204);assert(f.feed('\n',1204)==LineFramer::Result::Line);
 f.reset();f.feed('A',0xffffff00u);assert(f.expire(0xffffff00u+1001));assert(f.feed('\n',800)==LineFramer::Result::Rejected);
 std::cout<<(kDemoBuild?"demo":"locked")<<" protocol tests passed\n";
}

#include "roast/modbus.hpp"
#include "roast/rtu.hpp"
#include "roast/protocol.hpp"
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <vector>
using namespace roast;
static RtuProfile profile(){return {1,3,0,true,0.1f,0,-50,300,100};}
static std::vector<uint8_t> rtu(std::initializer_list<uint8_t> bytes){
 std::vector<uint8_t> v(bytes); auto crc=modbusCrc(v.data(),v.size());v.push_back(crc&255);v.push_back(crc>>8);return v;
}
static RtuReader::Result feed(RtuReader& reader,const std::vector<uint8_t>& bytes,uint32_t now){
 RtuReader::Result result=RtuReader::Result::None; for(auto b:bytes) result=reader.feed(b,now);return result;
}
static void testRtu(){
 const uint8_t known[]={1,3,0,0,0,1};assert(modbusCrc(known,6)==0x0A84);
 uint8_t request[8]{};RtuReader reader;auto p=profile();
 assert(reader.start(p,10,request,8)==8);assert(std::memcmp(request,known,6)==0);assert(request[6]==0x84&&request[7]==0x0A);
 assert(reader.start(p,11,request,8)==0);assert(reader.pending());
 auto negative=rtu({1,3,2,0xFF,0x9C});assert(feed(reader,negative,12)==RtuReader::Result::Complete);
 assert(reader.sample().valid&&std::fabs(reader.sample().value+10)<0.01f&&reader.sample().at==12);
 assert(reader.feed(1,13)==RtuReader::Result::Rejected);assert(!reader.sample().valid); // duplicate/unexpected frame invalidates cached sample.
 assert(reader.start(p,20,request,7)==0);
 p.slave=0;assert(reader.start(p,20,request,8)==0);p=profile();p.function=6;assert(reader.start(p,20,request,8)==0);
 p=profile();p.scale=std::numeric_limits<float>::quiet_NaN();assert(reader.start(p,20,request,8)==0);
 p=profile();p.timeoutMs=0;assert(reader.start(p,20,request,8)==0);
 p=profile();assert(reader.start(p,20,request,8)==8);assert(reader.feed(2,21)==RtuReader::Result::Rejected);assert(reader.sample().error==RtuError::WrongSlave);
 assert(reader.start(p,30,request,8)==8);reader.feed(1,31);assert(reader.feed(4,31)==RtuReader::Result::Rejected);assert(reader.sample().error==RtuError::WrongFunction);
 assert(reader.start(p,40,request,8)==8);reader.feed(1,41);reader.feed(3,41);assert(reader.feed(4,41)==RtuReader::Result::Rejected);assert(reader.sample().error==RtuError::Length);
 assert(reader.start(p,50,request,8)==8);auto bad=negative;bad[6]^=1;assert(feed(reader,bad,51)==RtuReader::Result::Rejected);assert(reader.sample().error==RtuError::Crc);
 assert(reader.start(p,60,request,8)==8);assert(feed(reader,rtu({1,0x83,2}),61)==RtuReader::Result::Rejected);assert(reader.sample().error==RtuError::Exception&&reader.sample().exception==2);
 assert(reader.start(p,70,request,8)==8);assert(feed(reader,rtu({1,3,2,0x7F,0xFF}),71)==RtuReader::Result::Rejected);assert(reader.sample().error==RtuError::Range);
 assert(reader.start(p,100,request,8)==8);reader.feed(1,101);assert(!reader.expire(199));assert(reader.expire(200));assert(reader.sample().error==RtuError::Timeout&&!reader.pending());
 assert(reader.start(p,UINT32_MAX-50,request,8)==8);assert(!reader.expire(48));assert(reader.expire(49));
 assert(reader.start(p,300,request,8)==8);assert(reader.feed(1,400)==RtuReader::Result::Rejected);assert(reader.sample().error==RtuError::Timeout);
 p=profile();p.signedValue=false;p.scale=0.001f;assert(reader.start(p,500,request,8)==8);assert(feed(reader,rtu({1,3,2,0xFF,0xFF}),501)==RtuReader::Result::Complete);assert(std::fabs(reader.sample().value-65.535f)<.001f);
}
static std::vector<uint8_t> tcp(uint8_t fn,uint16_t address,uint16_t count){return {0x12,0x34,0,0,0,6,1,fn,uint8_t(address>>8),uint8_t(address),uint8_t(count>>8),uint8_t(count)};}
static void testFramer(){
 TcpFramer f;auto bytes=tcp(3,4,4);for(size_t i=0;i<bytes.size();++i)assert(f.feed(bytes[i],10)==(i+1==bytes.size()?TcpFramer::Result::Complete:TcpFramer::Result::None));
 assert(f.size()==12&&std::memcmp(f.data(),bytes.data(),12)==0);assert(f.feed(0,11)==TcpFramer::Result::Rejected);f.reset();
 auto bad=bytes;bad[2]=1;for(size_t i=0;i<6;++i)f.feed(bad[i],20);assert(f.feed(1,21)==TcpFramer::Result::Rejected);f.reset();
 bad=bytes;bad[4]=1;bad[5]=255;for(size_t i=0;i<6;++i)f.feed(bad[i],30);assert(f.feed(1,31)==TcpFramer::Result::Rejected);f.reset();
 bad=bytes;bad[5]=1;for(size_t i=0;i<6;++i)f.feed(bad[i],40);assert(f.feed(1,41)==TcpFramer::Result::Rejected);f.reset();
 f.feed(0,100);assert(!f.expire(1099));assert(f.expire(1100));assert(f.feed(0,1101)==TcpFramer::Result::Rejected);f.reset();
 f.feed(0,UINT32_MAX-500);assert(!f.expire(498));assert(f.expire(499));f.reset();
 f.feed(0,0);assert(f.feed(0,1000)==TcpFramer::Result::Rejected);f.reset();
 std::vector<uint8_t> maximum(kMaxTcpFrame,0);maximum[4]=0;maximum[5]=254;for(size_t i=0;i<maximum.size();++i)assert(f.feed(maximum[i],0)==(i+1==maximum.size()?TcpFramer::Result::Complete:TcpFramer::Result::None));
}
#ifndef ROAST_TRANSPORT_CODEC_ONLY
static void testModbus(){
 NullOutput output;Controller c(output,123);uint8_t reply[64]{};auto req=tcp(3,4,4);
 auto n=handleModbus(req.data(),req.size(),reply,sizeof(reply),c,0);assert(n==17&&reply[0]==0x12&&reply[1]==0x34&&reply[7]==3&&reply[8]==8);
 uint16_t flags=(reply[9]<<8)|reply[10];assert(flags&8);assert(bool(flags&0x8000)==kDemoBuild);assert(reply[16]==1);
 req=tcp(3,0,2);n=handleModbus(req.data(),req.size(),reply,sizeof(reply),c,0);assert(n==9&&reply[7]==0x83&&reply[8]==4);
 req=tcp(3,11,2);n=handleModbus(req.data(),req.size(),reply,sizeof(reply),c,0);assert(n==9&&reply[8]==2);
 req=tcp(3,4,0);n=handleModbus(req.data(),req.size(),reply,sizeof(reply),c,0);assert(n==9&&reply[8]==3);
 req=tcp(3,4,4);assert(handleModbus(req.data(),11,reply,sizeof(reply),c,0)==0);req[2]=1;assert(handleModbus(req.data(),12,reply,sizeof(reply),c,0)==0);req[2]=0;req[6]=2;assert(handleModbus(req.data(),12,reply,sizeof(reply),c,0)==0);
 req=tcp(16,0,1);n=handleModbus(req.data(),12,reply,sizeof(reply),c,0);assert(n==9&&reply[7]==0x90&&reply[8]==1);
 req=tcp(6,100,1);n=handleModbus(req.data(),12,reply,sizeof(reply),c,0);assert(n==9&&reply[8]==3);
 req=tcp(6,105,0);n=handleModbus(req.data(),12,reply,sizeof(reply),c,0);assert(n==9&&reply[8]==2);
 req=tcp(6,100,0);n=handleModbus(req.data(),12,reply,sizeof(reply),c,0);assert(n==(kDemoBuild?12:9));if(!kDemoBuild)assert(reply[8]==4);else assert(c.snapshot(0).state==State::Idle);
 req=tcp(3,4,4);assert(handleModbus(req.data(),12,reply,8,c,0)==0);
 if(kDemoBuild){
  const Point points[]={{0,250},{5000,1000}};const char* error=nullptr;
  c.tick(0,{25,30,0,true});assert(c.begin("stop_test",2,hashCurve(points,2),0,error));
  assert(c.point(0,0,250,error)&&c.point(1,5000,1000,error)&&c.commit(0,error));
  assert(c.command("ARM",0,0,error)&&c.command("START",0,0,error)&&c.command("MANUAL",0,0,error)&&c.command("OUTPUT",80,0,error));
  req=tcp(6,100,0);assert(handleModbus(req.data(),12,reply,11,c,0)==0);assert(c.snapshot(0).requested==80);
  n=handleModbus(req.data(),12,reply,sizeof(reply),c,0);assert(n==12&&c.snapshot(0).requested==0&&c.snapshot(0).state==State::Idle);
  n=handleModbus(req.data(),12,reply,sizeof(reply),c,0);assert(n==12&&c.snapshot(0).requested==0); // duplicate STOP is safe/idempotent, never rearms.
  assert(!c.command("START",0,0,error));
  c.tick(100,{123.4f,234.5f,100,true});req=tcp(3,0,2);n=handleModbus(req.data(),12,reply,sizeof(reply),c,100);assert(n==13);assert(((reply[9]<<8)|reply[10])==1234);assert(((reply[11]<<8)|reply[12])==2345);n=handleModbus(req.data(),12,reply,sizeof(reply),c,1101);assert(n==9&&reply[8]==4);}
}
#endif
#ifndef ROAST_TRANSPORT_CODEC_ONLY
static void testArtisanGrantRegisters(){
 NullOutput output;Controller c(output,321);c.tick(0,{25,30,0,true});uint8_t reply[64]{};
 auto req=tcp(6,102,650);assert(handleModbus(req.data(),12,reply,sizeof reply,c,0)==9&&reply[8]==4);
 if(!kDemoBuild)return;
 char response[kResponseSize]{};const char* grant="R1 321 1 5000 ARTISAN_POWER";
 respond(c,grant,std::strlen(grant),0,response,sizeof response,CommandSource::Http);assert(std::strstr(response,"\"ok\":false"));
 grant="R1 321 2 5000 ARTISAN_POWER";respond(c,grant,std::strlen(grant),0,response,sizeof response,CommandSource::Usb);assert(std::strstr(response,"\"ok\":true"));
 assert(handleModbus(req.data(),12,reply,sizeof reply,c,0)==12);assert(c.snapshot(0).requested==65);
 req=tcp(6,103,300);assert(handleModbus(req.data(),12,reply,sizeof reply,c,0)==12);assert(c.snapshot(0).fanRequested==30);
 req=tcp(3,8,4);assert(handleModbus(req.data(),12,reply,sizeof reply,c,0)==17);assert(((reply[9]<<8)|reply[10])==300&&reply[12]==3&&reply[14]==1&&((reply[15]<<8)|reply[16])==300);
 req=tcp(6,101,1500);assert(handleModbus(req.data(),12,reply,sizeof reply,c,0)==9&&reply[8]==4);
 req=tcp(6,102,1001);assert(handleModbus(req.data(),12,reply,sizeof reply,c,0)==9&&reply[8]==3);assert(c.snapshot(0).requested==65);
 req=tcp(6,104,1);assert(handleModbus(req.data(),12,reply,sizeof reply,c,0)==12);
 // Reads do not renew authorization or heartbeat lease.
 for(uint32_t now=500;now<=5000;now+=500){c.tick(now,{25,30,now,true});req=tcp(3,4,4);assert(handleModbus(req.data(),12,reply,sizeof reply,c,now)>0);}
 c.tick(5001,{25,30,5001,true});req=tcp(6,102,400);assert(handleModbus(req.data(),12,reply,sizeof reply,c,5001)==9&&reply[8]==4);assert(c.snapshot(5001).requested==0&&c.snapshot(5001).fanRequested==0);
 req=tcp(6,100,0);assert(handleModbus(req.data(),12,reply,sizeof reply,c,5001)==12);
 grant="R1 321 3 10000 ARTISAN_SV";respond(c,grant,std::strlen(grant),5001,response,sizeof response,CommandSource::Usb);assert(std::strstr(response,"\"ok\":true"));
 req=tcp(6,101,1800);assert(handleModbus(req.data(),12,reply,sizeof reply,c,5001)==12);req=tcp(3,2,1);assert(handleModbus(req.data(),12,reply,sizeof reply,c,5001)==11&&((reply[9]<<8)|reply[10])==1800);
 req=tcp(6,102,500);assert(handleModbus(req.data(),12,reply,sizeof reply,c,5001)==9&&reply[8]==4);
 req=tcp(6,101,uint16_t(-100));assert(handleModbus(req.data(),12,reply,sizeof reply,c,5001)==12);req=tcp(3,2,1);assert(handleModbus(req.data(),12,reply,sizeof reply,c,5001)==11&&((reply[9]<<8)|reply[10])==uint16_t(-100));
}
static void testModbusFaultLatch(){
 if(!kDemoBuild)return;
 NullOutput output;Controller c(output,321);const char* error=nullptr;Point points[]={{0,250},{5000,500}};
 c.tick(0,{25,30,0,true});assert(c.begin("fault_latch",2,hashCurve(points,2),0,error));
 assert(c.point(0,0,250,error)&&c.point(1,5000,500,error)&&c.commit(0,error));
 assert(c.command("ARM",0,0,error)&&c.command("START",0,0,error));c.tick(10,{25,30,10,false});
 assert(c.snapshot(10).state==State::Fault);
 uint8_t reply[32]{};const auto req=tcp(6,100,0);
 assert(handleModbus(req.data(),req.size(),reply,sizeof reply,c,10)==9&&reply[8]==4);
 assert(c.snapshot(10).state==State::Fault&&c.snapshot(10).requested==0);
 c.tick(20,{25,30,20,true});assert(c.snapshot(20).state==State::Fault);
 assert(handleModbus(req.data(),req.size(),reply,sizeof reply,c,20)==12);
 assert(c.snapshot(20).state==State::Idle&&c.snapshot(20).requested==0);
 assert(!c.command("START",0,20,error));
}
#endif
static uint32_t randomState=0x5EED1234;
static uint32_t randomWord(){randomState^=randomState<<13;randomState^=randomState>>17;randomState^=randomState<<5;return randomState;}
static void testMalformedStreams(){
 for(unsigned trial=0;trial<20000;++trial){
  TcpFramer tcpFramer;RtuReader reader;uint8_t request[8]{};auto p=profile();assert(reader.start(p,0,request,sizeof request)==8);
  const size_t count=randomWord()%320;for(size_t i=0;i<count;++i){auto byte=uint8_t(randomWord());tcpFramer.feed(byte,uint32_t(i));reader.feed(byte,uint32_t(i));assert(tcpFramer.size()<=kMaxTcpFrame);}
  if(reader.sample().valid)assert(std::isfinite(reader.sample().value)&&reader.sample().value>=p.minimum&&reader.sample().value<=p.maximum);
  reader.expire(2000);assert(!reader.pending());
 }
#ifndef ROAST_TRANSPORT_CODEC_ONLY
 NullOutput output;Controller c(output,123);
 for(unsigned trial=0;trial<20000;++trial){
  const size_t count=randomWord()%270;std::vector<uint8_t> request(count);for(auto& byte:request)byte=uint8_t(randomWord());
  if(count>=8&&trial%2){request[2]=request[3]=0;request[4]=uint8_t((count-6)>>8);request[5]=uint8_t(count-6);request[6]=1;}
  uint8_t reply[270];std::memset(reply,0xA5,sizeof reply);const size_t cap=randomWord()%260;
  const size_t length=handleModbus(request.data(),request.size(),reply+1,cap,c,0);
  assert(length<=cap&&reply[0]==0xA5);for(size_t i=cap+1;i<sizeof(reply);++i)assert(reply[i]==0xA5);
  if(length)assert(length>=9&&size_t((reply[5]<<8)|reply[6])+6==length);
  assert(c.snapshot(0).requested==0);
 }
#endif
}
int main(){testRtu();testFramer();testMalformedStreams();
#ifndef ROAST_TRANSPORT_CODEC_ONLY
 testModbus();testModbusFaultLatch();testArtisanGrantRegisters();
#endif
 std::cout<<"transport tests passed (demo="<<kDemoBuild<<")\n";
}

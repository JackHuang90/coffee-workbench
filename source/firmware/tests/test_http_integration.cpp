#include "roast/http.hpp"
#include "roast/protocol.hpp"
#include <cassert>
#include <iostream>
#include <string>
using namespace roast;
static const char* token="native-fixture-token-not-a-secret";
static std::string request(Controller& c,const std::string& body,uint32_t now){
 HttpRequest parser;
 const std::string wire="POST /api/v1/command HTTP/1.1\r\nHost: local.test\r\nAuthorization: Bearer "+std::string(token)+"\r\nContent-Length: "+std::to_string(body.size())+"\r\n\r\n"+body;
 auto result=HttpRequest::Result::Pending;for(char ch:wire)result=parser.feed(ch,now,token);
 assert(result==HttpRequest::Result::Complete&&parser.command());
 char out[kResponseSize]{};const auto size=respond(c,parser.body(),parser.bodySize(),now,out,sizeof(out),CommandSource::Http);
 assert(size>0);return std::string(out,size);
}
static void okay(const std::string& reply){assert(reply.find("\"ok\":true")!=std::string::npos);assert(reply.find("\"physical_enabled\":false")!=std::string::npos);}
int main(){
 VirtualPlant plant;Controller c(plant,123);c.tick(0,plant.step(0));
 const auto grant=request(c,"R1 123 1 1000 ARTISAN_POWER",0);
 assert(grant.find("local_usb_authorization_required")!=std::string::npos||grant.find("hardware_locked")!=std::string::npos);
 assert(c.snapshot(0).requested==0&&c.snapshot(0).owner==Owner::None);
 if(kDemoBuild){
  Point points[]={{0,250},{1000,300}};
  okay(request(c,"R1 123 2 1000 BEGIN http_curve 2 "+std::to_string(hashCurve(points,2)),0));
  okay(request(c,"R1 123 3 1000 POINT 0 0 250",0));okay(request(c,"R1 123 4 1000 POINT 1 1000 300",0));
  okay(request(c,"R1 123 5 1000 COMMIT",0));okay(request(c,"R1 123 6 1000 ARM",0));okay(request(c,"R1 123 7 1000 START",0));
  assert(c.snapshot(0).owner==Owner::Http);
  c.tick(100,plant.step(100));assert(c.snapshot(100).requested>0);
  assert(request(c,"R1 123 7 1000 START",100).find("replayed_sequence")!=std::string::npos);
  okay(request(c,"R1 123 8 1100 MANUAL",100));assert(c.snapshot(100).requested==0);
  okay(request(c,"R1 123 9 1100 OUTPUT 40",100));assert(c.snapshot(100).requested==40);
  okay(request(c,"R1 123 10 1100 STOP",100));assert(c.snapshot(100).requested==0&&c.snapshot(100).owner==Owner::None);
 }else{
  assert(request(c,"R1 123 2 1000 BEGIN curve 2 0",0).find("hardware_locked")!=std::string::npos);
  assert(c.snapshot(0).state==State::Locked);
 }
 std::cout<<(kDemoBuild?"DEMO":"LOCKED")<<" HTTP-parser/controller integration passed\n";
}

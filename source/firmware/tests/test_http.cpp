#include "roast/http.hpp"
#include <cassert>
#include <string>
#include <iostream>
using roast::HttpRequest;
using R=HttpRequest::Result;
static R parse(const std::string& wire,HttpRequest& p) { R r=R::Pending; for(char c:wire)r=p.feed(c,10,"not-a-real-secret-test-token");return r;}
int main(){
 HttpRequest p; assert(parse("GET /api/v1/status HTTP/1.1\r\nHost: localhost\r\n\r\n",p)==R::Complete);assert(!p.command());
 p.reset();std::string post="POST /api/v1/command HTTP/1.1\r\nAuthorization: Bearer not-a-real-secret-test-token\r\nContent-Length: 5\r\n\r\nHELLO";assert(parse(post,p)==R::Complete);assert(p.command()&&p.bodySize()==5);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\r\nOrigin: https://evil.test\r\n\r\n",p)==R::Forbidden);
 p.reset();assert(parse("POST /api/v1/command HTTP/1.1\r\nContent-Length: 1\r\n\r\nx",p)==R::Forbidden);
 p.reset();assert(parse("POST /api/v1/command HTTP/1.1\r\nAuthorization: Bearer not-a-real-secret-test-token\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\nxx",p)==R::BadRequest);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n",p)==R::BadRequest);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\r\nContent-Length: 1\r\n\r\nx",p)==R::BadRequest);
 p.reset();assert(parse("OPTIONS /api/v1/command HTTP/1.1\r\n\r\n",p)==R::MethodNotAllowed);
 p.reset();assert(parse("GET /other HTTP/1.1\r\n\r\n",p)==R::NotFound);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\n\n",p)==R::BadRequest);
 p.reset();assert(parse(std::string(1025,'A'),p)==R::TooLarge);
 p.reset();p.feed('G',UINT32_MAX-10,"token");assert(p.expire(1000)==R::Timeout);
 p.reset();assert(parse(post.substr(0,post.size()-2),p)==R::Pending);assert(p.expire(1011)==R::Timeout);
 p.reset();assert(parse("POST /api/v1/command HTTP/1.1\r\nAuthorization: Bearer not-a-real-secret-test-token\r\nContent-Length: 256\r\n\r\n",p)==R::TooLarge);
 p.reset();assert(parse("POST /api/v1/command HTTP/1.1\r\nAuthorization: Bearer not-a-real-secret-test-token\r\nContent-Length: 99999999999999999999\r\n\r\n",p)==R::TooLarge);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\r\nHost: x\r\n header: folded\r\n\r\n",p)==R::BadRequest);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\r\norigin: null\r\n\r\n",p)==R::Forbidden);
 std::cout<<"HTTP parser tests passed\n";
}

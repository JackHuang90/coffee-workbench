/**
 * 功能：以生产控制器及协议实现提供只监听回环临时端口的原生测试服务，永不链接到固件。
 * 首次编写日期：未知（历史代码）
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：兼容 Windows Winsock，保留非阻塞、回环隔离和固定运行上限。
 */
#include "roast/core.hpp"
#include "roast/modbus.hpp"
#include "roast/protocol.hpp"
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#endif
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <iostream>
using namespace roast;
namespace {
using Clock=std::chrono::steady_clock;
const auto started=Clock::now();
#ifdef _WIN32
using Socket=SOCKET;
constexpr Socket kInvalid=INVALID_SOCKET;
using AddressSize=int;
#else
using Socket=int;
constexpr Socket kInvalid=-1;
using AddressSize=socklen_t;
#endif
uint32_t millisNow(){return uint32_t(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-started).count());}
/** 功能：设置平台 socket 为非阻塞。首次编写日期：未知（历史代码）；变更日期：2026-10-29。
 * 修改记录：2026-10-29：Windows 使用 ioctlsocket，POSIX 保留 fcntl。 */
bool nonblocking(Socket fd){
#ifdef _WIN32
 u_long enabled=1;return ioctlsocket(fd,FIONBIO,&enabled)==0;
#else
 const int flags=fcntl(fd,F_GETFL,0);return flags>=0&&fcntl(fd,F_SETFL,flags|O_NONBLOCK)==0;
#endif
}
/** 功能：关闭测试 socket。首次编写日期：2026-10-29；变更日期：2026-10-29。
 * 修改记录：2026-10-29：首次编写，统一平台关闭接口。 */
void closeSocket(Socket fd){
#ifdef _WIN32
 closesocket(fd);
#else
 close(fd);
#endif
}
/** 功能：判断非阻塞 socket 暂无数据。首次编写日期：2026-10-29；变更日期：2026-10-29。
 * 修改记录：2026-10-29：首次编写，统一平台错误码。 */
bool wouldBlock(){
#ifdef _WIN32
 return WSAGetLastError()==WSAEWOULDBLOCK;
#else
 return errno==EAGAIN||errno==EWOULDBLOCK;
#endif
}
/** 功能：判断等待是否被信号中断。首次编写日期：2026-10-29；变更日期：2026-10-29。
 * 修改记录：2026-10-29：首次编写，统一平台中断码。 */
bool interrupted(){
#ifdef _WIN32
 return WSAGetLastError()==WSAEINTR;
#else
 return errno==EINTR;
#endif
}
bool initializeFixture(Controller& controller,const char* mode){
 if(!kDemoBuild||!std::strcmp(mode,"none"))return true;
 // Explicit test-only local USB grant using the production command parser.
 // No network peer can issue this grant. Firmware itself boots disarmed.
 const char* grant=!std::strcmp(mode,"sv")?"R1 123 1 5000 ARTISAN_SV":"R1 123 1 5000 ARTISAN_POWER";
 char response[kResponseSize]{};
 respond(controller,grant,std::strlen(grant),0,response,sizeof response,CommandSource::Usb);
 return std::strstr(response,"\"ok\":true")!=nullptr;
}
}
/** 功能：运行最长 15 秒的回环协议服务并处理生产帧。
 * 首次编写日期：未知（历史代码）；变更日期：2026-10-29。
 * 修改记录：2026-10-29：使用平台 socket 句柄与错误处理，Windows 初始化 Winsock。 */
int main(int argc,char** argv){
#ifdef _WIN32
 WSADATA runtime{};if(WSAStartup(MAKEWORD(2,2),&runtime)!=0)return 1;
#endif
 VirtualPlant plant;Controller controller(plant,123);
 controller.tick(0,kDemoBuild?plant.step(0):Sensor{});
 if(!initializeFixture(controller,argc>1?argv[1]:"power")){std::cerr<<"test fixture initialization failed\n";return 1;}
 const Socket listener=socket(AF_INET,SOCK_STREAM,0);
 if(listener==kInvalid){std::perror("socket");return 1;}
 sockaddr_in address{};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);address.sin_port=0;
 if(bind(listener,reinterpret_cast<sockaddr*>(&address),sizeof address)<0||listen(listener,4)<0||!nonblocking(listener)){
  std::perror("loopback listener");closeSocket(listener);return 1;
 }
 AddressSize addressSize=sizeof address;
 if(getsockname(listener,reinterpret_cast<sockaddr*>(&address),&addressSize)<0){std::perror("getsockname");closeSocket(listener);return 1;}
 std::cout<<"PORT "<<ntohs(address.sin_port)<<"\n"<<std::flush;
 Socket client=kInvalid;TcpFramer framer;uint8_t reply[kMaxTcpFrame]{};size_t replyLength=0,replySent=0;
 auto closeClient=[&](){if(client!=kInvalid)closeSocket(client);client=kInvalid;framer.reset();replyLength=replySent=0;};
 // Fixed test-run ceiling, even if test client dies. No unbounded blocking waits.
 while(millisNow()<15000){
  const uint32_t now=millisNow();
  controller.tick(now,kDemoBuild?plant.step(now):Sensor{});
  if(client!=kInvalid&&framer.expire(now))closeClient();
  fd_set reads,writes;FD_ZERO(&reads);FD_ZERO(&writes);FD_SET(listener,&reads);
  if(client!=kInvalid){if(replyLength)FD_SET(client,&writes);else FD_SET(client,&reads);}
#ifdef _WIN32
  constexpr int nfds=0; // Winsock ignores the descriptor-count argument.
#else
  const int nfds=(client>listener?client:listener)+1;
#endif
  timeval timeout{0,10000};const int ready=select(nfds,&reads,&writes,nullptr,&timeout);
  if(ready<0){if(interrupted())continue;std::perror("select");closeClient();closeSocket(listener);return 1;}
  if(FD_ISSET(listener,&reads)){
   const Socket incoming=accept(listener,nullptr,nullptr);
   if(incoming!=kInvalid){if(client!=kInvalid||!nonblocking(incoming))closeSocket(incoming);else{client=incoming;framer.reset();}}
  }
  if(client!=kInvalid&&FD_ISSET(client,&writes)){
#ifdef _WIN32
   constexpr int sendFlags=0;
#else
   constexpr int sendFlags=MSG_NOSIGNAL;
#endif
   const auto sent=send(client,reinterpret_cast<const char*>(reply+replySent),int(replyLength-replySent),sendFlags);
   if(sent>0){replySent+=size_t(sent);if(replySent==replyLength){replyLength=replySent=0;framer.reset();}}
   else if(sent==0||!wouldBlock())closeClient();
  }
  if(client!=kInvalid&&FD_ISSET(client,&reads)){
   for(unsigned budget=0;budget<64&&client!=kInvalid&&!replyLength;++budget){
    uint8_t byte=0;const auto received=recv(client,reinterpret_cast<char*>(&byte),1,0);
    if(received==0){closeClient();break;}
    if(received<0){if(!wouldBlock())closeClient();break;}
    const auto result=framer.feed(byte,millisNow());
    if(result==TcpFramer::Result::Rejected){closeClient();break;}
    if(result==TcpFramer::Result::Complete){
     replyLength=handleModbus(framer.data(),framer.size(),reply,sizeof reply,controller,millisNow());replySent=0;
     if(!replyLength)closeClient();
    }
   }
  }
 }
 closeClient();closeSocket(listener);
#ifdef _WIN32
 WSACleanup();
#endif
 return 0;
}

/**
 * 功能：以真实固件解析器验证原始 HTTP 字节，作为无硬件访问的原生测试助手。
 * 首次编写日期：未知（历史代码）
 * 变更日期：2026-10-29
 * 修改记录：
 * - 2026-10-29：Windows 标准输入改为二进制，保留协议必需的 CRLF。
 */
#include "roast/http.hpp"
#include "roast/protocol.hpp"
#include <iostream>
#include <iterator>
#include <string>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
using namespace roast;
/** 功能：读取 HTTP 请求并输出当前固件状态。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29 保留 Windows 原始输入字节。 */
int main(int argc,char** argv) {
#ifdef _WIN32
 _setmode(_fileno(stdin),_O_BINARY);
#endif
 const std::string wire((std::istreambuf_iterator<char>(std::cin)),std::istreambuf_iterator<char>());
 HttpRequest request;auto result=HttpRequest::Result::Pending;
 for(char c:wire)result=request.feed(c,1000,"test-only-no-credential");
 if(result!=HttpRequest::Result::Complete||request.command())return 2;
 VirtualPlant plant;Controller controller(plant,12345);controller.tick(1000,plant.step(1000));
 char out[kResponseSize]{};
 if(argc>1 && std::string(argv[1])=="artisan" && kDemoBuild) {
  const std::string command="R1 12345 1 2000 ARTISAN_POWER";
  respond(controller,command.c_str(),command.size(),1000,out,sizeof(out),CommandSource::Usb);
 }
 const auto size=respond(controller,"STATUS",6,1000,out,sizeof(out),CommandSource::Http);
 if(!size)return 3;
 std::cout.write(out,size);
}

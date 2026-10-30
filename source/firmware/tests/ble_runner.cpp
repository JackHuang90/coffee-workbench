/** 功能：输出真实状态JSON及生产编码器通知十六进制，供浏览器互操作回归。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
#include "roast/ble.hpp"
#include "roast/core.hpp"
#include "roast/protocol.hpp"
#include <cstdio>
#include <cstdlib>
/** 功能：读取MTU/序号参数，首行JSON，随后每行一个通知十六进制。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
int main(int argc,char** argv){
 if(argc!=3)return 2;
 const unsigned mtu=static_cast<unsigned>(std::strtoul(argv[1],nullptr,10));const unsigned sequence=static_cast<unsigned>(std::strtoul(argv[2],nullptr,10));
 if(mtu<23||mtu>517||sequence>65535)return 2;
 roast::VirtualPlant plant;roast::NullOutput nullOutput;
 roast::Controller controller(roast::kDemoBuild?static_cast<roast::OutputPort&>(plant):static_cast<roast::OutputPort&>(nullOutput),12345);
 controller.tick(1000,roast::kDemoBuild?plant.step(1000):roast::Sensor{});
 char json[roast::kResponseSize]{};const size_t size=roast::statusJson(controller,1000,json,sizeof(json));if(!size)return 3;
 std::puts(json);uint8_t fragment[244]{};
 for(size_t offset=0;offset<size;){const size_t count=roast::ble::encodeFragment(reinterpret_cast<const uint8_t*>(json),size,uint16_t(sequence),offset,uint16_t(mtu),fragment,sizeof(fragment));if(!count)return 4;for(size_t i=0;i<count;i++)std::printf("%02x",fragment[i]);std::puts("");offset+=count-8;}
}

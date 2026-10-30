/** 功能：执行真实BLE适配器，验证初始化顺序、队列边界、拥塞及控制隔离。
 * 首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
#include "ble_sdk_stub.hpp"
#include "roast/esp_ble.hpp"
#include "roast/core.hpp"
#include <iostream>
/** 功能：单步调度中继并执行一个主机事件。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void pump(){try{ble_test::relay(nullptr);}catch(const RelayIdle&){}if(ble_test::queuedEvent){auto* event=ble_test::queuedEvent;ble_test::queuedEvent=nullptr;event->callback(event);}}
/** 功能：运行适配器状态路径，使用真实Controller及编码器。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
int main(){
 assert(roast::ble::begin());assert(ble_test::properties==0x10&&ble_test::permissions==0);assert(ble_test::deviceName=="Coffee-123456");
 roast::VirtualPlant plant;roast::Controller controller(plant,77);controller.tick(0,plant.step(0));
 auto& server=BLEDevice::server;auto& characteristic=server.service.characteristic;ble_gap_conn_desc peer{7},extra{8};
 server.callbacks->onConnect(&server,&peer);server.callbacks->onConnect(&server,&extra);assert(ble_test::disconnects==1);
 roast::ble::tick(controller,0);pump();assert(ble_test::notifications.empty());
 characteristic.callbacks->onSubscribe(&characteristic,&peer,1);
 roast::ble::tick(controller,0);assert(ble_test::notifications.empty());pump();assert(ble_test::notifications.size()==1);assert(ble_test::notifications.back().size()==20);
 ble_test::now=5;roast::ble::tick(controller,5);ble_test::notifyResult=BLE_HS_ENOMEM;pump();assert(ble_test::notifications.size()==1);
 ble_test::notifyResult=0;ble_test::now=10;roast::ble::tick(controller,10);pump();assert(ble_test::notifications.size()==2);assert(ble_test::notifications.back()[6]==12);
 ble_test::now=15;roast::ble::tick(controller,15);
 characteristic.callbacks->onSubscribe(&characteristic,&peer,0);characteristic.callbacks->onSubscribe(&characteristic,&peer,1);pump();assert(ble_test::notifications.size()==2);
 ble_test::now=1000;controller.tick(1000,plant.step(1000));roast::ble::tick(controller,1000);pump();assert(ble_test::notifications.size()==3&&ble_test::notifications.back()[6]==0);
 ble_test::now=1005;roast::ble::tick(controller,1005);ble_test::exhaustBuffers=true;pump();assert(ble_test::notifications.size()==3);
 ble_test::now=1010;roast::ble::tick(controller,1010);ble_test::exhaustBuffers=false;pump();assert(ble_test::notifications.size()==4&&ble_test::notifications.back()[6]==12);
 ble_test::now=1015;roast::ble::tick(controller,1015);ble_test::now=1116;pump();assert(ble_test::disconnects==2);assert(ble_test::notifications.size()==4);
 assert(controller.snapshot(1116).owner==roast::Owner::None);
 server.callbacks->onDisconnect(&server,&peer);server.callbacks->onConnect(&server,&peer);
 ble_test::now=2000;controller.tick(2000,plant.step(2000));roast::ble::tick(controller,2000);pump();assert(ble_test::notifications.size()==4);
 characteristic.callbacks->onSubscribe(&characteristic,&peer,1);server.callbacks->onMtuChanged(&server,&peer,247);roast::ble::tick(controller,2000);pump();assert(ble_test::notifications.size()==5&&ble_test::notifications.back().size()==244);
 std::cout<<"BLE adapter lifecycle, queue and congestion passed\n";
}

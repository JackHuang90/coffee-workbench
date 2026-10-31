#include "roast/esp_indicator.hpp"
#if defined(ARDUINO_ARCH_ESP32) && ROAST_RGB_ENABLE
#include <Arduino.h>
#include <algorithm>
#endif
namespace roast::indicator {
bool EspIndicator::begin(uint32_t now){
 engine_.begin(now);
#if defined(ARDUINO_ARCH_ESP32) && ROAST_RGB_ENABLE
 if(!ready_)ready_=rmtInit(ROAST_RGB_PIN,RMT_TX_MODE,RMT_MEM_NUM_BLOCKS_1,10000000)&&rmtSetEOT(ROAST_RGB_PIN,0);
 lastWrite_=now-10;return ready_;
#else
 return true;
#endif
}
Frame EspIndicator::tick(const Inputs& inputs,uint32_t now){
 const Frame frame=engine_.tick(inputs,now);
#if defined(ARDUINO_ARCH_ESP32) && ROAST_RGB_ENABLE
 show(frame.color,now);
#endif
 return frame;
}
#if defined(ARDUINO_ARCH_ESP32) && ROAST_RGB_ENABLE
void EspIndicator::show(Color color,uint32_t now){
 // Poll completion before touching the source buffer: the async encoder may
 // retain it. A 10ms frame interval also guarantees the WS2812 low latch gap.
 if(!ready_||uint32_t(now-lastWrite_)<10||!rmtTransmitCompleted(ROAST_RGB_PIN))return;
 const unsigned level=std::min(unsigned(ROAST_RGB_BRIGHTNESS),32u);
 const uint8_t r=(color.r*level+127)/255,g=(color.g*level+127)/255,b=(color.b*level+127)/255;
 const Color output{r,g,b};if(haveSent_&&output==sent_)return;
 uint8_t bytes[3]={g,r,b};
 switch(ROAST_RGB_ORDER){
 case LED_COLOR_ORDER_RGB:bytes[0]=r;bytes[1]=g;bytes[2]=b;break;
 case LED_COLOR_ORDER_BGR:bytes[0]=b;bytes[1]=g;bytes[2]=r;break;
 case LED_COLOR_ORDER_BRG:bytes[0]=b;bytes[1]=r;bytes[2]=g;break;
 case LED_COLOR_ORDER_RBG:bytes[0]=r;bytes[1]=b;bytes[2]=g;break;
 case LED_COLOR_ORDER_GBR:bytes[0]=g;bytes[1]=b;bytes[2]=r;break;
 default:break;
 }
 for(unsigned bit=0;bit<24;++bit){
  const bool high=bytes[bit/8]&(1u<<(7-bit%8));
  data_[bit].level0=1;data_[bit].duration0=high?8:4;
  data_[bit].level1=0;data_[bit].duration1=high?4:8;
 }
 if(rmtWriteAsync(ROAST_RGB_PIN,data_,24)){sent_=output;haveSent_=true;lastWrite_=now;}
}
#endif
}

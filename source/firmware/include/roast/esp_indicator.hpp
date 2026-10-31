#pragma once
#include "roast/board.hpp"
#include "roast/indicator.hpp"
#if defined(ARDUINO_ARCH_ESP32) && ROAST_RGB_ENABLE
#include <Arduino.h>
#include <esp32-hal-rmt.h>
#endif
namespace roast::indicator {
// Main-loop only. Keep this noncopyable object alive for all asynchronous writes.
class EspIndicator {
 public:
 EspIndicator()=default;
 EspIndicator(const EspIndicator&)=delete;
 EspIndicator& operator=(const EspIndicator&)=delete;
 bool begin(uint32_t now);
 Frame tick(const Inputs& inputs,uint32_t now);
 private:
 Engine engine_{};
#if defined(ARDUINO_ARCH_ESP32) && ROAST_RGB_ENABLE
 rmt_data_t data_[24]{}; // Owned, stable until rmtTransmitCompleted is true.
 Color sent_{};
 uint32_t lastWrite_=0;
 bool ready_=false,haveSent_=false;
 void show(Color color,uint32_t now);
#endif
};
}

#pragma once
#include "core.hpp"
namespace roast {
constexpr size_t kMaxTcpFrame = 260;
// Strict whole-frame Modbus TCP. Unsupported unit IDs and malformed MBAP are dropped.
size_t handleModbus(const uint8_t* request, size_t requestSize, uint8_t* out,
                    size_t capacity, Controller& controller, uint32_t now);
// Reject/expiry requires connection close. Never try to resynchronize arbitrary bytes.
class TcpFramer {
 public:
  enum class Result { None, Complete, Rejected };
  Result feed(uint8_t byte, uint32_t now);
  bool expire(uint32_t now);
  const uint8_t* data() const { return bytes_; }
  size_t size() const { return size_; }
  void reset();
 private:
  uint8_t bytes_[kMaxTcpFrame]{};
  size_t size_=0, expected_=0;
  uint32_t startedAt_=0;
  bool rejected_=false, complete_=false;
};
}

#pragma once
#include <cstddef>
#include <cstdint>
namespace roast {
uint16_t modbusCrc(const uint8_t* bytes, size_t length);
// All values must be deliberately supplied from a verified instrument manual.
// There is no default slave, register, scaling, port or pin mapping.
struct RtuProfile {
  uint8_t slave=0;
  uint8_t function=0; // Read-only 03 or 04, one register.
  uint16_t pvRegister=0;
  bool signedValue=false;
  float scale=0, offset=0, minimum=0, maximum=0;
  uint32_t timeoutMs=0;
};
enum class RtuError:uint8_t { None, InvalidProfile, Busy, Unexpected, Timeout,
  WrongSlave, WrongFunction, Length, Crc, Exception, Range };
struct RtuSample { float value=0; uint32_t at=0; bool valid=false; RtuError error=RtuError::None; uint8_t exception=0; };
class RtuReader {
 public:
  enum class Result { None, Complete, Rejected };
  // Returns exact 8-byte read request or 0. There is only one outstanding request.
  size_t start(const RtuProfile& profile,uint32_t now,uint8_t* request,size_t capacity);
  Result feed(uint8_t byte,uint32_t now);
  bool expire(uint32_t now);
  bool pending() const { return pending_; }
  RtuSample sample() const { return sample_; }
 private:
  RtuProfile profile_{}; RtuSample sample_{};
  uint8_t bytes_[7]{}; size_t size_=0, expected_=0;
  uint32_t startedAt_=0; bool pending_=false;
  Result reject(RtuError error);
};
}

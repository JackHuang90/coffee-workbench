#pragma once
#include <cstdint>
namespace roast {
// Grants carry a monotonic generation: observing owner enums alone can miss
// POWER -> STOP -> POWER when STOP and the next grant occur between polls.
class AuthorizationBoundary {
 public:
 enum class Event { None, NewGrant, Revoke };
 Event observe(bool owned,uint32_t generation){
  Event event=Event::None;
  if(generation!=generation_)event=Event::NewGrant;
  else if(wasOwned_&&!owned)event=Event::Revoke;
  generation_=generation;wasOwned_=owned;return event;
 }
 private:uint32_t generation_=0;bool wasOwned_=false;
};
// Once authority is revoked, one already-queued response may drain; no new
// request may execute. New grants call cancel() and discard all old traffic.
class ReplyDrain {
 public:
 enum class Action { Inactive, SendOnly, Close };
 void begin(uint32_t now){active_=true;at_=now;}
 void cancel(){active_=false;}
 bool active()const{return active_;}
 Action poll(uint32_t now,bool connected,bool pending)const{
  if(!active_)return Action::Inactive;
  if(!connected||!pending||static_cast<uint32_t>(now-at_)>=200)return Action::Close;
  return Action::SendOnly;
 }
 private:bool active_=false;uint32_t at_=0;
};
}

#include "roast/reply_drain.hpp"
#include <cassert>
#include <iostream>
using roast::ReplyDrain;
int main(){
 ReplyDrain d;using A=ReplyDrain::Action;
 assert(d.poll(0,true,true)==A::Inactive);
 d.begin(10);assert(d.active()&&d.poll(11,true,true)==A::SendOnly);
 assert(d.poll(12,true,false)==A::Close); // STOP acknowledgement drained: close before another request.
 assert(d.poll(12,false,true)==A::Close);
 assert(d.poll(210,true,true)==A::Close); // Never wait indefinitely on a stopped client.
 d.cancel();assert(!d.active()&&d.poll(211,true,true)==A::Inactive); // New grant discards old response.
 d.begin(UINT32_MAX-100);assert(d.poll(98,true,true)==A::SendOnly);assert(d.poll(99,true,true)==A::Close);
 roast::AuthorizationBoundary boundary;using E=roast::AuthorizationBoundary::Event;
 assert(boundary.observe(false,0)==E::None);
 assert(boundary.observe(true,1)==E::NewGrant);
 assert(boundary.observe(true,1)==E::None);
 // STOP is not observed between polls: same owner enum but fresh grant must close old TCP client.
 assert(boundary.observe(true,2)==E::NewGrant);
 assert(boundary.observe(false,2)==E::Revoke);
 assert(boundary.observe(false,2)==E::None);
 assert(boundary.observe(true,3)==E::NewGrant);
 std::cout<<"Authorization generation and revocation reply-drain policy passed\n";
}

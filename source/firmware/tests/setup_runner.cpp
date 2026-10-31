// Cross-language harness: exercise the production setup codec through stdin/stdout.
#include "roast/ble_setup.hpp"
#include <algorithm>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

int main(int argc,char** argv){
#ifdef _WIN32
 _setmode(_fileno(stdin),_O_BINARY);
 _setmode(_fileno(stdout),_O_BINARY);
#endif
 if(argc<2)return 2;
 if(std::string(argv[1])=="encode"){
  const size_t payload=argc>2?std::strtoul(argv[2],nullptr,10):12;
  if(!payload||payload>236)return 2;
  const std::string input{std::istreambuf_iterator<char>(std::cin),{}};
  for(size_t offset=0;offset<input.size();offset+=payload){
   uint8_t frame[244]{};
   const size_t count=roast::ble::setupFrame(65535,input.size(),offset,reinterpret_cast<const uint8_t*>(input.data()+offset),std::min(payload,input.size()-offset),frame,sizeof(frame));
   if(!count)return 2;
   for(size_t i=0;i<count;++i)std::cout<<std::hex<<std::setw(2)<<std::setfill('0')<<unsigned(frame[i]);
   std::cout<<'\n';
  }
  return 0;
 }
 if(std::string(argv[1])!="decode")return 2;
 roast::ble::SetupAssembler assembler;
 std::string hex;uint32_t now=0;bool complete=false;
 while(std::cin>>hex){
  if(complete||hex.size()%2)return 2;
  std::vector<uint8_t> frame;
  for(size_t i=0;i<hex.size();i+=2)frame.push_back(uint8_t(std::strtoul(hex.substr(i,2).c_str(),nullptr,16)));
  complete=assembler.push(frame.data(),frame.size(),now);now+=5;
 }
 if(!complete)return 2;
 std::cout.write(assembler.data(),static_cast<std::streamsize>(assembler.size()));
 return 0;
}

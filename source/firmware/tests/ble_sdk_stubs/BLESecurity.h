#pragma once
#include "ble_sdk_stub.hpp"
constexpr uint8_t BLE_HS_IO_NO_INPUT_OUTPUT=3;
class BLESecurity {
 public:
 inline static unsigned requests=0;
 inline static uint16_t handle=65535;
 inline static bool bonding=false;
 inline static int startRc=0;
 static void setAuthenticationMode(bool bond,bool,bool){bonding=bond;}
 static void setCapability(uint8_t){}
 static void setForceAuthentication(bool){}
 static bool startSecurity(uint16_t connection,int* rc=nullptr){++requests;handle=connection;if(rc)*rc=startRc;return startRc==0;}
 static uint32_t getPassKey(){return 0;}
};

class BLESecurityCallbacks {
 public:
 virtual ~BLESecurityCallbacks()=default;
 virtual void onAuthenticationComplete(ble_gap_conn_desc*,int){}
 virtual bool onConfirmPIN(uint32_t){return true;}
 virtual bool onAuthorizationRequest(uint16_t,uint16_t,bool){return true;}
 virtual uint32_t onPassKeyRequest(){return 0;}
 virtual void onPassKeyNotify(uint32_t){}
 virtual bool onSecurityRequest(){return true;}
};

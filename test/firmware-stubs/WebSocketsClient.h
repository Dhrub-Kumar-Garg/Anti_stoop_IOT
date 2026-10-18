#pragma once
#include <string>
enum WStype_t { WStype_CONNECTED, WStype_DISCONNECTED };
struct WebSocketsClient {
  std::string lastPacket;
  void begin(const char*, uint16_t, const char*) {}
  void onEvent(void (*)(WStype_t, uint8_t*, size_t)) {}
  void setReconnectInterval(int) {}
  void loop() {}
  void sendTXT(const char* packet) { lastPacket = packet; }
};

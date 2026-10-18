#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstddef>
#define HIGH 1
#define LOW 0
#define INPUT_PULLUP 2
#define OUTPUT 3
#define WL_CONNECTED 3
extern unsigned long fakeNow;
extern int inputPins[40], outputPins[40], analogPins[40];
inline unsigned long millis() { return fakeNow; }
inline void delay(unsigned long ms) { fakeNow += ms; }
inline void pinMode(int pin, int mode) { if (mode == INPUT_PULLUP) inputPins[pin] = HIGH; }
inline int digitalRead(int pin) { return inputPins[pin]; }
inline int analogRead(int pin) { return analogPins[pin]; }
inline void digitalWrite(int pin, int value) { outputPins[pin] = value; }
struct FakeSerial {
  void begin(int) {}
  void print(const char*) {}
  void println(const char*) {}
  template<class... Args> void printf(const char*, Args...) {}
};
struct FakeWiFi {
  void begin(const char*, const char*) {}
  int status() { return WL_CONNECTED; }
};
extern FakeSerial Serial;
extern FakeWiFi WiFi;

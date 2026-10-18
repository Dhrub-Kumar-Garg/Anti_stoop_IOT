#include <cassert>
#include "firmware-stubs/WiFi.h"
unsigned long fakeNow = 0;
int inputPins[40] = {}, outputPins[40] = {}, analogPins[40] = {};
FakeSerial Serial;
FakeWiFi WiFi;
#include "../espcode/espcode.ino"
void advance(unsigned long duration) {
  for (unsigned long i = 0; i < duration; i++) { fakeNow++; loop(); }
}
int main() {
  analogPins[34] = 1000; analogPins[35] = 1200;
  setup();
  assert(baselineFlex1 == 1000 && baselineFlex2 == 1200);
  analogPins[34] = 1000 + stoopThreshold; // Exact threshold does not trigger.
  advance(STOOP_DELAY + 100); assert(outputPins[32] == LOW);
  analogPins[34] = 1600;
  advance(STOOP_DELAY / 2); assert(outputPins[32] == LOW);
  // A bounced contact shorter than 30ms must not trigger calibration.
  inputPins[27] = LOW; advance(10); inputPins[27] = HIGH; advance(50);
  assert(calibrationId == 0 && !calibrating);
  inputPins[27] = LOW; advance(31);
  assert(calibrating && outputPins[32] == LOW);
  // Alternating readings verify averaging rather than one raw reading.
  for (int i = 0; i < 50; i++) {
    analogPins[34] = i % 2 ? 1620 : 1580;
    advance(10);
  }
  assert(!calibrating && baselineFlex1 == 1600 && baselineFlex2 == 1200);
  assert(calibrationId == 1 && outputPins[32] == HIGH);
  advance(201); assert(outputPins[32] == LOW);
  advance(1000); assert(calibrationId == 1); // Holding does not repeatedly calibrate.
  inputPins[27] = HIGH; advance(31);
  inputPins[14] = LOW; advance(31); assert(outputPins[32] == HIGH && motorTestRunning);
  advance(301); assert(outputPins[32] == LOW && !motorTestRunning);
  advance(500); assert(outputPins[32] == LOW); // Holding test button doesn't repeat.
  inputPins[14] = HIGH; advance(31);
  analogPins[34] = 2201;
  advance(STOOP_DELAY); assert(outputPins[32] == LOW);
  advance(1); assert(outputPins[32] == HIGH);
  advance(100); // Allow the next telemetry frame after GPIO activation.
  assert(webSocket.lastPacket.find("\"alert_active\":true") != std::string::npos);
  analogPins[34] = 1600; advance(1); assert(outputPins[32] == LOW);
  analogPins[35] = 600; advance(STOOP_DELAY + 1); assert(outputPins[32] == HIGH); // Lower sensor, opposite direction.
  // Calibration clears an existing alert and restarts the bend timer.
  inputPins[27] = LOW; advance(31); assert(calibrating && outputPins[32] == LOW);
  advance(500); assert(calibrationId == 2 && baselineFlex2 == 600);
  advance(201); assert(outputPins[32] == LOW && !isStooping);
  return 0;
}

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
  analogPins[34] = 1000; analogPins[35] = 1200; analogPins[33] = 2000;
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
  // Healthy channels ignore the knob, even when it is well beyond its own baseline.
  analogPins[33] = 2400;
  advance(400);
  assert(!upperSource.usingPot && !lowerSource.usingPot && outputPins[32] == LOW);
  // A zero reading is excluded while the 2-second fallback decision is pending.
  analogPins[34] = 0;
  advance(FLEX_ZERO_TIMEOUT - 1);
  assert(!upperSource.usingPot && !upperSource.ready(0) && outputPins[32] == LOW);
  advance(2);
  assert(upperSource.usingPot && !lowerSource.usingPot);
  assert(baselineFlex1 == 2000 && baselineFlex2 == 600);
  assert(outputPins[32] == LOW); // Switching must not inherit a prior bend timer.
  advance(STOOP_DELAY + 50);
  assert(outputPins[32] == HIGH);
  assert(webSocket.lastPacket.find("\"flex1\":2400") != std::string::npos);
  assert(webSocket.lastPacket.find("\"source1\":\"pot\"") != std::string::npos);
  assert(webSocket.lastPacket.find("\"raw_flex1\":0") != std::string::npos);
  analogPins[33] = 2000; advance(1); assert(outputPins[32] == LOW);
  // Recovery must be continuously non-zero, not one noisy frame.
  analogPins[34] = 1600; advance(200); assert(upperSource.usingPot);
  analogPins[34] = 0; advance(20); assert(upperSource.usingPot);
  analogPins[34] = 1600; advance(FLEX_RECOVERY_TIME); assert(upperSource.usingPot);
  advance(1); assert(!upperSource.usingPot && baselineFlex1 == 1600);
  analogPins[33] = 4095; advance(400); assert(outputPins[32] == LOW);
  // Both channels can use the same potentiometer, with explicit source labels.
  analogPins[33] = 2000; analogPins[34] = 0; analogPins[35] = 0;
  advance(FLEX_ZERO_TIMEOUT + 1);
  assert(upperSource.usingPot && lowerSource.usingPot);
  assert(baselineFlex1 == 2000 && baselineFlex2 == 2000);
  assert(outputPins[32] == LOW);
  analogPins[33] = 1900; advance(STOOP_DELAY + 1); assert(outputPins[32] == HIGH);
  // Calibration in fallback mode captures the pot without destroying good flex baselines.
  inputPins[27] = HIGH; advance(31); inputPins[27] = LOW; advance(31);
  assert(calibrating); advance(500);
  assert(potBaseline == 1900 && upperSource.neutral == 1600 && lowerSource.neutral == 600);
  advance(201); assert(outputPins[32] == LOW);
  return 0;
}

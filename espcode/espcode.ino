#include <WiFi.h>
#include <WebSocketsClient.h>

// Network configuration: both the laptop and ESP32 must use this hotspot.
const char* ssid = "P600101";
const char* password = "00000000";
const char* serverIP = "172.20.10.2";
const uint16_t serverPort = 5001;

WebSocketsClient webSocket;
const int FLEX1_PIN = 34;
const int FLEX2_PIN = 35;
const int BTN_ZERO_PIN = 27; // One tap to GND: capture neutral posture
const int BTN_MODE_PIN = 14; // One tap to GND: 300 ms driver/motor test
const int LED_RED_PIN = 25;
const int LED_GRN_PIN = 26;
const int MOTOR_PIN = 32;    // Active-high DRIVER input, never bare motor power
const int stoopThreshold = 100; // Sensitive test setting; ADC deviation from calibration
const unsigned long STOOP_DELAY = 1000; // One continuous second before an alert
const unsigned long SAMPLE_INTERVAL = 100;
const unsigned long DEBOUNCE_MS = 30;
const unsigned long CALIBRATION_SAMPLE_MS = 10;
const int CALIBRATION_SAMPLES = 50;

int baselineFlex1 = 0;
int baselineFlex2 = 0;
unsigned long stoopStartTime = 0;
bool isStooping = false;
bool calibrating = false;
unsigned long calibrationId = 0;
long calibrationSum1 = 0;
long calibrationSum2 = 0;
int calibrationSamples = 0;
unsigned long lastCalibrationSample = 0;
unsigned long lastSampleTime = 0;
bool feedbackRunning = false;
bool motorTestRunning = false;
unsigned long feedbackStart = 0;
unsigned long feedbackDuration = 0;

struct TapButton {
  int pin;
  explicit TapButton(int pinNumber) : pin(pinNumber) {}
  bool raw = HIGH;
  bool stable = HIGH;
  unsigned long changedAt = 0;
  bool tapped(unsigned long now) {
    const bool reading = digitalRead(pin);
    if (reading != raw) { raw = reading; changedAt = now; }
    if (raw != stable && now - changedAt >= DEBOUNCE_MS) {
      stable = raw;
      return stable == LOW;
    }
    return false;
  }
};
TapButton calibrationButton{BTN_ZERO_PIN};
TapButton motorButton{BTN_MODE_PIN};

void startFeedback(unsigned long now, unsigned long duration, bool test) {
  feedbackRunning = true;
  feedbackStart = now;
  feedbackDuration = duration;
  motorTestRunning = test;
}

void beginCalibration(unsigned long now) {
  calibrating = true;
  calibrationSamples = 0;
  calibrationSum1 = calibrationSum2 = 0;
  lastCalibrationSample = now;
  isStooping = false;
  feedbackRunning = motorTestRunning = false;
  digitalWrite(MOTOR_PIN, LOW);
  digitalWrite(LED_RED_PIN, LOW);
  Serial.println("Calibration started: hold your comfortable upright posture for 0.5 seconds.");
}

void updateCalibration(unsigned long now) {
  if (!calibrating || now - lastCalibrationSample < CALIBRATION_SAMPLE_MS) return;
  lastCalibrationSample = now;
  calibrationSum1 += analogRead(FLEX1_PIN);
  calibrationSum2 += analogRead(FLEX2_PIN);
  if (++calibrationSamples < CALIBRATION_SAMPLES) return;
  baselineFlex1 = calibrationSum1 / CALIBRATION_SAMPLES;
  baselineFlex2 = calibrationSum2 / CALIBRATION_SAMPLES;
  calibrationId++;
  calibrating = false;
  isStooping = false;
  startFeedback(now, 200, false);
  Serial.printf("Calibration complete. Baselines: %d / %d ADC.\n", baselineFlex1, baselineFlex2);
}

void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) digitalWrite(LED_GRN_PIN, HIGH);
  else if (type == WStype_DISCONNECTED) digitalWrite(LED_GRN_PIN, LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(BTN_ZERO_PIN, INPUT_PULLUP);
  pinMode(BTN_MODE_PIN, INPUT_PULLUP);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GRN_PIN, OUTPUT);
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(LED_RED_PIN, LOW);
  digitalWrite(LED_GRN_PIN, LOW);
  digitalWrite(MOTOR_PIN, LOW);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nConnected to Wi-Fi!");
  digitalWrite(LED_GRN_PIN, HIGH);
  webSocket.begin(serverIP, serverPort, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  // Keep the original boot baseline; tap again after fitting the vest on the wearer.
  delay(1000);
  baselineFlex1 = analogRead(FLEX1_PIN);
  baselineFlex2 = analogRead(FLEX2_PIN);
  Serial.println("Boot baseline set. Fit the vest, sit comfortably upright, then tap CALIBRATE.");
}

void loop() {
  webSocket.loop();
  const unsigned long now = millis();
  const bool calibrationTap = calibrationButton.tapped(now);
  const bool motorTap = motorButton.tapped(now);
  if (calibrationTap && !calibrating) beginCalibration(now);
  if (motorTap && !calibrating) {
    startFeedback(now, 300, true);
    Serial.println("Motor test: GPIO 32 driver pulse for 300 ms.");
  }
  updateCalibration(now);
  if (feedbackRunning && now - feedbackStart >= feedbackDuration) {
    feedbackRunning = false;
    motorTestRunning = false;
  }

  const int currentFlex1 = analogRead(FLEX1_PIN);
  const int currentFlex2 = analogRead(FLEX2_PIN);
  const bool bending = !calibrating &&
    (abs(currentFlex1 - baselineFlex1) > stoopThreshold ||
     abs(currentFlex2 - baselineFlex2) > stoopThreshold);
  if (bending && !isStooping) stoopStartTime = now;
  isStooping = bending;
  const bool alertActive = bending && now - stoopStartTime >= STOOP_DELAY;
  // Feedback pulses do not pretend to be posture alerts in telemetry.
  const bool motorActive = !calibrating && (alertActive || feedbackRunning);
  digitalWrite(MOTOR_PIN, motorActive ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, motorActive ? HIGH : LOW);
  if (now - lastSampleTime < SAMPLE_INTERVAL) return;
  lastSampleTime = now;
  Serial.printf("Flex: %d / %d | delta: %d / %d | alert: %d\n", currentFlex1, currentFlex2,
    abs(currentFlex1 - baselineFlex1), abs(currentFlex2 - baselineFlex2), alertActive);
  // Original three fields are preserved; extra fields let the UI reflect calibration.
  char json[384];
  snprintf(json, sizeof(json),
    "{\"flex1\":%d,\"flex2\":%d,\"alert_active\":%s,\"baseline1\":%d,\"baseline2\":%d,\"threshold\":%d,\"alert_delay_ms\":%lu,\"calibrating\":%s,\"calibration_id\":%lu,\"motor_test\":%s,\"motor_active\":%s}",
    currentFlex1, currentFlex2, alertActive ? "true" : "false", baselineFlex1, baselineFlex2,
    stoopThreshold, STOOP_DELAY, calibrating ? "true" : "false", calibrationId,
    motorTestRunning ? "true" : "false", motorActive ? "true" : "false");
  webSocket.sendTXT(json);
}

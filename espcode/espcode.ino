#include <WiFi.h>
#include <WebSocketsClient.h>

// --- WIFI & SERVER CONFIGURATION ---
const char* ssid = "Dhruv";
const char* password = "00000000";
const char* serverIP = "10.130.33.217"; // Your laptop's IP
const uint16_t serverPort = 5000;

WebSocketsClient webSocket;

// --- HARDWARE PINS ---
const int FLEX1_PIN = 34;     // Upper Spine
const int FLEX2_PIN = 35;     // Lower Spine
const int BTN_ZERO_PIN = 27;  // Manual Calibrate Button
const int BTN_MODE_PIN = 14;  // Spare Button
const int LED_RED_PIN = 25;   // Warning LED
const int LED_GRN_PIN = 26;   // Wi-Fi Status LED
const int MOTOR_PIN = 32;     // Vibration Motor (ULN2003 IN1)

// --- STATE VARIABLES ---
int baselineFlex1 = 0;
int baselineFlex2 = 0;
const int stoopThreshold = 500; // Sensitivity 
unsigned long stoopStartTime = 0;
bool isStooping = false;
const unsigned long STOOP_DELAY = 5000; // 5-second timer

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
  
  // 1. Connect to Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to Wi-Fi!");
  digitalWrite(LED_GRN_PIN, HIGH);

  // 2. Connect to Dashboard Backend
  webSocket.begin(serverIP, serverPort, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);

  // 3. Auto-Calibrate Resting Posture on Boot
  delay(1000); // Let analog pins stabilize
  baselineFlex1 = analogRead(FLEX1_PIN);
  baselineFlex2 = analogRead(FLEX2_PIN);
  Serial.println("System Auto-Calibrated.");
}

void loop() {
  webSocket.loop(); 
  
  int currentFlex1 = analogRead(FLEX1_PIN);
  int currentFlex2 = analogRead(FLEX2_PIN);
  Serial.println("Flex 1: " + String(currentFlex1) + " | Flex 2: " + String(currentFlex2));
  // --- MANUAL CALIBRATION ---
  if (digitalRead(BTN_ZERO_PIN) == LOW) {
    baselineFlex1 = currentFlex1;
    baselineFlex2 = currentFlex2;
    
    // Haptic feedback to confirm calibration
    digitalWrite(LED_RED_PIN, HIGH);
    digitalWrite(MOTOR_PIN, HIGH);
    delay(200);
    digitalWrite(LED_RED_PIN, LOW);
    digitalWrite(MOTOR_PIN, LOW);
    delay(500); // Debounce
  }
  
  // --- STOOP DETECTION (Using abs() to detect any bend direction) ---
  bool currentlyBending = (abs(currentFlex1 - baselineFlex1) > stoopThreshold) || 
                          (abs(currentFlex2 - baselineFlex2) > stoopThreshold);
                          
  bool alertActive = false;
                          
  if (currentlyBending) {
    if (!isStooping) {
      isStooping = true;
      stoopStartTime = millis(); 
    } else if (millis() - stoopStartTime >= STOOP_DELAY) {
      digitalWrite(LED_RED_PIN, HIGH);  
      digitalWrite(MOTOR_PIN, HIGH); 
      alertActive = true;
    }
  } else {
    isStooping = false;
    digitalWrite(LED_RED_PIN, LOW);     
    digitalWrite(MOTOR_PIN, LOW);    
  }
  
  // --- BROADCAST DATA ---
  String json = "{\"flex1\":" + String(currentFlex1) + 
                ", \"flex2\":" + String(currentFlex2) + 
                ", \"alert_active\":" + (alertActive ? "true" : "false") + "}";
                
  webSocket.sendTXT(json);
  delay(100); 
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  if(type == WStype_CONNECTED) {
    digitalWrite(LED_GRN_PIN, HIGH); 
  } else if(type == WStype_DISCONNECTED) {
    digitalWrite(LED_GRN_PIN, LOW);  
  }
}
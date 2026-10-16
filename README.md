# Smart "Anti-Stoop" Vest Dashboard 🦺

A real-time IoT biomechanical posture monitoring system that connects an ESP32 microcontroller with a web dashboard to track upper and lower spine curvature and trigger immediate stoop alerts.

## 🚀 Features

- **Real-Time Telemetry**: Real-time flex sensor data stream for upper (thoracic) and lower (lumbar) spine tracking.
- **Audio-Visual Alerts**: Immediate visual warnings when posture exceeds safe ergonomic angles.
- **Dual WebSocket Architecture**:
  - Native WebSocket server for low-latency ESP32 hardware streaming.
  - Socket.IO server for dynamic browser dashboard telemetry.
- **Demo Mode**: Built-in test simulation generator to test telemetry and charts without physical hardware.
- **Responsive Dashboard**: Modern UI with Chart.js live plots and flex level meters.

## 🛠️ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Backend Server
```bash
npm start
```
By default, the server will start on port `5000`:
- **Local Dashboard**: [http://localhost:5000](http://localhost:5000)
- **Network Dashboard**: `http://<YOUR_LOCAL_IP>:5000`
- **ESP32 WebSocket**: `ws://<YOUR_LOCAL_IP>:5000/`

### 3. ESP32 Data Format
The ESP32 sends JSON payloads over WebSocket:
```json
{
  "flex1": 45,
  "flex2": 52,
  "alert_active": false
}
```

## 📁 Project Structure

```
├── index.html        # Modern posture dashboard UI with Chart.js
├── server.js         # Express + WebSocket + Socket.io backend bridge
├── package.json      # Dependencies and scripts
└── README.md         # Documentation
```

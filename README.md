# PosturePal · Anti-Stoop IoT

A local posture dashboard for the original ESP32 vest, with a serene mint/lavender/peach background, frosted glass cards, a spine illustration, sensor history, gentle reminders, and mindful breaks. No external fonts or CDN assets are required.

## Firmware behavior and one-tap calibration

The device now supports the requested **one-tap physical calibration** and **motor test**. These are intentional firmware changes from the initial sketch:

- GPIO 27 → GND: one debounced tap starts a 50-sample, approximately 0.5-second average of both flex sensors. Release the button and hold comfortably upright until the 200 ms LED/driver confirmation pulse. Holding the button does not repeatedly recalibrate.
- GPIO 14 → GND: one debounced tap gives a 300 ms LED/driver test pulse. This tests the driver signal independently of sensor bending. The motor must be correctly wired and powered to vibrate.
- Blocking button-feedback delays and the loop's `delay(100)` are replaced by timers so a short tap can be detected. Telemetry remains approximately 10 Hz.
- Calibration clears the previous bend timer. Detection is paused while capturing a new baseline; no alert is fabricated for the confirmation pulse.
- Baselines, threshold, calibration status, and driver status are added to telemetry. The original `flex1`, `flex2`, and `alert_active` fields remain compatible with the UI.

The existing pin assignments, network configuration, root WebSocket path, 5-second reconnect interval, boot Wi-Fi wait, and boot calibration sequence are retained. For easier testing, detection now uses **absolute deviation > 100 ADC counts on either sensor, sustained for 1 second** (previously 500 counts / 5 seconds). Returning within threshold clears the posture alert. Calibration and motor-test pulses are intentional additional haptic outputs, separate from posture alerts.

No browser commands are sent to the vest. Fit the vest first, then use the physical calibration button. The dashboard displays its reported baseline and capture status. Alert-free metrics exclude calibration capture intervals.

See [motor wiring and fitting instructions](docs/MOTOR_AND_CALIBRATION.md) before powering the motor. Calibration establishes a wearer-specific reference; it does not turn raw flex values into anatomical angles or automatically tune the 100-count test sensitivity.

## Run

Requires Node.js 20 or newer.

```sh
npm ci
npm start
```

Open **http://localhost:5000**. The server prints the laptop's LAN address so phones on the same Wi-Fi can also open the dashboard.

On macOS, Control Center / AirPlay can occupy port 5000. In that case:

```sh
PORT=5001 npm start
```

Open **http://localhost:5001**, and use the same `serverPort` in the sketch. The network settings are kept in the sketch; change `ssid`, `password`, `serverIP`, and `serverPort` as needed for your actual network. `serverIP` must be the laptop's LAN IP, not `localhost`. Network configuration changes do not require changing the detection logic.

## Connect the actual device

1. Start the Node server on a free port.
2. Connect laptop and ESP32 to the same reachable Wi-Fi network.
3. In Arduino IDE, install the ESP32 board package and **WebSockets by Markus Sattler (Links2004)** library. Open `espcode/espcode.ino`.
4. Check the four original network configuration values against your Wi-Fi and running server, then upload if needed. A device already running the original sketch remains compatible for readings and alerts; upload the updated sketch for one-tap averaged calibration and the motor-test button.
5. Wear the vest and remain comfortably upright for boot calibration. Tap the physical GPIO 27 button once, release it, and hold still for half a second. Completion gives a 200 ms LED/driver pulse.
6. Open the dashboard at the address printed by the server. Fresh data automatically selects live mode and stops any running demo.

Allow inbound traffic on the selected server port through the laptop firewall if necessary. Guest Wi-Fi isolation can prevent device-to-laptop connections. Original firmware uses `ws://<LAPTOP_LAN_IP>:<PORT>/`; the bridge also accepts `/esp32` for compatibility.

| Component | GPIO |
| --- | --- |
| Upper/thoracic flex sensor | 34 |
| Lower/lumbar flex sensor | 35 |
| Physical calibration button, active low | 27 |
| Motor-test button, active low | 14 |
| Warning LED | 25 |
| Connection LED | 26 |
| Motor driver input | 32 |

## Telemetry contract

```json
{"flex1":1850,"flex2":1930,"alert_active":false}
```

```text
ESP32 → native WebSocket (/) → Node bridge → Socket.IO → dashboard
```

The server validates ADC readings in the range 0–4095, preserves `alert_active`, and adds `received_at` and `simulated` metadata. It sends no application commands to the device. Raw ADC readings are sensor units, not degrees or percentages. The updated sketch also reports `baseline1`, `baseline2`, `threshold`, `alert_delay_ms`, `calibrating`, `calibration_id`, `motor_test`, and `motor_active`. Original three-field packets remain supported. Baselines are never guessed by the UI. `motor_active` describes the commanded GPIO output, not physical motor feedback.

The browser shows:

- **Live sensor cards and chart:** raw readings and last 60 seconds of telemetry. Original packets use 0–4095 bars; updated packets use baseline-deviation bars with the threshold at the midpoint.
- **Alert-free time and streak:** time when `alert_active` is false. This includes the firmware's configured grace period and is **not a guarantee of upright posture**. No alert is inferred from raw sensor magnitude.
- **Gentle reminders:** an immediate warning when either absolute baseline deviation exceeds the reported threshold; the popup changes to a confirmed posture alert when the device sets `alert_active`. Optional chime and one-minute browser snooze are available. Snoozing does not affect the device motor or LED.
- **Settings:** connection details, instructions for the physical calibration button, and reminder audio preference.
- **Mindful breaks:** a cancelable one-minute guide that does not alter sensor or alert state.
- **CSV export:** up to 3,600 samples, stored only in this tab's memory.

Demo mode is shared across dashboards and clearly labeled. It uses synthetic baseline metadata for the illustration and simulated delayed alerts. A real connection always stops it. Session metrics reset when switching sources and on page reload. Storage and chart sampling are capped around 2 Hz; device frames are still handled at their incoming rate.

Connections without valid readings for 5 seconds show as stale; dropped connections are cleaned up with WebSocket ping/pong heartbeats. Standard transport heartbeats do not change the sketch's application logic. One hardware publisher is accepted at a time. The server serves only `public/`, never firmware or repository files. This is a trusted local-network project with no user accounts or device authentication.

## Structure

```text
├── espcode/espcode.ino      One-tap calibration, motor test, and delayed detection
├── server.js               Express / WebSocket / Socket.IO bridge
├── public/
│   ├── index.html          Dashboard and navigation
│   ├── styles.css          Layout and responsive styles
│   ├── serene.css          Pastel glassmorphism theme and reduced-motion support
│   └── app.js              Read-only telemetry UI, metrics, chart, breaks, export
├── test/bridge.test.js      Original-protocol integration and boundary tests
├── package.json
└── README.md
```

## Verify

```sh
npm test
node --check server.js
node --check public/app.js
git diff --check
```

Tests cover ADC validation, public-file boundaries, root WebSocket compatibility, alert forwarding, absence of browser commands, demo handoff, and stale readings. A C++ harness compiles the actual sketch against simulated Arduino GPIO and checks contact bounce, one-tap averaging, held buttons, confirmation/test pulse duration, and delayed detection in both bend directions. This is a host simulation, not an ESP32 board-package build; a C++ compiler is needed for that test. Actual flashing, sensor calibration, LED, and motor verification require the physical vest and Arduino toolchain.

## Live percentage and threshold warnings

The main percentage is **live threshold margin**, not a session average or anatomical posture score:

```text
maximum deviation = max(abs(flex1 - baseline1), abs(flex2 - baseline2))
margin % = clamp(100 × (1 - maximum deviation / threshold), 0, 100)
```

At baseline it is 100%; halfway to threshold it is 50%; at or beyond threshold it is 0%. A crossing means **strictly greater than** threshold, matching the device rule. The UI shows that warning immediately, while the motor/confirmed device alert still uses its configured 1-second delay. Return within threshold clears the threshold warning. Session-wide alert-free time remains in Insights. Calibration hides the margin until capture completes, and missing baseline data shows an unavailable value rather than a fabricated percentage. Snooze hides the popup but leaves the warning card and live percentage visible.

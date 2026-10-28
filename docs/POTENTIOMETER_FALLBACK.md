# Potentiometer backup for zero-valued flex inputs

Both flex sensors remain connected: upper on GPIO 34, lower on GPIO 35. Connect one potentiometer to GPIO 33 as a backup for a channel that stays at exactly zero.

## Wiring (classic ESP32)

A typical 10 kΩ linear potentiometer is suitable for this prototype. Verify which terminal is its wiper with the component markings or a multimeter.

| Potentiometer terminal | ESP32 |
| --- | --- |
| One outer terminal | 3.3 V |
| Other outer terminal | GND |
| Wiper / centre terminal | GPIO 33 |

Swapping the outer terminals reverses knob direction. Do not connect the potentiometer to 5 V. GPIO 33 is an ADC1 input on the classic ESP32, avoiding ADC2's Wi-Fi sharing limitation. Existing motor, LED, calibration, test-button, and flex wiring stays as it is.

Reference: [Espressif ESP32 ADC documentation](https://docs.espressif.com/projects/esp-idf/en/v4.2.1/esp32/api-reference/peripherals/adc.html).

## Calibration and use

1. Wire the potentiometer before boot. Keep the knob near its middle position, leaving room to turn in either direction.
2. Upload the sketch **with FlexFallback.h in the same espcode folder**. Check the laptop's current LAN address and matching server port in the sketch.
3. Restart the Node backend to load the new telemetry fields, then refresh the browser.
4. Place the dummy/sensors in their reference position, keep the knob at its neutral position, tap GPIO 27 once, and hold still for about half a second. Calibration captures separate flex and potentiometer references.
5. With healthy flex inputs, turning the knob has no effect on readings, percentage, motor alerts, or charts. The ESP32 still reads the knob for diagnostics; its value is excluded from posture processing until needed.
6. If one flex input stays **exactly zero for 2 continuous seconds**, that channel switches to the potentiometer. The mustard UI message identifies which channel needs the knob. Its value, chart, margin and alerts use the potentiometer reading with the potentiometer baseline. The other healthy flex sensor remains active.
7. If both flex inputs stay at zero, both use the **same potentiometer**. They are two display channels controlled by one physical knob, not two independent measurements. The mustard banner states this explicitly.
8. Turning the knob more than **50 ADC counts from its calibrated reference** produces the existing immediate UI warning; maintaining that deviation for **300 ms** activates the device alert and motor-driver output.
9. A failed flex sensor must report non-zero continuously for **1 second** before it takes over again. The last valid flex baseline is restored. A flex sensor that has never had a valid non-zero calibration requires another calibration tap after recovery.

The mustard banner remains visible while backup is active and disappears when both channels return to flex inputs. Each substituted card also carries a mustard POT BACKUP tag. Disconnecting the device hides the prompt so it cannot be mistaken for a current hardware state.

## Failure handling and scope

Zero-valued flex inputs are excluded from posture detection while the two-second fallback decision is pending; otherwise a disconnected sensor could look like a large bend and activate the motor before backup starts. Positive readings interrupt the zero timer. Brief positive glitches during backup do not count as recovery.

Source switching selects the matching baseline and resets the bend timer, so a new source must satisfy the full 300 ms confirmation period. Calibration preserves the last good flex reference if a channel reads zero during capture. It averages the potentiometer separately rather than comparing its reading with the failed flex sensor's old baseline.

This is a **zero-only failure rule**, not a general sensor-health detector. A damaged sensor stuck at a non-zero value or returning noisy non-zero readings will not trigger backup. A disconnected potentiometer can float; connect it properly before enabling this test arrangement. A potentiometer provides a manual test input and does not measure actual posture.

## Telemetry and exports

- `flex1`, `flex2`: effective displayed and processed readings (flex or substituted knob value).
- `baseline1`, `baseline2`: baselines matching the active sources.
- `source1`, `source2`: `flex` or `pot`.
- `raw_flex1`, `raw_flex2`: original ADC readings, retained for diagnosis.
- `pot_value`: potentiometer ADC reading.
- `flex1_ready`, `flex2_ready`: whether each effective channel can be used for detection.

The server validates and forwards these fields. CSV export includes source labels and raw readings, keeping substituted data identifiable. Old firmware without these optional fields remains compatible and does not display the backup banner.

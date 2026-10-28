#pragma once

// Zero is treated as unavailable immediately; replacement starts only after the timeout.
// Each channel has independent timers and retains its last valid flex calibration.
struct FlexFallback {
  bool usingPot = false;
  bool zeroTracking = false;
  bool recoveryTracking = false;
  unsigned long zeroSince = 0;
  unsigned long recoverySince = 0;
  int neutral = 0;
  bool neutralKnown = false;

  bool update(int raw, unsigned long now, unsigned long zeroTimeout, unsigned long recoveryTimeout) {
    const bool wasPot = usingPot;
    if (raw == 0) {
      recoveryTracking = false;
      if (!zeroTracking) { zeroTracking = true; zeroSince = now; }
      if (!usingPot && now - zeroSince >= zeroTimeout) usingPot = true;
    } else {
      zeroTracking = false;
      if (usingPot) {
        if (!recoveryTracking) { recoveryTracking = true; recoverySince = now; }
        if (now - recoverySince >= recoveryTimeout) {
          usingPot = false;
          recoveryTracking = false;
        }
      } else recoveryTracking = false;
    }
    return wasPot != usingPot;
  }
  void captureNeutral(int value, bool allSamplesGood) {
    if (allSamplesGood && value > 0) { neutral = value; neutralKnown = true; }
  }
  bool ready(int raw) const { return usingPot || (raw > 0 && neutralKnown); }
  int reading(int raw, int pot) const { return usingPot ? pot : raw; }
  int baseline(int potNeutral) const { return usingPot ? potNeutral : neutral; }
};

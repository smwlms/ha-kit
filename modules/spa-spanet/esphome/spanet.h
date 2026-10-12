// Helpers for the SpaNET SV serial protocol (EXP1, 38400 8N1).
// A status reply ("RF") is a set of lines like ",R2,18,250,51,...,:".
// After split(): t[0] = "" (leading comma), t[1] = register name, t[1 + n] = register field n.
// Field numbering follows wayne-love/espyspa (lib/SpaInterface/SpaInterface.cpp).
#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace spanet {

inline std::vector<std::string> split(const std::string &line) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : line) {
    if (c == ',') {
      out.push_back(cur);
      cur.clear();
    } else {
      cur += c;
    }
  }
  out.push_back(cur);
  return out;
}

inline bool has(const std::vector<std::string> &t, size_t n) { return t.size() > n + 1; }

inline float num(const std::vector<std::string> &t, size_t n, float scale = 1.0f) {
  if (!has(t, n) || t[n + 1].empty()) return NAN;
  return std::atof(t[n + 1].c_str()) * scale;
}

inline std::string str(const std::vector<std::string> &t, size_t n) { return has(t, n) ? t[n + 1] : std::string(); }

// Power save and sleep timer times are encoded as hour * 256 + minute. The touchpad of a real SV3 (SW V6 21 04 21)
// sometimes stores a byte with +100: 0x1697 is shown as 22:51 (0x97 = 151 = 51 + 100) and 0x8B00 as "39:00"
// (0x8B = 139). So each byte >= 100 is reduced by 100; the result is only a valid time when hour < 24 and
// minute < 60 ("39:00" is invalid and the spa refuses it when you write it). Writing without the +100 works.
inline int time_hour(int raw) {
  const int h = (raw >> 8) & 0xFF;
  return h >= 100 ? h - 100 : h;
}
inline int time_minute(int raw) {
  const int m = raw & 0xFF;
  return m >= 100 ? m - 100 : m;
}
inline bool valid_hhmm(int raw) { return raw >= 0 && raw <= 0xFFFF && time_hour(raw) < 24 && time_minute(raw) < 60; }

// "HH:MM", "--:--" for an invalid time, "" when the field is missing.
inline std::string hhmm(float v) {
  if (std::isnan(v)) return std::string();
  const int raw = static_cast<int>(v);
  if (!valid_hhmm(raw)) return "--:--";
  char buf[6];
  snprintf(buf, sizeof(buf), "%02d:%02d", time_hour(raw), time_minute(raw));
  return std::string(buf);
}

// Real power of the whole spa from the current it reports (R2 field 1) and the mains voltage (R2 field 2).
// The current meter of the SV3 adds a noise floor in quadrature (like RMS): idle it reads about 6.4 A while the
// phase of the spa carries < 1 A, heating it reads 24.0 A against 23.9 A measured on that phase (real SV3,
// 2026-10-11). Real current = sqrt(read^2 - floor^2); a reading below dead_band counts as 0 A, because the floor
// itself wanders +-0.2 A, which near the floor would show as a few hundred W. floor 0 and dead_band 0 = no
// correction (current x voltage). Returns NAN when an input is missing.
inline float real_power_w(float current_a, float voltage_v, float floor_a, float dead_band_a) {
  if (std::isnan(current_a) || std::isnan(voltage_v)) return NAN;
  if (current_a < dead_band_a || current_a <= floor_a) return 0.0f;
  return std::sqrt(current_a * current_a - floor_a * floor_a) * voltage_v;
}

// Decoded status. NAN / -1 / "" = not received yet. Filled register by register by parse_line().
struct Status {
  // R2. mains_current includes the noise floor of the current meter (see real_power_w). heater_temp follows the water
  // after 2.5-3 min of flow; with the pump off it drifts towards the temperature of the pipe.
  float mains_current = NAN, mains_voltage = NAN, case_temp = NAN, heater_temp = NAN;
  int water_present = -1;
  // R3
  float current_limit = NAN, heater_current = NAN;
  std::string firmware, model, state;
  // R4. power_raw = W x 10 (R2 current in 0.1 A x voltage); energy_*_raw in units of 10 Wh. Both include the noise
  // floor of the current meter, so they overestimate (real SV3: 40.5 kWh "yesterday" while the whole house used
  // 31.8 kWh).
  std::string mode;  // NORM / ECON / AWAY / WEEK
  float power_raw = NAN, energy_total_raw = NAN, energy_today_raw = NAN;
  // R5 (mapped on a real SV3, 2026-10-11, by switching each control on the touchpad and diffing the RF replies)
  // pump_status: fields 18-20 for pump A/B/C: 0 off, 1 on, 4 auto. Only 1 means "runs for sure" (switched on at the
  // touchpad, with S22-S24 or by CLEAN). 4 = the spa decides (only a pump that allows it, see RG field 7; on the
  // tested spa pump A, the circulation pump): it may run or stand still, also while sleeping.
  int pump_status[3] = {-1, -1, -1};
  int blower = -1, touchpad = -1, light = -1, cleaning = -1;
  int sleep_active = -1, heating = -1;
  float water_temp = NAN;
  // R6
  float filt_hours = NAN, setpoint = NAN;
  int filt_cycle = -1, power_save = -1;  // power_save: 0 off, 1 low, 2 high
  // Sleep timers: raw day code of the spa (e.g. 127, 128 = off) and window "HH:MM - HH:MM". The firmware adds the
  // word "day" in house.language (strings.yaml), so this parser stays language-free.
  std::string psav_window, sleep1_days, sleep1_window, sleep2_days, sleep2_window;
};

// State of a pump for Home Assistant: "off", "on", "auto", another raw value as a number, "" when unknown.
inline std::string pump_state(int v) {
  if (v < 0) return std::string();
  if (v == 0) return "off";
  if (v == 1) return "on";
  if (v == 4) return "auto";
  return std::to_string(v);
}

// One shared status, so the UART parser and the entity lambdas (number, select) read the same values.
inline Status &status() {
  static Status s;
  return s;
}

enum class Line { None, Reply, R2, R3, R4, R5, R6, Other };

// Parse one line (without the trailing \r\n). Returns which register was updated.
// Lines that do not start with ",R" are command replies (e.g. "380" after W40:380).
inline Line parse_line(const std::string &line, Status &s) {
  if (line.empty() || line == "RF:") return Line::None;
  if (line.size() < 4 || line[0] != ',' || line[1] != 'R') return Line::Reply;
  const auto t = split(line);
  const std::string &reg = t[1];
  auto f = [&](size_t n) { return num(t, n); };
  auto flag = [&](size_t n) { const float v = f(n); return std::isnan(v) ? -1 : (v != 0 ? 1 : 0); };
  auto whole = [&](size_t n) { const float v = f(n); return std::isnan(v) ? -1 : static_cast<int>(v); };
  if (reg == "R2" && has(t, 14)) {
    s.mains_current = f(1) / 10.0f;
    s.mains_voltage = f(2);
    s.case_temp = f(3);
    s.heater_temp = f(12) / 10.0f;
    s.water_present = f(14) == 1 ? 1 : 0;
    return Line::R2;
  }
  if (reg == "R3" && has(t, 22)) {
    s.current_limit = f(1);
    s.firmware = str(t, 6);
    s.model = str(t, 7);
    s.state = str(t, 20);
    s.heater_current = f(22) / 10.0f;
    return Line::R3;
  }
  if (reg == "R4" && has(t, 13)) {
    const std::string mode = str(t, 1);
    if (mode == "NORM" || mode == "ECON" || mode == "AWAY" || mode == "WEEK") s.mode = mode;
    s.power_raw = f(10);
    s.energy_total_raw = f(11);
    s.energy_today_raw = f(12);
    return Line::R4;
  }
  if (reg == "R5" && has(t, 20)) {
    // Fields 5, 6 and 8 (pump A/B/C switched on at the touchpad or with S22-S24) are not "running": during CLEAN
    // they stay 0 while pumps A and B run. Field 13 is not automatic filtration (meaning unknown, it changes when a
    // jet pump starts). Field 11 goes to 1 when the touchpad is used, not when a pump starts over EXP1 (ESPySpa
    // calls it ozone).
    for (int i = 0; i < 3; i++) s.pump_status[i] = whole(18 + i);
    s.blower = flag(7);
    s.sleep_active = f(10) == 1 ? 1 : 0;
    s.touchpad = flag(11);
    s.heating = f(12) == 1 ? 1 : 0;
    s.light = flag(14);
    s.water_temp = f(15) / 10.0f;  // updated rarely: see "How the status is read" in the README
    s.cleaning = flag(16);         // W12 (CLEAN) running; R3 status "W.CLN"
    return Line::R5;
  }
  if (reg == "R6" && has(t, 18)) {
    s.filt_hours = f(6);
    s.filt_cycle = static_cast<int>(f(7));
    s.setpoint = f(8) / 10.0f;
    const int psav = static_cast<int>(f(10));
    s.power_save = (psav >= 0 && psav <= 2) ? psav : -1;
    s.psav_window = hhmm(f(11)) + " - " + hhmm(f(12));
    s.sleep1_days = str(t, 13);
    s.sleep1_window = hhmm(f(15)) + " - " + hhmm(f(17));
    s.sleep2_days = str(t, 14);
    s.sleep2_window = hhmm(f(16)) + " - " + hhmm(f(18));
    return Line::R6;
  }
  return Line::Other;
}

// Splits a byte stream into lines (\n), strips \r and trailing spaces.
class LineReader {
 public:
  template <typename F> void feed(const char *data, size_t len, F on_line) {
    buf_.append(data, len);
    if (buf_.size() > 4096) buf_.clear();  // garbage protection
    size_t pos;
    while ((pos = buf_.find('\n')) != std::string::npos) {
      std::string line = buf_.substr(0, pos);
      buf_.erase(0, pos + 1);
      while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
      on_line(line);
    }
  }

 private:
  std::string buf_;
};

}  // namespace spanet

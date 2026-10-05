// Helpers for the SpaNET SV serial protocol (EXP1, 38400 8N1).
// A status reply ("RF") is a set of lines like ",R2,18,250,51,...,:".
// After split(): t[0] = "" (leading comma), t[1] = register name, t[1 + n] = register field n.
// Field numbering follows wayne-love/espyspa (lib/SpaInterface/SpaInterface.cpp).
#pragma once

#include <cmath>
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

// Power save and sleep timer times are encoded as hour * 256 + minute.
inline std::string hhmm(float v) {
  if (std::isnan(v)) return std::string();
  const int raw = static_cast<int>(v);
  char buf[6];
  snprintf(buf, sizeof(buf), "%02d:%02d", (raw / 256) % 24, (raw % 256) % 60);
  return std::string(buf);
}

// Decoded status. NAN / -1 / "" = not received yet. Filled register by register by parse_line().
struct Status {
  // R2
  float mains_current = NAN, mains_voltage = NAN, case_temp = NAN, heater_temp = NAN;
  int water_present = -1;
  // R3
  float current_limit = NAN, heater_current = NAN;
  std::string firmware, model, state;
  // R4
  std::string mode;  // NORM / ECON / AWAY / WEEK
  float power_raw = NAN, energy_total_raw = NAN, energy_today_raw = NAN;
  // R5
  int sleep_active = -1, heating = -1, auto_filtration = -1;
  float water_temp = NAN;
  // R6
  float filt_hours = NAN, setpoint = NAN;
  int filt_cycle = -1, power_save = -1;  // power_save: 0 off, 1 low, 2 high
  // Sleep timers: raw day code of the spa (e.g. 127, 128 = off) and window "HH:MM - HH:MM". The firmware adds the
  // word "day" in house.language (strings.yaml), so this parser stays language-free.
  std::string psav_window, sleep1_days, sleep1_window, sleep2_days, sleep2_window;
};

enum class Line { None, Reply, R2, R3, R4, R5, R6, Other };

// Parse one line (without the trailing \r\n). Returns which register was updated.
// Lines that do not start with ",R" are command replies (e.g. "380" after W40:380).
inline Line parse_line(const std::string &line, Status &s) {
  if (line.empty() || line == "RF:") return Line::None;
  if (line.size() < 4 || line[0] != ',' || line[1] != 'R') return Line::Reply;
  const auto t = split(line);
  const std::string &reg = t[1];
  auto f = [&](size_t n) { return num(t, n); };
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
  if (reg == "R5" && has(t, 15)) {
    s.sleep_active = f(10) == 1 ? 1 : 0;
    s.heating = f(12) == 1 ? 1 : 0;
    s.auto_filtration = f(13) == 1 ? 1 : 0;
    s.water_temp = f(15) / 10.0f;
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

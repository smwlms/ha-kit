// Host test for the SpaNET parser used by jacuzzi.yaml (same spanet.h as the firmware).
// Build & run:  c++ -std=c++17 -O1 -o /tmp/spanet_test test/spanet_test.cpp && /tmp/spanet_test
// (run from spa-spanet/esphome; test 4 calls tools/spanet_sim.py --dump)
#include "../spanet.h"

#include <cstdio>
#include <string>

static int failures = 0;

#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      std::printf("  FAIL  %s  (line %d)\n", #cond, __LINE__);         \
      failures++;                                                       \
    }                                                                   \
  } while (0)
#define NEAR(a, b) CHECK(std::fabs((a) - (b)) < 0.05f)

// Real reply of an SV3 (devbobo/SpaNet.md), exactly as sent on the socket.
static const char *kSample =
    "RF:\r\n"
    ",R2,18,250,51,70,4,13,50,55,19,6,2020,376,9999,1,0,490,207,34,6000,602,23,20,0,0,0,0,44,35,45,:\r\n"
    ",R3,32,1,4,4,4,SW V5 17 05 31,SV3,18480001,20000826,1,0,0,0,0,0,NA,7,0,470,Filtering,4,0,7,7,0,0,:\r\n"
    ",R4,NORM,0,0,0,1,0,3547,4,20,4500,7413,567,1686,0,8388608,0,0,5,0,98,0,10084,4,80,100,0,0,4,:\r\n"
    ",R5,0,1,0,1,0,0,0,0,0,0,1,0,1,0,376,0,3,4,0,0,0,0,0,1,2,6,:\r\n"
    ",R6,1,5,0,2,5,8,1,360,1,0,3584,5120,127,128,5632,5632,2304,1792,0,30,0,0,0,0,2,3,0,:\r\n"
    ",R7,2304,0,1,1,1,0,1,0,0,0,253,191,253,240,483,125,77,1,0,0,0,23,200,1,0,1,31,32,35,100,5,:\r\n"
    ",RG,1,1,1,1,1,1,1-1-014,1-1-01,1-1-01,0-,0-,0,:*\r\n";

static int feed(spanet::LineReader &r, spanet::Status &s, const std::string &data, size_t chunk) {
  int status_lines = 0;
  for (size_t i = 0; i < data.size(); i += chunk) {
    const size_t n = std::min(chunk, data.size() - i);
    r.feed(data.data() + i, n, [&](const std::string &line) {
      const auto k = spanet::parse_line(line, s);
      if (k != spanet::Line::None && k != spanet::Line::Reply && k != spanet::Line::Other) status_lines++;
    });
  }
  return status_lines;
}

static void check_sample(const spanet::Status &s) {
  NEAR(s.mains_current, 1.8f);
  NEAR(s.mains_voltage, 250.0f);
  NEAR(s.case_temp, 51.0f);
  NEAR(s.heater_temp, 37.6f);
  CHECK(s.water_present == 1);
  NEAR(s.current_limit, 32.0f);
  CHECK(s.firmware == "SW V5 17 05 31");
  CHECK(s.model == "SV3");
  CHECK(s.state == "Filtering");
  NEAR(s.heater_current, 0.0f);
  CHECK(s.mode == "NORM");
  NEAR(s.power_raw, 4500.0f);
  CHECK(s.sleep_active == 0);
  CHECK(s.heating == 0);
  CHECK(s.auto_filtration == 1);
  NEAR(s.water_temp, 37.6f);
  NEAR(s.filt_hours, 8.0f);
  CHECK(s.filt_cycle == 1);
  NEAR(s.setpoint, 36.0f);
  CHECK(s.power_save == 0);
  CHECK(s.psav_window == "14:00 - 20:00");
  CHECK(s.sleep1_days == "127");
  CHECK(s.sleep1_window == "22:00 - 09:00");
  CHECK(s.sleep2_days == "128");
  CHECK(s.sleep2_window == "22:00 - 07:00");
}

int main() {
  std::printf("1. Real SV3 reply in one piece\n");
  {
    spanet::LineReader r;
    spanet::Status s;
    CHECK(feed(r, s, kSample, 100000) == 5);
    check_sample(s);
  }
  std::printf("2. Same reply in chunks of 1, 7 and 63 bytes (as the UART delivers it)\n");
  for (size_t chunk : {1, 7, 63}) {
    spanet::LineReader r;
    spanet::Status s;
    CHECK(feed(r, s, kSample, chunk) == 5);
    check_sample(s);
  }
  std::printf("3. Command replies are not read as status\n");
  {
    spanet::Status s;
    CHECK(spanet::parse_line("380", s) == spanet::Line::Reply);
    CHECK(spanet::parse_line("S22-OK", s) == spanet::Line::Reply);
    CHECK(spanet::parse_line("RF:", s) == spanet::Line::None);
    CHECK(spanet::parse_line(",R5,0,1", s) == spanet::Line::Other);  // truncated line is ignored
    CHECK(std::isnan(s.water_temp));
  }
  std::printf("4. Reply of the simulator (tools/spanet_sim.py --dump --water 35.5 --setpoint 38)\n");
  {
    FILE *p = popen("python3 tools/spanet_sim.py --dump --water 35.5 --setpoint 38", "r");
    CHECK(p != nullptr);
    std::string out;
    char buf[512];
    while (p && fgets(buf, sizeof buf, p)) out += buf;
    if (p) pclose(p);
    spanet::LineReader r;
    spanet::Status s;
    CHECK(feed(r, s, out, 13) == 5);
    NEAR(s.water_temp, 35.5f);
    NEAR(s.setpoint, 38.0f);
    CHECK(s.mode == "NORM");
    CHECK(s.power_save == 2);
    CHECK(s.psav_window == "17:00 - 23:00");
    CHECK(s.sleep1_days == "127");
    CHECK(s.sleep1_window == "06:00 - 10:00");
    CHECK(s.model == "SV3");
  }
  std::printf(failures == 0 ? "\nAll tests passed.\n" : "\n%d test(s) FAILED.\n", failures);
  return failures == 0 ? 0 : 1;
}

#pragma once
// ComfoClime 24 (ComfoNet node 12) RMI client.
//
// Reads and writes the ComfoClime's own settings (unit 0x16 TEMPCONFIG) over the CAN bus,
// so the ComfoClime Wi-Fi/LAN API is no longer needed. See LOGIC.md of the ha-kit module ventilation-zehnder.
//
// Protocol (aiocomfoconnect docs/PROTOCOL-RMI.md, verified in a bus capture):
//   can_id = 0x1F<<24 | seq<<17 | request<<16 | error<<15 | multi<<14 | 1<<12 | dst<<6 | src
//   GET  : 01 unit subunit 10 prop        -> response = value (little endian)
//   SET  : 03 unit subunit prop value...  -> response = empty (OK) or error code (error bit set)
//   Multi-frame responses: byte 0 = frame index, 0x80 on the last frame.
//
// Safety: one request on the bus at a time, only commands 0x01 (get) and 0x03 (set), only to
// node 12, SET hard-limited to unit 0x16 subunit 1 (TEMPCONFIG) and only while writes are
// enabled (switch "ComfoClime: allow writes"). Commands >= 0x80 (factory/update) are never sent.

#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/canbus/canbus.h"
#include <deque>
#include <functional>
#include <string>
#include <vector>

namespace ccrmi {

static const char *const TAG = "ccrmi";
static const uint8_t NODE_CLIME = 12;
static const uint8_t NODE_LOCAL = 0x3e;  // = yoziru local_node_id (62)
static const uint8_t UNIT_TEMPCONFIG = 0x16;
static const uint32_t TIMEOUT_MS = 1500;
static const uint32_t GAP_MS = 60;  // pause between requests (HA integration polled ~1 frame / 70 ms)
static const size_t QUEUE_MAX = 200;

enum Status : uint8_t { STATUS_OK = 0, STATUS_ERROR = 1, STATUS_TIMEOUT = 2 };

// cmd = the request bytes, data = the (reassembled) response payload
using Handler = std::function<void(const std::vector<uint8_t> &cmd, Status status, const std::vector<uint8_t> &data)>;

inline std::string hex(const std::vector<uint8_t> &v) {
  std::string s;
  char b[4];
  for (size_t i = 0; i < v.size(); i++) {
    snprintf(b, sizeof(b), i ? " %02X" : "%02X", v[i]);
    s += b;
  }
  return s;
}

// "22/1/13" for a GET or SET request
inline std::string path(const std::vector<uint8_t> &cmd) {
  char b[16];
  if (cmd.size() >= 5 && cmd[0] == 0x01)
    snprintf(b, sizeof(b), "%u/%u/%u", cmd[1], cmd[2], cmd[4]);
  else if (cmd.size() >= 4 && cmd[0] == 0x03)
    snprintf(b, sizeof(b), "%u/%u/%u", cmd[1], cmd[2], cmd[3]);
  else
    snprintf(b, sizeof(b), "cmd %02X", cmd.empty() ? 0 : cmd[0]);
  return b;
}

// little endian; 2 bytes = int16 (temperatures x0.1 can be negative)
inline int32_t le_value(const std::vector<uint8_t> &d) {
  if (d.size() == 1) return d[0];
  if (d.size() == 2) return (int16_t) (d[0] | (d[1] << 8));
  if (d.size() >= 4) return (int32_t) (d[0] | (d[1] << 8) | (d[2] << 16) | ((uint32_t) d[3] << 24));
  return 0;
}

class Client {
 public:
  void set_canbus(esphome::canbus::Canbus *bus) { bus_ = bus; }
  void set_handler(Handler h) { handler_ = std::move(h); }
  void set_writes_enabled(bool enabled) { writes_enabled_ = enabled; }
  bool writes_enabled() const { return writes_enabled_; }

  // Read one property (any unit) of node 12. Duplicate GETs already queued are skipped.
  void get(uint8_t unit, uint8_t subunit, uint8_t prop, bool urgent = false) {
    enqueue_({0x01, unit, subunit, 0x10, prop}, urgent);
  }

  // Write one TEMPCONFIG property 22/1/<prop>, size 1 or 2 bytes, little endian.
  // Writes keep their order; a successful SET is followed by a GET of the same property.
  bool set(uint8_t prop, int32_t value, uint8_t size) {
    if (!writes_enabled_) {
      ESP_LOGW(TAG, "SET 22/1/%u = %ld blocked: switch 'ComfoClime: allow writes' is off", prop, (long) value);
      last_status_ = "SET 22/1/" + std::to_string(prop) + " blocked (writes off)";
      get(UNIT_TEMPCONFIG, 1, prop, true);  // republish the device value
      return false;
    }
    if (size != 1 && size != 2) {
      ESP_LOGE(TAG, "SET 22/1/%u refused: size %u not supported", prop, size);
      return false;
    }
    std::vector<uint8_t> cmd = {0x03, UNIT_TEMPCONFIG, 0x01, prop, (uint8_t) (value & 0xff)};
    if (size == 2) cmd.push_back((uint8_t) ((value >> 8) & 0xff));
    enqueue_(cmd, true);
    return true;
  }

  size_t queued() const { return urgent_.size() + normal_.size(); }
  const std::string &last_status() const { return last_status_; }

  // Call every ~50 ms: sends the next request, handles the timeout.
  void loop() {
    const uint32_t now = esphome::millis();
    if (pending_ && now - sent_at_ > TIMEOUT_MS) {
      ESP_LOGW(TAG, "%s %s: timeout (no response from node %u)", kind_(pending_cmd_), path(pending_cmd_).c_str(), NODE_CLIME);
      finish_(STATUS_TIMEOUT, {});
    }
    if (pending_ || bus_ == nullptr || now - done_at_ < GAP_MS) return;
    auto &q = !urgent_.empty() ? urgent_ : normal_;
    if (q.empty()) return;
    pending_cmd_ = q.front();
    q.pop_front();
    seq_ = (seq_ + 1) & 0x3;
    const uint32_t can_id = 0x1F000000u | ((uint32_t) seq_ << 17) | (1u << 16) | (1u << 12) |
                            ((uint32_t) NODE_CLIME << 6) | NODE_LOCAL;
    multi_buf_.clear();
    const auto err = bus_->send_data(can_id, true, false, pending_cmd_);
    if (err != esphome::canbus::ERROR_OK) {
      ESP_LOGW(TAG, "%s %s: CAN send failed (%d)", kind_(pending_cmd_), path(pending_cmd_).c_str(), (int) err);
      done_at_ = now;
      return;
    }
    pending_ = true;
    sent_at_ = now;
    ESP_LOGD(TAG, "-> can_id=0x%08lx [%s]", (unsigned long) can_id, hex(pending_cmd_).c_str());
  }

  // Feed every RMI frame from node 12 to node 62 (on_frame filter in the device YAML, esphome/ventilation.yaml in the kit).
  void handle_frame(uint32_t can_id, const std::vector<uint8_t> &x) {
    if (((can_id >> 16) & 1) != 0) return;  // a request, not a response
    if (!pending_) {
      ESP_LOGD(TAG, "unsolicited response can_id=0x%08lx [%s]", (unsigned long) can_id, hex(x).c_str());
      return;
    }
    const uint8_t seq = (can_id >> 17) & 0x3;
    if (seq != seq_) {
      ESP_LOGD(TAG, "response seq %u != request seq %u (accepted, one request in flight)", seq, seq_);
    }
    const bool error = (can_id >> 15) & 1;
    const bool multi = (can_id >> 14) & 1;
    if (!multi) {
      finish_(error ? STATUS_ERROR : STATUS_OK, x);
      return;
    }
    if (x.empty()) return;
    if ((x[0] & 0x7f) == 0) multi_buf_.clear();
    multi_buf_.insert(multi_buf_.end(), x.begin() + 1, x.end());
    if (x[0] & 0x80) finish_(error ? STATUS_ERROR : STATUS_OK, multi_buf_);
  }

 protected:
  static const char *kind_(const std::vector<uint8_t> &cmd) { return !cmd.empty() && cmd[0] == 0x03 ? "SET" : "GET"; }

  void enqueue_(const std::vector<uint8_t> &cmd, bool urgent) {
    if (cmd[0] == 0x01) {
      for (auto &q : urgent_)
        if (q == cmd) return;
      for (auto &q : normal_)
        if (q == cmd) return;
    }
    if (queued() >= QUEUE_MAX) {
      ESP_LOGW(TAG, "queue full, dropping %s %s", kind_(cmd), path(cmd).c_str());
      return;
    }
    (urgent ? urgent_ : normal_).push_back(cmd);
  }

  void finish_(Status status, const std::vector<uint8_t> &data) {
    const std::vector<uint8_t> cmd = pending_cmd_;
    pending_ = false;
    done_at_ = esphome::millis();
    const bool is_set = cmd[0] == 0x03;
    char b[96];
    if (status == STATUS_OK && is_set)
      snprintf(b, sizeof(b), "SET %s = [%s] OK", path(cmd).c_str(), hex(std::vector<uint8_t>(cmd.begin() + 4, cmd.end())).c_str());
    else if (status == STATUS_OK)
      snprintf(b, sizeof(b), "GET %s = [%s]", path(cmd).c_str(), hex(data).c_str());
    else if (status == STATUS_ERROR)
      snprintf(b, sizeof(b), "%s %s ERROR %u", kind_(cmd), path(cmd).c_str(), data.empty() ? 0 : data[0]);
    else
      snprintf(b, sizeof(b), "%s %s TIMEOUT", kind_(cmd), path(cmd).c_str());
    if (status == STATUS_OK && !is_set) {
      ESP_LOGD(TAG, "%s", b);
    } else if (status == STATUS_OK) {
      ESP_LOGI(TAG, "%s", b);
    } else {
      ESP_LOGW(TAG, "%s", b);
    }
    // reads are frequent; only writes and failures update the status text
    if (is_set || status != STATUS_OK) last_status_ = b;
    if (is_set && status == STATUS_OK) get(cmd[1], cmd[2], cmd[3], true);  // read-back
    if (handler_) handler_(cmd, status, data);
  }

  esphome::canbus::Canbus *bus_{nullptr};
  Handler handler_;
  std::deque<std::vector<uint8_t>> urgent_;  // writes + read-backs, in order
  std::deque<std::vector<uint8_t>> normal_;  // polling
  std::vector<uint8_t> pending_cmd_;
  std::vector<uint8_t> multi_buf_;
  std::string last_status_;
  bool writes_enabled_{false};
  bool pending_{false};
  uint8_t seq_{0};
  uint32_t sent_at_{0};
  uint32_t done_at_{0};
};

inline Client &client() {
  static Client c;
  return c;
}

}  // namespace ccrmi

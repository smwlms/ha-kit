#pragma once
// Climate entity for the ComfoClime 24, a drop-in for climate.comfoclime_24 of the HACS
// integration msfuture/comfoclime (same modes and presets):
//   mode   : off (heat pump standby) | fan_only (season transition) | heat | cool
//   preset : none (manual temperature 22/1/13) | comfort / boost / eco (automatic, profile 22/1/29)
//   target : active setpoint (PDO 4148); setting it switches to manual
//   action : from heat pump status (PDO 4192): bit 1 heating, bit 2 cooling
// State is fed from the device YAML (esphome/ventilation.yaml in the kit) (RMI read-back + node-12 PDOs); control goes through ccrmi.

#include "esphome/components/climate/climate.h"
#include "esphome/core/component.h"
#include "comfoclime_rmi.h"
#include <cmath>

namespace esphome {
namespace comfoclime {

class ComfoClimeClimate : public climate::Climate, public Component {
 public:
  // --- fed from the device YAML ---
  void set_season(int v) { update_(season_, v); }                     // 22/1/3
  void set_auto_season(bool v) { update_(auto_season_, (int) v); }    // 22/1/2
  void set_auto_comfort(bool v) { update_(auto_comfort_, (int) v); }  // 22/1/8
  void set_profile(int v) { update_(profile_, v); }                   // 22/1/29
  void set_heat_pump_enabled(bool v) { update_(hp_enabled_, (int) v); }  // 22/1/21 (hypothesis)
  void set_manual_temperature(float t) { update_(manual_, t); }       // 22/1/13
  void set_active_mode(int v) { update_(active_mode_, v); }           // PDO 4149
  void set_setpoint(float t) { update_(setpoint_, t); }               // PDO 4148
  void set_indoor_temperature(float t) { update_(indoor_, t); }       // PDO 4154
  void set_heat_pump_status(int v) { update_(hp_status_, v); }        // PDO 4192

  float get_setup_priority() const override { return setup_priority::DATA; }

  void loop() override {
    if (!dirty_) return;
    dirty_ = false;
    publish_if_changed_();
  }

 protected:
  climate::ClimateTraits traits() override {
    climate::ClimateTraits t;
    t.add_feature_flags(climate::CLIMATE_SUPPORTS_CURRENT_TEMPERATURE | climate::CLIMATE_SUPPORTS_ACTION);
    t.set_supported_modes({climate::CLIMATE_MODE_OFF, climate::CLIMATE_MODE_FAN_ONLY, climate::CLIMATE_MODE_HEAT,
                           climate::CLIMATE_MODE_COOL});
    t.set_supported_presets({climate::CLIMATE_PRESET_NONE, climate::CLIMATE_PRESET_COMFORT,
                             climate::CLIMATE_PRESET_BOOST, climate::CLIMATE_PRESET_ECO});
    t.set_visual_min_temperature(18);
    t.set_visual_max_temperature(28);
    t.set_visual_target_temperature_step(0.5);
    t.set_visual_current_temperature_step(0.1);
    return t;
  }

  void control(const climate::ClimateCall &call) override {
    auto &c = ccrmi::client();
    if (call.get_mode().has_value()) {
      const auto mode = *call.get_mode();
      if (mode == climate::CLIMATE_MODE_OFF) {
        c.set(21, 1, 1);
      } else {
        if (hp_enabled_ == 0) c.set(21, 0, 1);
        if (auto_season_ != 0) c.set(2, 0, 1);  // a manual season only sticks with automatic season off
        c.set(3, mode == climate::CLIMATE_MODE_HEAT ? 1 : mode == climate::CLIMATE_MODE_COOL ? 2 : 0, 1);
      }
    }
    if (call.get_preset().has_value()) {
      const auto p = *call.get_preset();
      if (p == climate::CLIMATE_PRESET_NONE) {
        c.set(8, 0, 1);
      } else {
        c.set(29, p == climate::CLIMATE_PRESET_COMFORT ? 0 : p == climate::CLIMATE_PRESET_BOOST ? 1 : 2, 1);
        if (auto_comfort_ != 1) c.set(8, 1, 1);
      }
    }
    if (call.get_target_temperature().has_value()) {
      c.set(13, (int32_t) lroundf(*call.get_target_temperature() * 10), 2);
      if (auto_comfort_ != 0) c.set(8, 0, 1);  // like the HA integration: a setpoint means manual mode
    }
    // no optimistic state: the read-back after each SET updates the entity
  }

  template<typename T> void update_(T &field, T value) {
    if (field != value) {
      field = value;
      dirty_ = true;
    }
  }

  void publish_if_changed_() {
    // season: actual mode from PDO 4149 if seen, else the selected season 22/1/3
    const int season = active_mode_ >= 0 ? active_mode_ : season_;
    if (season < 0 && hp_enabled_ != 0) return;  // nothing known yet
    climate::ClimateMode m = climate::CLIMATE_MODE_OFF;
    if (hp_enabled_ != 0)
      m = season == 1 ? climate::CLIMATE_MODE_HEAT : season == 2 ? climate::CLIMATE_MODE_COOL : climate::CLIMATE_MODE_FAN_ONLY;

    climate::ClimateAction a = climate::CLIMATE_ACTION_OFF;
    if (m != climate::CLIMATE_MODE_OFF) {
      if (hp_status_ > 0 && (hp_status_ & 0x02)) a = climate::CLIMATE_ACTION_HEATING;
      else if (hp_status_ > 0 && (hp_status_ & 0x04)) a = climate::CLIMATE_ACTION_COOLING;
      else if (m == climate::CLIMATE_MODE_FAN_ONLY) a = climate::CLIMATE_ACTION_FAN;
      else a = climate::CLIMATE_ACTION_IDLE;
    }

    climate::ClimatePreset p = climate::CLIMATE_PRESET_NONE;
    if (auto_comfort_ == 1)
      p = profile_ == 1 ? climate::CLIMATE_PRESET_BOOST : profile_ == 2 ? climate::CLIMATE_PRESET_ECO : climate::CLIMATE_PRESET_COMFORT;

    const float target = !std::isnan(setpoint_) ? setpoint_ : manual_;

    const bool changed = !published_ || m != this->mode || a != this->action || !this->preset.has_value() ||
                         *this->preset != p || !same_(target, this->target_temperature) ||
                         !same_(indoor_, this->current_temperature);
    if (!changed) return;
    this->mode = m;
    this->action = a;
    this->set_preset_(p);
    this->target_temperature = target;
    this->current_temperature = indoor_;
    published_ = true;
    this->publish_state();
  }

  static bool same_(float a, float b) { return (std::isnan(a) && std::isnan(b)) || a == b; }

  int season_{-1}, auto_season_{-1}, auto_comfort_{-1}, profile_{-1}, hp_enabled_{-1};
  int active_mode_{-1}, hp_status_{-1};
  float manual_{NAN}, setpoint_{NAN}, indoor_{NAN};
  bool dirty_{false};
  bool published_{false};
};

}  // namespace comfoclime
}  // namespace esphome

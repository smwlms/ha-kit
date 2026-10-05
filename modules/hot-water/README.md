# <@ module.name @>

<@ module.description @>.

**Status: built, not tested on HA.** The tank stores heat: when the sun would otherwise go to the grid (or power is very cheap) it heats to a high maximum, outside those moments it only keeps a comfort minimum, and the morning and the bath are covered in the cheapest hour before them with a safety net after. It never touches a brand entity: it calls the two scripts of the `hot-water-heater` capability (`heat-pump-vaillant` today) and reads the plan of `energy-plan`. One automation, `hot_water_buffer`, is the only caller of those scripts.

How every decision is made, the economics and the test plan are in [LOGIC.md](LOGIC.md).

## Requirements

| What | Why | Note |
| ---- | --- | ---- |
| Module **base** | `packages/` and `templates/` in `configuration.yaml` | Run `base/deploy.py` first |
| A module that provides **hot-water-heater**, e.g. `heat-pump-vaillant` | `script.hot_water_heat`, `script.hot_water_normal`, `sensor.hot_water_temperature`, `sensor.hot_water_cop` | Deploy it first: `deploy.py` stops when the scripts are missing |
| Module **energy-plan** | export average, the solar day plan, battery behind, the `watts()` macro | Deploy it first |
| A **tariff** module, e.g. `tariff-be` (optional) | price weighing, cheapest hours, cheap power, month peak | Without it: surplus only, safety nets at fixed moments |
| Module **ev-charging** (optional) | the car on the charger comes first in the plan | Without it the room is the whole margin |
| Home Assistant 2025.4 or newer | `default_entity_id` of template sensors | |
| HA OS or Supervised + the **File editor** app | `deploy.py` uploads through the File editor | Without it: copy the files yourself, see `deploy.py --dry-run` |

## Contract

What this module provides (fixed ids, see `docs/phase4-contracts.md`). States are English values; names follow `house.language`.

| Entity | Unit | State and attributes | Exists |
| ------ | ---- | -------------------- | ------ |
| `input_boolean.hot_water_on_surplus` | - | master switch: off = the module does nothing (a running session or boost goes back to normal) | always |
| `input_boolean.hot_water_surplus_active` | - | session marker: a surplus or cheap-power session runs. Set only by the automation | always |
| `input_boolean.hot_water_shower_tomorrow` | - | morning goal = shower temperature; switches itself off at sunrise | always |
| `input_boolean.hot_water_price_aware` | - | heat on surplus only when it pays | with a tariff module |
| `input_number.hot_water_minimum`, `hot_water_shower`, `hot_water_surplus_max` | °C | comfort minimum at sunrise (and target outside a session), shower goal, target of a session | always |
| `input_number.hot_water_surplus_from_kw` | kW | a session starts only above this export average | always |
| `input_number.hot_water_battery_minimum` | % | the battery first, unless the plan has room for both | with `entities.battery_soc` |
| `input_number.hot_water_bath`, `input_datetime.hot_water_bath_check` | °C, time | bath goal and when it is checked | with `hot_water.bath: true` |
| `input_number.hot_water_heat_value`, `hot_water_cheap_max_grid_kw`, `hot_water_cheap_stop_min` | -, kW, min | price weighing, grid allowed during cheap power and for how long | with a tariff module |
| `sensor.hot_water_energy_needed` | kWh | electrical energy to bring the tank to the maximum; attributes `kwh_per_degree`, `cop`, `tank_litres`, `target` | always (unavailable without a tank temperature) |
| `sensor.hot_water_room` | kWh | energy-plan margin minus what the car still needs; attributes `margin_kwh`, `car_kwh` | always (unavailable after the sun) |
| `sensor.hot_water_expected_export` | kWh | room minus energy needed, at least 0 | always |
| `binary_sensor.hot_water_heating_pays` | - | the export price is below heat value × the later import price, or negative; attributes `export_price`, `later_price`, `threshold`, `reason` | always (always on without a tariff module, `reason: no_tariff`) |
| `sensor.hot_water_cheapest_hour_before_sunrise` | timestamp | start of the cheapest hour between sunset (or now) and sunrise; attributes `mean_price`, `end` | with a tariff module |
| `sensor.hot_water_cheapest_hour_before_bath` | timestamp | start of the cheapest hour between `hot_water.bath_from` and the bath check; attributes `mean_price`, `end` | with a tariff module and the bath |
| `sensor.hot_water_session` | - | `idle`, `solar`, `cheap_power`, `boost`; attributes `reason`, `target`, `start_temperature`, `started`, `ended`, `import_price`, `export_price`, `starts_today`, `day` | always (unknown until the first start or boost) |
| macros in `custom_templates/hot_water.jinja` | | `kwh_per_degree()`, `morning_goal()`, `cheapest_hour(a, b)`, `morning_hour()`, `bath_hour()`, `decide(tid)` | always |
| automation `hot_water_buffer` | | the only caller of `script.hot_water_heat` / `script.hot_water_normal` | always |

Events it fires:

| Event | Data | When |
| ----- | ---- | ---- |
| `ha_kit_result` | `kind` (`hot_water_solar`, `hot_water_cheap_hour`), `kwh`, `eur`, `export_missed` | end of a session with heat gained; a boost in a cheapest hour |
| `ha_kit_day_goal` | `goal` (`morning`, `bath`), `status` (`met`, `missed`), `detail` | at sunrise; at the bath check |
| `ha_kit_hot_water_session` | the record of `sensor.hot_water_session` | internal: every start, boost and end |

## Contracts between modules

| Reads | From | Why |
| ----- | ---- | --- |
| `script.hot_water_heat` (`target`, `boost`, `reason`), `script.hot_water_normal` (`target`, `reason`), `sensor.hot_water_temperature`, `sensor.hot_water_cop` | `hot-water-heater` (e.g. `heat-pump-vaillant`) | the only actuator and the tank |
| `sensor.energy_plan_export_avg`, `sensor.energy_plan_margin` (`after_sun`), `binary_sensor.energy_plan_battery_behind`, macro `watts()` | `energy-plan` | surplus, the day plan, the battery first |
| `sensor.power_price_import` (`starts`, `prices`, `cheapest_2h`, `min_coming`, `mean_coming`), `sensor.power_price_export`, `binary_sensor.power_price_cheap`, `sensor.capacity_headroom_kw`, macros `price_at()`, `reference_price()` | `tariff` (optional) | price weighing, cheapest hours, cheap power, month peak |
| `sensor.ev_charging_energy_needed` | `ev-charging` (optional) | the car first |

| Read by | What |
| ------- | ---- |
| `home-screen` | `input_boolean.hot_water_shower_tomorrow`, `input_number.hot_water_shower` / `_minimum`, `sensor.hot_water_cheapest_hour_before_sunrise`, `input_boolean.hot_water_surplus_active` |
| `results` | events `ha_kit_result` and `ha_kit_day_goal` (savings per kind, morning and bath goals) |
| `energy` | the sensors above, for the hot-water block |

## Fields in `house.yaml`

Section `hot_water:` (all optional; see `house.example.yaml`): `tank_litres` (300), `cop` (2.8, the COP when the heater gives none; 1 for an element), `bath` (false), `heater_kw` (electrical power while heating; default `heat_pump.power_estimate_w.hot_water` / 1000, else 2.0), `bath_from` ("10:00"), `max_sessions_per_day` (6). It also reads `entities.grid_import_w` (required), `entities.battery_soc`, `entities.battery_power_w` with `energy.battery_power_sign` (optional: the battery rules).

## What you do in the UI

- Settings > Helpers: tune the temperatures and thresholds (start values in `module.yaml`, set once by `deploy.py`). Do not switch `Hot water: heating on surplus now` yourself: it is the session marker.
- The shower button (`input_boolean.hot_water_shower_tomorrow`, also the Hot water tile of the home screen): switch it on the evening before; it goes off at sunrise.
- Logbook, entity `input_boolean.hot_water_on_surplus`: every start, stop, boost, skip and day goal with its reason.

## Install

```bash
python tools/fill.py house.yaml build
cd build && uv run --with-requirements requirements.txt python hot-water/deploy.py --dry-run   # what it would do
HA_URL=... HA_TOKEN=... uv run --with-requirements requirements.txt python hot-water/deploy.py
```

Order: `base`, the `hot-water-heater` adapter (`heat-pump-vaillant`), `energy-plan`, the tariff module, then this one. `deploy.py` checks the scripts and sensors it needs and stops when the heater or energy-plan is missing.

## The cloud quota

A cloud heat pump allows few commands (myVAILLANT: `heat-pump-vaillant` stops writing above `input_number.heat_pump_vaillant_max_writes_per_day`, default 40; `hot_water_normal` is always allowed). This module keeps well under it: a session starts only when the heater fits in the surplus, never within 30 minutes after the previous one ended, at most `hot_water.max_sessions_per_day` (6) per day, and the adapter writes only values that differ. A session costs about 4 writes (target + mode, mode + target), a boost about 3 (target + boost, target back). See LOGIC.md, "Settings".

## Test plan

See [LOGIC.md](LOGIC.md), "Test plan".

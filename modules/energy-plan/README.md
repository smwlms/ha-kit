# <@ module.name @>

<@ module.description @>.

**Status: built, not tested on HA.** One owner for the energy signals that charging, hot water, appliances, the energy screens and the results all read: the export average and "surplus on/off", the house consumption, and the solar day plan (how much solar energy is left today after the house and the home battery, and whether the battery falls behind). It has no screens and switches nothing: other modules decide what to do with it.

How every decision is made, the battery-full model and the test plan are in [LOGIC.md](LOGIC.md).

## Requirements

| What | Why | Note |
| ---- | --- | ---- |
| Module **base** | `packages/`, `templates/` and `command_line/` in `configuration.yaml` | Run `base/deploy.py` first |
| Home Assistant 2025.4 or newer | `default_entity_id` of template sensors, statistics `max_age` without `sampling_size` | |
| HA OS or Supervised + the **File editor** app | `deploy.py` uploads through the File editor | Without it: copy the files yourself, see `deploy.py --dry-run` |
| Grid import and export power (P1 meter, energy meter) | export average, surplus, house consumption | Two sensors, W or kW, both positive |
| Solar power sensor | the day plan learns when the sun leaves the panels | Required: there is no plan without panels |
| **Recorder on SQLite** (the default) | `energy_plan.py` reads the 5-minute statistics in `/config/home-assistant_v2.db`, read-only | With MariaDB or PostgreSQL: surplus, house power and export average work; `sensor.energy_plan_margin` stays unavailable and there is no battery behind |
| `state_class: measurement` on the power roles | the recorder keeps 5-minute statistics only for those | P1 and inverter integrations set it; a template sensor of your own needs it too |
| At least one full day of statistics | the plan learns from the last days | Day one: the margin is unavailable until the first full day is recorded |
| Solar forecast, e.g. **Forecast.Solar** (optional) | sees today's clouds | Without it the plan uses history only (see "Without a battery or forecast") |
| Home battery with a state of charge (optional) | battery needed, battery behind | Not controlled: the kit only reads it |
| Python 3.11 + [uv](https://docs.astral.sh/uv/) on your computer | `fill.py`, `deploy.py` | Home Assistant runs the script with its own Python (standard library only) |

## Contract

What this module provides (fixed ids, see `docs/phase4-contracts.md`). States are English values; the names of the template sensors and helpers follow `house.language`.

| Entity | Unit | State and attributes | Exists |
| ------ | ---- | -------------------- | ------ |
| `sensor.energy_plan_export_avg` | kW | 10-minute time-weighted mean of the export | always |
| `binary_sensor.energy_plan_surplus` | - | on above threshold + hysteresis, off below threshold − hysteresis; attributes `export_avg_kw`, `on_above_kw`, `off_below_kw` | always |
| `sensor.energy_plan_house_power` | W | consumption of the house, the car included; attributes `source` (`role` or `computed`), `without_car` (W, with an `ev-charger` module) | always |
| `sensor.energy_plan_margin` | kWh | solar left today after the house and the battery; attributes `after_sun`, `sun_end`, `sunset`, `sun_end_offset_min`, `battery`, `battery_needed_kwh`, `pv_remaining_kwh`, `pv_remaining_forecast_kwh`, `pv_remaining_history_kwh`, `house_remaining_kwh`, `source` (`forecast`, `history`, null after the sun), `forecast_factor`, `pv_today_kwh`, `days`, `error` | always (unavailable without a plan) |
| `binary_sensor.energy_plan_battery_behind` | - | the battery will not be full by the sun end; attributes `margin_kwh`, `sun_end`, `on_below_kwh`, `off_above_kwh` | only with `entities.battery_soc` |
| `sensor.energy_plan_export_kw` | kW | the export role in kW (source of the average) | always |
| `input_number.energy_plan_surplus_kw`, `energy_plan_surplus_hysteresis_kw` | kW | thresholds of the surplus (defaults 1.5 and 0.3) | always |
| `input_number.energy_plan_battery_safety_kwh`, `energy_plan_battery_hysteresis_kwh` | kWh | thresholds of battery behind (defaults 0.5 and 0.5) | with a battery |
| macro `watts(entity_id)` in `custom_templates/energy_plan.jinja` | W | a power role in W, read with its unit (W or kW) | always |

`sensor.energy_plan_margin` is always a number while it is available. After the sun end it is minus what the battery still lacks (0 without a battery); consumers ignore it while `after_sun` is true.

## Contracts between modules

| Reads | From | Why |
| ----- | ---- | --- |
| `sensor.ev_charger_power` (W) | a module that provides `ev-charger` (e.g. `charger-zappi`), optional | the car is left out of the house load of the plan, and `without_car` |

| Read by | What |
| ------- | ---- |
| `ev-charging` | surplus, margin (solar for the car today, `sun_end`), battery behind (the battery first) |
| `hot-water` | margin (room for the tank after the car), surplus |
| `appliances-home-connect` | margin and surplus (solar start window) |
| `charger-zappi` | battery behind (phase switching) |
| `energy`, `results`, `home-screen` | every entity above, for display |

## Fields in `house.yaml`

| Field | What |
| ----- | ---- |
| `house.lat`, `house.lon`, `house.timezone` | sunset of the day plan (3 decimals are plenty) |
| `entities.grid_import_w`, `grid_export_w` | power from and to the grid, W or kW, both positive |
| `entities.solar_power_w` | solar power; the meter closest to the panels (inverter, CT clamp) |
| `entities.house_power_w` (optional) | consumption of the house, the car included; empty = computed |
| `entities.battery_soc` (optional) | state of charge in %; empty = no battery: no battery behind, battery needed 0 |
| `entities.battery_power_w` | with a battery: its power; required unless `house_power_w` is set |
| `energy.battery_power_sign` | with `battery_power_w`: `charge_positive` or `discharge_positive` |
| `energy.battery_usable_kwh` | with a battery: usable capacity in kWh |
| `entities.solar_forecast_today`, `solar_forecast_remaining_today` (optional) | both or neither, in kWh |
| `entities.solar_forecast_updated` (optional) | timestamp of the last forecast refresh; empty = when the remaining forecast last changed |
| `energy_plan.sun_end_w` (optional) | below this solar power the sun counts as gone; default 150 W |
| `energy_plan.charge_efficiency` (optional) | of the battery while charging; default 0.95 |
| `energy_plan.history_days` (optional) | days of statistics to learn from; default 10 (the recorder's `purge_keep_days`) |

With more than one solar plane in Forecast.Solar: make a "Combine the state of several sensors" helper (sum) per forecast role and fill in that helper.

## Without a battery or forecast

| Missing | What still works | What changes |
| ------- | ---------------- | ------------ |
| battery (`battery_soc` empty) | everything except battery behind | battery needed is 0: the margin is solar left after the house; the two battery helpers are not created |
| solar forecast | everything | solar left comes from history only (`source: history`): it does not see today's clouds, so on a dark day after sunny days it is too high until the afternoon ratio catches up |
| `house_power_w` | everything | the house is computed from import, export, solar and battery |
| an `ev-charger` module | everything | the car counts as house load in the plan (the margin is lower on days the car charged), no `without_car` |
| SQLite recorder | export average, surplus, house power | no margin, no battery behind |

## What you do in the UI

Nothing is required. Tune the thresholds in Settings > Helpers ("Energy plan: ..."). Had you made your own helpers for the same thing (a threshold helper "surplus" on a statistics or filter helper "export average"), switch the automations that read them to `binary_sensor.energy_plan_surplus` and delete them afterwards.

## Install

```bash
uv run --with-requirements requirements.txt python energy-plan/deploy.py --dry-run
uv run --with-requirements requirements.txt python energy-plan/deploy.py
```

`deploy.py` uploads `packages/energy_plan.yaml` (helpers and the export average), `templates/energy_plan.yaml`, `custom_templates/energy_plan.jinja`, `command_line/energy_plan.yaml` and `/config/energy-plan/energy_plan.py`; checks the configuration; reloads `input_number`, the custom templates, `template`, `statistics` and `command_line`; sets the defaults of new helpers once; lists the power roles the recorder keeps no statistics for; and shows the first value of `sensor.energy_plan_margin`. There are no automations and no scripts.

After a change in `house.yaml` or a kit update: fill in again and run `energy-plan/deploy.py`. The thresholds you tuned stay.

## Troubleshooting

- `sensor.energy_plan_margin` is unavailable: Home Assistant shows no attributes on an unavailable sensor, so the reason is not visible there. Open the Terminal app, copy the command from `/config/command_line/energy_plan.yaml` with the templates replaced by numbers (Developer tools > Template renders it), and run it: the JSON says why (`not enough history`, `cannot read the recorder database`, `no statistics for …`, `battery state of charge is not a number`).
- `error` starts with `warning:` while there is a value: the battery or charger statistics are missing; the plan is less exact, not wrong in the dangerous direction.
- The margin jumps every hour: fill in `entities.solar_forecast_updated` with the forecast's own "last update" sensor if it has one.

## Test plan

See `LOGIC.md`, "Test plan".

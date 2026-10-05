<!-- <% from '_ev_charging.jinja' import plan_cars, amps_cars, limit_cars, has_tariff, has_gate, own_counter, battery with context %> -->
# <@ module.name @>

<@ module.description @>.

This is a **core** module: it works with any charger adapter that provides the capability `ev-charger` (today `charger-zappi`) and needs `energy-plan` for the surplus signals. The tariff module (`tariff-be`) is optional: it adds cheap power, prices for the charge plan and the month-peak guard. Teslemetry is optional per car: with it the kit sets the car's charge current and charge limit.

One rule holds everything together: **one writer per actuator**. Only `automation.ev_charging_apply` calls `script.ev_charger_set_mode`; `input_select.ev_charging_owner` says who owns the charger now (`none`, `surplus`, `cheap`, `plan`, `manual`). Only `automation.ev_charging_car_amps` writes the car current, only `automation.ev_plan_<car>_limit` the car's charge limit. The decision itself is one template sensor, `sensor.ev_charging_wanted`.

How every decision is made is in [LOGIC.md](LOGIC.md), with the full decision table and the test plan.

## Requirements

| What                                                         | Why                                                                     | Note                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Modules **base** and **energy-plan**                         | `packages/`, `templates/`; surplus, day plan, battery behind            | Deploy them first                                                        |
| A module that provides **ev-charger** (e.g. `charger-zappi`) | `script.ev_charger_set_mode`, `sensor.ev_charger_*`                     | Deploy it first                                                          |
| Home Assistant 2025.4 or newer                               | `default_entity_id`, trigger-based template entities with an action     | `automation: !include automations.yaml` (HA default)                     |
| HA OS or Supervised + the **File editor** app                | `deploy.py` uploads through the File editor                             | Without it: copy the files yourself, see `deploy.py --dry-run`           |
| A module that provides **tariff** (optional, e.g. `tariff-be`) | cheap assist, prices for the plan, month-peak guard                   | Without it: no cheap power, the plan takes the earliest quarters         |
| **Teslemetry** (optional)                                    | the car on the charger, its battery and limit; car current and limit    | Roles in `teslemetry:` / `cars[].entities`                               |
| **Waze Travel Time** (optional)                              | distances of calendar appointments                                      | Add it once (any destination); no API key                                |
| A **calendar** per car (optional)                            | departure and target from appointments with a location                  | Google Calendar, Local Calendar, CalDAV, ...                             |
| Module **notifications** (optional)                          | `script.send_notification`                                              | Without it: logbook only                                                 |
| Module **gate** (optional)                                   | owns `counter.tesla_commands_today`                                     | Without gate this module defines the counter itself                      |

## Fields in `house.yaml`

| Field                                   | What                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cars[]`                                | any number of cars; a plugged-in car that is not listed counts as `other` (solar only)                 |
| `cars[].battery_kwh`                    | usable battery; required for a plan; else 75 for the energy a car still needs                          |
| `cars[].consumption_kwh_100km`          | for calendar trips; default 18                                                                         |
| `cars[].charge_plan`                    | `true` = charge plan to a departure time for this car (helpers per car)                                |
| `cars[].plan_calendar`                  | calendar whose appointments with a location set the target (optional)                                  |
| `teslemetry.battery`, `charge_cable`, `charging_state` | required for every car (or `cars[].entities`)                                           |
| `teslemetry.located_at_home`            | optional: a car charging elsewhere is not on this charger                                             |
| `teslemetry.charge_current`             | optional: the kit sets the car current (each command counts)                                           |
| `teslemetry.charge_limit`               | optional: the plan raises the limit to the target and puts it back                                     |
| `teslemetry.charger_power`, `status`    | optional: the car's own charge power (kW); online state for restoring the limit                        |
| `ev_charging.voltage`, `phases`, `max_power_kw`, `house_reserve_kw`, `efficiency` | the charger connection; defaults 230 V, 3, 11 kW, 1.0 kW, 0.9 |
| `ev_charging.waze_region`               | Waze region of the calendar trips: eu, us, na, il, au; default eu                                      |
| `entities.grid_import_w`, `grid_export_w`, `solar_power_w` | grid and solar power (W or kW)                                                      |
| `entities.battery_soc`, `battery_power_w`, `energy.battery_power_sign`, `energy.battery_usable_kwh` | home battery (optional): battery first      |
| `entities.solar_forecast_today`, `solar_forecast_tomorrow` | optional: the sun of the next day in the plan                                       |
| `tariff.compare.export`                 | optional (c€/kWh): value of own solar used later, for "never pay to export"; default 0                 |

## What you get

| Entity                                         | Meaning                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `sensor.ev_charging_car`                       | prefix of the car on the charger, `other` or `none`; attributes `name`, `battery`, `limit`, `charging_state`, `plugged_in` |
| `sensor.ev_charging_available_power`, `_avg`   | W for the car without grid and battery; 10-minute mean                                          |
| `binary_sensor.ev_charging_battery_feeds_car`  | the home battery feeds the car too much (latch; always off without a battery)                    |
| `sensor.ev_charging_energy_needed`             | kWh the car on the charger still needs to its limit                                             |
| `sensor.ev_charging_wanted`                    | the arbiter: mode; attributes `owner`, `reason`, `solar_share`, `amps`, `car`, `plan`           |
| `sensor.ev_charging_status`                    | one reason for the screens: `off`, `no_car`, `manual`, `plan`, `peak_limited`, `grid_assist`, `car_full`, `paused_battery`, `battery_behind`, `solar`, `waiting_surplus`, `charger_fault`, `unknown` |
| `input_select.ev_charging_owner`               | who owns the charger                                                                            |
| `sensor.ev_charging_cheap_status`, `binary_sensor.ev_charging_cheap_assist`, `binary_sensor.ev_charging_peak_risk` | cheap power and month-peak guard (with a tariff module) |
| `sensor.ev_plan_<car>`                         | the charge plan per plan car (states and attributes in LOGIC.md)                                |
| helpers                                        | see LOGIC.md, "Settings"                                                                        |
| automations                                    | `ev_charging_apply`, `ev_charging_car_amps`, `ev_plan_<car>_limit`, `ev_plan_target_reset`, `ev_charging_notify`, `ev_charging_tesla_counter_reset` (without gate) |
| script                                         | `script.ev_charging_manual_mode` (fields `mode`, `solar_share`, `reason`): a mode chosen by hand on a screen; owner `manual` until the car is unplugged |
| notifications                                  | `ev_charging_notify` (with `notifications`): cheap window start and end (daytime, only with cheap power on), plan not feasible, 21:00 the evening before a departure. The cheap-window notification lives here, not in `notifications` |
| macros                                         | `custom_templates/ev_charging.jinja`: `plan()`, `calendar_target()`                             |
| view                                           | `lovelace/smart-charging-view.yaml`: a "Smart charging" view with core cards (paste it yourself) |

In this house.yaml:
<% if has_tariff %>
- cheap power and the month-peak guard are **on** (a tariff module is installed);
<% else %>
- cheap power and the month-peak guard are **off** (no tariff module); the plan takes the earliest quarters;
<% endif %>
<% if plan_cars %>
- charge plan for: <@ plan_cars | map(attribute='name') | join(', ') @>;
<% else %>
- no car has a charge plan (`cars[].charge_plan: true` with `battery_kwh`);
<% endif %>
<% if amps_cars %>
- car current control for: <@ amps_cars | map(attribute='name') | join(', ') @>;
<% else %>
- no car current control (no `charge_current` role);
<% endif %>
<% if own_counter %>
- `counter.tesla_commands_today` is defined by this module (gate is not installed);
<% elif has_gate %>
- `counter.tesla_commands_today` comes from gate;
<% else %>
- no car commands, so no command counter;
<% endif %>
<% if battery %>
- the home battery goes first (latch and cheap-power conditions).
<% else %>
- there is no home battery: the latch is always off.
<% endif %>

## What you do in the UI

- **Settings > Devices & services**: Teslemetry (cars), optionally Waze Travel Time (any destination, it is only needed for the action) and the calendar of each plan car.
- **Settings > Entities**: enable the Teslemetry entities the module reads when they are disabled (e.g. charger power).
- **A dashboard**: paste `lovelace/smart-charging-view.yaml` as a view (Raw configuration editor), or use the energy and home screens.
- **A charge plan**: set the target and the departure of the car, or put appointments with a location in its calendar. A distance in the title or description (`(45 km)`, one way) wins over Waze. All-day appointments do not count.
- **Taking over by hand**: change the mode on the charger (its app or entity), or press a mode on the energy screen (it calls `script.ev_charging_manual_mode`; use that script for your own buttons too, never `script.ev_charger_set_mode` directly). The kit sets the owner to `manual` and leaves the charger alone until the car is unplugged. To hand it back earlier, set `input_select.ev_charging_owner` to `none`.

## Install

1. Deploy `base`, `energy-plan`, the charger adapter and (optional) the tariff module first.
2. Fill in `house.yaml` (fields above) and run `tools/fill.py`. From then on, work in `build/`.
3. Look first, then deploy:

```bash
uv run --with-requirements requirements.txt python ev-charging/deploy.py --dry-run
uv run --with-requirements requirements.txt python ev-charging/deploy.py
```

4. Follow the test plan in `LOGIC.md`. `deploy.py` names the entities it reads that do not exist yet.

After a change in `house.yaml` or a kit update: fill in again and run `deploy.py` again. Existing helper values stay; automations of a car that lost its plan are removed.

## Migrating from a hand-made setup

The module replaces four automations that each wrote the charger mode (smart charging, cheap power, charge plan, car current) and their text markers and pause flag. Turn the old automations off before the first deploy: two writers fight over the charger. What becomes what:

| Before                                                       | Now                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| text markers "previous mode" of cheap power and charge plan, pause flag of smart charging | `input_select.ev_charging_owner`                  |
| "available for the car" template + statistics helper          | `sensor.ev_charging_available_power` + `_avg`                          |
| "battery feeds the car too much" template                     | `binary_sensor.ev_charging_battery_feeds_car` (latch)                  |
| cheap-power mode, headroom and status templates               | `binary_sensor.power_price_cheap`, `sensor.capacity_headroom_kw` (tariff module), `sensor.ev_charging_cheap_status` |
| charge plan template and macros per car                       | `sensor.ev_plan_<car>`, `custom_templates/ev_charging.jinja`           |
| helper with the calendar entity of the plan                   | `cars[].plan_calendar` in `house.yaml`                                 |
| per-car consumption and battery helpers                       | `cars[].consumption_kwh_100km`, `battery_kwh`                          |

## Tests done

Filled in with en and nl; with and without a tariff module, with and without gate, notifications and a home battery; 0, 1 and 3 cars (with and without calendars, with and without car current and limit roles); every template compiled and every `deploy.py --dry-run` ran. The decision chain (car, available power, latch, cheap status, arbiter, status, apply, car current) was executed on the rendered templates with mocked states in 47 situations, including the conflicts manual vs plan, plan vs cheap, cheap vs peak and smart off vs manual; the plan and calendar macros and the plan sensor in 22 more. Status: **built, not tested on HA**.

## Test plan

See `LOGIC.md`, "Test plan".

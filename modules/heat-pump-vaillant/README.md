<% from '_heat_pump_vaillant.jinja' import system, zones, band_zones, water_heater, hot_water_boost, tank_temperature, energy_manager, water_pressure, fault, power_w, cop_heat with context %>
# <@ module.name @>

<@ module.description @>.

A **brand adapter**: it turns the myVAILLANT entities of a Vaillant flexoTHERM or aroTHERM into the kit's two heat-pump capabilities, `heat-pump` (floor band, quick veto, state, estimated power, status rows) and `hot-water-heater` (tank temperature, heat, back to normal, COP). It decides nothing itself: the module `climate` chooses the floor band, the module `hot-water` decides when the tank heats. Those core modules only see the ids below, so another brand can replace this module without touching them.

How every step works is in [LOGIC.md](LOGIC.md), with the test plan.

**Status: <@ module.status @>.** The scripts were run against mocked states (floor band, quick veto, heat, normal, write limit, one and two zones), not yet against a real heat pump.

- Layer: brand adapter
- Depends on: -
- Provides (capability): `heat-pump`, `hot-water-heater`

## Requirements

| What                                                                 | Why                                                                                  | Note                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Module **base**                                                      | `packages/`, `templates/` in `configuration.yaml`                                    | First `base/deploy.py`                                                                     |
| Home Assistant 2025.4 or newer                                       | `trigger:`/`action:` syntax, `default_entity_id`                                     | `automation: !include automations.yaml` and `script: !include scripts.yaml` (HA's default) |
| HA OS or Supervised + the **File editor** app                        | `deploy.py` uploads through the File editor                                          | Without it: copy the two files yourself, see `deploy.py --dry-run`                         |
| **myVAILLANT** (`mypyllant`) from **HACS**                           | zone climate entities, water heater, boost switch, the `mypyllant.*` actions         | Cloud integration with a limited number of commands; see "The cloud quota"                 |
| Vaillant flexoTHERM / aroTHERM with a sensoNET or VR921 gateway      | the myVAILLANT app must show the system                                              | Also works for the branded apps of the same API (MiGo Link: Saunier Duval, Bulex), untested |
| Cooling (**optional**)                                               | `heat_pump.cooling: true`: the floor may cool                                         | Only when your installation supports active cooling                                       |
| Daily energy sensors of the heat-pump device (**optional**)          | `sensor.hot_water_cop` measured instead of the default `hot_water.cop`              | Some systems only report them with a delay or not at all                                   |

Install **myVAILLANT** through HACS (search "myVAILLANT", repository `signalkraft/mypyllant-component`), restart Home Assistant and add the integration with your myVAILLANT login. Keep its update interval at the default: every refresh is a cloud call.

## Privacy

The heat pump is read and set through the myVAILLANT cloud via the Home Assistant integration (temperatures, setpoints, state). Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

| Field                                                  | What                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `heat_pump.system`                                     | the system name as it is in the entity ids (`water_heater.<system>_domestic_hot_water_0`)                      |
| `heat_pump.zones[]`                                    | one item per zone, any number: `name` (in the entity ids), `circuit` (default 0), `key`, `cooling`, `band`, `climate` |
| `heat_pump.zone`                                       | older single-zone form; read only when `zones` is missing                                                    |
| `heat_pump.cooling` (optional)                         | the floor may cool; default false; per zone `zones[].cooling` overrides it                                    |
| `heat_pump.power_estimate_w` (optional)                | estimated power per state in W: `hot_water`, `heating`, `cooling`, `idle`                                    |
| `heat_pump.hot_water_modes` (optional)                 | names of the water heater modes `normal` and `heat` when yours are not Auto/Time Controlled and Day/Manual     |
| `heat_pump.hot_water_heat_kwh`, `hot_water_electric_kwh` (optional) | daily heat into the tank and electrical energy for hot water (both or neither): measured COP          |
| `entities.heat_pump` (optional)                        | climate entity of the first zone when it is not called as derived                                           |
| `entities.water_heater` (optional)                     | the water heater when it is not called as derived; the boost switch is `switch.<its name>_boost`            |
| `hot_water.cop` (optional)                             | COP when there is no measurement; default 2.8                                                                |

Example in `house.example.yaml` (section `heat_pump:`). Find the names: Settings > Entities, search `zone_` and `domestic_hot_water`.

The entities this module reads and writes in your house (derived when you filled in):

```text
system <@ system @>
<% for z in zones %>
zone <@ z.key @>: <@ z.climate @> (circuit <@ z.circuit @>, cooling <@ 'yes' if z.cooling else 'no' @>, band <@ 'yes' if z.band else 'no' @>)
<% endfor %>
water heater: <@ water_heater @>, boost <@ hot_water_boost @>, tank <@ tank_temperature @>
state: <@ energy_manager @>; pressure <@ water_pressure @>; fault <@ fault @>
estimated power (W): <@ power_w | dictsort | map('join', ' ') | join(', ') @>
COP of hot water: <@ 'measured from ' ~ cop_heat if cop_heat else 'default (hot_water.cop)' @>
```

## What it provides

The contract (docs/phase4-contracts.md, section 3). Core modules read only these.

| Entity                              | Capability       | What                                                                                                                       |
| ----------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `script.heat_pump_set_floor_band`   | heat-pump        | fields `low`, `high` (°C, each optional), `reason`, `zone` (optional key; empty = every zone with `band`). Writes only what differs |
| `script.heat_pump_quick_veto`       | heat-pump        | fields `temperature`, `hours` (0 = cancel; default 3), `reason`, `zone`                                                     |
| `sensor.heat_pump_state`            | heat-pump        | `idle`, `hot_water`, `heating`, `cooling`, `unknown`; attributes `brand_state`, `zones` (key -> climate), `main_zone`, `water_heater` |
| `sensor.heat_pump_power_estimated`  | heat-pump        | W, from the state and `heat_pump.power_estimate_w`; unavailable while the state is unknown                                  |
| `sensor.heat_pump_flow_temperature` | heat-pump        | °C of the first zone's circuit; attribute `circuits`                                                                       |
| `sensor.heat_pump_water_pressure`   | heat-pump        | bar                                                                                                                         |
| `binary_sensor.heat_pump_fault`     | heat-pump        | on = trouble codes                                                                                                         |
| zone climate entities               | heat-pump        | `entities.heat_pump` / derived; read by `climate` and the screens, written only through the scripts                        |
| `script.hot_water_heat`             | hot-water-heater | fields `target`, `boost`, `reason`: without boost hold the target all day (mode Day), with boost one charge now           |
| `script.hot_water_normal`           | hot-water-heater | fields `target`, `reason`: boost off, back to the automatic mode (time program) at the target                              |
| `sensor.hot_water_temperature`      | hot-water-heater | °C in the tank; attributes `target`, `mode` (`normal`, `heat`, `off`, `other`), `boost`, `min_temp`, `max_temp`            |
| `binary_sensor.hot_water_heating`   | hot-water-heater | on while the heat pump heats the tank; attribute `boost`                                                                   |
| `sensor.hot_water_cop`              | hot-water-heater | COP of hot water today (1.5-4.5) or the default; attribute `source` (`measured`, `default`)                                |

Own helpers (not part of the contract): `counter.heat_pump_vaillant_writes_today`, `input_number.heat_pump_vaillant_max_writes_per_day` (default <@ module.defaults['input_number.heat_pump_vaillant_max_writes_per_day'] @>), `automation.heat_pump_vaillant_writes_reset`, the internal `script.heat_pump_vaillant_hot_water_write`.

## The cloud quota

myVAILLANT is a cloud API with a limit on commands; too many calls block the account for a while. The adapter:

- writes a value only when it differs from what the heat pump already has (setpoint, mode, boost, every slot of the time program);
- counts every write in `counter.heat_pump_vaillant_writes_today` and stops at `input_number.heat_pump_vaillant_max_writes_per_day` (a safety net against a runaway caller, not the real limit). `script.hot_water_normal` may always write, so the tank never stays stuck on a high target;
- waits 5 s between two writes in one call.

## Install

1. Install myVAILLANT (above) and check the entity names (Settings > Entities).
2. Fill in `heat_pump:` in `house.yaml` and run `tools/fill.py`. From then on, work in `build/`.
3. `heat-pump-vaillant/deploy.py --dry-run` (look), then `heat-pump-vaillant/deploy.py`. It stops when a derived entity does not exist and names the optional ones it did not find.
4. Follow the test plan in [LOGIC.md](LOGIC.md). Only then install `climate` and `hot-water`, which call the scripts.

After a change in `house.yaml` or a kit update: fill in again and run `deploy.py` again. Your write limit stays as you set it.

## Writing an adapter for another heat pump

A second brand is a new module `heat-pump-<brand>` with `provides: [heat-pump, hot-water-heater]` (or only one of them: a heat pump without a tank provides `heat-pump`, a separate boiler provides `hot-water-heater`). Keep this module out of `modules:`; `fill.py` refuses two providers of the same capability. Copy this module as a start and replace the brand part. What the core modules need, exactly:

**heat-pump** (read by `climate`, `energy`, `home-screen`):

1. `script.heat_pump_set_floor_band` with fields `low` and `high` (°C, each optional: empty = leave that side alone), `reason` (text for the logbook) and the optional `zone`. Meaning: heat below `low`, cool above `high` (when the system can cool). Write only values that differ; never through a call that the brand turns into a temporary override. Do not wait for the cloud to follow.
2. `sensor.heat_pump_state` with exactly the states `idle`, `hot_water`, `heating`, `cooling`, `unknown`, and the attributes `zones` (mapping key -> climate entity), `main_zone` (the climate entity of the main zone) and `brand_state` (raw value).
3. `sensor.heat_pump_power_estimated` in W (a measurement when the brand has one; `unit_of_measurement: W`, `device_class: power`).
4. Optional, hidden when missing: `script.heat_pump_quick_veto` (`temperature`, `hours`, `reason`, `zone`), `sensor.heat_pump_flow_temperature` (°C), `sensor.heat_pump_water_pressure` (bar), `binary_sensor.heat_pump_fault` (on = fault).
5. The zone climate entity in `entities.heat_pump` (or derived and published in `sensor.heat_pump_state` `main_zone`). Cores read it, never write it.

**hot-water-heater** (read by `hot-water`, `energy`, `results`, `home-screen`):

1. `script.hot_water_heat` with `target` (°C), `boost` (bool) and `reason`: without boost the tank is kept at the target from now on, outside the brand's schedule, until `hot_water_normal`; with boost the tank heats once, right now (a brand without a boost: treat boost like no boost).
2. `script.hot_water_normal` with `target` and `reason`: back to the brand's automatic mode at the target; ends a boost. Must always work (no limit may block it).
3. `sensor.hot_water_temperature` in °C, with the attributes `target` and `mode` (`normal`, `heat`, `off`, `other`) and `boost`.
4. Optional: `binary_sensor.hot_water_heating` (on while the tank heats), `sensor.hot_water_cop` (COP of hot water today; else the core uses `hot_water.cop`).

Fixed values are English; names users see go through `strings.yaml`. Only `climate` calls the floor scripts and only `hot-water` the hot-water scripts: your adapter must not decide anything itself.

## Test plan

See [LOGIC.md](LOGIC.md), "Test plan".

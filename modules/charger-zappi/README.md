<!-- <% from '_zappi.jinja' import phase_switching with context %> -->
# <@ module.name @>

<@ module.description @>.

This module is a **brand adapter**: it provides the capability `ev-charger` for the myenergi Zappi. It turns the Zappi's own entities (whose ids contain its serial number) into the normalised `sensor.ev_charger_*` entities and one script, `script.ev_charger_set_mode`. The smart logic (when to charge, from the sun, the cheap window or a charge plan) lives in the core module `ev-charging`; this adapter never decides when to charge, it only translates. The only thing it decides itself is Zappi-specific: 1 or 3 phases on solar surplus (with `ev-charging` installed).

How every decision is made is in [LOGIC.md](LOGIC.md). The test plan is there too.

## Requirements

| What                                                               | Why                                                                   | Note                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Module **base**                                                    | `packages/`, `templates/` in `configuration.yaml`                     | First `base/deploy.py`                                                                    |
| Home Assistant 2025.4 or newer (as gate)                           | `default_entity_id`, trigger-based binary sensor with `delay_on`      | `automation: !include automations.yaml` and `script: !include scripts.yaml` (HA default) |
| HA OS or Supervised + the **File editor** app                      | `deploy.py` uploads through the File editor                           | Without it: copy the two files yourself, see `deploy.py --dry-run`                        |
| Custom integration **myenergi** ([CJNE/ha-myenergi](https://github.com/CJNE/ha-myenergi)) through **HACS** | charge mode, Minimum Green Level, phase setting, status, power, energy | There is no core integration. Cloud polling (myenergi API); see "The myenergi integration" |
| myenergi **Zappi** (v2)                                            | the charger                                                           | Phase switching: a Zappi on a 3-phase connection with the phase setting (1, 3, auto)     |
| Module **ev-charging** (optional)                                  | the only caller of the script; its available-power average            | Without it: the sensors and the script work, no phase switching                           |
| Module **energy-plan** with a battery (optional)                   | `binary_sensor.energy_plan_battery_behind`                            | Without it: the phase switching ignores "battery behind"                                  |

### The myenergi integration

- Install **myenergi** from HACS (custom integration `CJNE/ha-myenergi`), restart, add it under Settings > Devices & services with the hub serial number and the API key from the myenergi app. It polls the myenergi cloud (`scan_interval`; 30 s works well). A command (charge mode, Minimum Green Level, phase setting) shows up after the next poll: that is why `script.ev_charger_set_mode` waits up to 60 s.
- **Restart Home Assistant after every change of the integration's options.** The integration cannot reload itself: it ends in `failed_unload` and every Zappi entity becomes `unavailable` until a restart.
- The entity ids are `<domain>.<prefix>_<name>`, with a prefix like `myenergi_zappi_<serial>` (the device name; it changes when you rename the Zappi in the myenergi app). The serial number is personal data: it only goes in your own `house.yaml`, never in the kit.

## Fields in `house.yaml`

Either the prefix (one line), or every role written out. A role that is filled in wins over the prefix.

| Field                                    | What                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `charger_zappi.prefix`                   | the myenergi prefix without domain, e.g. `myenergi_zappi_0000000`; derives every role below      |
| `entities.charger_status`                | `sensor.<prefix>_status` (required without prefix)                                               |
| `entities.charger_mode`                  | `select.<prefix>_charge_mode`: Fast, Eco, Eco+, Stopped (required without prefix)                |
| `entities.charger_plug`                  | `sensor.<prefix>_plug_status` (required without prefix)                                          |
| `entities.charger_power_w`               | `sensor.<prefix>_power_ct_internal_load`, power to the car (required without prefix)             |
| `entities.charger_min_green`             | `number.<prefix>_minimum_green_level` (required without prefix)                                  |
| `entities.charger_phase`                 | `select.<prefix>_phase_setting`: 1, 3, auto (optional; empty and no prefix = no phase switching) |
| `entities.charger_energy_today`          | `sensor.<prefix>_energy_used_today` (optional; empty = estimated from the power)                 |
| `entities.charger_solar_energy_today`    | `sensor.<prefix>_green_energy_today` (optional; read by results)                                 |
| `ev_charging.phases`                     | phases of the charger connection, 1 or 3 (default 3); phase switching only with 3               |
| `entities.battery_power_w`, `energy.battery_power_sign` | home battery power (optional): the phase switching stays on 1 phase while it discharges |

## What you get

| Entity                                         | Meaning                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `script.ev_charger_set_mode`                   | fields `mode`, `solar_share`, `reason`; called only by `ev-charging`                  |
| `sensor.ev_charger_mode`                       | `solar_only`, `solar_min`, `fast`, `stop`, `unknown`; attributes `brand_mode`, `solar_share` |
| `sensor.ev_charger_status`                     | `disconnected`, `connected`, `charging`, `waiting`, `complete`, `fault`               |
| `binary_sensor.ev_charger_connected`           | a car is plugged in                                                                   |
| `sensor.ev_charger_power`                      | W to the car                                                                          |
| `sensor.ev_charger_energy_today`               | kWh today                                                                             |
| `sensor.ev_charger_solar_energy_today`         | kWh of surplus today (only with that role)                                            |
| `sensor.ev_charger_phases`                     | `1` or `3`; unknown while the Zappi chooses itself (auto, not in Fast)               |
| `input_boolean.charger_zappi_phase_auto`       | phase switching on/off (with phase switching)                                         |
| `input_number.charger_zappi_three_phase_from_w`, `charger_zappi_one_phase_below_w` | the two thresholds (with phase switching)     |
| `binary_sensor.charger_zappi_three_phase_wanted` | adapter-internal: room for 3 phases (with phase switching)                          |
| `automation.charger_zappi_phases`              | the phase switching (with phase switching)                                            |

Mode mapping: `solar_only` = **Eco+** (only surplus; the Zappi pauses without), `solar_min` = **Eco** (surplus, topped up from the grid to the minimum charge power), `fast` = **Fast**, `stop` = **Stopped**. `solar_share` (0-100) = **Minimum Green Level**: the share of the charge power that must be surplus before the Zappi starts in Eco+.

## Install

1. Install the myenergi integration (above) and check that the Zappi entities have values.
2. Fill in `house.yaml` (fields above) and run `tools/fill.py`. From then on, work in `build/`.
3. Look first, then deploy:

```bash
uv run --with-requirements requirements.txt python charger-zappi/deploy.py --dry-run
uv run --with-requirements requirements.txt python charger-zappi/deploy.py
```

4. Follow the test plan in `LOGIC.md`. Deploy `ev-charging` afterwards; until then nobody calls the script.

After a change in `house.yaml` or a kit update: fill in again and run `deploy.py` again. Existing helper values stay.

<% if phase_switching %>
In this house.yaml phase switching is **on** (ev-charging installed, a phase select, a 3-phase connection).
<% else %>
In this house.yaml phase switching is **off**: it needs ev-charging in `modules:`, a phase select and `ev_charging.phases: 3`.
<% endif %>

## Writing an adapter for another charger

This module is the template for the capability `ev-charger` (contract: `docs/phase4-contracts.md`, "ev-charger"). Another brand is a new module `charger-<brand>` that provides exactly the same ids, so `ev-charging`, `energy-plan`, `energy`, `results` and `home-screen` work without a change. What the capability needs:

1. **`module.yaml`**: `provides: [ev-charger]`, `depends_on: []`, the same `ask:` question (`id: ev_charger`, add your brand to `options`, `need:` your brand). Only one module per house may provide `ev-charger`.
2. **`script.ev_charger_set_mode`** with the fields:
   - `mode` (required): `solar_only` (only surplus; pause without), `solar_min` (surplus with a minimum from the grid), `fast` (full power), `stop` (no charging). Map each to the closest mode of your charger; a charger without a solar mode needs its own surplus loop inside the adapter (a current setpoint following `sensor.ev_charging_available_power`), which is still translation, not a decision about when to charge.
   - `solar_share` (optional, 0-100): share of the charge power that must be surplus. Ignore it when your charger has nothing like it.
   - `reason` (optional): for the logbook.
   - It writes only on a difference, waits up to 60 s until `sensor.ev_charger_mode` follows (cloud lag), then returns anyway; it never raises an error to the caller (log instead).
3. **Sensors** (template sensors in `templates/<module>.yaml`, fixed English states, `unique_id` and `default_entity_id` as below):
   - `sensor.ev_charger_mode`: `solar_only`, `solar_min`, `fast`, `stop` or `unknown`; attribute `brand_mode` (the charger's own value).
   - `sensor.ev_charger_status`: `disconnected`, `connected`, `charging`, `waiting` (plugged in, held back by mode or surplus), `complete`, `fault`.
   - `binary_sensor.ev_charger_connected` (device class `plug`).
   - `sensor.ev_charger_power`: W (`device_class: power`; convert kW).
   - `sensor.ev_charger_energy_today`: kWh, `state_class: total_increasing`, back to 0 every day (estimate it from the power when the charger has no daily counter, as this module does).
   - Optional: `sensor.ev_charger_solar_energy_today` (kWh of surplus, read by `results`) and `sensor.ev_charger_phases` (`1` or `3`).
4. **Single writer.** Only `ev-charging` calls the script. Your adapter never changes the mode or the charge current on its own, and nothing outside your module reads the brand entities. Brand-specific tuning (like the phase switching here) stays inside the adapter, may read `ev-charging`/`energy-plan` entities, must never change the mode, and has its own helpers with your module's prefix and defaults in `module.yaml`.
5. **Roles, not ids**: every brand entity comes from `house.yaml` (`entities.charger_*`, documented in `house.example.yaml`; serial numbers stay in the user's own file).
6. The usual module files: `strings.yaml` (en + nl), `LOGIC.md`, `deploy.py` with `--dry-run`, and `tools/check.py` passing.

## Test plan

See `LOGIC.md`, "Test plan".

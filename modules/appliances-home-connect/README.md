# <@ module.name @>

<@ module.description @>.

**Status: built, not tested on HA.** One module for the Home Connect appliances of the house (any number of dishwashers, washing machines and dryers): it plans the start of the program you selected on the appliance (sun or a full home battery first, then the ready-by time, then the price), starts it from a notification button, and reports a door left open, a finished program (with reminders while the door stays closed), errors and maintenance (salt, rinse aid, machine care, i-Dos).

How every decision is made, the start-time optimizer and the test plan are in [LOGIC.md](LOGIC.md).

## Requirements

| What | Why | Note |
| ---- | --- | ---- |
| Module **base** | `packages/` in `configuration.yaml` | Run `base/deploy.py` first |
| Module **notifications** | every notification goes through `script.send_notification` (field `only_home`) | Hard dependency |
| Home Assistant **2026.4** or newer | action `home_connect.start_selected_program` (start the program selected on the appliance, with `start in` or `finish in`) | Checked against the HA 2026.9 documentation |
| **Home Connect** core integration | status, door, program, remote start, stop button, maintenance events | Cloud; needs a Home Connect developer app (below) |
| Appliance with **remote start** | Home Connect only starts an appliance whose "Remote start" is on | Many washing machines need it switched on at the appliance for every load (`smart_start: ask`) |
| Companion app | notification buttons Smart start and Start now | iPhone or Android |
| HA OS or Supervised + the **File editor** app | `deploy.py` uploads the package and the macro | Without it: copy the files yourself, see `deploy.py --dry-run` |
| `energy-plan` (optional) | wait for solar surplus or a full battery | Without it: no solar start |
| A **tariff** module, e.g. `tariff-be` (optional) | cheapest quarter before the deadline | Without it: as late as possible before the deadline |
| `presence` (optional) | ready by the learned arrival per weekday | Without it: "auto" is a fixed time (`auto_time`) |

## Contract

Fixed ids (see `docs/phase4-contracts.md`); `<key>` is `appliances[].key`. States and options are English values; names follow `house.language`.

| Entity | What | Exists |
| ------ | ---- | ------ |
| `input_boolean.appliance_<key>_smart_waiting` | on = a smart start waits for sun or a full battery | always |
| `input_datetime.appliance_<key>_smart_start` | the planned start; while waiting: the safety net | always |
| `input_select.appliance_<key>_ready_by` | `auto` (learned arrival, or `auto_time`) or `06:00` … `22:00` | always |
| `input_number.appliance_<key>_duration_h` | program duration the plan uses (h) | always |
| `input_number.appliances_battery_minimum` | start on the battery above this level (%) while the panels give ≥ 1 kW | with energy-plan and a battery |
| `input_number.appliances_solar_minimum_kwh` | wait for sun only when at least this much is expected (kWh) | with energy-plan |
| `input_datetime.appliances_solar_peak` | the sunniest moment: the safety net of a plan that waits for sun | with energy-plan |
| `script.appliance_smart_start` | field `appliance`: plan the selected program | always |
| `script.appliance_start_now` | fields `appliance`, `start_in` (s, 0 = now), `reason`: the only caller of Home Connect | always |
| `script.appliance_notify` | internal: notification to who is home (nobody home = everyone) | always |
| notification actions | `APPLIANCE_SMART_{KEY}`, `APPLIANCE_NOW_{KEY}` (key in upper case) | always |
| macro `start_window()` | `custom_templates/appliances.jinja`: the brand-free start-time optimizer (LOGIC.md) | always |

The Home Connect device is found with `device_id()` from the program select of the appliance: no device ids, model numbers or serials in any file.

## Contracts between modules

| Reads | From | Why |
| ----- | ---- | --- |
| `script.send_notification` (`title`, `message`, `extra`, `only_home`) and the macro `at_home()` | `notifications` | notifications to who is home |
| `binary_sensor.energy_plan_surplus`, `binary_sensor.energy_plan_battery_behind`, `sensor.energy_plan_margin` (`after_sun`, `pv_remaining_kwh`), macro `watts()` | `energy-plan` (optional) | solar start |
| `sensor.power_price_import` (`starts`, `prices`) | a module that provides `tariff` (optional) | cheapest block |
| `input_datetime.arrival_<day>` | `presence` (optional) | ready by the arrival |

Nobody reads this module yet. The `home-screen` could show a chip per appliance later (open point in `docs/phase4-contracts.md`, section 8).

## Privacy

The appliances are read and started through the Home Connect cloud (BSH) via the Home Assistant integration: program, state and start commands pass through that cloud. Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

| Field | What |
| ----- | ---- |
| `appliances[]` | one item per appliance: `key`, `kind` (`dishwasher`, `washer`, `dryer`), `prefix` (required); `name`, `smart_start` (`auto`, `ask`), `duration_h`, `auto_time`, `delay_option` (`start`, `finish`), `entities`, `maintenance` (optional) |
| `home_connect.language` | `en` or `nl`: the language Home Assistant had when Home Connect was added (entity names); default `house.language` |
| `home_connect.entities` | a pattern per role for every appliance (`{p}` = prefix), wins over the built-in table |
| `entities.battery_soc`, `solar_power_w` | battery start (optional, with energy-plan) |
| `entities.solar_forecast_remaining_today`, `solar_forecast_tomorrow` | expected sun today and tomorrow (optional; without the first: `pv_remaining_kwh` of energy-plan; without the second: no sun window tomorrow) |

`smart_start: auto` plans by itself once the appliance is on, its door has been closed and remote start on for 2 minutes (a dishwasher with remote start always on). `smart_start: ask` sends a notification with the buttons when remote start is switched on (a washing machine that needs it for every load).

## Entity names

Home Connect names its entities after the device name (your `prefix`) and the entity name in the language Home Assistant had when you added the integration. Built-in patterns (`{p}` = prefix):

| Role | English (`home_connect.language: en`) | Dutch (`nl`) |
| ---- | -------------------------------------- | ------------ |
| status | `sensor.{p}_operation_state` | `sensor.{p}_status` |
| door | `sensor.{p}_door` | `sensor.{p}_deur` |
| selected_program | `select.{p}_selected_program` | `select.{p}_geselecteerd_programma` |
| active_program | `select.{p}_active_program` | `select.{p}_actieve_programma` |
| power | `switch.{p}_power` | `switch.{p}_inschakelen` |
| remote_start | `binary_sensor.{p}_remote_start` | `binary_sensor.{p}_start_op_afstand` |
| stop | `button.{p}_stop_program` | `button.{p}_stop_programma` |
| finish_time | `sensor.{p}_program_finish_time` | `sensor.{p}_programma_eindtijd` |
| progress | `sensor.{p}_program_progress` | `sensor.{p}_programma_voortgang` |
| program_aborted | `sensor.{p}_program_aborted` | `sensor.{p}_programma_afgebroken` |
| maintenance, dishwasher | `_salt_nearly_empty`, `_salt_lack`, `_rinse_aid_nearly_empty`, `_rinse_aid_lack`, `_machine_care_reminder` | `_zout_bijna_op`, `_salt_lack`, `_glansspoelmiddel_bijna_op`, `_rinse_aid_lack`, `_machine_care_reminder` |
| maintenance, washer | `_poor_i_dos_1_fill_level`, `_poor_i_dos_2_fill_level` | the same (no Dutch name yet) |

The English column follows the integration's entity names; the Dutch one was seen on a Dutch-language Home Assistant (some maintenance sensors had no Dutch name yet). Translations change: check Settings > Devices > your appliance. One entity with another name: `appliances[].entities.<role>`; every appliance: `home_connect.entities.<role>`. `deploy.py` names the entities it cannot find.

## Without energy-plan, a tariff or presence

| Missing | What happens |
| ------- | ------------ |
| `energy-plan` | no waiting for sun: the plan only uses the deadline (and the price) |
| tariff | no cheapest block: the program starts as late as possible and is done just in time |
| both | "ready by" only: start = deadline − duration (a washing machine that is done when you come home), plus all notifications |
| `presence` | `auto` = `appliances[].auto_time` (default 17:00) every day |
| a battery role | only surplus starts a waiting appliance, not "battery above the minimum" |

## What you do in the UI

1. **Home Connect developer app.** Make an account at the Home Connect developer portal (the same e-mail address as your Home Connect app account) and register an application: OAuth flow *Authorization Code Grant Flow*, redirect URI `https://my.home-assistant.io/redirect/oauth`. Keep the client id and client secret.
2. **Add the integration** (Settings > Devices & services > Add integration > Home Connect) and enter the client id and secret as application credentials, then log in with your Home Connect account and allow access.
3. **OAuth pitfalls** (they all end in `invalid_client: request rejected by client authorization authority (developer portal)`):
   - A *discovered* Home Connect item (found on the network) keeps the credentials chosen the first time you clicked it. After changing credentials, cancel that discovered flow and add the integration again through Add integration (or "Set up another instance"), so a fresh flow uses the new credentials.
   - Being logged in to the developer portal in the same browser can make the authorisation fail: log out first or use a private window.
   - When the client id is not accepted at all: register a **fresh** application in the developer portal (new id and secret), delete the old application credentials in Home Assistant (Settings > Devices & services > three dots > Application credentials) and add the integration again. A newly registered application can take a few minutes before it works.
   - Do the login in a normal browser window that stays open during the external step; an embedded browser that closes the Home Assistant page leaves the flow hanging.
4. **Enable the maintenance sensors**: the integration creates salt, rinse aid, machine care and i-Dos sensors disabled. Settings > Devices > your appliance > the disabled entities > Enable.
5. **Remote start**: switch it on at the appliance (Home Connect does not allow switching it on from Home Assistant). On many dishwashers it stays on; washing machines usually need it for every load.
6. Check the prefix: the entity ids of your appliance start with the device name in lower case (`sensor.<prefix>_…`).

## Install

```bash
python tools/fill.py house.yaml build
cd build
uv run --with-requirements requirements.txt python appliances-home-connect/deploy.py --dry-run
uv run --with-requirements requirements.txt python appliances-home-connect/deploy.py --tab
```

`deploy.py` uploads `packages/appliances_home_connect.yaml` and `custom_templates/appliances.jinja`, checks the configuration, reloads the helpers and the custom templates, gives new helpers their start values once (`defaults:` in `module.yaml`, and the program duration from `appliances[].duration_h`), writes the scripts and then the automations through the config API and names any Home Connect entity or device it cannot find. `--tab` adds the views **appliances** and **appliances-settings** (`lovelace/appliances.yaml`) to the Overview (`--dashboard <url_path>`: another dashboard in storage mode); the dashboard config goes to `backup/` first. `--dry-run --live` reads Home Assistant (nothing is written) and reports missing entities and devices.

Deploy `notifications` before this module (the scripts call `script.send_notification`), and `energy-plan`, the tariff module and `presence` before it when you use them.

## Migrating from the Dutch version

For a house that ran the Dutch automations this module was ported from. Steps: deploy the module, set the new helpers to your values (ready by, duration, battery minimum), check the test plan, then delete the old automations, scripts and helpers.

| Old | New |
| --- | --- |
| `input_boolean.<toestel>_slim_wachten` | `input_boolean.appliance_<key>_smart_waiting` |
| `input_datetime.<toestel>_slim_start` | `input_datetime.appliance_<key>_smart_start` |
| `input_select.<toestel>_klaar` (`Auto (thuiskomst)`, hours) | `input_select.appliance_<key>_ready_by` (`auto`, hours) |
| `input_number.<toestel>_programmaduur` | `input_number.appliance_<key>_duration_h` |
| `input_number.toestel_batterij_minimum` | `input_number.appliances_battery_minimum` |
| `input_datetime.thuiskomst_<dag>` | `input_datetime.arrival_<day>` (module presence) |
| scripts `toestel_slim_starten`, `toestel_nu_starten`, `toestel_melding` | `appliance_smart_start`, `appliance_start_now`, `appliance_notify` |
| notification actions `SLIM_{TOESTEL}`, `NU_{TOESTEL}` | `APPLIANCE_SMART_{KEY}`, `APPLIANCE_NOW_{KEY}` |
| automations `toestel_slim_starten_voorstellen`, `_uitvoeren`, `toestel_meldingsknoppen`, `toestel_deur_open_tijdens_programma`, `toestel_fout_melding`, `toestel_klaar_melding`, `toestel_onderhoud_melding` | `appliance_smart_start_offer`, `appliance_smart_start_run`, `appliance_notification_buttons`, `appliance_door_open_running`, `appliance_error`, `appliance_done_reminder`, `appliance_maintenance` |

Old notifications on a phone still carry the old buttons: they do nothing once the old automation is gone.

## Removing

Delete the automations and scripts above (Settings > Automations & scenes), `/config/packages/appliances_home_connect.yaml` and `/config/custom_templates/appliances.jinja`, then restart or reload the helpers.

## Test plan

See [LOGIC.md](LOGIC.md), "Test plan".

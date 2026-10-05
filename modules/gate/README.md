# <@ module.name @>

<@ module.description @>.

A Tesla that navigates home opens the gate by itself when it enters the approach zone. When it drives in without navigating home, a notification asks whether the gate should open. With an end-position sensor the gate also closes when you drive off, and you get a notification when it stays open too long. Quick buttons on the phone: open the gate, close the gate, unlock the charge cable, leaving.

How every decision is made is in [LOGIC.md](LOGIC.md). The test plan is there too.

## Requirements

| What                                                                        | Why                                                                         | Note                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Module **base**                                                             | `packages/`, `templates/` in `configuration.yaml`                           | First `base/deploy.py`                                                                       |
| Home Assistant 2025.4 or newer (tested on 2026.9)                           | `trigger:`/`action:` syntax, `default_entity_id`, `last_reported`, scopes   | `automation: !include automations.yaml` and `script: !include scripts.yaml` (HA's default)  |
| HA OS or Supervised + the **File editor** app                               | `deploy.py` uploads through the File editor                                 | Without it: copy the three files yourself, see `deploy.py --dry-run`                         |
| Integration **Teslemetry**                                                  | position, navigation, destination, charging                                 | See "Teslemetry: shared account"                                                             |
| **Companion app** on every phone, location **Always** + **Precise location** | notifications with buttons, zone trigger, who is in the car                 | See "Setting up the phone"                                                                   |
| Gate control as a `switch`, `button` or `cover` in HA                       | `entities.gate_relay`                                                       | See "Gate hardware"                                                                          |
| End-position contact or gate sensor (**optional**)                          | `entities.gate_sensor`: open too long, close after leaving, no double pulse | Without a sensor: no "open too long" and no "close after leaving"                            |
| Python 3.11 + [uv](https://docs.astral.sh/uv/)                              | `fill.py`, `deploy.py`                                                      |                                                                                              |

Module **tesla-route** is not needed: the gate logic reads the Teslemetry entities itself. With tesla-route the arrival card gets a gate row.

## Build order

Every step can be tested on its own. The commands run from `build/` with `HA_URL` and `HA_TOKEN` set (see the kit's README).

1. **Inventory.** Per car, find the prefix (`device_tracker.<prefix>_location`, or `_locatie` in a Dutch installation) and check the entity names (table below). Per phone, find the `device_tracker` and the notify service (Developer tools > Actions, search for `mobile_app`). Find the entity of your gate relay and, if you have one, your gate sensor.
2. **Fill in `house.yaml`** (fields below; example: the sections `house:`, `people:`, `cars:`, `teslemetry:` and the `gate_*` roles under `entities:` in `house.example.yaml`) and run `tools/fill.py`. From then on, work only in `build/`.
3. **People** in the UI: one `person.<key>` per adult, with only the **current** phone tracker. Link every person to their own HA user: then a notification from a quick button only goes to whoever pressed it.
4. **One-off:** `gate/deploy.py --dry-run --setup --home` (look), then `gate/deploy.py --setup --home`.
   - enables the Teslemetry sensors that are disabled by default (shift state, speed, destination);
   - creates `zone.gate_approach` (<@ module.defaults['zone.gate_approach'] @> m, not passive) around `house.lat/lon`, named in `house.language`;
   - `--home` moves `zone.home` to `house.lat/lon` (where the cars park). Leave `--home` out when `zone.home` is already right. Read "zone.home" in LOGIC.md first.
   - Then reload the Teslemetry integration.
5. **Test mode.** On the first install `deploy.py` turns `input_boolean.gate_auto_open_dry_run` **on** and the master switch off. Test the adapter first: run `script.gate_pulse` in the UI while you stand at the gate (this gives a **real** pulse).
6. **Master switch on** (`input_boolean.gate_auto_open_enabled`), test mode stays on. Follow the test plan in LOGIC.md and drive a week in test mode: every arrival is in the logbook with its reason.
7. **Live:** test mode off. With a gate sensor: `input_boolean.gate_auto_close_enabled` on for closing after leaving.

After a change in `house.yaml` or a kit update: fill in again and run `gate/deploy.py` (without `--setup`). Existing settings stay as they are.

## Privacy

Car position, navigation and charging state come from Teslemetry (cloud); the charge-cable command goes through Teslemetry to the car. Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

| Field                                                  | What                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `house.lat`, `house.lon`                               | where the cars park at home: centre of `zone.gate_approach` (and `zone.home` with `--home`)               |
| `house.address_regex`                                  | street + house number as the Tesla shows it as destination, lower case, regex                             |
| `house.home_destinations`                              | name of the "home" favourite in the car: `Home`, `Thuis`, `Domicile`, … (depends on the car's language)   |
| `house.language`                                       | language of the notifications, logbook lines and helper names: `en` or `nl`                               |
| `people[]`: `key`, `name`, `person`, `phone`, `notify` | `notify` empty = no notifications for that person (e.g. a child)                                          |
| `people[].admin` (optional)                            | also gets the notification when someone else's phone loses its location access. Nobody: the first person |
| `people[].location_permission` (optional)              | when the sensor is not called `sensor.<phone>_location_permission` (a second registration gets `_2`)      |
| `cars[]`: `prefix`, `name`, `driver`                   | `driver` = key of the usual driver: gets the notification after closing when no phone left               |
| `cars[].entities` (optional)                           | an entity that differs per car, e.g. `located_at_home: binary_sensor.garage_<prefix>_located_at_home`     |
| `entities.gate_relay`                                  | `switch`, `button` or `cover`                                                                             |
| `entities.gate_sensor` (optional)                      | `binary_sensor` (on = open) or the `cover` itself. Empty = no end-position sensor                         |
| `entities.gate_sensor_inverted`                        | `true` when your sensor is **on** while the gate is **closed** (end-position relay "closed")              |
| `teslemetry.*`                                         | pattern of the Teslemetry entities per role, see "Entity names"                                           |

The number of cars and people is free. Everything that exists per car or per person is repeated when filling in.

## Gate hardware: the adapter

Everything that operates the gate goes through `script.gate_pulse`. Which action the script takes depends on the domain of `entities.gate_relay`:

| `gate_relay` | Action                                                          | Extra                                                                                                           |
| ------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `switch.…`   | `switch.turn_on` (impulse relay with auto-off)                  | Waits up to 45 s when the relay is offline. When it is still `on`, no second pulse. **Set auto-off to 0.5–1 s** |
| `button.…`   | `button.press`                                                  | For a gate module that only offers a button                                                                     |
| `cover.…`    | `cover.open_cover` when it is closed, otherwise `cover.close_cover` | Use the same cover as `gate_sensor`: then `binary_sensor.gate_open` = not `closed`                          |

In all three cases the script ignores a second pulse within 30 s (two pulses shortly after each other make the gate stop or reverse), unless called with `force: true`.

**End-position sensor.** Best is a wired signal from the gate controller itself, e.g. a potential-free relay "end position closed" to the input of a Shelly 1 (input set to _detached_, otherwise every signal gives a pulse). Such a relay is **on while the gate is closed**: then set `gate_sensor_inverted: true`. A battery sensor on wifi can go blind and then keeps showing "closed" while the gate is open (see LOGIC.md, edge cases).

Other hardware (e.g. a gate that only works through an API or a `lock`): after filling in, replace the "pulse" step in `build/gate/scripts.yaml` with the right action. The rest of the module only looks at `script.gate_pulse` and `binary_sensor.gate_open`.

## Setting up the phone

1. **Companion app:** location **Always** and **Precise location** on. With "While using" no positions come through on the road. `automation.phone_location_permission_watch` notifies when it falls back.
2. **Zones:** nothing to do; the app fetches new zones itself. Open the app once after `zone.gate_approach` was created.
3. **Notifications:** allow them. Two registrations of the same phone can hide each other's notify service: test which phone gets the notification.
4. **Widget:** long-press the home screen > **+** > Home Assistant > widget **Scripts** > pick the scripts "open gate", "close gate", "unlock Tesla charge cable", "leaving" or "leaving with the …" (their names follow `house.language`).
5. **Shortcuts app** (optional): action Home Assistant > Perform Action > `script.turn_on` > pick the script > Add to Home Screen. Works with Siri too.
6. **Control Center** (iOS 18): edit > **+** > Home Assistant > Script > `script.gate_open_manual`.

## Teslemetry: shared account

When the cars are on a Teslemetry account you share with others (e.g. family), work with your own access token.

- Add Teslemetry with your token. **All** cars of the account appear. **Disable the devices that are not yours** (Settings > Devices > the car > disable): fewer sensors, more privacy, and no button can send a command to that car by mistake.
- Enabling an entity (e.g. the shift state) turns the field on in that car's streaming configuration at Teslemetry. That configuration is shared per car between all installations on the account. Turning it on bothers nobody.
- **Command credits:** a command costs credits of the account (in 2026: 1 per command, 20 for waking up). This module only sends commands for "unlock charge cable" (stop charging + unlock). `counter.tesla_commands_today` counts them. Do not send commands to cars that are not yours: they come out of the owner's budget.
- Streaming (position, navigation, route) costs no credits.
- `sensor.teslemetry_command_credits` can show 0 while commands work fine. Check it when unlocking fails.

## Entity names

`teslemetry:` in `house.yaml` sets the entity names per role. The example uses the **Dutch** names Teslemetry creates when Home Assistant was set to Dutch when the integration was added. Check per car in Settings > Devices > the car > entities.

| Role in `teslemetry:` | Dutch (example)                                         | English (likely, check)             | Used by             |
| --------------------- | ------------------------------------------------------- | ----------------------------------- | ------------------- |
| `location`            | `device_tracker.{p}_locatie`                            | `device_tracker.{p}_location`       | gate, cards         |
| `route`               | `device_tracker.{p}_route`                              | `device_tracker.{p}_route`          | gate, arrival card  |
| `destination`         | `sensor.{p}_bestemming` (disabled by default)           | `sensor.{p}_destination`            | gate, arrival card  |
| `distance_to_arrival` | `sensor.{p}_distance_to_arrival`                        | same                                | gate, arrival card  |
| `time_to_arrival`     | `sensor.{p}_time_to_arrival`                            | same                                | arrival card        |
| `traffic_delay`       | `sensor.{p}_traffic_delay` (disabled by default)        | same                                | arrival card        |
| `battery_at_arrival`  | `sensor.{p}_state_of_charge_at_arrival` (disabled by default) | same                          | arrival card        |
| `shift_state`         | `sensor.{p}_shift_state` (disabled by default)          | `sensor.{p}_shift_state`            | gate, arrival card  |
| `speed`               | `sensor.{p}_snelheid` (disabled by default)             | `sensor.{p}_speed`                  | gate, arrival card  |
| `status`              | `binary_sensor.{p}_status`                              | `binary_sensor.{p}_status`          | gate, arrival card  |
| `located_at_home`     | `binary_sensor.{p}_thuis_gelegen`                       | `binary_sensor.{p}_located_at_home` | charge cable, card  |
| `battery`             | `sensor.{p}_batterijniveau`                             | `sensor.{p}_battery_level`          | card                |
| `charging_state`      | `sensor.{p}_opladen`                                    | `sensor.{p}_charging`               | charge cable        |
| `charge_switch`       | `switch.{p}_opladen`                                    | `switch.{p}_charge`                 | charge cable        |
| `charge_cable`        | `binary_sensor.{p}_oplaadkabel`                         | `binary_sensor.{p}_charge_cable`    | charge cable        |
| `charge_cable_lock`   | `lock.{p}_oplaadkabelslot`                              | `lock.{p}_charge_cable_lock`        | charge cable        |
| `tesla_route`         | `sensor.{p}_tesla_route`                                | same (own integration)              | arrival card        |

When one car differs (in the source one car had `binary_sensor.garage_<prefix>_thuis_gelegen`), put that entity under `cars[].entities` instead of changing the pattern.

## What ends up in Home Assistant

| Kind        | Entity                                                                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helpers     | `input_boolean.gate_auto_open_enabled`, `gate_auto_open_dry_run`, `gate_auto_close_enabled`¹; `input_number.gate_away_minutes`, `gate_far_distance`, `gate_nav_home_tolerance`, `gate_open_alert_minutes`¹, `gate_close_distance`¹; `input_datetime.gate_last_pulse`, `gate_last_auto_open`; `counter.tesla_commands_today` |
| Zone        | `zone.gate_approach` (UI zone, by `--setup`)                                                                                                                                                                                                                                                                                |
| Sensors     | per car `sensor.gate_<car>_far_since`, `binary_sensor.gate_<car>_away_long_enough`, `binary_sensor.gate_<car>_navigating_home`, `sensor.gate_update_interval_<car>`; per phone `sensor.gate_update_interval_phone_<key>`; `binary_sensor.gate_auto_open_ready`; `binary_sensor.gate_open`¹                                  |
| Automations | `gate_auto_open`, `gate_notification_action`, `gate_open_too_long`¹, `gate_close_after_departure`¹, `phone_location_permission_watch`, `tesla_commands_counter_reset`                                                                                                                                                       |
| Scripts     | `gate_pulse` (internal), `gate_open_manual`, `gate_close_manual`, `tesla_unlock_charge_cable`, `leaving`, `leaving_<car>` per car                                                                                                                                                                                           |
| Macros      | `custom_templates/gate.jinja`: `cars()`, `people()`, `conditions(p)`, `all_conditions()`, `riders(p)`, `recipients(user_id)`                                                                                                                                                                                                |

¹ only with `entities.gate_sensor`.

Names, notifications and logbook lines are in `house.language` (texts in `strings.yaml`); the entity ids are the same in every language.

`counter.tesla_commands_today` lives in this module. Other modules that send Tesla commands (charging, tesla-driveway-lock) count in the same counter and do not define it again.

**With parcel-service:** the automation `gate_open_too_long` stays silent during a parcel delivery when `parcel-service` is in `modules:`. When you add that module later, fill in again and run this `deploy.py` again too.

**Removing:** `deploy.py` removes nothing. When you later take out the gate sensor, delete `automation.gate_open_too_long` and `automation.gate_close_after_departure` yourself (Settings > Automations).

## Migrating from the Dutch version

Kit versions up to `db5b2fe` used Dutch file names and ids. The helper and sensor ids (`gate_*`) did not change; these did:

| Old                                                       | New                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `/config/packages/poort.yaml`                             | `/config/packages/gate.yaml`                                |
| `/config/templates/poort.yaml`                            | `/config/templates/gate.yaml`                               |
| `/config/custom_templates/poort.jinja`                    | `/config/custom_templates/gate.jinja`                       |
| macros `autos`, `personen`, `auto`, `alle`, `ontvangers`  | `cars`, `people`, `conditions`, `all_conditions`, `recipients` |
| `counter.tesla_commando_s_vandaag`                        | `counter.tesla_commands_today`                              |
| `automation.tesla_commando_teller_reset`                  | `automation.tesla_commands_counter_reset`                   |
| `sensor.gate_update_interval_gsm_<key>`                   | `sensor.gate_update_interval_phone_<key>`                   |
| script fields `reden`, `auto`                             | `reason`, `car` (`reden` is still read as a fallback)       |
| notification button `UNLOCK_<id>_ALLE`                    | `UNLOCK_<id>_ALL`                                           |
| `deploy.py --thuis`                                       | `deploy.py --home`                                          |

Attributes of the template sensors are English now too (e.g. `afstand_tot_poort_m` → `gate_distance_m`, `bestemming` → `destination`); see LOGIC.md. Steps: delete the three old files (File editor), run `gate/deploy.py`, then delete what is left of the old ids in the UI: the counter, the automation and the orphaned `sensor.gate_update_interval_gsm_<key>` (their history stays under the old id). `deploy.py` stops with a list when an old file is still there.

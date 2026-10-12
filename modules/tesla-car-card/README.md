# <@ module.name @>

**Needs:** a Tesla through the Teslemetry integration (battery, charging state, charge cable and location per car; every other entity is optional and only adds its tile or row). Optional: `tesla-driveway-lock` with the garage photo for the garage icon, a charging module (`ev-charging`) for the gear to the charge settings, `notifications` for the plug-in reminder.

<@ module.description @>.

**Status:** in production at the source since 2026-10-12. The card runs daily in the author's house; the kit module itself is not deployed there yet.

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_tesla_car_card.jinja' import reminder, garage_photo, settings_path with context %>
<% set remindernote = 'The plug-in reminder is on in this house.' if reminder else 'The plug-in reminder is off in this house (tesla_car_card.plug_in_reminder).' %>
<% set garagenote = 'The cards and the reminder use the garage photo of tesla-driveway-lock.' if garage_photo else 'Without the garage photo of tesla-driveway-lock: home counts as home, the card shows no garage icon.' %>
-->

One card per car, after the Tesla app: the car on a small photo studio floor, with invisible tap zones on the frunk and the trunk; the battery as a number and a line; the charge state in the picture itself (a fast charger or a wall box with the cable, energy running through the cable while charging: green from the sun, red from the grid); a row of thin line icons for lock, frunk, trunk, charge port, climate, charging, lights, horn, sentry and windows; behind the battery a popup with range, odometer, tyres, open doors and the charge limit; behind the climate tile a climate screen with seat and wheel heating on a picture of the interior. Top right: the garage when the car is in the garage, otherwise the weather. <@ garagenote @>

The optional **plug-in reminder** tells whoever is home to plug in a car that stands at home without a cable while its battery is well below the charge limit. <@ remindernote @>

How every decision is made is in [LOGIC.md](LOGIC.md), together with the test plan.

## Requirements

| What                                      | Why                                                         | Note                                                                     |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Module **base**                           | theme tokens `--cw-*` (colours of the card)                 | Without them the card falls back to the Organic light colours            |
| Integration **Teslemetry**                | every state and command of the card                         | Each command costs Teslemetry credits and may wake the car               |
| HA OS or Supervised + **File editor** app | `deploy.py` uploads the card and the pictures               | Without it: copy `www/` yourself, see `deploy.py --dry-run`              |
| Module **notifications** (optional)       | `script.send_notification` for the plug-in reminder         | Only with `tesla_car_card.plug_in_reminder: true`; fill.py checks it     |
| Module **tesla-driveway-lock** (optional) | garage photo: garage icon, "in the garage" for the reminder | Only with `tesla_driveway_lock.garage_photo: true`                       |
| Weather entity (optional)                 | weather icon and temperature top right when outside         | `entities.weather`                                                       |
| Grid power (optional)                     | red (grid) or green (sun) energy in the cable at home       | `entities.grid_import_w`, W or kW; without it the cable is green at home |

## Build order

Commands from `build/` with `HA_URL` and `HA_TOKEN` set (see the kit's README).

1. **Inventory.** Per car, look up the Teslemetry entities of the roles below (Settings > Devices & services > Teslemetry > the car). Teslemetry creates some of them disabled (e.g. the charger voltage, tyre pressures): enable the ones you want.
2. **Fill in `house.yaml`**: per car `model` (`model_s` or `model_y`) or `image`; the roles under `teslemetry:` (or per car under `cars[].entities`); optionally the section `tesla_car_card:`. `tesla-car-card` in `modules:`. Then `tools/fill.py`.
3. `tesla-car-card/deploy.py --dry-run` (look), then `tesla-car-card/deploy.py`. It uploads the pictures (about 1 MB) and the card; `--no-images` skips the pictures on a later deploy.
4. **Dashboard**: paste `lovelace/tesla-car-view.yaml` as a view (raw configuration editor), or one card from it via Add card > Manual.
5. The test plan in LOGIC.md.

After a change in `house.yaml` or a kit update: fill in again, run `deploy.py` and paste the cards again.

## Fields in `house.yaml`

| Field                                   | What                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cars[].prefix`, `name`, `article`      | prefix of the entities (also how the garage photo names the car), name on the card, name in a sentence |
| `cars[].model`                          | `model_s` or `model_y`: the pictures of this module, with tap zones and chargers                       |
| `cars[].image`                          | instead of `model`: an own picture (`/local/...` or `https://...`); no tap zones, no charger pictures  |
| `cars[].entities` (optional)            | an entity that does not follow the pattern in `teslemetry:` (one key per role)                         |
| `teslemetry.<role>`                     | pattern per role, `{p}` = prefix; the roles are in the table below                                     |
| `entities.weather`, `grid_import_w`     | optional, see Requirements                                                                             |
| `tesla_car_card.plug_in_reminder`       | `true` = the plug-in reminder; default `false`                                                         |
| `tesla_car_card.reminder_after_minutes` | minutes at home before the reminder; default 15                                                        |
| `tesla_car_card.reminder_time`          | the evening check, `"HH:MM"` in quotes; default `"21:00"`                                              |
| `tesla_car_card.reminder_below_limit`   | the battery must be at least this many % below the charge limit; default 10                            |
| `tesla_car_card.tap_url`                | where a tap on the reminder goes, e.g. `/lovelace/cars`; empty = the app's default                     |
| `tesla_car_card.settings_path`          | where the gear of the card goes; empty = `/lovelace/smart-charging` with `ev-charging`, else no gear   |

### Roles

Required: `battery`, `charging_state`, `charge_cable`, `location`. Every other role is optional: without it the tile, row or seat button is left out. The Dutch names are the ones Teslemetry creates in a Dutch-language Home Assistant (seen at the source); the English ones are derived, not seen: check per car.

| Role                                    | Dutch (seen)                                                                                                                                                                                                                 | English (derived)                                                 | On the card                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| `battery`                               | `sensor.{p}_batterijniveau`                                                                                                                                                                                                  | `sensor.{p}_battery_level`                                        | battery number and line                |
| `charging_state`                        | `sensor.{p}_opladen`                                                                                                                                                                                                         | `sensor.{p}_charging`                                             | charging (state `charging`)            |
| `charge_cable`                          | `binary_sensor.{p}_oplaadkabel`                                                                                                                                                                                              | `binary_sensor.{p}_charge_cable`                                  | charger picture                        |
| `location`                              | `device_tracker.{p}_locatie`                                                                                                                                                                                                 | `device_tracker.{p}_location`                                     | home or away                           |
| `charger_power`                         | `sensor.{p}_charger_power`                                                                                                                                                                                                   | `sensor.{p}_charger_power`                                        | kW badge, speed of the energy          |
| `charger_voltage`                       | `sensor.{p}_charger_voltage`                                                                                                                                                                                                 | `sensor.{p}_charger_voltage`                                      | fast charger (below 50 V)              |
| `charge_switch`                         | `switch.{p}_opladen`                                                                                                                                                                                                         | `switch.{p}_charge`                                               | tile start/stop charging               |
| `charge_limit`                          | `number.{p}_charge_limit`                                                                                                                                                                                                    | `number.{p}_charge_limit`                                         | slider in the popup                    |
| `lock`                                  | `lock.{p}_slot`                                                                                                                                                                                                              | `lock.{p}_lock`                                                   | tile lock                              |
| `frunk`, `trunk`                        | `cover.{p}_frunk`, `cover.{p}_kofferbak`                                                                                                                                                                                     | `cover.{p}_frunk`, `cover.{p}_trunk`                              | tiles and tap zones                    |
| `charge_port`                           | `cover.{p}_laadpoortdeur`                                                                                                                                                                                                    | `cover.{p}_charge_port_door`                                      | tile charge port                       |
| `windows`                               | `cover.{p}_ramen`                                                                                                                                                                                                            | `cover.{p}_windows`                                               | tile windows, vent                     |
| `range`                                 | `sensor.{p}_battery_range`                                                                                                                                                                                                   | `sensor.{p}_battery_range`                                        | range                                  |
| `odometer`                              | `sensor.{p}_kilometerteller`                                                                                                                                                                                                 | `sensor.{p}_odometer`                                             | popup                                  |
| `sentry`                                | `switch.{p}_sentry_mode`                                                                                                                                                                                                     | `switch.{p}_sentry_mode`                                          | tile sentry                            |
| `climate`                               | `climate.{p}_klimaat`                                                                                                                                                                                                        | `climate.{p}_climate`                                             | climate screen                         |
| `inside_temperature`                    | `sensor.{p}_binnentemperatuur`                                                                                                                                                                                               | `sensor.{p}_inside_temperature`                                   | climate screen                         |
| `outside_temperature`                   | `sensor.{p}_buitentemperatuur`                                                                                                                                                                                               | `sensor.{p}_outside_temperature`                                  | temperature top right                  |
| `defrost`                               | `switch.{p}_ontdooien`                                                                                                                                                                                                       | `switch.{p}_defrost`                                              | climate screen                         |
| `flash_lights`, `honk`                  | `button.{p}_flash_lights`, `button.{p}_honk_horn`                                                                                                                                                                            | the same                                                          | tiles lights, horn                     |
| `steering_wheel_heater`                 | `select.{p}_stuurwielverwarming`                                                                                                                                                                                             | `select.{p}_steering_wheel_heater`                                | climate screen                         |
| `seat_heater_left`, `_right`            | `select.{p}_stoelverwarming_voor_links`, `_rechts`                                                                                                                                                                           | `select.{p}_seat_heater_front_left`, `_right`                     | climate screen                         |
| `seat_cooler_left`, `_right`            | `select.{p}_seat_cooler_front_left`, `_right`                                                                                                                                                                                | the same                                                          | climate screen (cooled seats)          |
| `tyre_front_left` … `tyre_rear_right`   | `sensor.{p}_bandenspanning_linksvoor`, `_rechtsvoor`, `_linksachter`, `_rechtsachter`                                                                                                                                        | `sensor.{p}_tire_pressure_front_left`, …                          | popup, tyre warning below 2.7 bar      |
| `door_front_left` … `window_rear_right` | `binary_sensor.{p}_front_driver_door`, `_voorpassagiersdeur`, `_rear_driver_door`, `_achterste_passagiersdeur`, `_front_driver_window`, `_voorpassagiersraam`, `_achterruit_bestuurderszijde`, `_achterruit_passagierszijde` | `binary_sensor.{p}_front_driver_door`, `_front_passenger_door`, … | "Open" in the popup (by friendly name) |

## Card config

`lovelace/tesla-car-view.yaml` writes every entity out. By hand:

| Key                                      | What                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `name`                                   | (required) name on the card                                                        |
| `model`                                  | `model_s` or `model_y` (the pictures of this module); or `image` instead           |
| `image`                                  | own picture: the card shows it as it is (no tap zones, chargers or contact shadow) |
| `images`                                 | folder of the pictures; default `/local/ha-kit/tesla-car-card/images/`             |
| `prefix`                                 | the car's prefix, as the garage photo names it                                     |
| `garage_photo`, `garage_spots`           | `input_text.tesla_garage_photo` and its spots (module tesla-driveway-lock)         |
| `weather`, `grid_power`, `settings_path` | optional, see the fields above                                                     |
| `entities`                               | entity id per role (table above); `doors` and `tyres` are lists                    |

## What ends up in Home Assistant

| Kind       | Entity                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Files      | `/config/www/ha-kit/tesla-car-card/tesla-car-card.js`, `/config/www/ha-kit/tesla-car-card/images/*.webp` (20 pictures, about 1 MB) |
| Resource   | `/local/ha-kit/tesla-car-card/tesla-car-card.js?v=VERSION`                                                                         |
| Automation | `tesla_car_plug_in_reminder` (only with `plug_in_reminder: true`)                                                                  |

No helpers. The cards themselves are pasted by you.

## Safety and Teslemetry credits

The card sends a command only from a real tap (`event.isTrusted`); a render or a test never does. Opening the frunk, the trunk, the charge port or the windows, unlocking, starting or stopping charging, flashing the lights and the horn need a **second tap within 4 seconds** (the button shows "?"). Locking, climate, sentry, defrost and the seat buttons are direct. Every command costs Teslemetry credits and may wake the car.

## Privacy

The card reads the states Home Assistant already has; it sends nothing outside Home Assistant and loads nothing from the internet (the icons are drawn in the card, the pictures come from `/local/`). The reminder goes through `script.send_notification` (module notifications) to the phones of the people at home.

## Pictures and trademarks

The pictures in `www/images/` are edited renders made by the author of this kit (side views, no number plates), shipped as WebP at twice the largest size the card shows them. Tesla, Model S, Model Y and Supercharger are trademarks of Tesla, Inc.; zappi is a trademark of myenergi Ltd. This kit is not affiliated with or endorsed by Tesla or myenergi. The icons are own drawings or after Lucide (ISC) and Phosphor (MIT).

## Make your own pictures

For another car or colour, or a Model 3 or X. The card expects per model, all on **one canvas** (the car on exactly the same pixels in every picture), transparent background, a side view with the front to the left:

| File                                           | What                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| `<m>-base`                                     | the car, everything closed, no cable             |
| `<m>-frunk`, `<m>-trunk`                       | the same car with that lid open                  |
| `<m>-fast`, `<m>-fast-frunk`, `<m>-fast-trunk` | with a fast charger behind the car and its cable |
| `<m>-home`, `<m>-home-frunk`, `<m>-home-trunk` | with a wall box and its cable                    |
| `<m>-interior`                                 | from above, front up (climate screen), 2:3       |

Rules the shipped pictures follow: the car stands on the same pixels in every state; both models have the same metres per pixel (so a Model S shows longer than a Model Y); no shadow in the pictures (the card draws one fixed contact shadow); never the car maker's original charge cable (draw your own); no `mix-blend-mode` (a cut-out car turns black on a dark card); no number plates.

The scripts in `tools/` (Python with numpy and Pillow) are the ones that made the shipped pictures; their coordinates belong to those pictures, so measure your own:

1. `align_base.py`: the cable-free cut-out on the shared canvas (`<m>-base.png`).
2. `align_open.py`: the open-lid cut-outs fitted onto the base car, only the lid taken over (`<m>-frunk.png`, `<m>-trunk.png`).
3. `compose_chargers.py`: car + charger + an own drawn cable for all combinations, and `cable.json` with the cable points and the top of each charger. Copy those into `CABLE` and `CHARGER_TOP` of `www/tesla-car-card.js`; measure the tap zones (`AREAS`, `AREAS_OPEN`) and the wheel line (`GROUND`) on your pictures.
4. `to_webp.py <pngs> ../www/images`: WebP with alpha, 1200 px wide (interior 820 px), no metadata.

A single own picture without states needs none of this: set `cars[].image`.

## Removing

`deploy.py` removes nothing. Delete the cards, the resource (Settings > Dashboards > Resources), the folder `/config/www/ha-kit/tesla-car-card/` (File editor) and the automation `tesla_car_plug_in_reminder`.

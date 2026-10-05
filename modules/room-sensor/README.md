# <@ module.name @>

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% if rooms is not defined or not rooms %><@ fail('house.yaml has no rooms: (see house.example.yaml)') @><% endif %>
<% set ks = rooms | selectattr('sensor', 'defined') | selectattr('sensor') | list %>
<% set lang = house.get('language') or 'en' %>
<% set id_temp = t('entity_temperature') | lower | replace(' ', '_') | replace('-', '_') %>
<% set id_hum = t('entity_humidity') | lower | replace(' ', '_') | replace('-', '_') %>
<% set id_offset = t('entity_temperature_offset') | lower | replace(' ', '_') | replace('-', '_') %>
-->

<@ module.description @>.

A DIY build of the Everything Presence Lite (LD2450 radar + BH1750 light sensor) with an SHT31 for temperature and humidity, in a printed case with a separate chamber for the SHT31. One firmware base (`esphome/kamersensor.yaml`); for every room with `sensor: true`, `fill.py` writes a small file `esphome/kamersensor-<room>.yaml` that includes that base.

How it works and the test plan: [LOGIC.md](LOGIC.md).

## Status

**Tested at the source: never flashed.** The firmware is validated with `esphome config` (ESPHome 2026.9.0), the case is designed and rendered, the wiring is drawn. No room sensor hangs on a wall yet. So count on a first device as a trial: one room, one day next to a reference thermometer, only then the rest.

## Requirements

| What | Why | Note |
| --- | --- | --- |
| **ESPHome Device Builder** app in Home Assistant | build and flash the firmware | Or `esphome` on a computer (`uvx esphome==2026.9.0 ...`) |
| **ESPHome** integration | the device in HA | Offered automatically after flashing |
| **File editor** app (HA OS/Supervised) | `deploy.py` puts the files in `/config/esphome/` | Without it: copy them yourself, see `deploy.py --dry-run` |
| Hardware per room | see "Parts" | |
| Internet while building | the EP Lite packages come from GitHub (pinned commit) | Only when compiling |

Module **base** is not needed: this module does not touch the HA configuration.

## Fields in `house.yaml`

See the section `rooms:` in `house.example.yaml` (two fields per room):

- `rooms[].sensor` (optional): `true` = this room gets a room sensor.
- `rooms[].temp_offset` (optional): start correction in °C, default `-0.5`. Tune it in HA after flashing (the number "<@ t('entity_temperature_offset') @>").
- `rooms[].slug` becomes the device name `kamersensor-<slug>` (a `_` becomes `-`), `rooms[].name` the name in HA (and so the start of the entity ids).
- `house.language` names the four entities this module adds (see "Entity ids depend on house.language").

Filled in for this house:

<% for k in ks %>
- `kamersensor-<@ k.slug | replace('_', '-') @>`: <@ k.name @>, correction <@ k.get('temp_offset', -0.5) @> °C
<% else %>
- no room with `sensor: true`: this module does nothing
<% endfor %>

## Parts (per room)

| Part | Qty | Note |
| --- | --- | --- |
| ESP32 DevKit (WROOM-32, CP2102, 30 pins) | 1 | board `esp32dev` |
| Hi-Link HLK-LD2450 (24 GHz radar) | 1 | powered from 5 V (VIN) |
| BH1750 light sensor (GY-302) | 1 | I2C, address 0x23 |
| GY-SHT31-D temperature and humidity | 1 | I2C, address 0x44 |
| micro-USB power supply 5 V, 1 A | 1 | the cable also leaves the case at the bottom |
| DuPont jumper wires female-female 20 cm | ± 8 | or short solid wire, soldered |
| 3D print: `3d/room-sensor-body.stl` + `3d/room-sensor-lid.stl` | 1 + 1 | PLA or PETG, see "Case" |
| 2 screws or adhesive strips for the wall | 2 | keyholes in the lid |

## Wiring

Drawing: `fritzing/kamersensor-bedrading.png` (source: `fritzing/kamersensor-bedrading.fzz`, opens in Fritzing; the labels in the drawing are Dutch).

| From | To (ESP32) | Note |
| --- | --- | --- |
| LD2450 5V | VIN | 5 V from the USB |
| LD2450 GND | GND | |
| LD2450 TX | GPIO16 (RX2) | |
| LD2450 RX | GPIO17 (TX2) | |
| BH1750 VCC, SHT31 VIN | 3V3 | SHT31 daisy-chained through the BH1750 |
| BH1750 GND, SHT31 GND | GND | |
| BH1750 SDA, SHT31 SDA | GPIO21 | |
| BH1750 SCL, SHT31 SCL | GPIO22 | |
| ADDR / ADR / ALR | leave unconnected | otherwise the I2C address changes |

## Case (3D print)

- `3d/room-sensor-enclosure.scad` (OpenSCAD) is the source. `part = "body"` and `part = "lid"` export the two STLs; `3d/room-sensor-body.stl` and `3d/room-sensor-lid.stl` are the default sizes. **Measure your own boards** and adjust the sizes at the top when they differ.
- Two chambers: on top the ESP32, radar and light sensor; below the SHT31 with its own vents, so the heat of the ESP32 does not bias the temperature.
- The radar is tilted 15° down inside the case and looks through the front. Print in **PLA or PETG**: no filament with metal, carbon or "silk", and no paint in front of the radar.
- Body with the open back facing up, lid flat (wall side down). 0.2 mm, 3 walls.
- Previews: `3d/room-sensor-preview.png`, `-preview-front.png`, `-preview-side.png`.

## Install

1. Fill in `house.yaml` (fields above) and run `fill.py`.
2. In Home Assistant: install the **ESPHome Device Builder** app and open it once. It creates `/config/esphome/`.
3. Put the secrets in the Device Builder (button **Secrets**, top right): the keys from `secrets.example.yaml`, with your own values. Make a key for `room_sensor_api_encryption_key` with `openssl rand -base64 32`. When `secrets.yaml` already exists (from other ESPHome devices), only add the missing keys.
4. Place the files:

   ```bash
   cd build
   uv run --with-requirements requirements.txt python room-sensor/deploy.py --dry-run   # shows what will be uploaded
   uv run --with-requirements requirements.txt python room-sensor/deploy.py
   ```

   That puts `kamersensor.yaml` and one `kamersensor-<room>.yaml` per room in `/config/esphome/` and reports which keys are still missing in `secrets.yaml`. It flashes nothing and changes nothing else.

Upgrading from an older version of the kit: the secret used to be called `kamersensor_api_encryption_key`. Add `room_sensor_api_encryption_key` with the same value (`deploy.py` reports it as missing until you do).

## Flashing

`deploy.py` cannot flash: that happens in the ESPHome Device Builder (or on a computer).

1. **First time over USB.** A new ESP32 board has no ESPHome yet. Connect it with a data cable to the computer on which you open Home Assistant (Chrome or Edge). In the Device Builder: card `kamersensor-<room>` > **Install** > **Plug into this computer**. If that does not work: **Manual download** (format "Factory") and flash the file through https://web.esphome.io.
2. **Afterwards wirelessly**: **Install** > **Wirelessly**. After every change to `kamersensor.yaml` this applies to every room.
3. On a computer it works too: put the files and your own `secrets.yaml` in one folder and run `uvx esphome==2026.9.0 run kamersensor-<room>.yaml`.
4. After flashing, Home Assistant reports a new ESPHome device: **Configure** and enter the `room_sensor_api_encryption_key`.
5. Mount the sensor and follow the test plan in [LOGIC.md](LOGIC.md).

No wifi after flashing? After ± 1 min the device opens a hotspot "<room> Fallback" (password `wifi_hotspot_password`); pick the right network there.

## What ends up in Home Assistant

One ESPHome device per room, named after `rooms[].name`. The main entities (example for a room "Bedroom", language `<@ lang @>`):

- `binary_sensor.bedroom_occupancy`: someone present (radar), plus `zone_1..4_occupancy` when you draw zones;
- `sensor.bedroom_illuminance`: light in lux;
- `sensor.bedroom_<@ id_temp @>`, `sensor.bedroom_<@ id_hum @>`;
- `number.bedroom_<@ id_offset @>`: the correction, adjustable without flashing;
- the settings and targets of the Everything Presence Lite (`target_1_x`, `max_distance`, `occupancy_off_delay`, ...), mostly as configuration or diagnostic entities.

No automations, scripts or helpers: what happens with presence, light and humidity belongs to the modules `climate` and `shading` (planned).

## Entity ids depend on house.language

Home Assistant builds an ESPHome entity id from the friendly name of the device and the name of the entity. The four entities this module adds on top of the EP Lite firmware are named in `house.language` (`strings.yaml`), so **their entity ids depend on the language you fill in with**. The EP Lite entities (occupancy, illuminance, targets, zones) are English in every language.

| Entity | `language: en` | `language: nl` |
| --- | --- | --- |
| temperature | `sensor.<room>_temperature` | `sensor.<room>_temperatuur` |
| humidity | `sensor.<room>_humidity` | `sensor.<room>_luchtvochtigheid` |
| temperature correction | `number.<room>_temperature_offset` | `number.<room>_temperatuur_correctie` |
| firmware update (internal, not in HA) | - | - |

The `nl` names are the ones of the first version of this module: an installation filled in with `nl` keeps its entity ids. Switching the language of an existing device creates new entities (and a gap in the history); rename the new ones in HA if you want to keep the old ids.

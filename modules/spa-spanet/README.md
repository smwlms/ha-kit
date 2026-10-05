# <@ module.name @> (optional)

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_spa.jinja' import device_name, friendly, entity_prefix, probes, lid with context %>
<% set probes_state = 'on' if probes else 'off' %>
<% set lid_state = 'on' if lid else 'off' %>
<% set lang = house.get('language') or 'en' %>
<% set id_water = t('water_temperature') | lower | replace(' ', '_') %>
-->

<@ module.description @>.

> **Read this first.**
>
> - **Only for a SpaNET SV3 controller with a free or shareable EXP1 port.** According to wayne-love/ESPySpa, other SpaNET SV controllers with an EXP port speak the same protocol, but that has not been checked here. Balboa, Gecko, Joyonway and other brands speak another protocol: this firmware does not work there and the wiring can cause damage.
> - **Hardware work inside the control box of the spa** (230 V, 5 kW heater). Switch off the circuit breaker of the spa before you open the box. In doubt, have it done by someone who dares and is allowed to. The work can affect the warranty.
> - **Status: bench test passed, not installed yet.** The ESP32 is flashed and talks correctly to a simulator of the SV3 (through a USB-serial adapter). It has not been tested on a real spa: the scale of the raw fields and the voltage level of the EXP1 port still have to be measured.

An ESP32 takes the place of the SpaNET SmartLINK wifi module: it talks to the controller through the EXP1 port (serial, 38400 baud), reads the status every 10 s and sets target temperature, operating mode, Power Save and filtration. Two own probes measure the water and air temperature, also while the pump is off, and a reed contact sees whether the lid is open. Local, without a cloud.

How it works, what it reads and controls, and the test plan: [LOGIC.md](LOGIC.md).

## Requirements

| What | Why | Note |
| --- | --- | --- |
| SpaNET SV3 | serial text protocol on EXP1 | Look at the logic board: RJ45 ports T/P1, EXP1, ... |
| **ESPHome Device Builder** app | build and flash the firmware | Or `esphome` on a computer |
| **ESPHome** integration | the device in HA | |
| **File editor** app (HA OS/Supervised) | `deploy.py` puts the files in `/config/esphome/` | Without it: copy them yourself, see `deploy.py --dry-run` |
| Multimeter | measure the EXP1 voltages before you connect | |
| No SmartLINK on the same port | the ESP32 and the SmartLINK use the same pins | A SmartLINK on another EXP port: not tested |

## Fields in `house.yaml`

Everything is optional, see the section `spa:` in `house.example.yaml`: `name` (default `jacuzzi`), `display_name`, `probes` (DS18B20 water and air, default on), `lid` (reed contact, default on). Add `spa-spanet` to `modules:`. `house.language` names the entities (see "Entity ids depend on house.language").

Filled in: device `<@ device_name @>`, probes <@ probes_state @>, lid contact <@ lid_state @>.

## Parts

| Part | Qty | Note |
| --- | --- | --- |
| ESP32 DevKit (WROOM-32, CP2102, 30 pins) | 1 | board `esp32dev` |
| Step-down MINI560 (PRO), 5.5–32 V to 3.3 V | 1 | powered from EXP1 pin 8 (12–13 V) |
| Resistor 220 Ω (330 Ω works too) | 2 | in series in the two data lines |
| RJ45 breakout with screw terminals | 1 (2 with logo) | A = EXP1 in; B = on to the logo, only with a Vortex logo |
| Patch cable CAT6, 0.5 m | 1 (2 with logo) | EXP1 to breakout A (and B to the logo) |
| DS18B20 waterproof probe (4 m water, 1 m air) | 2 | only with `probes: true` |
| Resistor 4.7 kΩ | 2 | pull-up per probe |
| MC-38 reed contact + flat neodymium magnet | 1 + 1 | only with `lid: true`; not waterproof: seal it |
| Enclosure Kradex Z74 (176 × 126 × 57 mm, IP65) | 1 | |
| Cable gland M25 (patch cables) and M12 3–6.5 mm (sensor cables) | 2 + 3 | drill templates in `3d/` |
| Perfboard 9 × 15 cm (54 × 33 holes), female pin headers, screw terminals | 1 | final build |
| Self-tapping screws 2.9 × 6.5 mm | 4 | perfboard on the inner floor posts |
| USB-serial adapter 3.3 V (e.g. CP2102) | 1 | only for the bench test with the simulator |

## Wiring

| EXP1 pin | Function | To |
| --- | --- | --- |
| 1 | +13 V for the Vortex logo | breakout B terminal 1 (only with logo) |
| 2 | control signal logo (3.3 V) | breakout B terminal 2 (only with logo) |
| 5 | data from the spa | 220 Ω to GPIO16 (RX2) |
| 6 | data to the spa | 220 Ω to GPIO17 (TX2) |
| 7 | GND | GND of the ESP32 and the step-down (and breakout B terminal 7) |
| 8 | VIN 12–13 V | step-down IN+, OUT 3.3 V to the 3V3 pin of the ESP32 |

| Sensor | To |
| --- | --- |
| DS18B20 water: yellow / red / black | GPIO4 / 3V3 / GND, 4.7 kΩ between yellow and 3V3 |
| DS18B20 air: yellow / red / black | GPIO18 / 3V3 / GND, 4.7 kΩ between yellow and 3V3 |
| MC-38 reed contact | GPIO19 and GND (internal pull-up) |

Drawings in `fritzing/` (the labels and notes in the drawings are Dutch; the file names are kept because the drawings refer to each other):

- `jacuzzi-bedrading.png` (+ `.fzz`): the principle;
- `jacuzzi-testopstelling.png` (+ `.svg`): bench setup without soldering (breadboard + screw terminal board) with a test plan in 6 steps;
- `jacuzzi-gaatjesprint.png` (+ `.svg`): the final perfboard, top and bottom with a wire list;
- `jacuzzi-montage.png` (+ `.fzz`): variant with a screw terminal board and Wago connectors.

**Measure before you connect the ESP32** (COM on pin 7): pin 8 ≈ 12–13 V; pins 5 and 6 at idle ≈ 3.3 V. If you measure 5 V on pin 5 or 6: a voltage divider or level shifter on RX, otherwise the ESP32 dies. Do not use an "ethernet splitter" to share EXP1: it splits the pairs over two ports. Every pin must run through 1-to-1.

**Never USB and the step-down at the same time** on the ESP32: flash first, after that only the spa as power supply (updates go wirelessly).

## Enclosure and mechanics

- Kradex Z74. The perfboard sits directly on the 4 inner floor posts (drill 4 holes of 3 mm at 27.1 and 119.1 mm from the left edge, 4.8 and 85.1 mm from the bottom edge of the perfboard); no base plate needed.
- `3d/spa-drill-template-min-x.stl` (2× M25, EXP1/logo side) and `3d/spa-drill-template-plus-x.stl` (3× M12, sensors): flat against the inside of the wall, bottom edge on the floor, pre-drill through the small centre hole. Preview: `3d/preview-drill-templates.png`. Source: `3d/spa-base-plate.scad` (`part = "drill_xmin"` / `"drill_xplus"`). The shipped STLs still carry Dutch labels (LUCHT = air, DEKSEL = lid, "wand" = wall, "onderrand = bodem" = bottom edge = floor); re-export from the `.scad` for English labels.
- `3d/gland-sleeve.stl` (+ `.scad`): split sleeve that replaces the rubber insert of the M25 gland, so a patch cable with its plug fits through and is still clamped. Print in flexible filament (TPU, e.g. shore 40D), 2 walls, 25 % concentric infill. **Measure** the rubber insert and your cable first and adjust the sizes at the top of the `.scad`. Preview: `3d/preview-gland-sleeve.png`.
- Reed contact on the side of the tub, magnet on the lid right opposite (switching distance ± 18 mm). Sheltered corner, seal the connections.

## Install

1. Add `spa-spanet` to `modules:` in `house.yaml`, fill in the section `spa:` if you want and run `fill.py`.
2. Secrets in the Device Builder (**Secrets**): the keys from `secrets.example.yaml`; `spa_api_encryption_key` with `openssl rand -base64 32`.
3. Place the files:

   ```bash
   cd build
   uv run --with-requirements requirements.txt python spa-spanet/deploy.py --dry-run
   uv run --with-requirements requirements.txt python spa-spanet/deploy.py
   ```

   That puts `/config/esphome/<@ device_name @>.yaml` and `/config/esphome/spanet.h` (the parser the firmware includes). It flashes nothing.

Upgrading from an older version of the kit: the secret used to be called `jacuzzi_api_encryption_key`. Add `spa_api_encryption_key` with the same value (`deploy.py` reports it as missing until you do).

## Flashing

1. **First over USB, on the desk**: ESP32 to the computer, Device Builder: card `<@ device_name @>` > **Install** > **Plug into this computer** (or "Manual download" + https://web.esphome.io). Or on a computer: `uvx esphome==2026.9.0 run <@ device_name @>.yaml` in a folder with that file (`esphome/jacuzzi.yaml` of the build, renamed), `spanet.h` and your own `secrets.yaml`.
2. **Bench test** with the simulator (see below) before you open the box.
3. Afterwards wirelessly: **Install** > **Wirelessly**. Note: `esphome upload` flashes the last compiled build; after a change use `esphome run`.

## Bench test (without a spa)

`esphome/tools/spanet_sim.py` behaves like an SV3 on EXP1 (RF, W40/W66/W63/W60/W90/W12, heat model). Wiring with a USB-serial adapter at **3.3 V**: adapter TXD to GPIO16, adapter RXD to GPIO17, GND to GND; the ESP32 on its own USB. Leave VCCIO, RTS and CTS of the adapter unconnected.

```bash
cd spa-spanet/esphome
uv run --with pyserial python tools/spanet_sim.py --selftest                      # protocol over a virtual port
uv run --with pyserial python tools/spanet_sim.py --port /dev/cu.usbserial-XXXX --speed 60
c++ -std=c++17 -O1 -o /tmp/spanet_test test/spanet_test.cpp && /tmp/spanet_test   # parser (same spanet.h as the firmware)
```

In HA the values of the simulator come in; a new target temperature shows up in the simulator as `W40:...`.

## What ends up in Home Assistant

One ESPHome device "<@ friendly @>" with, among others, water temperature (spa<% if probes %> and probe<% endif %>), target temperature (number), operating mode, Power Save and filtration (selects/numbers), "heating", current and power of the heater, status, sleep timers<% if lid %>, the lid (open/closed)<% endif %>, a button for the sanitise cycle and diagnostics (connected to spa, mains voltage, firmware, raw energy fields). The names are in `house.language`; for this house (language `<@ lang @>`) the water temperature is `sensor.<@ entity_prefix @>_<@ id_water @>`.

No automations: a bath planner (heating on solar or cheap quarter hours towards a bath time) is planned with the energy and climate modules.

## Entity ids depend on house.language

Home Assistant builds an ESPHome entity id from the friendly name of the device and the name of the entity. The entity names of this firmware come from `strings.yaml` in `house.language`, so **the entity ids depend on the language you fill in with**. `nl` keeps the names of the first version of this module, so an installation filled in with `nl` keeps its ids. The options of the select "Power Save" (Off/Low/High, Uit/Laag/Hoog) and the word "day" in the sleep timer states follow the same language. Status, Firmware, Model, Power Save and the operating modes (NORM, ECON, AWAY, WEEK) are the same in both.

| Entity | `language: en` | `language: nl` |
| --- | --- | --- |
| water temperature (spa) | `sensor.<prefix>_water_temperature` | `sensor.<prefix>_watertemperatuur` |
| water temperature (probe) | `sensor.<prefix>_water_temperature_probe` | `sensor.<prefix>_watertemperatuur_sonde` |
| air temperature (probe) | `sensor.<prefix>_air_temperature_at_the_spa` | `sensor.<prefix>_luchttemperatuur_bij_de_jacuzzi` |
| target temperature | `number.<prefix>_target_temperature` | `number.<prefix>_doeltemperatuur` |
| operating mode | `select.<prefix>_operating_mode` | `select.<prefix>_werkmodus` |
| heating | `binary_sensor.<prefix>_heating` | `binary_sensor.<prefix>_verwarmt` |
| lid | `binary_sensor.<prefix>_lid` | `binary_sensor.<prefix>_deksel` |
| connected | `binary_sensor.<prefix>_connected_to_spa` | `binary_sensor.<prefix>_verbonden_met_spa` |

The full list of names is in `strings.yaml`. Switching the language of an existing device creates new entities (and a gap in the history); rename the new ones in HA if you want to keep the old ids.

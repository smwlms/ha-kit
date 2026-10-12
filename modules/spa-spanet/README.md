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
> - **Status: in production at the source since 2026-10-11.** The ESP32 runs on a real SV3 (tested on a Vortex spa with SV3, firmware SW V6 21 04 21): the EXP1 voltages were measured, every field in "How the status is read" was compared with the touchpad, every control of this firmware (target temperature, operating mode, Power Save, filtration hours and cycle, sanitise cycle) was written and read back, and the power correction was compared with the phase of the digital meter. Not tested on the spa: the probes and the lid contact (the tested installation runs without them, `probes: false`, `lid: false`) and a Vortex logo looped through breakout B. The kit module itself is not deployed yet.

An ESP32 takes the place of the SpaNET SmartLINK wifi module: it talks to the controller through the EXP1 port (serial, 38400 baud), reads the status every 10 s and sets target temperature, operating mode, Power Save and filtration. It computes the real power of the spa and keeps its own energy counter for the Energy dashboard. Two optional probes measure the water and air temperature, also while the pump is off, and an optional reed contact sees whether the lid is open. Local, without a cloud.

How it works, what it reads and controls, and the test plan: [LOGIC.md](LOGIC.md). Which field means what, and the pitfalls found on the real spa: "How the status is read" and "Power and energy" below.

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

Everything is optional, see the section `spa:` in `house.example.yaml`: `name` (default `jacuzzi`), `display_name`, `probes` (DS18B20 water and air, default on), `lid` (reed contact, default on), `current_noise_floor` and `current_dead_band` (in A, defaults 6.4 and 7.0, see "Power and energy"). Without the hardware, set `probes` and `lid` to `false`: a floating input shows a fake temperature or an open lid. Add `spa-spanet` to `modules:`. `house.language` names the entities (see "Entity ids depend on house.language").

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
| 8 | VIN 12–14 V | step-down IN+, OUT 3.3 V to the 3V3 pin of the ESP32 |

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

**Measure before you connect the ESP32** (COM on pin 7): pin 8 ≈ 12–14 V; pin 5 (data from the spa) at idle ≈ 3.3 V. Measured on the tested SV3: pin 8 = 14 V, pin 5 = 3 V, pin 6 = 5 V (a pull-up on the input of the spa; the ESP32 drives it through 220 Ω and the spa accepts 3.3 V). If you measure 5 V on **pin 5**: a voltage divider or level shifter on RX, otherwise the ESP32 dies. A short between pin 7 and pin 8 damages the spa. After switching the spa on, it answers only after 30–60 s. Do not use an "ethernet splitter" to share EXP1: it splits the pairs over two ports. Every pin must run through 1-to-1.

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

## How the status is read

The ESP32 sends `RF` every 10 s; the spa answers with one line per register (`,R2,62,228,...,:`). Field n is the n-th value after the register name (the numbering of wayne-love/ESPySpa). The parser is `esphome/spanet.h`; `esphome/test/spanet_test.cpp` checks it against a reply of a real SV3. Everything below was compared with the touchpad of a real SV3 on 2026-10-11, by changing one thing at a time and diffing the replies; the source of each meaning is in the last column.

| Register | Field | Meaning | Unit / scale | Pitfall |
| --- | --- | --- | --- | --- |
| R2 | 1 | total current of the spa | 0.1 A | includes a noise floor of about 6.4 A: see "Power and energy" |
| R2 | 2 | mains voltage | V | |
| R2 | 3 | control box temperature | °C | |
| R2 | 5–11 | clock of the spa: weekday (Monday = 0), hour, minute, second, day, month, year | | not published; Power Save and sleep timers follow this clock |
| R2 | 12 | heater temperature | 0.1 °C | the water temperature after 2.5–3 min of flow, see pitfall 4 |
| R2 | 14 | water present | 1 = yes | |
| R3 | 1 | current limit C.LMT | A | set in the hidden installer menu; limits only the heater, not pumps or blower |
| R3 | 6, 7 | firmware, model | text | e.g. `SW V6 21 04 21`, `SV3` |
| R3 | 20 | status | text | seen: `Auto`, `In use`, `Sleeping`, `W.CLN`, `Filtering`; see pitfall 5 |
| R3 | 22 | heater current | 0.1 A | |
| R4 | 1 | operating mode | NORM, ECON, AWAY, WEEK | |
| R4 | 10 | power | W × 10 (R2 current × voltage) | includes the noise floor: published as "Power (raw)", not usable |
| R4 | 11, 12, 13 | energy total, today, yesterday | 10 Wh | include the noise floor: the tested spa reported 40.5 kWh for a day on which the whole house used 31.8 kWh; 11 and 12 are published as raw diagnostics |
| R5 | 5, 6, 8 | pump A, B, C switched on (touchpad or `S22`–`S24`) | 0/1 | **not** "running": stay 0 during CLEAN while pumps A and B run; not published |
| R5 | 7 | blower | 1 = on | |
| R5 | 10 | sleep timer active | 1 = yes | |
| R5 | 11 | touchpad used | 1 = yes | **not** "pump runs": stays 0 when a pump starts over EXP1; ESPySpa calls it ozone |
| R5 | 12 | heating | 1 = yes | |
| R5 | 13 | unknown | | **not** automatic filtration (it changes when a jet pump starts); no longer published |
| R5 | 14 | light | 1 = on | |
| R5 | 15 | water temperature | 0.1 °C | updates rarely, see pitfall 4 |
| R5 | 16 | CLEAN (sanitise) running | 1 = yes | R3 status is `W.CLN` meanwhile |
| R5 | 18, 19, 20 | pump A, B, C status | 0 off, 1 on, 4 auto | **the** field for "pump runs", see pitfall 2 |
| R6 | 6, 7 | filtration hours per day, cycle | h | |
| R6 | 8 | target temperature | 0.1 °C | |
| R6 | 10 | Power Save | 0 off, 1 low, 2 high | low = no filtration in the window, high = also no heating |
| R6 | 11, 12 | Power Save begin, end | hour × 256 + minute | bytes stored with +100, see pitfall 1 |
| R6 | 13, 14 | days of sleep timer 1, 2 | code | 128 off, 127 every day, 96 weekend, 31 weekdays; one day: Mon 16, Tue 8, Wed 4, Thu 2, Fri 1, Sat 64, Sun 32 (ESPySpa) |
| R6 | 15, 17 / 16, 18 | sleep timer 1 begin, end / timer 2 begin, end | hour × 256 + minute | as fields 11, 12 |

Not used by the firmware: the light settings (R6 fields 2–5), the time of the daily automatic clean (R7 field 1) and the registers R7–RG.

### Pitfalls found on the real spa

1. **Times with +100.** The touchpad sometimes stores a byte of a time with 100 added: 0x1697 is shown as 22:51 (0x97 = 151), 0x1582 as 21:30 (0x82 = 130), 0x8B00 as "39:00". The parser subtracts 100 from every byte ≥ 100; what is still not a time (hour ≥ 24 or minute ≥ 60) shows as `--:--`. Writing without the +100 works (`W64:2816` = 11:00).
2. **"Pump runs" is R5 fields 18–20, not 5/6/8.** Status 1 = runs for sure (switched on at the touchpad, with `S22`–`S24`, or by CLEAN). Status 4 = auto: the spa decides, and it shows 4 also while sleeping without any flow. Status 4 is therefore no proof of flow. Only a pump that allows it can be on 4 (RG field 7, `1-1-014` = pump A allows 0, 1 and 4); on the tested spa that is pump A, the circulation pump.
3. **R5 field 11 is "touchpad used".** It goes to 1 after a touchpad press, not when a pump starts over EXP1. For "the spa is in use", read the status (R3 field 20).
4. **Water temperature.** R5 field 15 updates rarely: during a test it stayed at 36.0 °C for 8 minutes while the water warmed up to 36.9 °C. R2 field 12 (heater temperature) follows the water once it flows: after 2.5–3 min of flow it is the water temperature (0.1–0.2 °C high when the heater switches on at the same time; at the end of a short heating run up to 0.6 °C high). Without flow it drifts towards the temperature of the pipe. For a fresh reading: run the circulation pump for 3 minutes and read the heater temperature. This firmware does not switch pumps, so it does not do that by itself; the optional water probe measures all the time.
5. **A manual pump start puts the spa "In use" for 45–55 min.** During "In use" the sleep timer does not apply, so the spa can heat (on the tested spa it heated briefly several times). Setting pump A back to auto (`S22:4`) does not end "In use". A command over EXP1 may also start "In use" (seen once, not proven).
6. **The reply to a write is no proof.** The spa repeats the value it got, also when it refuses it (`W64:35584` answered `35584`, the time stayed 11:00). The firmware reads every setting back with `RF` after a write.

## Power and energy

The current meter of the SV3 adds a noise floor in quadrature, like an RMS sum. Measured on the tested spa against the phase it is on (digital meter, P1):

| State | Spa (R2 field 1) | Phase of the spa |
| --- | --- | --- |
| idle, pump A on auto | 6.2 A | 0.9 A (the whole phase) |
| everything off | 6.4 A | 0.8 A |
| blower and heater | 24.0 A | 23.9 A |

So the firmware computes **Power** = √(I² − floor²) × V, with floor `spa.current_noise_floor` (default 6.4 A). A reading below `spa.current_dead_band` (default 7.0 A) counts as 0 W: the floor wanders ±0.2 A, which near the floor would otherwise show as a few hundred watts. The price: the electronics and the circulation pump alone (≤ 0.1–0.4 kW) count as 0. Checked on the tested spa: 4.70 kW against 4.56 kW on the phase while heating at 25 A, 2.37 kW against 2.28–2.33 kW at C.LMT 16 A.

**Energy** is the spa's own counter in the ESP32: the corrected power summed per R2 line (left Riemann sum, every 10 s). A gap of more than 30 s (no link) is not counted. The value is kept in flash every 5 min, so it survives a restart; a power cut loses at most 5 min. It is `total_increasing` in kWh, ready for the Energy dashboard. The spa's own kWh counters (R4 fields 11–13) include the floor and overestimate a lot.

"Heater power" (heater current R3 field 22 × voltage) stays as an approximation of the heater alone.

**Measure your own floor** (it may differ per controller):

1. Find out which phase the spa is on (digital meter per phase, or a clamp meter on the supply cable of the spa).
2. With the heater, the blower and the jet pumps off (for example mode AWAY outside a filtration cycle), read "Total current" for a few minutes, and the real current of that phase. Floor = √(I_spa² − I_real²); with a real current below 1 A that is about I_spa.
3. Dead band = the highest idle reading plus about 0.5 A.
4. Check while heating: "Power" should be within about 5 % of the phase. Put both values in `house.yaml` (section `spa:`), fill in and flash again.

If the idle reading of your spa already matches the clamp meter, set both to `0`: Power is then current × voltage. After a few days, compare "Energy" with the energy of the phase in hours when nothing else runs on it; more than 10 % apart: adjust the floor.

## What ends up in Home Assistant

One ESPHome device "<@ friendly @>" with, among others, water temperature (spa<% if probes %> and probe<% endif %>), target temperature (number), operating mode, Power Save and filtration (selects/numbers), "heating", power of the whole spa (W, corrected) and its energy (kWh, for the Energy dashboard), current and power of the heater, status, pump A/B/C (off/on/auto), blower, light, cleaning, sleep timers<% if lid %>, the lid (open/closed)<% endif %>, a button for the sanitise cycle and diagnostics (connected to spa, mains voltage, firmware, touchpad used, raw power and energy fields). The names are in `house.language`; for this house (language `<@ lang @>`) the water temperature is `sensor.<@ entity_prefix @>_<@ id_water @>`.

Energy dashboard: add `sensor.<@ entity_prefix @>_<@ t('energy') | lower @>` as an individual device (with `sensor.<@ entity_prefix @>_<@ t('power') | lower @>` as its power).

No automations: a bath planner (heating on solar or cheap quarter hours towards a bath time) is planned with the energy and climate modules.

Upgrading from an earlier version of this module: the binary sensor "Automatic filtration" (`nl`: "Filtratie automatisch") is gone, because R5 field 13 turned out not to mean that. Delete the orphaned entity in HA (Settings > Entities). "Power" and "Energy" are new; "Power (raw)" and the raw energy fields stay as diagnostics.

## Entity ids depend on house.language

Home Assistant builds an ESPHome entity id from the friendly name of the device and the name of the entity. The entity names of this firmware come from `strings.yaml` in `house.language`, so **the entity ids depend on the language you fill in with**. `nl` keeps the names of the first version of this module, so an installation filled in with `nl` keeps its ids. The options of the select "Power Save" (Off/Low/High, Uit/Laag/Hoog) and the word "day" in the sleep timer states follow the same language. Status, Firmware, Model, Power Save, the operating modes (NORM, ECON, AWAY, WEEK) and the pump states (off, on, auto) are the same in both.

| Entity | `language: en` | `language: nl` |
| --- | --- | --- |
| water temperature (spa) | `sensor.<prefix>_water_temperature` | `sensor.<prefix>_watertemperatuur` |
| water temperature (probe) | `sensor.<prefix>_water_temperature_probe` | `sensor.<prefix>_watertemperatuur_sonde` |
| air temperature (probe) | `sensor.<prefix>_air_temperature_at_the_spa` | `sensor.<prefix>_luchttemperatuur_bij_de_jacuzzi` |
| power (whole spa, corrected) | `sensor.<prefix>_power` | `sensor.<prefix>_verbruik` |
| energy (own counter) | `sensor.<prefix>_energy` | `sensor.<prefix>_energie` |
| pump A | `sensor.<prefix>_pump_a` | `sensor.<prefix>_pomp_a` |
| target temperature | `number.<prefix>_target_temperature` | `number.<prefix>_doeltemperatuur` |
| operating mode | `select.<prefix>_operating_mode` | `select.<prefix>_werkmodus` |
| heating | `binary_sensor.<prefix>_heating` | `binary_sensor.<prefix>_verwarmt` |
| lid | `binary_sensor.<prefix>_lid` | `binary_sensor.<prefix>_deksel` |
| connected | `binary_sensor.<prefix>_connected_to_spa` | `binary_sensor.<prefix>_verbonden_met_spa` |

The full list of names is in `strings.yaml`. Switching the language of an existing device creates new entities (and a gap in the history); rename the new ones in HA if you want to keep the old ids.

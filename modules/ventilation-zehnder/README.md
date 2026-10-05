# <@ module.name @>

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_ventilation.jinja' import device_name, clime, sniffer, suffix, friendly, entity_prefix with context %>
<% set clime_state = 'on' if clime else 'off' %>
<% set sniffer_state = 'on' if sniffer else 'off' %>
<% set action_prefix = device_name | replace('-', '_') %>
-->

<@ module.description @>.

A small ESP32 (M5Stack AtomS3 Lite) with a CAN module hangs on the ComfoNet bus of the ComfoAir Q and gives Home Assistant everything the ComfoConnect LAN C gives (airflow, temperatures, humidity, bypass, filter, fan speed, boost, away), locally and without a cloud. The base is [yoziru/esphome-zehnder-comfoair](https://github.com/yoziru/esphome-zehnder-comfoair) at a **pinned commit**. When a **ComfoClime** hangs on the same bus, it can optionally come along: read and set over the bus, without its wifi integration.

How it works, what it reads and controls, and the test plan: [LOGIC.md](LOGIC.md).

## Status

| Part | Status at the source | For this house |
| --- | --- | --- |
| Base firmware (yoziru, pinned commit) | running on a ComfoAir Q450 since August 2026 | always |
| ComfoCool PDOs (85, 784, 785, 802) | running; disabled sensors | always, harmless without a ComfoCool |
| ComfoClime: reading (PDO decoder node 12) | running since the end of September 2026 | only with `ventilation.comfoclime: true` |
| ComfoClime: setting over the bus (RMI) | compiled and tested on the computer, **not flashed yet** | only with `ventilation.comfoclime: true`; writing is off by default |
| Sniffer (log unknown frames) | running | only with `ventilation.sniffer: true` |

In this house: ComfoClime <@ clime_state @>, sniffer <@ sniffer_state @>.

## Requirements

| What | Why | Note |
| --- | --- | --- |
| Zehnder ComfoAir Q (Q350/Q450/Q600) | ComfoNet bus (CAN, 50 kbit/s) | Tested on a Q450 |
| **ESPHome Device Builder** app in Home Assistant | build and flash the firmware | Or `esphome` on a computer |
| **ESPHome** integration | the device in HA | Offered automatically after flashing |
| **File editor** app (HA OS/Supervised) | `deploy.py` puts the files in `/config/esphome/` | Without it: copy them yourself, see `deploy.py --dry-run` |
| Internet while building | the yoziru packages come from GitHub (pinned commit) | Only when compiling |

Module **base** is not needed: this module does not touch the HA configuration.

## Fields in `house.yaml`

See the section `ventilation:` in `house.example.yaml`:

- `name` (required): device name and file name (`/config/esphome/<name>.yaml`).
- `display_name` (optional): name in HA, sets the entity ids.
- `mac_suffix` (optional): only `true` when your device is already in HA with yoziru's stock firmware (names like `<@ device_name @>-a1b2c3`); otherwise your entity ids change.
- `comfoclime` (optional): `true` when a ComfoClime hangs on the bus. Not sure: leave `false`.
- `sniffer` (optional): `true` for diagnosis (unknown CAN frames in the log).

`house.language` does not matter for this module: see "Entity ids and house.language".

## Parts

| Part | Qty | Note |
| --- | --- | --- |
| M5Stack AtomS3 Lite (ESP32-S3) | 1 | board `esp32-s3-devkitc-1`, 8 MB flash |
| M5Stack Mini CAN Unit (TJA1051T/3) | 1 | powered from the 12 V of the ComfoAir, gives 5 V to the AtomS3 |
| Grove cable, 4 wires | 1 | comes with the Mini CAN Unit |
| 4-wire cable (e.g. shielded 24 AWG) or 4 DuPont wires | 1 | from the ComfoNet connector to the Mini CAN Unit |
| USB-C cable | 1 | only for the first flash |

## Connecting

**Disconnect the ComfoAir from the mains first** (plug out). For the location of the ComfoNet connector follow the installation manual of your unit and `docs/m5stack-atoms3.md` in the yoziru repository (with photos).

| ComfoAir (ComfoNet) | Mini CAN Unit | Note |
| --- | --- | --- |
| 12V (red) | HV | power for the Mini CAN and the AtomS3 |
| GND (black) | GND | |
| CAN_L (white) | CAN_L | |
| CAN_H (yellow) | CAN_H | |

| Mini CAN Unit (Grove) | AtomS3 Lite | |
| --- | --- | --- |
| RXD | GPIO1 | through the Grove cable |
| TXD | GPIO2 | through the Grove cable |
| 5V | 5V | |
| GND | GND | |

The colours are those of the yoziru documentation: check them against the print on your connector. A ComfoConnect LAN C or a ComfoClime on the same bus may stay connected.

## Install

1. Fill in `house.yaml` (section `ventilation:`) and run `fill.py`.
2. Install the **ESPHome Device Builder** app and open it once (creates `/config/esphome/`).
3. Put the secrets in the Device Builder (**Secrets**): the keys from `secrets.example.yaml`. Make `ventilation_api_encryption_key` with `openssl rand -base64 32`. The device's own web page (port 80) is off; `ventilation.web_server: true` turns it on with a login (`ventilation_web_username`, `ventilation_web_password`; basic auth over plain http, so only on a trusted network).
4. Place the files:

   ```bash
   cd build
   uv run --with-requirements requirements.txt python ventilation-zehnder/deploy.py --dry-run
   uv run --with-requirements requirements.txt python ventilation-zehnder/deploy.py
   ```

   That puts `/config/esphome/<@ device_name @>.yaml` in Home Assistant<% if clime %>, plus `components/comfoclime/` (the ComfoClime code)<% endif %>, and reports which keys are still missing in `secrets.yaml`. It flashes nothing.

Upgrading from an older version of the kit: the secret used to be called `ventilatie_api_encryption_key`. Add `ventilation_api_encryption_key` with **the same value** to `secrets.yaml` before you install again; with another value HA asks for the new key (Edge case 4 in LOGIC.md). The entities do not change.

## Flashing

`deploy.py` cannot flash; that happens in the ESPHome Device Builder.

1. **First time over USB**: AtomS3 Lite with USB-C to the computer (Chrome or Edge). Device Builder: card `<@ device_name @>` > **Install** > **Plug into this computer**. Or **Manual download** (format "Factory") and flash through https://web.esphome.io.
2. Connect the AtomS3 to the Mini CAN Unit and that one to the ComfoAir (see "Connecting"), plug the ComfoAir back in.
3. Home Assistant reports a new ESPHome device: **Configure** with `ventilation_api_encryption_key`.
4. Later: **Install** > **Wirelessly**.

**Never** press "Install" on a YAML that follows yoziru's `@main` (the default install from their website): since September 2026 `main` has no API settings any more, and then the device is unreachable for HA. That is why this module pins the commit.

## What ends up in Home Assistant

One ESPHome device "<@ friendly @>" with:

- a `fan` (fan speed 0–3), selects for fan speed, temperature profile, humidity and balance mode, switches "Auto Ventilation" and "Away Mode", buttons for boost and bypass, a `climate` for the temperature profile;
- sensors: airflow and speed of both fans, power and energy, temperatures and humidity of the four air streams, bypass, filter days, season, ...;
<% if clime %>
- ComfoClime: `climate` "ComfoClime" (off / fan only / heat / cool, presets comfort/boost/eco), settings as number, select and switch, sensors (target temperature, indoor temperature, heat pump power, ...), the switch **ComfoClime: allow writes** (off by default) and API actions `esphome.<@ action_prefix @>_comfoclime_get` / `_set`<% if suffix %> (with the MAC suffix after the name)<% endif %>;
<% endif %>
<% if sniffer %>
- diagnostics: switches "Sniff: log unknown frames" and "Sniff: log RMI traffic", button "Sniff: reset log budget", sensor "Sniff: ComfoNet nodes seen";
<% endif %>
- disabled ComfoCool sensors (only useful with a ComfoCool).

No automations: the cooling strategy and control on humidity belong to the module `climate` (planned).

## Entity ids and house.language

**Entity ids do not depend on `house.language` for this module.** Every entity name is English in every language: most entities come from the yoziru packages (pinned commit, not translatable without forking them), and the entities this module adds (ComfoCool, ComfoClime, sniffer) follow the same English names. Filling in with `en` or `nl` gives the same firmware and the same entity ids, so an existing installation keeps its ids.

The entity ids start with the object id of the friendly name "<@ friendly @>": `<@ entity_prefix @>_…` (e.g. `fan.<@ entity_prefix @>_fan`, `sensor.<@ entity_prefix @>_supply_air_temperature`)<% if suffix %>, with the MAC suffix after the name because `mac_suffix` is on<% endif %>.

## Contract with notifications

The module `notifications` reads the filter sensor `sensor.<prefix>_filter_replacement_remaining_days` (yoziru's sensor "Filter Replacement Remaining Days", PDO 192) when `entities.ventilation_filter_days` is empty. For this house: `sensor.<@ entity_prefix @>_filter_replacement_remaining_days`, the same with `en` and `nl`. With `mac_suffix: true` the id cannot be derived: fill in `entities.ventilation_filter_days` yourself.

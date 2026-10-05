# <@ module.name @>

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_climate.jinja' import feat, vent, indoor, outdoor, weather, comfoclime, loud_start, loud_end, boost_below, boost_hours, view_path with context %>
<% set b_floor = 'on' if feat.floor else 'off' %>
<% set b_vent = 'on' if feat.ventilation_cooling else 'off' %>
<% set b_season = 'on' if feat.season_profile else 'off' %>
<% set b_clime = 'on' if feat.comfoclime_boost else 'off' %>
<% set b_shading = 'on' if feat.shading else 'off' %>
<% set b_solar = 'on' if feat.solar else 'off' %>
-->

<@ module.description @>.

**Status: built, not tested on HA.** Contract: [docs/phase4-contracts.md](../../docs/phase4-contracts.md), section 4 "climate". How every decision is made: [LOGIC.md](LOGIC.md).

- Layer: core (brand-free)
- Depends on: - (every block is optional and hides without its provider)
- Provides (capability): -

## What it does

| Block | What | Provider | In this house |
| --- | --- | --- | --- |
| Weather days | `sensor.climate_weather_days`: warmest hour still to come today, 36 h of hourly temperature and cloud, 5 days of max/min | `entities.weather` (required) | on |
| Indoor forecast | `sensor.climate_indoor_peak`: expected indoor peak today, its hour, the kind of day and a floor advice, learned from your own recorder statistics | `entities.indoor_temperature` (required), solar roles (optional) | on (solar term <@ b_solar @>) |
| Floor mode | heating / neutral / cooling chosen once a day over several days; the band goes to the heat pump | a module that provides `heat-pump` | <@ b_floor @> |
| Cooling with outside air | bypass open and the fan harder when it is warm inside and cooler outside; high only in the loud hours | ventilation roles (derived with `ventilation-zehnder`) | <@ b_vent @> |
| Season profile | temperature profile of the ventilation follows its own season detection | ventilation roles | <@ b_season @> |
| ComfoClime boost | short heat boost of the supply air on a cold dip, back to the previous mode afterwards | `entities.comfoclime` or `ventilation.comfoclime` | <@ b_clime @> |
| Shading block | blinds on the screen (closed against the sun, hold) | module `shading` | <@ b_shading @> |
| Climate screen | `custom:climate-screen-card`, tabs Status, Controls, Smart, Settings, Details | module `base` (cw-thema.js) | always |

Daily cooling is done only by the ventilation (and the ComfoClime). The floor cools only preventively in a warm spell: at least 3 warm days in a row, at least 3 days per mode, heating and cooling always through neutral. The ventilation runs on high only in the loud hours (here <@ loud_start @>-<@ loud_end @>).

## Requirements

| What | Why | Note |
| --- | --- | --- |
| Weather integration with an hourly and a daily forecast (e.g. Met.no) | weather days, cloud cover, floor decision | `entities.weather` |
| Recorder on **SQLite** (Home Assistant's default) | the indoor forecast reads the hourly long-term statistics read-only from `/config/home-assistant_v2.db` | with MariaDB or PostgreSQL the forecast stays unavailable; the floor decision then works without its veto |
| Indoor temperature with `state_class: measurement` | without it there are no statistics to learn from | most temperature sensors have it |
| Module **base** | `packages/`, `templates/`, `command_line/` in `configuration.yaml`, `cw-thema.js` for the screen | |
| A **heat-pump** module (e.g. `heat-pump-vaillant`), optional | floor mode | deploy it before this module |
| **ventilation-zehnder** or your own ventilation roles, optional | cooling with outside air, season profile, ComfoClime | with `ventilation.mac_suffix: true` fill in the roles yourself |
| Module **shading**, optional | shading block on the screen | deploy it before this module |

## Fields in `house.yaml`

Required: `entities.indoor_temperature`, `entities.weather`, `house.timezone`. Optional: `entities.outdoor_temperature`, `indoor_humidity`, `heat_pump`, the ventilation roles, `comfoclime`, `comfoclime_power_w`, the solar roles, and the section `climate:` (`target`, `comfort`, `floor_mode`, `floor_cooling`, `ventilation_cooling`, `season_profile`, `loud_hours`, `comfoclime_boost`, `ventilation_values`, `forecast_days`, `view_path`). Every field is explained in `house.example.yaml`.

The thresholds and bands are helpers you tune in Home Assistant (Settings tab of the screen, or Settings > Helpers); their start values are in `module.yaml` (`defaults:`), set once by `deploy.py`.

## Install

1. Deploy `base`, then the providers you have (`heat-pump-vaillant`, `ventilation-zehnder` + flash, `shading`).
2. Fill in `house.yaml` and run `fill.py`.
3. Place everything:

   ```bash
   cd build
   uv run --with-requirements requirements.txt python climate/deploy.py --dry-run
   uv run --with-requirements requirements.txt python climate/deploy.py --view
   ```

   `--view` writes the view `<@ view_path @>` (panel, `custom:climate-screen-card`) on the Overview (`--dashboard <url_path>` for another dashboard, which must be in storage mode); the dashboard is saved to `backup/` first. Without `--view`, paste `climate/lovelace/climate.yaml` under `views:` yourself.
4. The `/local/` path of the card works only when `/config/www` existed at the start of Home Assistant: restart once after the first upload if the card stays "custom element doesn't exist".
5. Follow the test plan in [LOGIC.md](LOGIC.md).

## What you do in the UI

- Nothing is required. The floor mode can be chosen by hand on the screen (Controls or Settings); a choice by hand also stays 3 days.
- With the ComfoClime of the ventilation firmware: the boost only works while the switch **ComfoClime: allow writes** is on (off by default in the firmware). The screen shows it under Smart and Settings.

## Single writer

`climate_floor_mode_apply` is the only caller of `script.heat_pump_set_floor_band` in the kit. The screen never writes the heat-pump zone directly: it changes `input_select.climate_floor_mode` and the band helpers, and the automation writes them. The quick veto on the screen goes through `script.heat_pump_quick_veto` and is offered only when that script exists.

## Test plan

See [LOGIC.md](LOGIC.md), "Test plan".

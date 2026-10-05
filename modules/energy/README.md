# Energy screens

The live energy screen (flow diagram, home battery, charger and car, hot water and heat pump, price and peak, today's totals, a detail sheet per block), the energy flows per day, and the energy-analysis dashboard with six views: period, power, tariff, consumers, trends and battery.

**Status: built, not tested on HA.** Rendered and checked in a headless browser with a mocked Home Assistant (see LOGIC.md, "Test plan"); the test on a real Home Assistant is still to do.

- Layer: core (UI only: every decision lives in `energy-plan`, `ev-charging`, `hot-water`, the tariff module)
- Depends on: - (each block follows its role in `house.yaml` or its module in `modules:`)
- Provides (capability): -

## What you get

| Dashboard (default url) | Views | Card / resource |
| ----------------------- | ----- | --------------- |
| `energy-screen` | `energy` (panel), `flows` | `custom:energy-screen-card` (`/local/ha-kit/energy/energy-screen.js`), `energy-flows.js` |
| `energy-analysis` | `period`, `power`, `tariff`, `consumers`, `trends`, `battery` | `energy-analysis.js` (bundle, `window.haKitEnergy.<topic>`) |

A view or block whose role or module is missing is left out (never an empty card or a bare dash). Which block needs what: LOGIC.md, "Conditions and decisions".

## Requirements

- Module `base` (its themes, `cw-thema.js`: `cw-kop`, `cw-chip`, `cw-metric`, `cw-status`).
- HACS frontend: **apexcharts-card** (every chart) and **power-flow-card-plus** (the flow diagram).
- Grid import and export in Home Assistant: power (W or kW, `state_class: measurement`) and energy meters (kWh, `total_increasing`; a list of registers is summed). The analysis reads the recorder statistics of these roles, so it shows history from the day the sensors had statistics.
- Optional: the tariff module (`tariff-be`) for prices, the tariff view and the battery savings; `energy-plan` for the day plan of the battery; `charger-zappi` (or another `ev-charger`), `ev-charging`, `heat-pump-vaillant`, `hot-water`, `results`.
- The HA energy dashboard configured (Settings > Dashboards > Energy) for the view `period`: those are HA's own energy cards.

## Fields in `house.yaml`

See `house_fields:` in `module.yaml`; every field is explained in `house.example.yaml`. The short version:

- required: `entities.grid_import_w`, `grid_export_w`, `grid_import_kwh`, `grid_export_kwh`
- optional roles: `grid_phases`, `solar_power_w`, `solar_energy_kwh`, `battery_soc`, `battery_power_w` (+ `energy.battery_power_sign`), `battery_charge_kwh`, `battery_discharge_kwh`, `house_power_w`, `grid_month_peak_kw`, `grid_quarter_kw`, `co2_fossil_percent`, `solar_forecast_*`, `ventilation_power_w`, `heat_pump_energy_kwh`, `spot_price` (with a tariff module)
- `energy.consumers`: your own measured consumers (spa, washing machine, ...), any number
- `energy.analysis_from`, `dashboards`, `paths`, `peak_target_kw`, `battery_phase`, `away_below_kwh`, `battery_module_kwh`, `battery_efficiency`, `battery_reserve_percent`, `battery_investment_eur`
- `tariff.compare` (variable, fixed, export, fee_eur_per_year): the contracts the tariff view compares with

## Install

```bash
uv run --with-requirements tools/requirements.txt python tools/fill.py house.yaml build/
cd build
uv run --with-requirements requirements.txt python energy/deploy.py --dry-run   # what it would do; writes the JSON
uv run --with-requirements requirements.txt python energy/deploy.py
```

`deploy.py` uploads `packages/energy.yaml` (three helpers), writes the three scripts and the automation through the config API, bundles and uploads the frontend files to `/config/www/ha-kit/energy/` (dashboard resources), and builds and saves both dashboards (a new dashboard is created; an existing one is backed up to `energy/backup/` and replaced). `--no-dashboards` skips the dashboards. Without the File editor app: copy the files of `--dry-run` yourself and paste `energy/dashboard/out/*.json` in the raw configuration editor of a new dashboard.

After changing `house.yaml` (a role, a consumer, the language): fill in and deploy again.

## Contracts between modules

| Reads | From | Used for |
| ----- | ---- | -------- |
| `sensor.power_price_import` (attributes `starts`, `prices`, `cheapest_2h`), `_export`, `sensor.power_price_level`, `sensor.capacity_*`, `input_number.tariff_*`, `window.haKitTariff` | tariff module | price card, tariff view, base-load cost, battery savings, capacity tariff |
| `sensor.energy_plan_margin` (attributes), `binary_sensor.energy_plan_battery_behind`, `sensor.energy_plan_house_power` | energy-plan | battery card, plan in the hot-water sheet, house sparkline |
| `sensor.ev_charger_*`, `script.ev_charger_set_mode` | ev-charger (charger-zappi) | charger card, flow diagram, car in the analysis |
| `sensor.ev_charging_*` (the cheap power card: `sensor.ev_charging_cheap_status`), `input_boolean.ev_charging_*`, `input_select.ev_charging_owner`, `counter.tesla_commands_today`, `script.ev_charging_manual_mode` | ev-charging | car card, cheap power card, charging sheet, mode buttons |
| `sensor.hot_water_temperature`, `binary_sensor.hot_water_heating` | hot-water-heater | hot water card |
| `input_boolean.hot_water_shower_tomorrow`, `input_number.hot_water_*`, `sensor.hot_water_*` | hot-water | target, shower button, plan |
| `sensor.heat_pump_state`, `sensor.heat_pump_power_estimated` | heat-pump | flow diagram, hot-water sheet, starts and consumers |
| `sensor.results_saving_*` | results | "saved today" chip |

The mode buttons of the charger card call `script.ev_charging_manual_mode` when `ev-charging` is installed (reason "manual (energy screen)"): ev-charging makes the owner `manual` until the car is unplugged and is still the only caller of `script.ev_charger_set_mode`. Without ev-charging they call `script.ev_charger_set_mode` directly.

## Test plan

See `LOGIC.md`, "Test plan".

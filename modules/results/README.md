# Results

What the smart logic did today and what it saved, in plain language: EUR saved per kind (car on own solar, hot water on surplus or at the cheapest hour, …), whether the day goals were met, consumption and electricity cost per day, week and month, the same kWh on a variable and a fixed contract, this month against last year, and per month the calculation next to the invoice. The logbook lines of the installed modules show "what the house did".

**Status: built, not tested on HA.** Contract: [docs/phase4-contracts.md](../../docs/phase4-contracts.md) (results, events). Every decision and every formula: [LOGIC.md](LOGIC.md).

- Layer: core
- Depends on: `tariff` (a region module such as `tariff-be`)
- Provides (capability): -

## How it stays brand-free

Results only **listens**. Producers fire `ha_kit_result` (`kind`, `kwh`, `eur`, `export_missed`) and `ha_kit_day_goal` (`goal`, `status`, `detail`); results sums them. The one exception is the car on solar: results computes it from the `ev-charger` contract (`sensor.ev_charger_solar_energy_today`) × the import price. A result line exists only when its producer is in `modules:`:

| Line on the screen | Sensor | Producer |
| --- | --- | --- |
| Car charged with own solar | `sensor.results_saving_ev_solar` | `ev-charging` + an `ev-charger` adapter with a solar counter |
| Hot water at the cheapest hour | `sensor.results_saving_hot_water_cheap_hour` | `hot-water` |
| Hot water from solar surplus | `sensor.results_saving_hot_water_solar` | `hot-water` |
| Car charged on cheap power | `sensor.results_saving_ev_cheap` | `ev-charging` (shown once it sends one) |
| Appliances on solar / at the cheapest moment | `sensor.results_saving_appliance_solar`, `_appliance_cheap` | `appliances-home-connect` (shown once it sends one) |
| Month peak kept low | `sensor.results_saving_peak_avoided` | `ev-charging` or `hot-water` (shown once one sends one) |
| Sun kept outside (count, no EUR) | `sensor.results_shading_closed_count` | `shading` (rooms whose blind closes on sun) |
| Goal hot water in the morning / for the bath | `sensor.results_goal_morning`, `_bath` | `hot-water` (bath with `hot_water.bath: true`) |
| Goal solar used well, solar missed today | `sensor.results_goal_solar_used`, `sensor.results_solar_missed_today` | results itself, with solar and `hot-water` or an `ev-charger` |

`ev_cheap`, `appliance_solar`, `appliance_cheap` and `peak_avoided` are extensions beyond the first contract: the event data a producer must send is in [docs/phase4-contracts.md](../../docs/phase4-contracts.md), section 5. No producer sends them yet (open point there); their sensors exist and stay hidden on the screen until a first event.

## Requirements

| What | Why |
| --- | --- |
| Module `base` | `packages/`, `templates/` and `custom_templates` in `configuration.yaml`; `cw-thema.js` (header, buttons) |
| A module that provides `tariff` | prices (`sensor.power_price_import/_export`), capacity tariff, `window.haKitTariff` for the contract comparison |
| Energy meters in `house.yaml` | `entities.grid_import_kwh`, `grid_export_kwh` (required); `solar_energy_kwh`, `battery_charge_kwh`, `battery_discharge_kwh` (optional) |
| Recorder with long-term statistics (default) | week, month and per-month figures come from the statistics |

## Fields in `house.yaml`

- `entities.grid_import_kwh`, `grid_export_kwh` (required), `solar_energy_kwh`, `battery_charge_kwh`, `battery_discharge_kwh`, `solar_power_w` (optional).
- `results.exact_from` (optional): first month whose cost is at the dynamic price; earlier months show "–".
- `results.cost_sensors.import/export` (optional): the cost and compensation sensors HA's energy dashboard creates. Without them the cost is estimated per hour from the price statistics (marked ≈).
- `results.last_year` (optional, local only): `{month, kwh, eur}` per month of your last settlement, for "compared with last year".
- `results.view_path` (optional, default `results`), `results.log_entities` (optional): extra entities whose logbook lines show under "What the house did".
- `tariff.compare` (optional): start values of the comparison helpers (c€/kWh energy price incl. VAT, without grid fee and levies).

## What you do in the UI

- Every month: enter the invoice amount in **Invoice last month** (`input_number.results_invoice_last_month`); it is kept for the previous month and appears next to the calculation.
- Once: the prices of the contracts to compare with (**Compare: …**, c€/kWh). 0 = that contract is not compared.
- Optional: **Solar missed: most for the goal** (default 1 kWh).

## Install

```bash
uv run --with-requirements requirements.txt python results/deploy.py --dry-run            # what it would do
uv run --with-requirements requirements.txt python results/deploy.py --dry-run --live     # + real diff of the dashboard (read-only)
uv run --with-requirements requirements.txt python results/deploy.py [--dashboard <url_path>]
```

Deploy `base` and the tariff module first. The view is added as the last view of the Overview (or of `--dashboard`); an existing view with the same path is replaced in place. The savings count from the first event after the deploy.

## Test plan

See `LOGIC.md`, "Test plan".

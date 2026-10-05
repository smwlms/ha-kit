<% from '_tariff.jinja' import own_quarter, connection_kw with context %>
# <@ module.name @>

<@ module.description @>.

One module answers "what does a kWh cost now and in the coming hours" and "how much may I still draw this quarter hour without raising the month peak" for a Flemish household with a dynamic contract and a digital meter. Charging, hot water, appliances, notifications and the result screens read its sensors; none of them knows the formula.

How every number is made, with the formula and where each coefficient comes from, is in [LOGIC.md](LOGIC.md). The test plan is there too.

- Layer: region
- Depends on: -
- Provides (capability): `tariff` (contract: [docs/phase4-contracts.md](../../docs/phase4-contracts.md), section 3)

## Requirements

| What                                                       | Why                                                                                 | Note                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Module **base**                                            | `packages/`, `templates/` in `configuration.yaml`                                   | First `base/deploy.py`                                                                                     |
| Home Assistant 2025.10 or newer (tested on 2026.9)         | `default_entity_id`, `nordpool.get_prices_for_date`, quarter-hour Nord Pool prices  | `automation: !include automations.yaml` (HA's default)                                                     |
| HA OS or Supervised + the **File editor** app              | `deploy.py` uploads through the File editor                                         | Without it: copy the four files yourself, see `deploy.py --dry-run`                                       |
| Integration **Nord Pool** (built in), area BE, currency EUR | day-ahead price per quarter hour (Belpex) of today and tomorrow                     | `entities.spot_price` = any of its entities; the module finds the config entry from it                      |
| **Digital meter** with its P1 port in HA (SlimmeLezer, DSMR, HomeWizard, ...) | import power (`grid_import_w`) and the import registers (`grid_import_kwh`)          | Power may be in W or kW: the module reads the unit                                                         |
| Meter registers month peak, average peak, quarter average (**optional**) | the meter's own capacity values (OBIS 1.6.0, 0-0:98.1.0, 1.4.0)                      | Empty: the module meters the quarter itself (one restart after the first deploy)                           |
| A **dynamic** electricity contract                         | the formula is factor x spot + markup                                               | Fixed or variable contract: this module does not fit (see LOGIC.md, "What it does not do")                 |
| Python 3.11 + [uv](https://docs.astral.sh/uv/)             | `fill.py`, `deploy.py`                                                              |                                                                                                            |

## What it provides

| Entity / file                                  | What                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sensor.power_price_import`                    | all-in import price of the running quarter hour, EUR/kWh; the coming 24 h in `starts`/`prices`          |
| `sensor.power_price_export`                    | export price of the running quarter hour, EUR/kWh (may be negative); `negative_coming`                   |
| `sensor.power_price_level`                     | `negative`, `very_cheap`, `cheap`, `normal`, `expensive`, `very_expensive`, `unknown`                    |
| `binary_sensor.power_price_cheap`              | on at a negative export price or an import price at or below `input_number.power_price_cheap_below`     |
| `sensor.power_tariff_period`                   | `day` or `night`: which register of the meter counts now                                                 |
| `sensor.capacity_quarter_expected_kw`          | projected average of the running quarter hour, kW                                                        |
| `sensor.capacity_month_peak_kw`                | highest quarter of this month, kW (attributes `month`, `at`)                                             |
| `sensor.capacity_average_peak_kw`              | mean of the last 12 month peaks (what the capacity tariff bills), kW; `peaks`, `months_known`, `cost_eur_per_year` |
| `sensor.capacity_headroom_kw`                  | what may still be drawn this quarter without raising the month peak, kW; `limit_kw`                     |
| `custom_templates/tariff.jinja`                | `price_at(ts)`, `reference_price()`, `import_price()`, `export_price()`, `is_night()` and the capacity helpers |
| `/local/ha-kit/tariff/tariff.js`               | `window.haKitTariff` for dashboards: `importPrice`, `exportPrice`, `isNight`, `area`, `currency`        |
| helpers                                        | grid fees, levies, capacity tariff, fixed costs, cheap threshold, start peak, margin, "peak may rise"   |
| `automation.capacity_start_peak_from_meter` (id) | copies the meter's average peak into the start peak (only with `entities.grid_average_peak_kw`)       |

## Privacy

The prices come from Nord Pool through the Home Assistant integration; nothing about your house is sent. Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

| Field                                   | What                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `entities.spot_price`                   | any entity of the Nord Pool integration (e.g. its current price sensor); never write a config entry id yourself                  |
| `entities.grid_import_w`                | power taken from the grid now (W or kW)                                                                                           |
| `entities.grid_import_kwh`              | import registers in kWh; a list is summed (day + night register)                                                                  |
| `entities.grid_month_peak_kw` (optional) | the meter's month peak register; empty = computed from the quarter-hour meter                                                    |
| `entities.grid_average_peak_kw` (optional) | the meter's average of the month peaks; empty = no automation that copies it into the start peak                               |
| `entities.grid_quarter_kw` (optional)   | the meter's running quarter-hour average; empty = the module meters the quarter itself                                            |
| `tariff.area`                           | Nord Pool area, `BE`                                                                                                              |
| `tariff.import`                         | `factor`, `markup` (c€/kWh), `vat` (1.06 = 6 %) from your supplier's tariff card                                                  |
| `tariff.export`                         | `factor`, `deduction` (c€/kWh) from your supplier's tariff card                                                                    |
| `tariff.night`                          | `start`, `end` (whole hours, local time) and `weekend` (true = the whole weekend at night tariff)                                 |
| `tariff.grid`                           | start values of the grid fees `day`, `night` and the `levies`, c€/kWh incl. VAT                                                   |
| `tariff.capacity`                       | `eur_per_kw_year`, `minimum_kw` (2.5 in Flanders) and optional `connection_kw` (default 9.2)                                     |
| `tariff.fixed_eur_per_year` (optional)  | supplier fee + data management per year (read by results); default 0                                                              |
| `tariff.cheap_below` (optional)         | start value of the cheap threshold, EUR/kWh all-in; default 0.15                                                                  |
| `house.timezone`                        | the night register in `tariff.js` follows the house, not the browser                                                              |

The coefficients of `tariff.import`, `tariff.export` and `tariff.night` are written into the macros and the JS when filling in: after a new tariff card, change them in `house.yaml`, fill in and deploy again. The grid fees, levies, capacity tariff and fixed costs are helpers: after the first deploy you change them in Settings > Helpers (they change every January) and filling in again does not overwrite them.

## Install

1. **Nord Pool**: Settings > Devices & services > Add integration > Nord Pool, area **BE**, currency **EUR**. Put one of its entities in `entities.spot_price`.
2. **Meter**: check the unit of `entities.grid_import_w` and that the import registers are in kWh. Fill in the three meter registers when your P1 reader offers them (SlimmeLezer: "Month peak", "Average peak 13 months", "Quarter-hour average"). Look at the graph of the quarter register first: it must rise during each quarter hour and drop back at :00, :15, :30, :45 (see LOGIC.md, "Edge cases"). When it does not, leave `grid_quarter_kw` empty.
3. **Tariff card**: fill in `tariff:` from your supplier's and Fluvius' tariff sheets (LOGIC.md, "Settings", says where each number is on them).
4. Fill in and deploy:

```bash
uv run --with-requirements tools/requirements.txt python tools/fill.py house.yaml build/
cd build
uv run --with-requirements requirements.txt python tariff-be/deploy.py --dry-run
uv run --with-requirements requirements.txt python tariff-be/deploy.py
```

<% if own_quarter %>
5. **Restart Home Assistant once** after the first deploy: the quarter-hour meter (`sensor.tariff_grid_import_quarter`) is a `utility_meter`, which cannot be reloaded. `deploy.py` reminds you while it is missing.
<% else %>
5. No restart is needed: with the meter's month-peak and quarter registers the module needs no quarter-hour meter of its own.
<% endif %>
6. **Start peak**: until Home Assistant has measured 12 months, the missing months count as `input_number.capacity_start_peak_kw`. With `entities.grid_average_peak_kw` the automation copies the meter's value; without it, enter the average of your month peaks from the Fluvius portal (Mijn Fluvius > Verbruiksgegevens) yourself.
7. Point the **energy dashboard** at the prices (optional): Settings > Dashboards > Energy > grid consumption > "Use an entity with current price": `sensor.power_price_import`; return to grid: `sensor.power_price_export`.

After a kit update or a change in `house.yaml`: fill in again and run `tariff-be/deploy.py`. The helpers keep their values.

## Using it from another module

```jinja
{% from 'tariff.jinja' import price_at, reference_price %}
{% set later = price_at(now() + timedelta(hours=3)) %}
{{ later | float(0) < reference_price() | float(0) }}
```

```js
// in a dashboard card or an apexcharts data_generator; tariff.js is a dashboard resource
const eurPerKwh = window.haKitTariff.importPrice(belpexEurPerMwh, quarterStart, hass);
```

`sensor.capacity_headroom_kw` is what a charger or boiler may add on top of what the house already draws. Another country is another region module with the same entity ids (`provides: [tariff]`).

## Test plan

See `LOGIC.md`, "Test plan".

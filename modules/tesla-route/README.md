# <@ module.name @>

<@ module.description @>.

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% set withgate = 'gate' in modules %>
<% set gatenote = 'Module gate is in your modules: the arrival card gets the gate row.' if withgate else 'Module gate is not in your modules: the arrival card shows trips home as a regular trip, without gate row.' %>
-->

Three parts:

- **`teslemetry_route`**: own integration that exposes the route the Tesla plans itself (Fleet Telemetry `RouteLine`) as a sensor per car: `sensor.<car>_tesla_route`.
- **`tesla-map-card.js`** (`custom:tesla-map-card`): all cars on one map, with battery and "home".
- **`tesla-arrival-card.js`** (`custom:tesla-arrival-card`): one card per car on the road, with arrival time, route (coloured by traffic), who is in it and, with module gate, what the gate does on arrival. <@ gatenote @>

The texts on the cards and the number and time format follow `house.language` (texts in `strings.yaml`).

How every decision is made is in [LOGIC.md](LOGIC.md). The test plan is there too.

## Requirements

| What                                                        | Why                                                                         | Note                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Module **base**                                             | its themes (`--cw-*` colours), `www/`                                       | Without a base theme the cards fall back to fixed dark or light colours           |
| Home Assistant 2025.x or newer (tested on 2026.9)           | `AddConfigEntryEntitiesCallback`, dashboard resources over the websocket    |                                                                                   |
| HA OS or Supervised + the **File editor** app               | `deploy.py` uploads through the File editor                                 | Without it: copy the files yourself, see `deploy.py --dry-run`                    |
| Integration **Teslemetry** with streaming (Fleet Telemetry) | position, navigation, route                                                 | See "Teslemetry: shared account"                                                  |
| **Companion app** on the phones (optional)                  | who is in the car                                                           | Location on **Always**                                                            |
| **Mapbox public token** `pk.…` (optional)                   | dark/light map with live traffic, route coloured by traffic, place names    | Without a token: OpenStreetMap + OSRM, grey route. Create it **without URL restriction**, separate token, see Privacy |
| Internet in the browser                                     | Leaflet from cdnjs (pinned with SRI), map tiles, routes                     | No HACS needed                                                                    |
| Module **gate** (optional)                                  | mode "home" and the gate row on the arrival card                            | No hard dependency                                                                |

## Privacy

Every browser that opens these cards (phone, tablet, wall screen) talks to outside services itself:

- **Leaflet** comes from cdnjs, pinned with Subresource Integrity (the browser refuses any other file).
- **Map tiles** from Mapbox (with a token) or OpenStreetMap: they see which area you look at.
- **Routes and place names**: the position of the car, its destination and home go to Mapbox (Directions, Map Matching, reverse geocoding) or, without a token, to the public OSRM server. `routing: none` in the arrival card config stops those requests; the Tesla's own route is still drawn.
- **Mapbox token**: every Home Assistant user can read it in the card config. Use a separate public token only for this card, with a usage alert in your Mapbox account, and rotate it when it is abused (URL restriction does not work, see LOGIC.md).

Overview: the kit's README, section "Privacy & external services".

## Build order

The commands run from `build/` with `HA_URL` and `HA_TOKEN` set (see the kit's README).

1. **`house.yaml`**: `cars[]` (prefix, name, driver, optionally color, badge, entities), `people[]` (phone) and `teslemetry:` (entity names, see below). Example: the same sections in `house.example.yaml`. Run `tools/fill.py`.
2. **Enable the Teslemetry sensors:** `tesla-route/deploy.py --dry-run --setup`, then `tesla-route/deploy.py --setup`. Then reload Teslemetry.
3. **Upload:** `tesla-route/deploy.py`. That puts the integration in `/config/custom_components/teslemetry_route/` and the two cards in `/config/www/`, and registers them as resources.
4. **Restart** (Settings > System > Restart). Needed for a new integration, and the first time `/config/www` exists.
5. **Add the integration:** `tesla-route/deploy.py --integration` (or Settings > Devices & services > Add integration > "Teslemetry route"). Per car `sensor.<car>_tesla_route` appears, state 0 while there is no route.
6. **Cards on the dashboard:** paste `build/tesla-route/lovelace/arrival.yaml` at the top of your home view and `lovelace/tesla-map.yaml` where you like (Edit dashboard > Add card > Manual). Put your Mapbox token in the card config (`mapbox_token: pk.…`), nowhere else.
7. **Test:** follow the test plan in LOGIC.md.

After a change of a card: `tesla-route/deploy.py` again. The resource gets `?v=VERSION` from the JS file; raise `VERSION` when you change something yourself, otherwise the app shows the old version.

**After every Home Assistant update check** that `teslemetry_route` still loads: it leans on internal structures of the Teslemetry integration.

## Card config

Everything comes from the card config; the cards have nothing about your house built in. `fill.py` writes every entity_id out in the examples.

| Key                                                         | Card     | What                                                                                                                         |
| ----------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `cars[]`: `p`, `name`                                       | both     | prefix and name per car                                                                                                      |
| `cars[].driver`                                             | arrival  | key of the usual driver: shown when no phone is seen in the car                                                              |
| `cars[].color`, `cars[].badge`                              | both     | colour (hex) and badge: `lightning`, `plaid` or your own `<svg>` (48×48). Without: a circle with the initial                 |
| `cars[].entities`                                           | both     | entity_id per role (see LOGIC.md, "Settings"); the kit fills them all in                                                    |
| `people[]`: `name`, `key`, `tracker`                        | arrival  | phones for "who is in it"                                                                                                    |
| `gate`: `sensor`, `relay`, `open_script`, `close_script`    | arrival  | gate row; without `gate` no gate row. Without `sensor`: state unknown. Also `enabled`, `dry_run`, `last`, `zone`, `away_minutes`, `far_distance` (default: the ids of module gate) |
| `home`                                                      | both     | zone of home, default `zone.home`                                                                                            |
| `mapbox_token`                                              | both     | public token `pk.…`. `tesla-map-card` otherwise looks for it in another card of the same dashboard (`token_dashboard`: another dashboard) |
| `routing`                                                   | arrival  | `auto` (default) or `none`: no route or place-name requests to Mapbox or OSRM (the Tesla's own route is still drawn, grey) |
| `height`                                                    | map      | height in px, default 340                                                                                                    |

## Teslemetry: shared account

When the cars are on a Teslemetry account you share with others, work with your own access token.

- Add Teslemetry with your token. **All** cars of the account appear. **Disable the devices that are not yours.** `teslemetry_route` also creates a route sensor for those cars: disable it along with them (they hang on the same device).
- Enabling an entity turns the field on in that car's streaming configuration at Teslemetry. That configuration is shared per car between all installations on the account; turning it on bothers nobody. `teslemetry_route` turns on the field `RouteLine` this way.
- **Credits:** this module sends no commands at all. Streaming (position, navigation, route) costs no credits. Commands (module gate: charge cable) cost credits of the account; do not send them to cars that are not yours.

## Entity names

`teslemetry:` in `house.yaml` sets the entity names per role (`{p}` = prefix). The example uses the **Dutch** names Teslemetry creates when Home Assistant was set to Dutch when the integration was added. Check per car in Settings > Devices > the car > entities.

| Role in `teslemetry:` | Dutch (example)                                               | English (likely, check)             | Used by             |
| --------------------- | ------------------------------------------------------------- | ----------------------------------- | ------------------- |
| `location`            | `device_tracker.{p}_locatie`                                  | `device_tracker.{p}_location`       | cards, gate         |
| `route`               | `device_tracker.{p}_route`                                    | `device_tracker.{p}_route`          | arrival card, gate  |
| `destination`         | `sensor.{p}_bestemming` (disabled by default)                 | `sensor.{p}_destination`            | arrival card, gate  |
| `distance_to_arrival` | `sensor.{p}_distance_to_arrival`                              | same                                | arrival card, gate  |
| `time_to_arrival`     | `sensor.{p}_time_to_arrival`                                  | same                                | arrival card        |
| `traffic_delay`       | `sensor.{p}_traffic_delay` (disabled by default)              | same                                | arrival card        |
| `battery_at_arrival`  | `sensor.{p}_state_of_charge_at_arrival` (disabled by default) | same                                | arrival card        |
| `shift_state`         | `sensor.{p}_shift_state` (disabled by default)                | `sensor.{p}_shift_state`            | arrival card, gate  |
| `speed`               | `sensor.{p}_snelheid` (disabled by default)                   | `sensor.{p}_speed`                  | arrival card, gate  |
| `status`              | `binary_sensor.{p}_status`                                    | `binary_sensor.{p}_status`          | arrival card, gate  |
| `located_at_home`     | `binary_sensor.{p}_thuis_gelegen`                             | `binary_sensor.{p}_located_at_home` | map card, gate      |
| `battery`             | `sensor.{p}_batterijniveau`                                   | `sensor.{p}_battery_level`          | map card            |
| `charging_state`      | `sensor.{p}_opladen`                                          | `sensor.{p}_charging`               | gate                |
| `charge_switch`       | `switch.{p}_opladen`                                          | `switch.{p}_charge`                 | gate                |
| `charge_cable`        | `binary_sensor.{p}_oplaadkabel`                               | `binary_sensor.{p}_charge_cable`    | gate                |
| `charge_cable_lock`   | `lock.{p}_oplaadkabelslot`                                    | `lock.{p}_charge_cable_lock`        | gate                |
| `tesla_route`         | `sensor.{p}_tesla_route`                                      | same (own integration)              | arrival card        |

The route sensor is called "Tesla route" and hangs on the car's device. So its entity_id follows the device's name. When one car differs, put the entity under `cars[].entities` in `house.yaml`.

## Migrating from the Dutch version

Kit versions up to `db5b2fe` used Dutch names for the cards and their config:

| Old                                                                     | New                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `www/tesla-kaart.js`, `custom:tesla-kaart-card`                         | `www/tesla-map-card.js`, `custom:tesla-map-card`                        |
| `www/aankomst-card.js`, `custom:aankomst-card`                          | `www/tesla-arrival-card.js`, `custom:tesla-arrival-card`                |
| `lovelace/tesla-kaart.yaml`, `lovelace/aankomst.yaml`                   | `lovelace/tesla-map.yaml`, `lovelace/arrival.yaml`                      |
| config `autos`, `naam`, `kleur`, `bestuurder`, `thuis`, `personen`      | `cars`, `name`, `color`, `driver`, `home`, `people`                     |
| config `poort`: `relais`, `script`, `sluit_script`, `hoofdschakelaar`, `testmodus`, `laatst`, `minimaal_weg`, `ver_genoeg` | `gate`: `relay`, `open_script`, `close_script`, `enabled`, `dry_run`, `last`, `away_minutes`, `far_distance` |
| badge `bliksem`, `ruit`                                                 | `lightning`, `plaid`                                                    |
| sensor attributes `formaat`, `bijgewerkt`, `ruw_lengte`, `ruw_begin`    | `format`, `updated`, `raw_length`, `raw_start`                          |
| `deploy.py --integratie`                                                | `deploy.py --integration`                                               |

Steps: run `tesla-route/deploy.py` (it uploads the new cards and names the old resources that are still registered), restart once for the new integration version, replace the old cards on your dashboards with `lovelace/arrival.yaml` and `lovelace/tesla-map.yaml`, then remove the resources `/local/tesla-kaart.js` and `/local/aankomst-card.js` (Settings > Dashboards > Resources) and the old files in `/config/www/`.

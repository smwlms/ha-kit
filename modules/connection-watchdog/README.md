# <@ module.name @>

<@ module.description @>.

**Needs:** the `notifications` module (Companion app). No devices of its own: it watches the integrations you name in `house.yaml`, and catches the rest by itself.

**Status: in production at the source since 2026-10-11.** The same logic runs every minute in the author's house as the hand-made setup this module was derived from (about twenty sources: P1 reader, home battery, charger, cars, blinds, curtains, gate, ventilation, heat pump, appliances, cameras, network, speakers, solar forecast, power prices, weather, AI, Zigbee); the kit module itself is not deployed there yet.

Why it exists: an integration that drops out is often noticed late. Three ways it shows up, all three seen in one week at the source:

- **Unreachable**: the integration does not start again (`setup_retry`), or its entities stay `unavailable` after a network hiccup while the integration itself is loaded again. Reloading the config entry is what a person would do; the watchdog does it for you, a few times.
- **Frozen**: the entities keep a value, but no new one comes in (`last_reported` stands still). A plain availability check sees nothing.
- **Stale data**: a cloud API keeps writing the same old figures every minute. Only the timestamp inside the data tells (`data_time`).

How every decision is made, and the test plan, are in [LOGIC.md](LOGIC.md).

## Requirements

| What | Why | Note |
| ---- | --- | ---- |
| Module **base** | `packages/` and `templates/` in `configuration.yaml` | Run `base/deploy.py` first |
| Module **notifications** | the notification goes through `script.send_notification` (its recipients) | Hard dependency; without the script only the persistent notification arrives |
| Home Assistant 2025.4 or newer | `trigger:`/`action:` syntax, `last_reported` | Tested on 2026.9 at the source |
| HA OS or Supervised + the **File editor** app | `deploy.py` uploads the package, the macro and the sensors | Without it: copy the files yourself, see `deploy.py --dry-run` |

## What ends up in Home Assistant

| Kind | Entity | What |
| ---- | ------ | ---- |
| Sensor | `sensor.connection_watchdog` | number of sources that are not ok; attributes `summary`, `problems` (names), `sources` (status per source) |
| Sensor | `sensor.connection_watchdog_test` | the test source (a timestamp that stands still on `frozen`) |
| Helper | `input_select.connection_watchdog_test` | `off`, `ok`, `unreachable`, `frozen` (default `off`) |
| Macro | `custom_templates/connection_watchdog.jinja` | `evaluate()`: the sources of `house.yaml`, the generic catch, the status of each |
| Automation | `connection_watchdog_repair_and_notify` | every minute: reload what is due, one bundled notification, the persistent notification, report back |
| Event | `connection_watchdog_update` | `updates: [{source, kind: attempt, notified or recovered}]`, from the automation to the sensor |
| Card | `custom:connection-watchdog-card` | problems with Reload and Integration buttons, and every source with its status |
| View | `/lovelace/<view_path>` (default `connections`) | the card, the on/off switch of the automation and the test source (`deploy.py --view`) |

Every attribute of `sources[]`: `id`, `name`, `status` (`ok`, `unreachable`, `frozen`), `since`, `attempts`, `max`, `last_attempt`, `notified`, `entries`; while not ok (or notified) also `reason`, `impact`, `action`, `reloadable`, `domain`, `wait`, `notify_after`, `interval`.

## Contracts between modules

| What | Provided by | Read by |
| ---- | ----------- | ------- |
| `script.send_notification` (title, message, extra) | `notifications` | this module (required) |
| `sensor.connection_watchdog` (state = number of problems, attribute `problems`) | this module | `home-screen` (chip "connections", only with this module in `modules:`) |

## Fields in `house.yaml`

Everything under `connection_watchdog:` is optional. Without `sources` the module still works: the generic catch reports every integration that is not loaded and owns unavailable entities, and reloads it twice.

| Field | What |
| ----- | ---- |
| `sources[].id` | lower case, digits and `_`; unique; not `test` and not starting with `entry_` (taken by the test source and the generic catch) |
| `sources[].name` | shown in the notification and on the card |
| `sources[].keys` | entities that must be available. Their config entries are the ones that get reloaded; you never look up an entry id for them |
| `sources[].rule` | `any` (default): one unavailable key is a problem; `all`: only when every key is unavailable (four blinds on one box, two cars on one account) |
| `sources[].silence` | minutes without a new value (newest `last_reported` of the keys) before the source counts as frozen. Leave it empty for integrations that only write on a change |
| `sources[].data_time`, `data_max` | an entity whose state is the time of the data itself, and its maximum age in minutes |
| `sources[].entries` | config entry ids, for an integration without entities (an AI service, Zigbee without devices, a phone's notify service) |
| `sources[].wait`, `notify_after`, `max`, `interval` | minutes before the first reload (5), minutes before the notification (15), reloads per outage (6), minutes between two reloads (10) |
| `sources[].impact`, `action` | what stops working and what to do, in your own words and language: they go into the notification as they are |
| `ignore` | integrations (domain) or config entry ids the generic catch leaves alone |
| `tap_url` | where a tap on the notification goes; default `/lovelace/<view_path>` |
| `view_path` | path of the view `deploy.py --view` writes; default `connections` |

### Choosing the thresholds

Measure before you choose: in Developer tools > Template, `{{ states.sensor.x.last_reported }}` a few times, or look at the history. Rules of thumb from the source:

- **Local push devices (ESPHome, Shelly, a P1 reader):** `silence` 2 to 10. Not 1: the sensor renders once per minute, so 1 would alarm on every small hiccup.
- **Two keys when one can stand still on purpose.** A P1 reader sends nothing new while the import stays exactly 0 W; with import and export as keys, the newest `last_reported` counts.
- **Cloud polling:** `silence` a bit more than twice the poll interval (an integration that polls every 30 min: 75), and a longer `interval` between reloads (20 or 30) so you do not burn the API quota.
- **Event streams, speakers, appliances:** no `silence`: they write only on a change, a `last_reported` of 12 hours is normal.
- **A cloud API that keeps writing old figures:** `data_time` with the upload time of the device, `data_max` above the largest normal gap (at the source 30 min for an inverter that uploads every 5 min but leaves 20-minute gaps at night).
- **Things you will notice yourself, or that recover by themselves** (weather, solar forecast, prices): `notify_after` 30 to 60.

## What you do in the UI

- The view (`deploy.py --view`): the problems with their Reload and Integration buttons, every source, the on/off switch of the automation and the test source.
- With `home-screen`: a chip "connections" on the start screen, calm while everything works (the first chip to drop out on a narrow phone), with the number of problems otherwise.
- Changing a source or a threshold: edit `house.yaml`, fill in again, run `deploy.py`. The automation and the card read everything from the sensor.

## Install

Commands from `build/` with `HA_URL` and `HA_TOKEN` set (see the README of the kit). Deploy `notifications` first.

```bash
uv run --with-requirements requirements.txt python connection-watchdog/deploy.py --dry-run
uv run --with-requirements requirements.txt python connection-watchdog/deploy.py --view
```

`deploy.py` names every key in `house.yaml` that does not exist (that source would stay `unreachable`). The `/local/` path of the card only works when `/config/www` existed when Home Assistant started: restart once after the first upload.

When you add `connection-watchdog` to `modules:` with `home-screen` already installed, fill in again and run `home-screen/deploy.py` as well: the chip appears only then.

## Migrating from a hand-made watchdog

Had you an automation that reloads one integration when its entities go unavailable (at the source: a reload for the blinds box, every 10 min, 6 times), switch it off when its source is in `connection_watchdog.sources` with the same `max`: otherwise both reload. Keep it switched off for a few days before you delete it.

## Removing

`deploy.py` removes nothing. Delete the automation `connection_watchdog_repair_and_notify` (Settings > Automations & scenes), the files `packages/connection_watchdog.yaml`, `templates/connection_watchdog.yaml`, `custom_templates/connection_watchdog.jinja` and `www/ha-kit/connection-watchdog/` (File editor), the dashboard resource and the view, and restart. Fill in again and deploy `home-screen` so its chip goes.

## Privacy

Nothing leaves the house: the module reads states and config entries, and the notification goes through your own Companion app. The names and texts you put in `house.yaml` end up in the notification and on the card.

## Test plan

See [LOGIC.md](LOGIC.md), "Test plan".

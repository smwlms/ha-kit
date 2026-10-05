# <@ module.name @>

<@ module.description @>.

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_shading.jinja' import all_rooms, blinds, curtains, sun_on, sun with context %>
<% set nb = blinds | map(attribute='name') | join(', ') or 'none' %>
<% set nc = curtains | map(attribute='name') | join(', ') or 'none' %>
<% set ns = sun | map(attribute='name') | join(', ') or 'none' %>
<% set ow = module.defaults['input_datetime.blinds_open_workday'][:5] %>
<% set oe = module.defaults['input_datetime.blinds_open_weekend'][:5] %>
<% set oc = module.defaults['input_datetime.blinds_close'][:5] %>
<% set gb = t('group_all_blinds') %>
<% set gc = t('group_all_curtains') %>
<% set lb = t('logbook_name') %>
-->

Blinds and curtains open and close at fixed times: workday, weekend and evening, separately for blinds and curtains, or the curtains follow the blinds. On a warm day a blind closes while the sun is on its facade with few clouds forecast, and opens again during the day once the sun has gone. Whoever opens a blind by hand wins for the rest of the day.

This house: blinds in <@ nb @>; curtains in <@ nc @>; sun and heat in <@ ns @>.

How every decision is made is in [LOGIC.md](LOGIC.md), together with the test plan.

## Requirements

| What                                                      | Why                                                       | Note                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Module **base**                                           | `packages/`, `templates/` in `configuration.yaml`         | Run `base/deploy.py` first                                                    |
| Home Assistant 2025.4 or newer                            | `trigger:`/`action:` syntax, `default_entity_id`          | `automation: !include automations.yaml` (the HA default)                      |
| HA OS or Supervised + the **File editor** app             | `deploy.py` uploads through the File editor               | Without it: copy the files yourself, see `deploy.py --dry-run`                |
| Blinds and/or curtains as `cover` (any brand)             | the automations call `cover.open_cover` and `close_cover` | A blind that does not report its position works, but "the hand wins" does not |
| Weather integration with an hourly forecast (e.g. **Met.no**) | warmest temperature of the day and cloud cover        | Only for sun and heat. Without cloud cover, clouds are ignored                |
| Indoor temperature (**optional**)                         | also warm when it is warm inside                          | `entities.indoor_temperature`                                                 |

## Contracts between modules

Shading depends on nothing. The planned module **climate** will read these entities (and then depend on shading):

| Entity                                     | Meaning                                                             |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `binary_sensor.shading_warm`               | today is a warm day (outdoor forecast, or indoor temperature)       |
| `input_boolean.shading_closed_<room>`      | this room's blind is closed against the sun right now               |
| `input_boolean.shading_manual_<room>`      | someone opened this room's blind by hand today                      |
| `input_boolean.shading_automatic`          | master switch of the sun automation                                 |
| `binary_sensor.shading_sun_<side>`         | the sun is on facade `<side>` (n, ne, e, se, s, sw, w, nw)          |

## Build order

Commands from `build/` with `HA_URL` and `HA_TOKEN` set (see the kit's README).

1. **Inventory.** Per room, find the cover of the blind and of the curtain (Settings > Entities, filter on `cover.`), and your weather entity (`weather.…`). Per room, determine which way the window faces (N, NE, E, SE, S, SW, W, NW): a compass app at the window is enough.
2. **Fill in `house.yaml`**: `rooms:` and `entities.weather`, `entities.indoor_temperature`, `shading:` (see below and the sections `rooms:`, `entities:` and `shading:` in `house.example.yaml`). Add `shading` to `modules:`. Then run `tools/fill.py`.
3. **Existing schedules or groups?** See "Switching over" below.
4. `shading/deploy.py --dry-run` (have a look), then `shading/deploy.py`.
5. Check the times in Settings > Helpers ("Blinds open workday", …). They start at <@ ow @> / <@ oe @> / <@ oc @>.
6. Follow the test plan in LOGIC.md and let it run for a week; tune the angle and the minimum sun elevation per facade with the logbook "<@ lb @>".

After a change in `house.yaml` or a kit update: fill in again and run `shading/deploy.py`. Existing settings stay.

## Fields in `house.yaml`

| Field                                       | What                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `rooms[].slug`, `name`                      | the slug goes into the helpers (`shading_closed_<slug>`), the name into the logbook                         |
| `rooms[].blind` (optional)                  | cover of the blind. Empty = the room takes no part in the blind schedule nor in sun and heat               |
| `rooms[].curtain` (optional)                | cover of the curtain. Empty = the room takes no part in the curtain schedule                                |
| `rooms[].side` (optional)                   | direction the window faces: N, NE, E, SE, S, SW, W, NW. Empty = the room takes no part in sun and heat       |
| `rooms[].shading` (optional)                | `false` = this room takes no part in sun and heat (the schedule stays)                                      |
| `entities.weather`                          | weather entity with an hourly forecast; required as soon as a room takes part in sun and heat               |
| `entities.indoor_temperature` (optional)    | sensor in °C; also warm when it is warm inside                                                              |
| `shading.sun_protection` (optional)         | `false` = only the schedules, no sun and heat (then `entities.weather` is not needed)                       |

A room without blind and curtain may be in `rooms:` (other modules use that list too); shading skips it. When there is no blind or curtain at all, filling in stops with an error. The old Dutch compass notation (NO, O, ZO, Z, ZW) stops filling in with a hint to the English side.

## What ends up in Home Assistant

| Kind        | Entity                                                                                                                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helpers     | `input_datetime.blinds_open_workday`, `blinds_open_weekend`, `blinds_close`; `input_datetime.curtains_*` (same); `input_boolean.curtains_follow_blinds`; with sun: `input_boolean.shading_automatic`, per room `shading_closed_<room>` and `shading_manual_<room>`; `input_number.shading_outdoor_warm_from`, `shading_indoor_warm_from`, `shading_max_cloud_cover`, `shading_min_sun_elevation`, per facade `shading_angle_<side>` |
| Groups      | "<@ gb @>" and "<@ gc @>" (YAML, in the package; unique ids `shading_all_blinds`, `shading_all_curtains`). The entity id follows the name in the install language: `cover.all_blinds` in English, `cover.alle_rolluiken` in Dutch |
| Sensors     | with sun: `sensor.shading_weather`, `binary_sensor.shading_warm`, per facade `binary_sensor.shading_sun_<side>`                                                                                                                                                                                                        |
| Automations | ids `blinds_schedule`, `curtains_schedule`, `curtains_sync_times`, `shading_sun` (each only when there are rooms for it). Their entity ids follow the alias in the install language                                                                                                                                  |
| Macros      | `custom_templates/shading.jinja`: `cloud_cover(hours)`, `angle_diff(azimuth, facade)`                                                                                                                                                                                                                                  |

Texts (helper names, logbook lines, automation names) come from `strings.yaml` in `house.language` (`en` or `nl`). Switching the language and deploying again renames the helpers and groups (their entity ids stay); logbook lines already written stay in the old language.

## Switching over

- **Existing groups.** If you already have "<@ gb @>" or "<@ gc @>" as a UI group (Settings > Helpers), delete it before `deploy.py`. Otherwise the new group gets an entity id ending in `_2`; `deploy.py` reports it. Then rename it in Settings > Entities.
- **Existing schedule automations** with the same id (`blinds_schedule`, `curtains_schedule`, `curtains_sync_times`) are overwritten. Other schedules for the same blinds: turn them off, otherwise the blinds move twice.
- **Existing helpers** with the same id (`input_datetime.blinds_open_workday`, …) created in the UI clash with the package: delete them in the UI and note your times first.

## Migration from the Dutch ids

Until kit commit db5b2fe this module used Dutch ids. Home Assistant does not rename them: after deploying the new version the old helpers, sensors, groups and automations stay next to the new ones. Note your times and thresholds, deploy, copy the values to the new helpers, then delete the old ones (Settings > Helpers, Entities, Automations) and the old files `packages/zonwering.yaml`, `templates/zonwering.yaml` and `custom_templates/zonwering.jinja`. Update dashboards that use the old ids.

| Old                                                                 | New                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `input_boolean.zonwering_automatisch`                               | `input_boolean.shading_automatic`                           |
| `input_boolean.zonwering_dicht_<room>`                              | `input_boolean.shading_closed_<room>`                       |
| `input_boolean.zonwering_handmatig_<room>`                          | `input_boolean.shading_manual_<room>`                       |
| `input_boolean.gordijnen_volgen_rolluiken`                          | `input_boolean.curtains_follow_blinds`                      |
| `input_number.zonwering_buiten_warm_vanaf`                          | `input_number.shading_outdoor_warm_from`                    |
| `input_number.zonwering_binnen_warm_vanaf`                          | `input_number.shading_indoor_warm_from`                     |
| `input_number.zonwering_max_bewolking`                              | `input_number.shading_max_cloud_cover`                      |
| `input_number.zonwering_min_zonhoogte`                              | `input_number.shading_min_sun_elevation`                    |
| `input_number.zonwering_hoek_<no/o/zo/z/zw/…>`                      | `input_number.shading_angle_<ne/e/se/s/sw/…>`               |
| `input_datetime.rolluiken_open_werkdag`, `_open_weekend`, `_dicht`  | `input_datetime.blinds_open_workday`, `_open_weekend`, `blinds_close` |
| `input_datetime.gordijnen_open_werkdag`, `_open_weekend`, `_dicht`  | `input_datetime.curtains_open_workday`, `_open_weekend`, `curtains_close` |
| `sensor.zonwering_weer`                                             | `sensor.shading_weather`                                    |
| `binary_sensor.zonwering_warm`                                      | `binary_sensor.shading_warm`                                |
| `binary_sensor.zonwering_zon_<side>`                                | `binary_sensor.shading_sun_<side>` (English sides)          |
| cover groups, unique ids `zonwering_alle_rolluiken`, `zonwering_alle_gordijnen` | `shading_all_blinds`, `shading_all_curtains`    |
| automations `rolluiken_schema`, `gordijnen_schema`, `gordijnen_gelijktrekken`, `zonwering_op_zon` | `blinds_schedule`, `curtains_schedule`, `curtains_sync_times`, `shading_sun` |
| macros `zonwering.jinja`: `bewolking()`, `verschil()`               | `shading.jinja`: `cloud_cover()`, `angle_diff()`            |
| `rooms[].side` N, NO, O, ZO, Z, ZW, W, NW                           | N, NE, E, SE, S, SW, W, NW                                  |

## Removing

`deploy.py` removes nothing. To remove the module: delete `packages/shading.yaml`, `templates/shading.yaml` and `custom_templates/shading.jinja` (File editor), the four automations (Settings > Automations) and restart.

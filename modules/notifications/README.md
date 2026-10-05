# <@ module.name @>

<@ module.description @>.

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_notifications.jinja' import m, kinds, kinds_text, filter_days, filter_derived with context %>
<% set filter_sentence = ('derived from the module ventilation-zehnder: `' ~ filter_days ~ '`') if filter_derived else (('`' ~ filter_days ~ '` (from house.yaml)') if filter_days else 'none') %>
-->

Three kinds of notifications, each on or off through `notifications.kinds` (in this house: <@ kinds_text @>):

- **power_price**: ahead ("Free power coming", once per day as soon as tomorrow's prices are known) and at the moment itself ("Power is free now", "Exporting costs money now");
- **surplus**: "Solar surplus" when a lot of solar power goes to the grid for a while;
- **filter**: "Ventilation filter" two weeks before the filters must be replaced.

Every notification goes through `script.send_notification`, which other modules can use as well. How each decision is made is in [LOGIC.md](LOGIC.md), together with the test plan. The texts follow `house.language` (`strings.yaml`, `en` and `nl`).

## Requirements

| What                                                       | Why                                         | Note                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Module **base**                                            | `packages/` in `configuration.yaml`         | First `base/deploy.py`                                                                                      |
| Home Assistant 2025.4 or newer                             | `trigger:`/`action:` syntax                 | `automation: !include automations.yaml` and `script: !include scripts.yaml`                                 |
| HA OS or Supervised + the **File editor** app              | `deploy.py` uploads through the File editor | Without it: copy the files yourself, see `deploy.py --dry-run`                                              |
| **Companion app** on every phone that gets notifications   | `notify.mobile_app_…`                       | `people[].notify`                                                                                           |
| All-in price sensor in €/kWh with `starts` and `prices`    | kind power_price                            | Later delivered by the module **energy**; until then a sensor of your own. See LOGIC.md, "What the price sensor needs" |
| Power to the grid (P1 meter, inverter)                     | kind surplus                                | W or kW                                                                                                     |
| Filter sensor of the ventilation (remaining days)          | kind filter                                 | the module ventilation-zehnder (automatic), or e.g. Zehnder ComfoConnect                                    |

This module depends on no other module. The energy sensors come from `house.yaml`: when the module energy arrives later, point the roles at its sensors and fill in again.

## Build order

Commands from `build/` with `HA_URL` and `HA_TOKEN` set (see the README of the kit).

1. **Inventory.** Look up the notify service per phone (Developer tools > Actions, search for `mobile_app`) and the sensors for the kinds you want.
2. **Fill in `house.yaml`**: `notifications:` and the roles under `entities:` (see below and the sections `notifications:` and `entities:` in `house.example.yaml`). `notifications` in `modules:`. Then `tools/fill.py`. When a sensor for a chosen kind is missing, filling in stops with an error.
3. `notifications/deploy.py --dry-run` (look), then `notifications/deploy.py`.
4. Test plan 1 in LOGIC.md: does the test notification arrive on every phone?

## Fields in `house.yaml`

| Field                                       | What                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `house.language`                            | language of the notification texts (`en` or `nl`)                                                 |
| `people[].key`, `notify`                    | who can get notifications; without `notify` no notifications                                      |
| `notifications.recipients` (optional)       | list of keys from `people`; empty = everyone with `notify`                                        |
| `notifications.kinds` (optional)            | `power_price`, `surplus`, `filter`; default `[power_price, surplus]`                              |
| `notifications.tap_url` (optional)          | where a tap on the notification goes, e.g. `/lovelace/energy`                                     |
| `entities.price_import`                     | kind power_price: all-in import price in €/kWh, with the attributes `starts` and `prices`; empty + `tariff-be` = `sensor.power_price_import` |
| `entities.price_export` (optional)          | export price in €/kWh; empty + `tariff-be` = `sensor.power_price_export`; empty without = no notifications about a negative export price |
| `entities.grid_export_w`                    | kind surplus: power to the grid (W or kW)                                                         |
| `entities.ventilation_filter_days`          | kind filter: days until the filters must be replaced; may be empty with the module ventilation-zehnder |

The kind values of earlier versions (`stroomprijs`, `overschot`) still work as aliases for `power_price` and `surplus`.

**Filter sensor and the module ventilation-zehnder.** When `ventilation-zehnder` is in `modules:` and `entities.ventilation_filter_days` is empty, the notification uses the sensor the firmware of that module makes: `sensor.<prefix>_filter_replacement_remaining_days`, with as prefix the display name of the device (`ventilation.display_name`, else `ventilation.name`) in lower case with `_` (the way HA makes entity ids). With `ventilation.mac_suffix: true` the MAC suffix is in the entity ids: then fill in the field yourself. A filled-in field always wins. Filter sensor in this house: <@ filter_sentence @>.

## What ends up in Home Assistant

| Kind        | Entity                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Helpers     | `input_number.notification_surplus_kw`, `notification_surplus_minutes`, `notification_surplus_pause_h`¹; `input_datetime.notification_price_ahead`² |
| Script      | `script.send_notification` (title, message, extra, only_home)                                                                           |
| Automations | `notification_free_or_negative_power`², `notification_solar_surplus`¹, `notification_ventilation_filter`³                               |
| Macros      | `custom_templates/notifications.jinja`: `recipients()`, `price_windows(entity, limit)`, `kw(entity)`                                    |

¹ kind surplus. ² kind power_price. ³ kind filter.

The cheap-window notification ("Cheap power until …", "Cheap power over") is not in this module: `ev-charging` sends it (`automation.ev_charging_notify`) through `script.send_notification`. With `ev-charging` and a tariff module in `modules:`, "Exporting costs money now" is left out while `input_boolean.ev_charging_cheap_enabled` is on and the sun is up (ev-charging announces the same window); fill in again and deploy `notifications` after adding `ev-charging`.

## For other modules

A module that wants to tell the household something calls the script instead of listing notify services itself:

```yaml
- action: script.send_notification
  data:
    title: Washing machine done
    message: The laundry can come out.
    extra:
      tag: washing-machine
    only_home: true # optional: only the recipients whose person is home; nobody home = nobody
```

Then put `notifications` in `depends_on` of that module.

## Migrating

Existing automations with the same id (`notification_free_or_negative_power`, `notification_solar_surplus`, `notification_ventilation_filter`) are overwritten. Had you the surplus as UI helpers (a filter "Export average 10 min" and a threshold "Surplus available"), this module no longer uses them: delete them when nothing else reads them.

**From the Dutch ids of earlier versions.** The ids changed; nothing is migrated automatically:

| Old                                               | New                                               |
| ------------------------------------------------- | ------------------------------------------------- |
| `script.melding_sturen` (titel, bericht, extra)   | `script.send_notification` (title, message, extra) |
| `input_number.melding_overschot_kw`               | `input_number.notification_surplus_kw`            |
| `input_number.melding_overschot_minuten`          | `input_number.notification_surplus_minutes`       |
| `input_number.melding_overschot_pauze_uur`        | `input_number.notification_surplus_pause_h`       |
| `input_datetime.melding_stroomprijs_vooraf`       | `input_datetime.notification_price_ahead`         |
| automation `melding_gratis_of_negatieve_stroom`   | `notification_free_or_negative_power`             |
| automation `melding_overschot_zon`                | `notification_solar_surplus`                      |
| automation `melding_ventilatiefilter`             | `notification_ventilation_filter`                 |
| `packages/meldingen.yaml`, `custom_templates/meldingen.jinja` | `packages/notifications.yaml`, `custom_templates/notifications.jinja` |
| macros `ontvangers()`, `vensters()`               | `recipients()`, `price_windows()`                 |

Steps: note your values of the three surplus helpers, deploy, set the values on the new helpers, then delete the old automations and `script.melding_sturen` (Settings > Automations & scenes) and the old files `packages/meldingen.yaml` and `custom_templates/meldingen.jinja` (File editor), and restart. The price sensor may keep the attribute `prijzen` (read as a fallback for `prices`), but rename it to `prices` when you can.

## Removing

`deploy.py` removes nothing. Delete `packages/notifications.yaml` and `custom_templates/notifications.jinja` yourself (File editor), the automations and `script.send_notification`, and restart. First check that no other module still uses the script.

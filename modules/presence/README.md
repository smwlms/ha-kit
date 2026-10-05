# <@ module.name @>

<@ module.description @>.

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% set vt = t('view_title') %>
<% set kh = t('kind_home') %>
<% set kw = t('kind_work') %>
<% set ks = t('kind_stay') %>
<% set src = t('src_history') %>
<% set unk = t('unknown') %>
-->

Home Assistant keeps track by itself of when someone gets home (and whether that is from work), the working day per person, who takes the children to school and picks them up (with or without a Tesla, and picking up at family), charging sessions at a Supercharger, and per day how much time everyone spent at home, at work, elsewhere and on the road. Everything becomes an event in a local calendar that you can correct yourself. The tab "<@ vt @>" shows it with few numbers: a timeline per weekday, a usual week (average of 8 weeks), the split of the time and the charging sessions. It is informative; the name "Our week" was chosen because "Presence" sounded too much like surveillance.

How every decision is made is in [LOGIC.md](LOGIC.md), together with the test plan.

## Requirements

| What                                                                         | Why                                                                        | Note                                                                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Module **base**                                                              | `packages/` and `command_line/` in `configuration.yaml`                    | Run `base/deploy.py` first                                                                        |
| Home Assistant 2025.4 or newer                                               | `trigger:`/`action:` syntax, `calendar.get_events`, schedule helpers       | `automation: !include automations.yaml` and `script: !include scripts.yaml` (the HA defaults)     |
| HA OS or Supervised + the **File editor** app                                | `deploy.py` uploads through the File editor                                | Without it: copy the files yourself, see `deploy.py --dry-run`                                    |
| **Recorder on SQLite** (the default)                                         | `stay.py` and `workday.py` read `/config/home-assistant_v2.db` directly    | With MariaDB or PostgreSQL the rest works, without "Where we spend our time" and without appointments after work |
| Integration **Local Calendar**, twice                                        | the log and the stays                                                      | See "What you do in the UI"                                                                       |
| **Companion app** on every phone, location **Always** + **Precise location** | arrival, work zone, school zone, who was in the car                        | With "While using" no positions come through on the road (LOGIC.md, Edge cases)                   |
| Integration **Teslemetry** (optional)                                        | school run with the Tesla, which car came home, Superchargers              | Without `cars:` those parts drop out                                                              |
| Python 3.11 + [uv](https://docs.astral.sh/uv/)                               | `fill.py`, `deploy.py`, `backfill.py`                                      |                                                                                                   |

Module **gate** is not needed: this module reads the person entities, the phone trackers and Teslemetry itself. Useful though: the gate module's `deploy.py` can put `zone.home` on the parking spot (see `modules/gate/README.md`), and this module counts on that too (LOGIC.md, Edge cases).

## Contracts between modules

| Entity                                  | Meaning                                                                                       | Read by                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| `input_datetime.arrival_<day>`          | learned usual arrival time per weekday (`monday` … `sunday`), updated every night             | planned module appliances ("dishwasher ready by arrival") |
| `script.presence_log`                   | the only writer of the log calendar; `kind` = `home`, `home_from_work`, `drop_off`, `pick_up`, `work`, `charge` | any module that wants to log a run |

## Privacy

The automations and the card stay inside Home Assistant. Only `backfill.py` (run by hand) asks the OpenStreetMap Overpass API (overpass-api.de) for the name of a charging station near a position where a car charged; `--no-osm` skips that. Positions come from the Companion app and Teslemetry. Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

Example with invented values: section `presence:` in `house.example.yaml`. The module also uses:

- `house.timezone` and `house.language` (texts in the calendar, the logbook and on the card);
- `people[]`: `key`, `name`, `person` (optional), `phone`, and the optional field `color`. **Only people with a `phone` take part**;
- `cars[]`: `prefix`, `name`, `driver` (optional) and `teslemetry:` with the roles `location`, `route`, `destination`, `battery`, `charging_state`.

| Field in `presence:` | What                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar`           | Local Calendar for the log (default `calendar.presence`)                                                                                             |
| `stay_calendar`      | Local Calendar for the stays (default `calendar.stays`)                                                                                              |
| `children`           | how the card names the children in sentences, e.g. "the children"                                                                                    |
| `places`             | list `{key, name, kind, person, label, lat, lon, radius}`; `kind` = `work`, `school`, `drop_off` or `family`. Every place is `zone.<key>`            |
| `school_windows`     | start values of the windows per day (`mon` … `sun`): `drop_off`, `pick_up`, `family`                                                                 |
| `sleep_window`       | `start`/`end`: at home in this window counts as asleep                                                                                               |
| `arrival_defaults`   | start value of the learned arrival time per weekday                                                                                                  |
| `previous_phones`    | a replaced phone: `{person, phone, until}`; the old tracker counts until that moment                                                                 |

The number of people, cars, work places, drop-off points and family places is free. At most one school. No school and no family: then the school runs drop out. Someone without a work place: no working day for that person, arrivals still are. The old Dutch kinds (`werk`, `afzetpunt`, `familie`) stop filling in with a hint to the English value.

## What you do in the UI

1. **Two Local Calendars:** Settings > Devices & services > Add integration > **Local Calendar**, name "Presence" (`calendar.presence`). Again with the name "Stays" (`calendar.stays`). Other names: put the entity ids in `presence.calendar` and `stay_calendar`.
2. **Persons:** Settings > People. One `person.<key>` per person with a phone, with **only** the tracker of their own, current phone. If the entity is not called `person.<key>`, put it in `people[].person`.
3. **Zones:** every place of `presence.places` as zone `zone.<key>` with exactly `name` as its name. Two ways:
   - `deploy.py --setup` creates them for you when `lat`/`lon` are in `house.yaml` (radius and passive per kind, see `module.yaml`, `defaults:`);
   - or yourself: Settings > Areas, labels & zones > Zones. First give the zone the `key` as its name (the entity then becomes `zone.<key>`), save, and then rename it to `name`.

   | Kind       | Radius (default)                         | Passive | Why                                                      |
   | ---------- | ---------------------------------------- | ------- | -------------------------------------------------------- |
   | `work`     | 150 m, up to 200 m                       | no      | geofence on the phone: arrival and departure at work     |
   | `school`   | 150 m around the middle of the drop-off points | no | geofence on the phone                                  |
   | `drop_off` | 30 m                                     | yes     | only for the distance ("which side of the school")       |
   | `family`   | 75 m                                     | no      | keep it small when the house is on the daily route       |

   **The name counts.** A person or car in a zone has the name of that zone as its state, and the triggers compare with that name. If you rename a zone, change `name` in `house.yaml` too, fill in again and run `deploy.py` again.

4. **Phones:** Companion app on **Always** and **Precise location**. Open the app once after the zones were created.

## Install

```bash
cd build
uv run --with-requirements requirements.txt python presence/deploy.py --dry-run --setup --tab   # have a look
uv run --with-requirements requirements.txt python presence/deploy.py --setup --tab           # the first time
uv run --with-requirements requirements.txt python presence/deploy.py                         # afterwards
```

`deploy.py`:

1. uploads `packages/presence.yaml`, `command_line/presence.yaml` and `settings.py`, `stay.py`, `workday.py` to `/config/presence/`;
2. checks the configuration and reloads the helpers and `command_line`;
3. gives the seven `input_datetime.arrival_<day>` their start value, only when they are new;
4. creates the schedules `schedule.school_drop_off`, `schedule.school_pick_up` (with a school) and `schedule.family_pick_up` (with family) as UI helpers, only when they do not exist yet. Afterwards you change them in Settings > Helpers. Their entity ids are the same in every language; the name follows `house.language`;
5. writes the automations and the script through the config API;
6. uploads the card and registers it as resource `/local/presence-card.js`;
7. reports which expected entities (calendars, persons, phones, zones) are still missing.

| Option              | What                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--setup`           | creates the missing zones with `lat`/`lon` from `house.yaml`; an existing zone is left alone                               |
| `--tab`             | puts the tab "<@ vt @>" (`/lovelace/our-week`, panel) on the Overview dashboard; the dashboard config goes to `backup/` first |
| `--dashboard <path>` | with `--tab`: another dashboard than the Overview                                                                         |
| `--dry-run`         | shows what it would do, does not connect to Home Assistant                                                                 |

The dashboard must be in storage mode (take control once in the UI). Without `--tab`: create a view of type Panel yourself and paste `lovelace/our-week.yaml` as the card.

After a change in `house.yaml` (new person, car or place): fill in again and run `deploy.py` again. Existing helpers, schedules and zones stay. **Removing:** `deploy.py` deletes nothing; when you remove a person, car or place, delete its helpers and zone yourself.

## Language

All texts (calendar titles and details, logbook lines, helper, script and automation names, the card) come from `strings.yaml` in `house.language` (`en` or `nl`). Switching the language and deploying again:

- **old events keep working.** The card, the automation `arrival_learn`, the stays automation and `backfill.py` read titles and detail keys in every language of `strings.yaml`. A title written by hand in another wording ("Thuiskomst: Jan") is not recognised.
- **events are not translated.** The calendar shows a mix of languages until the old events fall out of the 8 weeks the card shows.
- helpers, schedules and automations get their name in the new language; their entity ids stay (the automations' entity ids follow the alias they had when they were first created). The two command_line sensors keep their English names (`sensor.presence_stays`, `sensor.presence_workday`): Home Assistant derives their entity id from the name.

## Filling in history afterwards (`backfill.py`)

The recorder keeps 10 days by default. `backfill.py` writes those days into the calendars with the same rules, with the source "<@ src @>". It reads the zones and the school windows from Home Assistant: run it only after `deploy.py`.

```bash
uv run --with-requirements requirements.txt python presence/backfill.py                          # dry run
uv run --with-requirements requirements.txt python presence/backfill.py --write
uv run --with-requirements requirements.txt python presence/backfill.py --stays --write
uv run --with-requirements requirements.txt python presence/backfill.py --workday --write 2026-03-02
```

- Period: `--from YYYY-MM-DD` (default 11 days ago) and `--to YYYY-MM-DD`.
- Running it again is safe: an event that already exists (same kind, same people, same minute, in any language) is skipped. `--stays --update` rewrites existing days (after another sleeping window).
- It looks up Supercharger names in OpenStreetMap (Overpass API; that gets the charging position). `--no-osm` skips it: then the place is "<@ unk @>".
- Check the dry-run output before you use `--write`.

## What ends up in Home Assistant

| Kind        | Entity                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helpers     | per person `input_datetime.presence_<key>_away_since`, `_left_work`¹, `_arrived_at_work`¹, `_school_run_logged`², `input_text.presence_<key>_work_trips`¹; per car `input_datetime.presence_charge_start_<prefix>`, `input_number.presence_charge_start_battery_<prefix>`, `input_text.presence_destination_<prefix>`; `input_datetime.presence_tesla_left_school_zone`²; `input_datetime.arrival_monday` … `_sunday` |
| Schedules   | `schedule.school_drop_off`, `schedule.school_pick_up` (with a school), `schedule.family_pick_up` (with family): UI helpers                                                                                                                                                                                                                                |
| Sensors     | `sensor.presence_stays`, `sensor.presence_workday` (command_line)                                                                                                                                                                                                                                                                                         |
| Automations | ids `presence_track`, `presence_arrival`, `presence_school_run_car`², `presence_school_run_phone`², `presence_workday`¹, `presence_supercharger`, `presence_stays`, `arrival_learn`                                                                                                                                                                       |
| Script      | `script.presence_log`: the only thing that writes into the log calendar; also by hand for a missed run                                                                                                                                                                                                                                                   |
| Card        | `custom:presence-card` (`www/presence-card.js`), config `lovelace/our-week.yaml`                                                                                                                                                                                                                                                                          |

¹ only for people with a work place. ² only with a school or family place. What exists per car, only with `cars:`.

The calendar titles are "<@ kh @>: …", "<@ kw @>: …" and so on (LOGIC.md, "Event format"); a stay is "<@ ks @>: <name>".

## Testing the card without Home Assistant

`test/our-week.html` shows the card with fake data (made-up names), in the install language plus a few events in the other languages of `strings.yaml`. Open it from the **filled-in** folder (the card in `modules/presence/` still has fill-in markers): in `build/presence/` run `python3 -m http.server`, then `http://localhost:8000/test/our-week.html`.

## Files

| File                          | What                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `strings.yaml`                | every text users see, `en` and `nl`                                                           |
| `package.yaml`                | helpers (package), no `initial`                                                               |
| `automations.yaml`            | the eight automations                                                                         |
| `scripts.yaml`                | `script.presence_log`                                                                         |
| `command_line/presence.yaml`  | the two command_line sensors                                                                  |
| `settings.py`                 | filled in from `house.yaml`: people, phones, cars, places, time zone, sleeping window, texts   |
| `stay.py`, `workday.py`       | run on Home Assistant, read the recorder (read only, standard library)                        |
| `backfill.py`                 | runs on your computer, fills the calendars afterwards                                         |
| `www/presence-card.js`        | the card; everything house-specific comes from the card config, the texts from `strings.yaml` |
| `lovelace/our-week.yaml`      | card config, filled in                                                                        |
| `deploy.py`                   | deploy, see above                                                                             |
| `_presence.jinja`             | partial: who and what the module follows, and the text tables for reading events back        |

## Migration from the Dutch ids

Until kit commit db5b2fe this module used Dutch ids. Home Assistant does not rename them: after deploying the new version the old helpers, sensors, schedules, script and automations stay next to the new ones. The calendar events stay valid (they are read in both languages).

1. Note the values you tuned: the schedules (school windows) and the learned arrival times.
2. In `house.yaml`: `presence.places[].kind` `werk` → `work`, `afzetpunt` → `drop_off`, `familie` → `family`. Keep `calendar`/`stay_calendar` pointing at your existing calendars, and the zone `key`s at your existing zones (or rename the zones too).
3. Fill in, `deploy.py --tab`. Set the new schedules to your windows (or delete the new ones and rename the old schedules' entity ids to the new ids before deploying: then `deploy.py` leaves them alone).
4. Delete the old helpers, `sensor.aanwezigheid_*`, `script.aanwezigheid_log`, the old automations, the old schedules, the files `packages/aanwezigheid.yaml`, `command_line/aanwezigheid.yaml`, the folder `/config/aanwezigheid/`, `www/aanwezigheid-card.js` and its dashboard resource, and the old tab `onze-week`.

| Old                                                                          | New                                                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `input_datetime.aanwezigheid_<key>_weg_sinds`                                | `input_datetime.presence_<key>_away_since`                            |
| `input_datetime.aanwezigheid_<key>_werk_verlaten`                            | `input_datetime.presence_<key>_left_work`                             |
| `input_datetime.aanwezigheid_<key>_werk_aangekomen`                          | `input_datetime.presence_<key>_arrived_at_work`                       |
| `input_datetime.aanwezigheid_<key>_schoolrit_gelogd`                         | `input_datetime.presence_<key>_school_run_logged`                     |
| `input_datetime.aanwezigheid_tesla_schoolzone_verlaten`                      | `input_datetime.presence_tesla_left_school_zone`                      |
| `input_datetime.aanwezigheid_laden_start_<prefix>`                           | `input_datetime.presence_charge_start_<prefix>`                       |
| `input_number.aanwezigheid_laden_start_batterij_<prefix>`                    | `input_number.presence_charge_start_battery_<prefix>`                 |
| `input_text.aanwezigheid_<key>_werkverplaatsingen`                           | `input_text.presence_<key>_work_trips`                                |
| `input_text.aanwezigheid_bestemming_<prefix>`                                | `input_text.presence_destination_<prefix>`                            |
| `input_datetime.thuiskomst_maandag` … `_zondag`                              | `input_datetime.arrival_monday` … `_sunday`                           |
| `schedule.school_brengen`, `school_halen`, `halen_bij_familie`               | `schedule.school_drop_off`, `school_pick_up`, `family_pick_up`        |
| `sensor.aanwezigheid_verblijf` (attributes `dagen`, `fout`)                  | `sensor.presence_stays` (`days`, `error`)                             |
| `sensor.aanwezigheid_werkdag` (attributes `personen`, `fout`)                | `sensor.presence_workday` (`people`, `error`)                         |
| `script.aanwezigheid_log` (fields `soort`, `personen`, `start`, `einde`, `details`) | `script.presence_log` (`kind`, `people`, `start`, `end`, `details`) |
| automations `aanwezigheid_bijhouden`, `_thuiskomst`, `_schoolrit_auto`, `_schoolrit_gsm`, `_werktijd`, `_supercharger`, `_verblijfplaatsen`, `thuiskomst_leren` | `presence_track`, `presence_arrival`, `presence_school_run_car`, `presence_school_run_phone`, `presence_workday`, `presence_supercharger`, `presence_stays`, `arrival_learn` |
| `custom:aanwezigheid-card`, `/local/aanwezigheid-card.js`                    | `custom:presence-card`, `/local/presence-card.js`                     |
| card config `agenda`, `verblijf_agenda`, `kinderen`, `familie[{naam}]`, `autos[{naam}]`, `slaapvenster{van, tot}`, `personen[{naam, werkzone, kleur}]` | `calendar`, `stay_calendar`, `children`, `family[{name}]`, `cars[{name}]`, `sleep_window{start, end}`, `people[{name, work_zone, color}]` |
| tab path `onze-week`                                                         | `our-week`                                                            |
| `/config/aanwezigheid/instellingen.py`, `verblijf.py`, `werkdag.py`          | `/config/presence/settings.py`, `stay.py`, `workday.py`               |
| default calendars `calendar.aanwezigheid`, `calendar.verblijfplaatsen`       | `calendar.presence`, `calendar.stays`                                 |
| `backfill.py --verblijf`, `--werkdag`, `--van`, `--tot`, `--geen-osm`        | `--stays`, `--workday`, `--from`, `--to`, `--no-osm`                  |

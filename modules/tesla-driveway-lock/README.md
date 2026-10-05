# <@ module.name @>

<@ module.description @>.

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_tesla_driveway_lock.jinja' import tdl, photo, radius, minutes with context %>
<% set photonote = 'The garage photo is on in this house.' if photo else 'The garage photo is off in this house (tesla_driveway_lock.garage_photo): only the GPS decides.' %>
-->

A Tesla that has been in P at home and unlocked for <@ minutes @> min gets locked when it stands outside on the driveway. When it is in the garage, nothing happens. Whether it is outside is decided first by a **garage photo on arrival** (optional: Gemini looks whether the car's fixed spot is empty or occupied), otherwise by the **GPS** with a small passive zone `zone.driveway`. <@ photonote @>

How every decision is made is in [LOGIC.md](LOGIC.md). The test plan is there too.

## Requirements

| What                                                    | Why                                                                                                 | Note                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Module **base**                                         | `packages/`, `templates/` in `configuration.yaml`                                                   | First `base/deploy.py`                                                        |
| Module **gate**                                         | `counter.tesla_commands_today` (shared counter); `--setup` of gate enables the shift state          | First `gate/deploy.py --setup`                                                |
| Integration **Teslemetry**                              | lock, shift state, location, located at home, status                                               | A lock command costs credits and wakes a sleeping car                         |
| **Companion app**                                       | notification after locking                                                                          | `people[].notify`                                                             |
| Garage camera + **Google Generative AI** (`ai_task`)    | garage photo on arrival (optional)                                                                  | Only with `tesla_driveway_lock.garage_photo: true`; without ai_task the GPS decides |
| Darkness sensor in the garage (**optional**)            | no photo in the dark                                                                                | e.g. the day/night sensor of the camera (`entities.garage_dark`)              |

## Build order

Commands from `build/` with `HA_URL` and `HA_TOKEN` set (see the kit's README).

1. **Inventory.** Per car, check the lock entity (`lock.<prefix>_slot` in Dutch, probably `lock.<prefix>_lock` in English). With the garage photo: which spot in the garage belongs to which car, seen from the camera (left, right, …).
2. **Fill in `house.yaml`**: `teslemetry.lock`, `tesla_driveway_lock:`, per car optionally `garage_spot`, and `entities.garage_camera` / `garage_dark` (see below and the sections `tesla_driveway_lock:`, `cars:`, `teslemetry:` and `entities:` in `house.example.yaml`). `tesla-driveway-lock` in `modules:` (after `gate`). Then `tools/fill.py`.
3. **One-off:** `tesla-driveway-lock/deploy.py --dry-run --setup` (look), then `tesla-driveway-lock/deploy.py --setup`. That creates `zone.driveway` (<@ radius @> m, passive, named in `house.language`) at `house.lat/lon`. The master switch is off.
4. **Refine the zone** in Settings > Areas & zones > Zones: drag the driveway zone to the spot where a car stands **outside**. The garage spots must fall outside it. Check with test 2 in LOGIC.md (attribute `driveway_distance_m`).
5. With the garage photo: test 3 (a real arrival).
6. **Master switch on** (`input_boolean.tesla_driveway_lock_enabled`) and tests 4 to 6.

After a change in `house.yaml` or a kit update: fill in again and run `tesla-driveway-lock/deploy.py` (without `--setup`). Existing settings stay as they are.

## Privacy

With `garage_photo: true` a garage photo IS sent to the AI integration (by default the first `ai_task` entity, e.g. Google Generative AI / Gemini) each time a car parks; the default `garage_photo: false` sends nothing. `ai_task: none` keeps the garage photo away from any AI (then `garage_photo` must be `false`). Car position and lock state come from Teslemetry. Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

| Field                                                 | What                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `house.lat`, `house.lon`                              | start position of `zone.driveway` (you move it yourself afterwards)                                    |
| `house.language`                                      | language of the notifications, logbook lines, helper names and Gemini's description of the photo       |
| `cars[]`: `prefix`, `name`, `driver`                  | `driver` gets the notification (together with the admin)                                               |
| `cars[].garage_spot` (optional)                       | fixed spot in the garage as the camera sees it: `left`, `right`, `middle`, … (one word, lower case). Without: the GPS decides for that car |
| `teslemetry.lock`                                     | pattern of the lock, e.g. `lock.{p}_lock`; per car via `cars[].entities.lock`                          |
| `teslemetry.shift_state`, `location`, `located_at_home`, `status` | as for the module gate                                                                     |
| `people[].notify`, `admin` (optional)                 | who gets the notification                                                                              |
| `tesla_driveway_lock.garage_photo` (optional)         | `true` = garage photo on arrival; default `false`                                                      |
| `tesla_driveway_lock.ai_task` (optional)              | ai_task entity or `auto`; empty = `doorbell.ai_task` (empty there = the first ai_task entity); `none` = no garage photo to an AI service (then `garage_photo` must be `false`) |
| `tesla_driveway_lock.garage_hint` (optional)          | one extra sentence for Gemini about the garage, e.g. "Bikes are parked on the left too."               |
| `entities.garage_camera`                              | required with the garage photo                                                                         |
| `entities.garage_dark` (optional)                     | `binary_sensor`, on = dark: then no photo                                                              |

## What ends up in Home Assistant

| Kind        | Entity                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| Helpers     | `input_boolean.tesla_driveway_lock_enabled`, `input_number.tesla_driveway_lock_minutes`, `input_text.tesla_garage_photo`¹ |
| Zone        | `zone.driveway` (UI zone, passive, by `--setup`)                                                                          |
| Sensors     | per car `binary_sensor.tesla_driveway_<car>_home_unlocked` (attribute `driveway_distance_m`)                              |
| Automations | `tesla_driveway_lock`, `tesla_garage_arrival_photo`¹                                                                      |
| Files       | `/media/garage/arrival-<car>.jpg`¹ (last arrival photo per car)                                                           |

¹ only with `tesla_driveway_lock.garage_photo: true`.

Used from the module gate: `counter.tesla_commands_today` (every lock command counts).

Names, notifications and logbook lines are in `house.language` (texts in `strings.yaml`); the entity ids are the same in every language. The verdicts of the garage photo are stored as fixed English values (`occupied`, `empty`, `unsure`) and shown in `house.language`.

## Teslemetry credits

Every lock command costs credits of the Teslemetry account, and so does waking a sleeping car. The module sends at most one command per parking and only when the car is outside. Do not send commands to cars that are not yours (see the README of gate, "Teslemetry: shared account").

## Switching over

If you already had template helpers "… home in P and unlocked" and your own lock automation with the same id (`tesla_driveway_lock`, `tesla_garage_arrival_photo`): those automations are overwritten, the old template helpers stay until you delete them. An existing `zone.driveway` stays as it is (`--setup` skips it). If you have a UI helper `input_text.tesla_garage_photo`, delete it first: the package creates it again.

## Migrating from the Dutch version

Kit versions up to `db5b2fe` used Dutch file names and ids:

| Old                                                          | New                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `/config/packages/tesla_oprit.yaml`                          | `/config/packages/tesla_driveway_lock.yaml`                    |
| `/config/templates/tesla_oprit.yaml`                         | `/config/templates/tesla_driveway_lock.yaml`                   |
| `zone.oprit`                                                 | `zone.driveway`                                                |
| attribute `afstand_tot_oprit_m`                              | `driveway_distance_m`                                          |
| `counter.tesla_commando_s_vandaag` (module gate)             | `counter.tesla_commands_today`                                 |
| photo JSON `{"door": …, "<spot>": "bezet/leeg/onzeker"}`     | `{"car": …, "<spot>": "occupied/empty/unsure"}`                |
| `/media/garage/aankomst-<car>.jpg`                           | `/media/garage/arrival-<car>.jpg`                              |
| notification tag `tesla-oprit-<car>`                         | `tesla-driveway-<car>`                                         |

Steps: delete the two old files (File editor; `deploy.py` stops while they exist), rename the entity id of `zone.oprit` to `zone.driveway` in Settings > Entities (keeps its place and radius), deploy gate first, then this module. The first arrival photo after the switch rewrites `input_text.tesla_garage_photo` in the new format; until then the GPS decides.

## Removing

`deploy.py` removes nothing. Delete `packages/tesla_driveway_lock.yaml` and `templates/tesla_driveway_lock.yaml` yourself (File editor), the automations and `zone.driveway`, and restart.

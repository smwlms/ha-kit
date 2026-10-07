# <@ module.name @>

<@ module.description @>.

<!-- Filled in by tools/fill.py (kept in a comment so a markdown formatter leaves it alone).
<% from '_tesla_driveway_lock.jinja' import tdl, photo, radius, minutes with context %>
<% set photonote = 'The garage photo is on in this house.' if photo else 'The garage photo is off in this house (tesla_driveway_lock.garage_photo): only the GPS decides.' %>
-->

A Tesla left unlocked at home gets locked when it stands outside on the driveway: right when the gate closes (with the garage photo and a gate sensor), or else after <@ minutes @> min. When it is in the garage, nothing happens. Whether it is outside is decided first by a **garage photo** (optional: taken when a car parks and when the gate closes; Gemini says **which car** stands in the garage, on whatever spot), otherwise by the **GPS** with a small passive zone `zone.driveway`. <@ photonote @>

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
| Driveway camera (**optional**)                          | second image for Gemini: does a car stand on the driveway?                                          | `entities.driveway_camera`                                                    |
| Gate sensor of module **gate** (**optional**)           | photo when the gate closes, and lock right away                                                     | `entities.gate_sensor` → `binary_sensor.gate_open`                            |

## Build order

Commands from `build/` with `HA_URL` and `HA_TOKEN` set (see the kit's README).

1. **Inventory.** Per car, check the lock entity (`lock.<prefix>_slot` in Dutch, probably `lock.<prefix>_lock` in English). With the garage photo: the parking spots in the garage, seen from the camera (left, right, …), and how each car looks (model, shape, colour).
2. **Fill in `house.yaml`**: `teslemetry.lock`, `tesla_driveway_lock:` (with `garage_spots`), per car optionally `look`, and `entities.garage_camera` / `garage_dark` / `driveway_camera` (see below and the sections `tesla_driveway_lock:`, `cars:`, `teslemetry:` and `entities:` in `house.example.yaml`). `tesla-driveway-lock` in `modules:` (after `gate`). Then `tools/fill.py`.
3. **One-off:** `tesla-driveway-lock/deploy.py --dry-run --setup` (look), then `tesla-driveway-lock/deploy.py --setup`. That creates `zone.driveway` (<@ radius @> m, passive, named in `house.language`) at `house.lat/lon`. The master switch is off.
4. **Refine the zone** in Settings > Areas & zones > Zones: drag the driveway zone to the spot where a car stands **outside**. The garage spots must fall outside it. Check with test 2 in LOGIC.md (attribute `driveway_distance_m`).
5. With the garage photo: tests 3 and 4.
6. **Master switch on** (`input_boolean.tesla_driveway_lock_enabled`) and tests 5 to 8.

After a change in `house.yaml` or a kit update: fill in again and run `tesla-driveway-lock/deploy.py` (without `--setup`). Existing settings stay as they are.

## Privacy

With `garage_photo: true` a garage photo (and with `entities.driveway_camera` a driveway photo) IS sent to the AI integration (by default the first `ai_task` entity, e.g. Google Generative AI / Gemini) each time a car parks at home and each time the gate closes while a car stands unlocked at home; the default `garage_photo: false` sends nothing. `ai_task: none` keeps the garage photo away from any AI (then `garage_photo` must be `false`). Car position and lock state come from Teslemetry. Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

| Field                                                 | What                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `house.lat`, `house.lon`                              | start position of `zone.driveway` (you move it yourself afterwards)                                    |
| `house.language`                                      | language of the notifications, logbook lines, helper names and Gemini's description of the photo       |
| `cars[]`: `prefix`, `name`, `driver`                  | `driver` gets the notification (together with the admin)                                               |
| `cars[].garage_spot` (optional)                       | usual spot in the garage as the camera sees it: `left`, `right`, … (one word, lower case). Only used to list the spots when `garage_spots` is empty; the decision does not depend on it |
| `cars[].look` (optional)                              | how Gemini recognises the car: model, shape, colour (e.g. "Tesla Model Y, white, a taller crossover"); default "a Tesla" |
| `teslemetry.lock`                                     | pattern of the lock, e.g. `lock.{p}_lock`; per car via `cars[].entities.lock`                          |
| `teslemetry.shift_state`, `location`, `located_at_home`, `status` | as for the module gate                                                                     |
| `people[].notify`, `admin` (optional)                 | who gets the notification                                                                              |
| `tesla_driveway_lock.garage_photo` (optional)         | `true` = garage photo when a car parks and when the gate closes; default `false`                       |
| `tesla_driveway_lock.garage_spots` (optional)         | the parking spots as the camera sees them, e.g. `[left, right]`; empty = every `cars[].garage_spot`     |
| `tesla_driveway_lock.ai_task` (optional)              | ai_task entity or `auto`; empty = `doorbell.ai_task` (empty there = the first ai_task entity); `none` = no garage photo to an AI service (then `garage_photo` must be `false`) |
| `tesla_driveway_lock.garage_hint` (optional)          | one extra sentence for Gemini about the garage, e.g. "Bikes are parked on the left too."               |
| `entities.garage_camera`                              | required with the garage photo                                                                         |
| `entities.garage_dark` (optional)                     | `binary_sensor`, on = dark: wait up to 5 s for the light, else no photo                                |
| `entities.driveway_camera` (optional)                 | camera on the driveway: second image for Gemini                                                        |
| `entities.gate_sensor` (optional, module gate)        | with it, a photo when the gate closes and a car outside is locked right away                           |

## What ends up in Home Assistant

| Kind        | Entity                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| Helpers     | `input_boolean.tesla_driveway_lock_enabled`, `input_number.tesla_driveway_lock_minutes`, `input_text.tesla_garage_photo`¹ |
| Zone        | `zone.driveway` (UI zone, passive, by `--setup`)                                                                          |
| Sensors     | per car `binary_sensor.tesla_driveway_<car>_home_unlocked` (attribute `driveway_distance_m`)                              |
| Automations | `tesla_driveway_lock`, `tesla_garage_arrival_photo`¹, `tesla_driveway_gate_closed`²                                       |
| Scripts     | `tesla_driveway_lock_car` (decide and lock one car), `tesla_garage_photo`¹                                                |
| Files       | `/media/garage/park-<car>.jpg`, `/media/garage/close-<car>.jpg`, `/media/garage/driveway-<park/close>.jpg`¹ (last photos) |

¹ only with `tesla_driveway_lock.garage_photo: true`. ² also needs `entities.gate_sensor` (module gate).

Used from the module gate: `counter.tesla_commands_today` (every lock command counts).

Names, notifications and logbook lines are in `house.language` (texts in `strings.yaml`); the entity ids are the same in every language. The verdicts of the garage photo are stored as fixed values (a car prefix, `car`, `empty`, `unsure`; driveway `car`, `none`, `unsure`) and shown in `house.language`.

## Teslemetry credits

Every lock command costs credits of the Teslemetry account, and so does waking a sleeping car. The module sends at most one command per parking and only when the car is outside. Do not send commands to cars that are not yours (see the README of gate, "Teslemetry: shared account").

## Switching over

If you already had template helpers "… home in P and unlocked" and your own lock automation with the same id (`tesla_driveway_lock`, `tesla_garage_arrival_photo`): those automations are overwritten, the old template helpers stay until you delete them. An existing `zone.driveway` stays as it is (`--setup` skips it). If you have UI helpers with the ids of this package (`input_boolean.tesla_driveway_lock_enabled`, `input_number.tesla_driveway_lock_minutes`, `input_text.tesla_garage_photo`), note their values and delete them first: the package creates them again (otherwise they get a `_2` id).

From an earlier kit version: the photo verdict `occupied` still counts (as an unrecognised car), and a photo in the old format that fails to match counts as unsure (the GPS decides) until the next photo.

## Migrating from the Dutch version

Kit versions up to `db5b2fe` used Dutch file names and ids:

| Old                                                          | New                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `/config/packages/tesla_oprit.yaml`                          | `/config/packages/tesla_driveway_lock.yaml`                    |
| `/config/templates/tesla_oprit.yaml`                         | `/config/templates/tesla_driveway_lock.yaml`                   |
| `zone.oprit`                                                 | `zone.driveway`                                                |
| attribute `afstand_tot_oprit_m`                              | `driveway_distance_m`                                          |
| `counter.tesla_commando_s_vandaag` (module gate)             | `counter.tesla_commands_today`                                 |
| photo JSON `{"door": …, "<spot>": "bezet/leeg/onzeker"}`     | `{"car": …, "why": …, "<spot>": "<car prefix>/car/empty/unsure"}` |
| `/media/garage/aankomst-<car>.jpg`                           | `/media/garage/park-<car>.jpg`, `close-<car>.jpg`              |
| notification tag `tesla-oprit-<car>`                         | `tesla-driveway-<car>`                                         |

Steps: delete the two old files (File editor; `deploy.py` stops while they exist), rename the entity id of `zone.oprit` to `zone.driveway` in Settings > Entities (keeps its place and radius), deploy gate first, then this module. The first arrival photo after the switch rewrites `input_text.tesla_garage_photo` in the new format; until then the GPS decides.

## Removing

`deploy.py` removes nothing. Delete `packages/tesla_driveway_lock.yaml` and `templates/tesla_driveway_lock.yaml` yourself (File editor), the automations, the scripts and `zone.driveway`, and restart.

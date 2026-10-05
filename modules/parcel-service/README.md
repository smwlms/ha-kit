# <@ module.name @>

<@ module.description @>.

You choose a day on which you expect a parcel. When someone rings that day and Gemini sees a parcel in their hand or a courier, the garage door opens (or opens ajar) by itself and closes again after the set time. You follow it live and get a photo afterwards. Besides that: a button "Parcel in the garage" in every doorbell notification and, off by default, a notification when Protect sees a parcel left behind. How and why: `LOGIC.md`.

All texts people see or hear follow `house.language` (`strings.yaml`, `en` and `nl`).

## Requirements

| What                                                                         | Why                                                                                               | Needed?     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| Module `doorbell` (filled in again with `parcel-service` in `modules:`)      | the ring automation decides and `script.doorbell_reply` guards "one ajar per ring"                | yes         |
| Module `gate`                                                                | `script.gate_pulse`, `script.gate_close_manual`, `binary_sensor.gate_open` and the button Close gate | yes      |
| End-position contact on the gate (`binary_sensor.gate_open` = off = closed)  | the gate only opens when it is surely closed, and the script checks that it closes again          | yes         |
| Gate controller that **stops on a pulse while moving**                       | only for ajar (`ajar_s` > 0); otherwise the gate opens fully                                      | for ajar    |
| Garage camera                                                                | live view in the notification and a photo just before closing                                     | optional    |
| Gemini (`ai_task`, see module doorbell)                                      | without Gemini the gate never opens by itself; only the button remains                            | yes         |
| iOS: critical notifications allowed for Home Assistant                       | the first notification on a parcel day comes through Silent and Focus                             | recommended |

## Privacy

By default (`doorbell.ai_task` empty) the package-camera photo IS sent to the first AI integration Home Assistant has, e.g. Google Generative AI (Google Gemini). `doorbell.ai_task: none` switches that off; then the gate never opens by itself. Overview: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

Example with invented values: section `parcel_service:` and `entities.garage_camera` in `house.example.yaml`. Needed: `entities.gate_sensor` (module gate); without it filling in stops.

| Field                                                           | Meaning                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `parcel_service.ajar_s`                                         | default travel time until the STOP pulse in seconds; **0 = not ajar, fully open** |
| `parcel_service.open_s`                                         | default time the gate stays open or ajar                                         |
| `entities.garage_camera`                                        | camera in the garage; empty = no live view and no photo                          |
| `entities.doorbell_package_camera`, `entities.doorbell_package` | from the module doorbell; without both "parcel left" drops out                   |
| `doorbell.recipients`, `doorbell.calendar`, devices             | shared with the module doorbell: the same recipients, the same calendar and announcement |
| `house.language`                                                | language of the texts and of Gemini's answer                                     |

`ajar_s` and `open_s` are only the start values: `deploy.py` sets them once, after that you adjust them on the dashboard.

## What you do in the UI

1. On every phone: Settings > Notifications > Home Assistant > **Critical Alerts** on. Without it the first notification comes in as a normal one (not through Silent).
2. Find out whether your controller can do ajar (see `LOGIC.md`, Edge cases). If so: set "Parcel service ajar" on the dashboard to e.g. 6 s and test with someone at the gate.
3. Optional: turn on the automation **"Doorbell: parcel left"** (Automations, or the switch on the example card). Read first why it is off.

## Install

Order: `base`, `gate`, `doorbell`, then this module. When you add the parcel service later: fill in again with `parcel-service` in `modules:` and run `doorbell/deploy.py` and `gate/deploy.py` again (the ring automation gets the parcel steps, "gate open too long" stays silent during a delivery).

```bash
cd build
uv run --with-requirements requirements.txt python parcel-service/deploy.py --dry-run
uv run --with-requirements requirements.txt python parcel-service/deploy.py
```

`deploy.py` first checks that the modules doorbell and gate are ready (and stops otherwise), uploads `packages/parcel_service.yaml`, reloads the helpers, sets the defaults only on new helpers (the day is off), writes the automations and scripts and turns "parcel left" (id `doorbell_parcel_left`) off when it is new. Dashboard: paste `lovelace/parcel-service.yaml` as a card.

## Migrating from the Dutch ids

Earlier versions used Dutch ids. Nothing is migrated automatically.

| Old                                                   | New                                                  |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `input_number.pakjesdienst_kier`                      | `input_number.parcel_service_ajar`                   |
| `input_number.pakjesdienst_open`                      | `input_number.parcel_service_open`                   |
| `input_text.pakjesdienst_bel`                         | `input_text.parcel_service_ring`                     |
| `input_datetime.pakje_verwacht`                       | `input_datetime.parcel_expected`                     |
| `script.deurbel_pakje_garage` (open_s, kier_s, pakjesdienst) | `script.parcel_garage` (open_s, ajar_s, parcel_service) |
| `script.pakje_verwacht` (dag: vandaag, morgen, uit)   | `script.parcel_expected` (day: today, tomorrow, off) |
| automation `pakjesdienst_knoppen`                     | `parcel_service_buttons`                             |
| automation `deurbel_pakje_achtergelaten`              | `doorbell_parcel_left`                               |
| notification action `PAKJE_GARAGE`                    | `PARCEL_GARAGE` (`DEURBEL_GARAGE` -> `DOORBELL_GARAGE`) |
| `packages/pakjesdienst.yaml`                          | `packages/parcel_service.yaml`                       |
| notification tag `deurbel-garage`, group `poort`      | `doorbell-garage`, group `gate`                      |

Steps: note your ajar and open values, deploy (doorbell, gate, then this module), set the values on the new helpers, paste the dashboard card again, then delete the old automations and scripts and `packages/pakjesdienst.yaml`, and restart. The module gate must be filled in again too: its "gate open too long" now watches `script.parcel_garage`.

## Test plan

Short; the full plan without the gate opening unexpectedly is in `LOGIC.md`.

1. `deploy.py --dry-run`.
2. Day on **tomorrow**, ring with a box: normal doorbell notification (not critical), the gate stays closed.
3. Day on **today**, someone at the gate, ring without a box: critical notification, then "No parcel seen: the garage stays closed".
4. Again with a box in your hand: the gate opens (or opens ajar), notification with the garage view, closed after the set time, notification "Parcel in the garage" with photo, row in the visit list.

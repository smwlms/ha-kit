# <@ module.name @>

<@ module.description @>.

When someone rings, every phone immediately gets a notification with a photo of that moment and buttons to reply (text on the screen of the doorbell). The speakers, the Nest Hub and the TV announce it too. A few seconds later Home Assistant silently replaces the notification with what Gemini sees in the photo, e.g. "Someone with a parcel". Every visit goes with its photo into a list on the dashboard. How and why: `LOGIC.md`.

All texts people see or hear (notifications, buttons, spoken sentences, LCD texts, the card) follow `house.language` (`strings.yaml`, `en` and `nl`).

## Requirements

| What                                                                 | Why                                                                                                 | Needed?                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| Module `base`                                                        | folders `packages/`, `command_line/`, `www/` and their lines in `configuration.yaml`                | yes                            |
| Home Assistant 2026.x                                                | the trigger `event.received` and `ai_task.generate_data` with attachments do not exist in older versions | yes                       |
| UniFi Protect doorbell with LCD, integration **UniFi Protect**       | bell button (`event.*`), camera, text on the screen (`text.*`)                                      | yes                            |
| G4 Doorbell Pro: the downward **package camera**                     | second photo for Gemini: hands, children and parcels on the ground are easier to see from above     | optional                       |
| Integration **Google Generative AI** (key from Google AI Studio)     | provides `ai_task.*`: the description of the photo                                                  | optional, strongly recommended |
| Integration **Google Translate text-to-speech**                      | the spoken announcement "The doorbell is ringing" (free, no account)                                | yes, with a speaker or hub     |
| Integration **Local Calendar**, e.g. a calendar "Doorbell"           | one event per visit; the visit list reads it                                                        | yes                            |
| Companion app on every phone in `people`                             | `notify.<notify>` with photo and buttons                                                            | yes                            |
| Sonos (integration **Sonos**)                                        | announcement over the music (announce)                                                              | optional                       |
| Google Nest Hub (integration **Google Cast**)                        | says it and shows the photo                                                                         | optional                       |
| Google TV with the app **TvOverlay** (Play Store), fixed IP          | photo top right on the TV while something is playing                                                | optional                       |

## Privacy

- **Photos to Google Gemini.** By default (`doorbell.ai_task` empty or `auto`) every ring sends the doorbell photo (and the package-camera photo) to the first AI integration Home Assistant has, e.g. Google Generative AI (Google Gemini), for the description. `doorbell.ai_task: none` switches that off: no photo leaves the house, the notification has no description.
- **Spoken sentence** through Google Translate text-to-speech (only with speakers or a Nest Hub).
- **TvOverlay on the TV.** `tvoverlay/doorbell.py` sends the snapshot as base64 over **plain http, without authentication** to `http://<tv_ip>:5001/notify`: anyone on your LAN can read that traffic, and anyone on the LAN can also put a picture on the TV through TvOverlay. Keep the TV and Home Assistant on a trusted network (not a guest network), give the TV a fixed IP, and leave `doorbell.tv` empty if you do not want the photo to travel over the LAN unencrypted.

Overview of every module: the kit's README, section "Privacy & external services".

## Fields in `house.yaml`

Example with invented values: section `doorbell:` and the roles `doorbell_*` under `entities:` in `house.example.yaml` (root of the kit).

| Field                                                       | Meaning                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `people[].notify`, `people[].name`                          | who gets a notification (everyone, unless `doorbell.recipients`)                                      |
| `house.language`                                            | language of the texts and of the spoken sentence (`en` or `nl`)                                       |
| `entities.doorbell_camera`                                  | front camera of the doorbell                                                                          |
| `entities.doorbell_button`                                  | event entity of the bell button (event_type `ring`)                                                   |
| `entities.doorbell_text`                                    | `text.*` for the LCD of the doorbell                                                                  |
| `entities.doorbell_package_camera`, `doorbell_package`      | package camera and its Protect event; leave empty without a G4 Doorbell Pro                           |
| `doorbell.calendar`                                         | the Local Calendar, e.g. `calendar.doorbell`                                                          |
| `doorbell.ai_task`                                          | empty or `auto` = the first `ai_task.*` (photos ARE sent to it); an entity id; `none` = no photo to an AI service. See Privacy |
| `doorbell.tts`, `doorbell.volume`                           | TTS entity (Google Translate) and volume of the announcement in %                                     |
| `doorbell.speakers`                                         | list of Sonos `media_player`s; empty list = no announcement                                           |
| `doorbell.nest_hub`                                         | `media_player` of the Nest Hub; empty = none                                                          |
| `doorbell.tv`, `doorbell.tv_ip`                             | `media_player` of the Google TV (on/off check) and the IP TvOverlay listens on; empty = none          |
| `doorbell.recipients`                                       | list of `people[].key`; empty = everyone                                                              |
| `doorbell.tap_url`                                          | where a tap on the notification goes; empty = the camera view                                         |
| `doorbell.lcd_default`                                      | text that comes back after a reply when the previous text was unknown; empty = "Welcome" / "Welkom"   |

An empty optional device drops out completely: no script, no step, no error.

## What you do in the UI

1. Add **UniFi Protect** (Settings > Devices & services). Then look up the entities of the doorbell and fill them in in `house.yaml`.
   - The package camera ("… Package Camera") is **disabled** by default in the integration: open the entity > Settings > Enabled, then reload the integration.
   - Live view in HA: turn RTSP on for the doorbell in Protect (camera > Advanced). The photos also work without it.
2. **Google Generative AI**: create an API key in Google AI Studio (the free tier is enough for about 10 rings a day) and add the integration. Not "Google Generative AI Conversation (old)" and nothing with "Cloud". Choose the suggested Flash model. Check: an `ai_task.*` entity exists. Read the privacy note in `LOGIC.md` first.
3. Add **Google Translate text-to-speech** (its language does not matter; the automation passes `house.language`). Note the entity id for `doorbell.tts`.
4. Add **Local Calendar** with a name such as **Doorbell**. Check: the calendar entity (e.g. `calendar.doorbell`) exists and is in `doorbell.calendar`.
5. On every phone: Companion app, signed in with its own user, notifications allowed.
6. Optional: add **Sonos** and **Google Cast** (Nest Hub, TV).
7. Optional, TV: install **TvOverlay** on the Google TV, open the app once and give it permission to draw over other apps. Give the TV a fixed IP in your router (`doorbell.tv_ip`). Test: `http://<tv-ip>:5001/` in a browser on your LAN shows the status.

## Install

```bash
cd build
uv run --with-requirements requirements.txt python doorbell/deploy.py --dry-run   # first see what happens
uv run --with-requirements requirements.txt python doorbell/deploy.py
```

`deploy.py` uploads `packages/doorbell.yaml` (helpers), `command_line/doorbell.yaml` (archive cleanup, TvOverlay) and, with a TV, `tvoverlay/doorbell.py`, checks the configuration, reloads, writes the automation and the scripts through the same API as the editors in the UI, publishes the card `cw-bezoeken.js` and reports which entities from the UI are still missing.

- Photos go to `/media/doorbell/archive/`. On HA OS `/media` is allowed for `camera.snapshot` by default; elsewhere: add `/media` to `allowlist_external_dirs`.
- When you add the module **parcel-service** later: fill in again and run this script again. The ring automation and `script.doorbell_reply` then get extra steps.
- The dashboard: paste `lovelace/doorbell.yaml` as a card (Edit > Add card > Manual).

## Migrating from the Dutch ids

Earlier versions used Dutch ids. Nothing is migrated automatically; after deploying, the old entities still exist next to the new ones.

| Old                                                        | New                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `input_text.deurbel_bezoek`, `input_text.deurbel_beschrijving` | `input_text.doorbell_visit`, `input_text.doorbell_description` |
| automation `deurbel_er_wordt_aangebeld`                    | `doorbell_ring`                                              |
| `script.deurbel_antwoord` (knop, bel)                      | `script.doorbell_reply` (button, ring)                       |
| button values `aan_de_deur`, `kom_eraan`, `pakjesdienst`   | `at_door`, `coming`, `parcel_service` (`garage` stays)       |
| `script.deurbel_hub` (tekst, foto), `script.deurbel_tv` (camera, tekst) | `script.doorbell_hub` (text, photo), `script.doorbell_tv` (camera, text) |
| notification actions `DEURBEL_AAN_DE_DEUR`, `DEURBEL_KOM_ERAAN`, `DEURBEL_GARAGE`, `PAKJE_GARAGE` | `DOORBELL_AT_DOOR`, `DOORBELL_COMING`, `DOORBELL_GARAGE`, `PARCEL_GARAGE` |
| `notify.tvoverlay_deurbel`, `/config/tvoverlay/deurbel.py` | `notify.tvoverlay_doorbell`, `/config/tvoverlay/doorbell.py` |
| archive sensor (unique_id `deurbel_archief_fotos`)         | unique_id `doorbell_archive_photos` (a new entity)            |
| `/media/deurbel/archief/`, `/media/deurbel/tv.jpg`         | `/media/doorbell/archive/`, `/media/doorbell/tv.jpg`          |
| `packages/deurbel.yaml`, `command_line/deurbel.yaml`       | `packages/doorbell.yaml`, `command_line/doorbell.yaml`        |
| notification tags `deurbel`, `deurbel_pakje`               | `doorbell`, `doorbell_parcel`                                 |
| card config key `bezoek`                                   | `visit` (`bezoek` still works)                                |

Steps: deploy, paste the dashboard card again, then delete the old automation and scripts (Settings > Automations & scenes), the files `packages/deurbel.yaml`, `command_line/deurbel.yaml` and `tvoverlay/deurbel.py` (File editor), and restart; remove the orphaned old entities in Settings > Entities. Old visits in the calendar keep their photo path (`foto: deurbel/archief/…`) and still show in the card as long as the photo exists; the old folder `/media/deurbel/archief/` is no longer cleaned up: delete it after 31 days.

## Test plan

1. `deploy.py --dry-run`: shows the uploads, the automation and the scripts, makes no connection.
2. Developer tools > Actions > `script.doorbell_reply` with `button: coming`: "I'm coming" on the LCD, after 3 min the previous text is back.
3. Ring. Within 1 to 2 s: notification with photo on every phone (long-press = buttons), announcement on the speakers and the Nest Hub, photo on the TV when it is on.
4. After about 5 to 10 s: the notification silently changes into e.g. "Someone · 14:32 …" with Gemini's sentence. Same sentence in `input_text.doorbell_description`, new row in the visit list.
5. Again with a box in your hand: title "Parcel at the door".
6. Something wrong? Automations > "Doorbell: someone is ringing" > Traces (step `ai_task.generate_data`) and the logbook at "Doorbell visit".

The examples are the English texts; with `house.language: nl` the Dutch ones from `strings.yaml`. More edge cases and what each step does: `LOGIC.md`.

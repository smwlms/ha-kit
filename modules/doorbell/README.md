# <@ module.name @>

<@ module.description @>.

When someone rings, the phones of everyone who wants it immediately get a notification with a photo of that moment and buttons to reply (text on the screen of the doorbell). Every person chooses when: always, only when home, only when away, only on a parcel day, or never (see "Who gets a notification"). The speakers, the Nest Hub and the TV announce it too. A few seconds later Home Assistant silently replaces the notification with what Gemini sees in the photo, e.g. "Someone with a parcel". Every visit goes with its photo into a list on the dashboard. How and why: `LOGIC.md`.

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
| `people[].notify`, `people[].name`                          | who may get a notification (everyone with `notify`, unless `doorbell.recipients`); each one chooses when |
| `people[].person`                                           | person entity for "Only when I'm home / away"; default `person.<key>`                                 |
| `people[].user_id`                                          | Home Assistant user id: only that user sees "My doorbell notifications"; empty = only in the overview  |
| `people[].admin`                                            | sees the overview of everyone's choices (with a `user_id`); gets the garage safety notifications when nobody is subscribed |
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
| `doorbell.recipients`                                       | list of `people[].key`; empty = everyone with `notify`. The upper limit: within it each person chooses |
| `doorbell.tap_url`                                          | where a tap on the notification goes; empty = the camera view                                         |
| `doorbell.lcd_default`                                      | text that comes back after a reply when the previous text was unknown; empty = "Welcome" / "Welkom"   |

An empty optional device drops out completely: no script, no step, no error.

## Who gets a notification

Every person in `doorbell.recipients` (empty = everyone with `people[].notify`) gets a helper and chooses on the dashboard when a notification comes:

| Helper                                | When                       | Options (the first is the start value)                                                   |
| ------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `input_select.doorbell_<key>_ring`    | always                     | Always, Only when I'm home, Only when I'm away, Only on a parcel day (with parcel-service), Never |
| `input_select.doorbell_<key>_parcel`  | with `parcel-service`      | Always, Only when I'm home, Only when I'm away, Never: "parcel left" and the garage notifications |

- "Home" = the person entity (`people[].person`, default `person.<key>`) is `home`; a missing person entity counts as away. "Parcel day" = `input_datetime.parcel_expected` is today.
- **Nobody matches** (e.g. everyone only when home and nobody is home): everyone who is not on Never gets it. A ring never gets lost by accident.
- **Everyone on Never**: no phone notification, only the logbook line "no notification · nobody subscribed". The speakers, Nest Hub, TV, visit list and LCD work as before.
- The choice is made **once per ring**: the first notification and its silent replacement after Gemini go to the same phones.
- With `parcel-service`: whoever presses a garage button always gets the follow-up, and the safety notifications of the garage (not opened, no movement, not closed) go to the admins when nobody is subscribed. Details: `parcel-service/README.md`.
- The logbook says who got it: "notification to Jan, Lien".

**On the dashboard** (`lovelace/doorbell.yaml`): a card "My doorbell notifications" per person with `people[].user_id` (only that user sees it) and "Doorbell notifications of everyone" for the admins with a `user_id` (without such an admin every user sees it). `deploy.py` prints the user id of every person without one: copy it into `house.yaml`, fill in again and paste the card again.

**No protection.** The cards only hide. Every user who can open Settings > Helpers (or the overview) can change someone else's choice. For a family that is enough.

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
- After the first deploy everyone is on **Always**. Set your choice on the card (or in Settings > Helpers, "Doorbell: ring for …").
- Updating from a kit version without per-person choices: fill in again, run this script (and `parcel-service/deploy.py` when you have it), paste the card again and set the choices. Until then nothing changes: everyone starts on Always.

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
6. Who gets it: set one person on **Never** and ring: only the others get the notification, logbook "notification to …". Everyone on Never: no notification, logbook "nobody subscribed". Someone on "Only when I'm home" while away, and the rest on Never: that person gets it anyway (nobody matches). Put everyone back on your choice.
7. Log in as a user with `people[].user_id`: the card shows only your own choice (and the overview for an admin).
8. Something wrong? Automations > "Doorbell: someone is ringing" > Traces (step `ai_task.generate_data`) and the logbook at "Doorbell visit".

The examples are the English texts; with `house.language: nl` the Dutch ones from `strings.yaml`. More edge cases and what each step does: `LOGIC.md`.

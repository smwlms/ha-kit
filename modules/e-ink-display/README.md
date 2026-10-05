# <@ module.name @>

<@ module.description @>.

**Status: built (screen tested in a browser by the source), not tested on the device.** The page is a port of a screen
that runs live in a browser (tapping, navigation, refresh tested there); the kit version is filled in, rendered with a
mocked Home Assistant in headless Chromium at 1600 x 1200 and 1200 x 1600 (both languages, a full and a minimal house)
and checked in grayscale. Not yet on a real e-ink tablet, and the charging automation not yet on a real Home Assistant.

- Layer: core (UI). Depends on: - (every block follows `modules:`, the capabilities and the roles). Provides: -.
- One dashboard (default `e-ink`, not in the sidebar) with one panel view (default `display`) and
  `custom:e-ink-screen-card` (`/local/ha-kit/e-ink-display/e-ink-screen.js`).
- Helper `input_number.e_ink_display_refresh` (5 to 600 s), and with a charger relay the smart-charging automation.

## What you see

One page, designed for e-ink: black text on white, a few dark colour accents on icons only, no animations, large
touch targets (buttons 96 px, tiles 76 px). It zooms to fit the screen, landscape (1600 x 1200) or portrait
(1200 x 1600, one column).

- **Header**: date, week number, time of the last redraw, and up to 6 buttons to your other screens (home, energy,
  climate, shading, cars, our week, results: whatever your modules have, or the paths you set).
- **Weather** (needs `entities.weather` or `entities.outdoor_temperature`): now, today's low and high, every second
  hour for 12 hours, the next 3 days.
- **Agenda** (needs `e_ink_display.calendars`): today and tomorrow, at most 6 events.
- **Home**: a tile per person (home, away, or the zone), the gate (`gate` with a gate sensor; first tap arms, the second
  tap within 5 s opens or closes), the doorbell (`doorbell`), the blinds (`shading`), indoor temperature, hot water
  (a module that provides `hot-water-heater`), one tile per car (`tesla-route`), and your own tiles. At most 12.
- **Energy** (needs at least one energy role or a price): solar, house, grid, home battery, a "today" line and the
  price for the next 12 hours with the cheapest 2 hours on a yellow band (a `tariff` module, or
  `entities.price_import` with the attributes `starts` and `prices`).

A block without any of its roles is left out and the others take the room; a tile without a value is not drawn.
Which tile needs what, and what a tap does: `LOGIC.md`.

## Which device

Any screen that runs a browser shows the page. For a wall display you can touch and that also gives you the full Home
Assistant app (more-info dialogs, other dashboards), the practical choice is an **Android e-ink tablet**:

- **Touch and the full app** need Android: the HA Companion app or a kiosk browser runs on it. E-ink panels driven by
  a microcontroller (ESPHome) show a picture of a page, refresh slowly and mostly have no touch.
- **Colour**: a Kaleido 3 (colour filter) tablet shows muted colours at half the resolution (about 150 ppi in colour,
  300 ppi in black and white). The page never relies on colour: red only marks a warning that also has a thicker
  border and a capital word, yellow only sits behind black text. A black-and-white tablet works just as well.
- **Size**: 13.3" (about A4) reads from a few metres; 10.3" (about A5) is enough next to a door.
- **Battery**: these tablets have no built-in charge limit that you can count on. Keeping one on the charger 24/7
  wears the battery; use the smart charging below (a relay between 30 and 80 %).

Without touch (a picture refreshed now and then is enough): an ESPHome e-ink panel showing a screenshot of this view
(for example with a screenshot add-on) works too; the page is designed at the same 1600 x 1200. The buttons and the
gate tile then have no use.

## Setup on the tablet

1. Install the **HA Companion app** (or **Fully Kiosk Browser**) and log in with a **dedicated Home Assistant user**
   for the tablet: not an administrator, "Can only log in from the local network" on.
2. For that user pick a **light theme** (Profile > Theme, or the theme button of `base`: Appearance > Light). The
   page itself is always black on white, but the dialogs that open on a tap follow the HA theme, and a dark dialog
   renders badly on e-ink (grey, ghosting).
3. Open `/<dashboard>/<view>` (default `/e-ink/display`) and make it the start page: in the Companion app the default
   dashboard of that user (Settings > Dashboards > the dashboard > Set as default on this device), in Fully Kiosk the
   Start URL. Kiosk mode (no HA header and sidebar) is optional: the page covers the window anyway.
4. **Screen always on**: in Android (display timeout off or "stay awake while charging" in the developer options), in
   the Companion app (Settings > Companion app > Keep screen on) or in Fully Kiosk (Keep screen on). E-ink uses almost
   no power while the picture stands still.
5. **Refresh mode of the device**: e-ink tablets have per-app refresh modes (on Boox for example HD, Balanced, Fast,
   Ultrafast). Start with a balanced mode for the HA app: fast modes ghost more, HD is slow to react to a tap. Turn
   off animations in Android (developer options: animation scales off).
6. Tune **`input_number.e_ink_display_refresh`** (seconds between redraws, default 30): the page redraws at most this
   often and only when something on it changed. Longer = fewer flashes and less ghosting. Right after a tap it redraws
   at once for 8 s, so the screen answers your finger.
7. Smart charging: the battery sensor of the app (Companion: Settings > Companion app > Manage sensors > Battery
   level; Fully Kiosk: its integration) goes in `e_ink_display.battery`, the relay in `e_ink_display.charger_relay`.

## In the wall: a generic plan

Measure first: the outside dimensions on the shop pages are rounded, and the position of the power button and the
USB-C port decides the back box. Test the tablet for a week on a stand (app, refresh mode, readability from where you
stand), then tape a cardboard template of the frame on the wall before you cut anything.

1. **Wall**: a non-load-bearing stud or plasterboard wall with at least **35 to 40 mm** of depth behind the board.
   No cables or pipes behind the opening (check with a detector).
2. **Opening**: the measured device plus about **3 mm per side**. Cut it a little small and file to size.
3. **Frame**, 3D-printed in **PETG** (heat- and creep-resistant enough for a wall; PLA sags near a warm charger): a
   front bezel that overlaps the screen edge by about 1 mm and covers the cut, a back box that holds the tablet and an
   angled (90°) USB-C plug, clamping wings behind the board, and a removable (for example magnetic) part of the bezel
   over the power button.
4. **Power**: a **USB-C wall charger** (USB PD, 18 W or more is plenty) in a cavity wall box next to the opening, a short
   angled cable to the tablet, and a **relay** in front of the charger (a relay in the second cavity box, or a smart
   plug when the charger is a plug-in one). Mains work in the wall is for a qualified electrician where your local
   rules say so.
5. **Heat and air**: e-ink makes hardly any heat, but a battery that charges does: leave a small gap around the back
   box and do not close the cavity airtight. Look at the tablet once a year (a bulging back or edge = a swollen
   battery: take it out of service).
6. **Smart charging** (this module): charger on below 30 %, off above 80 % (both tunable), and on as a fail-safe when
   the battery sensor stays silent for 3 hours.

## Fields in `house.yaml`

All optional; see the section `e_ink_display:` in `house.example.yaml`. Own fields: `dashboard`, `view_path`,
`calendars`, `battery`, `charger_relay`, `tiles`, `solar_today_kwh`, `grid_import_today_kwh`, `paths`. Also read:
`people[]`, `cars[]` (with `tesla-route`), `rooms[].blind` (with `shading`), `entities.weather`,
`outdoor_temperature`, `indoor_temperature`, the energy roles (`solar_power_w`, `grid_import_w`, `grid_export_w`,
`battery_soc`, `battery_power_w`, `house_power_w`, `solar_forecast_today`, `price_import`),
`energy.battery_power_sign`, `entities.gate_sensor`, `doorbell_button`, `doorbell_camera`, and the `view_path` of
`home_screen`, `climate` and `results` for the default buttons.

## Install

```bash
uv run --with-requirements requirements.txt python e-ink-display/deploy.py --dry-run          # plan + diff, no connection
uv run --with-requirements requirements.txt python e-ink-display/deploy.py --dry-run --live   # against your HA (read-only)
uv run --with-requirements requirements.txt python e-ink-display/deploy.py
```

`deploy.py` uploads the helper package (and gives new helpers their default once), writes the charging automation
when a relay is configured, uploads the card, creates the dashboard when it does not exist (storage mode, not in the
sidebar, for every user), saves an existing dashboard to `backup/` and writes only its view: a view with the same
path is replaced in place, a new one is added first. Other views on that dashboard stay as they were.

Without `deploy.py`: copy `package.yaml` to `/config/packages/e_ink_display.yaml`, add the resource
`/local/ha-kit/e-ink-display/e-ink-screen.js` (type module), make a dashboard and paste `lovelace/view.yaml` as a
view in the raw configuration editor.

After adding or removing a module, or changing `house.yaml`: fill in again and run `deploy.py` again. Removing the relay
later: `deploy.py` names the old automation; delete it in Settings > Automations.

## Test plan

See `LOGIC.md`, "Test plan".

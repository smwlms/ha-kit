# <@ module.name @>

<@ module.description @>.

**Status: built, not tested on HA.** Filled in, rendered and tapped through in a headless browser with a mocked Home
Assistant (both languages, the example house and a minimal house); not yet on a real Home Assistant. Contract:
[docs/phase4-contracts.md](../../docs/phase4-contracts.md), section "home-screen".

- Layer: core (UI). Depends on: - (every block follows `modules:` and the capabilities). Provides: -.
- One view `home` with `custom:home-screen-card` (`/local/ha-kit/home-screen/home-screen.js`).

## What you see

A greeting with the date, a row of status chips (each HA user picks which chips and their order: long press, or the
sliders button), the arrival card of `tesla-route` while a car is on the road, and below it the cards Energy, Controls,
Playing now and To-do. The layers button switches to the extended view: Climate, Cars, Rooms and "What the house does
itself". Which chip needs which module, what it shows and what a tap does: `LOGIC.md`.

## Requirements

| What | Why |
| ---- | --- |
| Module `base` | `cw-thema.js`: header, status row, metrics, toggles, info sheet |
| A dashboard in storage mode | `deploy.py` writes the view into it (the Overview: Edit dashboard > Take control first) |
| Module `tesla-route` (optional) | the arrival card inside the home screen |
| The modules whose chips you want | a chip or card only appears when its module is in `modules:` |

## Fields in `house.yaml`

All optional. `modules:` and the capabilities decide the blocks; `people`, `cars`, `rooms` and the roles of the other
modules give the entities. Own fields under `home_screen:` (see `house.example.yaml`): `toggles`, `media_players`,
`cameras`, `todo`, `map_token`, `paths`, `protect_url`, `view_path`. Also read: `entities.indoor_temperature`,
`outdoor_temperature`, `weather`, the energy roles (with `energy-plan`), `energy.battery_power_sign`,
`tariff.capacity.minimum_kw`, `climate.comfort`.

## Install

```bash
uv run --with-requirements requirements.txt python home-screen/deploy.py --dry-run          # plan + diff, no connection
uv run --with-requirements requirements.txt python home-screen/deploy.py --dry-run --live   # diff against your dashboard (read-only)
uv run --with-requirements requirements.txt python home-screen/deploy.py                    # Overview
uv run --with-requirements requirements.txt python home-screen/deploy.py --dashboard ha-kit-home   # own dashboard
```

`deploy.py` uploads the card, registers it as a resource, saves the dashboard to `backup/` and writes only the view
`home`: an existing view with that path is replaced in place, a new one becomes the first view (`--append`: the last).
Every other view stays as it was. Without `deploy.py`: paste `lovelace/home.yaml` as a view in the raw configuration
editor and add the resource `/local/ha-kit/home-screen/home-screen.js` (type module) yourself.

After adding or removing a module, or changing `house.yaml`: fill in again and run `deploy.py` again. The chips follow.

## What you do yourself in the UI

- Per HA user: long press on the status row (or the sliders button) to choose the chips; the choice is saved per user.
- Optional: Settings > Dashboards: make the dashboard with the home view your default.

## Test plan

See `LOGIC.md`, "Test plan".

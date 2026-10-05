# <@ module.name @>

<@ module.description @>.

Every other module builds on this one: it puts its helpers in `packages/`, its sensors in `templates/` or `command_line/`, and its cards use the `cw-*` colours and components from this module.

## Requirements

| What                                                             | Why                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Home Assistant 2025.x or newer                                   | theme modes (light/dark), `frontend.set_theme` with `mode`, dashboard resources over the websocket         |
| HA OS or Supervised + the **File editor** app                    | `deploy.py` uploads through the ingress API of File editor. Without it: copy the files yourself with the **Samba share** app or SSH |
| Python 3.11 + [uv](https://docs.astral.sh/uv/) on your computer   | `fill.py` and the deploy scripts (`uv run --with-requirements …` installs the pinned jinja2, pyyaml and websockets of `requirements.txt`) |
| Long-lived access token of an admin user                         | `HA_TOKEN`; create one in Profile > Security                                                              |

## Once: configuration.yaml

Merge these lines into your existing `/config/configuration.yaml` (they are also in `configuration.snippet.yaml`) and restart Home Assistant:

```yaml
homeassistant:
  packages: !include_dir_named packages/

frontend:
  themes: !include_dir_merge_named themes

template: !include_dir_merge_list templates/

command_line: !include_dir_merge_list command_line/
```

Did you already have `template: !include templates.yaml` or `command_line: !include command_line.yaml`? Then move that content to a file in the new folder (e.g. `templates/own.yaml`). The same key twice in `configuration.yaml` is not allowed.

## Install

```bash
export HA_URL=http://<address-of-your-ha>:8123
export HA_TOKEN=<long-lived access token>
cd build
uv run --with-requirements requirements.txt python base/deploy.py --dry-run         # look first at what it will do
uv run --with-requirements requirements.txt python base/deploy.py --default-theme   # upload, base.default_theme as default
```

`deploy.py` checks `configuration.yaml` (it only reports what is missing and never changes it), creates the folders, uploads the chosen themes (one file per theme, `/config/themes/<id>.yaml`), reloads the themes, uploads `cw-thema.js` and registers it as a dashboard resource. After the reload it names every other theme with `cw-*` tokens that HA still has (a leftover, see "Migrating"). After the very first upload to `/config/www`, restart once; otherwise `/local/cw-thema.js` returns a 404.

## Privacy

The themes ask for the fonts Figtree and Caprasimo. `deploy.py` registers the Google Fonts stylesheet
(`https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree…`) as a dashboard resource, so **every browser
that opens a dashboard** (also the wall tablet of `e-ink-display`) loads it from Google: Google sees the IP address,
the browser and the time. Subresource Integrity is not possible here: Google serves a different stylesheet per
browser and changes it without notice. Two ways out, both with `deploy.py --no-fonts` from then on:

- **Self-host**: download the woff2 files of Figtree (400, 500, 600, 700) and Caprasimo (e.g. from the Google Fonts
  download or fontsource), put them in `/config/www/fonts/` with a `fonts.css` of `@font-face` rules pointing at
  `/local/fonts/…`, add `/local/fonts/fonts.css` as a resource of type stylesheet and delete the Google one in
  Settings > Dashboards > Resources.
- **Drop them**: delete the Google resource there. Everything falls back to the system font (`system-ui`); it works,
  it only looks less warm.

Overview: the kit's README, section "Privacy & external services".

## Fields in house.yaml

All optional; without a `base:` section every theme is installed and Organic is the default.

```yaml
base:
  themes: [organic, garden, coast, heath, graphite] # ids = file names in themes/; default: all
  default_theme: { light: organic, dark: organic } # or one id for both modes; used by deploy.py --default-theme
```

## Themes

Five themes with the same `cw-*` tokens, fonts (Figtree, Caprasimo) and shapes; only the colours differ. Each has a light and a dark mode, and every text and icon colour reaches at least 4.5:1 on card, page and raised surface (checked by `tools/build_themes.py`). The energy colours (`cw-zon`, `cw-net`, …) are the same in every theme, so a flow keeps its colour whoever is looking.

| Id         | Name (en) | Name (nl) | Mood                                              | Accent light / dark   |
| ---------- | --------- | --------- | ------------------------------------------------- | --------------------- |
| `organic`  | Organic   | Organic   | cream and sand, terracotta and sage (tuned by hand) | `#C67139` / `#D67F48` |
| `garden`   | Garden    | Tuin      | sage and moss with a warm clay tone                | `#8AA373` / `#9DB884` |
| `coast`    | Coast     | Kust      | mist blue and sea water with a sand tone           | `#5E93B0` / `#7FB3CF` |
| `heath`    | Heath     | Heide     | lavender and plum with sage                        | `#A586B3` / `#C3A3D2` |
| `graphite` | Graphite  | Grafiet   | stone and graphite with ochre, high contrast       | `#D2A23C` / `#E0B54F` |

The name HA shows (Profile > Theme, the theme button) is the YAML key of the theme file and follows `house.language`; the file name is the id and never changes. Why: a user's choice is stored by theme name, so the names of a Dutch-language house stay those of the Dutch original (Tuin, Kust, …) and nobody loses their choice; an English house gets English names. See `LOGIC.md` for the trade-off.

### The theme button

`<cw-thema-knop>` (in every `<cw-kop>`, or alone as the card `custom:cw-thema-kiezer`) opens a small menu: **Style** lists every HA theme that carries the `cw-*` tokens in light and dark (a swatch + the name, the default first), **Appearance** is Automatic / Light / Dark. The choice goes through HA's own `settheme` event: it is stored per HA user, on every device of that user. With only one theme installed the Style list is left out.

### Adding a theme

1. Add a palette to `tools/palettes.yaml` (14 colours per mode; the comment at the top says what each one does).
2. Add its names to `strings.yaml` (`theme_name_<id>`, `en` and `nl`) and the id to `theme_ids` in `_themes.jinja`.
3. Run `uv run --with-requirements tools/requirements.txt python modules/base/tools/build_themes.py --write` in the kit: it writes `themes/<id>.yaml` and checks every theme. Commit the generated file too, so users without Python have it.
4. Without `--write` the script only checks (also that the committed files match the palettes); a pair under 4.5:1 fails. Organic is tuned by hand in `themes/organic.yaml`; the other themes take its fonts and shapes.

## Migrating

### From the Dutch original (one file `themes/claude.yaml` with Organic, Tuin, Kust, Heide, Grafiet)

The kit puts every theme in its own file (`/config/themes/organic.yaml`, `garden.yaml`, …). Two files with the same theme name are not an error for HA: one silently wins. So:

1. Fill in and run `deploy.py` (with `--default-theme` if the server default should stay Organic).
2. Delete the old `/config/themes/claude.yaml` (File editor or Samba), then Developer tools > Actions > `frontend.reload_themes`.
3. File editor > `/config/themes`: only the kit files (and themes of your own) are left. `deploy.py` cannot see a duplicate name in two files; it does name a theme with `cw-*` tokens that is not part of this build.

Theme names with `language: nl` (choices of every user are kept):

| Old name (claude.yaml) | Kit file           | Name with nl | Name with en |
| ---------------------- | ------------------ | ------------ | ------------ |
| Organic                | `organic.yaml`     | Organic      | Organic      |
| Tuin                   | `garden.yaml`      | Tuin         | Garden       |
| Kust                   | `coast.yaml`       | Kust         | Coast        |
| Heide                  | `heath.yaml`       | Heide        | Heath        |
| Grafiet                | `graphite.yaml`    | Grafiet      | Graphite     |

### Changing house.language

A new language renames the themes (except Organic). The files keep their names, so `deploy.py` overwrites them and the old names disappear after the reload. A user who had picked the old name falls back to the default theme until they pick again; run `--default-theme` so that default is a kit theme.

## Language

The texts of the components (theme menu and theme names, status row picker, info sheet, weather names, number format) come from `strings.yaml` in `house.language` (`en` or `nl`). After changing the language: fill in again and run `deploy.py` again; the language is part of the resource version (`?v=28-en`), so browsers load the new file.

## What you do yourself in the UI

- Per user: the theme button (or Profile > Theme) > a style and a mode; `--default-theme` sets `base.default_theme` for everyone without an own choice.
- Fonts: the theme asks for **Figtree** and **Caprasimo**. Without those fonts it falls back to the system font; it works, but looks less warm. See `LOGIC.md`.

## Test plan

1. `deploy.py --dry-run`: shows the target paths, does not connect.
2. `deploy.py`: no error; Settings > Dashboards > Resources contains `/local/cw-thema.js?v=…`.
3. Profile > Theme: every theme of `base.themes` is in the list, once, with the names of `house.language`; pick one, switch between light and dark.
4. Add a card `type: custom:cw-thema-kiezer` to a dashboard: the round button shows the current mode and opens <@ t('theme_style') @> (a swatch per theme, the current one ticked) and <@ t('theme_menu') @> (<@ t('theme_auto') @> / <@ t('theme_light') @> / <@ t('theme_dark') @>). Pick another style: the whole page changes; a second device of the same user follows after a reload.
5. `deploy.py --default-theme` in a private window or with a user without a choice: the default theme shows.
6. A card with `cw-status` and a saved choice (`bewaar="…"`): long press opens the picker; the line under the list counts the visible chips and rows in `house.language`.

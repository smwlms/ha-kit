# Contributing to ha-kit

Thanks for helping. A new module, a second brand for an existing function, a fix, a translation: all welcome. This file explains how a module looks, the conventions every module follows, how to test, and the privacy rules.

Every pull request is reviewed by the maintainer (see `.github/CODEOWNERS`); `main` is protected and CI (`tools/check.py --esphome`) must pass.

## Layers: core, brand adapter, region

| Layer        | Example                                                     | Rule                                                                                       |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Core         | `shading`, `notifications`, `presence`, `room-sensor`       | brand-free: works on roles (`cover.*`, `climate.*`, sensors) that `house.yaml` points at     |
| Brand adapter | `ventilation-zehnder`, `spa-spanet`, `tesla-route`         | provides the roles a core module needs, for one brand; a second brand is a new adapter      |
| Region       | `tariff-be`                                                 | country rules (tariffs, grid operator); another country gets its own region module          |

**Capabilities** let a core module depend on "any brand" or "any region": the adapter or region module declares `provides: [ev-charger]` in its `module.yaml`, the core module `depends_on: [ev-charger]`. `fill.py` accepts any chosen module that provides it, refuses two providers of the same capability, and gives every template the list `capabilities` (`<% if 'tariff' in capabilities %>`). `choose.py` never picks a provider for you. Phase-4 capabilities: `tariff`, `ev-charger`, `heat-pump`, `hot-water-heater` (contracts in `docs/phase4-contracts.md`). A new brand or region implements the same entity ids and scripts as the existing provider.

Naming: module folders in lower case with hyphens. An adapter is called `<function>-<brand>` (`ventilation-zehnder`, `doorbell-reolink`). Helper and entity ids are English (`input_boolean.gate_auto_open_enabled`). Renaming an id breaks existing installations: do it only with a "Migrating" section in the module README (table old → new, steps), and let `deploy.py` name the leftovers where it can.

## Anatomy of a module

Copy `modules/_template/` to `modules/<your-module>/`; it is minimal and passes `tools/check.py`.

```text
modules/<module>/
  module.yaml        metadata: name, description, status, depends_on, provides, requires, optional, generate, ask, house_fields, defaults, check_variant
  README.md          requirements, fields in house.yaml, what you do in the UI, install, test plan
  LOGIC.md           every decision written out (sections below)
  strings.yaml       user-facing texts, {key: {en: ..., nl: ...}} (optional, but required for texts users see)
  package.yaml       helpers, scripts, template sensors -> /config/packages/<module>.yaml
  automations.yaml   automations, written through the config API by deploy.py
  scripts.yaml       scripts (optional)
  deploy.py          uploads and reloads; --dry-run prints what it would do
  _<module>.jinja    partial shared by the module's files (optional)
  esphome/           firmware (ESPHome modules) + secrets.example.yaml
```

### module.yaml

| Field          | Meaning                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `name`         | short name (required)                                                                                       |
| `description`  | one line, what it does for the user (required)                                                              |
| `status`       | `built`, `built, not tested on HA`, `template`, `skeleton` (contract only, not offered by `choose.py`), …: shown by `fill.py --list` and in the README table |
| `depends_on`   | modules (or capabilities) whose helpers, scripts or sensors this one reads; `fill.py` stops when one is not in `modules:` or no chosen module provides it |
| `provides`     | capabilities this module implements (`tariff`, `ev-charger`, …), see "Layers"                              |
| `requires`     | `integrations:` and `hardware:` lists (shown by `--list`, used by `choose.py`)                              |
| `optional`     | `true` when the build order may skip it                                                                     |
| `generate`     | render one source file per item of a list in `house.yaml`: `{source, per, if, name}` (see `room-sensor`)    |
| `ask`          | questions for `tools/choose.py`: `{id, question}` (yes/no) or `{id, question, options, need}` (a brand choice). Same `id` in several modules = asked once; a module is chosen when every question gets the answer it needs |
| `house_fields` | the `house.yaml` fields this module reads (documentation)                                                   |
| `defaults`     | start values of helpers, set ONCE by `deploy.py` (see "Defaults")                                           |
| `secrets`, `pins` | ESPHome modules: the secrets the firmware needs; pinned versions (`esphome_tested` is used by CI)        |
| `check_variant` | `{section: {key: value}}`: the other side of your optional switches; `tools/check.py` puts them in its all-modules house so both branches are filled in and validated |

`generate.name` and every file of the module are Jinja templates; `generate.if` is a Jinja expression with `item`.

## Conventions

### Markers

`tools/fill.py` renders every text file of a module with Jinja2 using its own delimiters, so Home Assistant templates (`{{ }}`, `{% %}`) pass through untouched:

| Marker                    | Meaning                     |
| ------------------------- | --------------------------- |
| `<@ car.name @>`          | value                       |
| `<% for car in cars %>`   | block (`for`, `if`, `set`…) |
| `<# note #>`              | comment, disappears         |

- The context is the whole `house.yaml` plus `module` (the module's own `module.yaml`). An unknown name is an error, never an empty text.
- Put `<% … %>` blocks on their own line: the newline right after a block disappears (`trim_blocks`), the indentation before it too (`lstrip_blocks`).
- **No markers in markdown tables.** A formatter breaks them (`|` in a marker splits a cell, `_` becomes `\_`). Compute values in `<% set … %>` lines at the top (in markdown inside an HTML comment `<!-- … -->`) and use at most a simple name in a table. `.prettierignore` excludes `modules/**`, but an editor hook that runs from another folder ignores that file: write module files with a plain editor or a script.
- Filters on top of Jinja's own: `regex_replace` and `regex_search` (same signatures as in Home Assistant).
- Every key in `module.yaml` and `strings.yaml`, and every text in `strings.yaml`, must be a string. YAML 1.1 reads an unquoted `no`, `off`, `yes`, `on` as a boolean (and `{ en: Why, for the logbook }` as two keys): `fill.py` stops with file and line. Quote such keys and texts (`"off": …`, `en: "Why, for the logbook"`).

### Partials

A file `_<name>.jinja` in the module folder or in `tools/partials/` can be imported or included and is never copied to the build folder. The module folder is searched first.

```text
<% from '_presence.jinja' import places, school with context %>   names set at the top of the partial
<% include '_note.jinja' %>                                        text
```

`with context` is needed as soon as the partial reads `house.yaml` or `module`. Only names set at the top level can be imported (not inside a `for`). Use a partial when several files of a module derive the same thing from `house.yaml`. `tools/partials/_esphome.jinja` gives every ESPHome module the same entity naming (`title()`, `prefix()`).

### Functions: `fail()`, `car_entity()`, `t()`

- `<@ fail('reason') @>`: stop filling in with module, file and line, e.g. `<% if not cars %><@ fail('house.yaml has no cars (the module gate needs at least one)') @><% endif %>`. Use it for every required field instead of letting an unknown name fail. Messages in English, naming the `house.yaml` key.
- `<@ car_entity(car, 'location') @>`: the entity id of a car for a role: `cars[].entities.<role>` when set, else the pattern `teslemetry.<role>` with `{p}` = `car.prefix`. Never build car entity ids yourself.
- `<@ t('key', name=person.name) @>`: a user-facing text from the module's `strings.yaml` in `house.language` (default `en`). `{name}` in the text is replaced by the keyword argument; other braces stay as they are, so a text may contain Home Assistant or JavaScript expressions. A missing language falls back to `en` with a warning; a missing key is an error.

```yaml
# modules/<module>/strings.yaml
notify_title: { en: Gate open, nl: Poort open }
notify_message: { en: "The gate has been open for {minutes} min.", nl: "De poort staat {minutes} min open." }
```

Every text a user sees (notifications, card labels, logbook lines, spoken sentences, helper names) goes through `t()`. Error messages of `fail()` and the output of `deploy.py` are for the installer and stay English.

### Roles, not entity ids

A module never hard-codes an entity of one house. It reads a role from `house.yaml` (`entities.gate_relay`, `rooms[].blind`, `car_entity(car, 'lock')`) and documents it in `house.example.yaml`: what it is, `(required)` or `(optional)`, for which module, with an invented example value. Optional means: empty is allowed and the part that needs it is left out. Add the field to `house_fields:` in `module.yaml`. While a module is being built, its fields may live in a `house.fragment.yaml` in the module folder (never copied); merge them into `house.example.yaml` when the module is done.

### Defaults: no `initial`

Helpers the user tunes never get `initial` or `initial_state`: those reset on every restart. Put the start value in `defaults:` in `module.yaml`; `deploy.py` sets it once, only for a helper that is new:

```python
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
before = ha_api.entity_ids()          # before uploading the package
# ... upload, check_config, reload ...
ha_api.set_defaults(DEFAULTS, before)  # input_boolean, input_number, input_datetime, input_text, input_select
```

A key with `*` covers every new helper that matches it, the `*` standing for any text: at the end (`input_number.shading_angle_*`, one per facade) or in the middle (`input_number.ev_plan_*_target`, one per car). Exact keys win over a wildcard. After that the value belongs to the user.

### Escaping house.yaml values

A value from `house.yaml` is data, never code. Wherever it lands outside YAML, escape it:

- **JavaScript and Python**: `<@ value | tojson @>` (a quoted, escaped string); numbers `<@ value | float | tojson @>` or `| int`.
- **Shell commands** (`command_line`): `<@ value | shell_quote @>` (one shell word), numbers through `| float` / `| int`; entity ids that also go into a quoted Home Assistant template (`states('…')`) are checked with `safe_entity(value, 'entities.x')` first.
- **File paths and device names**: `safe_name(value, 'section.name')` stops `fill.py` unless the value matches `^[a-z0-9][a-z0-9_-]*$` (no `/`, `..` or spaces).
- **Camera images to an AI service** go through `tools/partials/_ai_task.jinja`: empty or `auto` = the first `ai_task` entity, `none` = nothing leaves the house. Document it in the module's Privacy paragraph.

### Dependencies

Python packages are pinned with hashes in `tools/requirements.txt`, generated from `tools/requirements.in` (see the command at its top); every command uses `uv run --with-requirements …`. ESPHome is pinned by `pins.esphome_tested` in `module.yaml`, GitHub Actions by commit SHA in `.github/workflows/check.yml`. CDN files loaded by a card get Subresource Integrity (`integrity` + `crossorigin`), like Leaflet in `tesla-route`.

### deploy.py

- Run from the build folder: `uv run --with-requirements requirements.txt python <module>/deploy.py [--dry-run]`.
- `--dry-run` prints every upload, reload and default and never connects; `tools/check.py` runs it for every module. One-off actions (creating zones, moving `zone.home`) go behind `--setup`.
- The one exception: `--dry-run --live` may connect to **read** what is there (e.g. the current dashboard and resources) and print the real diff, and must write nothing (`home-screen/deploy.py` does this). It needs `HA_URL` and `HA_TOKEN`; plain `--dry-run` still never connects, so `tools/check.py` never runs `--live`.
- The connection comes only from `HA_URL` and `HA_TOKEN` in the environment (see `tools/ha_api.py`), never from a file or a default.
- Files go up through the File editor app (`ha_api.FileEditor`); automations and scripts through the config API (`ha_api.push_automations_and_scripts`). Never edit `configuration.yaml`: `base` documents the lines once.
- Helpers: after `check_config()`, call `ha_api.reload_helpers(PACKAGE, HELPERS)` (and `ha_api.describe_helper_reload(PACKAGE, HELPERS)` in `--dry-run`) instead of calling `<domain>/reload` yourself. It reloads the input_* domains the package defines plus the ones in `HELPERS`, and never `counter`: Home Assistant has no `counter.reload` (the call fails with 400). A counter that is new appears only after one restart; `reload_helpers` names it ("restart Home Assistant once to create: counter.x") and the deploy continues (`set_defaults` only touches helpers that exist). Say so in the module README.
- Frontend files (cards, JS helpers): `ha_api.publish_card(js, folder)` uploads to `/config/www/<folder>/` and registers `/local/<folder>/<file>?v=VERSION` as a dashboard resource. Phase-4 modules use `folder="ha-kit/<module>"`; the older modules keep `/config/www/<file>` (no folder).

### Shared entities and contracts

When one module reads what another provides, list it in "Contracts between modules" in the README and add `depends_on`. Example: `counter.tesla_commands_today` lives in `gate`; `tesla-driveway-lock` depends on `gate` instead of defining it again.

### LOGIC.md

Every module explains every decision, so someone else can check and change it. Sections, in this order:

1. **In one sentence**
2. **Flow chart** (mermaid)
3. **Triggers**
4. **Conditions and decisions**
5. **Settings** (helpers, defaults, `house.yaml` fields)
6. **Edge cases**
7. **What it does not do**
8. **Test plan** (on a real Home Assistant; until it passed, the status says "not tested on HA")

## Testing

One command runs everything CI runs:

```bash
uv run --with-requirements tools/requirements.txt python tools/check.py            # without ESPHome
uv run --with-requirements tools/requirements.txt python tools/check.py --esphome  # + esphome config (needs uvx)
```

It fills in `house.example.yaml`, `tests/house.minimal.yaml`, `tests/house.no-tariff.yaml` (the phase-4 modules without a tariff module) and an all-modules variant twice (language `en` and `nl`, optional switches flipped), checks that `tests/house.broken.yaml` fails, parses every YAML file (HA and ESPHome tags), compiles every Home Assistant template with HA's filters and tests stubbed (a misspelled filter fails), compiles every Python file, runs every `deploy.py --dry-run`, runs `choose.py` on `tests/choose.answers.yaml` and `tests/choose.no-brands.answers.yaml` (without a supported brand or region the modules that need that capability must be dropped), optionally `esphome config` on every device file with dummy secrets, and `tools/scan.py`. `--keep DIR` keeps the build folders for a look.

A new module: add it to `house.example.yaml` (or at least its section, commented out when it is optional), make sure the minimal house still passes, and extend `tests/choose.answers.yaml` and `tests/choose.no-brands.answers.yaml` when you add an `ask:` id (and `EXPECTED_CHOICE` / `EXPECTED_CHOICE_NO_BRANDS` in `tools/check.py`). Optional switches with two branches go in `check_variant:` of your `module.yaml`, not in `tools/check.py`. When several modules provide the same capability, check.py fills in one extra house per alternative provider.

## Privacy

The repository is public. Nothing in it may point to a real house or person.

- **Invented examples only**: names (Jan, Lien), streets (`dorpstraat`), coordinates with at most 3 decimals, IPs from the documentation range `192.0.2.0/24`, e-mail addresses at `example.com`.
- **Never**: real names, addresses, coordinates, private or Tailscale IPs, MAC addresses, serial numbers, config entry ids, tokens, passwords, API keys, phone numbers, screenshots of a real dashboard (unless masked and approved).
- `house.yaml`, `secrets.yaml` and `build/` are in `.gitignore`.
- **Scan**: `tools/scan.py` checks fixed patterns (IPs, MACs, ULIDs, serial numbers in entity ids, precise coordinates, e-mail, phone numbers, tokens, `password:`/`token:`/`api_key:` with a real value). Install the pre-commit hook once with `sh tools/install-hooks.sh`.
  - It also looks **inside binary files**: every text member of a zip container (`.fzz` Fritzing, `.3mf` 3D print, `.zip`, shown as `file.fzz!member`), and the metadata of PNG and JPEG images (text chunks, XMP, comments). EXIF with GPS is a hit; other EXIF or IPTC metadata (camera, date, author) is a warning. Export images without metadata, or strip it (`exiftool -all= image.png`).
  - **Warnings** (they do not fail the scan, but read them): a 12-hex entity suffix (maybe a MAC address) and a pair of 3-decimal numbers that look like a latitude 49–54 and a longitude 2–7 (Belgium and around, about 100 m) on the same or the next line. Invented example places are fine: allowlist them with a reason.
- **Denylist**: your own names, streets and car names in `~/.config/ha-kit/denylist.txt` (or `$HA_KIT_DENYLIST`), one per line, outside the repository. It is required when `~/.config/ha-kit/` exists or `HA_KIT_REQUIRE_DENYLIST=1`; otherwise a missing list is a warning and only the fixed patterns run (CI does this).
- **Exceptions** with a reason in `scan-allowlist.txt` (`file-glob<TAB>regex<TAB>reason`). Keep it short: every line is a hole in the scan.
- Commit with your GitHub noreply address if you do not want your e-mail address in the history.

## Language

Code, comments, docs, commit messages and `house.yaml` keys are English. Texts users see are translated through `strings.yaml` (`en` required, `nl` and others welcome). Fixed values that end up in entity ids or that Home Assistant shows as states are English as well (e.g. the compass sides `N NE E SE S SW W NW`, the place kinds `work school drop_off family`); a module that still has Dutch ones migrates them with a migration note in its README.

### Known naming leftovers

Dutch names that stay on purpose, because renaming them would break something outside the kit or is not worth a migration yet:

| Name | Where | Why it stays |
| ---- | ----- | ------------ |
| theme tokens `--cw-zon`, `--cw-huis`, `--cw-wagen`; `cw-thema.js` with its element, attribute and icon names (`cw-thema-kiezer`, `naar=`, `zon`, …) | `base`; the tokens are read by the cards of `tesla-route` (`tesla-map-card.js`, `tesla-arrival-card.js`: `sun: "zon"`, `house: "huis"`, `car: "wagen"`), the components by `doorbell` and own dashboards | shared theme of every dashboard; renaming means changing every card and every own dashboard at the same time (see `base/LOGIC.md`) |
| device name and base file `kamersensor` (`kamersensor-<slug>`, `esphome/kamersensor.yaml`) | `room-sensor` | the wiring drawing and enclosure files refer to it; the device name does not change entity ids |
| default device name `jacuzzi` (`esphome/jacuzzi.yaml`, `fritzing/jacuzzi-*`) | `spa-spanet` | also an English word; keeps the entity ids of existing installations; the Fritzing files refer to it |
| ventilation device name in the example (`ventilatie`) | `house.example.yaml` | an invented value of a Dutch-language house; it sets the entity prefix (`sensor.ventilatie_filter_replacement_remaining_days`) |
| Dutch Teslemetry entity names (`device_tracker.{p}_locatie`, …) | `house.example.yaml` `teslemetry:` | the names Teslemetry creates in a Dutch-language Home Assistant; the English column in `tesla-route/README.md` is derived, not seen |
| legacy fallbacks: script field `reden` (gate), notification kinds `stroomprijs`/`overschot`, price attribute `prijzen` | `gate`, `notifications` | so callers and `house.yaml` files of the Dutch version keep working; remove them in a later major version |

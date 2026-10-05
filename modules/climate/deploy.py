<% from '_climate.jinja' import feat, vent, indoor, outdoor, weather, solar, solar_rest, solar_today, comfoclime, comfoclime_writes, view_path with context %>
<% set expected = {indoor: 'entities.indoor_temperature', weather: 'entities.weather'} %>
<% for eid, why in [(outdoor, 'entities.outdoor_temperature'), (solar, 'entities.solar_power_w'), (solar_rest, 'entities.solar_forecast_remaining_today'), (solar_today, 'entities.solar_forecast_today')] if eid %>
<% set _ = expected.update({eid: why}) %>
<% endfor %>
<% if feat.floor %>
<% set _ = expected.update({'script.heat_pump_set_floor_band': 'the heat-pump module (deploy it first)', 'sensor.heat_pump_state': 'the heat-pump module'}) %>
<% endif %>
<% if feat.ventilation_cooling or feat.season_profile %>
<% for role, eid in vent.items() if role in ['ventilation_speed', 'ventilation_bypass_on', 'ventilation_bypass_off', 'ventilation_bypass_auto', 'ventilation_outdoor_temperature', 'ventilation_auto', 'ventilation_away', 'ventilation_profile', 'ventilation_season_heating', 'ventilation_season_cooling'] %>
<% set _ = expected.update({eid: 'entities.' ~ role}) %>
<% endfor %>
<% endif %>
<% if feat.comfoclime %><% set _ = expected.update({comfoclime: 'entities.comfoclime'}) %><% endif %>
<% if comfoclime_writes %><% set _ = expected.update({comfoclime_writes: 'ComfoClime: allow writes (ventilation-zehnder)'}) %><% endif %>
<% if feat.shading_sun %><% set _ = expected.update({'input_boolean.shading_automatic': 'module shading (deploy it first)'}) %><% endif %>
"""Deploy module 'climate': helpers, weather and forecast sensors, macro, automations, the climate screen.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python climate/deploy.py [--dry-run] [--view [--dashboard <url_path>]]

Steps:
  1. reports the entities from house.yaml and from other modules this one needs and that do not exist yet
  2. uploads package.yaml -> packages/climate.yaml (only when this house has helpers), templates/climate.yaml,
     custom_templates/climate.jinja, command_line/climate.yaml and indoor_forecast.py -> /config/climate/
     (the forecast reads the recorder database read-only: SQLite only, Home Assistant's default)
  3. checks the configuration, reloads the helpers, the template sensors, the custom templates and command_line
  4. gives every helper that did not exist before its default from module.yaml (defaults:), once
  5. writes automations.yaml through the config API (same as the automation editor)
  6. uploads www/climate-screen.js to /config/www/ha-kit/climate/ and registers it as dashboard resource
     /local/ha-kit/climate/climate-screen.js?v=(VERSION in the file)
  --view       adds (or replaces in place) the view climate.view_path (house.yaml) of lovelace/climate.yaml on a dashboard in storage
               mode (default the Overview; --dashboard <url_path> for another one); its config is saved to backup/
               first. Every other view stays as it was
  --dry-run    prints what it would do; never connects to Home Assistant
Needs module base (packages/, templates/, command_line/ in configuration.yaml; cw-thema.js for the screen) and
automation: !include automations.yaml.
"""
import json
import sys
import urllib.error
from datetime import date
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "climate"
PACKAGE = HERE / "package.yaml"
WITH_PACKAGE = bool(yaml.safe_load(PACKAGE.read_text(encoding="utf-8")))
UPLOADS = [
    (HERE / "templates" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/templates/{MODULE}.yaml"),
    (HERE / "custom_templates" / f"{MODULE}.jinja", f"{ha_api.CONFIG_DIR}/custom_templates/{MODULE}.jinja"),
    (HERE / "command_line" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/command_line/{MODULE}.yaml"),
    (HERE / "indoor_forecast.py", f"{ha_api.CONFIG_DIR}/{MODULE}/indoor_forecast.py"),
]
if WITH_PACKAGE:
    UPLOADS.insert(0, (PACKAGE, f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"))
RELOADS = ("input_boolean", "input_number", "input_select", "input_datetime", "input_text", "template", "command_line")
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text(encoding="utf-8")).get("defaults") or {}
CARD = HERE / "www" / "climate-screen.js"
CARD_FOLDER = "ha-kit/climate"
VIEW = yaml.safe_load((HERE / "lovelace" / "climate.yaml").read_text(encoding="utf-8"))
# Entities this module reads from house.yaml or from other modules (only reported when missing).
EXPECTED = json.loads(r'''<@ expected | tojson @>''')


def arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


def add_view() -> None:
    url_path = arg("--dashboard")
    r = ha_api.ws([{"type": "lovelace/config", "url_path": url_path}])[0]
    if not r["success"]:
        sys.exit(f"dashboard not readable ({r.get('error')}). Take control of the dashboard in the UI first "
                 "(Edit > Take control) or pass --dashboard <url_path>.")
    config = r["result"]
    backup = HERE / "backup" / f"dashboard-{url_path or 'overview'}-{date.today().isoformat()}-before-climate.json"
    backup.parent.mkdir(exist_ok=True)
    if not backup.exists():
        backup.write_text(json.dumps(config, indent=1, ensure_ascii=False))
        print("backup:", backup)
    views = config.setdefault("views", [])
    for i, v in enumerate(views):
        if v.get("path") == VIEW["path"]:
            views[i] = VIEW
            print(f"view '{VIEW['path']}' existed (position {i + 1}): replaced in place")
            break
    else:
        views.append(VIEW)
        print(f"view added: /{url_path or 'lovelace'}/{VIEW['path']}")
    ha_api.ws1({"type": "lovelace/config/save", "url_path": url_path, "config": config})


def report_forecast() -> None:
    for e in ("sensor.climate_weather_days", "sensor.climate_indoor_peak"):
        try:
            st = ha_api.rest(f"/api/states/{e}")
            print(" ", e, "=", st["state"], "| error:", st["attributes"].get("error"))
        except urllib.error.HTTPError:
            print(" ", e, "does not exist (yet): check templates/ and command_line/ in configuration.yaml (module base)")


def main() -> None:
    automations = HERE / "automations.yaml"
    ids = [a["id"] for a in yaml.safe_load(automations.read_text(encoding="utf-8")) or []]
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check (only reported when missing):", ", ".join(EXPECTED))
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        if not WITH_PACKAGE:
            print("  no helpers for this house: package.yaml is not uploaded")
        print("  check_config, reload:", ", ".join(RELOADS) + ", custom templates")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: automations", ", ".join(ids) or "none")
        print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{CARD_FOLDER}/{CARD.name}",
              f"+ resource /local/{CARD_FOLDER}/{CARD.name}")
        if "--view" in sys.argv:
            print(f"  view '{VIEW['path']}' on dashboard", arg("--dashboard") or "Overview", "(backup first)")
        return

    have = ha_api.entity_ids()
    for eid, why in EXPECTED.items():
        if eid not in have:
            print(f"NOTE: {eid} does not exist ({why}); the part that needs it waits or stays empty")
    editor = ha_api.FileEditor()
    for src, dst in UPLOADS:
        editor.save(src, dst)
    ha_api.check_config()
    for domain in RELOADS:
        try:
            ha_api.rest(f"/api/services/{domain}/reload", {})
        except urllib.error.HTTPError as e:
            print(f"reloading {domain} failed ({e.code})")
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    print("helpers, templates, macro and command_line reloaded")
    ha_api.set_defaults(DEFAULTS, have)
    if ids:
        ha_api.push_automations_and_scripts(automations, None)
    ha_api.publish_card(CARD, CARD_FOLDER)
    if "--view" in sys.argv:
        add_view()
    report_forecast()
    print("done. Follow the test plan in climate/LOGIC.md.")


if __name__ == "__main__":
    main()

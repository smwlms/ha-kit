<% from '_hot_water.jinja' import tariff_on, bath, battery, ev with context %>
"""Deploy module 'hot-water': helpers, macros, template sensors and the automation hot_water_buffer (see README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python hot-water/deploy.py [--dry-run]

Steps:
  1. checks that the modules it builds on are there: the hot-water-heater scripts and sensors (e.g. heat-pump-vaillant)
     and energy-plan (stops when one is missing: deploy those first)
  2. uploads custom_templates/hot_water.jinja, package.yaml -> /config/packages/hot_water.yaml and
     templates/hot_water.yaml -> /config/templates/hot_water.yaml
  3. checks the configuration, reloads the custom templates, input_boolean, input_number, input_datetime, template
  4. gives every helper that did not exist before its default from module.yaml (defaults:), once
  5. writes automations.yaml through the config API (same as the automation editor)
  6. reports the first values of the sensors
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/ and templates/ in configuration.yaml) and automation: !include automations.yaml.
"""
import sys
import urllib.error
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "hot_water"
UPLOADS = [
    (HERE / "custom_templates" / f"{MODULE}.jinja", f"{ha_api.CONFIG_DIR}/custom_templates/{MODULE}.jinja"),
    (HERE / "package.yaml", f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"),
    (HERE / "templates" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/templates/{MODULE}.yaml"),
]
PACKAGE = HERE / "package.yaml"
HELPERS = ("input_boolean", "input_number", "input_datetime")
RELOADS = ["homeassistant/reload_custom_templates", "template/reload"]
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
# What this module calls and reads from other modules. Missing REQUIRED = stop; missing OPTIONAL = a note.
REQUIRED = ["script.hot_water_heat", "script.hot_water_normal", "sensor.hot_water_temperature",
            "sensor.energy_plan_export_avg", "sensor.energy_plan_margin"]
OPTIONAL = ["sensor.hot_water_cop"]
<% if tariff_on %>
OPTIONAL += ["sensor.power_price_import", "sensor.power_price_export", "binary_sensor.power_price_cheap",
             "sensor.capacity_headroom_kw"]
<% endif %>
<% if battery %>
OPTIONAL += ["binary_sensor.energy_plan_battery_behind"]
<% endif %>
<% if ev %>
OPTIONAL += ["sensor.ev_charging_energy_needed"]
<% endif %>
PROVIDED = ["sensor.hot_water_energy_needed", "sensor.hot_water_room", "sensor.hot_water_expected_export",
            "binary_sensor.hot_water_heating_pays", "sensor.hot_water_session"]
<% if tariff_on %>
PROVIDED.append("sensor.hot_water_cheapest_hour_before_sunrise")
<% if bath %>
PROVIDED.append("sensor.hot_water_cheapest_hour_before_bath")
<% endif %>
<% endif %>


def check_providers() -> None:
    present = ha_api.entity_ids()
    missing = [e for e in REQUIRED if e not in present]
    if missing:
        sys.exit("not found in Home Assistant: " + ", ".join(missing) + "\n  deploy the hot-water-heater module "
                 "(e.g. heat-pump-vaillant) and energy-plan first")
    for e in OPTIONAL:
        if e not in present:
            print("NOTE: optional entity not found (its part waits until it exists):", e)


def report() -> None:
    for e in PROVIDED:
        try:
            st = ha_api.rest(f"/api/states/{e}")
            print(f"  {e} = {st['state']}")
        except urllib.error.HTTPError:
            print(f"  missing: {e} (check templates/ in configuration.yaml: module base)")
    print("  sensor.hot_water_session stays unknown until the first start or boost (event ha_kit_hot_water_session)")


def main() -> None:
    automations = HERE / "automations.yaml"
    ids = [a["id"] for a in yaml.safe_load(automations.read_text()) or []]
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check required entities:", ", ".join(REQUIRED))
        print("  check optional entities:", ", ".join(OPTIONAL))
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ",", ", ".join(RELOADS))
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: automations", ", ".join(ids))
        print("  check entities:", ", ".join(PROVIDED))
        return

    check_providers()
    before = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in UPLOADS:
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, HELPERS)
    for service in RELOADS:
        ha_api.rest(f"/api/services/{service}", {})
        print("reloaded:", service)
    ha_api.set_defaults(DEFAULTS, before)
    ha_api.push_automations_and_scripts(automations, None)
    report()
    print("done. Follow the test plan in hot-water/LOGIC.md (the automation calls the real heater).")


if __name__ == "__main__":
    main()

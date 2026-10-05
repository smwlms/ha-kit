<% from '_energy_plan.jinja' import grid_import, grid_export, solar, house_role, battery, battery_power, charger
   with context %>
<% set stats = [solar] + ([house_role] if house_role else [grid_import, grid_export] + ([battery_power] if battery_power else [])) + ([charger] if charger else []) %>
"""Deploy module 'energy-plan': helpers, export average, template sensors, macro, day-plan script (see README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python energy-plan/deploy.py [--dry-run]

Steps:
  1. uploads package.yaml -> packages/energy_plan.yaml, templates/energy_plan.yaml, custom_templates/energy_plan.jinja,
     command_line/energy_plan.yaml and energy_plan.py -> /config/energy-plan/ (reads the recorder, SQLite only)
  2. checks the configuration, reloads input_number, the custom templates, template, statistics and command_line
  3. gives every helper that did not exist before its default from module.yaml (defaults:), once
  4. reports: the recorder statistics the script needs (power roles with state_class measurement), and the first
     value of sensor.energy_plan_margin
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/, templates/ and command_line/ in configuration.yaml). No automations, no scripts.
"""
import sys
import urllib.error
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "energy_plan"
UPLOADS = [
    (HERE / "package.yaml", f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"),
    (HERE / "templates" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/templates/{MODULE}.yaml"),
    (HERE / "custom_templates" / f"{MODULE}.jinja", f"{ha_api.CONFIG_DIR}/custom_templates/{MODULE}.jinja"),
    (HERE / "command_line" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/command_line/{MODULE}.yaml"),
    (HERE / f"{MODULE}.py", f"{ha_api.CONFIG_DIR}/energy-plan/{MODULE}.py"),
]
PACKAGE = HERE / "package.yaml"
HELPERS = ("input_number",)
RELOADS = ["homeassistant/reload_custom_templates", "template/reload", "statistics/reload", "command_line/reload"]
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
# Statistic ids the day-plan script reads (5-minute statistics of the recorder), from house.yaml.
STATISTICS = <@ stats | tojson @>
PROVIDED = ["sensor.energy_plan_export_kw", "sensor.energy_plan_export_avg", "binary_sensor.energy_plan_surplus",
            "sensor.energy_plan_house_power", "sensor.energy_plan_margin"]
<% if battery %>
PROVIDED.append("binary_sensor.energy_plan_battery_behind")
<% endif %>


def check_statistics() -> None:
    """Report the power roles the recorder keeps no statistics for (the script then has no history)."""
    have = {s["statistic_id"] for s in ha_api.ws1({"type": "recorder/list_statistic_ids", "statistic_type": "mean"})}
    missing = [s for s in STATISTICS if s not in have]
    for sid in missing:
        print(f"  NO 5-minute statistics for {sid}: the sensor needs state_class measurement "
              "and recorder: must not exclude it, else the day plan has no history for it")
    if not missing:
        print("  recorder statistics present for", ", ".join(STATISTICS))


def report() -> None:
    have = ha_api.entity_ids()
    for e in PROVIDED:
        if e not in have:
            print("  missing:", e, "(check packages/, templates/ and command_line/ in configuration.yaml: module base)")
    try:
        st = ha_api.rest("/api/states/sensor.energy_plan_margin")
        attrs = st.get("attributes", {})
        print(f"  sensor.energy_plan_margin = {st['state']} kWh | sun end {attrs.get('sun_end')} | "
              f"source {attrs.get('source')} | days {attrs.get('days')} | error {attrs.get('error')}")
        if st["state"] == "unavailable":
            print("  unavailable: the reason is not visible on an unavailable sensor; run the command of "
                  "command_line/energy_plan.yaml in the Terminal app (see energy-plan/README.md, 'Troubleshooting')")
    except urllib.error.HTTPError:
        print("  sensor.energy_plan_margin does not exist (yet): check command_line/ in configuration.yaml")


def main() -> None:
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ",", ", ".join(RELOADS))
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  check recorder statistics:", ", ".join(STATISTICS))
        print("  check entities:", ", ".join(PROVIDED))
        return

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
    check_statistics()
    ha_api.rest("/api/services/homeassistant/update_entity", {"entity_id": "sensor.energy_plan_margin"})
    report()
    print("done. Follow the test plan in energy-plan/LOGIC.md.")


if __name__ == "__main__":
    main()

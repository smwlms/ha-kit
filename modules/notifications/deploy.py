<% from '_notifications.jinja' import m, kinds, ent, price_import, price_export, grid_export, filter_days with context %>
"""Deploy module 'notifications': helpers, macros, script.send_notification and the automations (see notifications/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python notifications/deploy.py [--dry-run]

Steps:
  1. reports the sensors from house.yaml that do not exist, and a price sensor without the attributes starts/prices
  2. uploads custom_templates/notifications.jinja and (when this house has helpers) package.yaml -> packages/notifications.yaml
  3. checks the configuration, reloads the helpers and the custom templates
  4. gives every helper that did not exist before its default from module.yaml (defaults:), once
  5. writes scripts.yaml and automations.yaml through the config API (script first: the automations call it)
  --dry-run  dry run: prints what it would do, does not connect to Home Assistant
Needs module base (packages/ in configuration.yaml) and the HA defaults automation: !include automations.yaml and
script: !include scripts.yaml.
"""
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "notifications"
HAS_HELPERS = <@ 'True' if ('surplus' in kinds or 'power_price' in kinds) else 'False' @>
FILES = {HERE / "custom_templates" / "notifications.jinja": f"{ha_api.CONFIG_DIR}/custom_templates/notifications.jinja"}
if HAS_HELPERS:
    FILES[HERE / "package.yaml"] = f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
PACKAGE = HERE / "package.yaml"
HELPERS = ("input_number", "input_datetime")
# Sensors from house.yaml (role -> entity_id); only reported when missing.
EXPECTED = {
<% for role, eid in [('price_import', price_import), ('price_export', price_export), ('grid_export_w', grid_export), ('ventilation_filter_days', filter_days)] if eid %>
<% if (role == 'grid_export_w' and 'surplus' in kinds) or (role.startswith('price_') and 'power_price' in kinds) or (role == 'ventilation_filter_days' and 'filter' in kinds) %>
    <@ role | tojson @>: <@ eid | tojson @>,
<% endif %>
<% endfor %>
}
PRICE = EXPECTED.get("price_import")


def check_sensors(current: dict[str, dict]) -> None:
    for role, eid in EXPECTED.items():
        if eid not in current:
            print(f"WARNING: entities.{role} = {eid} does not exist in Home Assistant")
    if PRICE in current:
        attrs = current[PRICE]["attributes"]
        if not ("starts" in attrs and ("prices" in attrs or "prijzen" in attrs)):
            print(f"WARNING: {PRICE} has no attributes 'starts' and 'prices': the notification ahead (tomorrow's prices)"
                  " never comes; 'free now' does work. See notifications/LOGIC.md, Edge cases.")


def main() -> None:
    automations = HERE / "automations.yaml"
    scripts = HERE / "scripts.yaml"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check (report only):", ", ".join(f"{k}={v}" for k, v in EXPECTED.items()))
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ", custom templates")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: scripts", ", ".join(yaml.safe_load(scripts.read_text())))
        print("  config API: automations", ", ".join(a["id"] for a in yaml.safe_load(automations.read_text()) or []))
        return

    current = {s["entity_id"]: s for s in ha_api.rest("/api/states")}
    check_sensors(current)
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, HELPERS)
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    print("macros reloaded")
    ha_api.set_defaults(DEFAULTS, set(current))
    ha_api.push_automations_and_scripts(None, scripts)
    ha_api.push_automations_and_scripts(automations, None)
    print("done. Test script.send_notification first (notifications/LOGIC.md, test plan 1).")


if __name__ == "__main__":
    main()

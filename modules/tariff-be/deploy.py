<% from '_tariff.jinja' import spot, own_quarter, quarter_meter with context %>
"""Deploy module 'tariff-be': helpers, price and capacity sensors, macros, the JS helper and an automation.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python tariff-be/deploy.py [--dry-run]

Steps:
  1. checks that entities.spot_price belongs to the Nord Pool integration (its config entry is looked up at run
     time with config_entry_id(), never written in a file)
  2. uploads package.yaml -> /config/packages/tariff.yaml, custom_templates/tariff.jinja and templates/tariff.yaml
  3. checks the configuration, reloads the helpers, the custom templates and the template sensors
  4. gives every helper that did not exist before its start value from module.yaml (defaults:, from house.yaml), once
  5. writes automations.yaml through the config API (only with entities.grid_average_peak_kw)
  6. uploads www/tariff.js -> /config/www/ha-kit/tariff/tariff.js and registers /local/ha-kit/tariff/tariff.js
     ?v=(VERSION in tariff.js) as a dashboard resource (JavaScript module; ha_api.publish_card with a folder)
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/, templates/ in configuration.yaml) and automation: !include automations.yaml.
The quarter-hour utility_meter (only when the meter has no quarter or month-peak register) needs one restart of Home
Assistant after the first deploy: utility_meter cannot be reloaded.
"""
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

JS = HERE / "www" / "tariff.js"
JS_FOLDER = "ha-kit/tariff"  # region-neutral: a tariff-nl overwrites the same file
JS_DST = f"{ha_api.CONFIG_DIR}/www/{JS_FOLDER}/tariff.js"
JS_URL = f"/local/{JS_FOLDER}/tariff.js"
FILES = {
    HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/tariff.yaml",
    HERE / "custom_templates" / "tariff.jinja": f"{ha_api.CONFIG_DIR}/custom_templates/tariff.jinja",
    HERE / "templates" / "tariff.yaml": f"{ha_api.CONFIG_DIR}/templates/tariff.yaml",
}
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
AUTOMATIONS = HERE / "automations.yaml"
SPOT = <@ spot | tojson @>
QUARTER_METER = <@ (quarter_meter if own_quarter else '') | tojson @>
START_PEAK_AUTOMATION = "capacity_start_peak_from_meter"


def js_version() -> str:
    text = JS.read_text()
    return text.split('const VERSION = "', 1)[1].split('"', 1)[0] if 'const VERSION = "' in text else "1"


def check_spot() -> None:
    """Stop when entities.spot_price is no entity of the Nord Pool integration (the price sensors would stay empty)."""
    r = ha_api.ws([{"type": "config/entity_registry/get", "entity_id": SPOT}])[0]
    if not r["success"]:
        sys.exit(f"entities.spot_price = {SPOT} is not in the entity registry: install the Nord Pool integration "
                 "(area tariff.area, currency EUR) and fill in one of its entities")
    platform = r["result"].get("platform")
    if platform != "nordpool" or not r["result"].get("config_entry_id"):
        sys.exit(f"entities.spot_price = {SPOT} belongs to '{platform}', not to the Nord Pool integration (nordpool)")
    print("Nord Pool entity found:", SPOT)


def main() -> None:
    automations = yaml.safe_load(AUTOMATIONS.read_text()) or []
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check that", SPOT, "belongs to the Nord Pool integration")
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  upload", JS.relative_to(HERE.parent), "->", JS_DST)
        print("  check_config, reload: input_number, input_boolean, custom templates, template")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        if automations:
            print("  config API: automations", ", ".join(a["id"] for a in automations))
        else:
            print("  no automations (entities.grid_average_peak_kw is empty)")
        print("  resource", f"{JS_URL}?v={js_version()}", "(module)")
        if QUARTER_METER:
            print("  restart Home Assistant once when", QUARTER_METER, "does not exist yet (utility_meter)")
        return

    check_spot()
    before = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    for domain in ("input_number", "input_boolean"):
        ha_api.rest(f"/api/services/{domain}/reload", {})
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    ha_api.rest("/api/services/template/reload", {})
    print("helpers, custom templates and template sensors reloaded")
    after = ha_api.entity_ids()
    ha_api.set_defaults(DEFAULTS, before, after)
    if automations:
        ha_api.push_automations_and_scripts(AUTOMATIONS, None)
    else:
        print(f"NOTE: no automation {START_PEAK_AUTOMATION} (entities.grid_average_peak_kw is empty); an earlier one "
              "stays until you delete it in Settings > Automations")
    ha_api.publish_card(JS, JS_FOLDER)
    if QUARTER_METER and QUARTER_METER not in after:
        print(f"NOTE: {QUARTER_METER} (utility_meter) does not exist yet: restart Home Assistant once. Until then the "
              "expected quarter and the headroom count only the current power.")
    print("done. Follow the test plan in tariff-be/LOGIC.md.")


if __name__ == "__main__":
    main()

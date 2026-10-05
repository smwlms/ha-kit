<% from '_heat_pump_vaillant.jinja' import required_entities, optional_entities with context %>
"""Deploy module 'heat-pump-vaillant': helpers, normalised sensors, scripts and the counter reset (see README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python heat-pump-vaillant/deploy.py [--dry-run]

Steps:
  1. checks that the myVAILLANT entities derived from house.yaml exist (stops when a required one is missing) and
     that the mypyllant actions exist (the integration from HACS)
  2. uploads package.yaml -> /config/packages/heat_pump_vaillant.yaml and
     templates/heat_pump_vaillant.yaml -> /config/templates/heat_pump_vaillant.yaml
  3. checks the configuration, reloads counter, input_number and the template entities
  4. gives every helper that did not exist before its default from module.yaml (defaults:), once
  5. writes automations.yaml and scripts.yaml through the config API (same as the UI editors)
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/, templates/ in configuration.yaml), automation: !include automations.yaml and
script: !include scripts.yaml (the HA defaults).
"""
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

FILES = {
    HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/heat_pump_vaillant.yaml",
    HERE / "templates" / "heat_pump_vaillant.yaml": f"{ha_api.CONFIG_DIR}/templates/heat_pump_vaillant.yaml",
}
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
# myVAILLANT entities derived from house.yaml (heat_pump.system, heat_pump.zones, entities.heat_pump/water_heater).
REQUIRED = <@ required_entities | tojson @>
OPTIONAL = <@ optional_entities | tojson @>
# mypyllant actions the scripts call (besides water_heater.* and switch.*).
ACTIONS = ["set_time_program", "set_time_controlled_cooling_setpoint", "set_quick_veto", "cancel_quick_veto"]


def check_brand() -> None:
    """Stops when a required myVAILLANT entity or the mypyllant integration is missing; names the optional ones."""
    present = ha_api.entity_ids()
    missing = [e for e in REQUIRED if e not in present]
    if missing:
        sys.exit("not found in Home Assistant: " + ", ".join(missing) + "\n  check heat_pump.system and "
                 "heat_pump.zones in house.yaml (the names as they are in the entity ids), or set "
                 "entities.heat_pump / entities.water_heater, fill in again and deploy again")
    for e in OPTIONAL:
        if e not in present:
            print("NOTE: optional entity not found (its sensor or feature stays empty):", e)
    services = {s["domain"]: s.get("services", {}) for s in ha_api.rest("/api/services")}
    absent = [a for a in ACTIONS if a not in services.get("mypyllant", {})]
    if absent:
        print("NOTE: mypyllant actions not found:", ", ".join(absent), "(install or update myVAILLANT from HACS)")


def main() -> None:
    automations = HERE / "automations.yaml"
    scripts = HERE / "scripts.yaml"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check required entities:", ", ".join(REQUIRED))
        print("  check optional entities:", ", ".join(OPTIONAL))
        print("  check mypyllant actions:", ", ".join(ACTIONS))
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload: counter, input_number, template")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: automations", ", ".join(a["id"] for a in yaml.safe_load(automations.read_text())))
        print("  config API: scripts", ", ".join(yaml.safe_load(scripts.read_text())))
        return

    check_brand()
    before = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    for domain in ("counter", "input_number"):
        ha_api.rest(f"/api/services/{domain}/reload", {})
    ha_api.rest("/api/services/template/reload", {})
    print("helpers and template sensors reloaded")
    ha_api.set_defaults(DEFAULTS, before)
    ha_api.push_automations_and_scripts(automations, scripts)
    print("done. Follow the test plan in heat-pump-vaillant/LOGIC.md (the scripts write to the real heat pump).")


if __name__ == "__main__":
    main()

<% from '_ev_charging.jinja' import ev_cars, plan_cars, amps_cars, limit_cars, has_tariff, has_gate, own_counter with context %>
"""Deploy module 'ev-charging': helpers, template sensors, the charge-plan macros and the automations.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python ev-charging/deploy.py [--dry-run]

Steps:
  1. uploads package.yaml -> /config/packages/ev_charging.yaml, templates/ev_charging.yaml and templates/ev_plan.yaml
     -> /config/templates/, custom_templates/ev_charging.jinja -> /config/custom_templates/
  2. checks the configuration, reloads the helpers, the custom templates, the template entities and the statistics
     sensors; counter has no reload service, so when this module defines counter.tesla_commands_today (no gate) a new
     one appears after one restart of Home Assistant (deploy names it)
  3. gives every helper that did not exist before its default from module.yaml (defaults:), once; a '*' anywhere
     in a key (input_number.ev_plan_*_target) matches every new helper of that pattern (ha_api.set_defaults)
  4. writes scripts.yaml (script.ev_charging_manual_mode) and automations.yaml through the config API (same as the
     script and automation editors) and removes the automations of this module that this house.yaml no longer renders
     (a car without a plan any more, gate installed later, ...)
  5. names the entities this module reads that do not exist (yet)
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs modules base (packages/, templates/), energy-plan and a charger adapter (ev-charger) deployed first, and the HA
default automation: !include automations.yaml.
"""
import sys
import urllib.error
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

UPLOADS = [
    (HERE / "package.yaml", f"{ha_api.CONFIG_DIR}/packages/ev_charging.yaml"),
    (HERE / "templates" / "ev_charging.yaml", f"{ha_api.CONFIG_DIR}/templates/ev_charging.yaml"),
    (HERE / "templates" / "ev_plan.yaml", f"{ha_api.CONFIG_DIR}/templates/ev_plan.yaml"),
    (HERE / "custom_templates" / "ev_charging.jinja", f"{ha_api.CONFIG_DIR}/custom_templates/ev_charging.jinja"),
]
PACKAGE = HERE / "package.yaml"
# Helper domains reloaded on every deploy (plus any other the package defines); never counter (ha_api.reload_helpers).
HELPERS = ("input_boolean", "input_number", "input_select", "input_datetime")
RELOADS = ["homeassistant/reload_custom_templates", "template/reload", "statistics/reload"]
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
# Automations of this module: fixed ids, plus one ev_plan_<car>_limit per plan car with a charge limit.
OWN_FIXED = ["ev_charging_apply", "ev_charging_car_amps", "ev_plan_target_reset", "ev_charging_notify",
             "ev_charging_tesla_counter_reset"]
# Entities this module reads from other modules and from house.yaml (step 5 names the missing ones).
READS = ["sensor.ev_charger_mode", "sensor.ev_charger_status", "binary_sensor.ev_charger_connected",
         "sensor.ev_charger_power", "script.ev_charger_set_mode", "binary_sensor.energy_plan_surplus",
         "sensor.energy_plan_margin"]
<% if has_tariff %>
READS += ["sensor.power_price_import", "sensor.power_price_export", "binary_sensor.power_price_cheap",
          "sensor.capacity_headroom_kw"]
<% endif %>
<% if has_gate or own_counter %>
READS += ["counter.tesla_commands_today"]
<% endif %>
READS += <@ ((ev_cars | map(attribute='battery') | list) + (ev_cars | map(attribute='cable') | list) + (ev_cars | map(attribute='state') | list) + (amps_cars | map(attribute='current') | list) + (limit_cars | map(attribute='limit') | list) + (plan_cars | selectattr('calendar') | map(attribute='calendar') | list)) | tojson @>
# The plan helpers of this house.yaml (shown by --dry-run; the patterns in DEFAULTS cover them).
PLAN_HELPERS = <@ plan_cars | map(attribute='prefix') | list | tojson @>


def automations() -> list:
    return yaml.safe_load((HERE / "automations.yaml").read_text()) or []


def stale(rendered: set[str]) -> list[str]:
    """Automation config ids of this module in Home Assistant that this house.yaml no longer renders."""
    found = []
    for s in ha_api.rest("/api/states"):
        if not s["entity_id"].startswith("automation."):
            continue
        aid = str(s.get("attributes", {}).get("id") or "")
        own = aid in OWN_FIXED or (aid.startswith("ev_plan_") and aid.endswith("_limit"))
        if own and aid not in rendered:
            found.append(aid)
    return found


def main() -> None:
    autos = automations()
    rendered = {a["id"] for a in autos}
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ",", ", ".join(RELOADS))
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        if PLAN_HELPERS:
            print("  charge plan helpers for:", ", ".join(PLAN_HELPERS))
        print("  config API: scripts ev_charging_manual_mode; automations", ", ".join(sorted(rendered)))
        print("  remove when present and not rendered:", ", ".join(x for x in OWN_FIXED if x not in rendered) or "-",
              "+ ev_plan_<car>_limit of cars without a plan")
        print("  check entities:", ", ".join(READS))
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
    after = ha_api.entity_ids()
    ha_api.set_defaults(DEFAULTS, before, after)
    ha_api.push_automations_and_scripts(None, HERE / "scripts.yaml")
    ha_api.push_automations_and_scripts(HERE / "automations.yaml", None)
    for aid in stale(rendered):
        try:
            ha_api.rest(f"/api/config/automation/config/{aid}", method="DELETE")
            print("automation", aid, "removed (not in this house.yaml any more)")
        except urllib.error.HTTPError as e:
            print("NOTE: could not remove automation", aid, e)
    missing = [e for e in READS if e not in after]
    if missing:
        print("NOTE: these entities do not exist (yet):", ", ".join(missing))
        print("      deploy energy-plan, the charger adapter and the tariff module first; enable disabled Teslemetry")
        print("      entities in Settings > Entities")
    print("done. Follow the test plan in ev-charging/LOGIC.md.")


if __name__ == "__main__":
    main()

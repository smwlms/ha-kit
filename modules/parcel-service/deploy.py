"""Deploy module 'parcel-service': helpers, automations and scripts (expected parcel day, garage open or ajar).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python parcel-service/deploy.py [--dry-run]

Steps:
  1. checks that the modules doorbell and gate are deployed (script.doorbell_reply with the parcel-service steps,
     input_select.doorbell_<key>_parcel, script.gate_pulse, script.gate_close_manual, binary_sensor.gate_open);
     stops when one is missing
  2. uploads package.yaml -> packages/parcel_service.yaml, checks the configuration, reloads the helpers
  3. sets the defaults from house.yaml once, only on helpers that did not exist before (ajar, open, day = off);
     after that the values are yours to change on the dashboard
  4. writes the automations and scripts through the config API and reloads them
  5. turns the automation 'parcel left' (id doorbell_parcel_left) off once, only when this run created it
     (a redeploy keeps your choice)
  --dry-run  dry run: only prints what it would do, does not connect to Home Assistant
"""
import sys
import time
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "parcel_service"
PACKAGE_DST = f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"
HELPERS = ("input_number", "input_text", "input_datetime")
# helper -> default, set once when the helper is new (ha_api.set_defaults); 2000-01-01 = no parcel day expected.
DEFAULTS = {
    "input_number.parcel_service_ajar": <@ parcel_service.ajar_s | float | tojson @>,
    "input_number.parcel_service_open": <@ parcel_service.open_s | float | tojson @>,
    "input_datetime.parcel_expected": "2000-01-01",
}
# Automations (by id) that start OFF: turned off once, only when this deploy creates them. No initial_state in the
# YAML, so once you turn one on it stays on after a restart and after a redeploy (see LOGIC.md, Settings).
OFF_WHEN_NEW = ["doorbell_parcel_left"]
<% from '_doorbell.jinja' import recipients with context %>
NEEDS = {
    "script.doorbell_reply": "module doorbell",
<% if recipients %>
    # Who gets the parcel notifications (doorbell.jinja reads it): only exists when doorbell was filled in with
    # parcel-service in modules: and deployed again.
    "input_select.doorbell_<@ recipients[0].key @>_parcel": "module doorbell, filled in with parcel-service",
<% endif %>
    "script.gate_pulse": "module gate",
    "script.gate_close_manual": "module gate",
    "binary_sensor.gate_open": "module gate",
}


def exists(entity_id: str) -> bool:
    try:
        ha_api.rest(f"/api/states/{entity_id}")
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def automation_exists(automation_id: str) -> bool:
    try:
        ha_api.rest(f"/api/config/automation/config/{automation_id}")
        return True
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return False
        raise


def turn_off_automation(automation_id: str) -> None:
    """Turn off the automation with this id (its entity_id follows the alias, so look it up by attributes.id)."""
    for _ in range(15):
        for st in ha_api.rest("/api/states"):
            if st["entity_id"].startswith("automation.") and st["attributes"].get("id") == automation_id:
                ha_api.rest("/api/services/automation/turn_off", {"entity_id": st["entity_id"]})
                print("new, off by default:", st["entity_id"])
                return
        time.sleep(1)
    print(f"WARNING: automation {automation_id} not found; turn it off yourself (Settings > Automations).")


def check_dependencies() -> None:
    missing = [f"{eid} ({mod})" for eid, mod in NEEDS.items() if not exists(eid)]
    if missing:
        sys.exit("deploy these first: " + ", ".join(missing))
    # doorbell must have been filled in with parcel-service in modules: its script then knows the button
    # 'parcel_service'.
    cfg = ha_api.rest("/api/config/script/config/doorbell_reply")
    if "parcel_service" not in str(cfg):
        sys.exit("script.doorbell_reply does not know the parcel service yet: fill in again (with parcel-service in\n"
                 "modules:) and run doorbell/deploy.py again, then this script.")
    print("doorbell and gate are ready")


def main() -> None:
    automations = HERE / "automations.yaml"
    scripts = HERE / "scripts.yaml"
    if "--dry-run" in sys.argv:
        import yaml

        print("dry run: nothing sent")
        print("  check:", ", ".join(NEEDS), "(+ parcel-service steps in script.doorbell_reply)")
        print("  upload", (HERE / "package.yaml").relative_to(HERE.parent), "->", PACKAGE_DST)
        print("  check_config + reload", ha_api.describe_helper_reload(HERE / "package.yaml", HELPERS))
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        ids = [a["id"] for a in yaml.safe_load(automations.read_text())]
        print("  automations:", ", ".join(ids))
        for aid in OFF_WHEN_NEW:
            if aid in ids:
                print(f"  only when new: automation.turn_off ({aid})")
        print("  scripts:", ", ".join(yaml.safe_load(scripts.read_text())))
        return

    check_dependencies()
    before = ha_api.entity_ids()
    import yaml

    ids = [a["id"] for a in yaml.safe_load(automations.read_text())]
    new_automations = [aid for aid in OFF_WHEN_NEW if aid in ids and not automation_exists(aid)]
    ha_api.FileEditor().save(HERE / "package.yaml", PACKAGE_DST)
    ha_api.check_config()
    ha_api.reload_helpers(HERE / "package.yaml", HELPERS)
    ha_api.set_defaults(DEFAULTS, before)
    ha_api.push_automations_and_scripts(automations, scripts)
    for aid in new_automations:
        turn_off_automation(aid)
    print("done. 'Parcel left' is off after the first install (see LOGIC.md). Test first with the day on tomorrow.")


if __name__ == "__main__":
    main()

<% from '_tesla_driveway_lock.jinja' import tdl, photo, ent, car_list with context %>
"""Deploy module 'tesla-driveway-lock': helpers, per-car sensors, zone.driveway and the lock automation
(see tesla-driveway-lock/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python tesla-driveway-lock/deploy.py [--dry-run] [--setup]

Steps:
  1. checks that the module gate is deployed (counter.tesla_commands_today); stops when it is missing
  2. uploads package.yaml -> /config/packages/tesla_driveway_lock.yaml and templates/tesla_driveway_lock.yaml
  3. checks the configuration, reloads the helpers and the template sensors
  4. gives every helper that did not exist before its default from module.yaml (defaults:), once;
     the master switch (input_boolean.tesla_driveway_lock_enabled) starts OFF
  5. writes automations.yaml through the config API (same as the automation editor)
  --setup    one-off: creates zone.driveway (passive, radius from module.yaml, named in house.language) around
             house.lat/lon when it does not exist yet. Move it onto the driveway afterwards (Settings > Areas & zones >
             Zones), see README.
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/, templates/ in configuration.yaml) and module gate.
"""
import json
import sys
import urllib.parse
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "tesla_driveway_lock"
WITH_PHOTO = <@ 'True' if photo else 'False' @>
FILES = {
    HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml",
    HERE / "templates" / f"{MODULE}.yaml": f"{ha_api.CONFIG_DIR}/templates/{MODULE}.yaml",
}
# File names and zone of the module before its ids were translated (kit versions up to db5b2fe). The old files
# define the same helpers and sensors a second time: deploy stops and names them (see README, "Migrating").
OLD_FILES = [f"{ha_api.CONFIG_DIR}/packages/tesla_oprit.yaml", f"{ha_api.CONFIG_DIR}/templates/tesla_oprit.yaml"]
OLD_ZONE = "zone.oprit"
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
ZONE = "zone.driveway"
ZONE_NAME = <@ t('zone_name') | tojson @>
# Start of the driveway zone: house.lat/lon. Usually the middle of zone.home, NOT the driveway: move it after --setup.
HOME = {"latitude": <@ house.lat | float | tojson @>, "longitude": <@ house.lon | float | tojson @>}
PACKAGE = HERE / "package.yaml"
# Helper domains reloaded on every deploy (plus any other the package defines); never counter (ha_api.reload_helpers).
HELPERS = ("input_boolean", "input_number") + (("input_text",) if WITH_PHOTO else ())
NEEDS = {"counter.tesla_commands_today": "module gate (gate/deploy.py; a new counter appears after one restart of "
                                         "Home Assistant)"}
# Entities from integrations (only reported when missing).
EXPECTED = [
<% for a in car_list %>
    <@ car_entity(a, 'lock') | tojson @>,
    <@ car_entity(a, 'shift_state') | tojson @>,
<% endfor %>
<% if photo %>
    <@ ent.get('garage_camera') | tojson @>,
<% if ent.get('garage_dark') %>
    <@ ent.garage_dark | tojson @>,
<% endif %>
<% endif %>
]


def old_files(editor: ha_api.FileEditor) -> list[str]:
    """The OLD_FILES that still exist in the config folder (listed through the File editor)."""
    found = []
    for path in OLD_FILES:
        folder, name = path.rsplit("/", 1)
        try:
            listing = json.loads(editor._call("/api/listdir?path=" + urllib.parse.quote(folder)))["content"]
        except (OSError, ValueError, KeyError):
            continue
        if any(x.get("name") == name for x in listing):
            found.append(path)
    return found


def setup(current: set[str]) -> None:
    if ZONE in current:
        print(ZONE, "already exists: not changed (change its place and radius in Settings > Zones)")
        return
    if OLD_ZONE in current:
        print(f"NOTE: {OLD_ZONE} of the earlier version exists: rename its entity id to {ZONE} (Settings > Entities)"
              " to keep its place and radius, or delete it; a new zone is created now at house.lat/lon.")
    # Passive: the trackers stay 'home' and person.* does not change; the automation uses distance(), not in_zones.
    # Created as "Driveway" so the entity_id becomes zone.driveway, then renamed for display.
    zone = {**HOME, "radius": DEFAULTS.get(ZONE, 10), "passive": True, "icon": "mdi:car-arrow-right"}
    created = ha_api.ws1({"type": "zone/create", "name": "Driveway", **zone})
    if ZONE_NAME != "Driveway":
        ha_api.ws1({"type": "zone/update", "zone_id": created["id"], "name": ZONE_NAME, **zone})
    print(f"{ZONE} created: {ZONE_NAME}, radius {zone['radius']} m, passive, at house.lat/lon."
          " Now drag it to the spot on the driveway where the cars stand (README, step 4).")


def main() -> None:
    automations = HERE / "automations.yaml"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check:", ", ".join(NEEDS), "| only reported when missing:", ", ".join(EXPECTED))
        print("  stop when an old file exists:", ", ".join(OLD_FILES))
        if "--setup" in sys.argv:
            print(f"  create {ZONE} when missing: {HOME}, radius {DEFAULTS.get(ZONE, 10)} m, passive, name {ZONE_NAME}")
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ", template")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: automations", ", ".join(a["id"] for a in yaml.safe_load(automations.read_text())))
        return

    current = ha_api.entity_ids()
    missing = [f"{eid} ({why})" for eid, why in NEEDS.items() if eid not in current]
    if missing:
        sys.exit("deploy first: " + ", ".join(missing))
    editor = ha_api.FileEditor()
    left = old_files(editor)
    if left:
        sys.exit("remove these files of the earlier (Dutch) version of the module first, they define the same "
                 "helpers and sensors: " + ", ".join(left) + " (see tesla-driveway-lock/README.md, 'Migrating')")
    for eid in EXPECTED:
        if eid not in current:
            print("NOTE: does not exist in Home Assistant:", eid)
    if WITH_PHOTO and not any(e.startswith("ai_task.") for e in current):
        sys.exit("garage_photo is on, but there is no ai_task entity (integration Google Generative AI) to judge the "
                 "garage photo: add the integration, or set tesla_driveway_lock.garage_photo: false")
    if "--setup" in sys.argv:
        setup(current)
    elif ZONE not in current:
        print(f"NOTE: {ZONE} does not exist: run once with --setup. Without the zone no car gets locked.")
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, HELPERS)
    ha_api.rest("/api/services/template/reload", {})
    print("template sensors reloaded")
    ha_api.set_defaults(DEFAULTS, current)
    ha_api.push_automations_and_scripts(automations, None)
    print("done. The master switch is off after a first install: follow the test plan in LOGIC.md first.")


if __name__ == "__main__":
    main()

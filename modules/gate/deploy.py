"""Deploy module 'gate': helpers, template sensors, macros, automations and scripts (see gate/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python gate/deploy.py [--dry-run] [--setup [--home]]

Steps:
  1. uploads package.yaml -> /config/packages/gate.yaml, custom_templates/gate.jinja and templates/gate.yaml
  2. checks the configuration, reloads the helpers, the custom templates and the template sensors
  3. gives every helper that did not exist before its default from module.yaml (defaults:), once;
     that is how the test mode (input_boolean.gate_auto_open_dry_run) starts ON
  4. writes automations.yaml and scripts.yaml through the config API (same as the UI editors)
  --setup    one-off, before the first test: enables the Teslemetry entities this module reads (disabled by default)
             and creates zone.gate_approach around house.lat/lon when it does not exist yet
  --home     with --setup: also moves the home location (zone.home) to house.lat/lon; the old value is saved first
             in backup-home-location.json next to this script
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/, templates/ in configuration.yaml) and, for step 4, the HA defaults
automation: !include automations.yaml and script: !include scripts.yaml.
"""
import json
import sys
import urllib.parse
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

FILES = {
    HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/gate.yaml",
    HERE / "custom_templates" / "gate.jinja": f"{ha_api.CONFIG_DIR}/custom_templates/gate.jinja",
    HERE / "templates" / "gate.yaml": f"{ha_api.CONFIG_DIR}/templates/gate.yaml",
}
# File names of the module before its ids were translated (kit versions up to db5b2fe). Left in place, they define
# the same helpers and sensors a second time: deploy stops and names them (see README, "Migrating").
OLD_FILES = [
    f"{ha_api.CONFIG_DIR}/packages/poort.yaml",
    f"{ha_api.CONFIG_DIR}/custom_templates/poort.jinja",
    f"{ha_api.CONFIG_DIR}/templates/poort.yaml",
]
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
ZONE = "zone.gate_approach"
ZONE_NAME = <@ t('zone_approach_name') | tojson @>
# Where the cars park at home (house.lat/lon): centre of the approach zone and, with --home, of zone.home.
HOME = {"latitude": <@ house.lat | float | tojson @>, "longitude": <@ house.lon | float | tojson @>}
# Teslemetry entities this module reads that the integration creates disabled (enabling an enabled one is harmless).
ENABLE = [
<% for a in cars %>
    <@ car_entity(a, 'shift_state') | tojson @>,
    <@ car_entity(a, 'speed') | tojson @>,
    <@ car_entity(a, 'destination') | tojson @>,
    <@ car_entity(a, 'distance_to_arrival') | tojson @>,
<% endfor %>
]
BACKUP = HERE / "backup-home-location.json"


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


def setup() -> None:
    msgs = [{"type": "config/entity_registry/update", "entity_id": e, "disabled_by": None} for e in ENABLE]
    for m, r in zip(msgs, ha_api.ws(msgs)):
        print("enable", m["entity_id"], "OK" if r["success"] else r.get("error", {}).get("message"))
    print("  enabled entities only get a value after reloading Teslemetry (or a restart)")

    if ZONE in ha_api.entity_ids():
        print(ZONE, "already exists: not changed (change its radius and place in Settings > Zones)")
    else:
        # Created as "Gate approach" so the entity_id becomes zone.gate_approach, then renamed for display.
        zone = {"latitude": HOME["latitude"], "longitude": HOME["longitude"], "radius": DEFAULTS.get(ZONE, 400),
                "passive": False, "icon": "mdi:gate"}
        created = ha_api.ws1({"type": "zone/create", "name": "Gate approach", **zone})
        ha_api.ws1({"type": "zone/update", "zone_id": created["id"], "name": ZONE_NAME, **zone})
        print(f"{ZONE} created: {ZONE_NAME}, radius {zone['radius']} m, not passive")

    if "--home" in sys.argv:
        old = ha_api.rest("/api/config")
        if not BACKUP.exists():
            BACKUP.write_text(json.dumps({k: old[k] for k in ("latitude", "longitude", "elevation", "radius")
                                          if k in old}, indent=1))
        print("old home location saved in", BACKUP.name)
        ha_api.ws1({"type": "config/core/update", **HOME})
        print("zone.home moved to house.lat/lon")


def main() -> None:
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        if "--setup" in sys.argv:
            print("  enable:", ", ".join(ENABLE))
            print(f"  create {ZONE} when missing: {HOME}, radius {DEFAULTS.get(ZONE, 400)} m, name {ZONE_NAME}")
            if "--home" in sys.argv:
                print("  move zone.home to", HOME, "(old value first to", BACKUP.name + ")")
        print("  stop when an old file exists:", ", ".join(OLD_FILES))
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload: input_boolean, input_number, input_datetime, counter, custom templates, template")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: automations", ", ".join(a["id"] for a in yaml.safe_load((HERE / "automations.yaml").read_text())))
        print("  config API: scripts", ", ".join(yaml.safe_load((HERE / "scripts.yaml").read_text())))
        return

    editor = ha_api.FileEditor()
    left = old_files(editor)
    if left:
        sys.exit("remove these files of the earlier (Dutch) version of the module first, they define the same "
                 "helpers and sensors: " + ", ".join(left) + " (see gate/README.md, 'Migrating')")
    if "--setup" in sys.argv:
        setup()
    before = ha_api.entity_ids()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    for domain in ("input_boolean", "input_number", "input_datetime", "counter"):
        ha_api.rest(f"/api/services/{domain}/reload", {})
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    ha_api.rest("/api/services/template/reload", {})
    print("helpers, custom templates and template sensors reloaded")
    ha_api.set_defaults(DEFAULTS, before)
    ha_api.push_automations_and_scripts(HERE / "automations.yaml", HERE / "scripts.yaml")
    print("done. Test mode is on after a first install: follow the test plan in gate/LOGIC.md.")


if __name__ == "__main__":
    main()

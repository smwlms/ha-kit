"""Deploy module 'charger-zappi': helpers, normalised sensors, the ev-charger script and the phase automation.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python charger-zappi/deploy.py [--dry-run]

Steps:
  1. uploads package.yaml -> /config/packages/charger_zappi.yaml and templates/charger_zappi.yaml
  2. checks the configuration, reloads input_boolean, input_number and the template entities
  3. gives every helper that did not exist before its default from module.yaml (defaults:), once
  4. writes scripts.yaml (script.ev_charger_set_mode) and, with phase switching, automations.yaml
     (automation charger_zappi_phases) through the config API; without phase switching an earlier
     charger_zappi_phases is removed
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/, templates/ in configuration.yaml), the myenergi integration (HACS) and the HA defaults
automation: !include automations.yaml and script: !include scripts.yaml.
"""
import sys
import urllib.error
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

FILES = {
    HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/charger_zappi.yaml",
    HERE / "templates" / "charger_zappi.yaml": f"{ha_api.CONFIG_DIR}/templates/charger_zappi.yaml",
}
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
PHASE_AUTOMATION = "charger_zappi_phases"


def automations() -> list:
    """The rendered automations: one with phase switching, none without (the file is then an empty list)."""
    return yaml.safe_load((HERE / "automations.yaml").read_text()) or []


def main() -> None:
    autos = automations()
    scripts = yaml.safe_load((HERE / "scripts.yaml").read_text()) or {}
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(HERE / "package.yaml", ("input_boolean", "input_number"))
              + ", template")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: scripts", ", ".join(scripts))
        if autos:
            print("  config API: automations", ", ".join(a["id"] for a in autos))
        else:
            print("  no phase switching: remove automation", PHASE_AUTOMATION, "when it exists")
        return

    before = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(HERE / "package.yaml", ("input_boolean", "input_number"))
    ha_api.rest("/api/services/template/reload", {})
    print("template entities reloaded")
    ha_api.set_defaults(DEFAULTS, before)
    ha_api.push_automations_and_scripts(HERE / "automations.yaml" if autos else None, HERE / "scripts.yaml")
    if not autos:
        try:
            ha_api.rest(f"/api/config/automation/config/{PHASE_AUTOMATION}", method="DELETE")
            print("automation", PHASE_AUTOMATION, "removed (no phase switching in this house.yaml)")
        except urllib.error.HTTPError:
            pass  # was not there
    print("done. Follow the test plan in charger-zappi/LOGIC.md.")


if __name__ == "__main__":
    main()

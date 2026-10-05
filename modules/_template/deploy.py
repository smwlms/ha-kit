"""Deploy module '_template': helper package and automation (see _template/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python _template/deploy.py [--dry-run]

Steps:
  1. uploads package.yaml -> /config/packages/ha_kit_template.yaml
  2. checks the configuration and reloads input_boolean
  3. gives every helper that did not exist before its default from module.yaml (defaults:), once
  4. writes automations.yaml through the config API (same as the automation editor)
  --dry-run  prints what it would do, does not connect to Home Assistant
Needs module base (packages/ in configuration.yaml) and automation: !include automations.yaml.
"""
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

PACKAGE = HERE / "package.yaml"
FILES = {PACKAGE: f"{ha_api.CONFIG_DIR}/packages/ha_kit_template.yaml"}
# Helper domains reloaded on every deploy (plus any other the package defines). Never reload counter yourself: it has
# no reload service; ha_api.reload_helpers names a new counter (it appears after one restart of Home Assistant).
HELPERS = ("input_boolean",)
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}


def main() -> None:
    automations = HERE / "automations.yaml"
    ids = [a["id"] for a in yaml.safe_load(automations.read_text()) or []]
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, HELPERS))
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: automations", ", ".join(ids))
        return

    before = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, HELPERS)
    ha_api.set_defaults(DEFAULTS, before)
    ha_api.push_automations_and_scripts(automations, None)
    print("done. Follow the test plan in _template/LOGIC.md.")


if __name__ == "__main__":
    main()

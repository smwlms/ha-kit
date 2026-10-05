<% from '_shading.jinja' import all_rooms, blinds, curtains, sun_on, sun, weather with context %>
<% set group_names = ([t('group_all_blinds')] if blinds else []) + ([t('group_all_curtains')] if curtains else []) %>
"""Deploy module 'shading': helpers, cover groups, sun sensors, macros and automations (see shading/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python shading/deploy.py [--dry-run]

Steps:
  1. warns about covers (and the weather entity) from house.yaml that do not exist in Home Assistant
  2. uploads package.yaml -> /config/packages/shading.yaml; with sun and heat also
     custom_templates/shading.jinja and templates/shading.yaml
  3. checks the configuration, reloads the helpers, the cover groups, the custom templates and the template sensors
  4. gives every helper that did not exist before its default from module.yaml (defaults:), once
  5. writes automations.yaml through the config API (same as the automation editor)
  --dry-run  dry run: prints what it would do, does not connect to Home Assistant
Needs module base (packages/, templates/ in configuration.yaml) and automation: !include automations.yaml.
"""
import json
import re
import sys
import urllib.error
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "shading"
WITH_SUN = <@ 'True' if sun else 'False' @>
FILES = {HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"}
if WITH_SUN:
    FILES[HERE / "custom_templates" / "shading.jinja"] = f"{ha_api.CONFIG_DIR}/custom_templates/shading.jinja"
    FILES[HERE / "templates" / "shading.yaml"] = f"{ha_api.CONFIG_DIR}/templates/shading.yaml"
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}
RELOADS = ("input_boolean", "input_number", "input_datetime", "group")
# Names of the cover groups in the install language; Home Assistant derives their entity ids from these names.
GROUP_NAMES = json.loads(r'''<@ group_names | tojson @>''')
# Entities from house.yaml that come from integrations (only reported when missing).
EXPECTED = [
<% for k in blinds %>
    <@ k.blind | tojson @>,
<% endfor %>
<% for k in curtains %>
    <@ k.curtain | tojson @>,
<% endfor %>
<% if sun %>
    <@ weather | tojson @>,
<% endif %>
]


def slug(name: str) -> str:
    """Entity id part Home Assistant makes of a name (close enough for plain names: lower case, _ between words)."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def states() -> dict[str, dict]:
    return {s["entity_id"]: s for s in ha_api.rest("/api/states")}


def main() -> None:
    automations = HERE / "automations.yaml"
    ids = [a["id"] for a in yaml.safe_load(automations.read_text()) or []]
    groups = [f"cover.{slug(n)}" for n in GROUP_NAMES]
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check (only reported when missing):", ", ".join(EXPECTED))
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ", ".join(RELOADS) + (", custom templates, template" if WITH_SUN else ""))
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  cover groups:", ", ".join(groups) or "none")
        print("  config API: automations", ", ".join(ids))
        return

    current = states()
    missing = [e for e in EXPECTED if e not in current]
    for e in missing:
        print("NOTE: does not exist in Home Assistant:", e, "(check house.yaml; the automation does not skip it)")
    before = set(current)
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    for domain in RELOADS:
        try:
            ha_api.rest(f"/api/services/{domain}/reload", {})
        except urllib.error.HTTPError as e:
            print(f"reloading {domain} failed ({e.code}); restart Home Assistant if the groups are missing")
    if WITH_SUN:
        ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
        ha_api.rest("/api/services/template/reload", {})
    print("helpers, groups" + (", macros and sun sensors" if WITH_SUN else "") + " reloaded")
    after = set(states())
    ha_api.set_defaults(DEFAULTS, before, after)
    for e in groups:
        if f"{e}_2" in after:
            print(f"NOTE: {e}_2 exists: there already was a group with that name (e.g. a UI group). Delete the old group"
                  " in Settings > Helpers and rename this one to drop the _2 (see README, 'Existing groups').")
    ha_api.push_automations_and_scripts(automations, None)
    print("done. Follow the test plan in shading/LOGIC.md.")


if __name__ == "__main__":
    main()

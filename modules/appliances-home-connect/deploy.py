<% from '_appliances.jinja' import apps, has_energy, has_tariff, has_presence, has_battery with context %>
<% set durations = {} %>
<% set expected = {} %>
<% for a in apps %>
<% set _ = durations.update({a.duration: a.duration_h}) %>
<% for role in ['status', 'door', 'selected_program', 'remote_start', 'stop'] %>
<% set _ = expected.update({a.e[role]: a.key ~ ' ' ~ role}) %>
<% endfor %>
<% endfor %>
<% set programs = {} %>
<% for a in apps %>
<% set _ = programs.update({a.key: a.e.selected_program}) %>
<% endfor %>
"""Deploy module 'appliances-home-connect': helpers, start-window macro, scripts, automations and two dashboard views.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python appliances-home-connect/deploy.py [--dry-run [--live]]
                                                                              [--tab [--dashboard <url_path>]]

Steps:
  1. uploads package.yaml -> packages/appliances_home_connect.yaml and custom_templates/appliances.jinja
  2. checks the configuration, reloads the helpers and the custom templates
  3. gives every helper that did not exist before its start value, once (module.yaml defaults:, and the program
     duration per appliance from appliances[].duration_h)
  4. writes scripts.yaml, then automations.yaml through the config API (scripts first: the automations call them)
  5. reports the Home Connect entities that do not exist and an appliance whose device is not found
  --tab      adds (or updates) the views "appliances" and "appliances-settings" of lovelace/appliances.yaml on a
             dashboard in storage mode (default the Overview; --dashboard <url_path> another one); the dashboard config
             is saved to backup/ first
  --dry-run  prints what it would do, does not connect to Home Assistant
  --live     with --dry-run: also reads Home Assistant (nothing is written) and reports the missing entities and
             devices; needs HA_URL and HA_TOKEN
Needs module base (packages/ in configuration.yaml), module notifications (script.send_notification) and the HA
defaults automation: !include automations.yaml and script: !include scripts.yaml.
Built for: energy-plan <@ 'yes' if has_energy else 'no' @>, battery <@ 'yes' if has_battery else 'no' @>, tariff <@ 'yes' if has_tariff else 'no' @>, presence <@ 'yes' if has_presence else 'no' @>.
"""
import json
import sys
from datetime import date
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "appliances_home_connect"
FILES = {
    HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml",
    HERE / "custom_templates" / "appliances.jinja": f"{ha_api.CONFIG_DIR}/custom_templates/appliances.jinja",
}
RELOADS = ("input_boolean", "input_datetime", "input_select", "input_number")
# Start values, set once when the helper is new: module.yaml defaults: (input_select.appliance_*_ready_by matches one
# helper per appliance in ha_api.set_defaults) + the duration per appliance.
DEFAULTS = {**(yaml.safe_load((HERE / "module.yaml").read_text()).get("defaults") or {}),
            **json.loads(r'''<@ durations | tojson @>''')}
# Home Connect entities the module reads (entity -> appliance and role).
EXPECTED = json.loads(r'''<@ expected | tojson @>''')
# The device of each appliance is found from its program select (device_id() in the scripts).
PROGRAM_SELECT = json.loads(r'''<@ programs | tojson @>''')
VIEWS = HERE / "lovelace" / "appliances.yaml"
VIEW_PATHS = ("appliances", "appliances-settings")


def arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


def check_entities() -> None:
    """Report (never fail) missing Home Connect entities and appliances whose device is not found."""
    have = ha_api.entity_ids()
    missing = [f"{eid} ({why})" for eid, why in EXPECTED.items() if eid not in have]
    for line in missing:
        print("  missing:", line)
    if missing:
        print("  -> wrong prefix or entity language? See README 'Entity names' (home_connect.language,"
              " appliances[].entities)")
    for key, select in PROGRAM_SELECT.items():
        # The template answers JSON ("" when not found), so rest() can parse it.
        device = ha_api.rest("/api/template", {"template": "{{ (device_id('" + select + "') or '') | to_json }}"})
        print(f"  {key}: device {'found' if device else 'NOT FOUND (no device_id for ' + select + ')'}")
    if "script.send_notification" not in have:
        print("  missing: script.send_notification (deploy module notifications first)")
    if not missing:
        print("every expected entity exists")


def add_views() -> None:
    url_path = arg("--dashboard")
    # The settings button and the back arrow point at /lovelace/...: another dashboard has its own url_path.
    text = VIEWS.read_text(encoding="utf-8").replace("/lovelace/appliances", f"/{url_path or 'lovelace'}/appliances")
    views = yaml.safe_load(text)
    r = ha_api.ws([{"type": "lovelace/config", "url_path": url_path}])[0]
    if not r["success"]:
        sys.exit(f"dashboard not readable ({r.get('error')}). Take control of the dashboard in the UI first "
                 "(Edit > Take control) or pass --dashboard <url_path>.")
    config = r["result"]
    backup = HERE / "backup" / f"dashboard-{url_path or 'overview'}-{date.today().isoformat()}-before-appliances.json"
    backup.parent.mkdir(exist_ok=True)
    if not backup.exists():
        backup.write_text(json.dumps(config, indent=1, ensure_ascii=False))
        print("backup:", backup)
    existing = config.setdefault("views", [])
    for view in views:
        paths = [v.get("path") for v in existing]
        if view["path"] in paths:
            existing[paths.index(view["path"])] = view
            print(f"view '{view['path']}' existed already: updated")
        else:
            existing.append(view)
            print(f"view added: /{url_path or 'lovelace'}/{view['path']}")
    ha_api.ws1({"type": "lovelace/config/save", "url_path": url_path, "config": config})


def main() -> None:
    automations = HERE / "automations.yaml"
    scripts = HERE / "scripts.yaml"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ", ".join(RELOADS) + ", custom templates")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: scripts", ", ".join(yaml.safe_load(scripts.read_text())))
        print("  config API: automations", ", ".join(a["id"] for a in yaml.safe_load(automations.read_text())))
        if "--tab" in sys.argv:
            print("  views", ", ".join(VIEW_PATHS), "on dashboard", arg("--dashboard") or "Overview", "(backup first)")
        print("  check entities:", ", ".join(EXPECTED))
        if "--live" in sys.argv:
            check_entities()
        return

    before = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    for domain in RELOADS:
        ha_api.rest(f"/api/services/{domain}/reload", {})
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    print("helpers and macros reloaded")
    ha_api.set_defaults(DEFAULTS, before)
    ha_api.push_automations_and_scripts(None, scripts)
    ha_api.push_automations_and_scripts(automations, None)
    if "--tab" in sys.argv:
        add_views()
    check_entities()
    print("done. Follow the test plan in appliances-home-connect/LOGIC.md (start with test 1: script.appliance_smart_start).")


if __name__ == "__main__":
    main()

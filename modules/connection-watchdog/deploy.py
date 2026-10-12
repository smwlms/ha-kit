<% from '_connection_watchdog.jinja' import sources, view_path with context %>
<% set keys = [] %>
<% for s in sources %><% for k in s['keys'] %><% set _ = keys.append(k) %><% endfor %><% if s.get('time') %><% set _ = keys.append(s.time) %><% endif %><% endfor %>
"""Deploy module 'connection-watchdog': helper, macro, sensors, automation, card and (optionally) the view.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python connection-watchdog/deploy.py [--dry-run] [--view [--dashboard <url_path>]]

Steps:
  1. reports the entities of connection_watchdog.sources (house.yaml) that do not exist, and checks that
     script.send_notification (module notifications) is there
  2. uploads package.yaml -> packages/connection_watchdog.yaml, custom_templates/connection_watchdog.jinja and
     templates/connection_watchdog.yaml
  3. checks the configuration, reloads the helpers, the custom templates and the template sensors
  4. gives the test helper its default from module.yaml (defaults:) when it is new, once
  5. writes automations.yaml through the config API (same as the automation editor)
  6. uploads www/connection-watchdog-card.js to /config/www/ha-kit/connection-watchdog/ and registers it as a
     dashboard resource /local/ha-kit/connection-watchdog/connection-watchdog-card.js?v=(VERSION in the file)
  --view       adds (or replaces in place) the view connection_watchdog.view_path of lovelace/connections.yaml on a
               dashboard in storage mode (default the Overview; --dashboard <url_path> for another one); its config is
               saved to backup/ first. Every other view stays as it was
  --dry-run    prints what it would do; never connects to Home Assistant
Needs module base (packages/, templates/ in configuration.yaml) and notifications (script.send_notification), and
automation: !include automations.yaml.
"""
import json
import sys
import urllib.error
from datetime import date
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "connection_watchdog"
PACKAGE = HERE / "package.yaml"
UPLOADS = [
    (PACKAGE, f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"),
    (HERE / "custom_templates" / f"{MODULE}.jinja", f"{ha_api.CONFIG_DIR}/custom_templates/{MODULE}.jinja"),
    (HERE / "templates" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/templates/{MODULE}.yaml"),
]
HELPERS = ("input_select",)
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text(encoding="utf-8")).get("defaults") or {}
CARD = HERE / "www" / "connection-watchdog-card.js"
CARD_FOLDER = "ha-kit/connection-watchdog"
VIEW = yaml.safe_load((HERE / "lovelace" / "connections.yaml").read_text(encoding="utf-8"))
VIEW_PATH = <@ view_path | tojson @>
# Entities named in connection_watchdog.sources (keys and data_time); only reported when missing.
EXPECTED = json.loads(r'''<@ keys | unique | list | tojson @>''')


def arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


def add_view() -> None:
    url_path = arg("--dashboard")
    r = ha_api.ws([{"type": "lovelace/config", "url_path": url_path}])[0]
    if not r["success"]:
        sys.exit(f"dashboard not readable ({r.get('error')}). Take control of the dashboard in the UI first "
                 "(Edit > Take control) or pass --dashboard <url_path>.")
    config = r["result"]
    backup = HERE / "backup" / f"dashboard-{url_path or 'overview'}-{date.today().isoformat()}-before-{MODULE}.json"
    backup.parent.mkdir(exist_ok=True)
    if not backup.exists():
        backup.write_text(json.dumps(config, indent=1, ensure_ascii=False))
        print("backup:", backup)
    views = config.setdefault("views", [])
    for i, v in enumerate(views):
        if v.get("path") == VIEW_PATH:
            views[i] = VIEW
            print(f"view '{VIEW_PATH}' existed (position {i + 1}): replaced in place")
            break
    else:
        views.append(VIEW)
        print(f"view added: /{url_path or 'lovelace'}/{VIEW_PATH}")
    ha_api.ws1({"type": "lovelace/config/save", "url_path": url_path, "config": config})


def report() -> None:
    try:
        st = ha_api.rest("/api/states/sensor.connection_watchdog")
        print("  sensor.connection_watchdog =", st["state"], "|", st["attributes"].get("summary"))
    except urllib.error.HTTPError:
        print("  sensor.connection_watchdog does not exist (yet): it renders on the next minute; check templates/ in "
              "configuration.yaml (module base) when it stays away")


def main() -> None:
    automations = HERE / "automations.yaml"
    ids = [a["id"] for a in yaml.safe_load(automations.read_text(encoding="utf-8")) or []]
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  check (only reported when missing):", ", ".join(EXPECTED + ["script.send_notification"]))
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ", custom templates, template")
        print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
        print("  config API: automations", ", ".join(ids))
        print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{CARD_FOLDER}/{CARD.name}",
              f"+ resource /local/{CARD_FOLDER}/{CARD.name}")
        if "--view" in sys.argv:
            print(f"  view '{VIEW_PATH}' on dashboard", arg("--dashboard") or "Overview", "(backup first)")
        return

    have = ha_api.entity_ids()
    for eid in EXPECTED:
        if eid not in have:
            print(f"NOTE: {eid} does not exist: its source stays 'unreachable' until it does (check house.yaml)")
    if "script.send_notification" not in have:
        print("WARNING: script.send_notification does not exist: deploy the module notifications first; until then "
              "only the persistent notification arrives")
    editor = ha_api.FileEditor()
    for src, dst in UPLOADS:
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, HELPERS)
    # Macro first: the template sensors import it.
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    ha_api.rest("/api/services/template/reload", {})
    print("helpers, macro and template sensors reloaded")
    ha_api.set_defaults(DEFAULTS, have)
    ha_api.push_automations_and_scripts(automations, None)
    ha_api.publish_card(CARD, CARD_FOLDER)
    if "--view" in sys.argv:
        add_view()
    report()
    print("done. Follow the test plan in connection-watchdog/LOGIC.md.")


if __name__ == "__main__":
    main()

<% from '_e_ink.jinja' import dashboard, view_path with context %>
"""Deploy module 'e-ink-display': helpers, optional charging automation, the card and the view of the wall display.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python e-ink-display/deploy.py [--dry-run [--live]]

Steps:
  1. uploads package.yaml -> /config/packages/e_ink_display.yaml, checks the configuration, reloads input_number
     and input_boolean, and gives every NEW helper its default from module.yaml (defaults:), once
  2. writes automations.yaml through the config API (smart charging; only with e_ink_display.charger_relay)
  3. uploads www/e-ink-screen.js to /config/www/ha-kit/e-ink-display/ and registers it as dashboard resource
     /local/ha-kit/e-ink-display/e-ink-screen.js?v=(VERSION in the file)
  4. reads the dashboard "<@ dashboard @>" (created when it does not exist: storage mode, not in the sidebar, for every
     user), saves its config to backup/ and writes the view "<@ view_path @>" of lovelace/view.yaml: an existing view with
     the same path is replaced in place, otherwise it is added as the first view. Every other view stays as it was.
  --dry-run  prints what it would do and a diff of the views; never connects to Home Assistant, so the diff is
             against an empty dashboard
  --live     with --dry-run: reads the dashboard, the resources and the helpers (read-only, nothing is written) and
             prints the real diff; needs HA_URL and HA_TOKEN
Needs module base (packages/ in configuration.yaml, cw-thema.js for the icons).
"""
from __future__ import annotations

import difflib
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

DASHBOARD = <@ dashboard | tojson @>
PACKAGE = HERE / "package.yaml"
PACKAGE_DST = f"{ha_api.CONFIG_DIR}/packages/e_ink_display.yaml"
AUTOMATIONS = HERE / "automations.yaml"
CARD = HERE / "www" / "e-ink-screen.js"
CARD_FOLDER = "ha-kit/e-ink-display"  # phase-4 frontend rule: /config/www/ha-kit/<module>/
CARD_URL = f"/local/{CARD_FOLDER}/{CARD.name}"
VIEW = yaml.safe_load((HERE / "lovelace" / "view.yaml").read_text(encoding="utf-8"))
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text(encoding="utf-8")).get("defaults") or {}
HELPERS = yaml.safe_load(PACKAGE.read_text(encoding="utf-8")) or {}
NEW_HELPERS = {f"{domain}.{key}" for domain, items in HELPERS.items() for key in (items or {})}
# Only defaults of helpers this house's package defines (the charging helpers exist only with a relay).
DEFAULTS = {k: v for k, v in DEFAULTS.items() if k in NEW_HELPERS}
NEEDS = {"/local/cw-thema.js": "module base (cw-icoon and the weather names)"}
CHARGING_ID = "e_ink_display_smart_charging"


def card_version() -> str:
    text = CARD.read_text(encoding="utf-8")
    return text.split('const VERSION = "', 1)[1].split('"', 1)[0]


def automations() -> list[dict]:
    return yaml.safe_load(AUTOMATIONS.read_text(encoding="utf-8")) or []


def merged(views: list[dict]) -> tuple[list[dict], str]:
    """The views after writing ours: replace the view with the same path in place, else insert it first."""
    out = [dict(v) for v in views]
    for i, v in enumerate(out):
        if v.get("path") == VIEW["path"]:
            out[i] = VIEW
            return out, f"view '{VIEW['path']}' exists (position {i + 1}): replaced in place"
    return [VIEW] + out, f"view '{VIEW['path']}' is new: added as the first view"


def compact(views: list[dict]) -> list[dict]:
    """Views for the diff: the texts of the card (strings:) as one line with a fingerprint."""
    out = []
    for v in views:
        cards = []
        for c in v.get("cards") or []:
            if isinstance(c, dict) and isinstance(c.get("strings"), dict):
                texts = json.dumps(c["strings"], sort_keys=True, ensure_ascii=False).encode()
                c = {**c, "strings": f"{len(c['strings'])} texts, sha1 {hashlib.sha1(texts).hexdigest()[:10]}"}
            cards.append(c)
        out.append({**v, "cards": cards} if "cards" in v else v)
    return out


def show_diff(before: list[dict], after: list[dict]) -> None:
    before, after = compact(before), compact(after)
    paths_after = [v.get("path") or v.get("title") or f"#{i + 1}" for i, v in enumerate(after)]
    print("  views after:", ", ".join(paths_after) or "-")
    print("  untouched:", ", ".join(p for p in paths_after if p != VIEW["path"]) or "none")
    a = json.dumps(before, indent=1, ensure_ascii=False, sort_keys=True).splitlines()
    b = json.dumps(after, indent=1, ensure_ascii=False, sort_keys=True).splitlines()
    diff = list(difflib.unified_diff(a, b, "dashboard (now)", "dashboard (after deploy)", lineterm="", n=2))
    print("  diff:" if diff else "  diff: none (the dashboard already has this view)")
    for line in diff:
        print("   ", line)


def read_dashboard() -> tuple[dict | None, str]:
    """(config, status): status 'ok', 'missing' (dashboard does not exist) or 'empty' (exists, no config yet)."""
    boards = ha_api.ws1({"type": "lovelace/dashboards/list"})
    if not any(b.get("url_path") == DASHBOARD for b in boards):
        return None, "missing"
    r = ha_api.ws([{"type": "lovelace/config", "url_path": DASHBOARD}])[0]
    if r["success"]:
        return r["result"], "ok"
    if (r.get("error") or {}).get("code") == "config_not_found":
        return {"views": []}, "empty"
    sys.exit(f"dashboard {DASHBOARD} not readable ({r.get('error')}); is it in YAML mode?")


def check_resources(resources: list[dict]) -> None:
    have = {r["url"].split("?")[0] for r in resources}
    for url, who in NEEDS.items():
        print(f"  resource {url}:", "present" if url in have else f"MISSING: deploy {who} first")


def plan() -> None:
    print("  upload", PACKAGE.relative_to(HERE.parent), "->", PACKAGE_DST)
    print("  check_config, reload:", ha_api.describe_helper_reload(PACKAGE, ("input_number", "input_boolean")))
    print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()) or "none")
    ids = [a["id"] for a in automations()]
    print("  config API: automations", ", ".join(ids) if ids else "none (no e_ink_display.charger_relay)")
    print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{CARD_FOLDER}/{CARD.name}",
          f"+ resource {CARD_URL}?v={card_version()}")
    roles = VIEW["cards"][0]["roles"]
    print("  roles:", ", ".join(f"{k}={v}" for k, v in sorted(roles.items())))
    print("  buttons:", ", ".join(f"{n['label']} {n['path']}" for n in VIEW["cards"][0]["nav"]) or "none")


def main() -> None:
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        plan()
        if "--live" in sys.argv:
            states = ha_api.entity_ids()
            for h in sorted(NEW_HELPERS):
                print(f"  helper {h}:", "exists (keeps its value)" if h in states else "new (gets its default)")
            if not automations() and f"automation.{CHARGING_ID}" in states:
                print(f"  NOTE: automation.{CHARGING_ID} exists from an earlier deploy but no relay is configured now:"
                      " delete it in Settings > Automations")
            config, status = read_dashboard()
            if status == "missing":
                print(f"  dashboard {DASHBOARD} does not exist: it would be created (storage mode, not in the sidebar)")
            before = (config or {}).get("views") or []
            after, what = merged(before)
            print(f"  dashboard {DASHBOARD}: backup to backup/, then {what}")
            show_diff(before, after)
            check_resources(ha_api.ws1({"type": "lovelace/resources"}))
        else:
            after, what = merged([])
            print(f"  dashboard {DASHBOARD}: backup to backup/, then write the view (add --live for the diff against"
                  " the real dashboard, read-only)")
            show_diff([], after)
            print("  check resources:", ", ".join(NEEDS))
        return

    before_ids = ha_api.entity_ids()
    ha_api.FileEditor().save(PACKAGE, PACKAGE_DST)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, ("input_number", "input_boolean"))
    ha_api.set_defaults(DEFAULTS, before_ids)
    if automations():
        ha_api.push_automations_and_scripts(AUTOMATIONS, None)
    elif f"automation.{CHARGING_ID}" in before_ids:
        print(f"NOTE: automation.{CHARGING_ID} is left from an earlier deploy (no relay configured now): delete it in"
              " Settings > Automations")

    ha_api.publish_card(CARD, CARD_FOLDER)
    config, status = read_dashboard()
    if status == "missing":
        ha_api.ws1({"type": "lovelace/dashboards/create", "url_path": DASHBOARD, "title": <@ t('dashboard_title') | tojson @>,
                    "icon": "mdi:tablet", "mode": "storage", "show_in_sidebar": False, "require_admin": False})
        print("dashboard created:", DASHBOARD)
        config = {"views": []}
    else:
        backup = HERE / "backup" / f"dashboard-{DASHBOARD}-{date.today().isoformat()}.json"
        backup.parent.mkdir(exist_ok=True)
        if not backup.exists():
            backup.write_text(json.dumps(config, indent=1, ensure_ascii=False))
            print("backup:", backup)
    before = config.get("views") or []
    after, what = merged(before)
    show_diff(before, after)
    config["views"] = after
    ha_api.ws1({"type": "lovelace/config/save", "url_path": DASHBOARD, "config": config})
    print(f"dashboard {DASHBOARD}: {what}")
    check_resources(ha_api.ws1({"type": "lovelace/resources"}))
    print(f"done. Open /{DASHBOARD}/{VIEW['path']} on the tablet and follow the test plan in e-ink-display/LOGIC.md.")


if __name__ == "__main__":
    main()

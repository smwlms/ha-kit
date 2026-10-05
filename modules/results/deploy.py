<% from '_results.jinja' import kinds, goals, sun_rooms, solar_missed with context %>
"""Deploy module 'results': helpers, the results sensors, macros, two automations, the card and the view.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python results/deploy.py [--dry-run [--live]] [--dashboard <url_path>]

Steps:
  1. uploads package.yaml -> /config/packages/results.yaml, custom_templates/results.jinja and templates/results.yaml
  2. checks the configuration, reloads input_number, the custom templates and the template sensors
  3. gives every helper that did not exist before its start value from module.yaml (defaults:), once
  4. writes automations.yaml through the config API
  5. uploads www/results-screen.js to /config/www/ha-kit/results/ and registers it as dashboard resource
     /local/ha-kit/results/results-screen.js?v=(VERSION in the file)
  6. reads the dashboard (default: the Overview; --dashboard <url_path>: another one, created when it does not exist;
     its url_path needs a hyphen), saves its config to backup/ and writes the view of lovelace/results.yaml: an
     existing view with the same path is replaced in place, otherwise the view is added as the LAST view. Every other
     view stays exactly as it was.
  --dry-run  prints what it would do and a diff of the views; never connects to Home Assistant
  --live     with --dry-run: reads the dashboard and the resources (read-only, nothing is written) and prints the
             real diff against them; needs HA_URL and HA_TOKEN
Needs module base (packages/, templates/, custom_templates in configuration.yaml; cw-thema.js) and a module that
provides tariff. The sensors start empty: the savings count from the first event after the deploy.
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

CARD = HERE / "www" / "results-screen.js"
CARD_FOLDER = "ha-kit/results"  # phase-4 frontend rule: /config/www/ha-kit/<module>/
CARD_URL = f"/local/{CARD_FOLDER}/{CARD.name}"
FILES = {
    HERE / "package.yaml": f"{ha_api.CONFIG_DIR}/packages/results.yaml",
    HERE / "custom_templates" / "results.jinja": f"{ha_api.CONFIG_DIR}/custom_templates/results.jinja",
    HERE / "templates" / "results.yaml": f"{ha_api.CONFIG_DIR}/templates/results.yaml",
}
DEFAULTS = yaml.safe_load((HERE / "module.yaml").read_text(encoding="utf-8")).get("defaults") or {}
AUTOMATIONS = HERE / "automations.yaml"
VIEW = yaml.safe_load((HERE / "lovelace" / "results.yaml").read_text(encoding="utf-8"))
# What this house gets (rendered from house.yaml and modules: by tools/fill.py).
KINDS = <@ kinds | map(attribute='kind') | list | tojson @>
GOALS = <@ goals | map(attribute='goal') | list | tojson @>
SHADING_ROOMS = <@ sun_rooms | map(attribute='slug') | list | tojson @>
SOLAR_MISSED = <@ 'True' if solar_missed else 'False' @>
# Resources of other modules the card uses (path without ?v=).
NEEDS = {
    "/local/cw-thema.js": "module base (cw-kop, cw-knop)",
    "/local/ha-kit/tariff/tariff.js": "the tariff module (comparison with other contracts)",
}


def arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


def card_version() -> str:
    text = CARD.read_text(encoding="utf-8")
    return text.split('const VERSION = "', 1)[1].split('"', 1)[0]


def merged(views: list[dict]) -> tuple[list[dict], str]:
    """The views after writing ours: replace the view with the same path in place, else append it."""
    out = [dict(v) for v in views]
    for i, v in enumerate(out):
        if v.get("path") == VIEW["path"]:
            out[i] = VIEW
            return out, f"view '{VIEW['path']}' exists (position {i + 1}): replaced in place"
    return out + [VIEW], f"view '{VIEW['path']}' is new: added as the last view"


def compact(views: list[dict]) -> list[dict]:
    """Views for the diff: the texts of a results-screen-card (strings:) as one line with a fingerprint."""
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


def read_dashboard(url_path: str | None) -> tuple[dict | None, str]:
    """(config, status): status 'ok', 'missing' (dashboard does not exist) or 'empty' (exists, no config yet)."""
    if url_path:
        boards = ha_api.ws1({"type": "lovelace/dashboards/list"})
        if not any(b.get("url_path") == url_path for b in boards):
            return None, "missing"
    r = ha_api.ws([{"type": "lovelace/config", "url_path": url_path}])[0]
    if r["success"]:
        return r["result"], "ok"
    if url_path and (r.get("error") or {}).get("code") == "config_not_found":
        return {"views": []}, "empty"
    sys.exit(f"dashboard {url_path or 'Overview'} not readable ({r.get('error')}). The Overview is auto-generated or in"
             " YAML mode: take control in the UI first (Edit dashboard > Take control), or pass --dashboard <url_path>.")


def check_resources(resources: list[dict]) -> None:
    have = {r["url"].split("?")[0] for r in resources}
    for url, who in NEEDS.items():
        print(f"  resource {url}:", "present" if url in have else f"MISSING: deploy {who} first")


def summary(automations: list[dict]) -> None:
    for src, dst in FILES.items():
        print("  upload", src.relative_to(HERE.parent), "->", dst)
    print("  check_config, reload: input_number, custom templates, template")
    print("  defaults for new helpers:", ", ".join(f"{k}={v}" for k, v in DEFAULTS.items()))
    print("  config API: automations", ", ".join(a["id"] for a in automations) or "none")
    print("  saving sensors:", ", ".join(f"sensor.results_saving_{k}" for k in KINDS) or "none (no producer installed)")
    print("  goals:", ", ".join(GOALS) or "none", "| solar missed:", "yes" if SOLAR_MISSED else "no",
          "| shading count:", ", ".join(SHADING_ROOMS) or "no")
    print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{CARD_FOLDER}/{CARD.name}",
          f"+ resource {CARD_URL}?v={card_version()}")


def main() -> None:
    url_path = arg("--dashboard")
    if url_path and "-" not in url_path:
        sys.exit(f"--dashboard {url_path}: the url_path of a dashboard needs a hyphen (Home Assistant rule), e.g. ha-kit-results")
    where = f"dashboard {url_path}" if url_path else "the Overview"
    automations = yaml.safe_load(AUTOMATIONS.read_text(encoding="utf-8")) or []
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        summary(automations)
        if "--live" in sys.argv:
            config, status = read_dashboard(url_path)
            if status == "missing":
                print(f"  {where} does not exist: it would be created (storage mode)")
            before = (config or {}).get("views") or []
            after, what = merged(before)
            print(f"  {where}: backup to backup/, then {what}")
            show_diff(before, after)
            check_resources(ha_api.ws1({"type": "lovelace/resources"}))
        else:
            after, what = merged([])
            print(f"  {where}: backup to backup/, then write the view (add --live for the diff against the real"
                  " dashboard, read-only)")
            show_diff([], after)
            print("  check resources:", ", ".join(NEEDS))
        return

    before_ids = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.rest("/api/services/input_number/reload", {})
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    ha_api.rest("/api/services/template/reload", {})
    print("helpers, custom templates and template sensors reloaded")
    ha_api.set_defaults(DEFAULTS, before_ids)
    if automations:
        ha_api.push_automations_and_scripts(AUTOMATIONS, None)
    ha_api.publish_card(CARD, CARD_FOLDER)
    config, status = read_dashboard(url_path)
    if status == "missing":
        ha_api.ws1({"type": "lovelace/dashboards/create", "url_path": url_path, "title": VIEW["title"],
                    "icon": VIEW.get("icon", "mdi:piggy-bank-outline"), "mode": "storage", "show_in_sidebar": True,
                    "require_admin": False})
        print("dashboard created:", url_path)
        config = {"views": []}
    else:
        backup = HERE / "backup" / f"dashboard-{url_path or 'overview'}-{date.today().isoformat()}-before-results.json"
        backup.parent.mkdir(exist_ok=True)
        if not backup.exists():
            backup.write_text(json.dumps(config, indent=1, ensure_ascii=False))
            print("backup:", backup)
    views_before = config.get("views") or []
    after, what = merged(views_before)
    show_diff(views_before, after)
    config["views"] = after
    ha_api.ws1({"type": "lovelace/config/save", "url_path": url_path, "config": config})
    print(f"{where}: {what}")
    check_resources(ha_api.ws1({"type": "lovelace/resources"}))
    print("done. Follow the test plan in results/LOGIC.md.")


if __name__ == "__main__":
    main()

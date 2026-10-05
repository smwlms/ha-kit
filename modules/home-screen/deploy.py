"""Deploy module 'home-screen': the card home-screen-card and the view "home" on a dashboard.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python home-screen/deploy.py [--dry-run [--live]] [--dashboard <url_path>]
                                                                      [--append]

Steps:
  1. uploads www/home-screen.js to /config/www/ha-kit/home-screen/ and registers it as dashboard resource
     /local/ha-kit/home-screen/home-screen.js?v=(VERSION in the file)
  2. reads the dashboard (default: the Overview; --dashboard <url_path>: another one, created when it does not exist;
     its url_path needs a hyphen, e.g. ha-kit-home), saves its config to backup/ and writes the view of
     lovelace/home.yaml: an existing view with the same path is replaced in place, otherwise the view is added as the
     FIRST view (the start screen; --append: as the last). Every other view stays exactly as it was.
  3. reports the resources the card needs from other modules (cw-thema.js of base; tesla-arrival-card.js of
     tesla-route when the arrival card is in the config)
  --dry-run  prints what it would do and a diff of the views; never connects to Home Assistant, so the diff is
             against an empty dashboard
  --live     with --dry-run: reads the dashboard and the resources (read-only, nothing is written) and prints the
             real diff against them; needs HA_URL and HA_TOKEN
Needs module base (cw-thema.js) and a dashboard in storage mode (the Overview: Edit dashboard > Take control first).
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

CARD = HERE / "www" / "home-screen.js"
CARD_FOLDER = "ha-kit/home-screen"  # phase-4 frontend rule: /config/www/ha-kit/<module>/
CARD_DST = f"{ha_api.CONFIG_DIR}/www/{CARD_FOLDER}/{CARD.name}"
CARD_URL = f"/local/{CARD_FOLDER}/{CARD.name}"
VIEW = yaml.safe_load((HERE / "lovelace" / "home.yaml").read_text(encoding="utf-8"))
# Resources of other modules the card uses when they are there (path without ?v=).
NEEDS = {"/local/cw-thema.js": "module base (cw-kop, cw-status, cw-metric, cw-toggles)"}
if VIEW["cards"][0].get("arrival"):
    NEEDS["/local/tesla-arrival-card.js"] = "module tesla-route (arrival card)"


def arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


def card_version() -> str:
    text = CARD.read_text(encoding="utf-8")
    return text.split('const VERSION = "', 1)[1].split('"', 1)[0]


def merged(views: list[dict], append: bool) -> tuple[list[dict], str]:
    """The views after writing ours: replace the view with the same path in place, else insert first (or last)."""
    out = [dict(v) for v in views]
    for i, v in enumerate(out):
        if v.get("path") == VIEW["path"]:
            out[i] = VIEW
            return out, f"view '{VIEW['path']}' exists (position {i + 1}): replaced in place"
    if append:
        return out + [VIEW], f"view '{VIEW['path']}' is new: added as the last view"
    return [VIEW] + out, f"view '{VIEW['path']}' is new: added as the first view (start screen)"


def compact(views: list[dict]) -> list[dict]:
    """Views for the diff: the texts of a home-screen-card (strings:, 200+ lines) as one line with a fingerprint."""
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
    """Which views stay untouched, and a unified diff of the whole views list (JSON, one key per line)."""
    before, after = compact(before), compact(after)
    paths_after = [v.get("path") or v.get("title") or f"#{i + 1}" for i, v in enumerate(after)]
    others = [p for p in paths_after if p != VIEW["path"]]
    print("  views after:", ", ".join(paths_after) or "-")
    print("  untouched:", ", ".join(others) or "none")
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


def main() -> None:
    url_path = arg("--dashboard")
    append = "--append" in sys.argv
    if url_path and "-" not in url_path:
        sys.exit(f"--dashboard {url_path}: the url_path of a dashboard needs a hyphen (Home Assistant rule), e.g. ha-kit-home")
    where = f"dashboard {url_path}" if url_path else "the Overview"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        print("  upload", CARD.relative_to(HERE.parent), "->", CARD_DST, f"+ resource {CARD_URL}?v={card_version()}")
        cfg = VIEW["cards"][0]
        on = sorted(k for k, v in cfg.get("features", {}).items() if v)
        print("  features on:", ", ".join(on) or "none")
        print("  roles:", ", ".join(f"{k}={v}" for k, v in sorted(cfg.get("roles", {}).items())))
        if "--live" in sys.argv:
            config, status = read_dashboard(url_path)
            if status == "missing":
                print(f"  {where} does not exist: it would be created (storage mode)")
            before = (config or {}).get("views") or []
            after, what = merged(before, append)
            print(f"  {where}: backup to backup/, then {what}")
            show_diff(before, after)
            check_resources(ha_api.ws1({"type": "lovelace/resources"}))
        else:
            after, what = merged([], append)
            print(f"  {where}: backup to backup/, then write the view (add --live for the diff against the real"
                  " dashboard, read-only)")
            show_diff([], after)
            print("  check resources:", ", ".join(NEEDS))
        return

    ha_api.publish_card(CARD, CARD_FOLDER)
    config, status = read_dashboard(url_path)
    if status == "missing":
        ha_api.ws1({"type": "lovelace/dashboards/create", "url_path": url_path, "title": VIEW["title"],
                    "icon": VIEW.get("icon", "mdi:home-outline"), "mode": "storage", "show_in_sidebar": True,
                    "require_admin": False})
        print("dashboard created:", url_path)
        config = {"views": []}
    else:
        backup = HERE / "backup" / f"dashboard-{url_path or 'overview'}-{date.today().isoformat()}-before-home.json"
        backup.parent.mkdir(exist_ok=True)
        if not backup.exists():
            backup.write_text(json.dumps(config, indent=1, ensure_ascii=False))
            print("backup:", backup)
    before = config.get("views") or []
    after, what = merged(before, append)
    show_diff(before, after)
    config["views"] = after
    ha_api.ws1({"type": "lovelace/config/save", "url_path": url_path, "config": config})
    print(f"{where}: {what}")
    check_resources(ha_api.ws1({"type": "lovelace/resources"}))
    print("done. Open the view and follow the test plan in home-screen/LOGIC.md.")


if __name__ == "__main__":
    main()

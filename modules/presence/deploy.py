<# Shared preamble (who and what this module follows): _presence.jinja in this folder. #>
<% from '_presence.jinja' import P, tracked, car_list, places, school, drop_offs, family, work, runs, calendar,
   stay_calendar, work_zone, windows, day_keys, day_names with context %>
<% set arrival_start = P.get('arrival_defaults') or {} %>
<% set arrival = {} %>
<% for k in day_keys %>
<% set _ = arrival.update({'input_datetime.arrival_' ~ day_names[loop.index0]: (arrival_start.get(k) or module.defaults.arrival[k]) | string}) %>
<% endfor %>
<% set schedules = [] %>
<% if school is not none %>
<% set _ = schedules.append({'entity': 'schedule.school_drop_off', 'name': t('schedule_drop_off'), 'icon': 'mdi:school', 'window': windows.drop_off}) %>
<% set _ = schedules.append({'entity': 'schedule.school_pick_up', 'name': t('schedule_pick_up'), 'icon': 'mdi:school-outline', 'window': windows.pick_up}) %>
<% endif %>
<% if family %>
<% set _ = schedules.append({'entity': 'schedule.family_pick_up', 'name': t('schedule_family'), 'icon': 'mdi:human-male-female-child', 'window': windows.family}) %>
<% endif %>
<% set zones = [] %>
<% for x in places %>
<% set _ = zones.append({'entity': 'zone.' ~ x.key, 'key': x.key, 'name': x.name, 'lat': x.get('lat'), 'lon': x.get('lon'), 'radius': x.get('radius') or module.defaults.radius[x.kind], 'passive': module.defaults.passive[x.kind]}) %>
<% endfor %>
<% set expected = {calendar: 'Local Calendar for the log', stay_calendar: 'Local Calendar for the stays', 'zone.home': 'home location'} %>
<% for p in tracked %>
<% set _ = expected.update({(p.get('person') or 'person.' ~ p.key): 'person ' ~ p.name, 'device_tracker.' ~ p.phone: 'phone of ' ~ p.name ~ ' (Companion app)'}) %>
<% endfor %>
<% for z in zones %>
<% set _ = expected.update({z.entity: 'zone "' ~ z.name ~ '"'}) %>
<% endfor %>
"""Deploy module 'presence' (Our week): helpers, command_line sensors, scripts on HA, automations, script, card.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python presence/deploy.py [--dry-run] [--setup] [--tab [--dashboard <path>]]

Steps:
  1. uploads package.yaml -> packages/presence.yaml, command_line/presence.yaml -> command_line/, and
     settings.py, stay.py, workday.py -> /config/presence/ (they read the recorder, SQLite only)
  2. checks the configuration, reloads input_datetime, input_number, input_text and command_line
  3. gives input_datetime.arrival_<day> its start value, once, only when the helper is new
  4. creates the schedules (school windows) as UI helpers when they do not exist yet; after that they are yours
     (Settings > Helpers). An existing schedule is never changed
  5. writes automations.yaml and scripts.yaml through the config API (same as the UI editors)
  6. uploads www/presence-card.js and registers it as dashboard resource /local/presence-card.js?v=(VERSION)
  7. checks the entities this module expects from the UI (calendars, persons, phones, zones) and only reports
  --setup  one-off: creates every zone of presence.places that does not exist yet and has lat/lon in house.yaml
           (name and radius from house.yaml; drop-off points passive). Existing zones are never changed
  --tab    adds (or updates) the view "<@ t('view_title') @>" (path our-week, panel) with lovelace/our-week.yaml to a
           dashboard in storage mode; the dashboard config is saved to backup/ first. --dashboard <url_path>: another
           dashboard than the Overview
  --dry-run  dry run: prints what it would do, does not connect to Home Assistant
Needs module base (packages/, command_line/ in configuration.yaml) and the HA defaults
automation: !include automations.yaml and script: !include scripts.yaml.
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

MODULE = "presence"
UPLOADS = [
    (HERE / "package.yaml", f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"),
    (HERE / "command_line" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/command_line/{MODULE}.yaml"),
] + [(HERE / name, f"{ha_api.CONFIG_DIR}/{MODULE}/{name}") for name in ("settings.py", "stay.py", "workday.py")]
RELOADS = ("input_datetime", "input_number", "input_text", "command_line")
CARD = HERE / "www" / "presence-card.js"
VIEW_PATH = "our-week"
VIEW_TITLE = <@ t('view_title') | tojson @>
# Start values, set once when the helper is new (house.yaml presence.arrival_defaults, else module.yaml).
ARRIVAL = json.loads(r'''<@ arrival | tojson @>''')
# Schedules made as UI helpers when missing: window per day "HH:MM-HH:MM" (or a list of those).
SCHEDULES = json.loads(r'''<@ schedules | tojson @>''')
# Zones of presence.places; --setup creates the missing ones that have lat/lon.
ZONES = json.loads(r'''<@ zones | tojson @>''')
# Entities this module expects from the UI (README.md, "What you do in the UI").
EXPECTED = json.loads(r'''<@ expected | tojson @>''')
DAYS = {"mon": "monday", "tue": "tuesday", "wed": "wednesday", "thu": "thursday", "fri": "friday", "sat": "saturday",
        "sun": "sunday"}


def schedule_days(window: dict) -> dict:
    """{"mon": "07:45-09:15", "wed": ["08:00-09:00", ...]} -> {"monday": [{"from": "07:45:00", "to": "09:15:00"}], ...}."""
    out = {}
    for day, value in (window or {}).items():
        if day not in DAYS:
            sys.exit(f"school_windows: unknown day '{day}' (use mon tue wed thu fri sat sun)")
        ranges = []
        for part in value if isinstance(value, list) else [value]:
            a, b = str(part).replace(" ", "").split("-")
            ranges.append({"from": f"{a.zfill(5)}:00", "to": f"{b.zfill(5)}:00"})
        out[DAYS[day]] = ranges
    return out


def setup_zones() -> None:
    have = ha_api.entity_ids()
    for z in ZONES:
        if z["entity"] in have:
            print(z["entity"], "exists already: not changed (move it or change its radius in Settings > Zones)")
            continue
        if z["lat"] is None or z["lon"] is None:
            print(f"{z['entity']} is missing and has no lat/lon in house.yaml: create the zone '{z['name']}' in the UI")
            continue
        zone = {"latitude": z["lat"], "longitude": z["lon"], "radius": z["radius"], "passive": z["passive"]}
        # Created under its key so the entity_id becomes zone.<key>, then renamed: the name is what the triggers see.
        created = ha_api.ws1({"type": "zone/create", "name": z["key"], **zone})
        ha_api.ws1({"type": "zone/update", "zone_id": created["id"], "name": z["name"], **zone})
        print(f"{z['entity']} created: {z['name']}, radius {z['radius']} m{', passive' if z['passive'] else ''}")


def create_schedules(before: set[str]) -> None:
    for s in SCHEDULES:
        if s["entity"] in before:
            print(s["entity"], "exists already: windows not changed")
            continue
        item = {"icon": s["icon"], **schedule_days(s["window"])}
        # Created under its id so the entity_id is the same in every language, then renamed to the name in the
        # install language (like the zones).
        created = ha_api.ws1({"type": "schedule/create", "name": s["entity"].split(".", 1)[1], **item})
        ha_api.ws1({"type": "schedule/update", "schedule_id": created["id"], "name": s["name"], **item})
        print("new:", s["entity"], s["window"])


def add_tab() -> None:
    card = yaml.safe_load((HERE / "lovelace" / "our-week.yaml").read_text())
    view = {"title": VIEW_TITLE, "path": VIEW_PATH, "icon": "mdi:calendar-week", "type": "panel", "cards": [card]}
    url_path = sys.argv[sys.argv.index("--dashboard") + 1] if "--dashboard" in sys.argv else None
    r = ha_api.ws([{"type": "lovelace/config", "url_path": url_path}])[0]
    if not r["success"]:
        sys.exit(f"dashboard not readable ({r.get('error')}). Take control of the dashboard in the UI first "
                 "(Edit > Take control) or pass --dashboard <url_path>.")
    config = r["result"]
    views = config.setdefault("views", [])
    if any(v.get("path") == VIEW_PATH for v in views):
        views[:] = [view if v.get("path") == VIEW_PATH else v for v in views]
        print(f"tab '{VIEW_PATH}' existed already: updated")
    else:
        backup = HERE / "backup" / f"dashboard-{url_path or 'overview'}-{date.today().isoformat()}-before-our-week.json"
        backup.parent.mkdir(exist_ok=True)
        if not backup.exists():
            backup.write_text(json.dumps(config, indent=1, ensure_ascii=False))
            print("backup:", backup)
        views.append(view)
        print(f"tab added: /{url_path or 'lovelace'}/{VIEW_PATH}")
    ha_api.ws1({"type": "lovelace/config/save", "url_path": url_path, "config": config})


def check_ui_entities() -> None:
    have = ha_api.entity_ids()
    missing = [f"{eid} ({why})" for eid, why in EXPECTED.items() if eid not in have]
    for line in missing:
        print("  missing:", line)
    if not missing:
        print("every expected entity exists")
    for e in ("sensor.presence_stays", "sensor.presence_workday"):
        try:
            st = ha_api.rest(f"/api/states/{e}")
            print(" ", e, "=", st["state"], "| error:", st["attributes"].get("error"))
        except urllib.error.HTTPError:
            print(" ", e, "does not exist (yet): check command_line/ in configuration.yaml (module base)")


def main() -> None:
    automations = HERE / "automations.yaml"
    scripts = HERE / "scripts.yaml"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        if "--setup" in sys.argv:
            for z in ZONES:
                where = "around house.yaml lat/lon" if z["lat"] is not None else "NO lat/lon: create it in the UI"
                print(f"  create zone when missing: {z['entity']} '{z['name']}', {z['radius']} m"
                      f"{', passive' if z['passive'] else ''} ({where})")
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config + reload", ", ".join(RELOADS))
        print("  start value for new helpers:", ", ".join(f"{k}={v}" for k, v in ARRIVAL.items()))
        for s in SCHEDULES:
            print(f"  create schedule when missing: {s['entity']} '{s['name']}' {schedule_days(s['window'])}")
        print("  config API: automations", ", ".join(a["id"] for a in yaml.safe_load(automations.read_text())))
        print("  config API: scripts", ", ".join(yaml.safe_load(scripts.read_text())))
        print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{CARD.name}",
              "+ resource /local/" + CARD.name)
        if "--tab" in sys.argv:
            print(f"  tab '{VIEW_TITLE}' ({VIEW_PATH}) on dashboard", sys.argv[sys.argv.index("--dashboard") + 1]
                  if "--dashboard" in sys.argv else "Overview", "(backup first)")
        print("  check entities:", ", ".join(EXPECTED))
        return

    if "--setup" in sys.argv:
        setup_zones()
    before = ha_api.entity_ids()
    editor = ha_api.FileEditor()
    for src, dst in UPLOADS:
        editor.save(src, dst)
    ha_api.check_config()
    for domain in RELOADS:
        ha_api.rest(f"/api/services/{domain}/reload", {})
        print("reloaded:", domain)
    ha_api.set_defaults(ARRIVAL, before)
    create_schedules(before)
    ha_api.push_automations_and_scripts(automations, scripts)
    ha_api.publish_card(CARD)
    if "--tab" in sys.argv:
        add_tab()
    check_ui_entities()
    print("done. Test script.presence_log first (test plan in presence/LOGIC.md).")


if __name__ == "__main__":
    main()

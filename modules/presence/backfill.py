"""Fill the Our week calendars afterwards from the recorder (which keeps ~10 days). Module presence of ha-kit.

Applies the rules of presence/automations.yaml to recorded positions, so the dashboard starts with about a
week of arrivals, working days, school runs and Supercharger sessions instead of nothing. Events get the source
"history (afterwards)" in the install language. Time at work comes from the usual driver's car in the work zone.
People, cars, places, calendars and texts come from settings.py (filled in from house.yaml); the zones themselves
are read from Home Assistant, so create them first. The school windows are read from the schedules in Home
Assistant (fallback: the start values in settings.WINDOWS).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python presence/backfill.py            # dry run: print what would be written
  uv run --with-requirements requirements.txt python presence/backfill.py --write    # write the events (skips ones already there)
  ... backfill.py --stays [--write] [--update]           # days -> stays calendar (--update rewrites existing days)
  ... backfill.py --workday [--write] [YYYY-MM-DD ...]   # appointments after work (workday.py) -> Work events
  Period: --from YYYY-MM-DD (default 11 days ago) and --to YYYY-MM-DD (default today).
  --no-osm  do not look up Supercharger names in OpenStreetMap (the Overpass API gets the charging position)

Events already in the calendar are recognised in every language of strings.yaml (same kind, same people, same
minute), so running it again after a language switch does not write them twice.

Known limits of recorded data (see presence/LOGIC.md):
- A phone whose app may use its location only "while using" sends hardly anything on the road; the usual
  driver's car is then the fallback.
- When zone.home lies away from where the cars park, phone fixes near home are sparse; a car arriving shortly
  before the phone's first fix at home gives the more precise time.
- The "family first, then school" and "already picked up today" rules of the live automation are not applied here.
"""
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import ha_api  # noqa: E402
import settings as cfg  # noqa: E402

TEXT = cfg.TEXT


def _arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


_today = datetime.now().astimezone()
START = datetime.fromisoformat(_arg("--from", (_today - timedelta(days=11)).strftime("%Y-%m-%d"))).astimezone().isoformat()
END = datetime.fromisoformat(_arg("--to", _today.strftime("%Y-%m-%d")) + "T23:59:00").astimezone().isoformat()

# From settings.py: car prefix -> (display name, key of the usual driver or ""); person key -> display name;
# person key -> phone trackers [(entity, valid from or None, valid until or None)].
CARS = {c["prefix"]: (c["name"], c["driver"]) for c in cfg.CARS}
CAR_ENT = {c["prefix"]: c for c in cfg.CARS}
NAME = {p["key"]: p["name"] for p in cfg.PEOPLE}
_KEY_OF = {p["name"]: p["key"] for p in cfg.PEOPLE}
PHONES = {}
for _ent, _name, _since, _until in cfg.TRACKERS:
    PHONES.setdefault(_KEY_OF[_name], []).append(
        (_ent, datetime.fromtimestamp(_since).astimezone() if _since else None,
         datetime.fromtimestamp(_until).astimezone() if _until else None))
# Zones, read from Home Assistant in load_zones(): centre (lat, lon) and radius in m.
HOME = None
WORK = {}
SCHOOL, SCHOOL_R = None, 150
DROP = {}
FAMILY = []  # [(zone name, centre, radius)]
# Windows per weekday (0 = Monday): [(from "HH:MM", to "HH:MM")], filled by load_windows().
DROP_OFF_WIN, PICK_UP_WIN, FAMILY_WIN = {}, {}, {}
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def load_zones():
    """Fill HOME, WORK, SCHOOL, DROP and FAMILY from the zones in Home Assistant."""
    global HOME, SCHOOL, SCHOOL_R
    z = {s["entity_id"]: s["attributes"] for s in api("/api/states") if s["entity_id"].startswith("zone.")}

    def centre(e):
        return (z[e]["latitude"], z[e]["longitude"]) if e in z else None

    HOME = centre("zone.home")
    for p in cfg.PEOPLE:
        if p["work_zone"] in z:
            WORK[p["key"]] = (centre(p["work_zone"]), z[p["work_zone"]].get("radius", 150))
    if cfg.SCHOOL in z:
        SCHOOL, SCHOOL_R = centre(cfg.SCHOOL), z[cfg.SCHOOL].get("radius", 150)
    for e, label in cfg.DROP.items():
        if e in z:
            DROP[label] = centre(e)
    for e, name in cfg.FAMILY.items():
        if e in z:
            FAMILY.append((name, centre(e), z[e].get("radius", 75)))
    missing = [e for e in [p["work_zone"] for p in cfg.PEOPLE if p["work_zone"]] + [cfg.SCHOOL] + list(cfg.DROP)
               + list(cfg.FAMILY) if e and e not in z]
    print("zones:", "home" if HOME else "NO home", "| work", list(WORK), "| school" if SCHOOL else "| no school",
          f"| drop-off points {list(DROP)}", f"| family {[f[0] for f in FAMILY]}")
    if missing:
        print("  missing in Home Assistant (those rules drop out):", ", ".join(missing))
    if not HOME:
        sys.exit("zone.home is missing")


def _ranges(value):
    """'07:45-09:15' or a list of those -> [("07:45", "09:15")]."""
    out = []
    for part in value if isinstance(value, list) else [value]:
        a, b = str(part).replace(" ", "").split("-")
        out.append((a[:5].zfill(5), b[:5].zfill(5)))
    return out


def load_windows():
    """The schedules as they are in Home Assistant now; the start values of settings.WINDOWS when missing."""
    fallback = {k: {DAYS.index(d): _ranges(v) for d, v in (cfg.WINDOWS.get(k) or {}).items()} for k in cfg.WINDOWS}
    have = {}
    r = ha_api.ws([{"type": "schedule/list"}])[0]
    for item in (r.get("result") or []) if r.get("success") else []:
        have[item.get("id")] = {i: [(x["from"][:5], x["to"][:5]) for x in item.get(day) or []]
                                for i, day in enumerate(WEEKDAYS)}
    for target, sid, key in ((DROP_OFF_WIN, "school_drop_off", "drop_off"), (PICK_UP_WIN, "school_pick_up", "pick_up"),
                             (FAMILY_WIN, "family_pick_up", "family")):
        target.update(have.get(sid) or fallback.get(key) or {})
        print(f"window {key}:", "from Home Assistant" if sid in have else "default from house.yaml")


def dist(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742000 * math.asin(math.sqrt(min(1, h)))


def api(path, body=None, method=None):
    return ha_api.rest(path, body, method, timeout=300)


def fixes(entity, since=None, until=None):
    q = urllib.parse.quote
    res = api(f"/api/history/period/{q(START)}?filter_entity_id={entity}&end_time={q(END)}&significant_changes_only=0")
    out = []
    for s in (res[0] if res else []):
        a = s["attributes"]
        if isinstance(a.get("latitude"), (int, float)):
            t = datetime.fromisoformat(s["last_updated"]).astimezone()
            if (since is None or t >= since) and (until is None or t < until):
                out.append((t, (a["latitude"], a["longitude"])))
    return out


def states(entity):
    """(time, state) of every recorded change, without attributes."""
    q = urllib.parse.quote
    res = api(f"/api/history/period/{q(START)}?filter_entity_id={entity}&end_time={q(END)}"
              "&minimal_response&significant_changes_only=0")
    return [(datetime.fromisoformat(s["last_changed"]).astimezone(), s["state"]) for s in (res[0] if res else [])]


def at(series, t):
    """Value of a (time, state) series at time t (last change at or before t)."""
    v = None
    for ts, st in series:
        if ts > t:
            break
        v = st
    return v


def supercharger_name(pos):
    """'Supercharger <place>' from OpenStreetMap (Tesla charging station within 250 m), else the text 'unknown'."""
    if "--no-osm" in sys.argv:
        return TEXT["unknown"]
    q = f'[out:json][timeout:25];nwr(around:250,{pos[0]},{pos[1]})["amenity"="charging_station"];out tags;'
    try:
        req = urllib.request.Request("https://overpass-api.de/api/interpreter",
                                     data=urllib.parse.urlencode({"data": q}).encode(),
                                     headers={"User-Agent": "ha-kit-presence-backfill"})
        for e in json.loads(urllib.request.urlopen(req, timeout=60).read())["elements"]:
            t = e.get("tags", {})
            if "tesla" in f"{t.get('brand', '')} {t.get('operator', '')}".lower():
                return "Supercharger " + t.get("name", "").replace("Supercharger", "").strip()
    except Exception:  # noqa: BLE001 - no name is fine
        pass
    return TEXT["unknown"]


def window(t, table):
    hm = t.strftime("%H:%M")
    return any(a <= hm < b for a, b in table.get(t.weekday(), []))


def visits(pts, centre, radius):
    """Consecutive fixes inside a circle: (first fix in, first fix out or None, fixes)."""
    out, cur = [], []
    for t, p in pts:
        if dist(p, centre) <= radius:
            cur.append((t, p))
        elif cur:
            out.append((cur[0][0], t, cur))
            cur = []
    if cur:
        out.append((cur[0][0], None, cur))
    return out


def arrivals(pts, car_homes):
    """Home arrivals from position fixes after >=10 min away; time = car arrival if one came home <=10 min before."""
    out, away_since, far = [], None, False
    for t, p in pts:
        d = dist(p, HOME)
        if d > 300:
            if away_since is None:
                away_since = t
            far = True
        if d <= 150 and far and away_since and (t - away_since) >= timedelta(minutes=10):
            car = max((c for c in car_homes if t - timedelta(minutes=10) <= c[0] <= t), default=None)
            out.append({"t": car[0] if car else t, "since": away_since, "car": car[1] if car else ""})
            away_since, far = None, False
        elif d <= 150:
            away_since, far = None, False
    return out


def riders_of(phone_pts, t0, t1, pos):
    """Keys of the people whose phone was within 300 m of pos between 10 min before t0 and t1."""
    return [k for k, pts in phone_pts.items()
            if any(t0 - timedelta(minutes=10) <= t <= t1 and dist(p, pos) < 300 for t, p in pts)]


def away_value(mins, since):
    """"2 h 5 min (since 03/10 08:10)" in the install language."""
    return TEXT["away_value"].replace("{duration}", cfg.duration(mins)).replace("{since}", f"{since:%d/%m %H:%M}")


def event_key(summary, start):
    """(kind, sorted names, minute) of a log event in any known language: the same event written in another
    language has the same key."""
    kind, names = cfg.parse_title(summary)
    return kind, tuple(sorted(cfg.split_names(names))), start[:16]


def stays(write):
    """Time-split store: every complete day in the recorder window up to the day before yesterday (the nightly
    automation writes yesterday itself) as an all-day event per person in the stays calendar."""
    import stay as v
    q = urllib.parse.quote
    fixes_ = {}
    for entity, person, since, until in v.TRACKERS:
        res = api(f"/api/history/period/{q(START)}?filter_entity_id={entity}&end_time={q(END)}&significant_changes_only=0")
        for s in (res[0] if res else []):
            a = s["attributes"]
            ts = datetime.fromisoformat(s["last_updated"]).timestamp()
            if (since and ts < since) or (until and ts >= until):
                continue
            if isinstance(a.get("latitude"), (int, float)):
                fixes_.setdefault(person, []).append((ts, a["latitude"], a["longitude"], a.get("gps_accuracy")))
    if not fixes_:
        sys.exit("no phone positions in the recorder for this period")
    for fs in fixes_.values():
        fs.sort()
    today = datetime.now(v.TZ).date()
    first = min(datetime.fromtimestamp(fs[0][0], v.TZ).date() for fs in fixes_.values()) + timedelta(days=1)
    # New days only up to the day before yesterday (the nightly automation writes yesterday); --update also
    # rewrites yesterday, which that automation may already have stored with another sleeping window.
    last = 0 if "--update" in sys.argv else 1
    days = {first + timedelta(days=i) for i in range((today - first).days - last)}
    per_day = v.cells_per_day(fixes_, days)
    existing = api(f"/api/calendars/{cfg.STAYS_CALENDAR}?start={q(START)}&end={q(END)}")
    have = {}
    for e in existing:
        kind, name = cfg.parse_title(e["summary"])
        if kind == "stay":
            have[(name, e["start"].get("date", ""))] = e
    update = "--update" in sys.argv
    updates = []
    for d, ppl in sorted(per_day.items()):
        for person, cells in ppl.items():
            enc = v.encode(cells)
            if not enc:
                continue
            key = (person, d.isoformat())
            spots = {c: m for c, m in cells.items() if c not in (v.TRIP, v.NIGHT_KEY)}
            mark = ("rewrite" if update and write else "exists") if key in have else ("write" if write else "new")
            if key in have and update and write and have[key].get("description") != enc:
                updates.append((have[key], enc))
            night = sum(cells.get(v.NIGHT_KEY, {}).values()) / 60
            # No coordinates in the output: they are personal; the calendar holds them.
            print(f"{mark:10} {d:%a %d/%m} {person:12} still {sum(spots.values()) / 60:5.1f} h in {len(spots):2} spots"
                  f" (night {night:4.1f} h) + on the road {cells.get(v.TRIP, 0) / 60:4.1f} h")
            if write and key not in have:
                api("/api/services/calendar/create_event", {
                    "entity_id": cfg.STAYS_CALENDAR, "summary": f"{TEXT['kind_stay']}: {person}", "description": enc,
                    "start_date": d.isoformat(), "end_date": (d + timedelta(days=1)).isoformat()})
    if updates:
        update_events(updates)


def update_events(updates):
    """Rewrite the description of existing all-day events (websocket calendar/event/update)."""
    msgs = [{"type": "calendar/event/update", "entity_id": cfg.STAYS_CALENDAR, "uid": e["uid"],
             "event": {"summary": e["summary"], "dtstart": e["start"]["date"], "dtend": e["end"]["date"],
                       "description": desc}} for e, desc in updates]
    for (e, _), r in zip(updates, ha_api.ws(msgs)):
        print("  updated", e["start"]["date"], e["summary"], r.get("success"), r.get("error") or "")


def workday_backfill(write):
    """Apply workday.workday() (appointments after leaving work) to the logged Work events the recorder still covers.
    A Work event that ends before the last appointment gets that departure as its end, with the work trip and the
    appointments in its description (rewritten in the install language)."""
    import workday

    only = [a for a in sys.argv if len(a) == 10 and a[4] == "-" and sys.argv[sys.argv.index(a) - 1] not in ("--from", "--to")]
    q = urllib.parse.quote

    def raw(entity):
        res = api(f"/api/history/period/{q(START)}?filter_entity_id={entity}&end_time={q(END)}&significant_changes_only=0")
        return [(datetime.fromisoformat(s["last_updated"]).timestamp(), s["state"], s["attributes"]) for s in (res[0] if res else [])]

    def positions(rows):
        return [(t, a["latitude"], a["longitude"], a.get("gps_accuracy")) for t, _, a in rows
                if isinstance(a.get("latitude"), (int, float))]

    phones = {}
    for k, ents in PHONES.items():
        for e, lo, hi in ents:
            phones.setdefault(NAME[k], []).extend(
                f for f in positions(raw(e))
                if (lo is None or f[0] >= lo.timestamp()) and (hi is None or f[0] < hi.timestamp()))
    cars = {c: positions(raw(c)) for c in workday.CARS}
    charging = {}
    for car, sensor in workday.CARS.items():
        start = None
        for t, state, _ in raw(sensor):
            if state == "charging" and start is None:
                start = t
            elif state != "charging" and start is not None:
                charging.setdefault(car, []).append((start, t))
                start = None
    zones = {s["entity_id"]: s["attributes"] for s in api("/api/states") if s["entity_id"].startswith("zone.")}
    for fs in [*phones.values(), *cars.values()]:
        fs.sort()
    evs = api(f"/api/calendars/{cfg.CALENDAR}?start={q(START)}&end={q(END)}")
    updates = []
    for e in evs:
        kind, person = cfg.parse_title(e["summary"])
        if kind != "work" or (only and e["start"]["dateTime"][:10] not in only):
            continue
        if person not in workday.WORK_ZONE:
            continue
        t0, t1 = (datetime.fromisoformat(e[k]["dateTime"]) for k in ("start", "end"))
        w = workday.workday(phones.get(person, []), cars, charging, zones, person, t0.date(), now=datetime.now().timestamp())
        print(f"{t0:%a %d/%m} {person}: work {t0:%H:%M}-{t1:%H:%M}", "->",
              w and {k: (workday.hhmm(v) if k.endswith("_ts") and v else v) for k, v in w.items()})
        if not w or not w["end_ts"] or w["end_ts"] <= t1.timestamp() + 60:
            continue
        end = datetime.fromtimestamp(w["end_ts"]).astimezone()
        mins = int((end - t0).total_seconds() // 60)
        det = cfg.parse_details(e.get("description"))
        trips = ", ".join(filter(None, [det.get("work_trips"), f"{t1:%H:%M}-{end:%H:%M}"]))
        det.update({"departure": f"{end:%H:%M}", "duration": cfg.duration(mins), "work_trips": trips,
                    "appointments": w["appointments"]})
        updates.append((e, end, cfg.format_details(det)))
    for e, end, desc in updates:
        print(f"  {'update' if write else 'would update'}: {e['summary']} {e['start']['dateTime'][:10]} end -> {end:%H:%M}\n    "
              + desc.replace("\n", "\n    "))
    if write and updates:
        update_timed_events(updates)


def update_timed_events(updates):
    """Rewrite the end and description of existing timed events in the log calendar."""
    msgs = [{"type": "calendar/event/update", "entity_id": cfg.CALENDAR, "uid": e["uid"],
             "event": {"summary": e["summary"], "dtstart": e["start"]["dateTime"], "dtend": end.isoformat(),
                       "description": desc}} for e, end, desc in updates]
    for (e, _, _), r in zip(updates, ha_api.ws(msgs)):
        print("  updated", e["summary"], e["start"]["dateTime"][:16], r.get("success"), r.get("error") or "")


def main():
    write = "--write" in sys.argv
    print(f"period {START[:10]} to {END[:10]}")
    if "--stays" in sys.argv:
        return stays(write)
    if "--workday" in sys.argv:
        return workday_backfill(write)
    load_zones()
    load_windows()
    car_pts = {c: fixes(CAR_ENT[c]["location"]) for c in CARS}
    phone_pts = {k: sorted(sum((fixes(e, a, b) for e, a, b in v), [])) for k, v in PHONES.items()}
    car_homes = [(v[0], CARS[c][0]) for c, pts in car_pts.items() for v in visits(pts, HOME, 100)]
    # (kind, [names], start, end, {canonical detail key: value})
    events = []

    # Arrivals: phones first; the person's usual car as fallback for work days their phone missed.
    for k, pts in phone_pts.items():
        for a in arrivals(pts, car_homes):
            wz, wr = WORK.get(k, ((0, 0), -1))
            from_work = any(dist(p, wz) <= wr for t, p in pts if a["since"] <= t <= a["t"])
            mins = int((a["t"] - a["since"]).total_seconds() // 60)
            det = {"away": away_value(mins, a["since"])}
            if a["car"]:
                det["car"] = a["car"]
            det["source"] = TEXT["src_history_phone"]
            events.append(("home_from_work" if from_work else "home", [NAME[k]], a["t"], a["t"] + timedelta(minutes=1), det))
    for c, (car_name, k) in CARS.items():
        if k not in WORK:
            continue  # no usual driver, or the driver has no work zone
        pts = car_pts[c]
        for a in arrivals(pts, []):
            if any(e[1] == [NAME[k]] and abs((e[2] - a["t"]).total_seconds()) < 1800 for e in events):
                continue  # the phone already logged this arrival
            wz, wr = WORK[k]
            if not any(dist(p, wz) <= wr for t, p in pts if a["since"] <= t <= a["t"]):
                continue  # the car only fills in work days the phone missed
            mins = int((a["t"] - a["since"]).total_seconds() // 60)
            events.append(("home_from_work", [NAME[k]], a["t"], a["t"] + timedelta(minutes=1),
                           {"away": away_value(mins, a["since"]), "car": car_name,
                            "source": TEXT["src_history_driver_car"]}))

    # Time at work: the usual driver's car parked in their work zone (the car is the precise clock here; the
    # phones reported only every few minutes). One event per stay, 10 min to 16 h, like the live automation.
    for c, (car_name, k) in CARS.items():
        if k not in WORK:
            continue
        wz, wr = WORK[k]
        for t_in, t_out, _ in visits(car_pts[c], wz, wr):
            if t_out is None or not timedelta(minutes=10) <= t_out - t_in <= timedelta(hours=16):
                continue
            mins = int((t_out - t_in).total_seconds() // 60)
            events.append(("work", [NAME[k]], t_in, t_out,
                           {"duration": cfg.duration(mins),
                            "source": TEXT["src_history_car_at_work"].replace("{car}", car_name)}))

    # School runs: a Tesla >= 2 min in the school zone during a window, within 100 m of a drop-off point (if any).
    for c, (car_name, usual) in (CARS.items() if SCHOOL else []):
        for t_in, t_out, inside in visits(car_pts[c], SCHOOL, SCHOOL_R):
            if t_out is None or (t_out - t_in) < timedelta(minutes=2):
                continue
            kind = "drop_off" if window(t_in, DROP_OFF_WIN) else "pick_up" if window(t_in, PICK_UP_WIN) else None
            if not kind:
                continue
            if DROP:
                near = min(((min(dist(p, d) for _, p in inside), n) for n, d in DROP.items()))
                if near[0] > 100:
                    continue
            else:
                near = (min(dist(p, SCHOOL) for _, p in inside), cfg.SCHOOL_NAME)
            riders = riders_of(phone_pts, t_in, t_out, inside[-1][1])
            who, src = (riders, TEXT["src_phone_with_car"]) if riders else ([usual] if usual else [], TEXT["src_usual_driver"])
            if not who:
                continue
            events.append((kind, [NAME[k] for k in who], t_in, t_out,
                           {"place": f"{near[1]} ({near[0]:.0f} m)", "car": car_name,
                            "source": TEXT["src_history_source"].replace("{source}", src)}))

    # Picking up at family: a Tesla >= 2 min in a family zone during the family window. When the house is on the
    # daily route, passing takes < 1 min.
    for name, centre, radius in FAMILY:
        for c, (car_name, usual) in CARS.items():
            for t_in, t_out, inside in visits(car_pts[c], centre, radius):
                if t_out is None or (t_out - t_in) < timedelta(minutes=2) or not window(t_in, FAMILY_WIN):
                    continue
                riders = riders_of(phone_pts, t_in, t_out, inside[-1][1])
                who, src = (riders, TEXT["src_phone_with_car"]) if riders else ([usual] if usual else [], TEXT["src_usual_driver"])
                if not who:
                    continue
                near = min(dist(p, centre) for _, p in inside)
                events.append(("pick_up", [NAME[k] for k in who], t_in, t_out,
                               {"place": f"{TEXT['place_at_family'].replace('{zone}', name)} ({near:.0f} m)",
                                "car": car_name, "source": TEXT["src_history_source"].replace("{source}", src)}))

    # Supercharger sessions, as the live automation: charging > 300 m from home, battery rising >= 20 %/h, >= 5 min.
    for c, (car_name, usual) in CARS.items():
        charge, soc = states(CAR_ENT[c]["charging_state"]), states(CAR_ENT[c]["battery"])
        soc = [(t, float(v)) for t, v in soc if v not in ("unknown", "unavailable")]
        start = None
        for i, (t, st) in enumerate(charge):
            if st == "charging" and start is None:
                pos = at(car_pts[c], t)
                if pos and dist(pos, HOME) > 300:
                    start = t
            elif st == "disconnected" and start is not None and charge[i - 1][1] not in ("unknown", "unavailable"):
                end = charge[i - 1][0] if charge[i - 1][1] != "charging" else t
                s0, s1 = at(soc, start), at(soc, end)
                mins = int((end - start).total_seconds() // 60)
                rate = (s1 - s0) / max(mins, 1) * 60 if s0 is not None and s1 is not None else 0
                if mins >= 5 and rate >= 20:
                    pos = at(car_pts[c], start)
                    who = riders_of(phone_pts, start, end, pos) or ([usual] if usual else [])
                    events.append(("charge", [NAME[k] for k in who] or [TEXT["unknown"]], start, end,
                                   {"place": supercharger_name(pos), "location": f"{pos[0]:.5f}, {pos[1]:.5f}",
                                    "car": car_name, "battery": f"{s0:.0f} → {s1:.0f} %",
                                    "duration": cfg.duration(mins), "source": TEXT["src_history"]}))
                start = None

    events.sort(key=lambda e: e[2])
    q = urllib.parse.quote
    have = api(f"/api/calendars/{cfg.CALENDAR}?start={q(START)}&end={q(END)}")
    seen = {event_key(e["summary"], e["start"].get("dateTime", "")) for e in have}
    for kind, who, t0, t1, det in events:
        summary = cfg.title(kind, who)
        mark = "exists" if event_key(summary, t0.isoformat()) in seen else ("write" if write else "new")
        print(f"{mark:8} {t0:%a %d/%m %H:%M}  {summary:24} | {' · '.join(f'{k}: {v}' for k, v in det.items() if k != 'location')}")
        if mark == "write":
            api("/api/services/calendar/create_event", {
                "entity_id": cfg.CALENDAR, "summary": summary, "description": cfg.format_details(det),
                "start_date_time": t0.isoformat(timespec="seconds"), "end_date_time": t1.isoformat(timespec="seconds")})


if __name__ == "__main__":
    main()

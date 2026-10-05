#!/usr/bin/env python3
"""Appointments after leaving work: the end of the working day when the way home passes by appointments.

Leaving work for appointments and only then driving home is still work (a work trip), just like leaving work
and coming back. The working day then ends when the person leaves the last appointment.

Runs as a Home Assistant command_line sensor (read-only on the recorder database, stdlib only):
    python3 /config/presence/workday.py [YYYY-MM-DD, default today]
Prints {"state": "<date>", "people": {"<name>": {"left_work_ts": ..., "end_ts": ... or null,
"appointments": "13:59-14:44, 15:13-18:11"}}}. The automation presence_workday refreshes it when it closes a
working day and uses end_ts as the departure. backfill.py --workday imports workday() for past days.

Rule, per person, on the positions of the phone plus the Tesla that was parked in that person's work zone that day:
- leaving work = the last fix in the own work zone that day; getting home = the first fix in zone.home after that
  (not home yet: up to now);
- a stop = consecutive fixes within 150 m of the first one, at least 10 min long and followed by a move;
- an appointment = a stop that starts before 20:00, lies outside every zone (+30 m: home, school, family, work…) and
  does not overlap a charging session of that car (a Supercharger stop on the way is not an appointment).
"""
import json
import sqlite3
import sys
import time
from datetime import date, datetime

from settings import CARS as _CARS
from settings import PEOPLE
from stay import DB, MAX_ACC, TRACKERS, TZ, dist_m

STOP_M = 150
MIN_STOP_S = 10 * 60
ZONE_MARGIN_M = 30
LAST_START = (20, 0)  # a stop that starts later is an evening out, not an appointment
# Person name (as in the calendar and in TRACKERS) → their work zone (from house.yaml, presence.places).
WORK_ZONE = {p["name"]: p["work_zone"] for p in PEOPLE if p["work_zone"]}
# Car tracker → its charging sensor (a charging stop on the way home is not an appointment).
CARS = {c["location"]: c["charging_state"] for c in _CARS}


def hhmm(ts):
    return datetime.fromtimestamp(ts, TZ).strftime("%H:%M")


def inside(pos, zone, margin=0):
    return dist_m(pos, (zone["latitude"], zone["longitude"])) <= (zone.get("radius") or 100) + margin


def stops(fs):
    """[(start, end, lat, lon)] of every stop in fixes [(ts, lat, lon)], the last one only if followed by a move."""
    out, i = [], 0
    while i < len(fs):
        j = i
        while j + 1 < len(fs) and dist_m(fs[i][1:3], fs[j + 1][1:3]) <= STOP_M:
            j += 1
        if j + 1 < len(fs) and fs[j][0] - fs[i][0] >= MIN_STOP_S:
            out.append((fs[i][0], fs[j][0], fs[i][1], fs[i][2]))
        i = j + 1
    return out


def workday(phone, cars, charging, zones, person, day, now=None):
    """phone: [(ts, lat, lon, acc)]; cars: {car: [(ts, lat, lon, acc)]}; charging: {car: [(from, to)]};
    zones: {"zone.x": {latitude, longitude, radius}}. Returns the dict described above, or None (not at work)."""
    work, home = zones.get(WORK_ZONE[person]), zones.get("zone.home")
    if not work or not home:
        return None
    d0 = datetime(day.year, day.month, day.day, tzinfo=TZ).timestamp()
    d1 = min(d0 + 86400, now or time.time())

    def in_day(fs):
        return [f[:3] for f in fs if d0 <= f[0] < d1 and (f[3] is None or f[3] <= MAX_ACC)]

    # The car parked at this person's work today travels with them; a phone alone sends too few fixes on the road.
    used = [c for c, fs in cars.items() if any(inside(f[1:3], work) for f in in_day(fs))]
    fs = sorted(in_day(phone) + [f for c in used for f in in_day(cars[c])])
    at_work = [f[0] for f in fs if inside(f[1:3], work)]
    if not at_work:
        return None
    left = at_work[-1]
    home_at = next((f[0] for f in fs if f[0] > left and inside(f[1:3], home, 50)), d1)
    last_start = datetime(day.year, day.month, day.day, *LAST_START, tzinfo=TZ).timestamp()
    appts = [
        (a, b) for a, b, la, lo in stops([f for f in fs if left < f[0] <= home_at])
        if a <= last_start
        and not any(inside((la, lo), z, ZONE_MARGIN_M) for z in zones.values())
        and not any(p < b and a < q for c in used for p, q in charging.get(c, []))
    ]
    return {
        "left_work_ts": left,
        "end_ts": appts[-1][1] if appts else None,
        "appointments": ", ".join(f"{hhmm(a)}-{hhmm(b)}" for a, b in appts),
    }


def load(day):
    con = sqlite3.connect(DB, uri=True, timeout=10)
    cur = con.cursor()
    since = datetime(day.year, day.month, day.day, tzinfo=TZ).timestamp() - 3600
    until = since + 86400 + 7200

    def rows(entity, attrs=True):
        cur.execute(
            "SELECT s.last_updated_ts, s.state, a.shared_attrs FROM states s JOIN states_meta m ON s.metadata_id = m.metadata_id "
            "LEFT JOIN state_attributes a ON s.attributes_id = a.attributes_id "
            "WHERE m.entity_id = ? AND s.last_updated_ts >= ? AND s.last_updated_ts < ? ORDER BY s.last_updated_ts",
            (entity, since, until),
        )
        for ts, state, a in cur.fetchall():
            try:
                yield ts, state, json.loads(a or "{}") if attrs else {}
            except ValueError:
                continue

    def positions(entity, lo=None, hi=None):
        return [(ts, a["latitude"], a["longitude"], a.get("gps_accuracy")) for ts, _, a in rows(entity)
                if isinstance(a.get("latitude"), (int, float)) and (lo is None or ts >= lo) and (hi is None or ts < hi)]

    phones = {}
    for entity, person, lo, hi in TRACKERS:
        phones.setdefault(person, []).extend(positions(entity, lo, hi))
    cars = {c: positions(c) for c in CARS}
    charging = {}
    for car, sensor in CARS.items():
        start = None
        for ts, state, _ in rows(sensor, attrs=False):
            if state == "charging" and start is None:
                start = ts
            elif state != "charging" and start is not None:
                charging.setdefault(car, []).append((start, ts))
                start = None
        if start is not None:
            charging.setdefault(car, []).append((start, until))
    # Latest attributes of every zone.
    cur.execute(
        "SELECT m.entity_id, a.shared_attrs FROM states s JOIN states_meta m ON s.metadata_id = m.metadata_id "
        "LEFT JOIN state_attributes a ON s.attributes_id = a.attributes_id WHERE m.entity_id LIKE 'zone.%' "
        "AND s.last_updated_ts = (SELECT MAX(s2.last_updated_ts) FROM states s2 WHERE s2.metadata_id = s.metadata_id)"
    )
    zones = {}
    for entity, a in cur.fetchall():
        a = json.loads(a or "{}")
        if isinstance(a.get("latitude"), (int, float)):
            zones[entity] = {"latitude": a["latitude"], "longitude": a["longitude"], "radius": a.get("radius")}
    con.close()
    for fs in [*phones.values(), *cars.values()]:
        fs.sort()
    return phones, cars, charging, zones


def main():
    day = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(TZ).date()
    try:
        phones, cars, charging, zones = load(day)
        result = {"state": day.isoformat(), "people": {}}
        for person in WORK_ZONE:
            w = workday(phones.get(person, []), cars, charging, zones, person, day)
            if w:
                result["people"][person] = w
    except Exception as e:  # noqa: BLE001 - a command_line sensor must always print JSON
        result = {"state": None, "people": {}, "error": str(e)[:200]}
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()

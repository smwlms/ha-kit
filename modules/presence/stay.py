#!/usr/bin/env python3
"""Where did each person stay, per day: minutes per ~100 m spot, from the phones' recorded positions.

Runs as a Home Assistant command_line sensor (read-only on the recorder database, stdlib only):
    python3 /config/presence/stay.py [<days back, default 3>]
Prints one JSON object: {"state": <last complete day>, "days": {"YYYY-MM-DD": {"<name>": "<description>", ...}}}
with <description> = "spots: 51.234,4.567=812;51.240,4.570=35\non the road: 95\nnight: 51.234,4.567=450" in the
install language (spot = lat/lon rounded to 3 decimals, minutes as integers; the coordinates here are made up).
The automation presence_stays writes each day/person as an event in the stays calendar (settings.STAYS_CALENDAR),
which keeps them for good (the recorder keeps ~10 days). "Where we spend our time" on the "Our week" tab reads that
calendar and sorts the spots into asleep / home / work / elsewhere. "night" holds the part of each spot's minutes in
the sleeping window (settings.NIGHT_START-NIGHT_END, from house.yaml presence.sleep_window); at home that is shown
as asleep.

Rule (the same as dayCells() in www/presence-card.js), per pair of consecutive position fixes:
- stay: the next fix lies within 150 m, or the phone moved slower than 2 km/h (it stood still, then left: iOS
  sends the next fix only when leaving). The whole gap counts for the first fix's spot, at most 16 h;
- otherwise on the road: the gap counts as travel time, at most 3 h.
Fixes less precise than 200 m are skipped. Time across midnight is split over both days.
backfill.py imports cells_per_day() to fill the days before this ran.
"""
import json
import math
import sqlite3
import sys
from datetime import datetime, timedelta

# House settings (people, phones, time zone, sleeping window, database, texts), filled in from house.yaml.
from settings import DB, NIGHT_END, NIGHT_START, TEXT, TRACKERS, TZ  # noqa: F401 - workday.py and backfill.py import these from here

STAY_M = 150
STILL_MS = 2 / 3.6  # slower than 2 km/h = standing still
MAX_STAY_MIN = 16 * 60
MAX_TRIP_MIN = 3 * 60
MAX_ACC = 200
TRIP = "travel"  # key for travel minutes next to the spots
NIGHT_KEY = "night"  # {spot: minutes between NIGHT_START and NIGHT_END}


def dist_m(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742000 * math.asin(math.sqrt(min(1, h)))


def night_overlap(a, b, day):
    """Seconds of [a, b) (timestamps within local day `day`) that fall in 00:00–NIGHT_END or NIGHT_START–24:00."""
    d0 = datetime(day.year, day.month, day.day, tzinfo=TZ)
    windows = [(d0, d0.replace(hour=NIGHT_END[0], minute=NIGHT_END[1])),
               (d0.replace(hour=NIGHT_START[0], minute=NIGHT_START[1]), d0 + timedelta(days=1))]
    return sum(max(0, min(b, w1.timestamp()) - max(a, w0.timestamp())) for w0, w1 in windows)


def cells_per_day(fixes, days):
    """fixes: {person: [(ts, lat, lon, accuracy), ...]} sorted by ts; days: set of date.
    Returns {date: {person: {"lat,lon": minutes, ..., "travel": minutes, "night": {"lat,lon": minutes}}}}."""
    out = {}
    for person, fs in fixes.items():
        fs = [f for f in fs if f[3] is None or f[3] <= MAX_ACC]
        for i in range(len(fs) - 1):  # the last fix has no end yet
            t, la, lo, _ = fs[i]
            t2, la2, lo2, _ = fs[i + 1]
            if t2 <= t:
                continue
            d = dist_m((la, lo), (la2, lo2))
            still = d <= STAY_M or d / (t2 - t) < STILL_MS
            key = f"{la:.3f},{lo:.3f}" if still else TRIP
            end = min(t2, t + (MAX_STAY_MIN if still else MAX_TRIP_MIN) * 60)
            # Split over the local days it covers.
            cur = t
            while cur < end:
                day = datetime.fromtimestamp(cur, TZ).date()
                midnight = datetime(day.year, day.month, day.day, tzinfo=TZ) + timedelta(days=1)
                part_end = min(end, midnight.timestamp())
                if day in days:
                    cells = out.setdefault(day, {}).setdefault(person, {})
                    cells[key] = cells.get(key, 0) + (part_end - cur) / 60
                    if still:
                        night = night_overlap(cur, part_end, day) / 60
                        if night > 0:
                            n = cells.setdefault(NIGHT_KEY, {})
                            n[key] = n.get(key, 0) + night
                cur = part_end
    return out


def encode(cells):
    """{"lat,lon": minutes, "travel": minutes, "night": {...}} → calendar description (install language), biggest
    spot first."""
    def join(d):
        return ";".join(f"{c}={round(m)}" for c, m in sorted(d.items(), key=lambda x: -x[1]) if round(m) > 0)
    spots = join({c: m for c, m in cells.items() if c not in (TRIP, NIGHT_KEY)})
    if not spots and not cells.get(TRIP):
        return ""
    return (f"{TEXT['stay_spots']}: {spots}\n{TEXT['stay_travel']}: {round(cells.get(TRIP, 0))}\n"
            f"{TEXT['stay_night']}: {join(cells.get(NIGHT_KEY, {}))}")


def load_fixes(since_ts):
    con = sqlite3.connect(DB, uri=True, timeout=10)
    cur = con.cursor()
    fixes = {}
    for entity, person, since, until in TRACKERS:
        cur.execute(
            "SELECT s.last_updated_ts, a.shared_attrs FROM states s JOIN states_meta m ON s.metadata_id = m.metadata_id "
            "LEFT JOIN state_attributes a ON s.attributes_id = a.attributes_id "
            "WHERE m.entity_id = ? AND s.last_updated_ts >= ? ORDER BY s.last_updated_ts",
            (entity, since_ts),
        )
        for ts, attrs in cur.fetchall():
            if (since and ts < since) or (until and ts >= until):
                continue
            try:
                a = json.loads(attrs or "{}")
            except ValueError:
                continue
            if isinstance(a.get("latitude"), (int, float)) and isinstance(a.get("longitude"), (int, float)):
                fixes.setdefault(person, []).append((ts, a["latitude"], a["longitude"], a.get("gps_accuracy")))
    con.close()
    for fs in fixes.values():
        fs.sort()
    return fixes


def main():
    back = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    today = datetime.now(TZ).date()
    days = {today - timedelta(days=i) for i in range(1, back + 1)}
    first = min(days)
    # Start a day earlier: a stay that began the evening before still covers the first day.
    since = datetime(first.year, first.month, first.day, tzinfo=TZ).timestamp() - 86400
    try:
        per_day = cells_per_day(load_fixes(since), days)
        result = {
            "state": (today - timedelta(days=1)).isoformat(),
            "days": {d.isoformat(): {p: encode(c) for p, c in ppl.items() if encode(c)} for d, ppl in sorted(per_day.items())},
        }
    except Exception as e:  # noqa: BLE001 - a command_line sensor must always print JSON
        result = {"state": None, "days": {}, "error": str(e)[:200]}
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Solar day plan: how much solar energy is left today after the house and the home battery (energy-plan module).

Runs as a Home Assistant command_line sensor (sensor.energy_plan_margin), read-only on the recorder database
(SQLite), standard library only. Every entity id, the coordinates and the battery size come in as arguments, rendered
from house.yaml by tools/fill.py (see command_line/energy_plan.yaml):

    python3 /config/energy-plan/energy_plan.py --tz Europe/Brussels --lat 52.37 --lon 5.22 \
        --pv sensor.solar_power --import sensor.grid_import --export sensor.grid_export \
        [--battery-power sensor.battery_power --battery-sign discharge_positive] \
        [--usable-kwh 5 --soc 54] [--house sensor.house_power] [--car sensor.ev_charger_power] \
        [--forecast-remaining 6.1 --forecast-today 14.2 [--forecast-updated 1790000000]] \
        [--sun-end-w 150] [--charge-efficiency 0.95] [--days 10] [--db PATH] [--now ISO]

Prints one JSON object; its "state" is the margin in kWh (null on an error, then "error" says why). The model, in
short (LOGIC.md, "The battery-full model", has every step):
- sun end: the moment solar power drops below --sun-end-w, learned per day of the 5-minute statistics as an offset to
  the astronomical sunset (trees and roofs shade the panels earlier); the median offset is added to today's sunset;
- solar left today: (a) history: today's solar so far x the median after/before ratio at this time of day, capped at
  1.3 x the best afternoon of the history; (b) forecast: the remaining forecast scaled by today's actual/forecast
  ratio, minus the solar produced since the forecast's last refresh (the free Forecast.Solar refreshes once an hour);
  the LOWER of the two is used (the forecast sees clouds but not the shade, the history the reverse);
- house left today: the median house consumption (without the car) between this time of day and each day's sun end;
- battery needed: (100 - SoC) % x usable kWh / charge efficiency (0 without a battery);
- margin = solar left - house left - battery needed. After the sun end it is -battery needed (always a number: Home
  Assistant rejects a non-numeric state on a sensor with a unit).
"""
import argparse
import json
import math
import sqlite3
import statistics
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

DB = "/config/home-assistant_v2.db"
SLOT_S = 300                 # short-term statistics: one mean per 5 minutes
SLOT_H = SLOT_S / 3600
SLOTS_PER_DAY = 288
MIN_SLOTS = 240              # a history day with fewer PV slots (gaps, restarts) is skipped
MIN_BEFORE_KWH = 0.3         # a history day needs this much solar before now to give an after/before ratio
MIN_SO_FAR_KWH = 0.5         # below this much solar today the ratio is not trusted: typical afternoon instead
HISTORY_CAP = 1.3            # the history estimate never exceeds 1.3 x the best afternoon of the history
FACTOR_RANGE = (0.5, 1.5)    # bounds of the actual/forecast correction
FORECAST_MIN_SO_FAR = 1.0    # kWh of forecast before now needed before the correction is trusted
FULL_PERCENT = 100.0


class Parser(argparse.ArgumentParser):
    """Argument errors become a JSON error, so the sensor shows the reason instead of a parse failure."""

    def error(self, message):
        print(json.dumps({"state": None, "error": f"arguments: {message}"}))
        sys.exit(0)


def number(text):
    """float, or None for anything that is not a number (unknown, unavailable, none, '')."""
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def parse_args(argv):
    p = Parser(description=__doc__.splitlines()[0])
    p.add_argument("--tz", required=True)
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--pv", required=True, help="statistic id of the solar power")
    p.add_argument("--import", dest="imp", required=True, help="statistic id of the grid import power")
    p.add_argument("--export", dest="exp", required=True, help="statistic id of the grid export power")
    p.add_argument("--battery-power", help="statistic id of the battery power")
    p.add_argument("--battery-sign", choices=["charge_positive", "discharge_positive"], default="discharge_positive")
    p.add_argument("--house", help="statistic id of the house consumption (instead of computing it)")
    p.add_argument("--car", help="statistic id of the charger power, left out of the house consumption")
    p.add_argument("--usable-kwh", type=number, help="usable battery capacity; empty = no battery")
    p.add_argument("--soc", type=number, help="battery state of charge in %%")
    p.add_argument("--forecast-remaining", type=number, help="kWh of solar forecast still to come today")
    p.add_argument("--forecast-today", type=number, help="kWh of solar forecast for the whole of today")
    p.add_argument("--forecast-updated", type=number, help="unix time of the forecast's last refresh")
    p.add_argument("--sun-end-w", type=float, default=150.0)
    p.add_argument("--charge-efficiency", type=float, default=0.95)
    p.add_argument("--days", type=int, default=10)
    p.add_argument("--db", default=DB)
    p.add_argument("--now", help="ISO time instead of the clock (tests)")
    return p.parse_args(argv)


def sunset(d, lat, lon, tz):
    """Local sunset of date d (NOAA approximation, zenith 90.833 deg) as an aware datetime."""
    n = d.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    phi = math.radians(lat)
    cos_ha = math.cos(math.radians(90.833)) / (math.cos(phi) * math.cos(decl)) - math.tan(phi) * math.tan(decl)
    ha = math.degrees(math.acos(max(-1.0, min(1.0, cos_ha))))
    minutes_utc = 720 - 4 * (lon - ha) - eqt
    base = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    return (base + timedelta(minutes=minutes_utc)).astimezone(tz)


def load_series(db, ids, since_ts):
    """{key: {slot_start_ts: watt}} from the recorder's statistics_short_term (5-minute means), in W.
    A statistic that does not exist gives an empty series (reported in "missing")."""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
    try:
        cur = con.cursor()
        out, missing = {}, []
        for key, sid in ids.items():
            cur.execute("SELECT id, unit_of_measurement FROM statistics_meta WHERE statistic_id=?", (sid,))
            row = cur.fetchone()
            if not row:
                out[key] = {}
                missing.append(sid)
                continue
            mult = 1000.0 if (row[1] or "").lower() == "kw" else 1.0
            cur.execute("SELECT start_ts, mean FROM statistics_short_term WHERE metadata_id=? AND start_ts>=?",
                        (row[0], since_ts))
            out[key] = {int(t): (m or 0.0) * mult for t, m in cur.fetchall()}
        return out, missing
    finally:
        con.close()


def day_profile(series, d, tz, discharge_factor):
    """Per 5-minute slot of local day d: (slot start, solar W, house W without the car or None).
    Slots without a solar value are skipped."""
    start = datetime(d.year, d.month, d.day, tzinfo=tz)
    pv_s, car_s = series["pv"], series.get("car", {})
    rows = []
    for i in range(SLOTS_PER_DAY):
        t = start + timedelta(seconds=SLOT_S * i)
        ts = int(t.timestamp())
        if ts not in pv_s:
            continue
        pv = max(pv_s[ts], 0.0)
        house = None
        if "house" in series:
            if ts in series["house"]:
                house = series["house"][ts]
        else:
            imp, exp = series["imp"].get(ts), series["exp"].get(ts)
            if imp is not None and exp is not None:
                house = imp - exp + pv + discharge_factor * series.get("bat", {}).get(ts, 0.0)
        if house is not None:
            house = max(house - max(car_s.get(ts, 0.0), 0.0), 0.0)
        rows.append((t, pv, house))
    return rows


def minute_of_day(t):
    return t.hour * 60 + t.minute


def plan(series, now, cfg, soc=None, fc_rest=None, fc_today=None, fc_ts=None):
    """The day plan for `now` from the 5-minute series. Pure: no database, no clock. Returns the JSON object."""
    tz, today = cfg["tz"], now.date()
    sunset_today = sunset(today, cfg["lat"], cfg["lon"], tz)
    battery = cfg.get("usable_kwh") is not None
    if battery and soc is None:
        return {"state": None, "battery": True, "error": "battery state of charge is not a number"}

    offsets, ratios, after_kwh, load_kwh = [], [], [], []
    tod = minute_of_day(now)
    for back in range(1, cfg["days"] + 1):
        d = today - timedelta(days=back)
        prof = day_profile(series, d, tz, cfg["discharge_factor"])
        if len(prof) < MIN_SLOTS:
            continue
        sunny = [t for t, pv, _ in prof if pv >= cfg["sun_end_w"]]
        if not sunny:
            continue
        end = max(sunny)
        offsets.append((end - sunset(d, cfg["lat"], cfg["lon"], tz)).total_seconds() / 60)
        before = sum(pv for t, pv, _ in prof if minute_of_day(t) < tod) * SLOT_H / 1000
        after = sum(pv for t, pv, _ in prof if minute_of_day(t) >= tod) * SLOT_H / 1000
        after_kwh.append(after)
        if before > MIN_BEFORE_KWH:
            ratios.append(after / before)
        end_tod = minute_of_day(end)
        load_kwh.append(sum(h for t, _, h in prof if h is not None and tod <= minute_of_day(t) <= end_tod)
                        * SLOT_H / 1000)

    if not offsets:
        return {"state": None, "battery": battery, "sunset": sunset_today.isoformat(timespec="minutes"),
                "error": f"not enough history: no day with {MIN_SLOTS} or more 5-minute solar statistics and sun "
                         f"above {cfg['sun_end_w']:.0f} W in the last {cfg['days']} days"}

    offset = statistics.median(offsets)
    sun_end = sunset_today + timedelta(minutes=offset)
    today_prof = day_profile(series, today, tz, cfg["discharge_factor"])
    pv_so_far = sum(pv for t, pv, _ in today_prof if t <= now) * SLOT_H / 1000
    after_sun = now >= sun_end

    hist_pv = fc_pv = factor = None
    if after_sun:
        rest_pv = rest_load = 0.0
    else:
        if pv_so_far > MIN_SO_FAR_KWH and ratios:
            hist_pv = pv_so_far * statistics.median(ratios)
            if after_kwh:
                hist_pv = min(hist_pv, max(after_kwh) * HISTORY_CAP)
        else:
            hist_pv = statistics.median(after_kwh) if after_kwh else 0.0
        if fc_rest is not None and fc_today is not None:
            # Solar since the forecast's last refresh: compare at the refresh moment, then subtract it.
            pv_since = 0.0
            midnight = datetime(today.year, today.month, today.day, tzinfo=tz).timestamp()
            if fc_ts is not None and midnight <= fc_ts <= now.timestamp():
                pv_since = sum(pv for t, pv, _ in today_prof if fc_ts <= t.timestamp() <= now.timestamp()) \
                    * SLOT_H / 1000
            pv_at_refresh = pv_so_far - pv_since
            fc_so_far = fc_today - fc_rest
            factor = (min(FACTOR_RANGE[1], max(FACTOR_RANGE[0], pv_at_refresh / fc_so_far))
                      if fc_so_far > FORECAST_MIN_SO_FAR else 1.0)
            fc_pv = max(0.0, fc_rest * factor - pv_since)
        # The forecast sees coming clouds but not the evening shade; the history sees the shade but not today's
        # weather. The lower one wins: when in doubt, the battery gets priority.
        rest_pv = min(fc_pv, hist_pv) if fc_pv is not None else hist_pv
        rest_load = statistics.median(load_kwh) if load_kwh else 0.0

    needed = (max(0.0, FULL_PERCENT - soc) / 100 * cfg["usable_kwh"] / cfg["charge_efficiency"]) if battery else 0.0
    margin = round(rest_pv - rest_load - needed, 2)
    if after_sun:
        source = None
    else:
        source = "forecast" if fc_pv is not None and fc_pv <= hist_pv else "history"
    return {
        "state": margin,
        "after_sun": after_sun,
        "sun_end": sun_end.isoformat(timespec="minutes"),
        "sunset": sunset_today.isoformat(timespec="minutes"),
        "sun_end_offset_min": round(offset),
        "battery": battery,
        "battery_needed_kwh": round(needed, 2),
        "pv_remaining_kwh": round(rest_pv, 2),
        "pv_remaining_forecast_kwh": None if fc_pv is None else round(fc_pv, 2),
        "pv_remaining_history_kwh": None if hist_pv is None else round(hist_pv, 2),
        "house_remaining_kwh": round(rest_load, 2),
        "source": source,
        "forecast_factor": None if factor is None else round(factor, 2),
        "pv_today_kwh": round(pv_so_far, 2),
        "days": len(offsets),
        "error": None,
    }


def main(argv):
    a = parse_args(argv)
    tz = ZoneInfo(a.tz)
    now = datetime.fromisoformat(a.now).astimezone(tz) if a.now else datetime.now(tz)
    ids = {"pv": a.pv}
    if a.house:
        ids["house"] = a.house
    else:
        ids.update({"imp": a.imp, "exp": a.exp})
        if a.battery_power:
            ids["bat"] = a.battery_power
    if a.car:
        ids["car"] = a.car
    cfg = {
        "tz": tz, "lat": a.lat, "lon": a.lon, "days": a.days, "sun_end_w": a.sun_end_w,
        "charge_efficiency": a.charge_efficiency, "usable_kwh": a.usable_kwh,
        "discharge_factor": 1.0 if a.battery_sign == "discharge_positive" else -1.0,
    }
    try:
        series, missing = load_series(a.db, ids, int((now - timedelta(days=a.days + 1)).timestamp()))
    except sqlite3.Error as e:
        return {"state": None, "error": f"cannot read the recorder database {a.db} (SQLite required): {e}"}
    # Without solar or without the house consumption the margin would be wrong in the dangerous direction (too
    # high): no value. Without the battery or charger statistics it is only less exact: a value plus a warning.
    required = [ids[k] for k in ("pv", "house", "imp", "exp") if k in ids]
    lacking = [sid for sid in missing if sid in required]
    if lacking:
        return {"state": None, "error": "no statistics for " + ", ".join(lacking)
                + " (the sensor needs state_class measurement, and the recorder must keep it)"}
    result = plan(series, now, cfg, a.soc, a.forecast_remaining, a.forecast_today, a.forecast_updated)
    if missing and result.get("error") is None:
        result["error"] = "warning: no statistics for " + ", ".join(missing) + " (state_class measurement needed)"
    return result


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception as e:  # keep the sensor alive; the error is visible as an attribute
        print(json.dumps({"state": None, "error": f"{type(e).__name__}: {e}"}))

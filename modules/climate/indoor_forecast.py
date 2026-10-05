#!/usr/bin/env python3
"""Forecast today's indoor peak temperature from the sun and the outdoor air, and advise the floor mode.

Runs as a Home Assistant command_line sensor (module climate, see climate/LOGIC.md "Indoor forecast"). Read-only on the
recorder database, which must be SQLite (Home Assistant's default); Python standard library only. Every entity id comes
from the command line, filled in from house.yaml; nothing about the house is written in this file.

    python3 /config/climate/indoor_forecast.py --indoor sensor.living_room_temperature [--solar sensor.solar_power]
        [--outdoor sensor.outdoor_temperature] [--tz Europe/Brussels] [--days 30] [--target 21] [--low 20.5]
        [--high 22.5] [--floor-warm 24] [--floor-cool 17]
        -- <indoor now> <solar left today kWh> <solar today kWh> <outdoor mean until 18:00> <day max d0> <d1> <d2> <d3>

Values after -- may be empty, 'unknown', 'unavailable', 'None' or 'x' (= not known). Prints one JSON object.

Model, fitted on every run from the hourly long-term statistics of the last --days days, for the current hour H:
    rise = a + k * solar_after_H + b * (outdoor_mean_after_H - indoor_at_H)
rise = highest indoor temperature after H (until LAST_HOUR) minus indoor at H, solar_after_H = solar energy (kWh)
after H. Without --solar the k term drops out, without --outdoor the b term. The forecast takes the solar forecast
left today (scaled by today's measured / forecast ratio so far) and the outdoor mean of the weather forecast.

Environment (local tests only): CLIMATE_DB = SQLite URI of a test database, CLIMATE_NOW = ISO local time "now".
"""
import argparse
import json
import os
import sqlite3
import statistics
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DB = os.environ.get("CLIMATE_DB", "file:/config/home-assistant_v2.db?mode=ro")
LAST_HOUR = 21  # the indoor peak is looked for until this hour (local time)
FIRST_HOUR = 5  # before this hour the model of 05:00 is used
NO_VALUE = {"", "unknown", "unavailable", "none", "x", "nan"}


def number(text):
    """float of a command-line value, None when it is not known."""
    if text is None or str(text).strip().lower() in NO_VALUE:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse(argv):
    p = argparse.ArgumentParser(description="indoor peak forecast (ha-kit module climate)")
    p.add_argument("--indoor", required=True, help="statistic id of the indoor temperature (state_class measurement)")
    p.add_argument("--solar", default="", help="statistic id of the solar power (W or kW); empty = no solar term")
    p.add_argument("--outdoor", default="", help="statistic id of the outdoor temperature; empty = no outdoor term")
    p.add_argument("--tz", default="UTC")
    p.add_argument("--days", type=int, default=30)
    p.add_argument("--target", type=float, default=21.0)
    p.add_argument("--low", type=float, default=20.5)
    p.add_argument("--high", type=float, default=22.5)
    p.add_argument("--floor-warm", type=float, default=24.0, help="day max from which a day counts warm (floor cooling)")
    p.add_argument("--floor-cool", type=float, default=17.0, help="day max below which a day counts cool (floor heating)")
    p.add_argument("values", nargs="*")
    args = p.parse_args(argv)
    values = [number(v) for v in args.values] + [None] * 8
    return args, values[:8]


def load(cur, ids, since_ts):
    """{key: {hour_start_ts: (mean, max)}} from the hourly statistics; power in W is converted to kW."""
    out = {}
    for key, sid in ids.items():
        out[key] = {}
        if not sid:
            continue
        cur.execute("SELECT id, unit_of_measurement FROM statistics_meta WHERE statistic_id=?", (sid,))
        row = cur.fetchone()
        if not row:
            continue
        scale = 0.001 if (row[1] or "").lower() == "w" else 1.0
        cur.execute("SELECT start_ts, mean, max FROM statistics WHERE metadata_id=? AND start_ts>=?", (row[0], since_ts))
        out[key] = {int(t): ((m or 0.0) * scale, (x if x is not None else (m or 0.0)) * scale)
                    for t, m, x in cur.fetchall()}
    return out


def day_sample(series, d, hour, tz):
    """(rise, solar_after, outdoor_minus_indoor, peak_hour) for local day d seen from `hour`; None when data is missing."""
    start = datetime(d.year, d.month, d.day, tzinfo=tz)

    def ts(h):
        return int((start + timedelta(hours=h)).timestamp())

    t0 = series["indoor"].get(ts(hour))
    if t0 is None:
        return None
    after = [h for h in range(hour, LAST_HOUR) if ts(h) in series["indoor"]]
    if len(after) < (LAST_HOUR - hour) * 0.8:
        return None
    peak_h = max(after, key=lambda h: series["indoor"][ts(h)][1])
    rise = series["indoor"][ts(peak_h)][1] - t0[0]
    solar = sum(max(series["solar"].get(ts(h), (0.0, 0.0))[0], 0.0) for h in range(hour, LAST_HOUR))
    outs = [series["outdoor"][ts(h)][0] for h in range(hour, min(18, LAST_HOUR)) if ts(h) in series["outdoor"]]
    dt_out = (statistics.mean(outs) - t0[0]) if outs else 0.0
    return rise, solar, dt_out, peak_h


def lstsq(rows, cols):
    """Least squares of rise on the columns cols of (1, solar, dt); None when singular."""
    X = [(1.0, r[1], r[2]) for r in rows]
    y = [r[0] for r in rows]
    m = len(cols)
    A = [[sum(x[i] * x[j] for x in X) for j in cols] for i in cols]
    v = [sum(x[i] * yy for x, yy in zip(X, y)) for i in cols]
    for c in range(m):  # Gauss-Jordan with partial pivoting
        p = max(range(c, m), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-9:
            return None
        A[c], A[p], v[c], v[p] = A[p], A[c], v[p], v[c]
        for r in range(m):
            if r != c:
                f = A[r][c] / A[c][c]
                A[r] = [a - f * b for a, b in zip(A[r], A[c])]
                v[r] -= f * v[c]
    out = [0.0, 0.0, 0.0]
    for i, col in enumerate(cols):
        out[col] = v[i] / A[i][i]
    return out


def solve(rows, with_solar, with_outdoor):
    """(a, k, b): the full model when it is plausible, else fewer terms, else the mean rise (few days or odd data)."""
    n = len(rows)
    if n < 4:
        return (statistics.mean(r[0] for r in rows) if rows else 0.0), 0.0, 0.0
    ok_k = lambda k: 0 <= k <= 0.5  # noqa: E731  °C per kWh of solar
    ok_b = lambda b: -0.2 <= b <= 0.6  # noqa: E731  share of the outdoor-indoor difference
    if with_solar and with_outdoor and n >= 6:
        full = lstsq(rows, [0, 1, 2])
        if full and ok_k(full[1]) and ok_b(full[2]):
            return tuple(full)
    if with_solar:
        two = lstsq(rows, [0, 1])
        if two and ok_k(two[1]):
            return two[0], two[1], 0.0
    if with_outdoor and n >= 6:
        two = lstsq(rows, [0, 2])
        if two and ok_b(two[2]):
            return two[0], 0.0, two[2]
    return statistics.mean(r[0] for r in rows), 0.0, 0.0


def day_type(now_t, peak, args):
    if peak < args.low:
        return "cool"
    if peak > args.high:
        return "warm"
    if now_t < args.target <= peak:
        return "sunny_fresh"
    return "normal"


def floor_advice(day_max, args):
    """From the next three days (d1..d3): cooling when all are warm, heating when all are cool, else neutral. The
    hysteresis (at least 3 days per mode, always through neutral) lives in the automation climate_floor_mode_choose."""
    nxt = [d for d in day_max[1:4] if d is not None]
    if len(nxt) == 3 and min(nxt) >= args.floor_warm:
        return "cooling"
    if len(nxt) == 3 and max(nxt) < args.floor_cool:
        return "heating"
    return "neutral"


def main(argv):
    args, values = parse(argv)
    t_now, fc_rest, fc_today, out_rest = values[:4]
    day_max = values[4:8]
    tz = ZoneInfo(args.tz)
    now = datetime.now(tz)
    if os.environ.get("CLIMATE_NOW"):
        now = datetime.fromisoformat(os.environ["CLIMATE_NOW"]).replace(tzinfo=tz)
    hour = min(max(now.hour, FIRST_HOUR), LAST_HOUR - 2)
    ids = {"indoor": args.indoor, "solar": args.solar, "outdoor": args.outdoor}
    con = sqlite3.connect(DB, uri=True, timeout=10)
    try:
        series = load(con.cursor(), ids, int((now - timedelta(days=args.days + 1)).timestamp()))
    finally:
        con.close()
    with_solar, with_outdoor = bool(series["solar"]), bool(series["outdoor"])

    rows, peak_hours = [], []
    for back in range(1, args.days + 1):
        s = day_sample(series, now.date() - timedelta(days=back), hour, tz)
        if s:
            rows.append(s)
            if not with_solar or s[1] > 10:  # the peak hour of sunny days (any day without solar)
                peak_hours.append(s[3])
    a, k, b = solve(rows, with_solar, with_outdoor)

    # Quality of the 08:00 model (what the morning decision sees): fit and root-mean-square error over the past days.
    rows8 = [r for r in (day_sample(series, now.date() - timedelta(days=i), 8, tz) for i in range(1, args.days + 1)) if r]
    a8, k8, b8 = solve(rows8, with_solar, with_outdoor)
    rmse8 = (statistics.mean([(r[0] - (a8 + k8 * r[1] + b8 * r[2])) ** 2 for r in rows8]) ** 0.5) if rows8 else None

    if t_now is None:
        print(json.dumps({"state": None, "error": "no indoor temperature"}))
        return

    # Today's solar so far from the hourly statistics, to scale the solar forecast that is left.
    start = datetime(now.year, now.month, now.day, tzinfo=tz)
    solar_so_far = sum(max(series["solar"].get(int((start + timedelta(hours=h)).timestamp()), (0.0, 0.0))[0], 0.0)
                       for h in range(0, now.hour))
    factor = 1.0
    if with_solar and fc_rest is not None and fc_today is not None and fc_today - fc_rest > 1:
        factor = min(1.5, max(0.5, solar_so_far / (fc_today - fc_rest)))
    solar_rest = (fc_rest or 0.0) * factor if with_solar else 0.0
    dt_out = (out_rest - t_now) if out_rest is not None else 0.0

    rise = max(a + k * solar_rest + b * dt_out, 0.0) if now.hour < LAST_HOUR else 0.0
    peak = round(t_now + rise, 1)
    print(json.dumps({
        "state": peak,
        "peak_hour": f"{round(statistics.median(peak_hours)):02d}:00" if peak_hours else None,
        "day_type": day_type(t_now, peak, args),
        "floor_advice": floor_advice(day_max, args),
        "rise": round(rise, 1),
        "solar_rest_kwh": round(solar_rest, 1),
        "forecast_factor": round(factor, 2),
        "outdoor_minus_indoor": round(dt_out, 1),
        "a": round(a, 2),
        "k_per_kwh": round(k, 3),
        "b_outdoor": round(b, 3),
        "days": len(rows),
        "model_hour": hour,
        "terms": ["base"] + (["solar"] if with_solar else []) + (["outdoor"] if with_outdoor else []),
        "morning_model": {"a": round(a8, 2), "k_per_kwh": round(k8, 3), "b_outdoor": round(b8, 3),
                          "rmse": None if rmse8 is None else round(rmse8, 2), "days": len(rows8)},
        "day_max_coming": day_max,
        "error": None,
    }))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except SystemExit:
        raise
    except Exception as e:  # keep the sensor alive; the error is visible as an attribute
        print(json.dumps({"state": None, "error": f"{type(e).__name__}: {e}"}))

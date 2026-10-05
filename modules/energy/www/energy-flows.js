<% from '_energy.jinja' import flows_cfg with context %>
// Energy flows per day (ha-kit module energy): where the solar energy went and where the consumption came from, per
// quarter (last ~10 days) or per hour, for the day in input_datetime.energy_flows_date, or an average over 7 days.
// Loaded as a dashboard resource; the apexcharts-card data_generators of the view "flows" call
//   window.haKitEnergyFlows.get(hass, {key, mode: 'day'|'week', unit: 'kwh'|'percent', out: 'series'|'total'})
// Flows: the sun feeds the house first (the car first), then the battery; the rest goes to the grid.
// Entity ids are rendered from house.yaml by tools/fill.py (energy/_energy.jinja); nothing is built in.
(() => {
  const VERSION = "1";
  const CFG = <@ flows_cfg | tojson @>;
  const DAY = 86400000,
    MIN5 = 300000,
    QUARTER = 900000,
    HOUR = 3600000;
  const SHORT_TERM_DAYS = 9.5; // the recorder keeps 5-minute statistics ~10 days
  const KEYS = ["z_dir", "b_house", "n_house", "z_house", "z_car", "z_batt", "z_net", "car"];
  const cache = new Map();

  const localMidnight = (y, m, d) => new Date(y, m - 1, d).getTime();
  const todayStart = () => {
    const n = new Date();
    return localMidnight(n.getFullYear(), n.getMonth() + 1, n.getDate());
  };
  const chosenDayStart = (hass) => {
    const s = hass?.states?.[CFG.date]?.state;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    const t = m ? localMidnight(+m[1], +m[2], +m[3]) : todayStart();
    return Math.min(t, todayStart());
  };
  const plusDays = (ts, n) => {
    const d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };

  // Window for a mode: 'day' = the chosen day; 'week' = 7 full days up to and including it (yesterday if it is today).
  function windowFor(mode, day) {
    const now = Date.now();
    if (mode === "day") return { from: day, to: Math.min(plusDays(day, 1), now), days: 1 };
    let end = plusDays(day, 1);
    if (end > now) end = todayStart();
    return { from: plusDays(end, -7), to: end, days: 7 };
  }

  function flows(v) {
    const pv = Math.max(v.pv, 0),
      chg = Math.max(v.chg, 0),
      dis = Math.max(v.dis, 0);
    const imp = Math.max(v.imp, 0),
      exp = Math.max(v.exp, 0),
      ev = Math.max(v.ev, 0);
    const z_net = Math.min(exp, pv);
    const z_batt = Math.min(chg, pv - z_net);
    const z_dir = Math.max(pv - z_net - z_batt, 0);
    const z_car = Math.min(ev, z_dir);
    return {
      z_dir,
      z_net,
      z_batt,
      z_car,
      z_house: z_dir - z_car,
      car: ev,
      b_house: Math.max(dis - (exp - z_net), 0),
      n_house: Math.max(imp - (chg - z_batt), 0),
    };
  }

  async function compute(hass, mode, day) {
    const { from, to, days } = windowFor(mode, day);
    const fine = from >= Date.now() - SHORT_TERM_DAYS * DAY;
    const base = fine ? MIN5 : HOUR,
      disp = fine ? QUARTER : HOUR;
    const hours = base / HOUR;
    const call = (ids, types) =>
      ids.length && to > from
        ? hass
            .callWS({
              type: "recorder/statistics_during_period",
              start_time: new Date(from).toISOString(),
              end_time: new Date(to).toISOString(),
              period: fine ? "5minute" : "hour",
              statistic_ids: ids,
              types,
              units: { energy: "kWh", power: "kW" },
            })
            .catch(() => ({}))
        : Promise.resolve({});
    // Energy meters give 'change' (kWh per bucket); power roles give 'mean' (kW x bucket length = kWh).
    const [res, pw] = await Promise.all([call(CFG.energy_ids, ["change"]), call(CFG.power_ids, ["mean"])]);
    const byStart = new Map();
    const row = (t) => {
      if (!byStart.has(t)) byStart.set(t, { pv: 0, chg: 0, dis: 0, imp: 0, exp: 0, ev: 0 });
      return byStart.get(t);
    };
    const tOf = (r) => (typeof r.start === "number" ? r.start : Date.parse(r.start));
    for (const [k, ids] of Object.entries(CFG.energy)) {
      for (const id of ids)
        for (const r of res[id] || []) {
          // The first retained row of a sum statistic can hold the whole meter reading: drop implausible jumps.
          const c = r.change || 0;
          row(tOf(r))[k] += c < 0 || c > (fine ? 5 : 40) ? 0 : c;
        }
    }
    for (const [k, p] of Object.entries(CFG.power)) {
      for (const r of pw[p.id] || []) {
        const v = (r.mean || 0) * (p.sign || 1) * hours;
        const o = row(tOf(r));
        if (k === "bat") {
          o.dis += Math.max(v, 0);
          o.chg += Math.max(-v, 0);
        } else o[k] += Math.max(v, 0);
      }
    }
    const n = mode === "week" ? DAY / disp : Math.ceil((to - from) / disp);
    const sums = {};
    for (const k of KEYS) sums[k] = new Array(n).fill(0);
    const seen = new Array(n).fill(0);
    for (const [t, v] of byStart) {
      if (t < from || t >= to) continue;
      const f = flows(v);
      let b;
      if (mode === "week") {
        const d = new Date(t);
        b = Math.floor(((d.getHours() * 60 + d.getMinutes()) * 60000) / disp);
      } else b = Math.floor((t - from) / disp);
      if (b < 0 || b >= n) continue;
      seen[b] = 1;
      for (const k of KEYS) sums[k][b] += f[k];
    }
    const div = mode === "week" ? days : 1;
    // Drop the running quarter (no statistics yet): a trailing null makes apexcharts close the stacked area with a
    // diagonal back to 00:00. Gaps inside the day are drawn as 0.
    let last = n - 1;
    while (last >= 0 && !seen[last]) last--;
    const buckets = [];
    for (let b = 0; b <= last; b++) {
      const o = {};
      for (const k of KEYS) o[k] = seen[b] ? sums[k][b] / div : 0;
      buckets.push(o);
    }
    const tot = {};
    for (const k of KEYS) tot[k] = buckets.reduce((a, o) => a + o[k], 0);
    return { buckets, tot, disp, axis0: todayStart(), fine, from, to };
  }

  function value(o, key, unit) {
    const pct = unit === "percent";
    const cons = o.z_dir + o.b_house + o.n_house;
    const pv = o.z_house + o.z_car + o.z_batt + o.z_net;
    const share = (x, d) => (d > 1e-9 ? (100 * x) / d : 0); // no sun or no use: 0 %, nulls break the curve
    // Pre-stacked layers (apexcharts stacks a negative area on top of the positive ones, so we stack ourselves).
    const dest = {
      c_house: o.z_house,
      c_car: o.z_house + o.z_car,
      c_batt: o.z_house + o.z_car + o.z_batt,
      z_net_neg: -o.z_net,
    };
    const src = { h_sun: o.z_dir, h_batt: o.z_dir + o.b_house, h_grid: cons };
    if (key in src) return pct ? share(src[key], cons) : src[key];
    if (key === "car") return pct ? share(o.car, cons) : o.car;
    if (key in dest) return pct ? share(dest[key], pv) : dest[key];
    if (!pct) return o[key];
    return ["z_dir", "b_house", "n_house"].includes(key) ? share(o[key], cons) : share(o[key], pv);
  }

  async function get(hass, { key, mode = "day", unit = "kwh", out = "series" }) {
    const day = chosenDayStart(hass);
    const ck = `${VERSION}|${mode}|${day}|${Math.floor(Date.now() / MIN5)}`;
    if (!cache.has(ck)) {
      for (const k of cache.keys()) if (k.split("|")[1] === mode) cache.delete(k);
      cache.set(
        ck,
        compute(hass, mode, day).catch((e) => {
          cache.delete(ck);
          throw e;
        }),
      );
    }
    const r = await cache.get(ck);
    if (out === "total") return [[Date.now(), +(r.tot[key] || 0).toFixed(1)]];
    return r.buckets.map((o, b) => [r.axis0 + b * r.disp, +value(o, key, unit).toFixed(3)]);
  }

  async function info(hass) {
    const day = chosenDayStart(hass);
    return { day: windowFor("day", day), week: windowFor("week", day) };
  }

  window.haKitEnergyFlows = { get, info, version: VERSION };
})();

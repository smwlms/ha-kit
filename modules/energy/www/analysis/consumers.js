// Consumers for the view "consumers" of the energy-analysis dashboard: who uses what, when consumers start and
// where the car's charge comes from.
// Registers window.haKitEnergy.consumers = { mix, starts, carSource, carProfile }.
// Consumers: the charger (ev-charger), the heat pump (heat-pump: energy role or estimated power), the ventilation
// role and every item of house.yaml energy.consumers (power_w and/or energy_kwh). The rest is what no meter explains.
(() => {
  const C = window.haKitEnergyCore;
  const CFG = C.CFG;
  const ID = CFG.ids;
  const HOUR = C.HOUR,
    MIN5 = C.MIN5;
  // Every measured consumer of the house: {key, energy?, power?, start_kw}. energy = kWh meter ('change'), power = W
  // or kW role ('mean' x hours). The keys are those of the dashboard series.
  const LIST = [
    ...(ID.charger_w || ID.charger_kwh ? [{ key: "car", energy: ID.charger_kwh, power: ID.charger_w, start_kw: 0.15 }] : []),
    ...(ID.hp_kwh || ID.hp_w ? [{ key: "heat_pump", energy: ID.hp_kwh, power: ID.hp_w, start_kw: 0.3 }] : []),
    ...(ID.vent_w ? [{ key: "ventilation", power: ID.vent_w, start_kw: 0.05 }] : []),
    ...(CFG.consumers || []).map((c) => ({ key: c.key, energy: c.energy, power: c.power, start_kw: (c.start_w ?? 100) / 1000 })),
  ];
  const byKey = Object.fromEntries(LIST.map((x) => [x.key, x]));
  const t0 = (o) => (o.start instanceof Date ? o.start.getTime() : +o.start || Date.now());
  const t1 = (o) => (o.end instanceof Date ? o.end.getTime() : +o.end || Date.now());
  const floorTo = (ts, step) => Math.floor(ts / step) * step;
  const atHour = (day, h) => {
    const d = new Date(day);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };
  // 'Hour of the day' points on `day`; DST-safe (the missing spring hour is skipped, the fall-back hour clamped).
  const hourPoints = (day, vals, off, a, b) => {
    const out = [];
    vals.forEach((v, h) => {
      const x = atHour(day, h);
      if (new Date(x).getHours() !== h) return;
      out.push([Math.min(Math.max(x + off, a), b), v]);
    });
    return out;
  };
  const sum = (rows, f, from, to) => (rows || []).reduce((a, r) => a + (r.start >= from && r.start < to && r[f] != null ? r[f] : 0), 0);
  const donutPoint = (o, v) => [[Math.max(t0(o), Math.min(t1(o), Date.now()) - 60000), C.round(v, 2)]];
  const win = (days) => {
    const to = C.todayStart();
    return { from: C.addDays(to, -days), to };
  };
  const hourly = (hass, ids, from, to) => C.stats(hass, { ids, from, to, period: "hour", types: ["change", "mean"] });
  // kWh of one consumer over [from, to) from hourly rows: its energy meter, else the power means.
  const kwhOf = (s, x, from, to) => (x.energy ? sum(s[x.energy], "change", from, to) : sum(s[x.power], "mean", from, to));

  // ---- who uses what (donut) ----
  function mixCalc(hass, from, to) {
    return C.memo(`consumers|mix|${from}|${to}`, async () => {
      const ids = [
        ...(ID.imp_kwh || []),
        ...(ID.exp_kwh || []),
        ID.solar_kwh || ID.solar_w,
        ID.chg_kwh,
        ID.dis_kwh,
        ID.chg_kwh || ID.dis_kwh ? null : ID.bat_w,
        ...LIST.map((x) => x.energy || x.power),
      ].filter(Boolean);
      const s = await hourly(hass, [...new Set(ids)], from, to);
      const ch = (id) => (id ? sum(s[id], "change", from, to) : 0);
      const solar = ID.solar_kwh ? ch(ID.solar_kwh) : ID.solar_w ? sum(s[ID.solar_w], "mean", from, to) : 0;
      let battery = ch(ID.dis_kwh) - ch(ID.chg_kwh);
      if (!ID.chg_kwh && !ID.dis_kwh && ID.bat_w)
        battery = (s[ID.bat_w] || []).reduce((a, r) => a + (r.start >= from && r.start < to ? C.batteryKw(r.mean) || 0 : 0), 0);
      // Consumption = import - export + solar + (discharged - charged)
      const total =
        (ID.imp_kwh || []).reduce((a, id) => a + ch(id), 0) - (ID.exp_kwh || []).reduce((a, id) => a + ch(id), 0) + solar + battery;
      const out = {};
      for (const x of LIST) out[x.key] = Math.max(kwhOf(s, x, from, to), 0);
      const known = Object.values(out).reduce((a, b) => a + b, 0);
      out.rest = Math.max(total - known, 0);
      out.total = total;
      return out;
    });
  }
  // opts.key: a consumer key | 'rest' | 'total'; opts.days (default 30, full days up to yesterday).
  async function mix(hass, o = {}) {
    const { from, to } = win(o.days || 30);
    const m = await mixCalc(hass, from, to);
    return donutPoint(o, m[o.key] ?? 0);
  }

  // ---- when consumers start: share of the starts per hour of the day (last ~10 days, 5-minute means) ----
  // A start = the 5-minute mean rises above start_kw (house.yaml consumers[].start_w, default 100 W) after a 5-minute
  // block below it. The heat pump counts its hot-water starts from sensor.heat_pump_state when that exists.
  // opts.key; opts.unit: 'percent' (default) | 'count' | 'per_day'.
  async function starts(hass, o = {}) {
    const x = byKey[o.key];
    const counts = new Array(24).fill(0);
    const from = C.addDays(C.todayStart(), -9);
    const to = floorTo(Date.now(), MIN5);
    if (o.key === "heat_pump" && ID.hp_state) {
      const h = await C.history(hass, { ids: [ID.hp_state], from, to });
      const pts = h[ID.hp_state] || [];
      for (let i = 1; i < pts.length; i++)
        if (pts[i][1] === "hot_water" && pts[i - 1][1] !== "hot_water" && pts[i][0] >= from) counts[C.hourOfDay(pts[i][0])]++;
    } else if (x?.power) {
      const s = await C.stats(hass, { ids: [x.power], from, to, period: "5minute", types: ["mean"], units: { power: "kW" } });
      let prev = true,
        prevT = 0;
      for (const r of s[x.power] || []) {
        const on = (r.mean ?? 0) > x.start_kw;
        if (on && (!prev || r.start - prevT > MIN5)) counts[C.hourOfDay(r.start)]++;
        prev = on;
        prevT = r.start;
      }
    } else return [];
    const days = (to - from) / C.DAY;
    const total = counts.reduce((a, b) => a + b, 0);
    const vals = counts.map((c) => C.round(o.unit === "count" ? c : o.unit === "per_day" ? c / days : total ? (100 * c) / total : 0, 2));
    return hourPoints(C.localMidnight(t0(o)), vals, HOUR / 2, t0(o), t1(o));
  }

  // ---- the car: hourly charger power and grid import (365 days) ----
  // History up to yesterday 00:00 is fetched once per day; only the last day refreshes.
  async function carHours(hass) {
    const split = C.addDays(C.todayStart(), -1);
    const from = C.addDays(C.monthStart(Date.now()), -365);
    const q = { ids: [ID.charger_w, ID.imp_w, ID.exp_w].filter(Boolean), period: "hour", types: ["mean"], units: { power: "kW" } };
    const [a, b] = await Promise.all([
      C.memo(`consumers|car|${split}`, () => C.stats(hass, { ...q, from, to: split })),
      C.stats(hass, { ...q, from: split, to: floorTo(Date.now(), HOUR) }),
    ]);
    const out = {};
    for (const id of q.ids) out[id] = [...(a[id] || []), ...(b[id] || [])];
    return out;
  }

  // opts.key: 'solar' | 'grid' | 'percent'. Per month: grid share = sum over hours of min(charging, grid import), an
  // upper bound; the rest came from the sun or the battery.
  async function carSource(hass, o = {}) {
    if (!ID.charger_w) return [];
    const s = await carHours(hass);
    const imp = C.byStart(s[ID.imp_w], "mean");
    const M = new Map();
    for (const r of s[ID.charger_w] || []) {
      if (r.mean == null) continue;
      const ev = Math.max(r.mean, 0);
      const net = Math.min(ev, Math.max(imp.get(r.start) ?? 0, 0));
      const k = C.monthStart(r.start);
      const m = M.get(k) || { ev: 0, net: 0 };
      m.ev += ev;
      m.net += net;
      M.set(k, m);
    }
    const a = t0(o),
      b = t1(o);
    return [...M.entries()]
      .sort((x, y) => x[0] - y[0])
      .filter(([k]) => k + 15 * C.DAY >= a && k <= b) // a 365 d span must not show 13 months
      .map(([k, m]) => {
        const v = o.key === "grid" ? m.net : o.key === "percent" ? (m.ev ? (100 * m.net) / m.ev : 0) : m.ev - m.net;
        return [Math.min(Math.max(k + 14 * C.DAY, a), b), C.round(v, 2)];
      });
  }

  // opts.key: 'charging' | 'export' | 'import'; opts.days (default 30). Average kW per hour of the day.
  async function carProfile(hass, o = {}) {
    const days = o.days || 30;
    const to = C.todayStart(),
      from = C.addDays(to, -days);
    const s = await carHours(hass);
    const id = { charging: ID.charger_w, export: ID.exp_w, import: ID.imp_w }[o.key] || ID.charger_w;
    if (!id) return [];
    const tot = new Array(24).fill(0),
      cnt = new Array(24).fill(0);
    for (const r of s[id] || []) {
      if (r.start < from || r.start >= to || r.mean == null) continue;
      const h = C.hourOfDay(r.start);
      tot[h] += Math.max(r.mean, 0);
      cnt[h]++;
    }
    return hourPoints(C.localMidnight(t0(o)), tot.map((v, h) => C.round(cnt[h] ? v / cnt[h] : 0, 3)), 0, t0(o), t1(o));
  }

  window.haKitEnergy.consumers = { mix, starts, carSource, carProfile, list: LIST };
})();

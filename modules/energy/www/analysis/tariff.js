// Tariff analysis for the view "tariff" of the energy-analysis dashboard (needs a module that provides `tariff`).
// Registers window.haKitEnergy.tariff = { day, cumulative, price, hour, days (diagnostics) }.
//
// Cost per day on the dynamic contract and, when house.yaml tariff.compare is set, on a variable and a fixed contract,
// from the grid import/export meters (5-minute statistics within ~9 days, else hourly):
// - dynamic: window.haKitTariff.importPrice / exportPrice per quarter on the spot quarter prices of
//   nordpool.get_prices_for_date (Nord Pool serves ~2 months back; complete days are kept in localStorage), falling
//   back to the statistics of entities.spot_price;
// - variable / fixed: the energy price of tariff.compare plus the same levies and grid fee (day/night) of the tariff
//   module, and the export price of tariff.compare.
// The capacity tariff is the same for every contract and left out; the yearly fixed fee is spread per day
// (tariff.fixed_eur_per_year for dynamic, tariff.compare.fee_eur_per_year for the others).
(() => {
  const C = window.haKitEnergyCore;
  const CFG = C.CFG;
  const IMP = CFG.ids.imp_kwh || [];
  const EXP = CFG.ids.exp_kwh || [];
  const SPOT = CFG.ids.spot;
  const CMP = CFG.compare || null; // {variable, fixed, export} in c€/kWh incl. VAT, fee_eur_per_year
  const FEE = {
    dyn: CFG.fee_eur_per_year || 0,
    var: CMP?.fee_eur_per_year ?? CFG.fee_eur_per_year ?? 0,
    fixed: CMP?.fee_eur_per_year ?? CFG.fee_eur_per_year ?? 0,
  };
  const AREA = CFG.nordpool?.area || "BE";
  const CURRENCY = CFG.nordpool?.currency || "EUR";
  const FINE_DAYS = 9; // 5-minute statistics are kept ~10 days
  const LS_PREFIX = `ha-kit-energy-np|${AREA}|`;
  const LS_KEEP_DAYS = 100;
  const PARALLEL = 6;
  const RETRY_MS = 15 * 60000;
  const SERVICE_TIMEOUT_MS = 10000;
  const npCache = new Map(); // dayKey -> { p: Promise<{s, p[]}|null>, ok, at }
  let entryP = null;

  // The Nord Pool config entry, found from entities.spot_price (no entry id in any file).
  function configEntry(hass) {
    if (!entryP)
      entryP = SPOT
        ? hass
            .callWS({ type: "config/entity_registry/get", entity_id: SPOT })
            .then((r) => (r?.platform === "nordpool" ? r.config_entry_id : null))
            .catch(() => null)
        : Promise.resolve(null);
    return entryP;
  }

  // ---- localStorage (per-browser cache of complete days; every access may throw) ----
  function lsGet(key) {
    try {
      const v = window.localStorage?.getItem(LS_PREFIX + key);
      if (!v) return null;
      const o = JSON.parse(v);
      return Number.isFinite(o?.s) && Array.isArray(o.p) && o.p.length >= 80 ? o : null;
    } catch {
      return null;
    }
  }
  let purged = false;
  function lsSet(key, o) {
    try {
      const ls = window.localStorage;
      if (!ls) return;
      ls.setItem(LS_PREFIX + key, JSON.stringify(o));
      if (purged) return;
      purged = true;
      const limit = C.dayKey(Date.now() - LS_KEEP_DAYS * C.DAY);
      for (let i = ls.length - 1; i >= 0; i--) {
        const k = ls.key(i);
        if (k?.startsWith(LS_PREFIX) && k.slice(LS_PREFIX.length) < limit) ls.removeItem(k);
      }
    } catch {
      /* storage blocked or full: the in-memory cache still works */
    }
  }

  // Nord Pool only answers ~2 months back.
  function earliestServiceDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - 2);
    d.setDate(d.getDate() + 1); // one day margin
    return d.getTime();
  }

  // Circuit breaker: a failing call can take ~20 s. After a failure on day X, days up to X are skipped for RETRY_MS;
  // after 3 failures in a row every call is skipped for RETRY_MS. Days are requested newest first.
  const svc = { floor: -Infinity, floorUntil: 0, fails: 0, downUntil: 0 };
  const serviceAllowed = (day) => {
    const now = Date.now();
    return now >= svc.downUntil && !(now < svc.floorUntil && day <= svc.floor);
  };
  function serviceFailed(day) {
    const now = Date.now();
    svc.floor = Math.max(now < svc.floorUntil ? svc.floor : -Infinity, day);
    svc.floorUntil = now + RETRY_MS;
    if (++svc.fails >= 3) {
      svc.downUntil = now + RETRY_MS;
      svc.fails = 0;
    }
  }
  function withTimeout(promise, ms) {
    let timer;
    const t = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    });
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
  }

  // Spot quarter prices (EUR/MWh) of one local day: { s: first quarter start (ms), p: [price per quarter] }.
  function dayQuarters(hass, day) {
    const key = C.dayKey(day);
    const hit = npCache.get(key);
    if (hit && (hit.ok || Date.now() - hit.at < RETRY_MS)) return hit.p;
    const p = (async () => {
      const cached = lsGet(key);
      if (cached) return cached;
      if (day > C.todayStart() || day < earliestServiceDay() || !serviceAllowed(day)) return null;
      const entry = await configEntry(hass);
      if (!entry) return null;
      try {
        const res = await withTimeout(
          hass.callWS({
            type: "call_service",
            domain: "nordpool",
            service: "get_prices_for_date",
            service_data: { config_entry: entry, date: key, areas: AREA, currency: CURRENCY },
            return_response: true,
          }),
          SERVICE_TIMEOUT_MS,
        );
        svc.fails = 0;
        const rows = res?.response?.[AREA] || [];
        if (!rows.length) return null;
        const s = Date.parse(rows[0].start);
        const e = Date.parse(rows[rows.length - 1].end);
        const arr = new Array(Math.max(0, Math.round((e - s) / C.QUARTER))).fill(null);
        for (const r of rows) {
          if (!Number.isFinite(r.price)) continue;
          // works for 15-min and 60-min resolution alike
          for (let t = Date.parse(r.start); t < Date.parse(r.end); t += C.QUARTER) {
            const i = Math.round((t - s) / C.QUARTER);
            if (i >= 0 && i < arr.length) arr[i] = +r.price.toFixed(2);
          }
        }
        const q = { s, p: arr };
        if (s <= day && e >= C.addDays(day, 1) && arr.every((v) => v != null)) lsSet(key, q);
        return q;
      } catch {
        serviceFailed(day); // out of range or API down: fall back to the price statistics
        return null;
      }
    })();
    const entryObj = { p, ok: false, at: Date.now() };
    npCache.set(key, entryObj);
    p.then((q) => {
      if (q) entryObj.ok = true;
    });
    return p;
  }

  async function pool(tasks, n) {
    const out = new Array(tasks.length);
    let i = 0;
    const worker = async () => {
      while (i < tasks.length) {
        const k = i++;
        out[k] = await tasks[k]();
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
    return out;
  }

  const noon = (day) => {
    const d = new Date(day);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  };
  // Grid fee + levies of the comparison contracts (c€/kWh), from the tariff module's helpers.
  const gridAndLevies = (hass, ts) => {
    const k = C.coefficients(hass) || {};
    return (k.levies || 0) + (C.isNight(ts) ? k.gridNight || 0 : k.gridDay || 0);
  };

  // Energy per slot (quarter within FINE_DAYS, else hour) priced on every contract, aggregated per day.
  async function compute(hass, from, to) {
    const now = Date.now();
    to = Math.min(to, now);
    if (to <= from || !window.haKitTariff) return { days: [], slots: [] };
    const fineFrom = Math.min(Math.max(from, C.localMidnight(now - FINE_DAYS * C.DAY)), to);
    const ids = [...IMP, ...EXP];
    const [hr, fine] = await Promise.all([
      from < fineFrom ? C.stats(hass, { ids, from, to: fineFrom, period: "hour" }) : null,
      fineFrom < to ? C.stats(hass, { ids, from: fineFrom, to, period: "5minute" }) : null,
    ]);
    const slots = new Map(); // start -> { t, dur, imp, exp }
    const add = (res, dur) => {
      if (!res) return;
      for (const id of ids) {
        const isImp = IMP.includes(id);
        for (const r of res[id] || []) {
          if (r.start < from || r.start >= to || r.change == null) continue;
          const t = Math.floor(r.start / dur) * dur;
          let o = slots.get(t);
          if (!o) slots.set(t, (o = { t, dur, imp: 0, exp: 0 }));
          if (isImp) o.imp += r.change;
          else o.exp += r.change;
        }
      }
    };
    add(hr, C.HOUR);
    add(fine, C.QUARTER);

    const dayList = [];
    for (let d = C.localMidnight(from); d < to; d = C.addDays(d, 1)) dayList.push(d);
    // newest day first: the oldest days are the ones Nord Pool may refuse
    const qs = (await pool([...dayList].reverse().map((d) => () => dayQuarters(hass, d)), PARALLEL)).reverse();
    const qByDay = new Map(dayList.map((d, i) => [d, qs[i]]));
    // Fallback: statistics of the spot-price entity for days without quarter prices.
    let fbHour = null,
      fb5 = null;
    if (qs.some((q) => !q)) {
      [fbHour, fb5] = await Promise.all([
        from < fineFrom ? C.spot(hass, from, fineFrom, "hour") : null,
        fineFrom < to ? C.spot(hass, fineFrom, to, "5minute") : null,
      ]);
    }
    const avg = (vals) => {
      const v = vals.filter((x) => x != null && Number.isFinite(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    // Spot price in EUR/MWh of a slot.
    const priceAt = (t, dur) => {
      const q = qByDay.get(C.localMidnight(t));
      if (q) {
        const vals = [];
        for (let u = t; u < t + dur; u += C.QUARTER) vals.push(q.p[Math.round((u - q.s) / C.QUARTER)]);
        const a = avg(vals);
        if (a != null) return a;
      }
      if (dur === C.HOUR && fbHour) return fbHour.get(t) ?? null;
      if (fb5) {
        const vals = [];
        for (let u = t; u < t + dur; u += C.MIN5) vals.push(fb5.get(u));
        return avg(vals);
      }
      return null;
    };

    const pInj = CMP ? CMP.export / 100 : 0;
    const byDay = new Map();
    const out = [];
    for (const s of [...slots.values()].sort((a, b) => a.t - b.t)) {
      const day = C.localMidnight(s.t);
      let d = byDay.get(day);
      if (!d) {
        d = { day, x: noon(day), imp: 0, exp: 0, dyn: 0, var: 0, fixed: 0, wA: 0, wI: 0, wV: 0, fA: 0, fI: 0, fDur: 0, miss: 0 };
        byDay.set(day, d);
      }
      const imp = Math.max(s.imp, 0);
      const exp = Math.max(s.exp, 0);
      const b = priceAt(s.t, s.dur);
      if (b == null) {
        d.miss += imp + exp;
        continue;
      }
      const pa = C.importPrice(b, s.t, hass);
      const pi = C.exportPrice(b, s.t);
      const g = gridAndLevies(hass, s.t);
      const pVar = CMP ? (CMP.variable + g) / 100 : 0;
      const pFixed = CMP ? (CMP.fixed + g) / 100 : 0;
      d.imp += imp;
      d.exp += exp;
      d.dyn += imp * pa - exp * pi;
      d.var += imp * pVar - exp * pInj;
      d.fixed += imp * pFixed - exp * pInj;
      d.wA += imp * pa;
      d.wI += exp * pi;
      d.wV += imp * pVar;
      d.fA += pa * s.dur;
      d.fI += pi * s.dur;
      d.fDur += s.dur;
      out.push({ t: s.t, dur: s.dur, imp, exp, pa, pi });
    }
    const days = [];
    for (const d of [...byDay.values()].sort((a, b) => a.day - b.day)) {
      const tot = d.imp + d.exp + d.miss;
      if (!d.fDur || (tot > 0 && d.miss / tot > 0.05)) continue; // not enough priced energy
      const dayEnd = C.addDays(d.day, 1);
      const frac = Math.min(1, (Math.min(to, dayEnd) - d.day) / (dayEnd - d.day)); // today: elapsed part
      d.fee = { dyn: (FEE.dyn / 365) * frac, var: (FEE.var / 365) * frac, fixed: (FEE.fixed / 365) * frac };
      days.push(d);
    }
    return { days, slots: out };
  }

  // Memoised range: every series of a card (same start/end) shares one computation.
  function range(hass, from, to) {
    const k = C.coefficients(hass);
    const live = to > Date.now() - C.HOUR;
    const key = `tariff|${from}|${to}|${JSON.stringify(k)}|${live ? C.tick() : 0}`;
    return C.memo(key, () => compute(hass, from, to));
  }
  // apexcharts' span end:day gives start = end - graph_span + 1 ms, which lands on 23:00 or 01:00 when the window
  // crosses a DST change: round to the nearest local midnight so the first day (x = noon) stays inside [start, end].
  const nearestMidnight = (ts) => {
    const m = C.localMidnight(ts);
    return ts - m > 12 * C.HOUR ? C.addDays(m, 1) : m;
  };
  const spanRange = (hass, o) => range(hass, nearestMidnight(+o.start), +o.end);
  const needsCompare = (k) => (k === "var" || k === "fixed") && !CMP;

  // Cost per day (EUR). key: 'dyn' | 'var' | 'fixed'. fee: false leaves out the fixed fee.
  async function day(hass, o) {
    const k = o.key || "dyn";
    if (needsCompare(k)) return [];
    const r = await spanRange(hass, o);
    return r.days.map((d) => [d.x, C.round(d[k] + (o.fee === false ? 0 : d.fee[k]), 3)]);
  }

  // Cumulative advantage of dynamic (EUR). key: 'var' | 'fixed' (their cost minus dynamic).
  async function cumulative(hass, o) {
    const k = o.key || "var";
    if (needsCompare(k)) return [];
    const r = await spanRange(hass, o);
    let s = 0;
    return r.days.map((d) => {
      s += d[k] + (o.fee === false ? 0 : d.fee[k]) - d.dyn - (o.fee === false ? 0 : d.fee.dyn);
      return [d.x, C.round(s, 3)];
    });
  }

  // Price per kWh per day (c€/kWh). key: 'weighted' (dynamic import price weighted with your import), 'flat' (plain
  // average of the dynamic import price), 'variable' (variable all-in, weighted), 'exp_weighted', 'exp_flat',
  // 'exp_fixed' (the comparison export price).
  async function price(hass, o) {
    const k = o.key || "weighted";
    if ((k === "variable" || k === "exp_fixed") && !CMP) return [];
    const r = await spanRange(hass, o);
    const minKWh = 0.1;
    const f = {
      weighted: (d) => (d.imp >= minKWh ? d.wA / d.imp : null),
      flat: (d) => d.fA / d.fDur,
      variable: (d) => (d.imp >= minKWh ? d.wV / d.imp : null),
      exp_weighted: (d) => (d.exp >= minKWh ? d.wI / d.exp : null),
      exp_flat: (d) => d.fI / d.fDur,
      exp_fixed: () => CMP.export / 100,
    }[k];
    const out = [];
    for (const d of r.days) {
      const v = f(d);
      if (v != null && Number.isFinite(v)) out.push([d.x, C.round(v * 100, 2)]);
    }
    return out;
  }

  // Average day over the last `days` complete days, per hour of the day, projected on the day of `start`.
  // key: 'price' (dynamic import price, c€/kWh), 'exp_price' (export price, c€/kWh), 'import' / 'export' (kWh).
  async function hour(hass, o) {
    const n = Math.max(1, Math.min(60, o.days ?? 14));
    const to = C.todayStart();
    const r = await range(hass, C.addDays(to, -n), to);
    const acc = Array.from({ length: 24 }, () => ({ pa: 0, pi: 0, dur: 0, imp: 0, exp: 0 }));
    const days = new Set(r.days.map((d) => d.day));
    for (const s of r.slots) {
      if (!days.has(C.localMidnight(s.t))) continue;
      const a = acc[C.hourOfDay(s.t)];
      a.pa += s.pa * s.dur;
      a.pi += s.pi * s.dur;
      a.dur += s.dur;
      a.imp += s.imp;
      a.exp += s.exp;
    }
    if (!days.size) return []; // no priced day: no chart instead of zeros
    const nd = days.size;
    const k = o.key || "price";
    const base = C.localMidnight(+o.start);
    const out = [];
    for (let h = 0; h < 24; h++) {
      const a = acc[h];
      const x = new Date(base);
      x.setHours(h, 30, 0, 0);
      let v;
      if (k === "price") v = a.dur ? (100 * a.pa) / a.dur : null;
      else if (k === "exp_price") v = a.dur ? (100 * a.pi) / a.dur : null;
      else v = (k === "export" ? a.exp : a.imp) / nd;
      out.push([x.getTime(), C.round(v ?? 0, 3)]);
    }
    return out;
  }

  // Diagnostics (browser console / test harness): per-day totals of the card window.
  async function days(hass, o) {
    const r = await spanRange(hass, o);
    return r.days.map((d) => [d.x, d]);
  }

  window.haKitEnergy.tariff = { day, cumulative, price, hour, days };
})();

// Base load (the house at night, 01:00-05:00) for the view "power" of the energy-analysis dashboard.
// Registers window.haKitEnergy.baseLoad = { night, rolling, month, costPerYear, phase, ventilation, nightPrice }.
// A night is keyed by its morning date: the point at local midnight of the 23rd is the night 22nd -> 23rd.
// House load at night (local hours 1..4) = grid import - export + battery discharge - car:
//   mean per hour : import.mean - export.mean + battery.mean - charger.mean
//   floor per hour: import.min + max(battery.mean, 0) - charger.min
//                   + min(battery.max, 0): only when the battery charged from the grid during the whole hour
//   base load     = median of the hourly floors of that night; night mean = mean of the hourly means.
// Data: hourly long-term statistics of the roles in house.yaml, fetched per calendar month so past months stay cached.
(() => {
  const C = window.haKitEnergyCore;
  const CFG = C.CFG;
  const ID = {
    imp: CFG.ids.imp_w,
    exp: CFG.ids.exp_w,
    bat: CFG.ids.bat_w,
    car: CFG.ids.charger_w,
    vent: CFG.ids.vent_w,
    c: (CFG.ids.phases || []).map((p) => p.imp),
    p: (CFG.ids.phases || []).map((p) => p.exp),
  };
  const BATTERY_PHASE = CFG.battery_phase || 0; // phase the battery inverter feeds (house.yaml), 0 = unknown
  const BAT_LIMIT = 10; // kW; larger hourly battery means are glitches
  const UNITS = { power: "kW" };
  const NIGHT_HOURS = new Set([1, 2, 3, 4]);
  const ROLL_DAYS = 30,
    ROLL_MIN = 20;
  const HISTORY_FROM = new Date(2015, 0, 1).getTime(); // statistics older than this are not asked for

  // Derived night lists: one slot per name (the newest key replaces the old one).
  const slots = new Map();
  const slot = (name, key, fn) => {
    const c = slots.get(name);
    if (c && c.key === key) return c.p;
    const p = fn().catch((e) => {
      if (slots.get(name)?.p === p) slots.delete(name);
      throw e;
    });
    slots.set(name, { key, p });
    return p;
  };
  const start0 = () => Math.max(C.since, HISTORY_FROM);
  const t0 = (o) => Math.max(+o.start, start0());
  const t1 = (o) => Math.min(+o.end, Date.now());
  const firstNight = (o) => C.localMidnight(t0(o));

  // Completed months never change: their promises are kept here for the whole page life.
  const done = new Map();
  function monthStats(hass, g, m) {
    const to = C.nextMonth(m);
    const q = { ids: g.ids, from: m, to, period: "hour", types: g.types, units: UNITS };
    if (to > Date.now() - C.DAY) return C.stats(hass, q);
    const k = `${g.ids.join(",")}|${g.types.join(",")}|${m}`;
    if (!done.has(k))
      done.set(
        k,
        C.stats(hass, q).catch((e) => {
          done.delete(k);
          throw e;
        }),
      );
    return done.get(k);
  }

  // Hourly statistics for `groups` ([{ids, types}]) over whole calendar months covering [from, to), night hours only.
  // The first month with data is found once (statistics before it are empty months and cost nothing).
  async function hourly(hass, groups, from, to) {
    const jobs = [];
    groups = groups.map((g) => ({ ...g, ids: g.ids.filter(Boolean) })).filter((g) => g.ids.length);
    for (let m = C.monthStart(from); m < to; m = C.nextMonth(m)) for (const g of groups) jobs.push(monthStats(hass, g, m));
    const res = await Promise.all(jobs);
    const rows = new Map();
    for (const r of res)
      for (const [id, list] of Object.entries(r))
        for (const row of list) {
          if (!NIGHT_HOURS.has(C.hourOfDay(row.start))) continue;
          if (!rows.has(row.start)) rows.set(row.start, {});
          rows.get(row.start)[id] = row;
        }
    return rows;
  }

  // Group hourly rows into nights; keep nights with hour 1 and hour 4 and at least 3 hours (the spring DST night has
  // only 3). Returns [{ts, hours: [{ts, r}]}] sorted by ts.
  function groupNights(rows, need) {
    const by = new Map();
    for (const [ts, r] of rows) {
      if (!need.every((id) => r[id])) continue;
      const k = C.localMidnight(ts);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ ts, r });
    }
    const out = [];
    for (const [k, hs] of by) {
      const h = new Set(hs.map((x) => C.hourOfDay(x.ts)));
      if (hs.length >= 3 && h.has(1) && h.has(4)) out.push({ ts: k, hours: hs.sort((a, b) => a.ts - b.ts) });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  const batKw = (r) => {
    const b = C.batteryKw(C.num(r[ID.bat]?.mean)) ?? 0;
    return Math.abs(b) > BAT_LIMIT ? 0 : b;
  };
  // Grid charging at night lifts the import minimum. Only when the battery charged during the whole hour (the most
  // discharging moment of the hour is still charging) is that part battery rather than house.
  const batChargeKw = (r) => {
    const raw = CFG.battery_sign === "charge_positive" ? C.num(r[ID.bat]?.min) : C.num(r[ID.bat]?.max);
    const x = C.batteryKw(raw);
    return x == null || x >= 0 || x < -BAT_LIMIT ? 0 : x;
  };
  const carMean = (r) => C.num(r[ID.car]?.mean) ?? 0;
  const carMin = (r) => C.num(r[ID.car]?.min) ?? 0;
  const batTypes = ["mean", "max", "min"];

  // Nights with house floor and mean (kW) from `from` (inclusive, local midnight) to `to`.
  async function nights(hass, from, to) {
    const rows = await hourly(
      hass,
      [
        { ids: [ID.imp, ID.car], types: ["mean", "min"] },
        { ids: [ID.exp], types: ["mean"] },
        { ids: [ID.bat], types: batTypes },
      ],
      from,
      to,
    );
    return groupNights(rows, [ID.imp, ID.exp])
      .filter((n) => n.ts >= from && n.ts < to)
      .map((n) => {
        const fl = [],
          mn = [];
        let bat = 0,
          car = 0;
        for (const { r } of n.hours) {
          if (C.num(r[ID.imp].min) == null || C.num(r[ID.imp].mean) == null) continue;
          const b = batKw(r);
          fl.push(r[ID.imp].min + Math.max(b, 0) + batChargeKw(r) - carMin(r));
          mn.push(r[ID.imp].mean - (r[ID.exp].mean ?? 0) + b - carMean(r));
          bat += b;
          car += carMean(r);
        }
        if (fl.length < 3) return null;
        return { ts: n.ts, floor: Math.max(C.median(fl), 0), mean: Math.max(C.mean(mn), 0), bat: bat / fl.length, car: car / fl.length };
      })
      .filter((n) => n && Number.isFinite(n.floor) && Number.isFinite(n.mean));
  }

  // Night list over the window of the card (one computation per 5 minutes and window start).
  const allNights = (hass, o) => {
    const from = C.monthStart(t0(o));
    return slot(`nights|${from}`, C.tick(), () => nights(hass, from, C.addDays(C.todayStart(), 1)));
  };
  const inRange = (list, o) => list.filter((n) => n.ts >= firstNight(o) && n.ts <= +o.end);

  // (1) Base load per night, kW (opts.unit 'W' gives W).
  async function night(hass, o) {
    const unit = o.unit === "W" ? 1000 : 1;
    return inRange(await allNights(hass, o), o).map((n) => [n.ts, C.round(n.floor * unit, unit === 1 ? 3 : 0)]);
  }

  // (1) Rolling median of the base load over the last 30 nights (at least 20 nights with data), kW.
  async function rolling(hass, o) {
    const list = await allNights(hass, o);
    const out = [];
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const lo = C.addDays(list[i].ts, -(ROLL_DAYS - 1));
      while (list[j].ts < lo) j++;
      if (i - j + 1 < ROLL_MIN) continue;
      if (list[i].ts < firstNight(o) || list[i].ts > +o.end) continue;
      out.push([list[i].ts, C.round(C.median(list.slice(j, i + 1).map((n) => n.floor)), 3)]);
    }
    return out;
  }

  // Average import price at night (EUR/kWh, all-in) over the 01-05 h hours of the last 90 days, from the spot price
  // statistics and window.haKitTariff. Null without a tariff module or spot statistics. Kept in api.price for the
  // tooltip formatters.
  async function nightPrice(hass) {
    if (!window.haKitTariff || !CFG.ids.spot) return null;
    const to = C.addDays(C.todayStart(), 1);
    const from = C.addDays(C.todayStart(), -90);
    const spot = await C.spot(hass, from, to);
    const p = [];
    for (const [ts, mwh] of spot) if (NIGHT_HOURS.has(C.hourOfDay(ts))) p.push(C.importPrice(mwh, ts, hass));
    let eur = p.length ? C.mean(p) : null;
    if (eur == null) {
      const now = C.num(hass?.states?.[CFG.ids.spot]?.state);
      if (now != null) eur = C.importPrice(now * C.spotFactor(hass), new Date().setHours(3, 0, 0, 0), hass);
    }
    api.price = eur;
    return eur;
  }

  // (2) Average house load 01-05 h per month (without the car, battery discharge included), kW, x = month start.
  async function month(hass, o) {
    const [, list] = await Promise.all([nightPrice(hass).catch(() => null), allNights(hass, o)]);
    const by = new Map();
    for (const n of list) {
      const m = C.monthStart(n.ts);
      if (!by.has(m)) by.set(m, []);
      by.get(m).push(n.mean);
    }
    return [...by.entries()]
      .filter(([m]) => m >= C.monthStart(+o.start) && m <= +o.end)
      .sort((a, b) => a[0] - b[0])
      .map(([m, v]) => [m, C.round(C.mean(v), 3)]);
  }

  // (2) Header: what the average night load of the last `nights` nights costs per year at the night price
  // (kW x 8760 h x EUR/kWh). opts.out: 'eur' (default; nothing without a price) or 'kw'.
  async function costPerYear(hass, o) {
    const [eur, list] = await Promise.all([nightPrice(hass).catch(() => null), allNights(hass, o)]);
    const last = list.slice(-(o.nights || 30));
    const kw = C.mean(last.map((n) => n.mean)) ?? 0;
    if (o.out === "kw") return [[Date.now(), C.round(kw, 2)]];
    return eur == null ? [] : [[Date.now(), Math.round(kw * 8760 * eur)]];
  }

  // (3) Base load per phase (W): median of hourly min(import) - mean(export) (+ battery on its phase) - charger/3.
  // All phases share the same nights. opts.phase: 1..n | 'sum'.
  async function phaseNights(hass, from, to) {
    const rows = await hourly(
      hass,
      [
        { ids: [...ID.c, ID.car], types: ["mean", "min"] },
        { ids: [...ID.p], types: ["mean"] },
        { ids: [ID.bat], types: batTypes },
      ],
      from,
      to,
    );
    const n = ID.c.length;
    return groupNights(rows, [...ID.c, ...ID.p.filter(Boolean)])
      .filter((x) => x.ts >= from && x.ts < to)
      .map((x) => {
        const f = ID.c.map((cid, k) =>
          C.median(
            x.hours
              .map(({ r }) => {
                const c = C.num(r[cid].min);
                if (c == null) return NaN;
                const pid = ID.p[k];
                return (
                  c -
                  ((pid && C.num(r[pid]?.mean)) ?? 0) +
                  (k + 1 === BATTERY_PHASE ? Math.max(batKw(r), 0) + batChargeKw(r) : 0) -
                  carMin(r) / n
                );
              })
              .filter(Number.isFinite),
          ),
        );
        // A night without a value on one phase is dropped for all, so the stacked series keep equal x-values.
        return f.some((v) => v == null) ? null : { ts: x.ts, f: f.map((v) => Math.max(v, 0)) };
      })
      .filter(Boolean);
  }
  async function phase(hass, o) {
    if (!ID.c.length) return [];
    const from = C.localMidnight(t0(o)),
      to = C.addDays(C.localMidnight(t1(o)), 1);
    const list = await slot("phase", `${from}|${to}|${C.tick()}`, () => phaseNights(hass, from, to));
    return list.map((n) => {
      const v = o.phase === "sum" ? n.f.reduce((a, b) => a + b, 0) : n.f[o.phase - 1];
      return [n.ts, Math.round(v * 1000)];
    });
  }

  // (4) Ventilation in the base load (W), nights with ventilation data only. opts.series: 'ventilation' | 'rest'.
  async function ventilation(hass, o) {
    if (!ID.vent) return [];
    const from = C.localMidnight(t0(o)),
      to = C.addDays(C.localMidnight(t1(o)), 1);
    const list = await slot("vent", `${from}|${to}|${C.tick()}`, async () => {
      const [rows, all] = await Promise.all([hourly(hass, [{ ids: [ID.vent], types: ["mean"] }], from, to), allNights(hass, o)]);
      const vent = new Map(
        groupNights(rows, [ID.vent]).map((n) => [n.ts, C.mean(n.hours.map(({ r }) => C.num(r[ID.vent].mean)).filter((x) => x != null))]),
      );
      return all.filter((n) => vent.get(n.ts) != null && n.ts >= from && n.ts < to).map((n) => ({ ts: n.ts, floor: n.floor, vent: vent.get(n.ts) }));
    });
    return list.map((n) => {
      const v = o.series === "ventilation" ? Math.min(n.vent, n.floor) : Math.max(n.floor - n.vent, 0);
      return [n.ts, Math.round(v * 1000)];
    });
  }

  const api = { night, rolling, month, costPerYear, phase, ventilation, nightPrice, price: null };
  window.haKitEnergy.baseLoad = api;
})();

// Battery analyses for the view "battery" of the energy-analysis dashboard (needs entities.battery_soc).
// Registers window.haKitEnergy.battery = { savingDay, savingTotal, investment, socToday, socAverage, emptyAt,
//   daysFull, daysNotFull, moduleKwh, moduleTotal, profile }.
// Sources: battery charge/discharge meters (entities.battery_charge_kwh / battery_discharge_kwh; else the battery
// power means), the state of charge, the grid import/export meters, and the spot price with window.haKitTariff for
// the savings (no tariff module = no savings cards). 5-minute statistics for the last ~8 days, hourly before.
(() => {
  const C = window.haKitEnergyCore;
  const CFG = C.CFG;
  const IDS = CFG.ids;
  const B = CFG.battery || {};
  const { MIN5, HOUR } = C;
  const ID = { chg: IDS.chg_kwh, dis: IDS.dis_kwh, bat: IDS.bat_w, soc: IDS.soc, imp: IDS.imp_kwh || [], exp: IDS.exp_kwh || [] };
  const METERS = !!(ID.chg && ID.dis); // else the charge/discharge energy comes from the power means
  const HISTORY_DAYS = 400; // the model covers at most this many days (the dashboard shows 90)
  const ETA = B.efficiency || 0.9; // round-trip efficiency
  const MODULE_KWH = B.module_kwh || 0; // usable kWh of one extra module; 0 = no "extra module" cards
  const SOC_EMPTY = B.reserve_percent ?? 20; // reserve floor = empty
  const SOC_FULL = B.full_percent ?? 95; // "fully charged" for the day count
  const MOD_FULL = 99; // hours in which surplus had nowhere to go
  const MOD_EMPTY = SOC_EMPTY + 1; // hours in which the battery was empty
  const MORNING = 33; // 09:00 next day: value used when the battery lasted the whole night

  const at = (ts, h, m = 0) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  };
  // x for hour-of-day h on the day of ts; null for the hour that does not exist on the spring DST day.
  const hourX = (ts, h, m = 0) => {
    const t = at(ts, h, m);
    return new Date(t).getHours() === h ? t : null;
  };
  const start = () => Math.max(C.since, C.addDays(C.todayStart(), -HISTORY_DAYS));
  const horizon = () => C.addDays(C.todayStart(), 1); // stable 'to' so all cards share one fetch
  const fineFrom = () => C.addDays(C.todayStart(), -8); // inside the ~10-day 5-minute retention
  const yearBack = (ts) => {
    const d = new Date(ts);
    d.setFullYear(d.getFullYear() - 1);
    return d.getTime();
  };
  // Clock time as decimal hours relative to local midnight of `day` (next day counts from 24).
  const clock = (ts, day) => {
    const d = new Date(ts);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + (C.localMidnight(ts) > day ? 24 : 0);
  };
  const endDay = () => C.todayStart();
  const inWindow = (pts, o) => pts.filter(([t]) => t >= +o.start && t <= +o.end);
  // EUR/kWh for import (pa) and export (pi) at ts from the spot price (EUR/MWh); null without a tariff module.
  const prices = (ts, spot, hass) =>
    spot == null || !window.haKitTariff ? null : { pa: C.importPrice(spot, ts, hass), pi: C.exportPrice(spot, ts) };

  function slot(map, ts, len) {
    let s = map.get(ts);
    if (!s) {
      s = { t: ts, len, chg: 0, dis: 0, imp: 0, exp: 0, cnt: false, mean: null, min: null, max: null, spot: null };
      map.set(ts, s);
    }
    return s;
  }
  function addChange(map, len, rows, key) {
    for (const r of rows || []) {
      if (r.change == null) continue;
      const s = slot(map, r.start, len);
      s[key] += r.change;
      if (key === "chg" || key === "dis") s.cnt = true;
    }
  }
  // Without meters: charge/discharge energy of a row from the battery power mean (kW x hours).
  function addPower(map, len, rows) {
    for (const r of rows || []) {
      const kw = C.batteryKw(r.mean);
      if (kw == null) continue;
      const s = slot(map, r.start, len);
      const kwh = (kw * len) / HOUR;
      s.dis += Math.max(kwh, 0);
      s.chg += Math.max(-kwh, 0);
      s.cnt = true;
    }
  }
  function addSoc(map, len, rows) {
    for (const r of rows || []) Object.assign(slot(map, r.start, len), { mean: r.mean, min: r.min, max: r.max });
  }

  // Moment the battery hit the reserve on the evening of day d (decimal hours, > 24 = after midnight): the first slot
  // from 16:00 with min <= reserve; when it was already empty at that slot's start it steps back to the slot in which
  // it went empty. Within the slot the moment is estimated from mean/min/max (linear decline, then the floor).
  function emptyMoment(d, socSlots) {
    const w0 = at(d, 16),
      w1 = at(C.addDays(d, 1), 9);
    const sl = socSlots(at(d, 10), w1);
    if (!sl.length) return null;
    const i = sl.findIndex((s) => s.t >= w0 && s.min <= SOC_EMPTY);
    if (i < 0) {
      const last = sl[sl.length - 1];
      const complete = w1 <= Date.now() && last.t + last.len >= w1 - HOUR;
      return complete && sl.some((s) => s.t >= w0 && s.max > SOC_EMPTY) ? MORNING : null;
    }
    let j = i;
    if (sl[i].max <= SOC_EMPTY) {
      j = i - 1;
      while (j >= 0 && sl[j].max <= SOC_EMPTY) j--;
      if (j < 0) return null; // not charged since 10:00
    }
    const s = sl[j];
    const x = s.min > SOC_EMPTY ? 1 : s.max > s.min ? Math.min(1, Math.max(0, (2 * (s.mean - s.min)) / (s.max - s.min))) : 0;
    return clock(s.t + x * s.len, d);
  }

  // Rows before yesterday 00:00 are final: fetch them once per day; refetch only the last ~2 days every 5 minutes.
  let histDay = null;
  const hist = new Map();
  function split(hass, q) {
    const cut = C.addDays(C.todayStart(), -1);
    if (histDay !== cut) {
      histDay = cut;
      hist.clear();
    }
    const k = `${q.ids.join(",")}|${q.from}|${q.period}|${q.types.join(",")}`;
    if (!hist.has(k))
      hist.set(
        k,
        q.from < cut
          ? C.stats(hass, { ...q, to: cut }).catch((e) => {
              hist.delete(k);
              throw e;
            })
          : Promise.resolve({}),
      );
    return Promise.all([hist.get(k), C.stats(hass, { ...q, from: Math.max(q.from, cut) })]).then(([a, b]) => {
      const out = {};
      for (const id of q.ids) out[id] = [...(a[id] || []).filter((r) => r.start < cut), ...(b[id] || [])];
      return out;
    });
  }

  // One shared model per 5-minute tick: hourly + 5-minute slots and per-day aggregates.
  let modelKey = null,
    modelP = null;
  const moduleCache = new Map();
  function model(hass) {
    const key = `${C.tick()}`;
    if (key !== modelKey) {
      modelKey = key;
      moduleCache.clear();
      modelP = build(hass).catch((e) => {
        if (modelKey === key) modelKey = null;
        throw e;
      });
    }
    return modelP;
  }
  async function build(hass) {
    const from = start(),
      to = horizon(),
      ff = fineFrom();
    const energyIds = [...(METERS ? [ID.chg, ID.dis] : []), ...ID.imp, ...ID.exp];
    const [cnt, pw, soc, fcnt, fpw, fsoc, spotH, spot5] = await Promise.all([
      split(hass, { ids: energyIds, from, to, period: "hour", types: ["change"] }),
      METERS ? {} : split(hass, { ids: [ID.bat], from, to, period: "hour", types: ["mean"] }),
      split(hass, { ids: [ID.soc], from, to, period: "hour", types: ["mean", "min", "max"] }),
      METERS ? split(hass, { ids: [ID.chg, ID.dis], from: ff, to, period: "5minute", types: ["change"] }) : {},
      METERS ? {} : split(hass, { ids: [ID.bat], from: ff, to, period: "5minute", types: ["mean"] }),
      split(hass, { ids: [ID.soc], from: ff, to, period: "5minute", types: ["mean", "min", "max"] }),
      window.haKitTariff ? C.spot(hass, from, to, "hour") : new Map(),
      window.haKitTariff ? C.spot(hass, ff, to, "5minute") : new Map(),
    ]);
    const H = new Map(),
      F = new Map();
    if (METERS) {
      addChange(H, HOUR, cnt[ID.chg], "chg");
      addChange(H, HOUR, cnt[ID.dis], "dis");
      addChange(F, MIN5, fcnt[ID.chg], "chg");
      addChange(F, MIN5, fcnt[ID.dis], "dis");
    } else {
      addPower(H, HOUR, pw[ID.bat]);
      addPower(F, MIN5, fpw[ID.bat]);
    }
    for (const id of ID.imp) addChange(H, HOUR, cnt[id], "imp");
    for (const id of ID.exp) addChange(H, HOUR, cnt[id], "exp");
    addSoc(H, HOUR, soc[ID.soc]);
    addSoc(F, MIN5, fsoc[ID.soc]);
    for (const [t, v] of spotH) slot(H, t, HOUR).spot = v;
    for (const [t, v] of spot5) slot(F, t, MIN5).spot = v;
    const hrs = [...H.values()].sort((a, b) => a.t - b.t);
    const fine = [...F.values()].sort((a, b) => a.t - b.t);
    // Spot price: the 5-minute mean, else the hour mean, else carry the last known price forward.
    let last = null;
    for (const s of hrs) s.spot == null ? (s.spot = last) : (last = s.spot);
    last = null;
    for (const s of fine) {
      if (s.spot == null) s.spot = H.get(s.t - (s.t % HOUR))?.spot ?? last;
      last = s.spot;
    }
    // Hour-aligned switch-over from hourly to 5-minute data (energy and SoC separately).
    const firstFine = (pred) => {
      const s = fine.find(pred);
      return s ? Math.max(ff, Math.ceil(s.t / HOUR) * HOUR) : Infinity;
    };
    const cutCnt = firstFine((s) => s.cnt);
    const cutSoc = firstFine((s) => s.min != null);
    const socSlots = (a, b) => {
      const useFine = a >= cutSoc,
        m = useFine ? F : H,
        step = useFine ? MIN5 : HOUR,
        out = [];
      for (let ts = a; ts < b; ts += step) {
        const s = m.get(ts);
        if (s && s.min != null && s.max != null && s.mean != null) out.push(s);
      }
      return out;
    };
    const today = C.todayStart();
    const firstData = hrs.find((s) => s.cnt || s.mean != null);
    const D = new Map();
    for (let d = firstData ? C.localMidnight(firstData.t) : today; d <= today; d = C.addDays(d, 1))
      D.set(d, { d, cnt: false, priced: false, saving: 0, chg: 0, dis: 0, max: null, empty: null });
    const dayOf = (ts) => D.get(C.localMidnight(ts));
    const addSaving = (s) => {
      const r = dayOf(s.t);
      if (!r || !s.cnt) return;
      const p = prices(s.t, s.spot, hass);
      if (p) {
        r.saving += s.dis * p.pa - s.chg * p.pi;
        r.priced = true;
      }
      r.chg += s.chg;
      r.dis += s.dis;
      r.cnt = true;
    };
    for (const s of hrs) if (s.t < cutCnt) addSaving(s);
    for (const s of fine) if (s.t >= cutCnt) addSaving(s);
    for (const s of [...hrs, ...fine]) {
      const r = dayOf(s.t);
      if (r && s.max != null) r.max = Math.max(r.max ?? 0, s.max);
    }
    for (const r of D.values()) r.empty = emptyMoment(r.d, socSlots);
    return { H, hrs, fine, days: [...D.values()], cutCnt, cutSoc, first: firstData ? C.localMidnight(firstData.t) : today };
  }

  // (1) Savings per day (EUR): discharged x import price - charged x export price (the export it cost).
  async function savingDay(hass, o) {
    const m = await model(hass);
    return inWindow(m.days.filter((r) => r.priced).map((r) => [at(r.d, 12), C.round(r.saving, 2)]), o);
  }
  // (1) Running total over the window (EUR).
  async function savingTotal(hass, o) {
    const m = await model(hass);
    let c = 0;
    const pts = [];
    for (const r of m.days) if (r.priced && at(r.d, 12) >= +o.start) pts.push([at(r.d, 12), C.round((c += r.saving), 2)]);
    return inWindow(pts, o);
  }
  // (1) Flat line at the investment (house.yaml energy.battery_investment_eur), one point per day; none when not set.
  async function investment(hass, o) {
    const v = B.investment_eur;
    if (!v) return [];
    const m = await model(hass);
    const pts = [];
    for (let d = Math.max(m.first, C.localMidnight(+o.start)); d <= C.todayStart(); d = C.addDays(d, 1)) pts.push([at(d, 12), v]);
    return inWindow(pts, o);
  }

  // (2) State of charge today (5-minute means) plus the live state.
  async function socToday(hass, o) {
    const m = await model(hass);
    const s0 = +o.start,
      s1 = Math.min(+o.end, Date.now());
    const useFine = s0 >= m.cutSoc;
    const pts = (useFine ? m.fine : m.hrs)
      .filter((s) => s.t >= s0 && s.t < s1 && s.mean != null)
      .map((s) => [s.t + (useFine ? 0 : 30 * 60000), C.round(s.mean, 1)]);
    const now = Date.now(),
      live = C.num(hass?.states?.[ID.soc]?.state);
    if (live != null && now >= s0 && now <= +o.end && (!pts.length || pts[pts.length - 1][0] < now)) pts.push([now, live]);
    return pts;
  }
  // (2) Average state of charge per hour of the day over the last `days` full days, on the day of `start` (hh:30).
  async function socAverage(hass, o) {
    const n = o.days ?? 30,
      m = await model(hass);
    const d1 = endDay(),
      d0 = C.addDays(d1, -n);
    const sum = Array(24).fill(0),
      cnt = Array(24).fill(0);
    for (const s of m.hrs)
      if (s.t >= d0 && s.t < d1 && s.mean != null) {
        const h = C.hourOfDay(s.t);
        sum[h] += s.mean;
        cnt[h]++;
      }
    return sum.flatMap((v, h) => {
      const x = hourX(o.start, h, 30);
      return cnt[h] && x != null ? [[x, C.round(v / cnt[h], 1)]] : [];
    });
  }

  // (3) Moment the battery ran empty per evening, decimal hours (21.92 = 21:55, 25.5 = 01:30, 33 = lasted the night).
  async function emptyAt(hass, o) {
    const m = await model(hass);
    return inWindow(m.days.filter((r) => r.empty != null).map((r) => [at(r.d, 12), C.round(r.empty, 2)]), o);
  }
  // (3) Donut: complete days in the window that reached the full threshold, or not.
  async function countDays(hass, o, full) {
    const m = await model(hass),
      today = C.todayStart();
    const ds = m.days.filter((r) => at(r.d, 12) >= +o.start && r.d < today && r.max != null);
    return [[Math.min(Date.now(), +o.end), ds.filter((r) => r.max >= SOC_FULL === full).length]];
  }
  const daysFull = (hass, o) => countDays(hass, o, true);
  const daysNotFull = (hass, o) => countDays(hass, o, false);

  // (4) Measured upper bound for extra modules per day: min(export in hours with SoC >= 99 % x efficiency; import in
  // hours with an empty battery from 12:00 until 09:00 next morning; module kWh x modules). Value in EUR = shifted kWh
  // x weighted import price - (shifted kWh / efficiency) x weighted export price.
  function modules(hass, n) {
    const p = model(hass),
      k = `${n}`;
    if (!moduleCache.has(k)) moduleCache.set(k, p.then((m) => moduleRows(m, n, hass)));
    return moduleCache.get(k);
  }
  function moduleRows(m, n, hass) {
    const H = m.H;
    return m.days.map((r) => {
      let a = 0,
        ai = 0,
        b = 0,
        ba = 0;
      for (let ts = r.d, e = C.addDays(r.d, 1); ts < e; ts += HOUR) {
        const s = H.get(ts);
        if (s && s.max != null && s.max >= MOD_FULL && s.exp > 0) {
          a += s.exp;
          ai += s.exp * (prices(ts, s.spot, hass)?.pi ?? 0);
        }
      }
      for (let ts = at(r.d, 12), e = at(C.addDays(r.d, 1), 9); ts < e; ts += HOUR) {
        const s = H.get(ts);
        if (s && s.min != null && s.min <= MOD_EMPTY && s.imp > 0) {
          b += s.imp;
          ba += s.imp * (prices(ts, s.spot, hass)?.pa ?? 0);
        }
      }
      const kwh = Math.min(a * ETA, b, MODULE_KWH * n);
      const eur = kwh > 0 ? kwh * (ba / b) - (kwh / ETA) * (ai / a) : 0;
      return { d: r.d, kwh, eur };
    });
  }
  async function moduleKwh(hass, o) {
    if (!MODULE_KWH) return [];
    const rows = await modules(hass, o.modules ?? 1);
    return inWindow(rows.map((r) => [at(r.d, 12), C.round(r.kwh, 2)]), o);
  }
  async function moduleTotal(hass, o) {
    if (!MODULE_KWH || !window.haKitTariff) return [];
    const rows = await modules(hass, o.modules ?? 1);
    let c = 0;
    return inWindow(rows.filter((r) => at(r.d, 12) >= +o.start).map((r) => [at(r.d, 12), C.round((c += r.eur), 2)]), o);
  }

  // (5) Day profile per hour (kW = kWh per hour) over the last `days` full days, on the day of `start`.
  // series: 'import' | 'export'; period: 'recent' (measured), 'without' (recent + discharged / + charged: the same days
  // without a battery), 'last_year' (same dates one year earlier, grid meters only).
  async function profile(hass, o) {
    const series = o.series ?? "import",
      period = o.period ?? "recent",
      n = o.days ?? 30;
    const d1 = endDay(),
      d0 = C.addDays(d1, -n);
    const sum = Array(24).fill(0),
      cnt = Array(24).fill(0);
    const add = (ts, v) => {
      const h = C.hourOfDay(ts);
      sum[h] += v;
      cnt[h]++;
    };
    if (period === "last_year") {
      const ids = series === "import" ? ID.imp : ID.exp;
      const r = await C.stats(hass, { ids, from: yearBack(d0), to: yearBack(d1), period: "hour", types: ["change"] });
      for (const [ts, v] of C.summed(r, ids)) if (v != null) add(ts, v);
    } else {
      const m = await model(hass);
      for (const s of m.hrs) {
        if (s.t < d0 || s.t >= d1 || !s.cnt) continue;
        let v = series === "import" ? s.imp : s.exp;
        if (period === "without") v += series === "import" ? s.dis : s.chg;
        add(s.t, v);
      }
    }
    return sum.flatMap((v, h) => {
      const x = hourX(o.start, h);
      return x == null || !cnt[h] ? [] : [[x, C.round(v / cnt[h], 3)]];
    });
  }

  window.haKitEnergy.battery = {
    savingDay,
    savingTotal,
    investment,
    socToday,
    socAverage,
    emptyAt,
    daysFull,
    daysNotFull,
    moduleKwh,
    moduleTotal,
    profile,
  };
})();

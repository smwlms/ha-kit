// Peak power and capacity tariff for the view "power" of the energy-analysis dashboard.
// Registers window.haKitEnergy.peak = { monthPeak, dayPeak, perHour, phases, whoPeak, cost, info }; `info` holds side
// data for the tooltip formatters (time of the peak quarter per day, source per month, kWh to shift per limit).
// Sources:
// - quarters: 5-minute 'change' of the grid import meters (summed registers), 3 rows per quarter, x 4 = kW (~10 days
//   kept); phase split from the 5-minute 'mean' of grid_phases[].import_w / export_w (the meter nets the phases).
// - meter (optional roles): grid_quarter_kw (hourly max = highest quarter of that hour) and grid_month_peak_kw; with
//   tariff-be and no meter register: sensor.capacity_quarter_expected_kw and sensor.capacity_month_peak_kw.
// - history: hourly 'change' of the import meters (highest hourly average = lower bound of the quarter peak).
(() => {
  const C = window.haKitEnergyCore;
  const CFG = C.CFG;
  const S = CFG.strings || {};
  const IMP = CFG.ids.imp_kwh || [];
  const PH_IMP = (CFG.ids.phases || []).map((p) => p.imp);
  const PH_EXP = (CFG.ids.phases || []).map((p) => p.exp);
  const QUARTER_ID = CFG.ids.quarter;
  const MONTH_ID = CFG.ids.month_peak;
  const info = { day: {}, who: {}, month: {}, kwh: [] };
  const pad = (n) => String(n).padStart(2, "0");
  const monthKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const hhmm = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const noon = (ts) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  };
  const fmt = (text, v) => String(text || "").replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  // Floor of every month peak and the capacity price: the tariff module's helpers, else house.yaml.
  const floorKw = (hass) => C.coefficients(hass)?.capacityMinimumKw ?? CFG.capacity_minimum_kw ?? 0;
  const capacityPrice = (hass) => C.coefficients(hass)?.capacityEurPerKwYear ?? null;
  const avg3 = (m, t) => {
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const v = m.get(t + k * C.MIN5);
      if (v == null) return null;
      s += v;
    }
    return s / 3;
  };

  // ---- quarters of the last ~10 days: [{ t, kw, l: [import per phase] | null, p: [export per phase] | null }] ----
  async function quarters(hass, withPhases = false) {
    withPhases = withPhases && PH_IMP.length > 0;
    const from = C.addDays(C.todayStart(), -10);
    const to = C.addDays(C.todayStart(), 1);
    return C.memo(`peak|q|${withPhases}|${from}|${C.tick()}`, async () => {
      const [e, ph] = await Promise.all([
        C.stats(hass, { ids: IMP, from, to, period: "5minute", types: ["change"] }),
        withPhases
          ? C.stats(hass, { ids: [...PH_IMP, ...PH_EXP.filter(Boolean)], from, to, period: "5minute", types: ["mean"], units: { power: "kW" } })
          : null,
      ]);
      const sum = C.summed(e, IMP);
      const imp = withPhases ? PH_IMP.map((id) => C.byStart(ph[id], "mean")) : null;
      const exp = withPhases ? PH_EXP.map((id) => (id ? C.byStart(ph[id], "mean") : new Map())) : null;
      const out = [];
      for (const t of sum.keys()) {
        if (t % C.QUARTER !== 0) continue;
        let kwh = 0,
          ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          const a = sum.get(t + k * C.MIN5);
          // missing row, or the first retained row (whole meter reading, nulled by core.stats)
          if (a == null) ok = false;
          else kwh += a;
        }
        if (!ok) continue;
        const q = { t, kw: kwh * 4, l: null, p: null };
        if (withPhases) {
          const l = imp.map((m) => avg3(m, t)),
            p = exp.map((m) => (m.size ? avg3(m, t) : 0));
          if (!l.some((x) => x == null)) q.l = l;
          if (!p.some((x) => x == null)) q.p = p;
        }
        out.push(q);
      }
      return out.sort((a, b) => a.t - b.t);
    });
  }

  // Export on one phase (battery, sun) that the meter nets against import on the others, capped at that import.
  const netted = (q) => Math.min(q.p.reduce((a, b) => a + b, 0), q.l.reduce((a, b) => a + b, 0));

  function byDay(Q) {
    const days = new Map();
    for (const q of Q) {
      const d = C.localMidnight(q.t);
      const o = days.get(d) || { n: 0, top: null, first: q.t };
      o.n++;
      if (!o.top || q.kw > o.top.kw) o.top = q;
      if (q.t < o.first) o.first = q.t;
      days.set(d, o);
    }
    return days;
  }
  // Days at the start of the 5-minute window are cut off: keep them only with at least half a day of quarters.
  const fullEnough = (d, o) => o.n >= 48 || d === C.todayStart();

  // ---- (1) month peak: the meter's month peak where recorded, the hourly lower bound always ----
  async function monthly(hass, start, end) {
    const from = C.monthStart(start);
    const cur = C.monthStart(Date.now());
    return C.memo(`peak|m|${from}|${end}|${C.tick()}`, async () => {
      const hourly = async (a, b) => (b > a ? C.stats(hass, { ids: IMP, from: a, to: b, period: "hour", types: ["change"] }) : {});
      const [old, now, met] = await Promise.all([
        hourly(from, Math.min(cur, end)),
        hourly(Math.max(from, cur), end),
        MONTH_ID || QUARTER_ID
          ? C.stats(hass, { ids: [MONTH_ID, QUARTER_ID], from, to: end, period: "hour", types: ["max"], units: { power: "kW" } })
          : {},
      ]);
      const low = new Map(); // month -> highest hourly average (kW)
      for (const part of [old, now]) {
        for (const [t, v] of C.summed(part, IMP)) {
          if (v == null) continue;
          const k = monthKey(t);
          if (!(low.get(k) >= v)) low.set(k, v);
        }
      }
      // Month peak register: skip the first hour of a month (the previous month's value can linger for a moment after
      // midnight) and take the quarter register for that hour instead. Without a month register: the highest quarter.
      const meter = new Map();
      const qh = C.byStart(met[QUARTER_ID], "max");
      const rows = MONTH_ID ? met[MONTH_ID] || [] : (met[QUARTER_ID] || []).map((r) => ({ ...r }));
      for (const r of rows) {
        const v = MONTH_ID && r.start === C.monthStart(r.start) ? qh.get(r.start) : r.max;
        if (v == null) continue;
        const k = monthKey(r.start);
        if (!(meter.get(k) >= v)) meter.set(k, v);
      }
      const months = [];
      for (let m = C.monthStart(start); m <= end; m = C.nextMonth(m)) {
        const d = new Date(m);
        const x = new Date(d.getFullYear(), d.getMonth(), 15).getTime(); // mid-month: the column sits inside its month
        if (x < start || x > end) continue;
        const k = monthKey(m);
        const o = { x, k, hour: low.get(k) ?? null, meter: meter.get(k) ?? null };
        info.month[k] = o.meter != null ? S.peak_source_meter : o.hour != null ? S.peak_source_hourly : S.peak_source_none;
        months.push(o);
      }
      return months;
    });
  }

  // opts.source: 'hour' (base: highest hourly average, a lower bound) | 'meter' (the part above the base, so the
  // stacked column reaches the real quarter peak) | 'year_cost' (one point: 12-month average of max(peak, floor) x
  // capacity price in EUR/year, for the card header; months without a meter value count with their lower bound).
  async function monthPeak(hass, opts) {
    const start = +opts.start,
      end = +opts.end;
    const M = await monthly(hass, start, end);
    const source = opts.source || "hour";
    if (source === "year_cost") {
      const price = capacityPrice(hass);
      const last = M.slice(-12)
        .map((o) => o.meter ?? o.hour)
        .filter((v) => v != null);
      if (!last.length || price == null) return [];
      const fl = floorKw(hass);
      const avg = last.reduce((a, v) => a + Math.max(v, fl), 0) / last.length;
      return [[Math.min(Date.now(), end), C.round(avg * price, 1)]];
    }
    return M.map((o) => {
      const base = o.hour ?? 0;
      const v = source === "hour" ? base : o.meter != null ? Math.max(o.meter - base, 0) : 0;
      return [o.x, C.round(v, 3)];
    });
  }

  // ---- (2) highest quarter per day: quarters (~10 days) combined with the quarter register's hourly max ----
  async function daily(hass, start, end) {
    return C.memo(`peak|d|${start}|${end}|${C.tick()}`, async () => {
      const [Q, met] = await Promise.all([
        quarters(hass),
        QUARTER_ID ? C.stats(hass, { ids: [QUARTER_ID], from: start, to: end, period: "hour", types: ["max"], units: { power: "kW" } }) : {},
      ]);
      const days = new Map();
      for (const [d, o] of byDay(Q))
        if (fullEnough(d, o)) {
          // The nightly recorder purge cuts off the night of the oldest day: its peak may be too low.
          const cut = o.first - d > 30 * 60000;
          days.set(d, { kw: o.top.kw, time: hhmm(o.top.t) + (cut ? ` ${fmt(S.peak_cut, { time: hhmm(o.first) })}` : "") });
        }
      for (const r of met[QUARTER_ID] || []) {
        if (r.max == null) continue;
        const d = C.localMidnight(r.start),
          o = days.get(d);
        // The register wins when it saw more (a day that fell out of the 5-minute window, or HA restarts).
        if (!o || r.max > o.kw + 0.02) days.set(d, { kw: r.max, time: fmt(S.peak_register_hour, { hour: pad(C.hourOfDay(r.start)) }) });
      }
      const out = [...days.entries()].filter(([d]) => noon(d) >= start && noon(d) <= end).sort((a, b) => a[0] - b[0]);
      for (const [d, o] of out) info.day[C.dayKey(d)] = o.time;
      return out;
    });
  }

  // opts.part: 'below' (up to the target) | 'above' (part above it) | 'total'; opts.target in kW.
  async function dayPeak(hass, opts) {
    const target = opts.target ?? CFG.peak_target_kw ?? 3;
    const D = await daily(hass, +opts.start, +opts.end);
    return D.map(([d, o]) => {
      const v = opts.part === "above" ? Math.max(o.kw - target, 0) : opts.part === "below" ? Math.min(o.kw, target) : o.kw;
      return [noon(d), C.round(v, 3)];
    });
  }

  // ---- (3) quarters above the target per hour of the day (~10 days), split by the length of the exceedance ----
  // opts.series: 'single' (one quarter above the target) | 'long' (part of a run of 2+ quarters) | 'all'.
  async function perHour(hass, opts) {
    const target = opts.target ?? CFG.peak_target_kw ?? 3;
    const Q = await quarters(hass);
    const cnt = { single: new Array(24).fill(0), long: new Array(24).fill(0) };
    let run = [];
    const flush = () => {
      for (const q of run) cnt[run.length === 1 ? "single" : "long"][C.hourOfDay(q.t)]++;
      run = [];
    };
    for (const q of Q) {
      if (run.length && q.t - run[run.length - 1].t !== C.QUARTER) flush(); // a gap ends the run
      if (q.kw > target) run.push(q);
      else flush();
    }
    flush();
    const d = new Date(+opts.start);
    const s = opts.series || "all";
    return cnt.single
      .map((v, h) => [
        new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 30).getTime(),
        s === "single" ? v : s === "long" ? cnt.long[h] : v + cnt.long[h],
      ])
      .filter(([x]) => x >= +opts.start && x <= +opts.end);
  }

  // ---- (4) quarter-hour import per phase, pre-stacked (apexcharts cannot stack a negative area) ----
  // opts.layer: 'L<n>' (L1 + ... + Ln) | 'back' (export on a phase netted against import on the others, below zero)
  // | 'net' (quarter import of the meter).
  async function phases(hass, opts) {
    if (!PH_IMP.length) return [];
    const Q = await quarters(hass, true);
    const layer = opts.layer || `L${PH_IMP.length}`;
    return Q.filter((q) => q.l && q.p && q.t >= +opts.start && q.t < +opts.end).map((q) => {
      let v;
      if (layer === "back") v = -netted(q);
      else if (layer === "net") v = q.kw;
      else v = q.l.slice(0, +layer.slice(1)).reduce((a, b) => a + b, 0);
      return [q.t, C.round(v, 3)];
    });
  }

  // ---- (5) who set the day's peak: phase split of each day's highest quarter (stacked columns) ----
  // opts.phase: 1..n (import on that phase) | 'back' (export netted against it, below zero).
  async function whoPeak(hass, opts) {
    if (!PH_IMP.length) return [];
    const Q = (await quarters(hass, true)).filter((q) => q.l && q.p);
    const out = [];
    for (const [d, o] of byDay(Q)) {
      if (!fullEnough(d, o)) continue;
      const x = noon(d);
      if (x < +opts.start || x > +opts.end) continue;
      const q = o.top;
      info.who[C.dayKey(d)] = `${hhmm(q.t)} · ${q.kw.toLocaleString(CFG.locale, { maximumFractionDigits: 2 })} kW`;
      out.push([x, C.round(opts.phase === "back" ? -netted(q) : q.l[(opts.phase ?? 1) - 1], 3)]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }

  // ---- (6) what each target limit costs: EUR/year capacity tariff, and quarters / kWh above it per day (~10 days) ----
  // x = midnight of the chart day + L hours; the card labels hours as kW. opts.series: 'cost' | 'quarters' | 'kwh'.
  const LIMITS = [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
  async function cost(hass, opts) {
    const series = opts.series || "cost";
    const price = capacityPrice(hass);
    if (series === "cost" && price == null) return [];
    const Q = series === "cost" ? [] : await quarters(hass);
    const days = Q.length / 96 || 1;
    const day0 = C.localMidnight(+opts.start);
    const fl = floorKw(hass);
    const above = (L) => Q.reduce((a, q) => a + (q.kw > L ? (q.kw - L) / 4 : 0), 0) / days;
    if (series === "quarters") info.kwh = LIMITS.map((L) => C.round(above(L), 2));
    return LIMITS.map((L) => {
      let v;
      if (series === "quarters") v = Q.filter((q) => q.kw > L).length / days;
      else if (series === "kwh") v = above(L);
      else v = Math.max(L, fl) * price;
      return [day0 + L * C.HOUR, C.round(v, 2)];
    });
  }

  window.haKitEnergy.peak = { monthPeak, dayPeak, perHour, phases, whoPeak, cost, info };
})();

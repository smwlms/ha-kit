// Shared helpers for the data generators of the energy-analysis dashboard (ha-kit module energy).
// Bundled by energy/deploy.py into energy-analysis.js after config.js (window.haKitEnergyConfig, rendered from
// house.yaml) and before the topics; every topic registers itself as window.haKitEnergy.<topic> = { fn(hass, opts) }
// returning [[ts, value], ...] for apexcharts-card. Prices come from window.haKitTariff (module tariff-be): there is
// no copy of the tariff formula here.
(() => {
  const CFG = window.haKitEnergyConfig || {};
  const MIN5 = 300000,
    QUARTER = 900000,
    HOUR = 3600000,
    DAY = 86400000;
  // Upper bounds for a single statistics 'change' row of an energy meter (kWh) of a house. The first retained row of
  // a sum statistic can contain the whole meter reading; resets show as spikes too.
  const CHANGE_LIMIT = { "5minute": 5, hour: 40, day: 400, week: 2500, month: 10000 };
  const cache = new Map();

  const localMidnight = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const todayStart = () => localMidnight(Date.now());
  const addDays = (ts, n) => {
    const d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };
  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const monthStart = (ts) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };
  const nextMonth = (ts) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  };
  const hourOfDay = (ts) => new Date(ts).getHours();
  const num = (v) => {
    const x = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(x) ? x : null;
  };
  const round = (v, d = 3) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y),
      m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  // Time bucket used in cache keys so repeated card refreshes within 5 minutes share one fetch.
  const tick = () => Math.floor(Date.now() / MIN5);
  // First day the analysis trusts (house.yaml energy.analysis_from); 0 = every statistic HA has.
  const since = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(CFG.analysis_from || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
  })();

  function memo(key, fn) {
    if (!cache.has(key)) {
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      cache.set(
        key,
        fn().catch((e) => {
          cache.delete(key);
          throw e;
        }),
      );
    }
    return cache.get(key);
  }

  // Long- and short-term statistics: { id: [{ start, end, change, mean, min, max, sum, state }] } with start/end in
  // ms. Implausible 'change' values become null. Rows before energy.analysis_from are dropped.
  function stats(hass, { ids, from, to, period = "hour", types = ["change"], units = { energy: "kWh", power: "kW" } }) {
    ids = ids.filter(Boolean);
    from = Math.max(from, since);
    if (!ids.length || to <= from) return Promise.resolve(Object.fromEntries(ids.map((id) => [id, []])));
    const key = `stats|${ids.join(",")}|${from}|${to}|${period}|${types.join(",")}|${JSON.stringify(units)}|${to > Date.now() - DAY ? tick() : 0}`;
    return memo(key, async () => {
      const res = await hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(from).toISOString(),
        end_time: new Date(to).toISOString(),
        period,
        statistic_ids: ids,
        types,
        units,
      });
      const lim = CHANGE_LIMIT[period] ?? Infinity;
      const out = {};
      for (const id of ids) {
        out[id] = (res[id] || []).map((r) => {
          const row = {
            ...r,
            start: typeof r.start === "number" ? r.start : Date.parse(r.start),
            end: typeof r.end === "number" ? r.end : Date.parse(r.end),
          };
          if ("change" in row && row.change != null && (row.change < -0.01 || row.change > lim)) row.change = null;
          return row;
        });
      }
      return out;
    });
  }

  // Raw state history (kept ~10 days): { id: [[ts, state], ...] }.
  function history(hass, { ids, from, to }) {
    const key = `hist|${ids.join(",")}|${from}|${to}|${tick()}`;
    return memo(key, async () => {
      const res = await hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(from).toISOString(),
        end_time: new Date(to).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const out = {};
      for (const id of ids) out[id] = (res[id] || []).map((p) => [(p.lu ?? p.lc) * 1000, p.s]);
      return out;
    });
  }

  // Rows -> Map(start -> field). Several ids (the day and night registers of one meter) are summed per start; a
  // start where one of them is missing gets null.
  const byStart = (rows, field = "change") => {
    const m = new Map();
    for (const r of rows || []) m.set(r.start, r[field]);
    return m;
  };
  function summed(res, ids, field = "change") {
    const m = new Map();
    const maps = ids.map((id) => byStart(res[id], field));
    if (!maps.length) return m;
    for (const t of maps[0].keys()) {
      let s = 0;
      for (const x of maps) {
        const v = x.get(t);
        if (v == null) {
          s = null;
          break;
        }
        s += v;
      }
      m.set(t, s);
    }
    return m;
  }

  // ---- prices: window.haKitTariff (tariff-be or another region module) on the spot-price statistics ----
  const tariff = () => window.haKitTariff || null;
  // Factor from the unit of the spot-price entity to EUR/MWh (Nord Pool sensors are usually EUR/kWh).
  function spotFactor(hass) {
    const u = String(hass?.states?.[CFG.ids?.spot]?.attributes?.unit_of_measurement || "").toLowerCase();
    return u.includes("mwh") ? 1 : u.includes("kwh") ? 1000 : 1000;
  }
  // Spot price per statistics row: Map(start -> EUR/MWh), hourly or 5-minute means of entities.spot_price.
  async function spot(hass, from, to, period = "hour") {
    if (!CFG.ids?.spot) return new Map();
    const r = await stats(hass, { ids: [CFG.ids.spot], from, to, period, types: ["mean"], units: {} });
    const f = spotFactor(hass);
    const m = new Map();
    for (const row of r[CFG.ids.spot] || []) if (row.mean != null) m.set(row.start, row.mean * f);
    return m;
  }
  // All-in import / export price in EUR/kWh at ts for a spot price in EUR/MWh (null without a tariff module).
  const importPrice = (mwh, ts, hass) => (tariff() && mwh != null ? tariff().importPrice(mwh, ts, hass) : null);
  const exportPrice = (mwh, ts) => (tariff() && mwh != null ? tariff().exportPrice(mwh, ts) : null);
  // Grid fees, levies and capacity tariff now (helpers of the tariff module, else its start values).
  const coefficients = (hass) => (tariff()?.coefficients ? tariff().coefficients(hass) : null);
  const isNight = (ts) => (tariff() ? tariff().isNight(ts) : false);

  // Battery power mean of one statistics row in kW, discharge positive (house.yaml energy.battery_power_sign).
  const batteryKw = (v) => (v == null ? null : v * (CFG.battery_sign === "charge_positive" ? -1 : 1));

  window.haKitEnergyCore = {
    CFG,
    MIN5,
    QUARTER,
    HOUR,
    DAY,
    since,
    localMidnight,
    todayStart,
    addDays,
    dayKey,
    monthStart,
    nextMonth,
    hourOfDay,
    num,
    round,
    median,
    mean,
    tick,
    memo,
    stats,
    history,
    byStart,
    summed,
    spot,
    spotFactor,
    importPrice,
    exportPrice,
    coefficients,
    isNight,
    batteryKw,
  };
  window.haKitEnergy = window.haKitEnergy || {};
})();

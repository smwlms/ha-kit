// Average-day profiles for the view "consumers" of the energy-analysis dashboard: one average day per season,
// stacked per measured layer, and "when does what run" (energy of each flow per hour of the day).
// Registers window.haKitEnergy.profiles = { season, seasonHead, clock, clockHead, window: windowInfo, seasonWindow }.
// Source: hourly long-term statistics (kept forever):
//   house = grid import - grid export + solar + battery discharge - battery charge.
// Days only count when every role has all its hours; days with a house use without the car below house.yaml
// energy.away_below_kwh (nobody home) are left out.
(() => {
  const C = window.haKitEnergyCore;
  const CFG = C.CFG;
  const ID = CFG.ids;
  const HOUR = C.HOUR;
  // Quantity -> how it is read: energy meters ('change', summed) or a power role ('mean' kW = kWh per hour).
  const SRC = {
    imp: { energy: ID.imp_kwh || [] },
    exp: { energy: ID.exp_kwh || [] },
    solar: ID.solar_kwh ? { energy: [ID.solar_kwh] } : ID.solar_w ? { power: ID.solar_w } : null,
    car: ID.charger_kwh ? { energy: [ID.charger_kwh] } : ID.charger_w ? { power: ID.charger_w } : null,
    chg: ID.chg_kwh ? { energy: [ID.chg_kwh] } : ID.bat_w ? { power: ID.bat_w, part: "charge" } : null,
    dis: ID.dis_kwh ? { energy: [ID.dis_kwh] } : ID.bat_w ? { power: ID.bat_w, part: "discharge" } : null,
    vent: ID.vent_w ? { power: ID.vent_w } : null,
  };
  const MIN_DAYS = 14; // a season is used once 14 days of it have passed
  const AWAY = CFG.away_below_kwh || 0;
  const SEASONS = { winter: 11, spring: 2, summer: 5, autumn: 8 }; // start month (0-based)
  const PERIOD_HELPER = CFG.helpers?.profiles_period;

  const midnight = C.localMidnight;
  const plusDays = C.addDays;

  // Most recent instance of a season with at least MIN_DAYS elapsed; only complete days (to = today 00:00).
  function seasonWindow(name, now = Date.now()) {
    const m0 = SEASONS[name];
    if (m0 == null) throw new Error(`unknown season '${name}'`);
    const today = midnight(now);
    const c = new Date(plusDays(today, -MIN_DAYS));
    const y = c.getMonth() >= m0 ? c.getFullYear() : c.getFullYear() - 1;
    const start = new Date(y, m0, 1).getTime();
    const end = new Date(y, m0 + 3, 1).getTime();
    return { name, year: y, from: Math.max(start, C.since), to: Math.min(end, today), running: end > today };
  }
  function periodWindow(period, now = Date.now()) {
    if (period in SEASONS) return seasonWindow(period, now);
    const today = midnight(now);
    return { name: "30_days", from: Math.max(plusDays(today, -30), C.since), to: today, running: true };
  }

  // Average day for window w: per quantity 24 hourly kWh values (= average kW in that hour).
  async function profile(hass, w) {
    // Just after midnight HA may not have compiled yesterday's last hour yet: refresh every 5 minutes in that hour.
    const fresh = Date.now() - w.to < HOUR ? C.tick() : 0;
    return C.memo(`profiles|${w.from}|${w.to}|${fresh}`, async () => {
      const energyIds = Object.values(SRC).flatMap((s) => (s?.energy ? s.energy : []));
      const powerIds = [...new Set(Object.values(SRC).flatMap((s) => (s?.power ? [s.power] : [])))];
      const [e, p] = await Promise.all([
        C.stats(hass, { ids: energyIds, from: w.from, to: w.to, period: "hour", types: ["change"] }),
        C.stats(hass, { ids: powerIds, from: w.from, to: w.to, period: "hour", types: ["mean"], units: { power: "kW" } }),
      ]);
      const maps = {};
      for (const [k, s] of Object.entries(SRC)) {
        if (!s) continue;
        if (s.energy) maps[k] = C.summed(e, s.energy);
        else {
          const m = new Map();
          for (const r of p[s.power] || []) {
            if (r.mean == null) continue;
            let v = r.mean;
            if (s.part) {
              v = C.batteryKw(v);
              v = s.part === "charge" ? Math.max(-v, 0) : Math.max(v, 0);
            }
            m.set(r.start, Math.max(v, 0));
          }
          maps[k] = m;
        }
      }
      const Q = ["import", "export", "solar", "car", "charge", "discharge", "vent", "house"];
      const sum = Object.fromEntries(Q.map((q) => [q, new Array(24).fill(0)]));
      const skipped = { incomplete: 0, away: 0 };
      let days = 0;
      const need = ["imp", "exp", "solar", "car", "chg", "dis"].filter((k) => maps[k]);
      for (let d = w.from; d < w.to; d = plusDays(d, 1)) {
        const next = plusDays(d, 1);
        const rows = [];
        let complete = true;
        for (let t = d; t < next; t += HOUR) {
          const v = (k) => (maps[k] ? maps[k].get(t) : 0);
          if (need.some((k) => v(k) == null)) {
            complete = false;
            break;
          }
          const o = {
            h: new Date(t).getHours(),
            import: v("imp"),
            export: v("exp"),
            solar: v("solar"),
            car: v("car"),
            charge: v("chg"),
            discharge: v("dis"),
            vent: v("vent") ?? 0,
          };
          o.house = o.import - o.export + o.solar + o.discharge - o.charge;
          rows.push(o);
        }
        if (!complete || !rows.length) {
          skipped.incomplete++;
          continue;
        }
        const houseWithoutCar = rows.reduce((a, o) => a + o.house - o.car, 0);
        if (AWAY > 0 && houseWithoutCar < AWAY) {
          skipped.away++;
          continue;
        }
        days++;
        for (const o of rows) for (const q of Q) sum[q][o.h] += o[q];
      }
      const avg = {};
      for (const q of Q) avg[q] = sum[q].map((x) => (days ? x / days : 0));
      return { avg, days, skipped, vent: !!SRC.vent && avg.vent.some((x) => x > 0) };
    });
  }

  const tot = (arr, a = 0, b = 24) => arr.slice(a, b).reduce((s, x) => s + x, 0);
  // x-values: middle of each hour on the card's first day.
  const axis = (start) => midnight(start instanceof Date ? start.getTime() : (start ?? Date.now())) + HOUR / 2;
  const toSeries = (start, vals) => {
    const a0 = axis(start);
    return vals.map((x, h) => [a0 + h * HOUR, C.round(Number.isFinite(x) ? x : 0, 3)]);
  };

  // Layers of the house, pre-stacked bottom-up in the order of `layers` (apexcharts cannot stack an area chart that
  // also holds a negative export layer). The rest layer never goes below zero.
  function stack(p, layers) {
    const zero = new Array(24).fill(0);
    const vent = layers.includes("ventilation") && p.vent ? p.avg.vent : zero;
    const car = layers.includes("car") ? p.avg.car : zero;
    const own = { car, ventilation: vent, rest: p.avg.house.map((x, h) => Math.max(0, x - car[h] - vent[h])) };
    const cum = {};
    let run = zero;
    for (const k of layers) {
      run = run.map((x, h) => x + (own[k] ? own[k][h] : 0));
      cum[k] = run;
    }
    return cum;
  }

  // Season chart. layer: 'car' | 'ventilation' | 'rest' (cumulative), 'export' (negative), 'import', 'solar'.
  async function season(hass, { start, season: name = "winter", layer = "rest", layers = ["car", "rest"] }) {
    const p = await profile(hass, seasonWindow(name));
    let vals;
    if (layer === "export") vals = p.avg.export.map((x) => -x);
    else if (layer === "import" || layer === "solar") vals = p.avg[layer];
    else vals = stack(p, layers)[layer] || new Array(24).fill(0);
    return toSeries(start, vals);
  }

  // Header values of a season card: what = 'house' | 'import' | 'export' | 'solar' | 'car' (kWh/day) | 'days'.
  async function seasonHead(hass, { end, season: name = "winter", what = "house" }) {
    const p = await profile(hass, seasonWindow(name));
    const x = what === "days" ? p.days : +tot(p.avg[what] || []).toFixed(2);
    return [[(end instanceof Date ? end.getTime() : Date.now()) - HOUR, x]];
  }

  const chosenPeriod = (hass, period) => period || String(hass?.states?.[PERIOD_HELPER]?.state || "30_days");

  const STREAM = {
    import: (a) => a.import,
    export: (a) => a.export,
    car: (a) => a.car,
    charge: (a) => a.charge,
    discharge: (a) => a.discharge,
    solar: (a) => a.solar,
    house: (a) => a.house,
    house_without_car: (a) => a.house.map((x, h) => Math.max(0, x - a.car[h])),
  };

  // "When does what run": hourly kWh of one flow over the chosen period (input_select.energy_profiles_period).
  async function clock(hass, { start, flow = "import", period }) {
    const p = await profile(hass, periodWindow(chosenPeriod(hass, period)));
    const f = STREAM[flow];
    if (!f) throw new Error(`unknown flow '${flow}'`);
    return toSeries(start, f(p.avg));
  }

  // Header values of a clock card: what = 'day' (kWh/day) | 'solar_window' (% of the day between 09 and 15 h) |
  // 'peak_hour' | 'days'.
  async function clockHead(hass, { end, flow = "import", what = "day", period }) {
    const p = await profile(hass, periodWindow(chosenPeriod(hass, period)));
    const vals = STREAM[flow](p.avg);
    const day = tot(vals);
    let x;
    if (what === "days") x = p.days;
    else if (what === "solar_window") x = day > 1e-6 ? +((100 * tot(vals, 9, 15)) / day).toFixed(1) : 0;
    else if (what === "peak_hour") x = vals.indexOf(Math.max(...vals));
    else x = +day.toFixed(2);
    return [[(end instanceof Date ? end.getTime() : Date.now()) - HOUR, x]];
  }

  // Debug/info: the window a season or period resolves to, with the day counts.
  async function windowInfo(hass, { season: name, period }) {
    const w = name ? seasonWindow(name) : periodWindow(chosenPeriod(hass, period));
    const p = await profile(hass, w);
    return { ...w, fromIso: new Date(w.from).toString(), toIso: new Date(w.to).toString(), days: p.days, skipped: p.skipped, vent: p.vent };
  }

  window.haKitEnergy.profiles = { season, seasonHead, clock, clockHead, window: windowInfo, seasonWindow };
})();

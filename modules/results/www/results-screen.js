// Results screen (ha-kit module results): what the smart logic did today and what it saved, in plain language.
//   Saved today (EUR, per kind of the installed producers), the day goals, consumption and electricity cost per
//   day/week/month, other contracts (variable, fixed) on the same kWh, this month against last year, per month the
//   calculation against the invoice, and the logbook lines of the installed modules ("What the house did").
// Data: long-term statistics (EUR and kWh per day/week/month, hourly and monthly), history of the goal sensors, the
// logbook. Nothing about the house is built in: every entity id, list and text comes from the card config that
// tools/fill.py renders from house.yaml, modules: and the capabilities (lovelace/results.yaml). A block whose entities
// are missing is not drawn. Needs cw-thema.js of module base (cw-kop, cw-knop); colours from the --cw-* tokens.
// Optional: window.haKitTariff (tariff module) for the comparison with other contracts (night register, grid fees).
(() => {
  // The language is part of the version, so browsers reload the file when house.language changes.
  const VERSION = "1-<@ t('language_code') @>";
  const VIEW_KEY = "ha-kit-results-extended";
  const REFRESH_MS = 5 * 60 * 1000;
  // A watched sensor change reloads at most once per LOAD_DEBOUNCE_MS (the first load is immediate).
  const LOAD_DEBOUNCE_MS = 30 * 1000;
  const TIMEOUT_MS = 30 * 1000;
  const HOUR = 3600 * 1000;
  const NO_VALUE = new Set([undefined, null, "", "unknown", "unavailable"]);
  // A recorder/logbook call that never answers must not keep the whole page on zero.
  const withTimeout = (p, ms = TIMEOUT_MS) =>
    Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("time-out")), ms))]);

  // ---------- theme palette ----------
  // Colours come from the --cw-* tokens of theme Organic (module base, light/dark) and are re-read when the theme
  // changes. DARK / LIGHT are the fallbacks while the tokens are missing. Concrete hex strings for the mixes below.
  const DARK = {
    bg: "#1d1a17", card: "#2a2622", raised: "#3a3530", line: "#4a433c", onAccent: "#1d1a17", text: "#F5EAD8",
    muted: "#BFB3A1", zon: "#E8A571", water: "#8FB8C9", accent: "#C67139", green: "#6FBF73", red: "#E36B5A",
    amber: "#E8B04A", batt: "#7F8B64", net: "#BB7644",
  };
  const LIGHT = {
    bg: "#F5EAD8", card: "#EBDDC5", raised: "#F9F3EA", line: "#D8C6A8", text: "#201E1D", muted: "#645C50",
    accent: "#C67139", onAccent: "#201E1D", green: "#41692F", amber: "#7E5409", red: "#A63B28", water: "#4F7F92",
  };
  // Palette key -> token name (theme tokens keep their Dutch names, see CONTRIBUTING "Known naming leftovers").
  const TOKEN = {
    bg: "bg", card: "card", raised: "raised", line: "line", text: "text", muted: "muted", accent: "accent",
    onAccent: "on-accent", green: "good", amber: "warn", red: "bad", zon: "zon", batt: "batterij", net: "net",
    water: "water",
  };
  const C = { ...DARK };
  const rgbOf = (h) => {
    const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim());
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  };
  const lum = (h) =>
    (rgbOf(h) || [0, 0, 0])
      .map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const mix = (a, b, t) => {
    const x = rgbOf(a);
    const y = rgbOf(b);
    return x && y
      ? `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`
      : a;
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // Light mode: deepen a colour towards the text colour until it reaches `min` contrast on the card.
  const INK = new Map();
  const ink = (c, min = 4.5) => {
    if (!C.light || !rgbOf(c)) return c;
    const key = `${c}|${C.card}|${min}`;
    if (!INK.has(key)) {
      let out = c;
      for (let t = 0.1; t < 0.95 && contrast(out, C.card) < min; t += 0.1) out = mix(c, C.text, t);
      INK.set(key, out);
    }
    return INK.get(key);
  };
  const sep = () => (C.light ? C.line : C.raised);
  const tint = (c, t = 0.16) => mix(C.card, c, t);
  const onTint = (c, t = 0.18) => {
    const bg = tint(c, t);
    let out = c;
    for (let s = 0.1; s < 0.95 && contrast(out, bg) < 4.5; s += 0.1) out = mix(c, C.text, s);
    return out;
  };
  const readPalette = (el, hass) => {
    const cs = getComputedStyle(el);
    const fb = hass?.themes?.darkMode === false ? { ...DARK, ...LIGHT } : DARK;
    for (const k of Object.keys(DARK)) C[k] = (TOKEN[k] && cs.getPropertyValue(`--cw-${TOKEN[k]}`).trim()) || fb[k];
    C.light = lum(C.bg) > 0.4;
    INK.clear();
    return Object.keys(DARK).map((k) => C[k]).join();
  };
  const hasTokens = (el) => !!getComputedStyle(el).getPropertyValue("--cw-bg").trim();
  const themeKey = (hass) => `${hass?.themes?.darkMode}|${hass?.themes?.theme}|${hass?.selectedTheme?.theme}`;

  // ---------- small helpers ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // "{v} kWh" + {v: "1,2"} -> text; unknown {names} stay as they are.
  const fmt = (text, values = {}) =>
    String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const svg = (s, body) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    check: (s = 18) => svg(s, '<path d="M5 12.5l4.5 4.5L19 7"/>'),
    cross: (s = 18) => svg(s, '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    clock: (s = 18) => svg(s, '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    dash: (s = 18) => svg(s, '<path d="M7 12H17"/>'),
  };
  const pad = (n) => String(n).padStart(2, "0");
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shiftMonth = (key, n) => {
    const [y, m] = key.split("-").map(Number);
    return monthKey(new Date(y, m - 1 + n, 1));
  };
  const daysInMonth = (key) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  };
  const monthStart = (key) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).getTime();
  };
  const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const startOfWeek = (d = new Date()) => startOfDay(d) - ((d.getDay() + 6) % 7) * 864e5;
  const toMs = (s) => (typeof s === "number" ? s : Date.parse(s));
  const sumOf = (list) => list.reduce((a, b) => a + b, 0);

  class ResultsScreenCard extends HTMLElement {
    setConfig(config) {
      if (!config || typeof config.strings !== "object" || typeof config.meters !== "object")
        throw new Error(
          "results-screen-card: meters and strings are rendered by ha-kit (tools/fill.py): paste results/lovelace/results.yaml",
        );
      const c = {
        kinds: [], goals: [], shading: null, solar_missed: null, prices: {}, capacity: {}, fixed_fee: null,
        invoices: {}, exact_from: "", last_year: [], compare: {}, log_entities: [], ...config,
      };
      c.meters = { imp: [], exp: [], solar: [], bat_in: [], bat_out: [], cost: [], comp: [], ...config.meters };
      this._cfg = c;
      this._S = c.strings;
      this._loc = this._S.locale || undefined;
      // Decimal separator of the locale, for numbers inside texts that come from Home Assistant (logbook, details).
      this._comma = (1.5).toLocaleString(this._loc).includes(",");
      this._lastYear = Object.fromEntries((c.last_year || []).map((r) => [String(r.month), r]));
      this._watch = [
        ...c.kinds.map((k) => k.sensor),
        ...c.kinds.map((k) => k.today_kwh),
        c.shading,
        ...c.goals.map((g) => g.sensor),
        c.solar_missed,
        c.capacity.average,
        c.invoices.sensor,
      ].filter(Boolean);
      this._stats = {};
      this._goals = {};
      this._log = [];
      this._loaded = false;
      this._statsReady = false;
      this._busy = {};
      this._sig = undefined;
      try {
        this._adv = localStorage.getItem(VIEW_KEY) === "1";
      } catch (e) {
        this._adv = false;
      }
      if (this._hass) this._render();
    }

    getCardSize() {
      return 14;
    }

    getGridOptions() {
      return { columns: "full", rows: "auto" };
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._cfg) return;
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
      }
      const sig = this._watch.map((id) => hass.states[id]?.last_updated).join("|");
      if (sig !== this._sig) {
        const first = this._sig === undefined;
        this._sig = sig;
        if (first) this._load();
        else if (!this._loadTimer)
          this._loadTimer = setTimeout(() => {
            this._loadTimer = null;
            this._load();
          }, LOAD_DEBOUNCE_MS);
      }
      const tk = themeKey(hass);
      if (tk !== this._tk) {
        this._tk = tk;
        this._tries = 0;
        readPalette(this, hass);
        clearTimeout(this._tkTimer);
        this._tkTimer = setTimeout(() => this._retheme(), 60);
      }
      if (!this._rendered) this._render();
    }

    _retheme() {
      clearTimeout(this._tkTimer);
      // The view theme can arrive later than the first hass: retry until the --cw-* tokens are there (max ±10 s).
      if (!hasTokens(this) && (this._tries = (this._tries || 0) + 1) < 40)
        this._tkTimer = setTimeout(() => this._retheme(), 250);
      const pal = readPalette(this, this._hass);
      if (pal !== this._pal) {
        this._pal = pal;
        this._render();
      }
    }

    connectedCallback() {
      clearInterval(this._timer);
      this._timer = setInterval(() => this._load(), REFRESH_MS);
    }

    disconnectedCallback() {
      clearInterval(this._timer);
      clearTimeout(this._loadTimer);
      clearTimeout(this._tkTimer);
      this._loadTimer = null;
    }

    // ---------- values ----------
    t(key, values) {
      return fmt(this._S[key] ?? key, values);
    }
    _has(id) {
      return !!id && !!this._hass.states[id];
    }
    _num(id) {
      const v = parseFloat(this._hass.states[id]?.state);
      return Number.isFinite(v) ? v : NaN;
    }
    _attr(id, k) {
      const v = parseFloat(this._hass.states[id]?.attributes?.[k]);
      return Number.isFinite(v) ? v : 0;
    }
    nf(v, d = 1) {
      return Number.isFinite(v)
        ? v.toLocaleString(this._loc, { minimumFractionDigits: d, maximumFractionDigits: d })
        : "–";
    }
    eur(v) {
      return this.t("eur", { v: this.nf(Number.isFinite(v) ? v : 0, 2) });
    }
    kwh(v) {
      return this.t("kwh", { v: this.nf(v, Math.abs(v) >= 100 ? 0 : 1) });
    }
    // Numbers inside a text from Home Assistant (logbook line, goal detail) in the decimal style of the locale.
    localNum(s) {
      return this._comma ? String(s ?? "").replace(/(\d)\.(\d)/g, "$1,$2") : String(s ?? "");
    }
    monthName(key) {
      return new Date(`${key}-15T12:00:00`).toLocaleDateString(this._loc, { month: "short", year: "2-digit" });
    }
    dayLabel(key) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      if (key === dayKey(new Date())) return this.t("today_word");
      if (key === dayKey(y)) return this.t("yesterday_word");
      return new Date(`${key}T12:00:00`).toLocaleDateString(this._loc, { weekday: "short", day: "numeric", month: "short" });
    }
    hhmm(d) {
      return d.toLocaleTimeString(this._loc, { hour: "2-digit", minute: "2-digit" });
    }
    // Present meters only: a role whose entity does not exist (yet) is left out of every sum.
    _meters(key) {
      return (this._cfg.meters[key] || []).filter((id) => this._has(id));
    }
    // The kinds that get a line: the sensor exists; ev_solar also needs the charger's solar counter; an extension
    // kind only once its producer sent a first result.
    _kinds() {
      return this._cfg.kinds.filter((k) => {
        if (!this._has(k.sensor)) return false;
        if (k.today_kwh && !this._has(k.today_kwh)) return false;
        if (k.extension) return this._attr(k.sensor, "actions") > 0 || Math.abs(this._num(k.sensor) || 0) > 0;
        return true;
      });
    }
    _goalList() {
      return this._cfg.goals.filter((g) => this._has(g.sensor));
    }

    // ---------- loading ----------
    // Every block loads on its own and shows up as soon as its data is in; a slow one never blocks the rest.
    async _load() {
      if (!this._hass || !this._cfg) return;
      const run = async (name, fn, ms) => {
        if (this._busy[name]) return;
        this._busy[name] = true;
        try {
          await withTimeout(fn(), ms);
        } catch (e) {
          console.warn(`results-screen-card ${name}:`, e);
        }
        this._busy[name] = false;
        this._render();
      };
      await Promise.all([
        run("stats", () => this._loadStats()),
        run("hours", () => this._loadHours()),
        run("months", () => this._loadMonths()),
        run("goals", () => this._loadGoals()),
        run("log", () => this._loadLog(), 90 * 1000),
      ]);
      this._loaded = true;
      this._render();
    }

    // Change per calendar day, week and month (the statistics of the savings and of every meter).
    async _loadStats() {
      const c = this._cfg;
      const ids = [
        ...this._kinds().map((k) => k.sensor),
        c.shading,
        ...["imp", "exp", "solar", "bat_in", "bat_out", "cost", "comp"].flatMap((k) => this._meters(k)),
      ].filter((id) => this._has(id));
      const jobs = [];
      for (const id of [...new Set(ids)])
        for (const period of ["day", "week", "month"])
          jobs.push(
            this._hass
              .callWS({ type: "recorder/statistic_during_period", statistic_id: id, calendar: { period }, types: ["change"] })
              .then((r) => [id, period, r?.change])
              .catch(() => [id, period, null]),
          );
      const out = {};
      for (const [id, period, v] of await Promise.all(jobs)) {
        out[id] = out[id] || {};
        out[id][period] = Number.isFinite(v) ? v : 0;
      }
      this._stats = out;
      this._statsReady = true;
    }

    // Hourly statistics from the start of last month (or of this week, when earlier): kWh in and out, the cost
    // sensors and the mean import/export price per hour. Used for the cost without cost sensors and for the
    // comparison with other contracts (both up to the last full hour).
    async _loadHours() {
      const c = this._cfg;
      const prev = monthStart(shiftMonth(monthKey(new Date()), -1));
      const start = Math.min(prev, startOfWeek());
      const series = { imp: this._meters("imp"), exp: this._meters("exp"), cost: this._meters("cost"), comp: this._meters("comp") };
      const prices = { pi: c.prices.imp, pe: c.prices.exp };
      const ids = [...Object.values(series).flat(), ...Object.values(prices).filter((id) => this._has(id))];
      if (!ids.length) return;
      const r = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(start).toISOString(),
        period: "hour",
        statistic_ids: ids,
        types: ["change", "mean"],
      });
      const hours = new Map();
      const slot = (t) => {
        if (!hours.has(t)) hours.set(t, { imp: 0, exp: 0, cost: 0, comp: 0, pi: NaN, pe: NaN });
        return hours.get(t);
      };
      for (const [key, list] of Object.entries(series))
        for (const id of list)
          for (const row of r?.[id] || []) if (Number.isFinite(row.change)) slot(toMs(row.start))[key] += row.change;
      for (const [key, id] of Object.entries(prices))
        for (const row of r?.[id] || []) if (Number.isFinite(row.mean)) slot(toMs(row.start))[key] = row.mean;
      this._hours = [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([t, h]) => ({ t, ...h }));
    }

    // Monthly statistics of the last 12 months: kWh, cost sensors, the month peak (max) and the mean prices.
    async _loadMonths() {
      const c = this._cfg;
      const first = new Date();
      first.setMonth(first.getMonth() - 11, 1);
      first.setHours(0, 0, 0, 0);
      const ids = [
        ...["imp", "exp", "cost", "comp"].flatMap((k) => this._meters(k)),
        c.capacity.month_peak,
        c.prices.imp,
        c.prices.exp,
      ].filter((id) => this._has(id));
      if (!ids.length) return;
      const r = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: first.toISOString(),
        period: "month",
        statistic_ids: [...new Set(ids)],
        types: ["change", "max", "mean"],
      });
      const byMonth = {};
      for (const [id, rows] of Object.entries(r || {}))
        for (const row of rows) (byMonth[monthKey(new Date(toMs(row.start)))] ||= {})[id] = row;
      this._months = byMonth;
    }

    // Goal results of the last 14 days from the history of the goal sensors (attribute date = the day it counts for).
    async _loadGoals() {
      const goals = this._goalList();
      if (!goals.length) return;
      const start = new Date();
      start.setDate(start.getDate() - 14);
      const r = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        entity_ids: goals.map((g) => g.sensor),
        minimal_response: false,
        no_attributes: false,
        significant_changes_only: false,
      });
      const out = {};
      for (const g of goals) {
        let attrs = {};
        for (const row of r?.[g.sensor] || []) {
          // Compressed history only repeats the attributes when they change.
          if (row.a) attrs = row.a;
          const d = attrs.date;
          if (!d || (row.s !== "met" && row.s !== "missed")) continue;
          (out[d] ||= {})[g.goal] = { s: row.s, detail: attrs.detail || "" };
        }
      }
      // The current state counts too (history can lag a moment behind the state machine).
      for (const g of goals) {
        const s = this._hass.states[g.sensor];
        const d = s?.attributes?.date;
        if (d && (s.state === "met" || s.state === "missed"))
          (out[d] ||= {})[g.goal] = { s: s.state, detail: s.attributes.detail || "" };
      }
      this._goals = out;
    }

    // "What the house did": the logbook.log lines of the installed modules (no state changes), and in the extended
    // view also the automation runs with the device changes they caused (grouped by context id), 3 days.
    async _loadLog() {
      const start = new Date();
      if (this._adv) start.setDate(start.getDate() - 2);
      start.setHours(0, 0, 0, 0);
      const states = this._hass.states;
      const ids = this._cfg.log_entities.filter((id) => states[id]);
      const lines = ids.length
        ? await this._hass.callWS({ type: "logbook/get_events", start_time: start.toISOString(), entity_ids: ids })
        : [];
      const items = [];
      for (const e of lines || []) {
        if (!e.message || e.state !== undefined || /^triggered/i.test(e.message)) continue;
        items.push({ when: e.when, kind: "line", title: e.name, text: this.localNum(e.message) });
      }
      this._log = items.sort((a, b) => b.when - a.when);
      this._logNote = "";
      this._render();
      if (!this._adv) return;
      const ACTUATORS = new Set(["cover", "select", "switch", "climate", "water_heater", "number", "light", "fan",
        "input_number", "input_select", "text", "lock", "button"]);
      const autos = Object.keys(states).filter((id) => id.startsWith("automation."));
      const acts = Object.keys(states).filter((id) => ACTUATORS.has(id.split(".")[0]));
      let runs = [];
      let changes = [];
      try {
        [runs, changes] = await withTimeout(
          Promise.all([
            autos.length
              ? this._hass.callWS({ type: "logbook/get_events", start_time: start.toISOString(), entity_ids: autos })
              : [],
            acts.length
              ? this._hass.callWS({ type: "logbook/get_events", start_time: start.toISOString(), entity_ids: acts })
              : [],
          ]),
          60 * 1000,
        );
      } catch (e) {
        // Three days of every automation and device is a heavy logbook query; keep the readable lines.
        this._logNote = this.t("log_too_slow");
        return;
      }
      const byCtx = {};
      for (const c of changes || []) {
        if (c.context_domain !== "automation" && c.context_event_type !== "automation_triggered") continue;
        if (NO_VALUE.has(c.state)) continue;
        (byCtx[c.context_id] ||= []).push(c);
      }
      for (const e of runs || []) {
        if (!/^triggered/i.test(e.message || "")) continue;
        const done = (byCtx[e.context_id] || []).sort((a, b) => a.when - b.when);
        items.push({
          when: e.when,
          kind: done.length ? "run" : "quiet",
          title: e.name,
          trigger: this._triggerText(e.message),
          actions: done.map((c) => `${c.name} → ${this._S[`state_${c.state}`] || c.state}`),
        });
      }
      this._log = items.sort((a, b) => b.when - a.when);
    }

    _triggerText(msg) {
      const m = String(msg || "");
      const ent = m.match(/\b([a-z_]+\.[a-z0-9_]+)\b/);
      if (ent && this._hass.states[ent[1]])
        return this.t("trigger_by", { name: this._hass.states[ent[1]].attributes.friendly_name || ent[1] });
      if (/time pattern/i.test(m)) return this.t("trigger_pattern");
      if (/\btime\b/i.test(m)) return this.t("trigger_time");
      if (/\bsun\b/i.test(m)) return this.t("trigger_sun");
      if (/event/i.test(m)) return this.t("trigger_event");
      return this.t("trigger_by", { name: m.replace(/^triggered by /i, "") });
    }

    // ---------- calculations ----------
    // Energy cost from the hourly statistics for hours in [from, to): the cost sensors when they exist, else kWh x
    // the mean price of that hour. unpriced = kWh of hours without a price (the estimate is then too low).
    _hourCost(from, to) {
      const useCost = this._meters("cost").length > 0;
      const useComp = this._meters("comp").length > 0;
      let cost = 0;
      let comp = 0;
      let unpriced = 0;
      let n = 0;
      for (const h of this._hours || []) {
        if (h.t < from || h.t >= to) continue;
        n += 1;
        if (useCost) cost += h.cost;
        else if (Number.isFinite(h.pi)) cost += h.imp * h.pi;
        else unpriced += h.imp;
        if (useComp) comp += h.comp;
        else if (Number.isFinite(h.pe)) comp += h.exp * h.pe;
        else unpriced += h.exp;
      }
      return { cost, comp, unpriced, hours: n, exact: useCost && useComp };
    }

    // Average peak (kW) of the 12 months up to and including `key`, the way the capacity tariff counts it: the
    // tariff module's remembered peaks first, then the monthly max of the month-peak sensor, then the start peak.
    _avgPeak(key) {
      const cap = this._cfg.capacity;
      const min = Number(cap.minimum_kw) || 0;
      const known = Object.fromEntries((this._hass.states[cap.average]?.attributes?.peaks || []).map((p) => [p[0], p[1]]));
      const start = this._num(cap.start_peak);
      const vals = [];
      for (let i = 11; i >= 0; i--) {
        const k = shiftMonth(key, -i);
        let v = Number(known[k]);
        if (!Number.isFinite(v)) v = this._months?.[k]?.[cap.month_peak]?.max;
        if (!Number.isFinite(v) && start > 0) v = start;
        if (Number.isFinite(v)) vals.push(Math.max(v, min));
      }
      return vals.length ? sumOf(vals) / vals.length : min;
    }

    // Capacity tariff per year in EUR for an average peak: the rate helper, else the tariff sensor's own yearly cost.
    _capYear(avgKw) {
      const cap = this._cfg.capacity;
      const rate = this._num(cap.rate);
      if (Number.isFinite(rate)) return avgKw * rate;
      const yearly = this._attr(cap.average, "cost_eur_per_year");
      const now = this._num(cap.average);
      return yearly > 0 && now > 0 ? (avgKw * yearly) / now : NaN;
    }

    // Everything for one calendar month, computed the way the invoice does it.
    _month(key) {
      const c = this._cfg;
      const row = this._months?.[key] || {};
      const sum = (ids) => ids.reduce((s, id) => s + (row[id]?.change || 0), 0);
      const now = new Date();
      const current = key === monthKey(now);
      const days = current ? now.getDate() : daysInMonth(key);
      const imp = sum(this._meters("imp"));
      const exp = sum(this._meters("exp"));
      let cost = null;
      let comp = null;
      let approx = false;
      if (this._meters("cost").length) cost = sum(this._meters("cost"));
      if (this._meters("comp").length) comp = sum(this._meters("comp"));
      if (cost == null || comp == null) {
        // No cost sensors: the hours of this and last month; older months kWh x the mean price of the month.
        const hourly = key >= shiftMonth(monthKey(now), -1) && this._hours?.length;
        if (hourly) {
          const h = this._hourCost(monthStart(key), monthStart(shiftMonth(key, 1)));
          if (cost == null) cost = h.cost;
          if (comp == null) comp = h.comp;
        } else {
          const pi = row[c.prices.imp]?.mean;
          const pe = row[c.prices.exp]?.mean;
          if (cost == null && Number.isFinite(pi)) cost = imp * pi;
          if (comp == null && Number.isFinite(pe)) comp = exp * pe;
        }
        approx = true;
      }
      const avgPeak = this._avgPeak(key);
      const capYear = this._capYear(avgPeak);
      const cap = Number.isFinite(capYear) ? (capYear * days) / 365 : 0;
      const fixedYear = this._num(c.fixed_fee);
      const fixed = Number.isFinite(fixedYear) ? (fixedYear * days) / 365 : 0;
      const invoice = (this._hass.states[c.invoices.sensor]?.attributes?.invoices || []).find((f) => f[0] === key)?.[1];
      return {
        key, current, days, imp, exp, cost, comp, cap, fixed, avgPeak, approx,
        peak: row[c.capacity.month_peak]?.max,
        total: cost == null ? null : cost + cap + fixed - (comp || 0),
        reliable: !c.exact_from || key >= c.exact_from,
        invoice: Number.isFinite(parseFloat(invoice)) ? parseFloat(invoice) : null,
      };
    }

    // Same kWh of one month on a variable and a fixed contract (energy price of the helpers + the same grid fee and
    // levies as the tariff module, day/night per hour) against the dynamic cost. Capacity tariff and fixed fees are
    // the same for every contract and left out. Null without window.haKitTariff (night register and grid fees).
    _compare(key) {
      const tariff = window.haKitTariff;
      const cmp = this._cfg.compare;
      if (!tariff?.isNight || !this._hours?.length) return null;
      const co = typeof tariff.coefficients === "function" ? tariff.coefficients(this._hass) : null;
      if (!co || !Number.isFinite(co.levies) || !Number.isFinite(co.gridDay)) return null;
      const offer = {
        variable: this._num(cmp.variable),
        fixed: this._num(cmp.fixed),
      };
      const exportPrice = Number.isFinite(this._num(cmp.export)) ? this._num(cmp.export) : 0;
      const kinds = Object.keys(offer).filter((k) => offer[k] > 0);
      if (!kinds.length) return null;
      const from = monthStart(key);
      const to = monthStart(shiftMonth(key, 1));
      const dyn = this._hourCost(from, to);
      if (!dyn.hours) return null;
      const out = { key, dynamic: dyn.cost - dyn.comp, approx: !dyn.exact || dyn.unpriced > 0, offers: {} };
      for (const k of kinds) {
        let total = 0;
        for (const h of this._hours) {
          if (h.t < from || h.t >= to) continue;
          const grid = tariff.isNight(new Date(h.t)) ? co.gridNight : co.gridDay;
          total += (h.imp * (offer[k] + co.levies + grid)) / 100 - (h.exp * exportPrice) / 100;
        }
        out.offers[k] = { price: offer[k], total };
      }
      return out;
    }

    // ---------- rendering ----------
    _render() {
      if (!this._hass || !this._cfg || !this.shadowRoot) return;
      this._rendered = true;
      const adv = this._adv;
      const ready = this._statsReady;
      const st = (id, k) => this._stats[id]?.[k] ?? 0;
      const money = (v) => (ready ? this.eur(v) : "…");
      const kinds = this._kinds();
      const total = (k) => sumOf(kinds.map((l) => st(l.sensor, k)));
      const body = [this._hero(kinds, total, money), this._energyCard(st, ready), this._compareCard(),
        this._lastYearCard(), this._monthsCard(), this._goalsCard(), this._partsCard(kinds, st, money),
        adv ? this._historyCard() : ""].join("");
      this.shadowRoot.innerHTML = `<style>${css()}</style>
<div class="wrap">
  <cw-kop titel="${esc(this.t("title"))}">${esc(this.t("title"))}<cw-knop slot="acties" data-act="adv" icoon="lagen" label="${esc(this.t("advanced_view"))}"${adv ? " aan" : " toggle"}></cw-knop></cw-kop>
  <div class="cols">
    <div class="col">${body}</div>
    <div class="col">${this._logCard()}${this._howCard(kinds)}</div>
  </div>
</div>`;
    }

    _goalState() {
      const goals = this._goalList();
      const today = this._goals[dayKey(new Date())] || {};
      const done = goals.filter((g) => today[g.goal]?.s === "met").length;
      const missed = goals.filter((g) => today[g.goal]?.s === "missed").length;
      return { goals, today, done, missed, pending: goals.length - done - missed };
    }

    _hero(kinds, total, money) {
      const g = this._goalState();
      let summary = "";
      if (g.goals.length) {
        const text = g.missed
          ? this.t(g.missed === 1 ? "goals_missed_one" : "goals_missed", { missed: g.missed, done: g.done })
          : this.t("goals_done", { done: g.done, all: g.goals.length });
        const pend = g.pending ? this.t("goals_pending", { n: g.pending }) : "";
        summary = `<div class="sum ${g.missed ? "bad" : "ok"}">${g.missed ? I.cross(16) : I.check(16)} ${esc(text + pend)}</div>`;
      }
      if (!kinds.length)
        return `<div class="card hero"><span class="lbl">${esc(this.t("saved_today"))}</span><span class="muted">${esc(this.t("no_kinds"))}</span>${summary}</div>`;
      return `<div class="card hero">
        <span class="lbl">${esc(this.t("saved_today"))}</span>
        <b class="big">${money(total("day"))}</b>
        <span class="muted">${esc(this.t("saved_today_info"))}</span>
        ${summary}
        <div class="periods"><span>${esc(this.t("this_week"))} <b>${money(total("week"))}</b></span><span>${esc(this.t("this_month"))} <b>${money(total("month"))}</b></span></div>
      </div>`;
    }

    _energyCard(st, ready) {
      const c = this._cfg;
      if (!this._meters("imp").length) return "";
      const PER = ["day", "week", "month"];
      const m = (key, p) => sumOf(this._meters(key).map((id) => st(id, p)));
      const now = new Date();
      const startOf = { day: startOfDay(now), week: startOfWeek(now), month: monthStart(monthKey(now)) };
      const daysIn = { day: 1, week: ((now.getDay() + 6) % 7) + 1, month: now.getDate() };
      const capNow = this._num(c.capacity.average);
      const capKw = Math.max(Number.isFinite(capNow) ? capNow : 0, Number(c.capacity.minimum_kw) || 0);
      const capYear = Number.isFinite(capNow) ? this._capYear(capKw) : NaN;
      const fixedYear = this._num(c.fixed_fee);
      const hasSolar = this._meters("solar").length > 0;
      const hasBat = this._meters("bat_in").length > 0 && this._meters("bat_out").length > 0;
      const costExact = this._meters("cost").length > 0 && this._meters("comp").length > 0;
      const E = {};
      let unpriced = 0;
      for (const p of PER) {
        const imp = m("imp", p);
        const exp = m("exp", p);
        const solar = m("solar", p);
        const batIn = m("bat_in", p);
        const batOut = m("bat_out", p);
        // Home consumption the way the HA energy dashboard computes it.
        const use = Math.max(imp - exp + solar + batOut - batIn, 0);
        let cost = this._meters("cost").length ? m("cost", p) : null;
        let comp = this._meters("comp").length ? m("comp", p) : null;
        if (cost == null || comp == null) {
          const h = this._hourCost(startOf[p], Date.now());
          if (cost == null) cost = h.cost;
          if (comp == null) comp = h.comp;
          unpriced = Math.max(unpriced, h.unpriced);
        }
        E[p] = {
          imp, exp, solar, use, batIn, batOut, cost, comp,
          cap: Number.isFinite(capYear) ? (capYear * daysIn[p]) / 365 : 0,
          fixed: Number.isFinite(fixedYear) ? (fixedYear * daysIn[p]) / 365 : 0,
          self: use > 0 ? Math.max(0, Math.min(1, 1 - imp / use)) * 100 : 0,
        };
      }
      const approx = costExact ? "" : "≈ ";
      const row = (label, fn, cls = "", sub = "") =>
        `<tr class="${cls}"><th scope="row">${esc(label)}${sub ? `<small class="muted">${esc(sub)}</small>` : ""}</th>${PER.map(
          (p) => `<td>${ready ? fn(E[p]) : "…"}</td>`,
        ).join("")}</tr>`;
      const months = parseInt(this._hass.states[c.capacity.average]?.attributes?.months_known, 10) || 0;
      const notes = [costExact ? this.t("energy_note_exact") : this.t("energy_note_estimate")];
      if (Number.isFinite(capYear))
        notes.push(this.t(months >= 12 ? "energy_note_capacity_full" : "energy_note_capacity", {
          rate: this.nf(capYear / Math.max(capKw, 0.001), 2), months,
        }));
      if (Number.isFinite(fixedYear)) notes.push(this.t("energy_note_fixed", { v: this.nf(fixedYear, 2) }));
      if (unpriced > 0.05) notes.push(this.t("energy_note_unpriced", { kwh: this.nf(unpriced, 1) }));
      if (this._adv && this._has(c.capacity.month_peak))
        notes.push(this.t("energy_note_peak", { kw: this.nf(this._num(c.capacity.month_peak), 2) }));
      return `<div class="card">
        <span class="lbl">${esc(this.t("energy_title"))}</span>
        <table class="etab"><thead><tr><th></th><th>${esc(this.t("col_today"))}</th><th>${esc(this.t("col_week"))}</th><th>${esc(this.t("col_month"))}</th></tr></thead><tbody>
          ${row(this.t("row_use"), (e) => this.kwh(e.use), "", this.t("row_use_sub"))}
          ${hasSolar ? row(this.t("row_solar"), (e) => this.kwh(e.solar)) : ""}
          ${row(this.t("row_import"), (e) => this.kwh(e.imp))}
          ${row(this.t("row_export"), (e) => this.kwh(e.exp))}
          ${row(this.t("row_cost"), (e) => approx + this.eur(e.cost), "money")}
          ${Number.isFinite(capYear) ? row(this.t("row_capacity"), (e) => this.eur(e.cap), "money", this.t("row_capacity_sub", { kw: this.nf(capKw, 1) })) : ""}
          ${Number.isFinite(fixedYear) ? row(this.t("row_fixed"), (e) => this.eur(e.fixed), "money", this.t("row_fixed_sub")) : ""}
          ${row(this.t("row_comp"), (e) => `− ${approx}${this.eur(e.comp)}`, "money")}
          ${row(this.t("row_total"), (e) => approx + this.eur(e.cost + e.cap + e.fixed - e.comp), "net", this.t("row_total_sub"))}
          ${this._adv && hasSolar ? row(this.t("row_self"), (e) => `${this.nf(e.self, 0)} %`, "", this.t("row_self_sub")) : ""}
          ${this._adv && hasBat ? row(this.t("row_bat_in"), (e) => this.kwh(e.batIn)) + row(this.t("row_bat_out"), (e) => this.kwh(e.batOut)) : ""}
        </tbody></table>
        <small class="muted">${esc(notes.join(" "))}</small>
      </div>`;
    }

    _compareCard() {
      const now = monthKey(new Date());
      const cur = this._compare(now);
      if (!cur) return "";
      const prev = this._compare(shiftMonth(now, -1));
      const cols = [cur, prev].filter(Boolean);
      const cell = (x, k) => {
        if (k === "dynamic") return `${x.approx ? "≈ " : ""}${this.eur(x.dynamic)}`;
        const o = x.offers[k];
        if (!o) return `<span class="muted">–</span>`;
        const d = o.total - x.dynamic;
        return `${this.eur(o.total)}<small class="muted">${d >= 0 ? "+" : "−"} ${this.eur(Math.abs(d))}</small>`;
      };
      const rows = ["dynamic", ...Object.keys(cur.offers)].map((k) => {
        const label = k === "dynamic" ? this.t("cmp_dynamic") : this.t(`cmp_${k}`);
        const sub = k === "dynamic" ? this.t("cmp_dynamic_sub") : this.t("cmp_price", { v: this.nf(cur.offers[k].price, 2) });
        return `<tr><th scope="row">${esc(label)}<small class="muted">${esc(sub)}</small></th>${cols.map((x) => `<td>${cell(x, k)}</td>`).join("")}</tr>`;
      });
      const best = Math.min(...Object.values(cur.offers).map((o) => o.total));
      const diff = best - cur.dynamic;
      const sum = `<div class="sum ${diff >= 0 ? "ok" : "bad"}">${diff >= 0 ? I.check(16) : I.cross(16)} ${esc(
        this.t(diff >= 0 ? "cmp_saved" : "cmp_lost", { v: this.eur(Math.abs(diff)) }),
      )}</div>`;
      return `<div class="card">
        <span class="lbl">${esc(this.t("cmp_title"))}</span>
        <table class="etab"><thead><tr><th></th>${cols.map((x) => `<th>${esc(this.monthName(x.key))}${x.key === now ? `<small class="muted">${esc(this.t("so_far"))}</small>` : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody></table>
        ${sum}
        <small class="muted">${esc(this.t("cmp_note"))}</small>
      </div>`;
    }

    _lastYearCard() {
      if (!this._months) return "";
      const cur = this._month(monthKey(new Date()));
      const ly = this._lastYear[shiftMonth(cur.key, -12)];
      if (!ly || !cur.reliable || cur.total == null) return "";
      const f = cur.days / daysInMonth(cur.key);
      const lyEur = Number(ly.eur) * f;
      const lyKwh = Number(ly.kwh) * f;
      const diff = cur.total - lyEur;
      const pct = lyEur > 0 ? (diff / lyEur) * 100 : 0;
      const perKwh = (eurv, kwhv) => (kwhv > 0 ? this.t("cents_per_kwh", { v: this.nf((eurv / kwhv) * 100, 1) }) : "");
      return `<div class="card">
        <span class="lbl">${esc(this.t("ly_title", { days: cur.days, month: this.monthName(cur.key) }))}</span>
        <div class="vs">
          <div><small class="muted">${esc(this.t("ly_now"))}</small><b>${cur.approx ? "≈ " : ""}${this.eur(cur.total)}</b><small class="muted">${esc(this.t("ly_bought", { kwh: this.nf(cur.imp, 0), price: perKwh(cur.total, cur.imp) }))}</small></div>
          <div><small class="muted">${esc(this.t("ly_then"))}</small><b>${this.eur(lyEur)}</b><small class="muted">${esc(this.t("ly_bought", { kwh: this.nf(lyKwh, 0), price: perKwh(lyEur, lyKwh) }))}</small></div>
        </div>
        <div class="sum ${diff <= 0 ? "ok" : "bad"}">${diff <= 0 ? I.check(16) : I.cross(16)} ${esc(
          this.t(diff <= 0 ? "ly_less" : "ly_more", { v: this.eur(Math.abs(diff)), pct: this.nf(Math.abs(pct), 0) }),
        )}</div>
        <small class="muted">${esc(this.t("ly_note", { days: cur.days }))}</small>
      </div>`;
    }

    _monthsCard() {
      if (!this._months) return "";
      const rows = [];
      const hasLy = Object.keys(this._lastYear).length > 0;
      for (let i = 0; i < (this._adv ? 12 : 6); i++) {
        const mm = this._month(shiftMonth(monthKey(new Date()), -i));
        if (!mm.imp && mm.invoice == null) continue;
        const ly = this._lastYear[shiftMonth(mm.key, -12)];
        const calc = mm.reliable && mm.total != null
          ? `${mm.approx ? "≈ " : ""}${this.eur(mm.total)}`
          : `<span class="muted">–</span>`;
        const inv = mm.invoice != null
          ? `${this.eur(mm.invoice)}${mm.reliable && mm.total != null ? `<small class="muted">${mm.invoice - mm.total >= 0 ? "+" : "−"} ${this.eur(Math.abs(mm.invoice - mm.total))}</small>` : ""}`
          : `<span class="muted">–</span>`;
        const lyCell = ly
          ? this.eur(mm.current ? (Number(ly.eur) * mm.days) / daysInMonth(mm.key) : Number(ly.eur))
          : `<span class="muted">–</span>`;
        rows.push(`<tr><th scope="row">${esc(this.monthName(mm.key))}${mm.current ? `<small class="muted">${esc(this.t("so_far"))}</small>` : ""}${
          this._adv && Number.isFinite(mm.peak) ? `<small class="muted">${esc(this.t("peak_kw", { kw: this.nf(mm.peak, 1) }))}</small>` : ""
        }</th><td>${this.t("kwh", { v: this.nf(mm.imp, 0) })}</td><td>${calc}</td><td>${inv}</td>${hasLy ? `<td>${lyCell}</td>` : ""}</tr>`);
      }
      if (!rows.length) return "";
      return `<div class="card">
        <span class="lbl">${esc(this.t("months_title"))}</span>
        <table class="etab mtab"><thead><tr><th></th><th>${esc(this.t("col_bought"))}</th><th>${esc(this.t("col_calculated"))}</th><th>${esc(this.t("col_invoice"))}</th>${hasLy ? `<th>${esc(this.t("col_last_year"))}</th>` : ""}</tr></thead>
        <tbody>${rows.join("")}</tbody></table>
        <small class="muted">${esc(this.t("months_note"))}${this._cfg.exact_from ? ` ${esc(this.t("months_note_exact", { month: this.monthName(this._cfg.exact_from) }))}` : ""} ${esc(this.t("months_note_invoice"))}</small>
      </div>`;
    }

    _goalRule(g) {
      const v = (id, d = 0) => this.nf(this._num(id), d);
      if (g.goal === "morning") return this.t("goal_morning_rule", { min: v(g.target), shower: v(g.shower) });
      if (g.goal === "bath")
        return this.t("goal_bath_rule", { goal: v(g.target), time: String(this._hass.states[g.time]?.state || "").slice(0, 5) });
      if (g.goal === "solar_used") return this.t("goal_solar_used_rule", { limit: v(g.limit, 1) });
      return "";
    }

    _goalWhen(g) {
      if (g.when === "sunrise") return this.t("when_sunrise");
      if (g.when === "entity") return this.t("when_at", { time: String(this._hass.states[g.time]?.state || "").slice(0, 5) });
      return this.t("when_at", { time: g.at });
    }

    _goalsCard() {
      const s = this._goalState();
      if (!s.goals.length) return "";
      const rows = s.goals.map((g) => {
        const r = s.today[g.goal];
        let mark;
        let line;
        if (!r) {
          mark = `<span class="mk wait">${I.clock()}</span>`;
          const missedNow = this._num(this._cfg.solar_missed);
          const live = g.goal === "solar_used" && Number.isFinite(missedNow)
            ? this.t("goal_solar_live", { kwh: this.nf(missedNow, 1) })
            : "";
          line = this.t("goal_measured", { when: this._goalWhen(g) }) + live;
        } else {
          mark = r.s === "met" ? `<span class="mk ok">${I.check()}</span>` : `<span class="mk bad">${I.cross()}</span>`;
          line = this.localNum(r.detail);
        }
        return `<div class="goal">${mark}<span class="t"><b>${esc(this.t(`goal_${g.goal}`))}</b><small class="muted">${esc(line)}</small>${
          this._adv ? `<small class="muted rule">${esc(this.t("goal_rule", { rule: this._goalRule(g) }))}</small>` : ""
        }</span></div>`;
      });
      return `<div class="card"><span class="lbl">${esc(this.t("goals_title"))}</span>${rows.join("")}</div>`;
    }

    _partsCard(kinds, st, money) {
      const c = this._cfg;
      const parts = kinds.map((k) => {
        const v = st(k.sensor, "day");
        const since = this._num(k.sensor) || 0;
        const miss = this._attr(k.sensor, "export_missed");
        const on = Math.abs(v) > 0.005;
        const kwhToday = k.today_kwh ? this._num(k.today_kwh) : NaN;
        const text = on
          ? this.t(`kind_${k.kind}_on`, { kwh: this.nf(kwhToday, 1) })
          : this.t(`kind_${k.kind}_off`);
        const extra = this._adv
          ? `<small class="muted rule">${esc(this.t("part_extra", { month: this.eur(st(k.sensor, "month")), since: this.eur(since) }))}${
              k.net ? esc(this.t("part_net", { v: this.eur(since - miss) })) : ""
            }</small>`
          : "";
        return `<div class="part ${on ? "" : "off"}"><span class="dot" style="background:${ink(C[k.color] || C.accent)}"></span>
          <span class="t"><b>${esc(this.t(`kind_${k.kind}`))}</b><small class="muted">${esc(text)}</small>${extra}</span>
          <b class="amt">${money(v)}</b></div>`;
      });
      if (this._has(c.shading)) {
        const n = st(c.shading, "day");
        parts.push(`<div class="part ${n > 0 ? "" : "off"}"><span class="dot" style="background:${ink(C.amber)}"></span>
          <span class="t"><b>${esc(this.t("shading"))}</b><small class="muted">${esc(
            n > 0 ? this.t(n === 1 ? "shading_on_one" : "shading_on", { n: this.nf(n, 0) }) : this.t("shading_off"),
          )}</small></span><b class="amt">${esc(this.t("times", { n: this.nf(n, 0) }))}</b></div>`);
      }
      if (!parts.length) return "";
      return `<div class="card"><span class="lbl">${esc(this.t("parts_title"))}</span>${parts.join("")}</div>`;
    }

    _historyCard() {
      const goals = this._goalList();
      if (!goals.length) return "";
      const days = [];
      for (let i = 1; i <= 14; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(dayKey(d));
      }
      const mark = (g) =>
        !g
          ? `<span class="mk none">${I.dash()}</span>`
          : g.s === "met"
            ? `<span class="mk ok sm" title="${esc(this.localNum(g.detail))}">${I.check(14)}</span>`
            : `<span class="mk bad sm" title="${esc(this.localNum(g.detail))}">${I.cross(14)}</span>`;
      return `<div class="card">
        <span class="lbl">${esc(this.t("history_title"))}</span>
        <table><thead><tr><th></th>${goals.map((g) => `<th>${esc(this.t(`goal_${g.goal}_short`))}</th>`).join("")}</tr></thead><tbody>${days
          .map((d) => `<tr><td>${esc(this.dayLabel(d))}</td>${goals.map((g) => `<td>${mark((this._goals[d] || {})[g.goal])}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`;
    }

    _logCard() {
      const adv = this._adv;
      // Nothing that writes readable lines is installed: no card (the extended view still shows the automations).
      if (!adv && !this._cfg.log_entities.some((id) => this._has(id))) return "";
      const shown = this._log.filter((e) => adv || e.kind === "line").slice(0, adv ? 80 : 25);
      const rows = shown.length
        ? shown.map((e) => {
            const t = new Date(e.when * 1000);
            const when = adv ? `${this.dayLabel(dayKey(t))} ${this.hhmm(t)}` : this.hhmm(t);
            if (e.kind === "line")
              return `<div class="log"><span class="time">${esc(when)}</span><span><b>${esc(e.title)}</b> ${esc(e.text)}</span></div>`;
            const acts = e.actions.length
              ? `<span class="acts">${e.actions.map((a) => `<span class="act">${esc(a)}</span>`).join("")}</span>`
              : `<small class="muted">${esc(this.t("log_nothing"))}</small>`;
            return `<div class="log ${e.kind}"><span class="time">${esc(when)}</span><span><b>${esc(e.title)}</b> <small class="muted">${esc(e.trigger)}</small>${acts}</span></div>`;
          }).join("")
        : `<small class="muted">${esc(this._loaded ? this.t("log_empty") : this.t("loading"))}</small>`;
      const note = this._logNote
        ? `<small class="muted">${esc(this._logNote)}</small>`
        : adv && this._busy.log && shown.length
          ? `<small class="muted">${esc(this.t("log_loading_runs"))}</small>`
          : "";
      return `<div class="card"><span class="lbl">${esc(this.t(adv ? "log_title_adv" : "log_title"))}</span><div class="logs">${rows}</div>${note}</div>`;
    }

    _howCard(kinds) {
      const lines = [esc(this.t("how_saving"))];
      for (const k of kinds) lines.push(`<b>${esc(this.t(`kind_${k.kind}`))}</b>: ${esc(this.t(`how_${k.kind}`))}`);
      if (kinds.some((k) => k.net)) lines.push(esc(this.t("how_net")));
      if (this._has(this._cfg.shading)) lines.push(`<b>${esc(this.t("shading"))}</b>: ${esc(this.t("how_shading"))}`);
      lines.push(esc(this.t("how_goals")));
      return `<details class="card how"><summary>${esc(this.t("how_title"))}</summary>${lines.map((l) => `<p>${l}</p>`).join("")}</details>`;
    }

    _onClick(ev) {
      const el = ev.composedPath().find((n) => n.dataset && n.dataset.act);
      if (!el) return;
      if (el.dataset.act === "adv") {
        this._adv = !this._adv;
        try {
          localStorage.setItem(VIEW_KEY, this._adv ? "1" : "0");
        } catch (e) {
          /* private mode */
        }
        this._render();
        this._load();
      }
    }
  }

  const css = () => `
:host { display: block; }
* { box-sizing: border-box; }
summary:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.wrap { font-family: Figtree, system-ui, sans-serif; color: ${C.text}; background: ${C.bg}; min-height: calc(100vh - var(--header-height, 56px)); padding: 20px 16px 32px; }
.muted { color: ${C.muted}; }
small { font-size: 13px; line-height: 1.4; }
cw-kop:not(:defined) { display: block; min-height: 56px; max-width: 1100px; margin: 0 auto 12px; font: 28px/56px Caprasimo, Georgia, serif; }
cw-kop:not(:defined) > * { display: none; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; max-width: 1100px; margin: 0 auto; }
@media (min-width: 900px) { .cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.card { background: ${C.card}; border-radius: 22px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.lbl { font-size: 15px; color: ${C.muted}; }
.hero { gap: 8px; }
.hero .big { font-size: clamp(40px, 12vw, 56px); line-height: 1.05; color: ${ink(C.zon)}; }
.hero > .muted { font-size: 14px; line-height: 1.4; }
.sum { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 10px 12px; border-radius: 14px; font-size: 15px; font-weight: 600; }
.sum.ok { background: ${tint(C.green, 0.18)}; color: ${onTint(C.green)}; }
.sum.bad { background: ${tint(C.red, 0.18)}; color: ${onTint(C.red)}; }
.periods { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 4px; font-size: 14px; color: ${C.muted}; }
.periods b { color: ${C.text}; margin-left: 4px; }
.goal, .part { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; background: ${C.bg}; border-radius: 16px; }
.part.off { opacity: .6; }
.t { display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0; }
.t b { font-size: 16px; }
.rule { opacity: .8; }
.amt { font-size: 17px; white-space: nowrap; flex: none; }
.dot { width: 10px; height: 10px; border-radius: 99px; flex: none; margin-top: 6px; }
.mk { display: inline-flex; width: 32px; height: 32px; border-radius: 99px; align-items: center; justify-content: center; flex: none; }
.mk.sm { width: 26px; height: 26px; }
.mk.ok { background: ${tint(C.green, 0.18)}; color: ${onTint(C.green)}; }
.mk.bad { background: ${tint(C.red, 0.18)}; color: ${onTint(C.red)}; }
.mk.wait { background: ${C.raised}; color: ${C.muted}; }
.mk.none { color: ${sep()}; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: center; font-weight: 600; color: ${C.muted}; font-size: 13px; padding: 0 4px 6px; }
td { text-align: center; padding: 4px; border-top: 1px solid ${sep()}; }
td:first-child, th:first-child { text-align: left; }
.etab th[scope="row"] { text-align: left; font-weight: 500; color: ${C.text}; font-size: 14px; padding: 8px 4px; }
.etab th[scope="row"] small, .etab thead th small { display: block; font-weight: 400; font-size: 12px; }
.etab td { text-align: right; padding: 8px 4px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.etab td small { display: block; font-size: 12px; }
.etab thead th { text-align: right; }
.etab thead th:first-child { text-align: left; }
.etab tr.money td, .etab tr.money th { color: ${C.muted}; }
.etab tr.net th, .etab tr.net td { font-weight: 700; color: ${ink(C.zon, 4.5)}; font-size: 15px; }
.vs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.vs > div { background: ${C.bg}; border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.vs b { font-size: clamp(20px, 6vw, 26px); }
.logs { display: flex; flex-direction: column; }
.log { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; padding: 10px 2px; border-top: 1px solid ${sep()}; font-size: 14px; line-height: 1.45; }
.log:first-child { border-top: 0; padding-top: 0; }
.log .time { color: ${C.muted}; font-variant-numeric: tabular-nums; }
.log b { color: ${ink(C.zon, 4.5)}; font-weight: 600; }
.log.run b, .log.quiet b { color: ${C.text}; }
.log.quiet { opacity: .55; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.act { padding: 3px 10px; border-radius: 99px; background: ${C.bg}; font-size: 13px; }
.how summary { cursor: pointer; font-size: 15px; color: ${C.muted}; list-style: none; }
.how summary::-webkit-details-marker { display: none; }
.how summary::after { content: " ›"; }
.how[open] summary::after { content: " ⌄"; }
.how p { margin: 0; font-size: 14px; line-height: 1.5; color: ${C.muted}; }
.how p b { color: ${C.text}; }
`;

  if (!customElements.get("results-screen-card")) customElements.define("results-screen-card", ResultsScreenCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "results-screen-card", name: "Results (ha-kit)", description: `v${VERSION}` });
})();

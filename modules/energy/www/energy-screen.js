// Energy screen (ha-kit module energy): live flow diagram, home battery, charger and car, hot water, price and peak,
// today's totals, in one custom card: type: custom:energy-screen-card.
//   Every tile opens a detail sheet (more rows, a 24 h graph, the settings of the installed modules behind the gear in
//   its header); the layers button in the header switches to an extended layout (one choice per device).
//   The flow diagram is power-flow-card-plus (HACS), mounted once from config.flow.
// Nothing about the house is built in: every entity id, feature flag, path and text comes from the card config that
// tools/fill.py renders from house.yaml, modules: and the capabilities (energy/dashboard/config.json -> the view).
// A block whose feature flag is false, or whose entity is missing or has no value, is not drawn.
// Needs cw-thema.js of module base (cw-kop, cw-knop, cw-chip, cw-metric and the --cw-* theme tokens).
(() => {
  // The language is part of the version, so browsers reload the file when house.language changes.
  const VERSION = "1-<@ t('language_code') @>";
  // Re-render at most once per THROTTLE_MS on state changes; clicks render immediately.
  const THROTTLE_MS = 5000;
  // After a tap or slider change, state updates render immediately for a while so feedback stays instant.
  const FAST_MS = 10000;
  // Today's meter totals and savings come from statistics, reloaded at most this often.
  const DAY_MS = 5 * 60 * 1000;
  const VIEW_KEY = "ha-kit-energy-extended";
  const NO_VALUE = new Set([undefined, null, "", "unknown", "unavailable"]);

  // ---------- theme palette ----------
  // Colours come from the --cw-* tokens of theme Organic (module base, light/dark) and are re-read when the theme
  // changes. DARK / LIGHT are the fallbacks when the tokens are missing. Values stay hex strings for SVG attributes.
  const DARK = {
    bg: "#1d1a17",
    card: "#2a2622",
    raised: "#3a3530",
    line: "#4a433c",
    text: "#F5EAD8",
    muted: "#BFB3A1",
    zon: "#E8A571",
    batt: "#9CAE7E",
    huis: "#F5C9AE",
    auto: "#AEBF92",
    net: "#C98A5A",
    inj: "#C9935F",
    water: "#7FA9BA",
    accent: "#C67139",
    green: "#6FBF73",
    red: "#E36B5A",
    amber: "#E8B04A",
    onAccent: "#1d1a17",
  };
  const LIGHT = {
    bg: "#F5EAD8",
    card: "#EBDDC5",
    raised: "#F9F3EA",
    line: "#D8C6A8",
    text: "#201E1D",
    muted: "#645C50",
    accent: "#C67139",
    onAccent: "#201E1D",
    green: "#41692F",
    amber: "#7E5409",
    red: "#A63B28",
    inj: "#874B22",
    water: "#4F7F92",
  };
  const TOKEN = {
    bg: "bg",
    card: "card",
    raised: "raised",
    line: "line",
    text: "text",
    muted: "muted",
    accent: "accent",
    onAccent: "on-accent",
    green: "good",
    amber: "warn",
    red: "bad",
    zon: "zon",
    batt: "batterij",
    net: "net",
    huis: "huis",
    auto: "wagen",
    inj: "injectie",
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
    const x = rgbOf(a),
      y = rgbOf(b);
    return x && y
      ? `#${x
          .map((v, i) =>
            Math.round(v + (y[i] - v) * t)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`
      : a;
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // Move a colour towards the text colour until it reaches `min` contrast on the card, the page background and its
  // own soft tint: 4.5:1 by default, also for icons (readable for people with low vision).
  const INK = new Map();
  const ink = (c, min = 4.5) => {
    if (!rgbOf(c)) return c;
    const key = `${c}|${C.card}|${C.bg}|${min}`;
    if (!INK.has(key)) {
      const own = mix(C.card, c, 0.18);
      const worst = (x) => Math.min(contrast(x, C.card), contrast(x, C.bg), contrast(x, own));
      let out = c;
      for (let t = 0.05; t < 0.96 && worst(out) < min; t += 0.05) out = mix(c, C.text, t);
      INK.set(key, out);
    }
    return INK.get(key);
  };
  const sep = () => (C.light ? C.line : C.raised);
  const tint = (c, t = 0.16) => mix(C.card, c, t);
  const readPalette = (el, hass) => {
    const cs = getComputedStyle(el);
    const fb = hass?.themes?.darkMode === false ? { ...DARK, ...LIGHT } : DARK;
    for (const k of Object.keys(DARK))
      C[k] = (TOKEN[k] && cs.getPropertyValue(`--cw-${TOKEN[k]}`).trim()) || fb[k];
    C.light = lum(C.bg) > 0.4;
    return Object.keys(DARK)
      .map((k) => C[k])
      .join();
  };
  const hasTokens = (el) => !!getComputedStyle(el).getPropertyValue("--cw-bg").trim();
  const themeKey = (hass) =>
    `${hass?.themes?.darkMode}|${hass?.themes?.theme}|${hass?.selectedTheme?.theme}`;

  // ---------- helpers ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // "{kw} to the car" + {kw: "1.2 kW"} -> text; unknown {names} stay as they are.
  const fmt = (text, values = {}) =>
    String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  let LOCALE = "en-GB";
  const nf = (v, d = 1) =>
    Number.isFinite(v)
      ? v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d })
      : "–";
  const kw = (v) => `${nf(Math.abs(v) < 0.05 ? 0 : v, Math.abs(v) < 0.05 ? 0 : 1)} kW`;
  const hhmm = (d) => d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  const timeOf = (iso) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? hhmm(d) : "";
  };

  // Icons: the same drawings as cw-thema.js (module base), 24x24 strokes. The battery takes a fill level.
  const PATHS = {
    zon: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>`,
    net: `<path d="M12 2 L6 22 M12 2 L18 22 M8 15 H16 M9.5 9 H14.5 M3 6 H21"/>`,
    huisje: `<path d="M4 11 L12 4 L20 11M6 9.5V20h12V9.5M10 20v-5h4v5"/>`,
    auto: `<g transform="translate(0 -1)"><path d="M4.7 16.5 H3 V13.6 c0-1 .7-1.7 1.6-1.9 L8.2 11 c1.4-1.9 3.2-3.6 6-3.6 c2.4 0 4.3 1.3 5.7 3.3 l1 .3 c.7.2 1.1.8 1.1 1.5 v3.9 H19.3"/><path d="M9.3 16.5 H14.7"/><circle cx="7" cy="16.5" r="2.3"/><circle cx="17" cy="16.5" r="2.3"/><path d="M8.5 11 H19.6"/></g>`,
    neer: `<path d="M12 4v15M6 13l6 6 6-6"/>`,
    op: `<path d="M12 20V5M6 11l6-6 6 6"/>`,
    blad: `<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/>`,
    golf: `<path d="M2 12c2.5-5 5-5 7.5 0s5 5 7.5 0 3.5-3 5-2"/>`,
    bliksem: `<path d="M13 2 L5 13 H11 L10 22 L18 10 H12 Z" fill="currentColor" stroke="none"/>`,
    vink: `<path d="M5 12.5 L10 17 L19 7"/>`,
    waarschuwing: `<path d="M12 3 L22 20 H2 Z"/><path d="M12 10v4M12 17.2v.01"/>`,
    maan: `<path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z"/>`,
    pauze: `<path d="M9 6v12M15 6v12"/>`,
    zonwolk: `<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M1.5 8H3M3.4 3.4l1 1M12.6 3.4l-1 1"/><path d="M9 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A3 3 0 0 0 9 20z"/>`,
    tandwiel: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>`,
    schild: `<path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z"/>`,
    euro: `<path d="M18 6.5 A7 7 0 1 0 18 17.5"/><path d="M4 10 H13 M4 14 H13"/>`,
    wolk: `<path d="M7 19h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 19z"/>`,
    kruis: `<path d="M6 6l12 12M18 6L6 18"/>`,
    grafiek: `<path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-7"/>`,
    stekker: `<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>`,
    boiler: `<rect x="6" y="2" width="12" height="18" rx="4"/><path d="M9 22v-2M15 22v-2M12 7c-1.5 2-2 3-2 4a2 2 0 0 0 4 0c0-1-.5-2-2-4z"/>`,
    warmwater: `<rect x="3" y="2" width="11" height="17" rx="3.5"/><path d="M5.5 21.5V19M11.5 21.5V19M8.5 6.5c-1.3 1.7-1.8 2.6-1.8 3.4a1.8 1.8 0 0 0 3.6 0c0-.8-.5-1.7-1.8-3.4z"/><circle cx="18" cy="16.5" r="4.2"/><path d="M18 14.3v2.2l1.4.9"/>`,
    klok: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  };
  const svg = (body, color, size) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" style="color:${color}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const battery = (level) => {
    const h = Math.round(clamp(level ?? 0.7, 0, 1) * 14);
    return `<rect x="6" y="4" width="12" height="18" rx="2"/><path d="M10 2h4"/><rect x="8.5" y="${20 - h}" width="7" height="${h}" rx="1" fill="currentColor" stroke="none"/>`;
  };
  // I.x(colour, size[, battery level][, plain]); plain = colour as given (on an accent fill), else deepened by ink().
  const ico = (name, size, level) => (c, s = size, f = level, plain = false) =>
    svg(name === "batterij" ? battery(f) : PATHS[name] || "", plain ? c : ink(c), s);
  const I = {
    boiler: ico("boiler", 18),
    warmwater: ico("warmwater", 18),
    sun: ico("zon", 26),
    sunSmall: ico("zon", 16),
    pylon: ico("net", 26),
    house: ico("huisje", 26),
    batt: ico("batterij", 26, 0.7),
    car: ico("auto", 26),
    down: ico("neer", 26),
    up: ico("op", 26),
    leaf: ico("blad", 18),
    wave: ico("golf", 18),
    bolt: ico("bliksem", 18),
    check: ico("vink", 28),
    warn: ico("waarschuwing", 28),
    moon: ico("maan", 28),
    pause: ico("pauze", 18),
    cloud: ico("zonwolk", 22),
    gear: ico("tandwiel", 22),
    shield: ico("schild", 18),
    euro: ico("euro", 22),
    co2: ico("wolk", 22),
    close: ico("kruis", 22),
    chart: ico("grafiek", 18),
    plug: ico("stekker", 18),
    clock: ico("klok", 18),
  };

  // Icon chip (<cw-chip> of cw-thema.js): icon (+ "-> icon"), short text; label = full meaning (title/aria).
  const chip = (icoon, text, label, o = {}) =>
    `<cw-chip icoon="${icoon}"${o.naar ? ` naar="${o.naar}"` : ""} label="${esc(label)}"${o.info ? ` info="${esc(o.info)}"` : ""}${o.titel ? ` titel="${esc(o.titel)}"` : ""}${o.entity ? ` entity="${esc(o.entity)}"` : ""}${o.path ? ` path="${esc(o.path)}"` : ""}${o.padLabel ? ` pad-label="${esc(o.padLabel)}"` : ""}${o.waarden ? ` waarden="${esc(JSON.stringify(o.waarden))}"` : ""}${o.toon ? ` toon="${o.toon}"` : ""}${o.kaal ? " kaal" : ""}${o.uit ? " uit" : ""}${o.ic || o.ic2 ? ` style="${o.ic ? `--ic:${ink(o.ic)};` : ""}${o.ic2 ? `--ic2:${ink(o.ic2)};` : ""}"` : ""}>${esc(text ?? "")}</cw-chip>`;

  class EnergyScreenCard extends HTMLElement {
    setConfig(config) {
      if (!config || typeof config.roles !== "object" || typeof config.strings !== "object")
        throw new Error(
          "energy-screen-card: roles and strings are rendered by ha-kit (tools/fill.py): deploy the module energy",
        );
      this._cfg = {
        features: {},
        paths: {},
        phases: [],
        consumers: [],
        savings: [],
        settings: [],
        cars: [],
        grid_import_kwh: [],
        grid_export_kwh: [],
        battery_sign: "discharge_positive",
        ...config,
      };
      this._R = this._cfg.roles;
      this._F = this._cfg.features;
      LOCALE = this._cfg.strings.locale || LOCALE;
      // Every entity the card reads: a change of one of them schedules a render.
      this._watch = [
        ...Object.values(this._R),
        ...this._cfg.phases.flatMap((p) => [p.import, p.export, p.voltage, p.current]),
        ...this._cfg.cars.flatMap((c) => [c.battery, c.limit, c.current, c.power, c.state]),
        ...this._cfg.settings.flatMap((g) => g.ids),
      ].filter((id) => typeof id === "string" && id.includes("."));
      try {
        this._adv = localStorage.getItem(VIEW_KEY) === "1";
      } catch (e) {
        this._adv = false;
      }
    }

    // Text from strings.yaml (rendered into the config); {placeholders} filled with `vars`.
    t(key, vars) {
      const s = this._cfg.strings[key];
      return fmt(s == null ? key : s, vars);
    }

    // Translated fixed value (a state such as "solar_only"): strings[prefix + value], else the value itself.
    tv(prefix, value) {
      const s = this._cfg.strings[`${prefix}${value}`];
      return s == null ? String(value ?? "–") : s;
    }

    getCardSize() {
      return 14;
    }

    set hass(hass) {
      this._hass = hass;
      (this._embeds || []).forEach((el) => {
        el.hass = hass;
      });
      if (!this.shadowRoot) this._init();
      const tk = themeKey(hass);
      if (tk !== this._tk) {
        this._tk = tk;
        this._tries = 0;
        readPalette(this, hass);
        clearTimeout(this._tkTimer);
        this._tkTimer = setTimeout(() => this._retheme(), 60);
      }
      const sig = this._watch.map((id) => hass.states[id]?.last_updated).join("|");
      if (sig === this._sig) return;
      this._sig = sig;
      if (this._dragging) {
        this._pending = true;
        return;
      }
      this._schedule();
    }

    // First render immediately, then at most once per THROTTLE_MS; the pending render always uses the latest hass.
    _schedule() {
      const fast = Date.now() < (this._fastUntil || 0);
      const wait = fast ? 0 : (this._lastRender || 0) + THROTTLE_MS - Date.now();
      if (wait <= 0) {
        clearTimeout(this._throttle);
        this._throttle = null;
        this._render();
        return;
      }
      if (this._throttle) return;
      this._throttle = setTimeout(() => {
        this._throttle = null;
        if (this._dragging) {
          this._pending = true;
          return;
        }
        this._render();
      }, wait);
    }

    // Theme changed: re-read the --cw-* tokens, then restyle and redraw.
    _retheme() {
      clearTimeout(this._tkTimer);
      // The view theme can arrive later than the first hass: retry until the tokens are there (max ±10 s).
      if (!hasTokens(this) && (this._tries = (this._tries || 0) + 1) < 40)
        this._tkTimer = setTimeout(() => this._retheme(), 250);
      const pal = readPalette(this, this._hass);
      if (pal === this._pal) return;
      this._pal = pal;
      const st = this.shadowRoot?.querySelector("style");
      if (st) st.textContent = css();
      const fb = this.shadowRoot?.querySelector(".fbtns");
      if (fb) fb.innerHTML = this._flowBtns();
      if (this._hass && this._built) this._render();
    }

    // Today's totals from the statistics (same numbers as the HA energy dashboard): grid import and export (the
    // meter registers, summed), solar (its energy meter, else the 5-minute power means), battery charge/discharge,
    // and today's savings of the results module.
    async _loadDay() {
      if (this._dayBusy || Date.now() - (this._dayAt || 0) < DAY_MS) return;
      this._dayBusy = true;
      const R = this._R,
        cfg = this._cfg;
      const energy = [
        ...cfg.grid_import_kwh,
        ...cfg.grid_export_kwh,
        ...[R.solar_energy, R.battery_charge_kwh, R.battery_discharge_kwh].filter(Boolean),
        ...cfg.savings,
      ];
      const change = (id) =>
        this._hass
          .callWS({
            type: "recorder/statistic_during_period",
            statistic_id: id,
            calendar: { period: "day" },
            types: ["change"],
            units: id.startsWith("sensor.results_") ? undefined : { energy: "kWh" },
          })
          .then((r) => r?.change)
          .catch(() => null);
      const vals = await Promise.all(energy.map(change));
      const v = Object.fromEntries(energy.map((id, i) => [id, vals[i]]));
      // Without a solar energy meter: the 5-minute means of the solar power since midnight (kWh = kW x 5/60).
      let solar = R.solar_energy ? v[R.solar_energy] : null;
      if (!Number.isFinite(solar) && R.solar_power) {
        const from = new Date();
        from.setHours(0, 0, 0, 0);
        solar = await this._hass
          .callWS({
            type: "recorder/statistics_during_period",
            start_time: from.toISOString(),
            period: "5minute",
            statistic_ids: [R.solar_power],
            types: ["mean"],
            units: { power: "kW" },
          })
          .then((r) => (r[R.solar_power] || []).reduce((a, x) => a + Math.max(x.mean || 0, 0) / 12, 0))
          .catch(() => null);
      }
      const sum = (list) =>
        list.length && list.every((id) => Number.isFinite(v[id])) ? list.reduce((t, id) => t + v[id], 0) : NaN;
      this._day = {
        imp: sum(cfg.grid_import_kwh),
        exp: sum(cfg.grid_export_kwh),
        gen: Number.isFinite(solar) ? solar : NaN,
        chg: R.battery_charge_kwh ? v[R.battery_charge_kwh] ?? NaN : NaN,
        dis: R.battery_discharge_kwh ? v[R.battery_discharge_kwh] ?? NaN : NaN,
        saved: cfg.savings.some((id) => Number.isFinite(v[id]))
          ? cfg.savings.reduce((t, id) => t + (Number.isFinite(v[id]) ? v[id] : 0), 0)
          : NaN,
      };
      this._dayAt = Date.now();
      this._dayBusy = false;
      this._render();
    }

    connectedCallback() {
      clearInterval(this._clock);
      this._clock = setInterval(() => this._hass && this._render(), 60000);
      if (this.shadowRoot) {
        this._listen();
        this._observe();
        if (this._hass) this._schedule();
      }
    }

    disconnectedCallback() {
      clearInterval(this._clock);
      this._clock = null;
      clearTimeout(this._throttle);
      this._throttle = null;
      this._dragging = false;
      if (this._onUp) {
        window.removeEventListener("pointerup", this._onUp);
        this._onUp = null;
      }
      (this._observers || []).forEach((o) => o.disconnect());
      this._observers = null;
    }

    _listen() {
      if (this._onUp) return;
      this._onUp = () => {
        if (!this._dragging) return;
        this._dragging = false;
        if (this._pending) {
          this._pending = false;
          setTimeout(() => this._render(), 300);
        }
      };
      window.addEventListener("pointerup", this._onUp);
    }

    _observe() {
      if (this._observers || !this._embedded || typeof ResizeObserver === "undefined") return;
      const slot = this.shadowRoot.querySelector(".flow-slot");
      const ro = (fn, el) => {
        const o = new ResizeObserver(fn);
        o.observe(el);
        return o;
      };
      this._observers = [];
      if (this._flowBox && slot)
        this._observers.push(
          ro(() => this._fitFlow(), slot),
          ro(() => this._fitFlow(), this._flowBox),
        );
    }

    _init() {
      this.attachShadow({ mode: "open" });
      this._spark = {};
      const root = this.shadowRoot;
      root.addEventListener("click", (ev) => this._onClick(ev));
      root.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && this._detail) {
          this._detail = null;
          this._render();
        }
        if ((ev.key === "Enter" || ev.key === " ") && ev.target?.dataset?.open) {
          ev.preventDefault();
          this._onClick(ev);
        }
      });
      root.addEventListener("pointerdown", (ev) => {
        if (ev.target.type === "range") this._dragging = true;
      });
      this._listen();
      root.addEventListener("input", (ev) => {
        const t = ev.target;
        if (t.type === "range") {
          const out = root.querySelector(`[data-out="${t.dataset.entity}"]`);
          if (out) out.textContent = this._fmtSetting(t.dataset.entity, +t.value);
        }
      });
      root.addEventListener("change", (ev) => {
        const t = ev.target;
        this._fastUntil = Date.now() + FAST_MS;
        if (t.type === "time")
          this._hass.callService("input_datetime", "set_datetime", {
            entity_id: t.dataset.entity,
            time: `${t.value}:00`,
          });
        if (t.type === "range")
          this._hass.callService("input_number", "set_value", { entity_id: t.dataset.entity, value: +t.value });
      });
    }

    // ---------- data ----------
    _has(id) {
      return !!id && !NO_VALUE.has(this._hass.states[id]?.state);
    }
    _n(id) {
      const v = parseFloat(this._hass.states[id]?.state);
      return Number.isFinite(v) ? v : NaN;
    }
    _s(id) {
      return id ? this._hass.states[id]?.state : undefined;
    }
    _a(id, k) {
      return id ? this._hass.states[id]?.attributes?.[k] : undefined;
    }
    // Power role in kW whatever its unit (W or kW); 0 when missing.
    _kwOf(id) {
      const v = this._n(id);
      const u = String(this._a(id, "unit_of_measurement") || "").toLowerCase();
      return Number.isFinite(v) ? (u === "w" ? v / 1000 : u === "mw" ? v * 1000 : v) : 0;
    }

    _model() {
      const R = this._R,
        F = this._F;
      const k = (id) => (id ? this._kwOf(id) : 0);
      const m = {};
      m.pv = F.solar ? Math.max(k(R.solar_power), 0) : 0;
      m.imp = Math.max(k(R.grid_import), 0);
      m.exp = Math.max(k(R.grid_export), 0);
      m.net = m.imp - m.exp;
      // Battery power, discharge positive (house.yaml energy.battery_power_sign).
      const sign = this._cfg.battery_sign === "charge_positive" ? -1 : 1;
      m.bat = F.battery ? sign * k(R.battery_power) : 0;
      m.soc = F.battery ? this._n(R.battery_soc) : NaN;
      m.carKw = F.charger ? Math.max(k(R.charger_power), 0) : 0;
      m.load = Math.max(m.pv + m.net + m.bat, 0); // total consumption incl. the car
      m.carKw = Math.min(m.carKw, m.load);
      m.house = Math.max(m.load - m.carKw, 0);
      const dis = Math.max(m.bat, 0),
        chg = Math.max(-m.bat, 0);
      const f = {};
      f.zh = Math.min(m.pv, m.load);
      f.zb = Math.min(m.pv - f.zh, chg);
      f.zn = Math.max(m.pv - f.zh - f.zb, 0);
      f.bh = Math.min(dis, m.load - f.zh);
      f.nh = Math.max(m.load - f.zh - f.bh, 0);
      f.nb = Math.max(chg - f.zb, 0);
      f.bn = Math.max(dis - f.bh, 0);
      m.flows = f;
      // Share of what we use right now (car included) that comes from sun or battery, and of the sun we use ourselves.
      m.ownNow = m.load > 0.05 ? clamp((f.zh + f.bh) / m.load, 0, 1) : NaN;
      m.selfUseNow = m.pv > 0.05 ? clamp((f.zh + f.zb) / m.pv, 0, 1) : NaN;
      m.phases = (this._cfg.phases || []).map((p, i) => ({
        i: i + 1,
        id: p.import,
        kw: k(p.import) - k(p.export),
        v: this._n(p.voltage),
        a: this._n(p.current),
      }));
      const d = this._day || {};
      m.gen = F.solar ? (d.gen ?? NaN) : 0;
      m.impT = d.imp ?? NaN;
      m.expT = d.exp ?? NaN;
      m.saved = d.saved ?? NaN;
      m.chgT = d.chg ?? NaN;
      m.disT = d.dis ?? NaN;
      const z = (x) => (Number.isFinite(x) ? x : 0);
      // Home use incl. the car, computed like the HA energy dashboard.
      m.cons = Math.max(z(m.impT) - z(m.expT) + z(m.gen) + z(m.disT) - z(m.chgT), 0);
      m.evT = this._n(R.charger_energy_today);
      m.evGreen = this._n(R.charger_solar_energy_today);
      m.selfUse = m.gen > 0.1 ? clamp((m.gen - z(m.expT)) / m.gen, 0, 1) : NaN;
      m.autarky = m.cons > 0.1 && Number.isFinite(m.impT) ? clamp((m.cons - m.impT) / m.cons, 0, 1) : NaN;
      m.sunCar = Math.max(Math.min(z(m.evGreen), z(m.gen)), 0);
      m.sunBatt = Math.max(Math.min(z(m.chgT), z(m.gen) - z(m.expT)), 0);
      m.sunNet = Math.max(Math.min(z(m.expT), z(m.gen)), 0);
      m.sunHouse = Math.max(z(m.gen) - m.sunNet - m.sunBatt - m.sunCar, 0);
      m.fcToday = this._n(R.forecast_today);
      m.fcRest = this._n(R.forecast_remaining);
      m.fcTomorrow = this._n(R.forecast_tomorrow);
      // Day plan of energy-plan (sensor.energy_plan_margin): after the sun the state is no margin anymore.
      m.bf = (R.plan_margin && this._hass.states[R.plan_margin]?.attributes) || {};
      m.sunEnd = timeOf(m.bf.sun_end);
      m.marge = !R.plan_margin || m.bf.after_sun ? NaN : this._n(R.plan_margin);
      m.behind = this._s(R.battery_behind) === "on";
      // A steady value does not update last_updated: look at the freshest of the live power sensors.
      const newest = Math.max(
        ...[R.solar_power, R.grid_import, R.grid_export, R.battery_power, ...m.phases.map((p) => p.id)]
          .filter(Boolean)
          .map((id) => new Date(this._hass.states[id]?.last_updated || 0).getTime()),
      );
      m.fresh = Date.now() - newest < 180000;
      return m;
    }

    // ---------- render ----------
    // The skeleton is built once; the embedded diagram stays mounted so its animation never restarts.
    _skeleton() {
      this.shadowRoot.innerHTML = `<style>${css()}</style>
        <div class="wrap">
          <div class="head" data-part="head"></div>
          <div class="status" data-part="status"></div>
          <div class="grid">
            <div class="col left">
              ${this._flowCard()}
              <div class="pills" data-part="pills"></div>
              <div data-part="strip"></div>
            </div>
            <div class="col right" data-part="right"></div>
          </div>
          <div data-part="sheet"></div>
        </div>`;
      this._built = true;
      this._ensureEmbeds();
    }

    _render() {
      if (!this._hass || !this._cfg) return;
      if (!this._built) this._skeleton();
      this._lastRender = Date.now();
      this._loadDay();
      const m = this._model();
      const root = this.shadowRoot;
      const part = (name) => root.querySelector(`[data-part="${name}"]`);
      const old = root.querySelector(".sheet-body");
      const scroll = old ? old.scrollTop : 0;
      part("head").innerHTML = this._header(m);
      part("status").innerHTML = this._status(m);
      part("pills").innerHTML = this._powerTiles(m);
      part("strip").innerHTML = (this._adv ? this._advStrip(m) : this._todayStrip(m)) + this._ownCard(m);
      part("right").innerHTML =
        this._battCard(m) +
        this._priceCard() +
        this._cheapCard() +
        this._chargeCard(m) +
        this._hotWaterCard() +
        this._sunBar(m);
      part("sheet").innerHTML = this._detail ? this._sheet(m) : "";
      const nb = root.querySelector(".sheet-body");
      if (nb) nb.scrollTop = scroll;
    }

    _header(m) {
      const now = new Date();
      const day = now.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });
      const gear = this._cfg.settings.length
        ? `<cw-knop slot="acties" data-open="settings" icoon="tandwiel" label="${esc(this.t("settings"))}"></cw-knop>`
        : "";
      // Shared <cw-kop> of cw-thema.js: title, one muted line (date, live), round buttons.
      return `<cw-kop titel="${esc(this.t("title"))}">${esc(this.t("title"))}
        <span slot="sub">${esc(day)} · ${hhmm(now)} · <i class="dot" style="background:${m.fresh ? C.green : C.amber}" title="${esc(m.fresh ? this.t("live_title") : this.t("stale_title"))}"></i>${esc(m.fresh ? this.t("live") : this.t("stale"))}</span>
        <cw-knop slot="acties" data-act="adv" icoon="lagen" label="${esc(this.t("extended_view"))}"${this._adv ? " aan" : ""}></cw-knop>
        ${gear}
      </cw-kop>`;
    }

    // The live diagram is power-flow-card-plus (config.flow), mounted once.
    _flowCard() {
      if (!this._cfg.flow) return "";
      return `<div class="card flow"><div class="flow-slot"></div><div class="fbtns">${this._flowBtns()}</div></div>`;
    }

    // Detail buttons next to the diagram; redrawn on a theme change (the card itself is built once).
    _flowBtns() {
      const F = this._F;
      const btn = (key, icon, label) =>
        `<button class="fbtn" data-open="${key}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
      return [
        F.solar ? btn("solar", I.sun(C.zon, 20), this.t("details_solar")) : "",
        btn("grid", I.pylon(C.net, 20), this.t("details_grid")),
        btn("house", I.house(C.huis, 20), this.t("details_house")),
        F.battery ? btn("battery", I.batt(C.batt, 20, 0.7), this.t("details_battery")) : "",
        F.charger ? btn("charging", I.car(C.auto, 18), this.t("details_charging")) : "",
        F.hot_water_heater ? btn("hot_water", I.boiler(C.zon, 20), this.t("details_hot_water")) : "",
      ].join("");
    }

    async _ensureEmbeds() {
      if (this._embedding || !window.loadCardHelpers || !this._cfg.flow) return;
      this._embedding = true;
      const helpers = await window.loadCardHelpers();
      this._embeds = [];
      const el = helpers.createCardElement(this._cfg.flow);
      el.hass = this._hass;
      this._embeds.push(el);
      const box = document.createElement("div");
      box.className = "flow-inner";
      box.appendChild(el);
      this.shadowRoot.querySelector(".flow-slot")?.appendChild(box);
      this._flowBox = box;
      this._embedded = true;
      if (this.isConnected) this._observe();
    }

    // Scale the fixed-width diagram so it fills the slot without scrolling.
    _fitFlow() {
      const slot = this.shadowRoot.querySelector(".flow-slot");
      const box = this._flowBox;
      if (!slot || !box || !box.offsetHeight) return;
      const s = Math.min(slot.clientWidth / box.offsetWidth, slot.clientHeight / box.offsetHeight, 1.6);
      const next = `scale(${Math.max(s, 0.5).toFixed(3)})`;
      if (box.style.transform !== next) box.style.transform = next;
    }

    _tile(key, iconHtml, bg, value, label, extra = "") {
      return `<button class="tile" data-open="${key}">
        <span class="ic" style="background:${bg}">${iconHtml}</span>
        <span><b>${value}</b><small>${label}</small>${extra}</span>
      </button>`;
    }

    // Today as metrics (<cw-metric> of cw-thema.js): value + what it is; tap = info sheet.
    _todayStrip(m) {
      const R = this._R;
      const items = [];
      if (this._F.solar)
        items.push({
          icon: "zon",
          color: ink(C.zon),
          value: `${nf(m.gen)} kWh`,
          label: this.t("solar_today"),
          info: this.t(Number.isFinite(m.fcToday) ? "solar_today_info_forecast" : "solar_today_info", {
            kwh: nf(m.gen),
            forecast: nf(m.fcToday),
          }),
          entity: R.solar_energy || R.solar_power,
        });
      items.push(
        {
          icon: "neer",
          color: ink(C.red),
          value: `${nf(m.impT)} kWh`,
          label: this.t("from_grid"),
          info: this.t("from_grid_info", { kwh: nf(m.impT) }),
          entity: this._cfg.grid_import_kwh[0],
        },
        {
          icon: "op",
          color: ink(C.green),
          value: `${nf(m.expT)} kWh`,
          label: this.t("to_grid"),
          info: this.t("to_grid_info", { kwh: nf(m.expT) }),
          entity: this._cfg.grid_export_kwh[0],
        },
      );
      if (this._F.solar)
        items.push({
          icon: "vink",
          color: ink(C.batt),
          value: `${nf(m.selfUse * 100, 0)} %`,
          label: this.t("self_used"),
          info: this.t("self_used_info", { self: nf(m.selfUse * 100, 0), own: nf(m.autarky * 100, 0) }),
        });
      return `<div class="card strip-m"><div class="cap">${esc(this.t("today_caption"))}</div><cw-metric kolommen="${items.length}" items="${esc(JSON.stringify(items))}"></cw-metric></div>`;
    }

    // How much of our own use comes from sun or home battery: today (meter totals) and right now (live flows).
    _ownCard(m) {
      if (!this._F.solar && !this._F.battery) return "";
      const pct = (v) => (Number.isFinite(v) ? `${nf(v * 100, 0)} %` : "–");
      const own = m.flows.zh + m.flows.bh;
      const items = [
        {
          icon: "zon",
          color: ink(C.batt),
          value: pct(m.autarky),
          label: this.t("today"),
          titel: this.t("own_today_title"),
          info: this.t("own_today_info", {
            kwh: nf(m.cons),
            share: pct(m.autarky),
            grid: nf(m.impT),
            self: pct(m.selfUse),
            export: nf(m.expT),
          }),
          waarden: [
            [this.t("use_today"), `${nf(m.cons)} kWh`],
            [this.t("from_grid_cap"), `${nf(m.impT)} kWh`],
            [this.t("self_used_cap"), pct(m.selfUse)],
          ],
        },
        {
          icon: "bliksem",
          color: ink(C.zon),
          value: pct(m.ownNow),
          label: this.t("now"),
          titel: this.t("own_now_title"),
          info: this.t("own_now_info", {
            load: kw(m.load),
            own: kw(own),
            grid: kw(m.flows.nh),
            solar: kw(m.pv),
            self: pct(m.selfUseNow),
          }),
          waarden: [
            [this.t("use_now"), kw(m.load)],
            [this.t("from_own"), kw(own)],
            [this.t("self_used_cap"), pct(m.selfUseNow)],
          ],
        },
      ];
      return `<div class="card strip-m own"><div class="cap">${esc(this.t("own_caption"))}</div><cw-metric items="${esc(JSON.stringify(items))}"></cw-metric></div>`;
    }

    _advStrip(m) {
      const R = this._R,
        F = this._F;
      const pc = (p) => (p.kw > 0.05 ? C.red : p.kw < -0.05 ? C.green : C.muted);
      const tiles = [];
      if (F.solar)
        tiles.push(
          this._tile(
            "solar",
            I.sun(C.zon, 22),
            tint(C.zon),
            nf(m.gen),
            this.t("kwh_generated"),
            Number.isFinite(m.fcToday)
              ? `<small class="sub">${esc(this.t("forecast_short", { kwh: nf(m.fcToday) }))}</small>`
              : "",
          ),
        );
      tiles.push(
        this._tile("grid", I.down(C.red, 22), tint(C.red), nf(m.impT), this.t("kwh_from_grid")),
        this._tile("grid", I.up(C.green, 22), tint(C.green), nf(m.expT), this.t("kwh_to_grid")),
      );
      if (F.solar)
        tiles.push(
          this._tile(
            "today",
            I.leaf(C.batt, 22),
            tint(C.batt),
            `${nf(m.selfUse * 100, 0)} %`,
            this.t("self_used"),
            `<small class="sub">${esc(this.t("autarky_short", { pct: nf(m.autarky * 100, 0) }))}</small>`,
          ),
        );
      if (m.phases.length)
        tiles.push(`<button class="tile" data-open="grid"><span class="ic" style="background:${tint(C.muted, 0.1)}">${I.pylon(C.muted, 22)}</span>
          <span class="phases">${m.phases.map((p) => `<em style="color:${pc(p)}">L${p.i} ${p.kw > 0 ? "+" : ""}${nf(p.kw, 2)}</em>`).join("")}<small>${esc(this.t("kw_per_phase"))}</small></span></button>`);
      if (F.tariff && this._has(R.price_import))
        tiles.push(
          this._tile(
            "grid",
            I.euro(C.zon, 22),
            tint(C.zon),
            `${nf(this._n(R.price_import) * 100, 0)} c`,
            this.t("import_per_kwh"),
            `<small class="sub">${esc(this.t("export_short", { cents: nf(this._n(R.price_export) * 100, 0), level: this._level() }))}</small>`,
          ),
        );
      if (this._has(R.co2))
        tiles.push(
          this._tile("grid", I.co2(C.muted, 22), tint(C.muted, 0.1), `${nf(this._n(R.co2), 0)} %`, this.t("fossil_on_grid")),
        );
      if (F.ev_charging && this._has(R.ev_available_avg))
        tiles.push(
          this._tile("charging", I.car(C.auto, 20), tint(C.auto), kw(this._kwOf(R.ev_available_avg)), this.t("left_for_car")),
        );
      return `<div class="card strip adv-strip">${tiles.join("")}</div>`;
    }

    _level() {
      const lvl = this._s(this._R.price_level);
      return NO_VALUE.has(lvl) ? this.t("level_unknown") : this.tv("level_", lvl);
    }

    // ---------- right column ----------
    _battCard(m) {
      if (!this._F.battery || !Number.isFinite(m.soc)) return "";
      const R = this._R;
      const r = 58,
        circ = 2 * Math.PI * r,
        fill = clamp((m.soc || 0) / 100, 0, 1) * circ;
      const bf = m.bf;
      const chips = [];
      if (m.bat < -0.05)
        chips.push(
          chip("op", kw(-m.bat), this.t("battery_charges", { kw: kw(-m.bat) }), {
            toon: "goed",
            info: this.t("battery_charges_info", { kw: kw(-m.bat) }),
            entity: R.battery_power,
          }),
        );
      else if (m.bat > 0.05)
        chips.push(
          chip("neer", kw(m.bat), this.t("battery_gives", { kw: kw(m.bat) }), {
            toon: "warn",
            info: this.t("battery_gives_info", { kw: kw(m.bat) }),
            entity: R.battery_power,
          }),
        );
      if (m.soc >= 99)
        chips.push(
          chip("vink", this.t("full"), this.t("battery_full"), {
            toon: "goed",
            info: this.t("battery_full_info"),
            entity: R.battery_soc,
          }),
        );
      else if (R.plan_margin && bf.after_sun)
        chips.push(
          chip("maan", this.t("sun_gone_short"), this.t("sun_gone"), {
            info: this.t("sun_gone_info", { kwh: nf(bf.battery_needed_kwh) }),
            entity: R.plan_margin,
          }),
        );
      else if (Number.isFinite(m.marge))
        chips.push(
          chip("vlag", m.sunEnd || "–", this.t(m.marge >= 0 ? "full_by" : "not_full_by", { time: m.sunEnd || "–" }), {
            toon: m.marge >= 0 ? "goed" : "warn",
            titel: this.t(m.marge >= 0 ? "full_before_shade" : "not_full_before_shade"),
            info: this.t(m.marge >= 0 ? "full_by_info" : "not_full_by_info", { time: m.sunEnd || "–" }),
            waarden: [
              [this.t("needed_to_full"), `${nf(bf.battery_needed_kwh)} kWh`],
              [this.t("solar_left"), `${nf(bf.pv_remaining_kwh)} kWh`],
              [this.t("house_left"), `${nf(bf.house_remaining_kwh)} kWh`],
              [this.t("margin"), `${m.marge >= 0 ? "+" : ""}${nf(m.marge)} kWh`],
            ],
            entity: R.plan_margin,
          }),
        );
      if (R.plan_margin && !bf.after_sun && m.soc < 99 && Number.isFinite(+bf.pv_remaining_kwh)) {
        chips.push(
          chip("zon", `${nf(+bf.pv_remaining_kwh)} kWh`, this.t("solar_left_label", { kwh: nf(+bf.pv_remaining_kwh) }), {
            ic: C.zon,
            info: this.t("solar_left_info", { kwh: nf(+bf.pv_remaining_kwh) }),
            waarden: [
              [this.t("by_forecast"), `${nf(+bf.pv_remaining_forecast_kwh)} kWh`],
              [this.t("by_history"), `${nf(+bf.pv_remaining_history_kwh)} kWh`],
            ],
          }),
          chip("huisje", `${nf(+bf.house_remaining_kwh)} kWh`, this.t("house_left_label", { kwh: nf(+bf.house_remaining_kwh) }), {
            ic: C.huis,
            info: this.t("house_left_info", { kwh: nf(+bf.house_remaining_kwh) }),
          }),
        );
      }
      if (this._adv && Number.isFinite(m.marge))
        chips.push(
          chip("batterij", `${m.marge >= 0 ? "+" : ""}${nf(m.marge)} kWh`, this.t("margin_label", {
            kwh: nf(m.marge),
            needed: nf(+bf.battery_needed_kwh),
          })),
        );
      return `<button class="card batt" data-open="battery" aria-label="${esc(this.t("battery_aria", { pct: nf(m.soc, 0) }))}">
        <svg viewBox="0 0 140 140" class="ring" aria-hidden="true">
          <circle cx="70" cy="70" r="${r}" fill="none" stroke="${sep()}" stroke-width="14"/>
          <circle cx="70" cy="70" r="${r}" fill="none" stroke="${ink(C.batt)}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${fill} ${circ}" transform="rotate(-90 70 70)"/>
          <text x="70" y="79" text-anchor="middle" font-size="30" font-weight="700" fill="${C.text}">${nf(m.soc, 0)} %</text>
        </svg>
        <span class="chips">${chips.join("")}</span>
      </button>`;
    }

    // Tiles under the diagram: icon + value + direction, one word below.
    _powerTiles(m) {
      const F = this._F;
      const t = (key, icon, value, sub, label) =>
        `<button class="ptile" data-open="${key}" aria-label="${esc(label)}" title="${esc(label)}"><span class="pv">${icon}<b>${value}</b></span><small>${sub}</small></button>`;
      const net = m.imp > 0.05 ? m.imp : m.exp;
      const gridWord = esc(this.t("grid_word"));
      const netSub =
        m.imp > 0.05 ? `${I.down(C.red, 14)}${gridWord}` : m.exp > 0.05 ? `${I.up(C.green, 14)}${gridWord}` : gridWord;
      const tiles = [
        t(
          "grid",
          I.pylon(C.net, 20),
          kw(net),
          netSub,
          m.imp > 0.05
            ? this.t("from_grid_kw", { kw: kw(m.imp) })
            : m.exp > 0.05
              ? this.t("to_grid_kw", { kw: kw(m.exp) })
              : this.t("grid_rest"),
        ),
      ];
      if (F.solar) tiles.push(t("solar", I.sun(C.zon, 20), kw(m.pv), esc(this.t("solar_word")), this.t("solar_kw", { kw: kw(m.pv) })));
      else tiles.push(t("house", I.house(C.huis, 20), kw(m.house), esc(this.t("house_word")), this.t("house_kw", { kw: kw(m.house) })));
      if (F.battery && Number.isFinite(m.soc)) {
        const batSub =
          m.bat < -0.05
            ? `${I.up(C.green, 14)}${nf(-m.bat)}`
            : m.bat > 0.05
              ? `${I.down(C.amber, 14)}${nf(m.bat)}`
              : esc(this.t("rest_word"));
        tiles.push(
          t(
            "battery",
            I.batt(C.batt, 20, clamp((m.soc || 0) / 100, 0, 1)),
            `${nf(m.soc, 0)} %`,
            batSub,
            this.t(m.bat < -0.05 ? "battery_tile_charges" : m.bat > 0.05 ? "battery_tile_gives" : "battery_tile_rest", {
              pct: nf(m.soc, 0),
              kw: kw(Math.abs(m.bat)),
            }),
          ),
        );
      }
      if (F.charger) {
        const st = this._carState(m);
        const car = this._car();
        tiles.push(
          t(
            "charging",
            I.car(C.auto, 18),
            m.carKw > 0.1 ? kw(m.carKw) : car && Number.isFinite(car.battery) ? `${nf(car.battery, 0)} %` : "–",
            st.chip,
            car ? `${car.name}: ${st.label}` : st.label,
          ),
        );
      }
      if (tiles.length < 4) tiles.push(t("house", I.house(C.huis, 20), kw(m.house), esc(this.t("house_word")), this.t("house_kw", { kw: kw(m.house) })));
      return `<div class="ptiles" style="grid-template-columns:repeat(${Math.min(tiles.length, 4)},minmax(0,1fr))">${tiles.slice(0, 4).join("")}</div>`;
    }

    // The car on the charger (ev-charging: sensor.ev_charging_car, state = prefix or none, attributes name,
    // battery, limit). Null when no car is connected or ev-charging is not installed.
    _car() {
      const id = this._R.ev_car;
      const s = this._s(id);
      if (!id || NO_VALUE.has(s) || s === "none") return null;
      const a = this._hass.states[id].attributes || {};
      return { prefix: s, name: a.name || s, battery: parseFloat(a.battery), limit: parseFloat(a.limit) };
    }

    // Charger state as one icon chip (short text, full meaning in the label).
    _carState(m) {
      const R = this._R;
      const st = this._s(R.charger_status);
      const mode = this._s(R.charger_mode);
      const mk = (icoon, text, label, o = {}) => ({ label, chip: chip(icoon, text, label, { kaal: true, ...o }) });
      if (st === "charging" || m.carKw >= 0.1) {
        const ph = this._n(R.charger_phases);
        const extra = Number.isFinite(ph) ? ` · ${this.t(ph === 1 ? "one_phase" : "three_phases")}` : "";
        return mk("bliksem", `${kw(m.carKw)}${extra}`, this.t("charging_kw", { kw: kw(m.carKw) }) + extra, { toon: "aan" });
      }
      if (st === "complete") return mk("vink", this.t("full"), this.t("charged_full"), { toon: "goed" });
      if (st === "fault") return mk("waarschuwing", this.t("fault"), this.t("charger_fault"), { toon: "bad", entity: R.charger_status });
      if (st === "disconnected" || this._s(R.charger_connected) === "off")
        return mk("laadpaal", this.t("free"), this.t("no_car"), { uit: true, info: this.t("no_car_info"), entity: R.charger_status });
      if (this._s(R.ev_status) === "paused_battery")
        return mk("pauze", this.t("paused"), this.t("paused_battery"), { info: this.t("paused_battery_info"), toon: "warn" });
      if (mode === "stop") return mk("pauze", this.t("mode_stop"), this.t("stopped"), { info: this.t("stopped_info") });
      if (mode === "solar_only" || mode === "solar_min")
        return mk("zon", this.t("waiting"), this.t("waiting_sun"), { ic: C.zon, info: this.t("waiting_sun_info") });
      return mk("pauze", this.t("paused"), this.t("paused_plain"), { info: this.t("paused_info") });
    }

    // Charger and car: normalised mode of the ev-charger contract and the ev-charging toggles. The mode buttons call
    // roles.charger_set_mode: script.ev_charging_manual_mode with ev-charging (owner manual until the car is
    // unplugged), script.ev_charger_set_mode without it (nobody else steers the charger then).
    _chargeCard(m) {
      if (!this._F.charger) return "";
      const R = this._R;
      const mode = this._s(R.charger_mode);
      const MODES = [
        { opt: "solar_only", label: this.t("mode_solar_only"), icon: "sunSmall" },
        { opt: "solar_min", label: this.t("mode_solar_min") },
        { opt: "fast", label: this.t("mode_fast") },
        { opt: "stop", label: this.t("mode_stop") },
      ];
      const modes = `<div class="seg" role="group" aria-label="${esc(this.t("charge_mode"))}">${MODES.map((md) => {
        const on = md.opt === mode;
        return `<button data-act="mode" data-opt="${md.opt}" aria-pressed="${on}" class="${on ? "on" : ""}">${md.icon ? (on ? I[md.icon](C.onAccent, undefined, undefined, true) : I[md.icon](C.muted)) : ""}${esc(md.label)}</button>`;
      }).join("")}</div>`;
      const tg = (id, icon, label) => {
        if (!id || !this._hass.states[id]) return "";
        const on = this._s(id) === "on";
        return `<button data-act="toggle" data-entity="${id}" aria-pressed="${on}" class="${on ? "on" : ""}">${I[icon](on ? C.zon : C.muted, 18)}${esc(label)}</button>`;
      };
      const toggles = [
        tg(R.ev_smart, "leaf", this.t("smart_charging")),
        tg(R.ev_amps_auto, "wave", this.t("amps_auto")),
        tg(R.phase_auto, "bolt", this.t("phases_auto")),
      ].join("");
      const togglesHtml = toggles ? `<div class="toggles">${toggles}</div>` : "";
      const st = this._carState(m);
      const car = this._car();
      const adv = this._adv
        ? `<div class="advline muted">${esc(this.t("charger_line", {
            status: this.tv("charger_", this._s(R.charger_status) || "unknown"),
            today: nf(m.evT),
            solar: nf(m.evGreen),
          }))}</div>`
        : "";
      if (!car)
        return `<div class="card tesla">
          <button class="thead" data-open="charging">${I.car(st.label === this.t("no_car") ? C.muted : C.auto, 26)}<span class="tname">${esc(this.t("charging"))}</span><span class="grow"></span><span class="tstate">${st.chip}</span></button>
          ${modes}${togglesHtml}${adv}</div>`;
      const lim = car.limit;
      return `<div class="card tesla">
        <button class="thead" data-open="charging">${I.car(C.auto, 26)}<span class="tname">${esc(car.name)}</span><span class="grow"></span><span class="tstate">${st.chip}</span></button>
        ${Number.isFinite(car.battery) ? `<button class="bar" data-open="charging" aria-label="${esc(this.t("car_bar_aria", { pct: nf(car.battery, 0), limit: nf(lim, 0) }))}">
          <span class="track"><span class="fill" style="width:${clamp(car.battery, 0, 100)}%"></span>${lim < 100 ? `<span class="lim" style="left:${lim}%"></span>` : ""}</span>
          <span class="barlbl muted"><span><b>${nf(car.battery, 0)} %</b></span>${Number.isFinite(lim) ? `<span>${esc(this.t("limit_pct", { pct: nf(lim, 0) }))}</span>` : ""}</span>
        </button>` : ""}
        ${modes}${togglesHtml}${adv}
      </div>`;
    }

    // Where the power goes right now, as flow chips (source -> destination + kW); forecast and savings on the right.
    _status(m) {
      const f = m.flows;
      const ICON = {
        zon: ["zon", C.zon],
        net: ["net", C.net],
        batt: ["batterij", C.batt],
        huis: ["huisje", C.huis],
        auto: ["auto", C.auto],
      };
      const flow = (a, b, v) =>
        v > 0.05
          ? chip(ICON[a][0], kw(v), this.t("flow_label", { from: this.t(`node_${a}`), to: this.t(`node_${b}`), kw: kw(v) }), {
              naar: ICON[b][0],
              ic: ICON[a][1],
              ic2: ICON[b][1],
              info: this.t("flow_info", { from: this.t(`node_${a}_the`), to: this.t(`node_${b}_the`), kw: kw(v) }),
              path: this._cfg.paths.analysis,
              padLabel: this._cfg.paths.analysis ? this.t("analysis") : undefined,
            })
          : "";
      const house = Math.max(m.house, 0);
      const parts = [
        flow("zon", "huis", Math.min(f.zh, house)),
        flow("zon", "batt", f.zb),
        flow("zon", "net", f.zn),
        flow("batt", "huis", Math.min(f.bh, house)),
        flow("net", "huis", Math.min(f.nh, house)),
        flow("net", "batt", f.nb),
        flow("batt", "net", f.bn),
        m.carKw > 0.1
          ? chip("bliksem", kw(m.carKw), this.t("car_charges_kw", { kw: kw(m.carKw) }), {
              info: this.t("car_charges_info", { name: this._car()?.name || this.t("the_car"), kw: kw(m.carKw) }),
              entity: this._R.charger_power,
              naar: "auto",
              ic: C.zon,
              ic2: C.auto,
            })
          : "",
      ].join("");
      const saved = Number.isFinite(m.saved)
        ? `<span class="saved">${chip("euro", `€ ${nf(m.saved, 2)}`, this.t("saved_today", { eur: nf(m.saved, 2) }), {
            toon: "goed",
            info: this.t("saved_today_info"),
            path: this._cfg.paths.results,
            padLabel: this._cfg.paths.results ? this.t("results") : undefined,
          })}</span>`
        : "";
      const fc = Number.isFinite(m.fcTomorrow)
        ? `<span class="saved">${chip("zonwolk", `${nf(m.fcTomorrow)} kWh`, this.t("solar_tomorrow", { kwh: nf(m.fcTomorrow) }), {
            ic: C.zon,
            titel: this.t("solar_tomorrow_title"),
            info: this.t("solar_tomorrow_info", { kwh: nf(m.fcTomorrow) }),
            waarden: [
              [this.t("forecast_today"), `${nf(m.fcToday)} kWh`],
              [this.t("forecast_left_today"), `${nf(m.fcRest)} kWh`],
            ],
            entity: this._R.forecast_tomorrow,
          })}</span>`
        : "";
      return `${parts || chip("pauze", this.t("rest_word"), this.t("all_rest"), { info: this.t("all_rest_info") })}${fc}${saved}`;
    }

    // Price now (tariff contract): import, export, level, cheapest 2 h and the coming quarters.
    _priceCard() {
      const R = this._R;
      if (!this._F.tariff || !this._has(R.price_import)) return "";
      const buy = this._n(R.price_import);
      const sell = this._n(R.price_export);
      const lvl = this._s(R.price_level) || "unknown";
      const b = this._a(R.price_import, "cheapest_2h");
      const TONE = { negative: "goed", very_cheap: "goed", cheap: "goed", expensive: "warn", very_expensive: "bad" };
      const tone = TONE[lvl];
      let cheap = "";
      if (b?.start) {
        const st = new Date(b.start);
        const tomorrow = st.toDateString() !== new Date().toDateString();
        const span = `${tomorrow ? `${this.t("tomorrow_word")} ` : ""}${hhmm(st)}–${hhmm(new Date(b.end))}`;
        const mean = Number.isFinite(+b.mean) ? ` · ${nf(+b.mean * 100, 0)} c` : "";
        cheap = chip("klok", `${span}${mean}`, this.t("cheapest_2h", { span, mean }), {
          info: this.t("cheapest_2h_info", { span }),
          entity: R.price_import,
        });
      }
      const neg = sell < 0;
      const peak = this._has(R.month_peak) ? this._n(R.month_peak) : NaN;
      const quarter = this._has(R.quarter) ? this._n(R.quarter) : NaN;
      const adv =
        this._adv && (Number.isFinite(peak) || Number.isFinite(quarter))
          ? `<span class="chips adv">${Number.isFinite(peak) ? chip("piek", `${nf(peak)} kW`, this.t("month_peak_label", { kw: nf(peak) }), { entity: R.month_peak }) : ""}${Number.isFinite(quarter) ? chip("klok", `${nf(quarter)} kW`, this.t("quarter_label", { kw: nf(quarter) }), { entity: R.quarter }) : ""}</span>`
          : "";
      return `<button class="card price" data-open="grid" aria-label="${esc(this.t("price_aria"))}">
          <span class="pcol"><small class="muted">${esc(this.t("import_word"))}</small><b style="color:${tone === "bad" || tone === "warn" ? C.red : tone === "goed" ? C.green : C.text}">${nf(buy * 100, 0)} c</b></span>
          ${Number.isFinite(sell) ? `<span class="pcol"><small class="muted">${esc(this.t("export_word"))}</small><b style="color:${neg ? C.red : C.text}">${sell > 0 ? "+" : ""}${nf(sell * 100, 1)} c</b></span>` : ""}
          <span class="chips">${chip("euro", this._level(), this.t("price_level_label", { level: this._level() }), {
            toon: tone,
            info: this.t("price_level_info", { cents: nf(buy * 100, 1), level: this._level() }),
            waarden: [
              [this.t("import_cap"), `${nf(buy * 100, 1)} c`],
              [this.t("export_cap"), `${nf(sell * 100, 1)} c`],
            ],
            entity: R.price_import,
          })}${cheap}${neg ? chip("waarschuwing", this.t("negative"), this.t("export_costs"), { toon: "bad", info: this.t("export_costs_info"), entity: R.price_export }) : ""}</span>
          ${this._priceLine()}
          ${adv}
        </button>`;
    }

    // Prices of the coming quarters (attributes prices + starts of the import price), the cheapest 2-hour block in
    // the battery colour, the current quarter outlined.
    _priceLine() {
      const R = this._R;
      const p = this._a(R.price_import, "prices") || [];
      const st = this._a(R.price_import, "starts") || [];
      const n = Math.min(p.length, st.length, this._adv ? 96 : 48);
      if (n < 4) return "";
      const vals = p.slice(0, n).map(Number);
      const t = st.slice(0, n).map((x) => Date.parse(x));
      const blk = this._a(R.price_import, "cheapest_2h");
      const b0 = blk?.start ? Date.parse(blk.start) : NaN;
      const b1 = blk?.end ? Date.parse(blk.end) : NaN;
      const lo = Math.min(0, ...vals),
        hi = Math.max(...vals, 0.01);
      const W = 600,
        H = 64,
        bw = W / n;
      const y = (v) => H - ((v - lo) / (hi - lo || 1)) * (H - 4);
      const base = y(0);
      const now = Date.now();
      const bars = vals
        .map((v, i) => {
          const cheap = t[i] >= b0 && t[i] < b1;
          const cur = now >= t[i] && now < t[i] + 900000;
          const top = Math.min(y(v), base),
            h = Math.max(Math.abs(base - y(v)), 1.5);
          return `<rect x="${(i * bw + 0.6).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(bw - 1.2, 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${cheap ? ink(C.batt) : ink(C.net)}" fill-opacity="${cheap ? 1 : 0.45}"${cur ? ` stroke="${C.text}" stroke-width="1.5"` : ""}/>`;
        })
        .join("");
      const ticks = t
        .map((ts, i) => ({ d: new Date(ts), i }))
        .filter(({ d }) => d.getMinutes() === 0 && d.getHours() % (this._adv ? 6 : 3) === 0)
        .map(({ d, i }) => `<span style="left:${((i / n) * 100).toFixed(2)}%">${hhmm(d)}</span>`)
        .join("");
      return `<span class="pline">
          <span class="plbl muted"><span>${esc(this.t("coming_hours"))}</span></span>
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(this.t("coming_hours"))}">${bars}${lo < 0 ? `<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="${sep()}"/>` : ""}</svg>
          <span class="pticks muted">${ticks}</span>
        </span>`;
    }

    // Cheap power (ev-charging): may the grid top up the car now, why (not), plus the master switch. The reason is
    // sensor.ev_charging_cheap_status (why the assist does or does not run); while the assist runs, the charging
    // status of sensor.ev_charging_status. Without the cheap status sensor: the charging status only.
    _cheapCard() {
      const R = this._R;
      if (!this._F.ev_charging || !R.ev_cheap || !this._hass.states[R.ev_cheap]) return "";
      const on = this._s(R.ev_cheap) === "on";
      const active = this._s(R.ev_owner) === "cheap";
      const st = this._s(R.ev_status);
      const cst = R.ev_cheap_status ? this._s(R.ev_cheap_status) : null;
      const neg = this._n(R.price_export) < 0;
      const reason =
        !active && cst && !NO_VALUE.has(cst)
          ? this.tv("cheapst_", cst)
          : NO_VALUE.has(st)
            ? "–"
            : this.tv("status_", st);
      const title = !on
        ? this.t("cheap_off_title")
        : active
          ? neg
            ? this.t("export_costs")
            : this.t("cheap_now")
          : this.t("cheap_power");
      const line = !on ? this.t("cheap_off_line") : active || (cst && !NO_VALUE.has(cst)) ? reason : this.t("cheap_waits");
      const adv =
        this._adv && on && this._has(R.capacity_headroom)
          ? `<div class="advline muted">${esc(this.t("cheap_adv", { status: reason, kw: nf(this._n(R.capacity_headroom)) }))}</div>`
          : "";
      const state = !on
        ? chip("pauze", this.t("word_off"), line, { uit: true, info: this.t("cheap_off_info"), entity: R.ev_cheap })
        : active
          ? chip("bliksem", this.t("now_word"), `${title}: ${line}`, { toon: neg ? "warn" : "goed", entity: R.ev_status })
          : chip("klok", this.t("waiting"), line, { info: this.t("cheap_waits_info", { status: reason }), entity: R.ev_cheap_status || R.ev_status });
      return `<div class="card tesla">
        <div class="thead">${I.bolt(active && on ? (neg ? C.amber : C.green) : C.muted, 24)}<span class="tname">${esc(this.t("cheap_power"))}</span><span class="grow"></span>${state}</div>
        <div class="toggles"><button data-act="toggle" data-entity="${R.ev_cheap}" aria-pressed="${on}" class="${on ? "on" : ""}" aria-label="${esc(this.t("cheap_use_aria"))}">${I.bolt(on ? C.zon : C.muted, 18)}${esc(this.t("cheap_use"))}</button></div>
        ${adv}
      </div>`;
    }

    // Hot water: tank temperature (hot-water-heater contract); target, morning hour and the shower button with the
    // module hot-water.
    _hotWaterCard() {
      const R = this._R;
      if (!this._F.hot_water_heater || !this._has(R.hot_water_temperature)) return "";
      const t = this._n(R.hot_water_temperature);
      const chips = [];
      let toggle = "";
      if (this._F.hot_water) {
        const shower = this._s(R.hot_water_shower_tomorrow) === "on";
        const target = shower ? this._n(R.hot_water_shower) : this._n(R.hot_water_minimum);
        if (Number.isFinite(target))
          chips.push(
            chip(t >= target ? "vink" : "vlag", `${nf(target, 0)} °C`, this.t(t >= target ? "hw_target_met" : "hw_target", { t: nf(target, 0) }), {
              toon: t >= target ? "goed" : "",
              info: this.t(shower ? "hw_target_info_shower" : "hw_target_info", { t: nf(target, 0), now: nf(t, 0) }),
              entity: R.hot_water_temperature,
            }),
          );
        if (this._has(R.hot_water_morning)) {
          const at = timeOf(this._s(R.hot_water_morning));
          if (at)
            chips.push(
              chip("klok", at, this.t("hw_heat_at", { time: at }), { info: this.t("hw_heat_at_info", { time: at }), entity: R.hot_water_morning }),
            );
        }
        if (this._hass.states[R.hot_water_shower_tomorrow])
          toggle = `<div class="toggles"><button data-act="toggle" data-entity="${R.hot_water_shower_tomorrow}" aria-pressed="${shower}" class="${shower ? "on" : ""}">${I.warmwater(shower ? C.zon : C.muted, 18)}${esc(this.t(shower ? "shower_on" : "shower"))}</button></div>`;
      }
      else {
        // Without the module hot-water: the target of the heater itself (attribute target of the contract sensor).
        const target = parseFloat(this._a(R.hot_water_temperature, "target"));
        if (Number.isFinite(target))
          chips.push(
            chip(t >= target ? "vink" : "vlag", `${nf(target, 0)} °C`, this.t("hw_setpoint", { t: nf(target, 0) }), {
              toon: t >= target ? "goed" : "",
              entity: R.hot_water_temperature,
            }),
          );
      }
      if (this._s(R.hot_water_heating) === "on")
        chips.push(chip("bliksem", this.t("heating_word"), this.t("hw_heating"), { toon: "aan", entity: R.hot_water_heating }));
      return `<div class="card tesla">
        <button class="thead" data-open="hot_water">${I.boiler(C.zon, 26)}<span class="tname">${nf(t, 0)} °C</span><span class="grow"></span>
          <span class="chips">${chips.join("")}</span></button>
        ${toggle}
      </div>`;
    }

    _sunBar(m) {
      if (!this._F.solar) return "";
      const parts = [
        { v: m.sunHouse, c: C.huis, icon: I.house(C.huis, 16), label: this.t("node_huis") },
        ...(this._F.charger ? [{ v: m.sunCar, c: C.auto, icon: I.car(C.auto, 14), label: this.t("node_auto") }] : []),
        ...(this._F.battery ? [{ v: m.sunBatt, c: C.batt, icon: I.batt(C.batt, 16, 1), label: this.t("node_batt") }] : []),
        { v: m.sunNet, c: C.net, icon: I.pylon(C.net, 16), label: this.t("node_net") },
      ];
      const tot = parts.reduce((s, p) => s + p.v, 0) || 1;
      const extra =
        this._adv && Number.isFinite(m.fcToday)
          ? ` · ${this.t("forecast_short", { kwh: nf(m.fcToday) })}${Number.isFinite(m.fcRest) ? ` · ${this.t("left_short", { kwh: nf(m.fcRest) })}` : ""}`
          : "";
      return `<button class="card sunbar" data-open="today">
        <span class="muted row">${I.sunSmall(C.zon, 18)}${esc(this.t("solar_today_kwh", { kwh: nf(m.gen) }) + extra)}</span>
        <span class="stack">${parts.map((p) => `<span style="width:${(p.v / tot) * 100}%;background:${p.c}"></span>`).join("")}</span>
        <span class="legend" style="grid-template-columns:repeat(${parts.length},minmax(0,1fr))">${parts.map((p) => `<span title="${esc(p.label)}">${p.icon}<b>${nf(p.v)}</b></span>`).join("")}</span>
      </button>`;
    }

    // ---------- detail sheets ----------
    _row(icon, label, value, entity, color) {
      const attrs = entity ? `data-more="${esc(entity)}" role="button" tabindex="0"` : "";
      return `<div class="drow ${entity ? "link" : ""}" ${attrs}><span class="dic">${icon || ""}</span><span class="dl">${label}</span><span class="dv" ${color ? `style="color:${color}"` : ""}>${value}</span></div>`;
    }
    // A row only when its entity has a value (never a bare dash for a missing optional entity).
    _rowIf(id, icon, label, value, color) {
      return this._has(id) ? this._row(icon, label, value, id, color) : "";
    }

    _sheet(m) {
      const R = this._R,
        F = this._F;
      const bf = m.bf;
      const tm = (id) => (this._has(id) ? timeOf(this._s(id)) || "–" : "–");
      const specs = {
        solar: () => ({
          title: this.t("node_zon_cap"),
          icon: I.sun(C.zon, 28),
          rows: [
            this._row(I.sun(C.zon, 18), this.t("now_cap"), kw(m.pv), R.solar_power),
            this._row(I.chart(C.zon), this.t("generated_today"), `${nf(m.gen)} kWh`, R.solar_energy),
            this._rowIf(R.forecast_today, I.cloud(C.zon, 18), this.t("forecast_today"), `${nf(m.fcToday)} kWh`),
            this._rowIf(R.forecast_remaining, I.cloud(C.zon, 18), this.t("forecast_left_today"), `${nf(m.fcRest)} kWh`),
            this._rowIf(R.forecast_tomorrow, I.cloud(C.zon, 18), this.t("forecast_tomorrow"), `${nf(m.fcTomorrow)} kWh`),
            R.plan_margin && m.sunEnd
              ? this._row(I.moon(C.muted, 18), this.t("sun_leaves"), `${esc(m.sunEnd)} <small class="muted">(${esc(this.t("sunset_at", { time: timeOf(bf.sunset) || "–" }))})</small>`, R.plan_margin)
              : "",
          ],
          spark: { key: "solar", series: [{ id: R.solar_power, color: C.zon, label: this.t("node_zon") }] },
        }),
        grid: () => ({
          title: this.t("node_net_cap"),
          icon: I.pylon(C.net, 28),
          rows: [
            this._row(I.down(C.red, 18), this.t("now_from_grid"), kw(m.imp), R.grid_import, m.imp > 0.05 ? C.red : null),
            this._row(I.up(C.green, 18), this.t("now_to_grid"), kw(m.exp), R.grid_export, m.exp > 0.05 ? C.green : null),
            ...m.phases.map((p) =>
              this._row(
                `<b class="ph">L${p.i}</b>`,
                this.t("phase_row", { n: p.i }) + (Number.isFinite(p.v) ? ` · ${nf(p.v, 0)} V` : "") + (Number.isFinite(p.a) ? ` · ${nf(p.a, 1)} A` : ""),
                `${p.kw > 0 ? "+" : ""}${nf(p.kw, 2)} kW`,
                p.id,
                p.kw > 0.05 ? C.red : p.kw < -0.05 ? C.green : null,
              ),
            ),
            this._row(I.down(C.red, 18), this.t("today_from_grid"), `${nf(m.impT)} kWh`, this._cfg.grid_import_kwh[0]),
            this._row(I.up(C.green, 18), this.t("today_to_grid"), `${nf(m.expT)} kWh`, this._cfg.grid_export_kwh[0]),
            F.tariff ? this._rowIf(R.price_import, I.euro(C.zon, 18), this.t("price_import"), `${nf(this._n(R.price_import) * 100, 1)} c/kWh`) : "",
            F.tariff ? this._rowIf(R.price_export, I.euro(C.muted, 18), this.t("price_export"), `${nf(this._n(R.price_export) * 100, 1)} c/kWh`) : "",
            F.tariff ? this._rowIf(R.price_level, I.euro(C.muted, 18), this.t("price_level"), esc(this._level())) : "",
            this._rowIf(R.month_peak, I.chart(C.net), this.t("month_peak"), `${nf(this._n(R.month_peak), 2)} kW`),
            this._rowIf(R.quarter, I.clock(C.net), this.t("quarter_now"), `${nf(this._n(R.quarter), 2)} kW`),
            this._rowIf(R.capacity_headroom, I.shield(C.green), this.t("headroom"), `${nf(this._n(R.capacity_headroom), 2)} kW`),
            this._rowIf(R.co2, I.co2(C.muted, 18), this.t("fossil_on_grid_cap"), `${nf(this._n(R.co2), 0)} %`),
          ],
          spark: {
            key: "grid",
            series: [
              { id: R.grid_import, color: C.red, label: this.t("from_grid") },
              { id: R.grid_export, color: C.green, label: this.t("to_grid") },
            ],
          },
        }),
        house: () => ({
          title: this.t("node_huis_cap"),
          icon: I.house(C.huis, 28),
          rows: [
            this._row(I.house(C.huis, 18), this.t(F.charger ? "use_now_without_car" : "use_now"), kw(m.house)),
            this._rowIf(R.house_power, I.house(C.muted, 18), this.t("house_power_sensor"), kw(this._kwOf(R.house_power))),
            F.solar ? this._row(I.sun(C.zon, 18), this.t("now_from_sun"), kw(Math.min(m.flows.zh, m.house))) : "",
            F.battery ? this._row(I.batt(C.batt, 18, 0.6), this.t("now_from_battery"), kw(m.flows.bh)) : "",
            this._row(I.down(C.red, 18), this.t("now_from_grid"), kw(m.flows.nh), null, m.flows.nh > 0.05 ? C.red : null),
            ...this._cfg.consumers
              .filter((c) => this._has(c.power))
              .map((c) => this._row(I.plug(C.huis), esc(c.name), kw(this._kwOf(c.power)), c.power)),
            this._row(I.chart(C.huis), this.t("used_today"), `${nf(m.cons)} kWh`),
            F.solar || F.battery ? this._row(I.leaf(C.batt), this.t("autarky_today"), `${nf(m.autarky * 100, 0)} %`) : "",
          ],
          spark: R.house_power
            ? { key: "house", series: [{ id: R.house_power, color: C.huis, label: this.t("use_word") }] }
            : null,
        }),
        battery: () => ({
          title: this.t("node_batt_cap"),
          icon: I.batt(C.batt, 28, clamp((m.soc || 0) / 100, 0, 1)),
          rows: [
            this._row(I.batt(C.batt, 18, 0.7), this.t("charge_level"), `${nf(m.soc, 0)} %`, R.battery_soc),
            this._row(
              m.bat < 0 ? I.up(C.green, 18) : I.down(C.amber, 18),
              this.t(m.bat < 0 ? "charging_now" : "giving_now"),
              kw(Math.abs(m.bat)),
              R.battery_power,
            ),
            R.battery_charge_kwh ? this._row(I.up(C.green, 18), this.t("charged_today"), `${nf(m.chgT)} kWh`, R.battery_charge_kwh) : "",
            R.battery_discharge_kwh ? this._row(I.down(C.amber, 18), this.t("discharged_today"), `${nf(m.disT)} kWh`, R.battery_discharge_kwh) : "",
            ...(R.plan_margin
              ? [
                  this._row(I.moon(C.muted, 18), this.t("sun_leaves"), esc(m.sunEnd || "–"), R.plan_margin),
                  this._row(I.batt(C.muted, 18, 0.3), this.t("needed_to_full"), `${nf(+bf.battery_needed_kwh)} kWh`),
                  this._row(
                    I.sun(C.zon, 18),
                    `${esc(this.t("solar_left"))} <small class="muted">(${esc(bf.source ? this.tv("source_", bf.source) : "–")})</small>`,
                    `${nf(+bf.pv_remaining_kwh)} kWh`,
                  ),
                  this._row(I.cloud(C.muted, 18), this.t("forecast_vs_history"), `${nf(+bf.pv_remaining_forecast_kwh)} · ${nf(+bf.pv_remaining_history_kwh)}`),
                  this._row(I.house(C.huis, 18), this.t("house_left"), `${nf(+bf.house_remaining_kwh)} kWh`),
                  this._row(
                    !Number.isFinite(m.marge) ? I.moon(C.muted, 18) : m.marge >= 0 ? I.check(C.green, 18) : I.warn(C.amber, 18),
                    this.t("margin"),
                    Number.isFinite(m.marge) ? `${m.marge >= 0 ? "+" : ""}${nf(m.marge)} kWh` : "–",
                    R.plan_margin,
                  ),
                ]
              : []),
            R.battery_behind
              ? this._row(I.warn(m.behind ? C.amber : C.muted, 18), this.t("battery_first"), this.t(m.behind ? "word_yes" : "word_no"), R.battery_behind, m.behind ? C.amber : null)
              : "",
          ],
          controls: this._settingsOf("energy_plan"),
          spark: { key: "battery", series: [{ id: R.battery_soc, color: C.batt, label: this.t("charge_level_pct"), fixed: [0, 100] }] },
        }),
        charging: () => ({
          title: this.t("charging"),
          icon: I.car(C.auto, 28),
          rows: [
            this._rowIf(R.charger_status, I.plug(C.auto), this.t("charger"), esc(this.tv("charger_", this._s(R.charger_status)))),
            this._rowIf(R.charger_mode, I.sunSmall(C.zon, 18), this.t("charge_mode"), esc(this.tv("mode_", this._s(R.charger_mode)))),
            this._row(I.bolt(C.green), this.t("now_to_car"), kw(m.carKw), R.charger_power),
            this._rowIf(R.charger_phases, I.bolt(C.muted), this.t("phases"), esc(this._s(R.charger_phases))),
            this._rowIf(R.ev_available_avg, I.sun(C.zon, 18), this.t("left_for_car_10"), kw(this._kwOf(R.ev_available_avg))),
            this._rowIf(R.charger_energy_today, I.chart(C.auto), this.t("charged_today_car"), `${nf(m.evT)}${Number.isFinite(m.evGreen) ? ` · ${nf(m.evGreen)}` : ""} kWh`),
            this._rowIf(R.ev_status, I.leaf(C.batt), this.t("smart_status"), esc(this.tv("status_", this._s(R.ev_status)))),
            R.ev_battery_feeds_car && this._hass.states[R.ev_battery_feeds_car]
              ? this._row(I.warn(this._s(R.ev_battery_feeds_car) === "on" ? C.amber : C.muted, 18), this.t("battery_feeds_car"), this.t(this._s(R.ev_battery_feeds_car) === "on" ? "word_yes" : "word_no"), R.ev_battery_feeds_car)
              : "",
            this._rowIf(R.ev_energy_needed, I.batt(C.auto, 18, 0.4), this.t("car_needs"), `${nf(this._n(R.ev_energy_needed))} kWh`),
            this._rowIf(R.ev_commands, I.wave(C.muted), this.t("car_commands"), `${nf(this._n(R.ev_commands), 0)}${this._has(R.ev_commands_max) ? ` / ${nf(this._n(R.ev_commands_max), 0)}` : ""}`),
          ],
          extra: this._cars(),
          controls: [...this._settingsOf("ev_charging"), ...this._settingsOf("charger")],
          links: this._cfg.paths.cars ? [{ label: this.t("cars"), path: this._cfg.paths.cars }] : [],
          spark: {
            key: "charging",
            series: [
              { id: R.charger_power, color: C.auto, label: this.t("charger") },
              ...(R.ev_available_avg ? [{ id: R.ev_available_avg, color: C.zon, label: this.t("left_for_car") }] : []),
            ],
          },
        }),
        today: () => ({
          title: this.t("today_cap"),
          icon: I.leaf(C.batt, 28),
          rows: [
            F.solar ? this._row(I.sun(C.zon, 18), this.t("generated"), `${nf(m.gen)} kWh`, R.solar_energy) : "",
            F.solar ? this._row(I.house(C.huis, 18), this.t("to_house"), `${nf(m.sunHouse)} kWh`) : "",
            F.solar && F.charger ? this._row(I.car(C.auto, 16), this.t("to_car"), `${nf(m.sunCar)} kWh`, R.charger_solar_energy_today) : "",
            F.solar && F.battery ? this._row(I.batt(C.batt, 18, 1), this.t("to_battery"), `${nf(m.sunBatt)} kWh`, R.battery_charge_kwh) : "",
            F.solar ? this._row(I.pylon(C.net, 18), this.t("to_grid_dots"), `${nf(m.sunNet)} kWh`, this._cfg.grid_export_kwh[0]) : "",
            this._row(I.down(C.red, 18), this.t("from_grid_cap"), `${nf(m.impT)} kWh`, this._cfg.grid_import_kwh[0]),
            this._row(I.chart(C.huis), this.t("used_today"), `${nf(m.cons)} kWh`),
            F.solar ? this._row(I.leaf(C.batt), this.t("self_used_cap"), `${nf(m.selfUse * 100, 0)} %`) : "",
            F.solar || F.battery ? this._row(I.leaf(C.batt), this.t("autarky_today"), `${nf(m.autarky * 100, 0)} %`) : "",
          ],
          spark: R.solar_power
            ? {
                key: "today",
                series: [
                  { id: R.solar_power, color: C.zon, label: this.t("node_zon") },
                  ...(R.house_power ? [{ id: R.house_power, color: C.huis, label: this.t("use_word") }] : []),
                ],
              }
            : null,
        }),
        settings: () => ({
          title: this.t("settings"),
          icon: I.gear(C.text, 28),
          rows: [],
          extra: this._cfg.settings
            .map((g) => {
              const ctl = g.ids.map((id) => this._control(id)).join("");
              return ctl ? `<h3 class="sub">${esc(g.title)}</h3><div class="controls">${ctl}</div>` : "";
            })
            .join(""),
        }),
        hot_water: () => {
          const t = this._n(R.hot_water_temperature);
          const shower = this._s(R.hot_water_shower_tomorrow) === "on";
          const plan = (label, v, icon) => (Number.isFinite(v) ? this._row(icon, label, `${nf(v)} kWh`) : "");
          const room = this._n(R.hot_water_room);
          const tank = this._n(R.hot_water_energy_needed);
          return {
            title: this.t("hot_water"),
            icon: I.boiler(C.zon, 28),
            rows: [
              this._row(I.boiler(C.zon), this.t("water_temperature"), `${nf(t, 0)} °C`, R.hot_water_temperature),
              this._rowIf(R.heat_pump_state, I.wave(C.muted), this.t("heat_pump"), `${esc(this.tv("hp_", this._s(R.heat_pump_state)))}${this._has(R.heat_pump_power) ? ` · ± ${kw(this._kwOf(R.heat_pump_power))} <small class="muted">(${esc(this.t("estimated"))})</small>` : ""}`),
              R.hot_water_heating && this._hass.states[R.hot_water_heating]
                ? this._row(this._s(R.hot_water_heating) === "on" ? I.check(C.green, 18) : I.pause(C.muted), this.t("hw_heating"), this.t(this._s(R.hot_water_heating) === "on" ? "busy" : "waiting"), R.hot_water_heating)
                : "",
              R.hot_water_surplus_active && this._hass.states[R.hot_water_surplus_active]
                ? this._row(I.sun(C.zon, 18), this.t("hw_on_surplus"), this.t(this._s(R.hot_water_surplus_active) === "on" ? "busy" : "waiting"), R.hot_water_surplus_active)
                : "",
              R.hot_water_pays && this._hass.states[R.hot_water_pays]
                ? this._row(I.euro(C.zon, 18), this.t("hw_pays"), this.t(this._s(R.hot_water_pays) === "on" ? "word_yes" : "hw_pays_no"), R.hot_water_pays, this._s(R.hot_water_pays) === "on" ? C.green : C.amber)
                : "",
              F.hot_water
                ? this._row(I.sun(C.muted, 18), this.t("hw_by_sunrise", { t: nf(shower ? this._n(R.hot_water_shower) : this._n(R.hot_water_minimum), 0) }) + (shower ? ` (${this.t("shower_word")})` : ""), tm(R.hot_water_morning), R.hot_water_morning, shower ? C.green : null)
                : "",
              this._rowIf(R.hot_water_bath_hour, I.euro(C.muted, 18), this.t("hw_bath_hour"), tm(R.hot_water_bath_hour)),
              ...(F.plan && F.hot_water
                ? [
                    `<h3 class="sub">${I.sun(C.zon, 20)} ${esc(this.t("plan_until", { time: m.sunEnd || "–" }))}</h3>`,
                    plan(this.t("solar_left"), +bf.pv_remaining_kwh, I.sun(C.zon, 18)),
                    plan(this.t("house_left"), +bf.house_remaining_kwh, I.house(C.huis, 18)),
                    F.battery ? plan(this.t("plan_battery"), +bf.battery_needed_kwh, I.batt(C.batt, 18, 0.5)) : "",
                    plan(this.t("plan_car"), this._n(R.ev_energy_needed), I.car(C.auto, 16)),
                    plan(this.t("plan_tank"), tank, I.boiler(C.zon)),
                    this._rowIf(R.hot_water_expected_export, I.up(C.green, 18), this.t("plan_left_export"), `${nf(this._n(R.hot_water_expected_export))} kWh`, this._n(R.hot_water_expected_export) > 0.5 ? C.amber : C.green),
                    Number.isFinite(room) && Number.isFinite(tank)
                      ? `<p class="muted note">${esc(this.t(room >= tank ? "plan_note_enough" : "plan_note_wait"))}</p>`
                      : "",
                  ]
                : []),
            ],
            controls: this._settingsOf("hot_water"),
            spark: { key: "hot_water", series: [{ id: R.hot_water_temperature, color: C.zon, label: this.t("water_c"), fixed: [20, 70] }] },
          };
        },
      };
      const spec = (specs[this._detail] || specs.today)();
      if (spec.spark) spec.spark.series = spec.spark.series.filter((s) => s.id);
      if (!spec.spark?.series?.length) spec.spark = null;
      if (spec.spark && !this._spark[spec.spark.key]?.loading && (!this._spark[spec.spark.key] || Date.now() - this._spark[spec.spark.key].at > 300000))
        this._loadSpark(spec.spark);
      const hasCtl = !!spec.controls?.length;
      const links = [
        ...(spec.links || []),
        ...(this._cfg.paths.analysis ? [{ label: this.t("energy_analysis"), path: this._cfg.paths.analysis }] : []),
      ];
      return `<div class="scrim" data-act="close"></div>
        <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(spec.title)}">
          <div class="sheet-head">${spec.icon}<h2>${esc(spec.title)}</h2><span class="grow"></span>
            ${hasCtl ? `<button class="round${this._showCtl ? " on" : ""}" data-act="ctl" aria-pressed="${!!this._showCtl}" aria-label="${esc(this.t(this._showCtl ? "settings_hide" : "settings_show"))}">${I.gear(this._showCtl ? C.onAccent : C.text, 22, undefined, !!this._showCtl)}</button>` : ""}
            <button class="round" data-act="close" aria-label="${esc(this.t("close"))}">${I.close(C.text)}</button></div>
          <div class="sheet-body">
            ${hasCtl && this._showCtl ? `<h3 class="sub">${I.gear(C.zon, 18)} ${esc(this.t("settings"))}</h3><div class="controls">${spec.controls.map((id) => this._control(id)).join("")}</div>` : ""}
            ${spec.spark ? this._sparkHtml(spec.spark) : ""}
            ${spec.rows.filter(Boolean).length ? `<div class="rows">${spec.rows.join("")}</div>` : ""}
            ${spec.extra || ""}
            ${links.length ? `<div class="links">${links.map((l) => `<button class="linkbtn" data-act="nav" data-path="${esc(l.path)}">${I.chart(C.zon)}${esc(l.label)} →</button>`).join("")}</div>` : ""}
            <div class="muted foot">${esc(this.t("tap_row_hint"))}</div>
          </div>
        </div>`;
    }

    // The helpers of one settings group (rendered from the installed modules).
    _settingsOf(key) {
      return (this._cfg.settings.find((g) => g.key === key) || {}).ids || [];
    }

    // One block per car of house.yaml (only with ev-charging): the Teslemetry roles that exist.
    _cars() {
      return (this._cfg.cars || [])
        .map((c) => {
          const rows = [
            this._rowIf(c.battery, I.batt(C.auto, 18, 0.7), this.t("charge_level") + (c.limit ? ` · ${this.t("limit_word")}` : ""), `${nf(this._n(c.battery), 0)} %${c.limit && this._has(c.limit) ? ` · ${nf(this._n(c.limit), 0)} %` : ""}`),
            this._rowIf(c.power, I.bolt(C.green), this.t("charge_power"), kw(this._kwOf(c.power))),
            this._rowIf(c.current, I.wave(C.zon), this.t("charge_current_set"), `${nf(this._n(c.current), 0)} A`),
            this._rowIf(c.state, I.plug(C.muted), this.t("car_state"), esc(this._s(c.state))),
          ].join("");
          return rows
            ? `<div class="carblock"><div class="carhead">${I.car(C.auto, 22)}<b>${esc(c.name)}</b></div>${rows}</div>`
            : "";
        })
        .join("");
    }

    _fmtSetting(id, v) {
      const unit = this._a(id, "unit_of_measurement") || "";
      const step = this._a(id, "step") || 1;
      return `${nf(v, step < 1 ? 1 : 0)}${unit ? ` ${unit}` : ""}`;
    }

    // A helper as a control: switch (input_boolean / automation), time (input_datetime) or slider (input_number).
    // The label is the helper's own name (translated by the module that made it).
    _control(id) {
      const st = this._hass.states[id];
      if (!st) return "";
      const label = st.attributes.friendly_name || id;
      if (id.startsWith("input_boolean.") || id.startsWith("automation.")) {
        const on = st.state === "on";
        return `<div class="ctl"><span></span><span class="cl">${esc(label)}</span>
          <button class="switch ${on ? "on" : ""}" data-act="toggle" data-entity="${id}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><i></i></button></div>`;
      }
      if (id.startsWith("input_datetime."))
        return `<div class="ctl"><span></span><span class="cl">${esc(label)}</span>
          <input type="time" class="time" value="${esc(st.state.slice(0, 5))}" data-entity="${id}" aria-label="${esc(label)}"></div>`;
      if (!id.startsWith("input_number.")) return "";
      const a = st.attributes;
      return `<div class="ctl slider"><span></span><span class="cl">${esc(label)}</span><output data-out="${id}">${this._fmtSetting(id, +st.state)}</output>
        <input type="range" min="${a.min}" max="${a.max}" step="${a.step}" value="${esc(st.state)}" data-entity="${id}" aria-label="${esc(label)}"></div>`;
    }

    // ---------- 24 h sparkline (state history since midnight, 5-minute buckets) ----------
    async _loadSpark(spec) {
      const key = spec.key;
      this._spark[key] = { ...(this._spark[key] || {}), loading: true };
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      try {
        const res = await this._hass.callWS({
          type: "history/history_during_period",
          start_time: start.toISOString(),
          entity_ids: spec.series.map((s) => s.id),
          minimal_response: true,
          no_attributes: true,
        });
        const bucket = 300000;
        const series = spec.series.map((s) => {
          const unit = String(this._a(s.id, "unit_of_measurement") || "").toLowerCase();
          const scale = unit === "w" ? 0.001 : 1;
          const pts = new Map();
          for (const r of res[s.id] || []) {
            const v = parseFloat(r.s);
            if (!Number.isFinite(v)) continue;
            const t = Math.floor(((r.lu ?? r.lc) * 1000) / bucket) * bucket;
            const b = pts.get(t) || [0, 0];
            b[0] += v * scale;
            b[1] += 1;
            pts.set(t, b);
          }
          return { ...s, pts: [...pts.entries()].map(([t, [sum, c]]) => [t, sum / c]).sort((a, b) => a[0] - b[0]) };
        });
        this._spark[key] = { at: Date.now(), start: start.getTime(), series };
      } catch (e) {
        this._spark[key] = { at: Date.now(), error: String(e?.message || e) };
      }
      if (this._detail) this._render();
    }

    _sparkHtml(spec) {
      const data = this._spark[spec.key];
      if (!data || data.loading || !data.series)
        return `<div class="spark empty muted">${esc(this.t(data?.error ? "graph_unavailable" : "graph_loading"))}</div>`;
      const W = 600,
        H = 150,
        t0 = data.start,
        t1 = t0 + 86400000;
      const fixed = spec.series.find((s) => s.fixed)?.fixed;
      let lo = 0,
        hi = 0.5;
      data.series.forEach((s) =>
        s.pts.forEach(([, v]) => {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }),
      );
      if (fixed) [lo, hi] = fixed;
      const x = (t) => ((t - t0) / (t1 - t0)) * W;
      const y = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 16);
      const paths = data.series
        .map((s) => {
          if (!s.pts.length) return "";
          const d = s.pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
          const area = `${d} L${x(s.pts[s.pts.length - 1][0]).toFixed(1)} ${y(Math.max(lo, 0))} L${x(s.pts[0][0]).toFixed(1)} ${y(Math.max(lo, 0))} Z`;
          const col = ink(s.color);
          return `<path d="${area}" fill="${col}" fill-opacity=".12"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2"/>`;
        })
        .join("");
      const ticks = [0, 6, 12, 18, 24]
        .map((h) => `<text x="${x(t0 + h * 3600000)}" y="${H + 14}" text-anchor="${h === 0 ? "start" : h === 24 ? "end" : "middle"}">${String(h).padStart(2, "0")}:00</text>`)
        .join("");
      const unit = fixed ? (fixed[1] === 100 ? "%" : "°C") : "kW";
      return `<div class="spark">
        <div class="legend2">${data.series.map((s) => `<span><i style="background:${ink(s.color)}"></i>${esc(s.label)}</span>`).join("")}<span class="grow"></span><span class="muted">max ${nf(hi, fixed ? 0 : 1)} ${unit}</span></div>
        <svg viewBox="0 -4 ${W} ${H + 22}" preserveAspectRatio="none" role="img" aria-label="${esc(this.t("graph_today"))}">
          <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="${C.line}"/>
          ${paths}
          <line x1="${x(Date.now())}" x2="${x(Date.now())}" y1="0" y2="${H}" stroke="${C.muted}" stroke-dasharray="3 4"/>
          <g class="ticks">${ticks}</g>
        </svg></div>`;
    }

    // ---------- events ----------
    _onClick(ev) {
      const el = ev.composedPath().find((n) => n.dataset && (n.dataset.act || n.dataset.open || n.dataset.more));
      if (!el) return;
      const { act, open, more } = el.dataset;
      if (act) this._fastUntil = Date.now() + FAST_MS;
      if (more) {
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: more }, bubbles: true, composed: true }));
        return;
      }
      if (open) {
        this._detail = open;
        this._showCtl = false;
        this._render();
        return;
      }
      if (act === "ctl") {
        this._showCtl = !this._showCtl;
        this._render();
        const body = this.shadowRoot?.querySelector(".sheet-body");
        if (body && this._showCtl) body.scrollTop = 0;
        return;
      }
      if (act === "close") {
        this._detail = null;
        this._render();
        return;
      }
      if (act === "adv") {
        this._adv = !this._adv;
        try {
          localStorage.setItem(VIEW_KEY, this._adv ? "1" : "0");
        } catch (e) {
          /* private mode */
        }
        this._render();
        return;
      }
      if (act === "mode") {
        this._hass.callService("script", "turn_on", {
          entity_id: this._R.charger_set_mode,
          variables: { mode: el.dataset.opt, reason: this.t("mode_reason") },
        });
        return;
      }
      if (act === "toggle") {
        const ent = el.dataset.entity;
        this._hass.callService(ent.startsWith("automation.") ? "automation" : "input_boolean", "toggle", { entity_id: ent });
        return;
      }
      if (act === "nav") {
        this._detail = null;
        history.pushState(null, "", el.dataset.path);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      }
    }
  }

  const css = () => `
    :host { display: block; }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; text-align: left; }
    button:focus-visible, [tabindex]:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
    .wrap { position: relative; font-family: Figtree, system-ui, sans-serif; color: ${C.text}; background: ${C.bg};
      height: calc(100vh - var(--header-height, 56px)); min-height: 640px; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; overflow: hidden;
      /* Embedded HA cards follow the app theme; force dark text so the diagram and pills stay readable in light mode. */
      --primary-text-color: ${C.text}; --secondary-text-color: ${C.muted}; --disabled-text-color: #8a7f70; --divider-color: ${sep()}; --ha-card-background: ${C.card}; --card-background-color: ${C.card}; --state-icon-color: ${C.muted}; --ha-card-border-radius: 20px; }
    .muted { color: ${C.muted}; }
    .grow { flex-grow: 1; }
    cw-kop { margin: 0; max-width: none; }
    cw-kop:not(:defined) { display: block; min-height: 56px; font: 28px/56px Caprasimo, Georgia, serif; }
    cw-kop:not(:defined) > * { display: none; }
    cw-kop .dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 5px; vertical-align: 1px; }
    .status { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: -6px; }
    .saved { margin-left: auto; min-height: 32px; display: inline-flex; align-items: center; }
    .saved + .saved { margin-left: 0; }
    .ptiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .ptile { background: ${C.card}; border-radius: 18px; padding: 10px 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; text-align: center; }
    .ptile .pv { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .ptile b { font-size: 17px; }
    .ptile small { display: flex; align-items: center; gap: 3px; font-size: 13px; color: ${C.muted}; white-space: nowrap; min-height: 24px; }
    .pline { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    .plbl { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
    .pline svg { width: 100%; height: 56px; display: block; }
    .pticks { position: relative; height: 14px; font-size: 11px; }
    .pticks span { position: absolute; transform: translateX(-50%); }
    .price { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; padding: 18px 24px; flex: none; }
    .price .pcol { display: flex; flex-direction: column; gap: 2px; }
    .price b { font-size: 26px; line-height: 1.1; }
    .price small { font-size: 13px; }
    .price .chips { grid-column: 1 / -1; }
    .round { width: 44px; height: 44px; border-radius: 999px; background: ${C.card}; display: flex; align-items: center; justify-content: center; }
    .round.on { background: ${C.accent}; }
    .grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; }
    .col { display: flex; flex-direction: column; gap: 16px; min-height: 0; }
    .col.right { overflow-y: auto; }
    [data-part="strip"] { display: flex; flex-direction: column; gap: 16px; }
    .card { background: ${C.card}; border-radius: 26px; width: 100%; }
    button.card:hover, .tile:hover, .thead:hover, .bar:hover { filter: brightness(1.08); }
    .flow { flex: 1; min-height: 340px; position: relative; padding: 8px; display: flex; }
    .flow-slot { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden;
      --ha-card-background: transparent; --card-background-color: transparent; --ha-card-box-shadow: none; --ha-card-border-width: 0; }
    .flow-inner { width: 460px; flex: none; transform-origin: center center; }
    .fbtns { position: absolute; left: 14px; top: 14px; display: flex; flex-direction: column; gap: 8px; }
    .fbtn { width: 40px; height: 40px; border-radius: 99px; background: ${C.bg}; display: flex; align-items: center; justify-content: center; }
    .fbtn:hover { background: ${C.raised}; }
    .pills { flex: none; display: flex; flex-direction: column; gap: 8px; }
    .pills:empty { display: none; }
    .strip-m { padding: 12px 14px; }
    .strip-m .cap { font-size: 12px; color: ${C.muted}; margin: 0 0 4px 2px; }
    .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 18px 22px; align-items: center; }
    .tile { display: flex; align-items: center; gap: 12px; padding: 6px; border-radius: 16px; min-width: 0; }
    .tile .ic { width: 50px; height: 50px; flex: none; border-radius: 99px; display: flex; align-items: center; justify-content: center; }
    .tile b { display: block; font-size: 26px; font-weight: 700; line-height: 1.1; }
    .tile small { display: block; font-size: 13px; color: ${C.muted}; }
    .tile small.sub { font-size: 12px; opacity: .85; }
    .adv-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 12px; padding: 14px 18px; }
    .adv-strip .tile .ic { width: 40px; height: 40px; }
    .adv-strip .tile b { font-size: 20px; }
    .phases em { display: block; font-style: normal; font-weight: 700; font-size: 14px; line-height: 1.25; }
    .batt { display: flex; align-items: center; gap: 18px; padding: 18px 22px; flex: none; }
    .ring { width: 128px; height: 128px; flex: none; font-family: Figtree, sans-serif; }
    .bcol { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; background: ${C.bg}; font-size: 14px; color: ${C.muted}; }
    .chip b { color: ${C.text}; }
    .advline { font-size: 13px; line-height: 1.4; }
    .tesla { display: flex; flex-direction: column; gap: 14px; padding: 20px 24px; flex: none; }
    .thead { display: flex; align-items: center; gap: 12px; width: 100%; }
    .tname { font-size: 20px; font-weight: 700; }
    .tstate { display: inline-flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 600; }
    .bar { display: block; width: 100%; }
    .track { display: block; height: 18px; border-radius: 999px; background: ${sep()}; position: relative; overflow: hidden; }
    .fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: ${ink(C.auto)}; }
    .lim { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: ${C.text}; }
    .barlbl { display: flex; justify-content: space-between; margin-top: 8px; font-size: 15px; }
    .barlbl b { color: ${C.text}; font-size: 18px; }
    .seg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 4px; border-radius: 999px; background: ${C.bg}; }
    .seg button { height: 42px; border-radius: 999px; color: ${C.muted}; font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .seg button.on { background: ${C.accent}; color: ${C.onAccent}; font-weight: 700; }
    .toggles { display: flex; gap: 10px; }
    .toggles button { flex: 1; height: 42px; border-radius: 16px; background: ${C.bg}; color: ${C.muted}; font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .toggles button.on { background: ${tint(C.zon, 0.18)}; color: ${C.text}; }
    .col.right > .sunbar:only-child { flex: none; }
    .sunbar { flex: 1; min-height: 120px; padding: 18px 24px; display: flex; flex-direction: column; justify-content: center; gap: 14px; }
    .sunbar .row { display: flex; align-items: center; gap: 8px; font-size: 16px; }
    .stack { display: flex; height: 32px; border-radius: 999px; overflow: hidden; gap: 3px; }
    .stack span { display: block; min-width: 0; }
    ${C.light ? ".stack span { box-shadow: inset 0 0 0 1px rgba(32, 30, 29, .22); }" : ""}
    .legend { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; font-size: 17px; }
    .legend span { display: flex; align-items: center; gap: 6px; }
    .scrim { position: absolute; inset: 0; background: rgba(0,0,0,.55); z-index: 5; }
    .sheet { position: absolute; z-index: 6; top: 16px; bottom: 16px; right: 16px; width: min(560px, calc(100% - 32px));
      background: ${C.card}; border-radius: 26px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
    .sheet-head { display: flex; align-items: center; gap: 12px; padding: 18px 20px 8px 24px; }
    .sheet-head h2 { margin: 0; font-family: Caprasimo, Georgia, serif; font-weight: 400; font-size: 26px; }
    .sheet-head .round { background: ${C.bg}; }
    .sheet-head .round.on { background: ${C.accent}; }
    .sheet-body { overflow-y: auto; padding: 8px 24px 20px; display: flex; flex-direction: column; gap: 16px; }
    .rows { display: flex; flex-direction: column; }
    .drow { display: flex; align-items: center; gap: 12px; padding: 10px 6px; border-bottom: 1px solid ${sep()}; font-size: 15px; }
    .drow.link { cursor: pointer; border-radius: 10px; }
    .drow.link:hover { background: ${C.raised}; }
    .dic { width: 26px; display: flex; justify-content: center; flex: none; }
    .dl { flex: 1; color: ${C.muted}; }
    .dv { font-weight: 700; text-align: right; }
    .ph { font-size: 13px; color: ${C.muted}; }
    .carblock { background: ${C.bg}; border-radius: 18px; padding: 12px 14px; }
    .carblock .drow { border-color: ${C.card}; }
    .carhead { display: flex; align-items: center; gap: 10px; font-size: 17px; padding: 2px 6px 6px; }
    .controls { display: flex; flex-direction: column; gap: 10px; }
    .ctl { display: grid; grid-template-columns: 26px 1fr auto; align-items: center; gap: 10px; padding: 12px 14px; background: ${C.bg}; border-radius: 16px; }
    .ctl .cl { font-size: 15px; }
    .ctl output { font-weight: 700; }
    .ctl input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: ${C.accent}; height: 28px; }
    .switch { width: 52px; height: 30px; border-radius: 99px; background: ${sep()}; position: relative; }
    .switch i { position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 99px; background: ${C.muted}; transition: left .15s; }
    .switch.on { background: ${C.accent}; }
    .switch.on i { left: 25px; background: ${C.onAccent}; }
    .spark { background: ${C.bg}; border-radius: 18px; padding: 12px 14px 6px; }
    .spark.empty { padding: 40px; text-align: center; }
    .spark svg { width: 100%; height: 170px; display: block; }
    .spark .ticks text { font-size: 12px; fill: ${C.muted}; }
    .legend2 { display: flex; gap: 14px; align-items: center; font-size: 13px; margin-bottom: 6px; }
    .legend2 i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
    .links { display: flex; flex-wrap: wrap; gap: 10px; }
    .linkbtn { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 999px; background: ${tint(C.zon, 0.18)}; font-size: 15px; font-weight: 600; }
    .foot { font-size: 12px; }
    h3.sub { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font-size: 16px; font-weight: 700; }
    .note { font-size: 14px; line-height: 1.4; margin: 8px 6px 0; }
    .ctl input.time { font: inherit; color: ${C.text}; background: ${C.raised}; border: 0; border-radius: 10px; padding: 6px 10px; }
    @media (max-width: 1100px) {
      .wrap { height: auto; overflow: visible; padding: 16px; }
      .grid { grid-template-columns: minmax(0, 1fr); overflow: visible; }
      .flow { flex: none; flex-direction: column; gap: 8px; }
      .flow-slot { flex: none; height: 380px; }
      .fbtns { position: static; flex-direction: row; justify-content: center; }
      .strip, .adv-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sheet { position: fixed; top: 8px; bottom: 8px; right: 8px; left: 8px; width: auto; }
      .scrim { position: fixed; }
    }
    @media (max-width: 520px) {
      .ptiles { gap: 6px; }
      .ptile { padding: 8px 4px; }
      .ptile .pv { flex-direction: column; gap: 2px; }
      .ptile b { font-size: 15px; }
      .saved { margin-left: 0; }
      .status { font-size: 16px; }
      .round { width: 40px; height: 40px; }
      .flow-slot { height: 300px; }
      .strip { padding: 14px; gap: 8px; }
      .tile b { font-size: 22px; }
      .batt { gap: 14px; padding: 16px; }
      .ring { width: 96px; height: 96px; }
    }
  `;


  if (!customElements.get("energy-screen-card")) customElements.define("energy-screen-card", EnergyScreenCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "energy-screen-card",
    name: "Energy screen (ha-kit)",
    description: `v${VERSION}`,
  });
})();

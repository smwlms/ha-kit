// Climate screen (ha-kit module climate): floor heating and cooling, ventilation, ComfoClime, hot water and shading.
// Tabs: Status (at a glance), Controls (quick tiles), Smart (what the automations do and why), Settings (every
// helper of the module, collapsible per device) and Details (measurements and the forecast model). The chosen tab and
// the open settings groups are remembered per device (localStorage).
// Nothing about the house is built in: every entity id, value, list and text comes from the card config that
// tools/fill.py renders from house.yaml, modules: and the capabilities (lovelace/climate.yaml). A block whose feature
// flag is false is not drawn; a chip without a value is not drawn; a row without a value says "no measurement yet".
// Needs cw-thema.js of module base (cw-kop, cw-chip, cw-info, window.cwWeerIcoon). Card: type: custom:climate-screen-card
(() => {
  // The language is part of the version, so browsers reload the file when house.language changes.
  const VERSION = "1-<@ t('language_code') @>";
  // Re-render at most once per THROTTLE_MS on state changes; after a tap, updates render immediately for FAST_MS.
  const THROTTLE_MS = 5000;
  const FAST_MS = 10000;
  const TAB_KEY = "ha-kit-climate-tab";
  const OPEN_KEY = "ha-kit-climate-open";
  const TABS = ["status", "controls", "smart", "settings", "details"];
  const MODES = ["heating", "neutral", "cooling"];
  const VSTATES = ["auto", "bypass_closed", "cooling_medium", "cooling_high"];
  const VETO_HOURS = [1, 3, 6, 12];
  const NO_VALUE = new Set([undefined, null, "", "unknown", "unavailable"]);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  // "{t}° inside" + {t: "21,5"} -> text; unknown {names} stay as they are.
  const fmt = (text, values = {}) =>
    String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const plain = (html) => String(html ?? "").replace(/<[^>]+>/g, "");
  const svg = (s, body) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  // Device icons: same drawings as the cw-thema icons (module base), drawn here at a larger size.
  const ICON = {
    floor: '<path d="M3 20h18M5 16c2-2 4 2 6 0s4 2 6 0 2-1 2-1M5 11c2-2 4 2 6 0s4 2 6 0 2-1 2-1"/>',
    fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 2 3 0 5l-4 2M14 12c4 0 7 1 7 4 0 2-3 2-5 0l-2-4M12 14c0 4-1 7-4 7-2 0-2-3 0-5l4-2M10 12c-4 0-7-1-7-4 0-2 3-2 5 0l2 4"/>',
    snow: '<path d="M12 2v20M4 7l16 10M4 17l16-10M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    boiler: '<rect x="6" y="2" width="12" height="18" rx="4"/><path d="M9 22v-2M15 22v-2M12 7c-1.5 2-2 3-2 4a2 2 0 0 0 4 0c0-1-.5-2-2-4z"/>',
    blind: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 7h16M4 11h16M4 15h16"/>',
    chevron: '<path d="M6 9 L12 15 L18 9"/>',
    minus: '<path d="M5 12 H19"/>',
    plus: '<path d="M12 5 V19 M5 12 H19"/>',
  };
  const ic = (name, s = 22) => svg(s, ICON[name] || "");

  class ClimateScreenCard extends HTMLElement {
    setConfig(config) {
      if (!config || typeof config.roles !== "object" || typeof config.strings !== "object")
        throw new Error(
          "climate-screen-card: roles and strings are rendered by ha-kit (tools/fill.py): paste climate/lovelace/climate.yaml",
        );
      this._cfg = {
        features: {},
        rooms: [],
        values: {},
        comfort: { low: 20.5, high: 22.5 },
        target: 21,
        loud_hours: { start: "23:00", end: "06:00" },
        boost: { below: 19.5, hours: 2 },
        theme: "auto",
        ...config,
      };
      this._f = this._cfg.features || {};
      this._r = this._cfg.roles || {};
      this._S = this._cfg.strings || {};
      this._v = this._cfg.values || {};
      this._loc = this._S.locale || undefined;
      this._watch = [
        ...Object.values(this._r),
        ...this._cfg.rooms.flatMap((x) => [x.blind, x.flag, x.manual]),
      ].filter((x) => typeof x === "string" && x.includes("."));
      this._veto = { t: null, h: 3 };
      try {
        const t = localStorage.getItem(TAB_KEY);
        this._tab = TABS.includes(t) ? t : "status";
      } catch (e) {
        this._tab = "status";
      }
      try {
        this._open = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"));
      } catch (e) {
        this._open = new Set();
      }
      this._sig = null;
      if (this._hass && this.shadowRoot) this._render();
    }
    getCardSize() {
      return 12;
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
      const zone = this._zone();
      const sig =
        [...this._watch, zone].map((id) => hass.states[id]?.last_updated).join("|") + `|${this._dark()}`;
      if (sig === this._sig) return;
      this._sig = sig;
      if (this._dark() !== this._wasDark) {
        this._wasDark = this._dark();
        this._fastUntil = Date.now() + 500;
      }
      this._schedule();
    }
    connectedCallback() {
      if (this._hass && this.shadowRoot && !this._throttle) this._schedule();
    }
    disconnectedCallback() {
      clearTimeout(this._throttle);
      this._throttle = null;
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
        this._render();
      }, wait);
    }
    _wrap() {
      if (!this._wrapEl) {
        this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="wrap"></div>`;
        this._wrapEl = this.shadowRoot.querySelector(".wrap");
      }
      return this._wrapEl;
    }
    _dark() {
      const t = this._cfg?.theme;
      if (t === "light") return false;
      if (t === "dark") return true;
      return this._hass?.themes?.darkMode !== false;
    }

    // ---------- state readers ----------
    _st(id) {
      return id ? this._hass.states[id] : undefined;
    }
    _s(id) {
      return this._st(id)?.state;
    }
    _a(id, k) {
      return this._st(id)?.attributes?.[k];
    }
    _has(id) {
      return !!this._st(id);
    }
    _ok(id) {
      return !NO_VALUE.has(this._s(id));
    }
    _on(id) {
      return this._s(id) === "on";
    }
    _n(id) {
      const v = parseFloat(this._s(id));
      return Number.isFinite(v) ? v : NaN;
    }
    // Climate entity of the main heat-pump zone: the role, else the attribute main_zone of sensor.heat_pump_state.
    _zone() {
      return this._r.heat_pump_zone || this._a(this._r.heat_pump_state, "main_zone") || "";
    }
    _nf(v, d = 1) {
      return Number.isFinite(v)
        ? v.toLocaleString(this._loc, { minimumFractionDigits: d, maximumFractionDigits: d })
        : null;
    }
    _fu(v, d, unit) {
      const s = this._nf(v, d);
      return s == null ? null : `${s}${unit}`;
    }
    _hhmm(d) {
      return d.toLocaleTimeString(this._loc, { hour: "2-digit", minute: "2-digit" });
    }
    // Generic readout of a sensor we only display: number with its unit, or the escaped text.
    _val(id, d = 1) {
      if (!this._ok(id)) return null;
      const s = String(this._s(id)).trim();
      if (!/^-?\d+(\.\d+)?$/.test(s)) return esc(s);
      const u = this._a(id, "unit_of_measurement") || "";
      const v = parseFloat(s);
      const unit = u === "°C" ? "°" : u ? ` ${u}` : "";
      return this._fu(v, Number.isInteger(v) ? 0 : d, unit);
    }

    // ---------- small builders (all return "" when the entity is missing) ----------
    _chip(icon, text, label, o = {}) {
      return `<cw-chip icoon="${icon}"${o.bij ? ` bij="${o.bij}"` : ""} label="${esc(label)}"${o.info ? ` info="${esc(o.info)}"` : ""}${o.entity ? ` entity="${esc(o.entity)}"` : ""}${o.toon ? ` toon="${o.toon}"` : ""}${o.kaal ? " kaal" : ""}${o.uit ? " uit" : ""}${o.ic ? ` style="--ic:${o.ic};"` : ""}>${esc(text ?? "")}</cw-chip>`;
    }
    _subOrInfo(sub) {
      if (!sub) return "";
      const p = plain(sub);
      return p.length > 28 ? `<cw-info label="${esc(p)}"></cw-info>` : `<small class="muted">${sub}</small>`;
    }
    _row(k, v, color) {
      return v == null || v === ""
        ? `<div class="row"><span class="muted">${k}</span><span class="muted">${esc(this._S.no_measurement)}</span></div>`
        : `<div class="row"><span class="muted">${k}</span><b${color ? ` style="color:${color}"` : ""}>${v}</b></div>`;
    }
    _rowIf(k, v, color) {
      return v == null || v === "" ? "" : this._row(k, v, color);
    }
    _seg(act, opts, cur, label, attrs = "", cls = "") {
      if (!opts.length) return "";
      const b = opts
        .map(
          (o) =>
            `<button class="${o.v === cur ? "on" : ""}" data-act="${act}" ${attrs} data-v="${esc(o.v)}" aria-pressed="${o.v === cur}">${esc(o.l)}</button>`,
        )
        .join("");
      return `<div class="seg ${cls}" role="group" aria-label="${esc(label)}" style="grid-template-columns:repeat(${opts.length},minmax(0,1fr))">${b}</div>`;
    }
    _head(title, sub) {
      return `<span class="t set-h"><b>${esc(title)}</b>${this._subOrInfo(sub ? esc(sub) : "")}</span>`;
    }
    // Segmented control bound to a select / input_select; its options come from the entity itself.
    _selSeg(id, labels, title, sub) {
      if (!this._ok(id)) return "";
      const opts = (this._a(id, "options") || []).map((v) => ({ v, l: labels[v] || v }));
      return `${title ? this._head(title, sub) : ""}${this._seg("sel", opts, this._s(id), title || id, `data-entity="${esc(id)}"`)}`;
    }
    _tog(id, title, sub) {
      if (!this._ok(id)) return "";
      const on = this._on(id);
      return `<button class="tgl ${on ? "on" : ""}" data-act="toggle" data-entity="${esc(id)}" aria-pressed="${on}">
        <span class="t"><b>${esc(title)}</b>${this._subOrInfo(sub ? esc(sub) : "")}</span>
        <span class="switch ${on ? "on" : ""}"><i></i></span></button>`;
    }
    _togTile(id, title, sub) {
      if (!this._ok(id)) return "";
      const on = this._on(id);
      return `<button class="tile tog ${on ? "on" : ""}" data-act="toggle" data-entity="${esc(id)}" aria-pressed="${on}">
        <span class="tl"><b>${esc(title)}</b><span class="switch sm ${on ? "on" : ""}"><i></i></span></span>${this._subOrInfo(sub ? esc(sub) : "")}</button>`;
    }
    _pressTile(id, label) {
      return this._has(id)
        ? `<button class="tile" data-act="press" data-entity="${esc(id)}"><b>${esc(label)}</b></button>`
        : "";
    }
    _stepRow(title, sub, valueText, act, attrs, d) {
      return `<div class="set"><span class="t"><b>${esc(title)}</b>${this._subOrInfo(sub ? esc(sub) : "")}</span>
        <span class="mini"><button class="round" data-act="${act}" ${attrs} data-d="${-d}" aria-label="${esc(fmt(this._S.lower, { what: title }))}">${ic("minus", 18)}</button><output>${valueText}</output><button class="round" data-act="${act}" ${attrs} data-d="${d}" aria-label="${esc(fmt(this._S.higher, { what: title }))}">${ic("plus", 18)}</button></span></div>`;
    }
    // Stepper for an input_number / number entity; step and digits from the entity.
    _num(id, title, sub, unit = "°") {
      if (!this._ok(id)) return "";
      const step = parseFloat(this._a(id, "step")) || 0.5;
      const digits = step < 1 ? 1 : 0;
      const txt = this._fu(this._n(id), digits, unit);
      return txt == null ? "" : this._stepRow(title, sub, txt, "num", `data-entity="${esc(id)}"`, step);
    }
    _sub(title) {
      return `<span class="lbl sub">${esc(title)}</span>`;
    }
    _card(title, body, extra = "") {
      return body && body.trim()
        ? `<section class="card ${extra}">${title ? `<h2 class="lbl">${esc(title)}</h2>` : ""}${body}</section>`
        : "";
    }
    _grp(key, title, sub, body) {
      if (!body || !body.trim()) return "";
      const open = this._open.has(key);
      return `<section class="card grp ${open ? "open" : ""}">
        <button class="grp-h" data-act="grp" data-v="${key}" aria-expanded="${open}"><span class="t"><b>${esc(title)}</b>${this._subOrInfo(sub ? esc(sub) : "")}</span><span class="chev">${ic("chevron", 18)}</span></button>
        ${open ? `<div class="grp-b">${body}</div>` : ""}</section>`;
    }
    // One automation block: title + switch, what it does now, the rule behind an (i), and optional body.
    _auto(id, title, rule, now, body = "") {
      const on = id ? this._on(id) : true;
      const sw =
        id && this._ok(id)
          ? `<button class="sw-btn" data-act="toggle" data-entity="${esc(id)}" aria-pressed="${on}" aria-label="${esc(title)}"><span class="switch ${on ? "on" : ""}"><i></i></span></button>`
          : "";
      return `<section class="card auto ${on ? "is-on" : ""}"><div class="auto-h"><span class="t"><b>${esc(title)}</b></span>${rule ? `<cw-info label="${esc(plain(rule))}"></cw-info>` : ""}${sw}</div>
        ${now ? `<div class="now"><i class="dot"></i><span>${now}</span></div>` : ""}${body}</section>`;
    }

    // ---------- device state ----------
    _floorInfo() {
      const S = this._S;
      const R = this._r;
      const zone = this._zone();
      const hp = this._s(R.heat_pump_state);
      const act = this._a(zone, "hvac_action");
      const known = this._ok(zone) || (hp && hp !== "unknown" && this._ok(R.heat_pump_state));
      const doing =
        hp === "heating" || act === "heating"
          ? "heating"
          : hp === "cooling" || act === "cooling"
            ? "cooling"
            : hp === "hot_water"
              ? "hot_water"
              : "idle";
      const off = this._s(zone) === "off";
      const lo = parseFloat(this._a(zone, "target_temp_low"));
      const hi = parseFloat(this._a(zone, "target_temp_high"));
      const band =
        Number.isFinite(lo) && Number.isFinite(hi)
          ? fmt(S.floor_band, { low: this._nf(lo), high: this._nf(hi) })
          : null;
      const vetoEnd = this._a(zone, "quick_veto_end_date_time");
      const vetoOn = !!vetoEnd && new Date(vetoEnd) > new Date();
      const mode = this._s(R.floor_mode);
      const since = this._a(R.floor_since, "timestamp");
      const days = Number.isFinite(since) && since > 0 ? (Date.now() / 1000 - since) / 86400 : NaN;
      return { zone, known, doing, off, lo, hi, band, vetoOn, vetoEnd, mode, days };
    }
    _ventInfo(tIn) {
      const S = this._S;
      const R = this._r;
      const v = this._v;
      const speed = this._s(R.ventilation_speed);
      const speedName = { [v.away]: S.speed_away, [v.low]: S.speed_low, [v.medium]: S.speed_medium, [v.high]: S.speed_high };
      const speedL = speed ? speedName[speed] || speed : null;
      const byp = this._n(R.ventilation_bypass_state);
      const coolOn = this._on(R.ventilation_cooling);
      const state = this._s(R.ventilation_state);
      const tOut = this._n(R.ventilation_outdoor_temperature);
      const cAct = this._a(R.comfoclime, "hvac_action");
      const cooling = coolOn && (state === "cooling_medium" || state === "cooling_high");
      const reachable = this._ok(R.ventilation_speed) || this._ok(R.ventilation);
      const sentence = !reachable
        ? S.vent_unreachable
        : cAct === "heating"
          ? S.vent_air_heated
          : cAct === "cooling"
            ? S.vent_air_cooled
            : cooling
              ? S.vent_free_cooling
              : byp > 0 && tOut < tIn
                ? S.vent_cool_air_in
                : byp > 0
                  ? S.vent_bypass_open
                  : speed && speed === v.away
                    ? S.vent_away
                    : coolOn && state === "bypass_closed"
                      ? S.vent_keeps_heat
                      : S.vent_calm;
      const bypTxt = Number.isFinite(byp)
        ? byp > 0
          ? fmt(S.bypass_open_pct, { pct: this._nf(byp, 0) })
          : S.bypass_closed
        : null;
      return { speed, speedL, speedName, byp, bypTxt, coolOn, state, cooling, sentence, tOut, reachable };
    }
    _ccInfo() {
      const S = this._S;
      const id = this._r.comfoclime;
      const up = this._has(id) && this._s(id) !== "unavailable";
      const mode = this._s(id);
      const act = this._a(id, "hvac_action");
      const w = this._n(this._r.comfoclime_power);
      const pTxt = Number.isFinite(w) ? (w >= 1000 ? this._fu(w / 1000, 1, " kW") : this._fu(w, 0, " W")) : null;
      const doing =
        mode === "off"
          ? S.cc_off
          : act === "heating"
            ? S.cc_heating
            : act === "cooling"
              ? S.cc_cooling
              : act === "defrosting"
                ? S.cc_defrosting
                : act === "fan" || mode === "fan_only"
                  ? S.cc_fan_only
                  : S.cc_idle;
      const target = parseFloat(this._a(id, "temperature"));
      const hasT = (mode === "heat" || mode === "cool") && Number.isFinite(target);
      const color = act === "heating" ? "var(--zon)" : act === "cooling" ? "var(--water)" : "var(--muted)";
      const saved = this._s(this._r.comfoclime_previous) || "";
      const parts = saved.split("|");
      const boostUntil = parts.length === 3 && !NO_VALUE.has(saved) ? new Date(parts[2]) : null;
      return { id, up, mode, act, w, pTxt, doing, target, hasT, color, boostUntil };
    }
    _modeName(m) {
      return this._S[`mode_${m}`] || m;
    }

    // ---------- tabs ----------
    _tabStatus(ctx) {
      const { tIn, fl, vt, cc } = ctx;
      const S = this._S;
      const R = this._r;
      const F = this._f;
      const c = this._cfg.comfort;
      const warn = [];
      if (this._on(R.heat_pump_fault)) warn.push(["bad", S.alert_fault, S.alert_fault_info, R.heat_pump_fault]);
      const fd = this._n(R.ventilation_filter_days);
      if (Number.isFinite(fd) && fd < 14)
        warn.push(["warn", fmt(S.alert_filter, { days: this._nf(fd, 0) }), fmt(S.alert_filter_info, { days: this._nf(fd, 0) }), R.ventilation_filter_days]);
      if (F.floor && !fl.known) warn.push(["warn", S.floor, S.alert_floor_offline, fl.zone || R.heat_pump_state]);
      if (F.ventilation && !vt.reachable) warn.push(["warn", S.ventilation, S.alert_vent_offline, R.ventilation_speed || R.ventilation]);
      if (F.comfoclime && !cc.up) warn.push(["warn", S.comfoclime, S.alert_cc_offline, R.comfoclime]);
      if (F.comfoclime_boost && this._has(R.comfoclime_writes) && !this._on(R.comfoclime_writes))
        warn.push(["", S.alert_cc_writes, S.alert_cc_writes_info, R.comfoclime_writes]);
      const err = this._a(R.indoor_peak, "error");
      if (err || (this._has(R.indoor_peak) && !this._ok(R.indoor_peak)))
        warn.push(["", S.alert_forecast, fmt(S.alert_forecast_info, { error: err || "-" }), R.indoor_peak]);
      const alerts = warn.length
        ? `<div class="alerts chips">${warn.map(([k, w, t, id]) => this._chip(k === "" ? "info" : "waarschuwing", w, plain(t).split(":")[0], { toon: k, info: t, entity: id })).join("")}</div>`
        : "";

      const bandTxt = fmt(S.comfort_band, { low: this._nf(c.low), high: this._nf(c.high) });
      const band = !Number.isFinite(tIn)
        ? ""
        : tIn > c.high
          ? this._chip("op", S.too_warm, S.too_warm_label, { toon: "warn", info: `${fmt(S.too_warm_info, { t: this._nf(tIn) })} ${bandTxt}` })
          : tIn < c.low
            ? this._chip("neer", S.too_cold, S.too_cold_label, { toon: "warn", info: `${fmt(S.too_cold_info, { t: this._nf(tIn) })} ${bandTxt}` })
            : this._chip("vink", S.comfortable, S.comfortable_label, { toon: "goed", info: `${fmt(S.indoor_info, { t: this._nf(tIn) })} ${bandTxt}` });
      const tOut = Number.isFinite(this._n(R.outdoor)) ? this._n(R.outdoor) : parseFloat(this._a(R.weather, "temperature"));
      const hum = this._n(R.indoor_humidity);
      const hOut = this._n(R.ventilation_outdoor_humidity);
      const wIcon = window.cwWeerIcoon?.(this._s(R.weather), this._s(R.sun) === "below_horizon") || "boom";
      const wName = window.cwWeerNaam?.(this._s(R.weather)) || "";
      const stats = [
        this._fu(tOut, 1, "°") &&
          this._chip(wIcon, this._fu(tOut, 1, "°"), S.outdoor, {
            info: wName ? fmt(S.outdoor_info_weather, { t: this._fu(tOut, 1, "°"), w: wName }) : fmt(S.outdoor_info, { t: this._fu(tOut, 1, "°") }),
            entity: R.outdoor || R.weather,
          }),
        this._fu(hum, 0, " %") &&
          this._chip("druppel", this._fu(hum, 0, " %"), S.humidity_in, { bij: "huisje", ic: "var(--water)", info: fmt(S.humidity_in_info, { h: this._fu(hum, 0, " %") }), entity: R.indoor_humidity }),
        this._fu(hOut, 0, " %") &&
          this._chip("druppel", this._fu(hOut, 0, " %"), S.humidity_out, { bij: "boom", ic: "var(--water)", info: fmt(S.humidity_out_info, { h: this._fu(hOut, 0, " %") }), entity: R.ventilation_outdoor_humidity }),
      ]
        .filter(Boolean)
        .join("");
      const target = this._nf(this._cfg.target);
      const hero = `<section class="card hero">
        ${
          Number.isFinite(tIn)
            ? `<div class="big"><b>${this._nf(tIn)}°</b><span class="chips">${this._chip("vlag", `${target}°`, S.target_label, { info: `${fmt(S.target_info, { t: target })} ${bandTxt}` })}${band}</span></div>`
            : `<div class="status">${this._chip("waarschuwing", S.indoor, S.not_measured, { toon: "warn", info: S.indoor_not_measured, entity: R.indoor })}</div>`
        }
        ${stats ? `<div class="chips">${stats}</div>` : ""}</section>`;

      // Today: kind of day, expected peak, floor mode.
      const day = this._a(R.indoor_peak, "day_type");
      const peakAt = this._a(R.indoor_peak, "peak_hour");
      const peak = this._ok(R.indoor_peak) ? this._fu(this._n(R.indoor_peak), 1, "°") : null;
      const DAYICON = { warm: "zon", cool: "koud", sunny_fresh: "zon", normal: "wolk" };
      const MODEICON = { cooling: "koud", heating: "warm", neutral: "vink" };
      const chips = [
        day && S[`day_${day}`]
          ? this._chip(DAYICON[day] || "wolk", S[`day_${day}_short`], S.day_type, {
              toon: day === "warm" ? "warn" : "",
              ic: day === "cool" ? "var(--water)" : "var(--zon)",
              info: fmt(S.day_info, { day: S[`day_${day}`] }),
              entity: R.indoor_peak,
            })
          : "",
        peak
          ? this._chip("piek", peakAt ? `${peak} ${fmt(S.at_hour, { h: esc(peakAt) })}` : peak, S.indoor_peak, {
              info: peakAt ? fmt(S.peak_info_at, { t: peak, h: esc(peakAt) }) : fmt(S.peak_info, { t: peak }),
              entity: R.indoor_peak,
            })
          : "",
        F.floor && MODES.includes(fl.mode)
          ? this._chip("vloer", this._modeName(fl.mode), S.floor_mode, {
              bij: MODEICON[fl.mode],
              ic: "var(--zon)",
              info: S[`floor_mode_info_${fl.mode}`],
              entity: R.floor_mode,
            })
          : "",
      ].join("");
      const outlook = chips ? this._card(S.today, `<div class="chips">${chips}</div>`) : "";

      // Now: one line per device (icon, name, status chips with a word, value).
      const dev = (id, icon, color, name, stat, value, aria) =>
        `<button class="dev" ${id ? `data-more="${esc(id)}"` : ""} aria-label="${esc(aria)}"><span class="ic" style="color:${color}">${ic(icon)}</span><span class="t"><b>${esc(name)}</b><span class="chips">${stat}</span></span>${value ? `<span class="val">${value}</span>` : ""}</button>`;
      const devices = [];
      if (F.floor || this._has(R.heat_pump_state)) {
        const word = { heating: S.heats, cooling: S.cools, hot_water: S.hot_water_word, idle: S.rests };
        const icon = { heating: "warm", cooling: "koud", hot_water: "warmwater", idle: "pauze" };
        const stat = !fl.known
          ? this._chip("waarschuwing", S.offline, S.alert_floor_offline, { kaal: true, toon: "warn", info: S.alert_floor_offline, entity: fl.zone || R.heat_pump_state })
          : [
              fl.off
                ? this._chip("pauze", S.off_word, S.floor_off_info, { kaal: true, uit: true, info: S.floor_off_info, entity: fl.zone })
                : this._chip(icon[fl.doing], word[fl.doing], S.floor, {
                    kaal: true,
                    ic: fl.doing === "cooling" ? "var(--water)" : fl.doing === "idle" ? "" : "var(--zon)",
                    info: [S[`floor_doing_${fl.doing}`], fl.band].filter(Boolean).join(" "),
                    entity: R.heat_pump_state || fl.zone,
                  }),
              fl.vetoOn
                ? this._chip("klok", S.temporary, S.veto_label, { kaal: true, info: fmt(S.veto_until, { t: this._hhmm(new Date(fl.vetoEnd)) }), entity: fl.zone })
                : "",
            ].join("");
        const flow = this._fu(this._n(R.heat_pump_flow_temperature), 1, "°");
        devices.push(dev(fl.zone || R.heat_pump_state, "floor", "var(--zon)", S.floor, stat, flow, `${S.floor}: ${word[fl.doing]}`));
      }
      if (F.ventilation) {
        const stat = !vt.reachable
          ? this._chip("waarschuwing", S.offline, S.alert_vent_offline, { kaal: true, toon: "warn", info: S.alert_vent_offline, entity: R.ventilation_speed })
          : [
              vt.speedL ? this._chip("ventilator", vt.speedL, S.speed, { kaal: true, info: `${vt.sentence}. ${fmt(S.speed_info, { s: vt.speedL })}`, entity: R.ventilation_speed }) : "",
              Number.isFinite(vt.byp) && vt.byp > 0
                ? this._chip("boom", fmt(S.bypass_pct, { pct: this._nf(vt.byp, 0) }), S.bypass, { kaal: true, info: fmt(S.bypass_info, { pct: this._nf(vt.byp, 0) }), entity: R.ventilation_bypass_state })
                : "",
              vt.cooling ? this._chip("koud", S.cools, S.vent_free_cooling, { kaal: true, ic: "var(--water)", info: S.vent_free_cooling_info, entity: R.ventilation_cooling }) : "",
            ].join("");
        devices.push(dev(R.ventilation_speed || R.ventilation, "fan", "var(--water)", S.ventilation, stat, this._fu(this._n(R.ventilation_power_w), 0, " W"), `${S.ventilation}: ${[vt.speedL, vt.bypTxt].filter(Boolean).join(", ")}`));
      }
      if (F.comfoclime) {
        const stat = !cc.up
          ? this._chip("waarschuwing", S.offline, S.alert_cc_offline, { kaal: true, toon: "warn", info: S.alert_cc_offline, entity: R.comfoclime })
          : [
              cc.mode === "off"
                ? this._chip("pauze", S.off_word, S.cc_off, { kaal: true, uit: true, info: S.cc_off, entity: R.comfoclime })
                : cc.act === "heating"
                  ? this._chip("warm", S.heats, S.cc_heating, { kaal: true, ic: "var(--zon)", info: S.cc_heating, entity: R.comfoclime })
                  : cc.act === "cooling"
                    ? this._chip("koud", S.cools, S.cc_cooling, { kaal: true, ic: "var(--water)", info: S.cc_cooling, entity: R.comfoclime })
                    : this._chip("pauze", S.rests, S.cc_idle, { kaal: true, info: cc.doing, entity: R.comfoclime }),
              cc.mode === "fan_only" ? this._chip("info", S.cc_fan_only_short, S.cc_fan_only, { kaal: true, info: S.cc_fan_only, entity: R.comfoclime }) : "",
              cc.boostUntil ? this._chip("klok", S.boost_word, S.cc_boost, { kaal: true, info: fmt(S.cc_boost_until, { t: this._hhmm(cc.boostUntil) }), entity: R.comfoclime_previous }) : "",
            ].join("");
        devices.push(dev(R.comfoclime, "snow", cc.up ? cc.color : "var(--muted)", S.comfoclime, stat, cc.up ? cc.pTxt : null, `${S.comfoclime}: ${cc.up ? cc.doing : S.offline}`));
      }
      if (F.hot_water) {
        const bt = this._n(R.hot_water_temperature);
        const stat = [
          this._on(R.hot_water_surplus_active) ? this._chip("zon", S.sun_word, S.hw_surplus, { kaal: true, ic: "var(--zon)", info: S.hw_surplus_info, entity: R.hot_water_surplus_active }) : "",
          this._on(R.hot_water_shower_tomorrow) ? this._chip("douche", S.shower_word, S.hw_shower, { kaal: true, info: S.hw_shower_info, entity: R.hot_water_shower_tomorrow }) : "",
        ].join("");
        devices.push(dev(R.hot_water_temperature, "boiler", "var(--zon)", S.hot_water, stat, this._fu(bt, 0, " °C"), `${S.hot_water} ${this._fu(bt, 0, " °C") || ""}`));
      }
      if (F.shading) {
        const rooms = this._cfg.rooms;
        const closed = rooms.filter((x) => this._s(x.blind) === "closed").length;
        const sunShut = rooms.filter((x) => x.flag && this._on(x.flag)).length;
        const autoOn = this._on(R.shading_automatic);
        const stat = [
          this._ok(R.shading_automatic)
            ? this._chip(autoOn ? "vink" : "pauze", autoOn ? S.auto_word : S.manual_word, S.shading_auto, { kaal: true, uit: !autoOn, info: autoOn ? S.shading_auto_on : S.shading_auto_off, entity: R.shading_automatic })
            : "",
          sunShut ? this._chip("zon", fmt(S.n_closed, { n: sunShut }), S.closed_for_sun, { kaal: true, ic: "var(--zon)", info: fmt(S.n_closed_for_sun, { n: sunShut }) }) : "",
        ].join("");
        devices.push(dev(R.shading_automatic, "blind", "var(--sage)", S.blinds, stat, `${closed}/${rooms.length}`, fmt(S.blinds_closed_aria, { n: closed, total: rooms.length })));
      }
      return `${alerts}<div class="cols">
        <div class="col">${hero}${outlook}</div>
        <div class="col">${this._card(S.now, `<div class="devs">${devices.join("")}</div>`)}</div></div>`;
    }

    _ventControls(vt) {
      const S = this._S;
      const R = this._r;
      const v = this._v;
      const speeds = [v.away, v.low, v.medium, v.high].map((x) => ({ v: x, l: vt.speedName[x] || x }));
      const opts = this._a(R.ventilation_speed, "options");
      const shown = Array.isArray(opts) ? speeds.filter((o) => opts.includes(o.v)) : speeds;
      const boosts = [
        [R.ventilation_boost_15, S.boost_15],
        [R.ventilation_boost_60, S.boost_60],
        [R.ventilation_boost_180, S.boost_180],
        [R.ventilation_boost_720, S.boost_720],
        [R.ventilation_boost_off, S.boost_off],
      ];
      const bypass = [
        [R.ventilation_bypass_on, S.bypass_on_1h],
        [R.ventilation_bypass_on_12h, S.bypass_on_12h],
        [R.ventilation_bypass_off, S.bypass_off_1h],
        [R.ventilation_bypass_auto, S.bypass_auto],
      ];
      const bTiles = boosts.map(([id, l]) => this._pressTile(id, l)).join("");
      const pTiles = bypass.map(([id, l]) => this._pressTile(id, l)).join("");
      return `
        <div class="lead"><span class="ic" style="color:var(--water)">${ic("fan")}</span><span class="t"><b class="status">${esc(vt.sentence)}</b>${vt.bypTxt ? `<small class="muted">${esc(vt.bypTxt)}</small>` : ""}</span></div>
        ${this._ok(R.ventilation_speed) ? `${this._head(S.speed)}${this._seg("sel", shown, vt.speed, S.speed, `data-entity="${esc(R.ventilation_speed)}"`, "big")}` : ""}
        ${bTiles ? `${this._head(S.boost)}<div class="tiles">${bTiles}</div>` : ""}
        ${pTiles ? `${this._head(S.bypass, S.bypass_sub)}<div class="tiles">${pTiles}</div>` : ""}
        <div class="tiles">${this._togTile(R.ventilation_auto, S.vent_auto, S.vent_auto_sub)}${this._togTile(R.ventilation_away, S.vent_away_toggle, S.vent_away_sub)}</div>`;
    }
    _ccControls(cc) {
      const S = this._S;
      const id = this._r.comfoclime;
      if (!cc.up)
        return `<div class="off" aria-disabled="true"><span class="ic">${ic("snow", 20)}</span><span class="t"><b>${esc(S.cc_offline_title)}</b><small>${esc(S.cc_offline_sub)}</small></span></div>`;
      const all = [
        { v: "off", l: S.cc_mode_off },
        { v: "fan_only", l: S.cc_mode_fan_only },
        { v: "heat", l: S.cc_mode_heat },
        { v: "cool", l: S.cc_mode_cool },
      ];
      const av = this._a(id, "hvac_modes");
      const modes = Array.isArray(av) ? all.filter((m) => av.includes(m.v)) : all;
      const pav = this._a(id, "preset_modes");
      const presets = Array.isArray(pav)
        ? pav.map((p) => ({ v: p, l: S[`cc_preset_${p}`] || p }))
        : [];
      const sentence = cc.pTxt ? `${cc.doing} · ${cc.pTxt}` : cc.doing;
      return `
        <button class="item" data-more="${esc(id)}"><span class="ic" style="color:${cc.color}">${ic("snow")}</span><span class="t"><b class="status">${esc(sentence)}</b>${cc.boostUntil ? `<small class="muted">${esc(fmt(S.cc_boost_until, { t: this._hhmm(cc.boostUntil) }))}</small>` : ""}</span></button>
        ${this._head(S.mode)}${this._seg("cc-mode", modes, cc.mode, S.comfoclime, "", "big")}
        ${cc.hasT ? this._stepRow(S.target_temperature, cc.mode === "cool" ? S.cc_target_cool : S.cc_target_heat, `${this._nf(cc.target)}°`, "cc-temp", "", 0.5) : ""}
        ${cc.mode !== "off" && presets.length ? `${this._head(S.preset)}${this._seg("cc-preset", presets, this._a(id, "preset_mode"), S.preset)}` : ""}`;
    }
    _floorModeSeg(fl) {
      const S = this._S;
      const opts = MODES.filter((m) => m !== "cooling" || this._f.floor_cooling).map((m) => ({ v: m, l: this._modeName(m) }));
      return this._ok(this._r.floor_mode)
        ? `${this._head(S.floor_mode, S.floor_mode_sub)}${this._seg("sel", opts, fl.mode, S.floor_mode, `data-entity="${esc(this._r.floor_mode)}"`, "big")}`
        : "";
    }

    _tabControls(ctx) {
      const { tIn, fl, vt, cc } = ctx;
      const S = this._S;
      const R = this._r;
      const F = this._f;
      const left = [];
      const right = [];
      if (F.ventilation) left.push(this._card(S.ventilation, this._ventControls(vt)));
      if (F.comfoclime) left.push(this._card(S.comfoclime, this._ccControls(cc)));
      if (F.floor) {
        if (this._veto.t == null) this._veto.t = Number.isFinite(tIn) ? Math.round(tIn * 2) / 2 : this._cfg.target;
        const vetoOk = this._has(R.quick_veto);
        const veto = vetoOk
          ? `${this._head(S.veto_title, S.veto_sub)}
          ${this._stepRow(S.temperature, "", `${this._nf(this._veto.t)}°`, "veto-t", "", 0.5)}
          ${this._seg("veto-h", VETO_HOURS.map((h) => ({ v: String(h), l: fmt(S.hours_short, { h }) })), String(this._veto.h), S.duration)}
          <div class="tiles"><button class="tile" data-act="veto-start"><b>${esc(fmt(S.veto_start, { h: this._veto.h }))}</b></button>${fl.vetoOn ? `<button class="tile on" data-act="veto-stop"><b>${esc(S.veto_stop)}</b></button>` : ""}</div>`
          : "";
        const status = [fl.band, fl.vetoOn ? fmt(S.veto_until, { t: this._hhmm(new Date(fl.vetoEnd)) }) : null].filter(Boolean).join(" · ");
        right.push(
          this._card(
            S.floor,
            `<button class="item" ${fl.zone ? `data-more="${esc(fl.zone)}"` : ""}><span class="ic" style="color:var(--zon)">${ic("floor")}</span><span class="t"><b class="status">${esc(S[`floor_doing_${fl.doing}`])}</b>${status ? `<small class="muted">${esc(status)}</small>` : ""}</span></button>
            ${this._floorModeSeg(fl)}
            <div class="tiles">${this._togTile(R.floor_auto, S.floor_auto, S.floor_auto_sub)}</div>
            ${veto}`,
          ),
        );
      }
      if (F.hot_water) {
        const bt = this._n(R.hot_water_temperature);
        right.push(
          this._card(
            S.hot_water,
            `<div class="lead"><span class="ic" style="color:var(--zon)">${ic("boiler")}</span><span class="t"><b class="status">${esc(Number.isFinite(bt) ? fmt(S.hw_in_tank, { t: this._nf(bt, 0) }) : S.not_measured)}</b></span></div>
            <div class="tiles">${this._togTile(R.hot_water_shower_tomorrow, S.hw_shower, S.hw_shower_sub)}</div>`,
          ),
        );
      }
      if (F.shading) {
        const rooms = this._cfg.rooms
          .map((x) => {
            const st = x.flag && this._on(x.flag)
              ? S.room_closed_sun
              : x.manual && this._on(x.manual)
                ? S.room_manual
                : { open: S.cover_open, closed: S.cover_closed, opening: S.cover_opening, closing: S.cover_closing }[this._s(x.blind)] || S.cover_unknown;
            return `<div class="shade"><span class="t"><b>${esc(x.name)}</b><small class="muted">${esc(st)}</small></span>
            <div class="tiles t3"><button class="tile" data-act="cover" data-entity="${esc(x.blind)}" data-v="open"><b>${esc(S.open)}</b></button><button class="tile" data-act="cover" data-entity="${esc(x.blind)}" data-v="close"><b>${esc(S.close)}</b></button>${x.manual ? this._togTile(x.manual, S.hold, "") : ""}</div></div>`;
          })
          .join("");
        right.push(this._card(S.blinds, rooms));
      }
      return `<div class="cols"><div class="col">${left.join("")}</div><div class="col">${right.join("")}</div></div>`;
    }

    _tabSmart(ctx) {
      const { tIn, fl, vt, cc } = ctx;
      const S = this._S;
      const R = this._r;
      const F = this._f;
      const L = this._cfg.loud_hours;
      const left = [];
      const right = [];
      if (F.ventilation_cooling) {
        const from = this._fu(this._n(R.ventilation_cooling_from), 1, "°");
        const now = !this._ok(R.ventilation_cooling)
          ? null
          : !vt.coolOn
            ? S.is_off
            : [S[`vstate_${vt.state}_info`] || vt.state, vt.bypTxt].filter(Boolean).join(" · ");
        left.push(
          this._auto(
            R.ventilation_cooling,
            S.smart_cooling,
            fmt(S.smart_cooling_rule, { from: from || "-", start: L.start, end: L.end }),
            esc(now || ""),
            `${this._num(R.ventilation_cooling_from, S.cooling_from, S.cooling_from_sub)}
            <div class="rows">${this._rowIf(S.indoor, this._fu(tIn, 1, "°"))}${this._rowIf(S.outdoor_vent, this._fu(vt.tOut, 1, "°"))}${this._rowIf(S.speed, vt.speedL ? esc(vt.speedL) : null)}${this._rowIf(S.loud_hours, `${esc(L.start)}–${esc(L.end)}`)}</div>`,
          ),
        );
      }
      if (F.floor) {
        const dm = (this._a(R.weather_days, "day_max") || []).slice(0, 4);
        const days = this._a(R.weather_days, "days") || [];
        const advice = this._a(R.indoor_peak, "floor_advice");
        const since = Number.isFinite(fl.days) ? fmt(S.days_in_mode, { d: this._nf(fl.days, 1) }) : null;
        const dayRows = dm
          .map((t, i) => {
            const d = days[i] ? new Date(days[i]) : null;
            const name = i === 0 ? S.today : d && !isNaN(d) ? d.toLocaleDateString(this._loc, { weekday: "long" }) : `+${i}`;
            return this._rowIf(esc(name), this._fu(parseFloat(t), 0, "°"));
          })
          .join("");
        left.push(
          this._auto(
            R.floor_auto,
            S.floor_coming_days,
            fmt(S.floor_rule, {
              warm: this._fu(this._n(R.floor_cooling_from), 1, "°") || "-",
              cool: this._fu(this._n(R.floor_heating_below), 1, "°") || "-",
            }),
            esc([MODES.includes(fl.mode) ? this._modeName(fl.mode) : null, since].filter(Boolean).join(" · ")),
            `<div class="rows">${this._rowIf(S.advice_forecast, advice ? esc(this._modeName(advice)) : null)}${dayRows}${this._rowIf(S.floor_band_now, fl.band ? esc(fl.band) : null)}</div>`,
          ),
        );
      }
      if (F.comfoclime_boost) {
        const b = this._cfg.boost;
        const now = !cc.up
          ? S.cc_offline_title
          : cc.boostUntil
            ? fmt(S.cc_boost_until, { t: this._hhmm(cc.boostUntil) })
            : fmt(S.cc_boost_waiting, { t: this._nf(b.below) });
        left.push(
          this._auto(
            null,
            S.cc_boost,
            fmt(S.cc_boost_rule, { below: this._nf(b.below), hours: this._nf(b.hours, 0) }),
            esc(now),
            this._has(R.comfoclime_writes) ? this._tog(R.comfoclime_writes, S.cc_writes, S.cc_writes_sub) : "",
          ),
        );
      }
      if (F.season_profile) {
        const season = this._on(R.ventilation_season_heating)
          ? S.season_heating
          : this._on(R.ventilation_season_cooling)
            ? S.season_cooling
            : this._ok(R.ventilation_season_heating)
              ? S.season_between
              : null;
        const prof = this._ok(R.ventilation_profile) ? this._s(R.ventilation_profile) : null;
        right.push(
          this._auto(
            null,
            S.season_profile,
            fmt(S.season_profile_rule, { heating: this._v.profile_heating, cooling: this._v.profile_cooling }),
            esc([prof ? fmt(S.profile_now, { p: prof }) : null, season].filter(Boolean).join(" · ")),
          ),
        );
      }
      if (F.shading_sun) {
        const shut = this._cfg.rooms.filter((x) => x.flag && this._on(x.flag)).map((x) => x.name);
        const held = this._cfg.rooms.filter((x) => x.manual && this._on(x.manual)).map((x) => x.name);
        right.push(
          this._auto(
            R.shading_automatic,
            S.shading,
            S.shading_rule,
            esc(
              this._ok(R.shading_automatic) && !this._on(R.shading_automatic)
                ? S.is_off
                : [shut.length ? fmt(S.shut_rooms, { rooms: shut.join(", ") }) : S.none_shut, held.length ? fmt(S.held_rooms, { rooms: held.join(", ") }) : null]
                    .filter(Boolean)
                    .join(" · "),
            ),
          ),
        );
      }
      return `<div class="cols"><div class="col">${left.join("")}</div><div class="col">${right.join("")}</div></div>`;
    }

    _tabSettings(ctx) {
      const { fl, cc } = ctx;
      const S = this._S;
      const R = this._r;
      const F = this._f;
      const left = [];
      const right = [];
      if (F.floor) {
        const bands = MODES.filter((m) => m !== "cooling" || F.floor_cooling)
          .map(
            (m) =>
              `${this._sub(this._modeName(m))}${this._num(R[`floor_${m}_low`], S.band_low, S.band_low_sub)}${F.floor_cooling ? this._num(R[`floor_${m}_high`], S.band_high, S.band_high_sub) : ""}`,
          )
          .join("");
        left.push(
          this._grp(
            "floor",
            S.floor,
            S.floor_settings_sub,
            `${this._tog(R.floor_auto, S.floor_auto, S.floor_auto_sub)}
            ${this._floorModeSeg(fl)}
            ${F.floor_cooling ? this._num(R.floor_cooling_from, S.floor_cooling_from, S.floor_cooling_from_sub) : ""}
            ${this._num(R.floor_heating_below, S.floor_heating_below, S.floor_heating_below_sub)}
            ${bands}`,
          ),
        );
      }
      if (F.ventilation) {
        const v = this._v;
        const profiles = { [v.profile_heating]: S.profile_normal, [v.profile_cooling]: S.profile_cool, [v.profile_warm]: S.profile_warm };
        left.push(
          this._grp(
            "vent",
            S.ventilation,
            S.vent_settings_sub,
            `${this._tog(R.ventilation_cooling, S.smart_cooling, fmt(S.smart_cooling_sub, { start: this._cfg.loud_hours.start, end: this._cfg.loud_hours.end }))}
            ${this._num(R.ventilation_cooling_from, S.cooling_from, S.cooling_from_sub)}
            ${this._selSeg(R.ventilation_profile, profiles, S.temperature_profile, F.season_profile ? S.temperature_profile_auto : "")}`,
          ),
        );
      }
      if (F.comfoclime)
        right.push(
          this._grp(
            "cc",
            S.comfoclime,
            S.cc_settings_sub,
            `${this._has(R.comfoclime_writes) ? this._tog(R.comfoclime_writes, S.cc_writes, S.cc_writes_sub) : ""}${this._ccControls(cc)}`,
          ),
        );
      if (F.shading_sun)
        right.push(
          this._grp(
            "shading",
            S.shading,
            S.shading_settings_sub,
            `${this._tog(R.shading_automatic, S.shading_auto, "")}
            ${this._num(R.shading_indoor_warm, S.shading_indoor_warm, "")}
            ${this._num(R.shading_outdoor_warm, S.shading_outdoor_warm, "")}
            ${this._num(R.shading_max_cloud, S.shading_max_cloud, S.shading_max_cloud_sub, " %")}`,
          ),
        );
      return `<div class="cols"><div class="col">${left.join("")}</div><div class="col">${right.join("")}</div></div>`;
    }

    _tabDetails(ctx) {
      const { fl } = ctx;
      const S = this._S;
      const R = this._r;
      const F = this._f;
      const r = (k, v, c) => this._rowIf(esc(k), v, c);
      const t = (id) => this._fu(this._n(id), 1, "°");
      const rows = (body) => (body.trim() ? `<div class="rows">${body}</div>` : `<small class="muted">${esc(S.no_measurements)}</small>`);
      const left = [];
      const right = [];
      if (F.floor || this._has(R.heat_pump_state)) {
        const hp = this._s(R.heat_pump_state);
        left.push(
          this._card(
            S.heat_pump,
            rows(`
            ${r(S.state, hp && S[`hp_${hp}`] ? esc(S[`hp_${hp}`]) : null)}
            ${r(S.power_estimated, this._fu(this._n(R.heat_pump_power), 0, " W"))}
            ${r(S.flow_temperature, t(R.heat_pump_flow_temperature))}
            ${r(S.water_pressure, this._fu(this._n(R.heat_pump_water_pressure), 1, " bar"))}
            ${this._ok(R.heat_pump_fault) ? r(S.faults, this._on(R.heat_pump_fault) ? esc(S.yes_word) : esc(S.none), this._on(R.heat_pump_fault) ? "var(--red)" : null) : ""}
            ${r(S.zone_temperature, this._fu(parseFloat(this._a(fl.zone, "current_temperature")), 1, "°"))}
            ${r(S.floor_band_now, fl.band ? esc(fl.band) : null)}`),
          ),
        );
      }
      if (F.ventilation) {
        const fd = this._n(R.ventilation_filter_days);
        const season = this._on(R.ventilation_season_heating)
          ? S.season_heating
          : this._on(R.ventilation_season_cooling)
            ? S.season_cooling
            : this._ok(R.ventilation_season_heating)
              ? S.season_between
              : null;
        left.push(
          this._card(
            S.ventilation,
            rows(`
            ${r(S.bypass, this._fu(this._n(R.ventilation_bypass_state), 0, " %"))}
            ${r(S.outdoor_vent, t(R.ventilation_outdoor_temperature))}
            ${r(S.air_in, t(R.ventilation_supply_temperature))}
            ${r(S.air_out_house, t(R.ventilation_extract_temperature))}
            ${r(S.humidity_out, this._fu(this._n(R.ventilation_outdoor_humidity), 0, " %"))}
            ${r(S.humidity_house, this._fu(this._n(R.ventilation_extract_humidity), 0, " %"))}
            ${r(S.fan_power, this._fu(this._n(R.ventilation_power_w), 0, " W"))}
            ${r(S.season_vent, season ? esc(season) : null)}
            ${r(S.filter_in, Number.isFinite(fd) ? esc(fmt(S.n_days, { n: this._nf(fd, 0) })) : null, fd < 14 ? "var(--amber)" : null)}
            ${r(S.cooling_state, this._ok(R.ventilation_state) ? esc(S[`vstate_${this._s(R.ventilation_state)}`] || this._s(R.ventilation_state)) : null)}`),
          ),
        );
      }
      const P = R.indoor_peak;
      const mm = this._a(P, "morning_model") || {};
      const terms = (this._a(P, "terms") || []).map((x) => S[`term_${x}`] || x).join(", ");
      right.push(
        this._card(
          S.forecast_model,
          `${rows(`
          ${r(S.indoor_peak, this._ok(P) ? this._fu(this._n(P), 1, "°") : null)}
          ${r(S.rise, this._fu(parseFloat(this._a(P, "rise")), 1, "°"))}
          ${F.solar ? r(S.solar_left, this._fu(parseFloat(this._a(P, "solar_rest_kwh")), 1, " kWh")) : ""}
          ${r(S.model_terms, terms ? esc(terms) : null)}
          ${r("a", this._nf(parseFloat(this._a(P, "a")), 2))}
          ${F.solar ? r(S.k_per_kwh, this._nf(parseFloat(this._a(P, "k_per_kwh")), 3)) : ""}
          ${r(S.b_outdoor, this._nf(parseFloat(this._a(P, "b_outdoor")), 3))}
          ${r(S.days_learned, this._nf(parseFloat(this._a(P, "days")), 0))}
          ${r(S.morning_error, this._fu(parseFloat(mm.rmse), 2, "°"))}
          ${r(S.error, this._a(P, "error") ? esc(this._a(P, "error")) : null, "var(--amber)")}`)}
          <small class="muted">${esc(S.forecast_model_note)}</small>`,
        ),
      );
      const W = R.weather_days;
      const dmax = this._a(W, "day_max") || [];
      const dmin = this._a(W, "day_min") || [];
      const ddays = this._a(W, "days") || [];
      const wrows = dmax
        .map((mx, i) => {
          const d = ddays[i] ? new Date(ddays[i]) : null;
          const name = i === 0 ? S.today : d && !isNaN(d) ? d.toLocaleDateString(this._loc, { weekday: "long", day: "numeric" }) : `+${i}`;
          const lo = this._nf(parseFloat(dmin[i]), 0);
          const hi = this._nf(parseFloat(mx), 0);
          return hi == null ? "" : this._row(esc(name), lo != null ? `${lo}° – ${hi}°` : `${hi}°`);
        })
        .join("");
      right.push(this._card(S.coming_days, rows(wrows)));
      return `<div class="cols"><div class="col">${left.join("")}</div><div class="col">${right.join("")}</div></div>`;
    }

    _render() {
      if (!this._hass || !this._cfg || !this.shadowRoot) return;
      this._lastRender = Date.now();
      const tIn = this._n(this._r.indoor);
      const ctx = { tIn, fl: this._floorInfo(), vt: this._ventInfo(tIn), cc: this._ccInfo() };
      const tab = this._tab;
      const body =
        tab === "controls"
          ? this._tabControls(ctx)
          : tab === "smart"
            ? this._tabSmart(ctx)
            : tab === "settings"
              ? this._tabSettings(ctx)
              : tab === "details"
                ? this._tabDetails(ctx)
                : this._tabStatus(ctx);
      const tabs = TABS.map(
        (t) =>
          `<button class="tab ${t === tab ? "on" : ""}" role="tab" aria-selected="${t === tab}" data-act="tab" data-v="${t}">${esc(this._S[`tab_${t}`])}</button>`,
      ).join("");
      const wrap = this._wrap();
      const cls = `wrap ${this._dark() ? "dark" : "light"}`;
      if (wrap.className !== cls) wrap.className = cls;
      wrap.innerHTML = `
  <cw-kop titel="${esc(this._S.title)}">${esc(this._S.title)}</cw-kop>
  <nav class="tabs" role="tablist" aria-label="${esc(this._S.title)}">${tabs}</nav>
  <div class="body">${body}</div>`;
    }

    _onClick(ev) {
      const el = ev.composedPath().find((n) => n.dataset && (n.dataset.act || n.dataset.more));
      if (!el) return;
      const { act, entity, more } = el.dataset;
      const d = parseFloat(el.dataset.d);
      if (more) {
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: more }, bubbles: true, composed: true }));
        return;
      }
      if (act === "tab") {
        this._tab = el.dataset.v;
        try {
          localStorage.setItem(TAB_KEY, this._tab);
        } catch (e) {
          /* private mode */
        }
        this._render();
        return;
      }
      if (act === "grp") {
        const k = el.dataset.v;
        if (this._open.has(k)) this._open.delete(k);
        else this._open.add(k);
        try {
          localStorage.setItem(OPEN_KEY, JSON.stringify([...this._open]));
        } catch (e) {
          /* private mode */
        }
        this._render();
        return;
      }
      if (act) this._fastUntil = Date.now() + FAST_MS;
      const call = (dom, s, data) => this._hass.callService(dom, s, data);
      const cc = this._r.comfoclime;
      if (act === "toggle") call("homeassistant", "toggle", { entity_id: entity });
      else if (act === "press") call("button", "press", { entity_id: entity });
      else if (act === "sel") call(entity.split(".")[0], "select_option", { entity_id: entity, option: el.dataset.v });
      else if (act === "cover") call("cover", el.dataset.v === "open" ? "open_cover" : "close_cover", { entity_id: entity });
      else if (act === "num") {
        const cur = this._n(entity);
        if (!Number.isFinite(cur)) return;
        const min = parseFloat(this._a(entity, "min"));
        const max = parseFloat(this._a(entity, "max"));
        let v = Math.round((cur + d) * 100) / 100;
        if (Number.isFinite(min)) v = Math.max(min, v);
        if (Number.isFinite(max)) v = Math.min(max, v);
        call(entity.split(".")[0], "set_value", { entity_id: entity, value: v });
      } else if (act === "cc-mode") call("climate", "set_hvac_mode", { entity_id: cc, hvac_mode: el.dataset.v });
      else if (act === "cc-preset") call("climate", "set_preset_mode", { entity_id: cc, preset_mode: el.dataset.v });
      else if (act === "cc-temp") {
        const t = parseFloat(this._a(cc, "temperature"));
        if (!Number.isFinite(t)) return;
        const min = parseFloat(this._a(cc, "min_temp"));
        const max = parseFloat(this._a(cc, "max_temp"));
        let v = Math.round((t + d) * 2) / 2;
        if (Number.isFinite(min)) v = Math.max(min, v);
        if (Number.isFinite(max)) v = Math.min(max, v);
        call("climate", "set_temperature", { entity_id: cc, temperature: v });
      } else if (act === "veto-t") {
        this._veto.t = Math.min(30, Math.max(5, this._veto.t + d));
        this._render();
      } else if (act === "veto-h") {
        this._veto.h = parseFloat(el.dataset.v);
        this._render();
      } else if (act === "veto-start" || act === "veto-stop") {
        // Quick veto through the heat-pump capability (script.heat_pump_quick_veto); hours 0 cancels it.
        const [dom, name] = this._r.quick_veto.split(".");
        call(dom, name, {
          temperature: this._veto.t,
          hours: act === "veto-stop" ? 0 : this._veto.h,
          reason: this._S.veto_reason,
        });
      }
    }
  }

  // Organic palette: surfaces and status colours from the theme's --cw-* tokens (module base; fallbacks = Organic).
  const CSS = `
:host { display: block; }
* { box-sizing: border-box; }
.wrap.dark { --bg: var(--cw-bg, #1d1a17); --card: var(--cw-card, #2a2622); --tile: var(--cw-bg, #1d1a17); --raised: var(--cw-raised, #3a3530); --line: var(--cw-raised, #3a3530); --dash: var(--cw-line, #4a433c); --text: var(--cw-text, #F5EAD8); --muted: var(--cw-muted, #BFB3A1); --accent: var(--cw-accent, #C67139); --on-accent: var(--cw-on-accent, #1d1a17); --tile-on: #3a2f25; --sage: #9CAE7E; --zon: var(--cw-zon, #E8A571); --water: var(--cw-water, #8FB8C9); --amber: var(--cw-warn, #E8B04A); --red: var(--cw-bad, #E36B5A); --good-bg: #2a3326; }
.wrap.light { --bg: var(--cw-bg, #F5EAD8); --card: var(--cw-card, #EBDDC5); --tile: var(--cw-bg, #F5EAD8); --raised: var(--cw-line, #D8C6A8); --line: var(--cw-line, #D8C6A8); --dash: #C4AF8C; --text: var(--cw-text, #201E1D); --muted: var(--cw-muted, #645C50); --accent: var(--cw-accent, #C67139); --on-accent: var(--cw-on-accent, #201E1D); --tile-on: #F2D5BC; --sage: #5E6E45; --zon: #9E4F1C; --water: #3A6A7E; --amber: var(--cw-warn, #7E5409); --red: var(--cw-bad, #A63B28); --good-bg: #DFE4CF; }
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; text-align: left; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.wrap { font-family: Figtree, system-ui, sans-serif; color: var(--text); background: var(--bg); min-height: calc(100vh - var(--header-height, 56px)); padding: 20px 16px 32px; overflow-x: hidden; }
.muted { color: var(--muted); }
small { font-size: 13px; line-height: 1.35; }
.tabs, .body, .alerts { max-width: 1100px; margin-left: auto; margin-right: auto; }
cw-kop { display: block; max-width: 1100px; margin: 0 auto 12px; }
cw-kop:not(:defined) { min-height: 56px; font: 28px/56px Caprasimo, Georgia, serif; }
.tabs { display: flex; gap: 4px; padding: 4px; background: var(--card); border-radius: 99px; margin-bottom: 16px; }
.tab { flex: 1 1 auto; min-width: 0; height: 44px; padding: 0 clamp(4px, 1.8vw, 16px); border-radius: 99px; color: var(--muted); font-size: clamp(12.5px, 3.5vw, 15px); font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab.on { background: var(--accent); color: var(--on-accent); }
.cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
@media (min-width: 900px) { .cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.card { background: var(--card); border-radius: 24px; padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
h2.lbl { margin: 0; font-weight: 700; }
.lbl { display: flex; justify-content: space-between; font-size: 15px; color: var(--muted); }
.lbl.sub { font-size: 14px; margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--line); font-weight: 700; letter-spacing: .02em; }
.status { font-size: 17px; font-weight: 700; color: var(--text); }
.lead { display: flex; align-items: center; gap: 12px; }
.hero { gap: 16px; }
.big { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.big > b { font-size: 48px; line-height: 1; font-weight: 700; letter-spacing: -.02em; }
.alerts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dev .chips { gap: 0; margin-top: 2px; }
.devs { display: flex; flex-direction: column; gap: 8px; }
.dev, .item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--tile); border-radius: 18px; width: 100%; min-height: 56px; min-width: 0; }
.dev .val { flex: none; font-weight: 700; font-size: 16px; margin-left: auto; }
.ic { width: 28px; display: flex; justify-content: center; flex: none; }
.t { display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0; }
.t b { font-size: 16px; }
.set-h { margin-bottom: -4px; }
.set-h b { font-size: 15px; }
.seg { display: grid; gap: 6px; padding: 4px; border-radius: 22px; background: var(--tile); }
.seg button { min-height: 44px; padding: 4px 6px; border-radius: 18px; color: var(--muted); font-size: 15px; font-weight: 600; text-align: center; line-height: 1.15; }
.seg.big button { min-height: 52px; font-size: 16px; }
.seg button.on { background: var(--accent); color: var(--on-accent); font-weight: 700; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.tiles.t3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.tiles:empty { display: none; }
.tile { min-height: 56px; padding: 10px 12px; border-radius: 18px; background: var(--tile); display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; text-align: left; }
.tile b { font-size: 15px; font-weight: 700; }
.tile small { color: var(--muted); font-size: 12.5px; }
.tile.on { background: var(--tile-on); color: var(--text); }
.tile.tog { justify-content: flex-start; }
.tile.tog .tl { display: flex; flex-direction: column-reverse; align-items: flex-start; gap: 8px; min-width: 0; }
.set { display: flex; align-items: center; gap: 12px; padding: 6px 6px 6px 14px; background: var(--tile); border-radius: 18px; }
.mini { display: flex; align-items: center; gap: 6px; flex: none; margin-left: auto; }
.mini output { min-width: 64px; text-align: center; font-weight: 700; font-size: 16px; }
.round { width: 44px; height: 44px; border-radius: 99px; background: var(--card); display: flex; align-items: center; justify-content: center; flex: none; }
.tgl { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--tile); border-radius: 18px; width: 100%; min-height: 44px; }
.switch { width: 52px; height: 30px; border-radius: 99px; background: var(--raised); position: relative; flex: none; display: inline-block; }
.switch i { position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 99px; background: var(--muted); transition: left .15s; }
.switch.on { background: var(--accent); }
.switch.on i { left: 25px; background: var(--on-accent); }
.switch.sm { width: 36px; height: 22px; }
.switch.sm i { width: 16px; height: 16px; }
.switch.sm.on i { left: 17px; }
.rows { display: flex; flex-direction: column; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 2px; border-top: 1px solid var(--line); font-size: 15px; }
.rows > .row:first-child { border-top: 0; }
.row b { text-align: right; }
.shade { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.shade + .shade { border-top: 1px solid var(--line); padding-top: 12px; }
.auto-h { display: flex; align-items: flex-start; gap: 12px; }
.auto-h .t b { font-size: 17px; }
.sw-btn { min-width: 52px; min-height: 44px; display: flex; align-items: center; justify-content: flex-end; flex: none; }
.now { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 16px; background: var(--tile); font-weight: 600; font-size: 15px; }
.now .dot { width: 10px; height: 10px; border-radius: 99px; background: var(--muted); flex: none; }
.auto.is-on .now .dot { background: var(--sage); }
.grp { padding: 0; gap: 0; }
.grp-h { display: flex; align-items: center; gap: 12px; padding: 16px; width: 100%; min-height: 64px; }
.grp-h .chev { color: var(--muted); transition: transform .15s; display: flex; }
.grp.open .grp-h .chev { transform: rotate(180deg); }
.grp-b { display: flex; flex-direction: column; gap: 12px; padding: 0 16px 16px; }
.off { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px dashed var(--dash); border-radius: 18px; color: var(--muted); cursor: default; }
.off b { font-size: 15px; font-weight: 600; }
@media (max-width: 520px) {
  .wrap { padding: 16px 12px 28px; }
  .mini output { min-width: 56px; font-size: 15px; }
  .set { flex-wrap: wrap; }
  .seg button { font-size: 14px; }
  .big > b { font-size: 42px; }
}
`;

  if (!customElements.get("climate-screen-card")) customElements.define("climate-screen-card", ClimateScreenCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "climate-screen-card",
    name: <@ t('card_name') | tojson @>,
    description: `v${VERSION}`,
  });
})();

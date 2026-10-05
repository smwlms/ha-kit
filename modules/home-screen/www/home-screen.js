// Home screen (ha-kit module home-screen): start dashboard with one status chip or card per installed module.
//   <cw-kop> greeting + date, buttons "choose status row" and "extended view", then the theme button (module base).
//   <cw-status bewaar="home"> chips: indoor, outdoor, gate, blinds, who is home, one per car, doorbell, parcel service,
//     indoor forecast, cameras, media, smart charging, our week. Every HA user picks which chips and their order.
//   tesla-arrival-card of module tesla-route, embedded while a car is on the road (it takes no space otherwise).
//   Cards: energy (live tiles + prices + an advice line only when there is something to do), controls (hot water,
//     own toggles, all blinds / curtains), playing now, to-do; extended view: climate, cars, rooms, what the house does.
// Nothing about the house is built in: every entity id, list, path and text comes from the card config that
// tools/fill.py renders from house.yaml, modules: and the capabilities (lovelace/home.yaml). A block whose feature
// flag is false, or whose entity is missing or has no value, is not drawn (never a bare dash).
// Needs cw-thema.js of module base (cw-kop, cw-status, cw-metric, cw-toggles, cw-chip, window.cwInfoSheet).
(() => {
  // The language is part of the version, so browsers reload the file when house.language changes.
  const VERSION = "1-<@ t('language_code') @>";
  // Re-render at most once per THROTTLE_MS on state changes; after a tap, updates render immediately for FAST_MS.
  const THROTTLE_MS = 5000;
  const FAST_MS = 10000;
  const RING_RECENT_MS = 5 * 60000; // "rings" on the doorbell chip
  const PARCEL_RECENT_MS = 2 * 3600000; // a parcel left at the door counts for 2 h
  const VIEW_KEY = "ha-kit-home-extended";
  const NO_VALUE = new Set([undefined, null, "", "unknown", "unavailable"]);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  // "{who} is home." + {who: "Jan"} -> text; unknown {names} stay as they are.
  const fmt = (text, values = {}) =>
    String(text).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const svg = (body) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const ICON = {
    check: `<path d="M4 4h16v16H4z"/><path d="M8 12.5l3 3 5-6"/>`,
    pause: `<path d="M9 6v12M15 6v12"/>`,
  };
  // Theme tokens of module base (Dutch names, see CONTRIBUTING "Known naming leftovers"), mixed with the text colour
  // so the icons stay readable on the card in light and dark (the light tokens alone are below 3:1 on cream).
  const ink = (token, fallback, share = 60) =>
    `color-mix(in srgb, var(--cw-${token}, ${fallback}) ${share}%, var(--cw-text, var(--primary-text-color, #201E1D)))`;
  const COL = {
    sun: ink("zon", "#E8A571"),
    battery: ink("batterij", "#7F8B64", 75),
    grid: ink("net", "#BB7644", 75),
    house: ink("huis", "#F5C9AE", 45),
  };
  const isoWeek = (d) => {
    const th = new Date(d);
    th.setHours(0, 0, 0, 0);
    th.setDate(th.getDate() + 3 - ((th.getDay() + 6) % 7));
    const jan4 = new Date(th.getFullYear(), 0, 4);
    return 1 + Math.round((th - jan4) / 864e5 / 7 - (3 - ((jan4.getDay() + 6) % 7)) / 7);
  };
  const isoDay = (x) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

  class HomeScreenCard extends HTMLElement {
    setConfig(config) {
      if (!config || typeof config.roles !== "object" || typeof config.strings !== "object")
        throw new Error(
          "home-screen-card: roles and strings are rendered by ha-kit (tools/fill.py): paste home-screen/lovelace/home.yaml",
        );
      this._cfg = {
        features: {},
        people: [],
        cars: [],
        rooms: [],
        phases: [],
        toggles: [],
        media_players: [],
        paths: {},
        comfort: null,
        ...config,
      };
      this._f = this._cfg.features || {};
      this._r = this._cfg.roles || {};
      this._S = this._cfg.strings || {};
      this._loc = this._S.locale || undefined;
      const c = this._cfg;
      // Entities whose change re-renders the card (the arrival card follows its own entities).
      this._watch = [
        ...Object.values(this._r),
        ...c.people.map((p) => p.person),
        ...c.cars.flatMap((x) => [x.battery, x.charging, x.cable, x.location, x.at_home, x.plan]),
        ...c.rooms.flatMap((x) => [x.blind, x.curtain, x.flag]),
        ...c.phases.flatMap((x) => [x.import, x.export]),
        ...c.toggles,
        ...c.media_players,
      ].filter(Boolean);
      try {
        this._camRe = c.cameras ? new RegExp(c.cameras) : null;
      } catch (e) {
        this._camRe = null;
      }
      try {
        this._adv = localStorage.getItem(VIEW_KEY) === "1";
      } catch (e) {
        this._adv = false;
      }
      this._sig = null;
      if (this._hass) this._render();
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
      if (this._arrEl) this._arrEl.hass = hass;
      const sig = [...this._watch, ...this._cameraIds()]
        .map((id) => hass.states[id]?.last_updated)
        .join("|");
      if (sig === this._sig) return;
      this._sig = sig;
      this._schedule();
    }
    connectedCallback() {
      clearInterval(this._clock);
      this._clock = setInterval(() => this._hass && this._render(), 60000);
      if (this._hass && this.shadowRoot && !this._throttle) this._schedule();
    }
    disconnectedCallback() {
      clearInterval(this._clock);
      this._clock = null;
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
    // ---------- small helpers ----------
    t(key, vars) {
      const s = this._S[key];
      if (s === undefined) return key;
      return vars ? fmt(s, vars) : s;
    }
    _st(id) {
      return id ? this._hass.states[id] : undefined;
    }
    _s(id) {
      return this._st(id)?.state;
    }
    _a(id, k) {
      return this._st(id)?.attributes?.[k];
    }
    _ok(id) {
      return !NO_VALUE.has(this._s(id));
    }
    _n(id) {
      const v = parseFloat(this._s(id));
      return Number.isFinite(v) ? v : NaN;
    }
    // Power in kW: W unless the unit says kW (a role may be either).
    _kw(id) {
      const v = this._n(id);
      if (!Number.isFinite(v)) return NaN;
      const u = String(this._a(id, "unit_of_measurement") || "W").toLowerCase();
      return u === "kw" ? v : u === "mw" ? v * 1000 : v / 1000;
    }
    _nf(v, d = 1) {
      return Number.isFinite(v)
        ? v.toLocaleString(this._loc, { minimumFractionDigits: d, maximumFractionDigits: d })
        : "";
    }
    _hhmm(d) {
      return d.toLocaleTimeString(this._loc, { hour: "2-digit", minute: "2-digit" });
    }
    _cents(eur) {
      return this.t("cents", { v: this._nf(eur * 100, 0) });
    }
    _path(key) {
      return this._cfg.paths?.[key] || "";
    }
    _cameraIds() {
      if (!this._camRe || !this._hass) return [];
      const n = Object.keys(this._hass.states).length;
      if (n !== this._camN) {
        this._camN = n;
        this._cams = Object.keys(this._hass.states).filter(
          (id) => id.startsWith("camera.") && this._camRe.test(id),
        );
      }
      return this._cams;
    }
    _coverState(id) {
      const s = this._s(id);
      const map = {
        open: this.t("cover_open"),
        closed: this.t("cover_closed"),
        opening: this.t("cover_opening"),
        closing: this.t("cover_closing"),
        unavailable: this.t("cover_offline"),
      };
      return map[s] || s || this.t("none_yet");
    }
    _level(lvl) {
      return (
        {
          negative: this.t("level_negative"),
          very_cheap: this.t("level_very_cheap"),
          cheap: this.t("level_cheap"),
          normal: this.t("level_normal"),
          expensive: this.t("level_expensive"),
          very_expensive: this.t("level_very_expensive"),
        }[lvl] || this.t("level_unknown")
      );
    }
    // ---------- status row ----------
    _chips() {
      const f = this._f,
        r = this._r,
        c = this._cfg;
      const chips = [];
      const tIn = this._n(r.indoor_temperature);
      if (Number.isFinite(tIn)) {
        const comfort = c.comfort
          ? this.t("chip_indoor_info_comfort", { low: this._nf(c.comfort.low), high: this._nf(c.comfort.high) })
          : "";
        chips.push({ id: "indoor", naam: this.t("chip_indoor_name"), icon: "thermo", value: `${this._nf(tIn)}°`, label: this.t("chip_indoor"), titel: this.t("chip_indoor_name"), info: this.t("chip_indoor_info", { t: this._nf(tIn) }) + comfort, entity: r.indoor_temperature, path: this._path("climate"), pathLabel: this.t("climate") });
      }
      const weather = this._s(r.weather);
      const tOut = r.outdoor_temperature ? this._n(r.outdoor_temperature) : parseFloat(this._a(r.weather, "temperature"));
      if (Number.isFinite(tOut)) {
        const wName = weather ? window.cwWeerNaam?.(weather) : "";
        chips.push({ id: "outdoor", naam: this.t("chip_outdoor_name"), icon: (weather && window.cwWeerIcoon?.(weather, this._s(r.sun) === "below_horizon")) || "thermo", value: `${this._nf(tOut)}°`, label: this.t("chip_outdoor"), titel: this.t("chip_outdoor_name"), info: wName ? this.t("chip_outdoor_info_weather", { t: this._nf(tOut), w: wName }) : this.t("chip_outdoor_info", { t: this._nf(tOut) }), entity: r.weather || r.outdoor_temperature });
      }
      if (f.gate && this._ok(r.gate_open)) {
        const door = this._st(r.gate_open);
        const since = this._hhmm(new Date(door.last_changed));
        if (door.state === "on")
          chips.push({ id: "gate", naam: this.t("chip_gate"), icon: "poort", value: this.t("gate_open"), label: this.t("chip_gate"), tone: "warn", titel: this.t("gate_open_title"), info: this.t("gate_open_since", { time: since }), act: r.gate_close_script ? "gate-close" : "", actLabel: this.t("gate_close"), entity: r.gate_open });
        else
          chips.push({ id: "gate", naam: this.t("chip_gate"), minder: 1, icon: "poort", value: this.t("gate_closed"), label: this.t("chip_gate"), titel: this.t("gate_closed_title"), info: this.t("gate_closed_since", { time: since }), entity: r.gate_open });
      }
      const blinds = c.rooms.filter((x) => x.blind && this._st(x.blind));
      if (f.shading && blinds.length) {
        const open = blinds.filter((x) => ["open", "opening"].includes(this._s(x.blind))).length;
        const n = blinds.length;
        chips.push({ id: "blinds", naam: this.t("blinds"), minder: 2, icon: "rolluik", value: open === n ? this.t("blinds_all_open") : open ? `${open}/${n}` : this.t("blinds_all_closed"), label: open && open < n ? this.t("chip_blinds_open") : this.t("chip_blinds"), titel: this.t("blinds"), info: this.t("blinds_info", { n: open, total: n }), rows: blinds.map((x) => [x.name, this._coverState(x.blind)]), path: this._path("shading"), pathLabel: this.t("blinds") });
      }
      const people = c.people.filter((p) => this._st(p.person));
      if (people.length) {
        const home = people.filter((p) => this._s(p.person) === "home");
        const names = home.map((p) => p.name);
        chips.push({ id: "home", naam: this.t("chip_home_name"), icon: "mensen", value: home.length ? home.map((p) => String(p.name)[0]).join(" · ") : "0", label: this.t("chip_home"), titel: this.t("chip_home_name"), info: !home.length ? this.t("home_nobody") : this.t(home.length > 1 ? "home_many" : "home_one", { who: names.join(", ") }), rows: people.map((p) => [p.name, this._s(p.person) === "home" ? this.t("person_home") : this._s(p.person) === "not_home" ? this.t("person_away") : this._s(p.person)]), path: this._path("presence"), pathLabel: this.t("presence_page") });
      }
      if (f.cars)
        for (const car of c.cars) {
          const soc = this._n(car.battery);
          if (!Number.isFinite(soc)) continue;
          const charging = this._s(car.charging) === "charging";
          const plugged = this._s(car.cable) === "on";
          const v = this._nf(soc, 0);
          chips.push({ id: `car-${car.prefix}`, naam: car.name, icon: charging ? "bliksem" : "auto", value: `${v}%`, label: car.name, tone: charging ? "aan" : "", titel: car.name, info: this.t(charging ? "car_info_charging" : plugged ? "car_info_plugged" : "car_info_unplugged", { soc: v }), entity: car.battery, path: this._path("cars"), pathLabel: this.t("cars_page") });
        }
      if (f.doorbell && this._st(r.doorbell_camera)) {
        const ring = Date.parse(this._s(r.doorbell_button));
        const ago = Number.isFinite(ring) ? Date.now() - ring : Infinity;
        const today = Number.isFinite(ring) && new Date(ring).toDateString() === new Date().toDateString();
        const pkg = Date.parse(this._s(r.doorbell_package));
        const pkgRecent = Number.isFinite(pkg) && Date.now() - pkg < PARCEL_RECENT_MS;
        const value = ago < RING_RECENT_MS ? this.t("doorbell_rings") : today ? this._hhmm(new Date(ring)) : this.t("doorbell_quiet");
        chips.push({ id: "doorbell", naam: this.t("chip_doorbell"), icon: "deurbel", value, label: pkgRecent ? this.t("doorbell_label_parcel") : this.t("doorbell_label_doorbell"), tone: ago < RING_RECENT_MS || pkgRecent ? "warn" : "", act: "doorbell", direct: true, aria: `${this.t("chip_doorbell")}: ${value}` });
      }
      if (f.parcel_service && this._st(r.parcel_expected)) {
        const day = this._parcelDay();
        const d = new Date(`${this._s(r.parcel_expected)}T12:00`);
        const short = `${d.toLocaleDateString(this._loc, { weekday: "short" }).replace(".", "")} ${d.getDate()}`;
        const label = day === "today" ? this.t("parcel_today") : day === "tomorrow" ? this.t("parcel_tomorrow") : this.t("doorbell_label_parcel");
        chips.push({ id: "parcel", naam: this.t("chip_parcel"), icon: "pakje", value: day === "today" ? this.t("parcel_yes") : day ? short : this.t("parcel_off"), label, tone: day === "today" ? "aan" : "", act: "parcel", direct: true, aria: `${this.t("chip_parcel")}: ${day ? this._parcelDayText() : this.t("parcel_off")}` });
      }
      if (f.climate && Number.isFinite(this._n(r.climate_indoor_peak))) {
        const peak = this._n(r.climate_indoor_peak);
        const mode = this._s(r.climate_floor_mode);
        const day = this._dayType(this._a(r.climate_indoor_peak, "day_type"));
        chips.push({ id: "climate", naam: this.t("chip_climate_name"), minder: 3, icon: mode === "heating" ? "warm" : mode === "cooling" ? "koud" : "vloer", value: `${this._nf(peak)}°`, label: this.t("chip_climate"), titel: this.t("chip_climate_name"), info: this.t("climate_info", { t: this._nf(peak), day, floor: this._floorMode(mode) }), entity: r.climate_indoor_peak, path: this._path("climate"), pathLabel: this.t("climate") });
      }
      // Shortcuts (vul): by default they only fill free spots of the last row (lowest vul first).
      if (f.cameras) {
        const cams = this._cameraIds();
        if (cams.length) {
          const live = cams.filter((id) => this._ok(id)).length;
          const aria = this.t("chip_cameras_aria", { live, total: cams.length });
          chips.push({ id: "cameras", naam: this.t("chip_cameras"), vul: 1, icon: "camera", value: `${live}`, label: this.t("chip_cameras"), nav: true, path: this._path("cameras"), info: aria, aria });
        }
      }
      if (f.media && c.media_players.some((id) => this._st(id))) {
        const playing = c.media_players.filter((id) => this._s(id) === "playing").length;
        chips.push({ id: "media", naam: this.t("chip_media"), vul: 2, icon: "luidspreker", value: playing ? `${playing}` : this.t("media_quiet"), label: playing ? this.t("chip_media_playing") : this.t("chip_media"), tone: playing ? "aan" : "", nav: true, path: this._path("media"), info: playing ? this.t("chip_media_aria_playing", { n: playing }) : this.t("chip_media_aria_quiet"), aria: playing ? this.t("chip_media_aria_playing", { n: playing }) : this.t("chip_media_aria_quiet") });
      }
      if (f.presence)
        chips.push({ id: "week", naam: this.t("chip_week"), vul: 3, icon: "kalender", value: `${isoWeek(new Date())}`, label: this.t("chip_week"), nav: true, path: this._path("presence"), aria: this.t("chip_week_aria", { n: isoWeek(new Date()) }) });
      if (f.ev_charging && (this._st(r.ev_charger_power) || this._st(r.ev_charging_smart))) {
        const kw = this._kw(r.ev_charger_power);
        const goal = c.cars.map((x) => Number(this._a(x.plan, "target_percent")) || 0).find((g) => g > 0) || 0;
        const smart = this._s(r.ev_charging_smart) === "on";
        const charging = kw > 0.1;
        const value = charging ? this._nf(kw) : goal ? `${this._nf(goal, 0)}%` : smart ? this.t("charging_on") : this.t("charging_off");
        const label = charging ? this.t("charging_kw") : goal ? this.t("charging_target") : this.t("charging_smart");
        chips.push({ id: "charging", naam: this.t("chip_charging"), vul: 4, icon: "laadpaal", value, label, tone: charging ? "aan" : "", nav: true, path: this._path("charging"), info: this.t("chip_charging_aria", { what: `${value} ${label}` }), aria: this.t("chip_charging_aria", { what: `${value} ${label}` }) });
      }
      return chips;
    }
    _dayType(v) {
      return (
        { cool: this.t("day_type_cool"), sunny_fresh: this.t("day_type_sunny_fresh"), warm: this.t("day_type_warm"), normal: this.t("day_type_normal") }[v] ||
        this.t("none_yet")
      );
    }
    _floorMode(v) {
      return { heating: this.t("floor_heating"), neutral: this.t("floor_neutral"), cooling: this.t("floor_cooling") }[v] || this.t("none_yet");
    }
    // Parcel service: "today", "tomorrow", "later" or "" (no parcel expected / day passed; 2000-01-01 = off).
    _parcelDay() {
      const d = this._s(this._r.parcel_expected);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return "";
      const now = new Date();
      if (d === isoDay(now)) return "today";
      if (d === isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return "tomorrow";
      return d > isoDay(now) ? "later" : "";
    }
    _parcelDayText() {
      const day = this._parcelDay();
      if (day === "today") return this.t("parcel_today");
      if (day === "tomorrow") return this.t("parcel_tomorrow");
      if (!day) return "";
      return new Date(`${this._s(this._r.parcel_expected)}T12:00`).toLocaleDateString(this._loc, { weekday: "short", day: "numeric", month: "short" });
    }
    // ---------- energy card ----------
    _energyCard() {
      const f = this._f,
        r = this._r,
        c = this._cfg;
      if (!f.energy && !f.tariff) return "";
      const ep = this._path("energy");
      const P = ep ? { path: ep, padLabel: this.t("energy") } : {};
      const live = [];
      if (f.energy) {
        const pv = Math.max(this._kw(r.solar_power), 0);
        if (r.solar_power && Number.isFinite(pv))
          live.push({ icon: "zon", color: COL.sun, value: this._nf(pv), label: this.t("solar_kw"), titel: this.t("solar_title"), info: this.t("solar_info", { kw: this._nf(pv) }), entity: r.solar_power, ...P });
        const soc = this._n(r.battery_soc);
        if (Number.isFinite(soc)) {
          let bat = this._kw(r.battery_power);
          if (c.battery_sign === "charge_positive") bat = -bat;
          const what = !Number.isFinite(bat) || Math.abs(bat) <= 0.05 ? this.t("battery_rests") : bat > 0 ? this.t("battery_gives", { kw: this._nf(bat) }) : this.t("battery_charges", { kw: this._nf(-bat) });
          live.push({ icon: "batterij", color: COL.battery, value: `${this._nf(soc, 0)} %`, label: what, titel: this.t("battery_title"), info: this.t("battery_info", { soc: this._nf(soc, 0), what }), entity: r.battery_soc, ...P });
        }
        const imp = this._kw(r.grid_import);
        if (Number.isFinite(imp)) {
          const exp = this._kw(r.grid_export);
          const net = Math.max(imp, 0) - (Number.isFinite(exp) ? Math.max(exp, 0) : 0);
          const dir = net > 0.05 ? "grid_from" : net < -0.05 ? "grid_to" : "grid_none";
          const info = net > 0.05 ? this.t("grid_info_from", { kw: this._nf(net) }) : net < -0.05 ? this.t("grid_info_to", { kw: this._nf(-net) }) : this.t("grid_info_none");
          live.push({ icon: "net", color: COL.grid, value: this._nf(Math.abs(net)), label: this.t("grid_kw", { what: this.t(dir) }), titel: this.t("grid_title"), info, entity: r.grid_import, ...P });
        }
        const house = this._kw(r.house_power);
        if (Number.isFinite(house))
          live.push({ icon: "huisje", color: COL.house, value: this._nf(Math.max(house, 0)), label: this.t("house_kw"), titel: this.t("house_title"), info: this.t("house_info", { kw: this._nf(Math.max(house, 0)) }), entity: r.house_power, ...P });
      }
      const prices = [];
      let advice = null;
      if (f.tariff) {
        const now = new Date();
        const pNow = this._n(r.price_import);
        const lvl = this._s(r.price_level);
        const blk = this._a(r.price_import, "cheapest_2h");
        const bs = blk?.start ? new Date(blk.start) : null;
        const be = blk?.end ? new Date(blk.end) : null;
        const tomorrow = bs && bs.toDateString() !== now.toDateString();
        const when = tomorrow ? `${this.t("parcel_tomorrow")} ` : "";
        const peakRaw = this._n(r.capacity_month_peak);
        const peak = Math.max(Number.isFinite(peakRaw) ? peakRaw : 0, Number(c.capacity_minimum_kw) || 0);
        const q = this._n(r.capacity_quarter);
        const over = Number.isFinite(q) && peak > 0 && q > peak;
        const sell = this._n(r.price_export);
        let priceText = Number.isFinite(pNow) ? this.t("advice_price", { price: this._cents(pNow) }) : "";
        if (bs && be && Number.isFinite(Number(blk.mean)))
          priceText += this.t("advice_cheapest", { when, from: this._hhmm(bs), to: this._hhmm(be), price: this._cents(Number(blk.mean)) });
        if (Number.isFinite(pNow))
          prices.push({ value: this._cents(pNow), label: this.t("price_now", { level: this._level(lvl) }), titel: this.t("price_now_title"), info: priceText, entity: r.price_import });
        if (bs && be && Number.isFinite(Number(blk.mean))) {
          const price = this._cents(Number(blk.mean));
          prices.push({ value: this._hhmm(bs), label: tomorrow ? this.t("price_cheapest_tomorrow", { price }) : this.t("price_cheapest", { price }), titel: this.t("price_cheapest_title"), info: this.t("price_cheapest_info", { when, from: this._hhmm(bs), to: this._hhmm(be), price }), entity: r.price_import });
        }
        if (Number.isFinite(sell))
          prices.push({ value: this._cents(sell), label: this.t("price_back"), titel: this.t("price_back_title"), info: this.t("price_back_info", { price: this._cents(sell) }), entity: r.price_export });
        if (over)
          prices.push({ value: `${this._nf(q)} kW`, label: this.t("peak_over"), titel: this.t("peak_over_title"), info: this.t("advice_peak", { q: this._nf(q), peak: this._nf(peak) }), entity: r.capacity_quarter });
        else if (Number.isFinite(peakRaw))
          prices.push({ value: `${this._nf(peakRaw)} kW`, label: this.t("peak_month"), titel: this.t("peak_title"), info: this.t("peak_info", { peak: this._nf(peakRaw), q: this._nf(q) }), entity: r.capacity_month_peak });
        // Advice line: only when there is something to do now.
        if (over) advice = { tone: "bad", text: this.t("advice_peak", { q: this._nf(q), peak: this._nf(peak) }) };
        else if (lvl === "negative") advice = { tone: "good", text: this.t("advice_negative") };
        else if (f.energy && this._s(r.surplus) === "on" && Number.isFinite(sell))
          advice = { tone: "good", text: this.t("advice_surplus", { price: this._cents(sell) }) };
      }
      let phases = "";
      if (this._adv && c.phases.length) {
        const vals = c.phases.map((ph) => this._kw(ph.import) - (Number.isFinite(this._kw(ph.export)) ? this._kw(ph.export) : 0));
        if (vals.every(Number.isFinite))
          phases = `<span class="rows">${this._row(this.t("phases"), vals.map((v) => `${v > 0 ? "+" : ""}${this._nf(v, 2)}`).join(" · "))}</span>`;
      }
      if (!live.length && !prices.length) return "";
      return `<div class="card energy">
<span class="lbl"><span>${esc(this.t("energy"))}</span>${ep ? `<button class="link" data-nav="${esc(ep)}">${esc(this.t("details"))} ›</button>` : ""}</span>
${advice ? `<div class="advice ${advice.tone}" role="status">${esc(advice.text)}</div>` : ""}
${live.length ? `<cw-metric kolommen="4" items="${esc(JSON.stringify(live))}"></cw-metric>` : ""}
${prices.length ? `<cw-metric kolommen="4" class="${live.length ? "prices" : ""}" items="${esc(JSON.stringify(prices))}"></cw-metric>` : ""}
${phases}
</div>`;
    }
    _row(k, v) {
      return `<div class="row"><span class="muted">${esc(k)}</span><b>${esc(v)}</b></div>`;
    }
    // ---------- controls ----------
    _controlsCard() {
      const f = this._f,
        r = this._r,
        c = this._cfg;
      const items = [];
      if (f.hot_water && this._st(r.hot_water_shower_tomorrow)) {
        const on = this._s(r.hot_water_shower_tomorrow) === "on";
        const tw = this._n(r.hot_water_temperature);
        const goal = on ? this._n(r.hot_water_shower) : this._n(r.hot_water_minimum);
        const morning = this._ok(r.hot_water_morning) ? this._hhmm(new Date(this._s(r.hot_water_morning))) : "";
        items.push({ icon: "warmwater", label: this.t("hot_water"), sub: Number.isFinite(goal) ? this.t("hot_water_sub", { state: on ? this.t("toggle_on") : this.t("toggle_off"), t: this._nf(goal, 0) }) : "", titel: this.t("hot_water_title"), on, act: "toggle", entity: r.hot_water_shower_tomorrow, info: this.t("hot_water_info", { shower: this._nf(this._n(r.hot_water_shower), 0), min: this._nf(this._n(r.hot_water_minimum), 0), t: this._nf(tw, 0) }) + (morning ? this.t("hot_water_info_morning", { time: morning }) : "") });
      }
      const ICONS = { light: "lamp", switch: "stekker", fan: "ventilator", input_boolean: "vink", climate: "thermo", cover: "rolluik" };
      for (const id of c.toggles) {
        const st = this._st(id);
        if (!st) continue;
        const on = st.state === "on";
        const name = st.attributes.friendly_name || id;
        const state = on ? this.t("toggle_on") : this.t("toggle_off");
        items.push({ icon: ICONS[id.split(".")[0]] || "vink", label: name, sub: state, on, act: "toggle", entity: id, info: this.t("toggle_info", { name, state }) });
      }
      if (f.shading) {
        const blinds = c.rooms.filter((x) => x.blind && this._st(x.blind));
        const curtains = c.rooms.filter((x) => x.curtain && this._st(x.curtain));
        if (blinds.length)
          items.push({ icon: "rolluik", label: this.t("blinds"), info: this.t("blinds_info_all"), split: [{ icon: "op", label: this.t("up"), act: "covers", dir: "open", kind: "blind" }, { icon: "neer", label: this.t("down"), act: "covers", dir: "close", kind: "blind" }] });
        if (curtains.length)
          items.push({ icon: "gordijn", label: this.t("curtains"), info: this.t("curtains_info_all"), split: [{ icon: "op", label: this.t("up"), act: "covers", dir: "open", kind: "curtain" }, { icon: "neer", label: this.t("down"), act: "covers", dir: "close", kind: "curtain" }] });
      }
      if (!items.length) return "";
      return `<div class="card"><span class="lbl"><span>${esc(this.t("controls"))}</span></span><cw-toggles items="${esc(JSON.stringify(items))}"></cw-toggles></div>`;
    }
    _mediaCard() {
      if (!this._f.media) return "";
      const playing = this._cfg.media_players.filter((id) => this._s(id) === "playing");
      if (!playing.length) return "";
      const mp = this._path("media");
      return `<div class="card"><span class="lbl"><span>${esc(this.t("playing_now"))}</span>${mp ? `<button class="link" data-nav="${esc(mp)}">${esc(this.t("all"))} ›</button>` : ""}</span>${playing
        .map(
          (id) =>
            `<div class="media"><span class="t"><b>${esc(this._a(id, "friendly_name") || id)}</b><span class="small muted">${esc(this._a(id, "media_title") || this._a(id, "app_name") || "")}</span></span><button class="round" data-act="pause" data-entity="${esc(id)}" aria-label="${esc(this.t("pause"))}" title="${esc(this.t("pause"))}">${svg(ICON.pause)}</button></div>`,
        )
        .join("")}</div>`;
    }
    _todoCard() {
      if (!this._f.todo) return "";
      const n = this._n(this._r.todo);
      if (!(n > 0)) return "";
      const tp = this._path("todo");
      const text = esc(this.t(n === 1 ? "todo_one" : "todo_many", { n: this._nf(n, 0) }));
      return tp
        ? `<button class="card todo" data-nav="${esc(tp)}">${svg(ICON.check)}<b>${text}</b><span class="link">›</span></button>`
        : `<div class="card todo">${svg(ICON.check)}<b>${text}</b></div>`;
    }
    // ---------- extended view ----------
    _climateCard() {
      const f = this._f,
        r = this._r;
      if (!f.climate && !f.heat_pump) return "";
      const cells = [];
      const tIn = this._n(r.indoor_temperature);
      if (Number.isFinite(tIn)) cells.push([`${this._nf(tIn)}°`, this.t("living_room")]);
      if (f.heat_pump && this._ok(r.heat_pump_state)) {
        const s = this._s(r.heat_pump_state);
        cells.push([{ heating: this.t("floor_heats"), cooling: this.t("floor_cools"), hot_water: this.t("floor_hot_water") }[s] || this.t("floor_idle"), this.t("floor")]);
      }
      const rows = [];
      if (f.climate) {
        const peak = this._n(r.climate_indoor_peak);
        rows.push([this.t("expected_today"), Number.isFinite(peak) ? this.t("expected_value", { day: this._dayType(this._a(r.climate_indoor_peak, "day_type")), t: this._nf(peak) }) : this.t("none_yet")]);
        rows.push([this.t("floor_next_days"), this._floorMode(this._s(r.climate_floor_mode))]);
      }
      if (f.hot_water) {
        const tw = this._n(r.hot_water_temperature);
        rows.push([this.t("hot_water_row"), Number.isFinite(tw) ? `${this._nf(tw, 0)} °C` : this.t("none_yet")]);
      }
      if (!cells.length && !rows.length) return "";
      const cp = this._path("climate");
      const tag = cp ? "button" : "div";
      return `<${tag} class="card"${cp ? ` data-nav="${esc(cp)}"` : ""}><span class="lbl"><span>${esc(this.t("climate"))}</span>${cp ? `<span class="link">${esc(this.t("details"))} ›</span>` : ""}</span>${cells.length ? `<span class="g3">${cells.map(([v, l]) => `<span><b class="big">${esc(v)}</b><small>${esc(l)}</small></span>`).join("")}</span>` : ""}${rows.length ? `<span class="rows">${rows.map(([k, v]) => this._row(k, v)).join("")}</span>` : ""}</${tag}>`;
    }
    _carsCard() {
      const f = this._f,
        r = this._r,
        c = this._cfg;
      if (!f.cars || !c.cars.length) return "";
      const lines = c.cars
        .map((car) => {
          const soc = this._n(car.battery);
          if (!Number.isFinite(soc)) return "";
          const w = Math.max(0, Math.min(100, soc));
          const cable = this._s(car.cable) === "on";
          const charging = this._s(car.charging) === "charging";
          const loc = this._s(car.location) || "";
          const home = loc === "home" || this._s(car.at_home) === "on";
          const where = home ? ["huisje", this.t("car_home")] : NO_VALUE.has(loc) || loc === "not_home" ? ["pin", this.t("car_elsewhere")] : ["pin", loc];
          const cp = this._path("cars");
          return `<span class="carrow"><span class="carname">${esc(car.name)}</span><span class="track"><span class="fill" style="width:${w}%"></span></span><b>${this._nf(soc, 0)} %</b><span class="cicons"><cw-chip kaal icoon="stekker" label="${esc(cable ? this.t("car_plug_in") : this.t("car_plug_out"))}" entity="${esc(car.cable)}"${cable ? ' toon="aan"' : " uit"}></cw-chip>${charging ? `<cw-chip kaal icoon="bliksem" toon="aan" label="${esc(this.t("car_charging_now"))}" entity="${esc(car.charging)}"></cw-chip>` : ""}<cw-chip kaal icoon="${where[0]}" label="${esc(where[1])}" entity="${esc(car.location)}"${cp ? ` path="${esc(cp)}" pad-label="${esc(this.t("cars_page"))}"` : ""}></cw-chip></span></span>`;
        })
        .join("");
      if (!lines) return "";
      let charger = "";
      if (f.ev_charging && this._st(r.ev_charging_car)) {
        const at = this._s(r.ev_charging_car);
        const kw = this._kw(r.ev_charger_power);
        const mode = { solar_only: this.t("mode_solar_only"), solar_min: this.t("mode_solar_min"), fast: this.t("mode_fast"), stop: this.t("mode_stop") }[this._s(r.ev_charger_mode)] || this.t("mode_unknown");
        if (at && at !== "none" && !NO_VALUE.has(at)) {
          const name = this._a(r.ev_charging_car, "name") || at;
          const what = kw > 0.1 ? `${this._nf(kw)} kW` : mode;
          charger = `<cw-chip icoon="laadpaal" label="${esc(this.t("charger"))}" info="${esc(this.t("charger_info", { car: name, what }))}" entity="${esc(r.ev_charger_mode)}"${kw > 0.1 ? ' toon="aan"' : ""}>${esc(name)} · ${esc(what)}</cw-chip>`;
        } else
          charger = `<cw-chip icoon="laadpaal" uit label="${esc(this.t("charger"))}" info="${esc(this.t("charger_free_info"))}">${esc(this.t("charger_free"))}</cw-chip>`;
      }
      return `<div class="card"><span class="lbl"><span>${esc(this.t("cars"))}</span></span><span class="cars">${lines}</span>${charger ? `<span class="chips">${charger}</span>` : ""}</div>`;
    }
    _roomsCard() {
      const c = this._cfg;
      if (!this._f.shading) return "";
      const rooms = c.rooms.filter((x) => (x.blind && this._st(x.blind)) || (x.curtain && this._st(x.curtain)));
      if (!rooms.length) return "";
      const auto = this._s(this._r.shading_automatic);
      const sp = this._path("shading");
      const autoTxt = auto === "on" ? this.t("shading_auto_on") : auto === "off" ? this.t("shading_auto_off") : "";
      const head = autoTxt ? (sp ? `<button class="link" data-nav="${esc(sp)}">${esc(autoTxt)} ›</button>` : `<span>${esc(autoTxt)}</span>`) : "";
      return `<div class="card"><span class="lbl"><span>${esc(this.t("rooms"))}</span>${head}</span><div class="g4">${rooms
        .map((x) => {
          const sun = x.flag && this._s(x.flag) === "on" ? this.t("sun_kept_out") : "";
          const parts = [];
          if (x.blind && this._st(x.blind)) parts.push(this.t("room_sub_blind", { state: this._coverState(x.blind) }));
          if (x.curtain && this._st(x.curtain)) parts.push(this.t("room_sub_curtain", { state: this._coverState(x.curtain) }));
          const sub = parts.join(" · ") + sun;
          const target = x.blind && this._st(x.blind) ? x.blind : x.curtain;
          const isOpen = this._s(target) === "open";
          return `<button class="room" data-act="cover" data-entity="${esc(target)}" aria-label="${esc(this.t(isOpen ? "room_toggle_close" : "room_toggle_open", { room: x.name }))}"><b>${esc(x.name)}</b><span class="small muted">${esc(sub)}</span></button>`;
        })
        .join("")}</div></div>`;
    }
    _houseDoesCard() {
      const f = this._f,
        r = this._r,
        c = this._cfg;
      const rows = [];
      if (f.hot_water && this._st(r.hot_water_surplus_active))
        rows.push([this.t("auto_hot_water"), this._s(r.hot_water_surplus_active) === "on" ? this.t("auto_hot_water_heating") : this.t("auto_waiting")]);
      if (f.ev_charging && this._ok(r.ev_charging_status)) {
        const s = this._s(r.ev_charging_status);
        const map = { off: "status_off", no_car: "status_no_car", car_full: "status_car_full", solar: "status_solar", paused_battery: "status_paused_battery", grid_assist: "status_grid_assist", plan: "status_plan", manual: "status_manual", peak_limited: "status_peak_limited" };
        rows.push([this.t("auto_charging"), map[s] ? this.t(map[s]) : s]);
      }
      if (f.shading && this._st(r.shading_automatic)) {
        const on = this._s(r.shading_automatic) === "on";
        const closed = c.rooms.some((x) => x.flag && this._s(x.flag) === "on");
        rows.push([this.t("auto_shading"), !on ? this.t("auto_off") : closed ? this.t("auto_shading_closed") : this.t("auto_not_needed")]);
      }
      if (f.hot_water && this._ok(r.hot_water_morning)) {
        const tw = this._n(r.hot_water_temperature);
        const on = this._s(r.hot_water_shower_tomorrow) === "on";
        const goal = on ? this._n(r.hot_water_shower) : this._n(r.hot_water_minimum);
        rows.push([this.t("auto_morning"), Number.isFinite(tw) && Number.isFinite(goal) && tw >= goal ? this.t("auto_not_needed") : this._hhmm(new Date(this._s(r.hot_water_morning)))]);
      }
      if (!rows.length) return "";
      return `<div class="card"><span class="lbl"><span>${esc(this.t("house_does"))}</span></span><span class="rows">${rows.map(([k, v]) => this._row(k, v)).join("")}</span></div>`;
    }
    // ---------- arrival card of tesla-route (persistent element: its map survives our re-render) ----------
    _mountArrival() {
      const cfg = this._cfg.arrival;
      if (!cfg || this._arrEl) {
        if (this._arrEl) this._arrEl.hass = this._hass;
        return;
      }
      if (!customElements.get("tesla-arrival-card")) {
        if (!this._arrWait) {
          this._arrWait = true;
          customElements.whenDefined("tesla-arrival-card").then(() => this._hass && this._mountArrival());
        }
        return;
      }
      const el = document.createElement("tesla-arrival-card");
      try {
        el.setConfig(cfg);
      } catch (e) {
        console.warn("home-screen-card: arrival card config", e);
        return;
      }
      this._arrEl = el;
      this._wrap().arr.appendChild(el);
      el.hass = this._hass;
    }
    // Style and the three parts are built once; each render replaces the content of top and body only.
    _wrap() {
      if (!this._parts) {
        this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="top"></div><div class="arr"></div><div class="body"></div></div>`;
        const q = (s) => this.shadowRoot.querySelector(s);
        this._parts = { top: q(".top"), arr: q(".arr"), body: q(".body") };
      }
      return this._parts;
    }
    _render() {
      if (!this._hass || !this._cfg || !this.shadowRoot) return;
      this._lastRender = Date.now();
      const now = new Date();
      const h = now.getHours();
      const greet = this.t(h < 6 ? "greet_night" : h < 12 ? "greet_morning" : h < 18 ? "greet_afternoon" : "greet_evening");
      const day = now.toLocaleDateString(this._loc, { weekday: "short", day: "numeric", month: "short" });
      const parts = this._wrap();
      const adv = this._adv;
      const chips = this._chips();
      parts.top.innerHTML = `<cw-kop titel="${esc(greet)}" sub="${esc(day)} · ${esc(this._hhmm(now))}">${esc(greet)}${chips.length ? `<cw-knop slot="acties" data-act="chips" icoon="schuif" label="${esc(this.t("choose_chips"))}"></cw-knop>` : ""}<cw-knop slot="acties" data-act="adv" icoon="lagen" label="${esc(this.t("advanced_view"))}"${adv ? " aan" : " toggle"}></cw-knop></cw-kop>
${chips.length ? `<cw-status bewaar="home" chips="${esc(JSON.stringify(chips))}"></cw-status>` : ""}`;
      this._mountArrival();
      const left = [this._energyCard(), adv ? this._climateCard() : "", adv ? this._carsCard() : ""].filter(Boolean);
      const right = [this._controlsCard(), this._mediaCard(), this._todoCard(), adv ? this._roomsCard() : "", adv ? this._houseDoesCard() : ""].filter(Boolean);
      const cols = [left, right].filter((x) => x.length);
      parts.body.innerHTML = cols.length
        ? `<div class="cols${cols.length === 1 ? " one" : ""}">${cols.map((x) => `<div class="col">${x.join("\n")}</div>`).join("")}</div>`
        : "";
    }
    // ---------- sheets ----------
    _doorbellSheet(from) {
      const r = this._r;
      const cam = this._st(r.doorbell_camera);
      const ring = Date.parse(this._s(r.doorbell_button));
      const rows = [];
      if (Number.isFinite(ring))
        rows.push([this.t("doorbell_last_rang"), `${new Date(ring).toLocaleDateString(this._loc, { weekday: "short", day: "numeric", month: "short" })} ${this._hhmm(new Date(ring))}`]);
      // What the vision model saw at this ring (doorbell module), only when written after the ring.
      const visit = this._st(r.doorbell_visit);
      if (visit && !NO_VALUE.has(visit.state) && Number.isFinite(ring) && Date.parse(visit.last_updated) >= ring - 2000)
        rows.push([this.t("doorbell_seen"), this._ok(r.doorbell_description) ? this._s(r.doorbell_description) : visit.state]);
      const pkg = Date.parse(this._s(r.doorbell_package));
      if (Number.isFinite(pkg) && Date.now() - pkg < PARCEL_RECENT_MS) rows.push([this.t("doorbell_parcel_left"), this._hhmm(new Date(pkg))]);
      if (this._f.parcel_service && this._st(r.parcel_expected)) rows.push([this.t("parcel_expected"), this._parcelDayText() || this.t("parcel_no")]);
      const quick = [
        { label: this.t("doorbell_at_door"), icon: "huisje", run: () => this._reply("at_door") },
        { label: this.t("doorbell_coming"), icon: "mensen", run: () => this._reply("coming") },
      ];
      if (this._f.parcel_service && this._parcelDay() === "today")
        quick.push({ label: this.t("parcel_garage_ajar"), icon: "pakje", run: () => this._reply("parcel_service") });
      window.cwInfoSheet?.(from, {
        title: this.t("doorbell_title"),
        icon: "deurbel",
        image: cam?.attributes?.entity_picture,
        rows,
        entity: r.doorbell_camera,
        quick,
        actions: this._cfg.protect_url ? [{ label: this.t("doorbell_protect"), run: () => window.open(this._cfg.protect_url, "_blank", "noopener") }] : [],
      });
    }
    // Same script as the buttons of the doorbell notification (module doorbell): LCD text, parcel steps.
    _reply(button) {
      const variables = { button };
      if (button === "parcel_service" && this._ok(this._r.doorbell_button)) variables.ring = this._s(this._r.doorbell_button);
      this._fastUntil = Date.now() + FAST_MS;
      this._hass.callService("script", "turn_on", { entity_id: this._r.doorbell_reply, variables });
    }
    _parcelSet(day) {
      this._fastUntil = Date.now() + FAST_MS;
      this._hass.callService("script", "turn_on", { entity_id: this._r.parcel_expected_script, variables: { day } });
    }
    _parcelSheet(from) {
      const r = this._r;
      const day = this._parcelDay();
      const rows = [[this.t("parcel_expected"), this._parcelDayText() || this.t("parcel_no")]];
      if (Number.isFinite(this._n(r.parcel_ajar))) rows.push([this.t("parcel_ajar_row"), this.t("parcel_ajar_value", { s: this._nf(this._n(r.parcel_ajar), 1) })]);
      if (Number.isFinite(this._n(r.parcel_open))) rows.push([this.t("parcel_open_row"), this.t("parcel_open_value", { s: this._nf(this._n(r.parcel_open), 0) })]);
      const quick = [
        { label: this.t("parcel_set_today"), icon: "klok", run: () => this._parcelSet("today") },
        { label: this.t("parcel_set_tomorrow"), icon: "klok", run: () => this._parcelSet("tomorrow") },
      ];
      if (day) quick.push({ label: this.t("parcel_set_off"), icon: "vink", run: () => this._parcelSet("off") });
      if (day === "today" && r.doorbell_reply) quick.push({ label: this.t("parcel_garage_ajar"), icon: "pakje", run: () => this._reply("parcel_service") });
      const pp = this._path("parcel_service");
      window.cwInfoSheet?.(from, {
        title: this.t("parcel_title"),
        icon: "pakje",
        text: day ? this.t("parcel_text_on", { day: this._parcelDayText() }) : this.t("parcel_text_off"),
        rows,
        quick,
        ...(pp ? { path: pp, pathLabel: this.t("parcel_title") } : {}),
      });
    }
    _onClick(ev) {
      const el = ev.composedPath().find((n) => n.dataset && (n.dataset.act || n.dataset.nav));
      if (!el) return;
      const { act, nav, entity } = el.dataset;
      if (act) this._fastUntil = Date.now() + FAST_MS;
      if (act === "adv") {
        this._adv = !this._adv;
        try {
          localStorage.setItem(VIEW_KEY, this._adv ? "1" : "0");
        } catch (e) {}
        this._render();
        return;
      }
      if (act === "chips") {
        this._wrap().top.querySelector("cw-status")?.kies(el);
        return;
      }
      if (act === "toggle" && entity) {
        this._hass.callService("homeassistant", "toggle", { entity_id: entity });
        return;
      }
      if (act === "cover" && entity) {
        this._hass.callService("cover", "toggle", { entity_id: entity });
        return;
      }
      if (act === "covers") {
        const open = el.dataset.dir === "open";
        const kind = el.dataset.kind === "curtain" ? "curtain" : "blind";
        const ids = this._cfg.rooms.map((x) => x[kind]).filter((id) => id && this._st(id));
        const what = kind === "curtain" ? this.t("curtains") : this.t("blinds");
        if (!ids.length || !confirm(this.t(open ? "covers_confirm_open" : "covers_confirm_close", { what }))) return;
        this._hass.callService("cover", open ? "open_cover" : "close_cover", { entity_id: ids });
        return;
      }
      if (act === "doorbell") {
        this._doorbellSheet(el);
        return;
      }
      if (act === "parcel") {
        this._parcelSheet(el);
        return;
      }
      if (act === "gate-close") {
        if (!this._r.gate_close_script || !confirm(this.t("gate_close_confirm"))) return;
        this._hass.callService("script", "turn_on", { entity_id: this._r.gate_close_script, variables: { reason: this.t("gate_close_reason") } });
        return;
      }
      if (act === "pause" && entity) {
        this._hass.callService("media_player", "media_pause", { entity_id: entity });
        return;
      }
      if (nav) {
        history.pushState(null, "", nav);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      }
    }
  }

  // Colours only through the --cw-* tokens of theme Organic (module base), with HA's own variables as fallback.
  const CSS = `
:host { display: block; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; text-align: left; }
button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #C67139)); outline-offset: 2px; }
svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.wrap { font-family: Figtree, system-ui, sans-serif; color: var(--cw-text, var(--primary-text-color)); background: var(--cw-bg, var(--primary-background-color));
  min-height: calc(100vh - var(--header-height, 56px)); padding: 20px 16px 32px; }
.muted { color: var(--cw-muted, var(--secondary-text-color)); }
.small { font-size: 13px; }
cw-kop:not(:defined) { display: block; min-height: 56px; max-width: 1100px; margin: 0 auto 12px; font: 28px/56px Caprasimo, Georgia, serif; }
cw-kop:not(:defined) > * { display: none; }
cw-status { margin: 0 auto 14px; }
.arr { max-width: 1100px; margin: 0 auto; }
.arr > * { margin-bottom: 14px; } /* tesla-arrival-card sets display: none while no car is on the road */
.cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; max-width: 1100px; margin: 0 auto; }
@media (min-width: 900px) { .cols:not(.one) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.card { background: var(--cw-card, var(--card-background-color)); border-radius: 22px; padding: 16px; display: flex; flex-direction: column; gap: 10px; width: 100%; }
button.card:hover { filter: brightness(1.05); }
.lbl { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 15px; color: var(--cw-muted, var(--secondary-text-color)); }
.link { color: var(--cw-muted, var(--secondary-text-color)); font-size: 15px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cicons { display: inline-flex; align-items: center; gap: 2px; flex: none; }
.prices { border-top: 1px solid var(--cw-line, var(--divider-color)); padding-top: 8px; }
.advice { border-radius: 14px; padding: 8px 12px; font-size: 14px; line-height: 1.35; font-weight: 600; background: var(--cw-bg, var(--primary-background-color)); }
.advice.good { box-shadow: inset 0 0 0 2px var(--cw-good, var(--success-color)); }
.advice.bad { background: var(--cw-bad, var(--error-color)); color: var(--cw-on-accent, #1d1a17); }
.g3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.g3 > span { display: flex; flex-direction: column; gap: 2px; }
.g3 small { font-size: 13px; color: var(--cw-muted, var(--secondary-text-color)); }
.big { font-size: 20px; }
.g4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px; }
.room { background: var(--cw-bg, var(--primary-background-color)); border-radius: 16px; padding: 12px 14px; min-height: 58px; display: flex; flex-direction: column; gap: 2px; }
.room b { font-size: 15px; }
.cars { display: flex; flex-direction: column; gap: 8px; }
.carrow { display: flex; align-items: center; gap: 10px; }
.carname { font-weight: 700; width: 76px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.track { flex-grow: 1; height: 12px; border-radius: 99px; background: var(--cw-bg, var(--primary-background-color)); position: relative; overflow: hidden; }
.fill { position: absolute; inset: 0 auto 0 0; background: var(--cw-wagen, var(--primary-color)); border-radius: 99px; }
.carrow b { width: 48px; text-align: right; }
.rows { display: flex; flex-direction: column; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 2px; border-top: 1px solid var(--cw-line, var(--divider-color)); font-size: 14px; }
.row b { text-align: right; }
.media { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--cw-bg, var(--primary-background-color)); border-radius: 16px; }
.t { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex-grow: 1; }
.t b { font-size: 16px; }
.round { width: 44px; height: 44px; border-radius: 99px; background: var(--cw-card, var(--card-background-color)); display: flex; align-items: center; justify-content: center; flex: none; }
.todo { flex-direction: row; align-items: center; gap: 12px; color: var(--cw-accent, var(--primary-color)); }
.todo b { color: var(--cw-text, var(--primary-text-color)); flex-grow: 1; }
`;

  if (!customElements.get("home-screen-card")) customElements.define("home-screen-card", HomeScreenCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "home-screen-card",
    name: <@ t('card_name') | tojson @>,
    description: `${<@ t('card_description') | tojson @>} v${VERSION}`,
  });
})();

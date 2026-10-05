// E-ink wall display (ha-kit module e-ink-display): one high-contrast page for a touch e-ink tablet in the wall.
//   Header: date, week, time of the last redraw, and up to 6 large buttons to other views.
//   Blocks: weather (now, 6 hours, 3 days), agenda (today and tomorrow), home (people, gate with a second tap,
//   doorbell, blinds, indoor, hot water, cars, own tiles) and energy (solar, house, grid, battery, today, price for
//   the next 12 hours with the cheapest 2 h on a yellow band). A block whose roles are all missing is not drawn; a
//   tile without a value is not drawn either.
// Nothing about the house is built in: every entity id, list, path and text comes from the card config that
// tools/fill.py renders from house.yaml, modules: and the capabilities (lovelace/view.yaml).
// E-ink rules: black text on white, colour only as a dark accent on icons (it never carries meaning alone: Kaleido
// mutes it and the page must stay readable in grayscale), red = warning, light yellow only as a fill behind black;
// no animations, no hover, no shadows; touch targets >= 76 px. Designed at 1600 x 1200 (landscape) or 1200 x 1600
// (portrait) and zoomed to fit the window.
// Refresh: redraws at most every roles.refresh seconds (helper input_number.e_ink_display_refresh; fewer redraws =
// less ghosting) and only when the page changed; for a few seconds after a tap it redraws at once.
// Needs cw-thema.js of module base (<cw-icoon>, window.cwWeerIcoon, window.cwWeerNaam).
(() => {
  // The language is part of the version, so browsers reload the file when house.language changes.
  const VERSION = "1-<@ t('language_code') @>";
  const FAST_MS = 8000; // after a tap: redraw at once for this long
  const ARM_MS = 5000; // the gate tile waits this long for the confirming second tap
  const RING_MS = 5 * 60000; // the doorbell tile says "rings" this long after a ring
  const MAX_TILES = 12; // 4 rows of 3 in the home block
  const DEFAULT_REFRESH_S = 30;
  const INK = {
    bg: "#FFFFFF",
    text: "#000000",
    warn: "#B3261E", // red, 6.5:1 on white
    sun: "#8A4B00", // dark orange, 6.9:1
    green: "#2E6B1F", // dark green, 6.6:1
    blue: "#1F4E99", // dark blue, 7.9:1
    yellow: "#FFE36E", // fill only, always behind black
  };
  const NO_VALUE = new Set([undefined, null, "", "unknown", "unavailable"]);
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  // "{n} closed" + {n: 2} -> "2 closed"; unknown {names} stay as they are.
  const fmt = (text, values = {}) =>
    String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const hhmm = (d) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
  const icon = (name, size, colour) =>
    `<cw-icoon naam="${esc(name)}" maat="${size}"${colour ? ` kleur="${colour}"` : ""}></cw-icoon>`;
  const reEsc = (t) => String(t).replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  };

  class EInkScreenCard extends HTMLElement {
    setConfig(config) {
      if (!config || typeof config.roles !== "object" || typeof config.strings !== "object")
        throw new Error(
          "e-ink-screen-card: roles and strings are rendered by ha-kit (tools/fill.py): paste e-ink-display/lovelace/view.yaml",
        );
      this._cfg = {
        people: [],
        cars: [],
        blinds: [],
        tiles: [],
        calendars: [],
        paths: {},
        nav: [],
        battery_sign: "discharge_positive",
        ...config,
      };
      this._r = this._cfg.roles;
      this._S = this._cfg.strings;
      this._loc = this._S.locale || undefined;
      this._html = null;
      if (this._hass) this._schedule();
    }
    getCardSize() {
      return 12;
    }
    getGridOptions() {
      return { columns: "full", rows: "auto" };
    }
    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._cfg) return;
      if (first) {
        this._fastUntil = Date.now() + FAST_MS;
        this._subscribe();
        this._loadAgenda();
      }
      this._schedule();
    }
    connectedCallback() {
      if (this._hass && !this._unsub) this._subscribe();
      // Forecast and agenda arrive after the first render: draw them at once instead of after the interval.
      this._fastUntil = Date.now() + FAST_MS;
      this._onResize ||= () => {
        this._html = null;
        this._schedule();
      };
      window.addEventListener("resize", this._onResize);
      // The clock and the agenda also move when no state changes.
      this._tick ||= setInterval(() => this._schedule(), 60000);
      this._agendaTick ||= setInterval(() => this._loadAgenda(), 15 * 60000);
    }
    disconnectedCallback() {
      for (const u of [this._unsub, this._unsubDaily]) u?.then((f) => f?.()).catch(() => {});
      this._unsub = this._unsubDaily = null;
      window.removeEventListener("resize", this._onResize);
      clearInterval(this._tick);
      clearInterval(this._agendaTick);
      this._tick = this._agendaTick = null;
      clearTimeout(this._timer);
      this._timer = null;
    }

    // ---------- state helpers ----------
    _s(id) {
      return id ? this._hass?.states[id] : undefined;
    }
    _n(id) {
      const v = parseFloat(this._s(id)?.state);
      return Number.isFinite(v) ? v : NaN;
    }
    // A power role in kW, read by its unit (W or kW); NaN without a value.
    _kw(id) {
      const st = this._s(id);
      const v = parseFloat(st?.state);
      if (!Number.isFinite(v)) return NaN;
      return st.attributes?.unit_of_measurement === "W" ? v / 1000 : v;
    }
    _nf(v, d = 1) {
      return Number.isFinite(v)
        ? v.toLocaleString(this._loc, { minimumFractionDigits: d, maximumFractionDigits: d })
        : "";
    }
    // Seconds between redraws from the helper; DEFAULT_REFRESH_S when it is missing, never below 5.
    _interval() {
      const v = this._n(this._r.refresh);
      return (Number.isFinite(v) ? Math.max(v, 5) : DEFAULT_REFRESH_S) * 1000;
    }
    _schedule() {
      if (this._timer) return;
      const now = Date.now();
      const wait =
        !this._last || now < this._fastUntil ? 0 : Math.max(this._last + this._interval() - now, 0);
      this._timer = setTimeout(() => {
        this._timer = null;
        this._render();
      }, wait);
    }
    _subscribe() {
      const conn = this._hass?.connection;
      if (!conn || !this._r.weather) return;
      const sub = (type, set) =>
        conn
          .subscribeMessage(
            (msg) => {
              // The first forecast is drawn at once; later updates follow the interval.
              if (!this._hourly || !this._daily) this._fastUntil = Date.now() + 1000;
              set(msg.forecast || []);
              this._schedule();
            },
            { type: "weather/subscribe_forecast", forecast_type: type, entity_id: this._r.weather },
          )
          .catch(() => null);
      this._unsub = sub("hourly", (f) => (this._hourly = f));
      this._unsubDaily = sub("daily", (f) => (this._daily = f));
    }
    async _loadAgenda() {
      const cals = this._cfg?.calendars || [];
      if (!cals.length || !this._hass) return;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 2 * 864e5);
      const lists = await Promise.all(
        cals.map((c) =>
          this._hass
            .callApi("GET", `calendars/${c}?start=${start.toISOString()}&end=${end.toISOString()}`)
            .catch(() => []),
        ),
      );
      this._events = lists
        .flat()
        .map((e) => ({
          title: e.summary,
          start: new Date(e.start?.dateTime || `${e.start?.date}T00:00:00`),
          allDay: !e.start?.dateTime,
        }))
        .filter((e) => Number.isFinite(e.start.getTime()))
        .filter((e) => e.allDay || e.start.getTime() > Date.now() - 36e5)
        .sort((a, b) => a.start - b.start);
      this._schedule();
    }

    // ---------- touch ----------
    _onTap(ev) {
      const el = ev
        .composedPath()
        .find((n) => n.dataset && (n.dataset.nav || n.dataset.info || n.dataset.act));
      if (!el) return;
      this._fastUntil = Date.now() + FAST_MS;
      const { nav, info, act } = el.dataset;
      if (act === "gate") return this._gate();
      if (info) {
        this.dispatchEvent(
          new CustomEvent("hass-more-info", { detail: { entityId: info }, bubbles: true, composed: true }),
        );
        return;
      }
      if (nav) {
        history.pushState(null, "", nav);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      }
    }
    // First tap arms (the tile says "tap again"), a second tap within ARM_MS opens or closes the gate.
    _gate() {
      const now = Date.now();
      if (this._armed && now - this._armed < ARM_MS) {
        this._armed = 0;
        const open = this._s(this._r.gate_open)?.state === "on";
        const [domain, service] = (open ? this._r.gate_close_script : this._r.gate_open_script).split(".");
        this._hass.callService(domain, service, open ? { reason: this._S.gate_close_reason } : {});
      } else {
        this._armed = now;
        setTimeout(() => this._schedule(), ARM_MS + 50);
      }
      this._render();
    }

    // ---------- blocks (each returns "" when it has nothing to show) ----------
    _header(now) {
      const date = cap(
        now.toLocaleDateString(this._loc, { weekday: "long", day: "numeric", month: "long" }),
      );
      const nav = this._cfg.nav || [];
      return `<header>
        <div class="date">${esc(date)}
          <span class="small">${esc(fmt(this._S.week, { n: isoWeek(now) }))} · ${hhmm(now)}</span></div>
        ${nav.length ? `<nav>${nav.map((n) => `<button data-nav="${esc(n.path)}">${icon(n.icon, 34)}<span>${esc(n.label)}</span></button>`).join("")}</nav>` : ""}
      </header>`;
    }

    _weather(now) {
      const r = this._r;
      const w = this._s(r.weather);
      const tOut = Number.isFinite(this._n(r.outdoor_temperature))
        ? this._n(r.outdoor_temperature)
        : parseFloat(w?.attributes?.temperature);
      if (!w && !Number.isFinite(tOut)) return "";
      const night = this._s(r.sun)?.state === "below_horizon";
      const name = w ? window.cwWeerIcoon?.(w.state, night) || "wolk" : "thermo";
      const today = (this._daily || [])[0];
      const hours = (this._hourly || [])
        .filter((f) => new Date(f.datetime) > now)
        .filter((_, i) => i % 2 === 0)
        .slice(0, 6);
      const rain = (f) =>
        f.precipitation > 0
          ? `${this._nf(f.precipitation, 1)} mm`
          : f.precipitation_probability >= 30
            ? `${f.precipitation_probability}%`
            : "";
      const days = (this._daily || [])
        .filter((d) => new Date(d.datetime).toDateString() !== now.toDateString())
        .slice(0, 3);
      const dayName = (d) => cap(d.toLocaleDateString(this._loc, { weekday: "long" }));
      return `<section class="weather"${w ? ` data-info="${esc(r.weather)}"` : ""}>
        <div class="now">
          ${icon(name, 132, name === "zon" ? INK.sun : "")}
          ${Number.isFinite(tOut) ? `<div class="big">${this._nf(tOut, 0)}°</div>` : ""}
          <div class="beside">
            <div class="word">${esc(w ? window.cwWeerNaam?.(w.state) || "" : "")}</div>
            ${today ? `<div class="sub">${esc(fmt(this._S.temp_range, { low: this._nf(today.templow, 0), high: this._nf(today.temperature, 0) }))}</div>` : ""}
          </div>
        </div>
        ${hours.length ? `<div class="hours">${hours.map((f) => `<div class="hour">
              <div class="t">${hhmm(new Date(f.datetime))}</div>
              ${icon(window.cwWeerIcoon?.(f.condition, false) || "wolk", 56)}
              <div class="v">${this._nf(f.temperature, 0)}°</div>
              <div class="r">${rain(f)}</div>
            </div>`).join("")}</div>` : ""}
        ${days.length ? `<div class="days">${days.map((d) => `<div class="day">
              <div class="t">${esc(dayName(new Date(d.datetime)))}</div>
              ${icon(window.cwWeerIcoon?.(d.condition, false) || "wolk", 56)}
              <div class="v">${this._nf(d.temperature, 0)}°</div>
              <div class="r">${this._nf(d.templow, 0)}°${d.precipitation > 0 ? ` · ${this._nf(d.precipitation, 0)} mm` : ""}</div>
            </div>`).join("")}</div>` : ""}
      </section>`;
    }

    _agenda(now) {
      if (!(this._cfg.calendars || []).length) return "";
      const S = this._S;
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      const when = (d) =>
        d.toDateString() === now.toDateString() ? "today" : d.toDateString() === tomorrow.toDateString() ? "tomorrow" : "";
      const rows = (this._events || []).filter((e) => when(e.start)).slice(0, 6);
      const path = this._cfg.paths.presence;
      return `<section class="agenda"${path ? ` data-nav="${esc(path)}"` : ""}>
        <h2>${icon("kalender", 40)} ${esc(S.agenda)}</h2>
        ${rows.length
          ? `<ul>${rows.map((e) => `<li><b>${when(e.start) === "tomorrow" ? `${esc(S.tomorrow)} ` : ""}${e.allDay ? esc(S.all_day) : hhmm(e.start)}</b><span>${esc(e.title)}</span></li>`).join("")}</ul>`
          : `<p class="empty">${esc(S.agenda_none)}</p>`}
      </section>`;
    }

    _tiles() {
      const r = this._r;
      const S = this._S;
      const c = this._cfg;
      const tiles = [];
      const temp = (v) => (Number.isFinite(v) ? `${this._nf(v, 0)}°` : null);
      // People: home, away, or the zone they are in (without their own name: "Work Jan" -> "work").
      for (const p of c.people) {
        const st = this._s(p.person)?.state;
        if (NO_VALUE.has(st)) continue;
        const own = new RegExp("\\b" + reEsc(p.name) + "\\b", "gi");
        const where =
          st === "home" ? S.person_home : st === "not_home" ? S.person_away : st.replace(own, "").trim().toLowerCase() || st;
        tiles.push({ icon: "mensen", label: p.name, value: where, info: p.person });
      }
      // Gate: needs the gate sensor; first tap arms, second tap acts.
      if (r.gate_open && !NO_VALUE.has(this._s(r.gate_open)?.state)) {
        const open = this._s(r.gate_open).state === "on";
        const armed = this._armed && Date.now() - this._armed < ARM_MS;
        tiles.push({
          icon: "poort",
          label: armed ? S.gate_tap_again : S.gate,
          value: armed ? (open ? S.gate_close_q : S.gate_open_q) : open ? S.gate_open : S.gate_closed,
          warn: open || armed,
          act: "gate",
        });
      }
      // Doorbell: "rings" for a few minutes after a ring, else the time of today's last ring, else quiet.
      if (r.doorbell_button && this._s(r.doorbell_button)) {
        const t = new Date(this._s(r.doorbell_button).state);
        const ok = Number.isFinite(t.getTime());
        const rings = ok && Date.now() - t.getTime() < RING_MS;
        const today = ok && t.toDateString() === new Date().toDateString();
        tiles.push({
          icon: "deurbel",
          label: S.doorbell,
          value: rings ? S.doorbell_rings : today ? hhmm(t) : S.doorbell_quiet,
          warn: rings,
          info: r.doorbell_camera || r.doorbell_button,
        });
      }
      // Blinds of the shading rooms.
      const known = c.blinds.filter((b) => !NO_VALUE.has(this._s(b)?.state));
      if (known.length) {
        const closed = known.filter((b) => this._s(b).state === "closed").length;
        tiles.push({
          icon: "rolluik",
          label: S.blinds,
          value: closed === 0 ? S.blinds_open : closed === known.length ? S.blinds_closed : fmt(S.blinds_n_closed, { n: closed }),
          nav: c.paths.shading,
          info: known[0],
        });
      }
      const tin = temp(this._n(r.indoor_temperature));
      if (tin) tiles.push({ icon: "huisje", label: S.indoor, value: tin, nav: c.paths.climate, info: r.indoor_temperature });
      const thw = temp(this._n(r.hot_water));
      if (thw) tiles.push({ icon: "warmwater", label: S.hot_water, value: thw, info: r.hot_water });
      for (const car of c.cars) {
        const soc = this._n(car.battery);
        if (!Number.isFinite(soc)) continue;
        const charging = this._s(car.charging)?.state === "charging";
        tiles.push({
          icon: charging ? "laadpaal" : "auto",
          colour: charging ? INK.green : "",
          // The name stays whole; the charger icon (another shape, not only another colour) says "charging".
          label: car.name,
          title: charging ? fmt(S.car_charging, { name: car.name }) : "",
          value: `${this._nf(soc, 0)} %`,
          nav: c.paths.cars,
          info: car.battery,
        });
      }
      for (const x of c.tiles) {
        const st = this._s(x.entity);
        if (!st || NO_VALUE.has(st.state)) continue;
        const v = parseFloat(st.state);
        const unit = x.unit ?? st.attributes?.unit_of_measurement ?? "";
        const value = Number.isFinite(v) && String(v) === String(st.state).trim()
          ? `${this._nf(v, unit === "°C" || unit === "°F" ? 0 : 1)}${unit === "°C" || unit === "°F" ? "°" : unit ? ` ${unit}` : ""}`
          : st.state;
        tiles.push({ icon: x.icon, label: x.label, value, info: x.entity });
      }
      return tiles.slice(0, MAX_TILES);
    }

    _home() {
      const tiles = this._tiles();
      if (!tiles.length) return "";
      // A tap: the gate acts; otherwise a path when there is one, else the entity's more-info.
      const data = (x) =>
        x.act ? `data-act="${x.act}"` : x.nav ? `data-nav="${esc(x.nav)}"` : x.info ? `data-info="${esc(x.info)}"` : "";
      return `<section class="home"><h2>${icon("huisje", 40)} ${esc(this._S.home)}</h2><div class="tiles">${tiles
        .map((x) => `<button class="tile${x.warn ? " warn" : ""}" ${data(x)}${x.title ? ` title="${esc(x.title)}" aria-label="${esc(`${x.title}: ${x.value}`)}"` : ""}>
            ${icon(x.icon, 44, x.warn ? INK.warn : x.colour || "")}
            <div><div class="v">${esc(x.value)}</div><div class="l">${esc(x.label)}</div></div>
          </button>`)
        .join("")}</div></section>`;
    }

    _energy(now, width) {
      const r = this._r;
      const S = this._S;
      const pv = this._kw(r.solar_power);
      const imp = this._kw(r.grid_import);
      const exp = this._kw(r.grid_export);
      const net = Number.isFinite(imp) ? Math.max(imp, 0) - Math.max(Number.isFinite(exp) ? exp : 0, 0) : NaN;
      let bat = this._kw(r.battery_power);
      // Positive = discharging (into the house) from here on.
      if (Number.isFinite(bat) && this._cfg.battery_sign === "charge_positive") bat = -bat;
      const role = this._kw(r.house_power);
      // House: the role (or energy-plan's sensor), else solar + grid + battery discharge when the grid is measured.
      const house = Number.isFinite(role)
        ? Math.max(role, 0)
        : Number.isFinite(net)
          ? Math.max((Number.isFinite(pv) ? Math.max(pv, 0) : 0) + net + (Number.isFinite(bat) ? bat : 0), 0)
          : NaN;
      const soc = this._n(r.battery_soc);
      const figures = [];
      if (Number.isFinite(pv)) figures.push({ icon: "zon", colour: INK.sun, value: this._nf(Math.max(pv, 0)), unit: "kW", label: S.solar });
      if (Number.isFinite(house)) figures.push({ icon: "huisje", value: this._nf(house), unit: "kW", label: S.house });
      if (Number.isFinite(net))
        figures.push({ icon: "net", colour: INK.blue, value: this._nf(Math.abs(net)), unit: "kW", label: net < -0.05 ? S.to_grid : S.from_grid });
      if (Number.isFinite(soc))
        figures.push({
          icon: "batterij",
          colour: INK.green,
          fill: soc / 100,
          value: this._nf(soc, 0),
          unit: "%",
          label: bat < -0.05 ? S.battery_charging : bat > 0.05 ? S.battery_discharging : S.battery,
        });
      const today = this._today();
      const price = this._price(now, width);
      if (!figures.length && !today && !price) return "";
      const path = this._cfg.paths.energy;
      return `<section class="energy"${path ? ` data-nav="${esc(path)}"` : ""}><h2>${icon("bliksem", 40)} ${esc(S.energy)}</h2>
        ${figures.length ? `<div class="figures" style="grid-template-columns: repeat(${Math.max(figures.length, 3)}, 1fr)">${figures
          .map((f) => `<div class="figure">
              ${f.icon === "batterij"
                ? `<cw-icoon naam="batterij" maat="48" kleur="${f.colour}" vul="${Number.isFinite(f.fill) ? f.fill : 0}"></cw-icoon>`
                : icon(f.icon, 48, f.colour)}
              <div class="v">${f.value}<small>${f.unit}</small></div><div class="l">${esc(f.label)}</div>
            </div>`)
          .join("")}</div>` : ""}
        ${today}
        ${price}
      </section>`;
    }

    // "Today: solar 3.6 of 29 kWh · grid 8.7 kWh", each part only when its meter exists.
    _today() {
      const r = this._r;
      const S = this._S;
      const solar = Number.isFinite(this._n(r.solar_today))
        ? this._n(r.solar_today)
        : parseFloat(this._s(r.solar_today_margin)?.attributes?.pv_today_kwh);
      const forecast = this._n(r.solar_forecast_today);
      const grid = this._n(r.grid_import_today);
      const parts = [];
      if (Number.isFinite(solar))
        parts.push(
          Number.isFinite(forecast)
            ? fmt(esc(S.today_solar_of), { v: `<b>${this._nf(solar)}</b>`, f: this._nf(forecast, 0) })
            : fmt(esc(S.today_solar), { v: `<b>${this._nf(solar)}</b>` }),
        );
      if (Number.isFinite(grid)) parts.push(fmt(esc(S.today_grid), { v: `<b>${this._nf(grid)}</b>` }));
      return parts.length ? `<div class="today">${esc(S.today)} ${parts.join(" · ")}</div>` : "";
    }

    // Price for the coming 12 hours (slot prices averaged per hour): black bars, the cheapest 2 h on a yellow band.
    _price(now, width) {
      const p = this._s(this._r.price);
      if (!p) return "";
      const a = p.attributes || {};
      const starts = (a.starts || []).map((s) => new Date(s));
      const vals = a.prices || a.prijzen || [];
      const hours = [];
      for (let h = 0; h < 12; h++) {
        const from = new Date(now);
        from.setMinutes(0, 0, 0);
        from.setHours(from.getHours() + h);
        const to = from.getTime() + 36e5;
        const q = vals.filter((v, i) => Number.isFinite(v) && starts[i] >= from && starts[i] < to);
        if (q.length) hours.push({ t: from, v: q.reduce((s, x) => s + x, 0) / q.length });
      }
      const nowPrice = parseFloat(p.state);
      if (!hours.length && !Number.isFinite(nowPrice)) return "";
      const best = a.cheapest_2h;
      const bs = best?.start ? new Date(best.start) : null;
      const be = best?.end ? new Date(best.end) : null;
      const hasBest = bs && be && Number.isFinite(bs.getTime()) && Number.isFinite(be.getTime()) && be > now;
      const GW = width;
      const GH = 140;
      let chart = "";
      if (hours.length) {
        const bw = GW / hours.length;
        const min = Math.min(...hours.map((u) => u.v), 0);
        const max = Math.max(...hours.map((u) => u.v), 0.01);
        const base = GH - 30;
        // Zero line at the bottom unless a price is negative: then bars go down from the zero line.
        const scale = (base - 8) / (max - min || 1);
        const zero = base + min * scale;
        const bars = hours
          .map((u, i) => {
            const h = Math.max(Math.abs(u.v) * scale, 4);
            const y = u.v >= 0 ? zero - h : zero;
            const cheap = hasBest && u.t.getTime() + 36e5 > bs.getTime() && u.t < be;
            return `${cheap ? `<rect x="${i * bw}" y="0" width="${bw}" height="${base}" fill="${INK.yellow}"/>` : ""}
              <rect x="${i * bw + 8}" y="${y}" width="${bw - 16}" height="${h}" fill="${INK.text}"/>
              ${i % 3 === 0 ? `<text x="${i * bw + bw / 2}" y="${GH - 2}" text-anchor="middle">${esc(fmt(this._S.hour_short, { h: u.t.getHours() }))}</text>` : ""}`;
          })
          .join("");
        chart = `<svg viewBox="0 0 ${GW} ${GH}" width="${GW}" height="${GH}" aria-hidden="true">${bars}
          <line x1="0" y1="${zero}" x2="${GW}" y2="${zero}" stroke="${INK.text}" stroke-width="3"/></svg>`;
      }
      return `<div class="price">
        <div class="head">${icon("euro", 40)}${Number.isFinite(nowPrice) ? `<span>${fmt(esc(this._S.price_now), { v: `<b>${this._nf(nowPrice, 2)}</b>` })}</span>` : ""}${
          hasBest ? `<span class="best">${esc(fmt(this._S.price_cheapest, { from: hhmm(bs), to: hhmm(be) }))}</span>` : ""
        }</div>
        ${chart}
      </div>`;
    }

    // ---------- layout ----------
    _render() {
      if (!this._hass || !this._cfg) return;
      this._last = Date.now();
      const now = new Date();
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.addEventListener("click", (ev) => this._onTap(ev));
      }
      const portrait = window.innerHeight > window.innerWidth;
      const W = portrait ? 1200 : 1600;
      const H = portrait ? 1600 : 1200;
      // Landscape: weather + agenda left, home + energy right; a column without blocks takes one from the other.
      // Portrait (and a page with one block): one column.
      const colW = portrait ? W - 80 : (W - 80 - 48) / 2;
      const blocks = {
        weather: this._weather(now),
        agenda: this._agenda(now),
        home: this._home(),
      };
      const one = portrait || ["weather", "agenda", "home"].filter((k) => blocks[k]).length === 0;
      blocks.energy = this._energy(now, Math.round(one ? Math.min(colW, 1000) : colW - 46));
      let left = [blocks.weather, blocks.agenda].filter(Boolean);
      let right = [blocks.home, blocks.energy].filter(Boolean);
      if (!left.length && right.length > 1) left = [right.shift()];
      if (!right.length && left.length > 1) right = [left.pop()];
      const single = portrait || !left.length || !right.length;
      const body = portrait
        ? `<div class="col">${[blocks.weather, blocks.home, blocks.energy, blocks.agenda].filter(Boolean).join("")}</div>`
        : single
          ? `<div class="col">${[...left, ...right].join("")}</div>`
          : `<div class="cols"><div class="col">${left.join("")}</div><div class="col">${right.join("")}</div></div>`;
      const html = `<style>${CSS}</style>
        <div class="screen"><div class="page${portrait ? " portrait" : ""}" style="width:${W}px;min-height:${H}px">
          ${this._header(now)}
          ${body}
        </div></div>`;
      // Same page as last time: leave the DOM alone, so the e-ink panel does not redraw (no flash, no ghosting).
      if (html !== this._html) {
        this.shadowRoot.innerHTML = html;
        this._html = html;
      }
      // Zoom to fit the window. The page is at least W x H; a house with many blocks makes it taller (portrait with
      // every module), then it shrinks a little instead of scrolling.
      const page = this.shadowRoot.querySelector(".page");
      if (page) {
        page.style.zoom = 1;
        const h = Math.max(page.offsetHeight, H);
        page.style.zoom = Math.min(window.innerWidth / W, window.innerHeight / h);
      }
    }
  }

  const CSS = `
    :host { display: block; }
    * { box-sizing: border-box; margin: 0; padding: 0; animation: none !important; transition: none !important; }
    .screen {
      position: fixed; inset: 0; z-index: 10; overflow: hidden; background: ${INK.bg};
      display: flex; align-items: center; justify-content: center;
    }
    .page {
      flex: none; background: ${INK.bg};
      color: ${INK.text}; font-family: Figtree, "Helvetica Neue", Arial, sans-serif; font-weight: 600;
      padding: 28px 40px 32px; display: flex; flex-direction: column; gap: 20px;
    }
    svg { flex: none; }
    button { font: inherit; color: inherit; background: none; border: 0; text-align: left; cursor: pointer; }
    [data-nav], [data-info], [data-act] { cursor: pointer; -webkit-tap-highlight-color: transparent; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 5px solid ${INK.text}; padding-bottom: 14px; }
    .portrait header { flex-direction: column; align-items: stretch; }
    .date { font-size: 58px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
    .date .small { display: block; font-size: 30px; font-weight: 600; letter-spacing: 0; margin-top: 8px; }
    nav { display: flex; gap: 10px; }
    .portrait nav { justify-content: space-between; }
    nav button {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      min-width: 132px; height: 96px; border: 3px solid ${INK.text}; border-radius: 16px; font-size: 26px; padding: 0 8px;
    }
    .portrait nav button { flex: 1; min-width: 0; }
    .cols { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; min-height: 0; }
    .col { flex: 1; display: flex; flex-direction: column; gap: 22px; min-height: 0; min-width: 0; }
    .portrait .col { gap: 30px; }
    h2 { font-size: 38px; font-weight: 800; display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .now { display: flex; align-items: center; gap: 24px; }
    .big { font-size: 150px; font-weight: 800; line-height: 1; letter-spacing: -4px; }
    .beside .word { font-size: 40px; font-weight: 800; }
    .sub { font-size: 34px; }
    .hours { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 18px; border-top: 3px solid ${INK.text}; padding-top: 14px; }
    .hour { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .hour .t { font-size: 30px; }
    .hour .v { font-size: 40px; font-weight: 800; }
    .hour .r { font-size: 28px; min-height: 34px; }
    .days { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; border-top: 3px solid ${INK.text}; padding-top: 14px; }
    .day { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 12px; align-items: center; }
    .day .t { grid-column: 1 / -1; font-size: 30px; }
    .day svg { grid-row: span 2; }
    .day .v { font-size: 40px; font-weight: 800; line-height: 1; }
    .day .r { font-size: 28px; }
    .agenda ul { list-style: none; display: grid; grid-template-columns: auto 1fr; gap: 10px 24px; font-size: 34px; line-height: 1.2; }
    .agenda li { display: contents; }
    .agenda li b { font-weight: 800; white-space: nowrap; }
    .agenda li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .empty { font-size: 32px; }
    .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 12px; }
    .portrait .tiles { grid-template-columns: repeat(4, 1fr); }
    .tile { display: flex; align-items: center; gap: 10px; border: 3px solid ${INK.text}; border-radius: 14px; padding: 10px 12px; min-width: 0; min-height: 76px; }
    .tile > div { min-width: 0; }
    .tile.warn { border-color: ${INK.warn}; border-width: 5px; padding: 8px 10px; }
    .tile .v { font-size: 38px; font-weight: 800; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile.warn .v { color: ${INK.warn}; }
    .tile .l { font-size: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .figures { display: grid; gap: 12px; }
    .figure { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
    .figure .v { font-size: 64px; font-weight: 800; line-height: 1; letter-spacing: -1px; }
    .figure .v small { font-size: 30px; margin-left: 4px; letter-spacing: 0; }
    .figure .l { font-size: 28px; }
    .today { font-size: 30px; margin: 10px 0 6px; }
    .price .head { display: flex; align-items: center; gap: 12px; font-size: 34px; margin-bottom: 8px; flex-wrap: wrap; }
    .price .best { margin-left: auto; background: ${INK.yellow}; padding: 2px 12px; border: 3px solid ${INK.text}; border-radius: 10px; }
    .price svg text { font: 600 26px Figtree, Arial, sans-serif; fill: ${INK.text}; }
  `;

  customElements.get("e-ink-screen-card") || customElements.define("e-ink-screen-card", EInkScreenCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "e-ink-screen-card",
    name: <@ t('card_name') | tojson @>,
    description: `v${VERSION}`,
  });
})();

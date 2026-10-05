(() => {
  const VERSION = "4";
  // Arrival card (ha-kit module tesla-route): one card per Tesla while it is on the road.
  //   home  = navigating home (binary_sensor.gate_<car>_navigating_home): arrival time, map, gate row with Open button;
  //   trip  = navigating elsewhere: collapsed card "<car> → <destination>", tap to show the map;
  //   drive = driving without navigation (shift D/R and moving).
  // Needs Teslemetry; the gate row and the "home" mode need module gate (binary_sensor.gate_<car>_navigating_home);
  // optional: the teslemetry_route integration and a Mapbox public token. Config: see lovelace/arrival.yaml.
  // Nothing about the house is built in: cars, people, gate and home come from the card config. Shows nothing while
  // no car is on the road. Colours follow the --cw-* tokens of theme Organic (module base), light and dark.
  // Re-render at most once per THROTTLE_MS on state changes; after a tap, updates render immediately for FAST_MS.
  const THROTTLE_MS = 5000;
  // User-facing texts in house.language, filled in from tesla-route/strings.yaml by tools/fill.py; {name} parts are
  // filled in by fmt().
  const S = {
    locale: <@ t('locale') | tojson @>,
    geocodeLanguage: <@ t('geocode_language') | tojson @>,
    speedUnit: <@ t('speed_unit') | tojson @>,
    and: <@ t('and') | tojson @>,
    unavailable: <@ t('map_unavailable') | tojson @>,
    destHome: <@ t('dest_home') | tojson @>,
    destWork: <@ t('dest_work') | tojson @>,
    configError: <@ t('arrival_config_error') | tojson @>,
    cardName: <@ t('arrival_card_name') | tojson @>,
    cardDescription: <@ t('arrival_card_description') | tojson @>,
    onTheWayHome: <@ t('on_the_way_home') | tojson @>,
    onTheRoad: <@ t('on_the_road') | tojson @>,
    driving: <@ t('driving') | tojson @>,
    legendDriven: <@ t('legend_driven') | tojson @>,
    legendTraffic: <@ t('legend_traffic') | tojson @>,
    sourceRoute: <@ t('source_route') | tojson @>,
    sourceTesla: <@ t('source_tesla') | tojson @>,
    sourceMapbox: <@ t('source_mapbox') | tojson @>,
    sourceOsrm: <@ t('source_osrm') | tojson @>,
    whenSoon: <@ t('when_soon') | tojson @>,
    whenWithinMinute: <@ t('when_within_minute') | tojson @>,
    whenMinutes: <@ t('when_minutes') | tojson @>,
    titleHomeOne: <@ t('title_home_one') | tojson @>,
    titleHomeMany: <@ t('title_home_many') | tojson @>,
    titleTripOne: <@ t('title_trip_one') | tojson @>,
    titleTripMany: <@ t('title_trip_many') | tojson @>,
    titleDriveOne: <@ t('title_drive_one') | tojson @>,
    titleDriveMany: <@ t('title_drive_many') | tojson @>,
    subArrival: <@ t('sub_arrival') | tojson @>,
    subInCar: <@ t('sub_in_car') | tojson @>,
    subUsualDriver: <@ t('sub_usual_driver') | tojson @>,
    subKmLeft: <@ t('sub_km_left') | tojson @>,
    subDeparted: <@ t('sub_departed') | tojson @>,
    subTraffic: <@ t('sub_traffic') | tojson @>,
    subBatteryAtArrival: <@ t('sub_battery_at_arrival') | tojson @>,
    aDestination: <@ t('a_destination') | tojson @>,
    gate: <@ t('gate') | tojson @>,
    gateMoving: <@ t('gate_moving') | tojson @>,
    gateIsOpen: <@ t('gate_is_open') | tojson @>,
    gateIsClosed: <@ t('gate_is_closed') | tojson @>,
    gateUnreachable: <@ t('gate_unreachable') | tojson @>,
    gateHandled: <@ t('gate_handled') | tojson @>,
    gateAlreadyOpen: <@ t('gate_already_open') | tojson @>,
    gateAutoOff: <@ t('gate_auto_off') | tojson @>,
    gateTestMode: <@ t('gate_test_mode') | tojson @>,
    gateNotAway: <@ t('gate_not_away') | tojson @>,
    gateOpensAt: <@ t('gate_opens_at') | tojson @>,
    buttonOpen: <@ t('button_open') | tojson @>,
    buttonClose: <@ t('button_close') | tojson @>,
    confirmOpen: <@ t('confirm_open') | tojson @>,
    confirmClose: <@ t('confirm_close') | tojson @>,
    closeReason: <@ t('close_reason') | tojson @>,
  };
  // "{who} is home {when}" + { who, when } -> text; unknown {names} stay as they are.
  const fmt = (text, values = {}) =>
    String(text).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const FAST_MS = 10000;
  // ---------- theme palette ----------
  // DARK is the fallback when the --cw-* tokens are missing (another theme); LIGHT when HA is in light mode.
  const DARK = {
    bg: "#1d1a17",
    card: "#2a2622",
    raised: "#3a3530",
    line: "#4a433c",
    text: "#F5EAD8",
    muted: "#BFB3A1",
    sun: "#E8A571",
    house: "#F5C9AE",
    car: "#AEBF92",
    accent: "#C67139",
    onAccent: "#1d1a17",
    green: "#6FBF73",
  };
  const LIGHT = { bg: "#F5EAD8", card: "#EBDDC5", raised: "#F9F3EA", line: "#D8C6A8", text: "#201E1D", muted: "#645C50", accent: "#C67139", onAccent: "#201E1D", green: "#41692F" };
  // The token names (right) belong to module base; the keys (left) are this card's own names.
  const TOKEN = { bg: "bg", card: "card", raised: "raised", line: "line", text: "text", muted: "muted", sun: "zon", house: "huis", car: "wagen", accent: "accent", onAccent: "on-accent", green: "good" };
  const C = { ...DARK };
  const lum = (h) => {
    const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim());
    if (!m) return 0;
    return [0, 2, 4]
      .map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  // Reads the tokens from the element's computed style; returns a signature to detect real changes.
  const readPalette = (el, hass) => {
    const cs = getComputedStyle(el);
    const fb = hass?.themes?.darkMode === false ? { ...DARK, ...LIGHT } : DARK;
    for (const k of Object.keys(DARK))
      C[k] = (TOKEN[k] && cs.getPropertyValue(`--cw-${TOKEN[k]}`).trim()) || fb[k];
    C.light = lum(C.bg) > 0.4;
    return Object.keys(DARK).map((k) => C[k]).join();
  };
  const hasTokens = (el) => !!getComputedStyle(el).getPropertyValue("--cw-bg").trim();
  const themeKey = (hass) =>
    `${hass?.themes?.darkMode}|${hass?.themes?.theme}|${hass?.selectedTheme?.theme}`;
  const tileUrl = (token) =>
    token
      ? `https://api.mapbox.com/styles/v1/mapbox/${C.light ? "navigation-day-v1" : "navigation-night-v1"}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`
      : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  // Tesla favourites come in English; shown in house.language. The country suffix adds nothing.
  const DEST_NAMES = { Home: S.destHome, Work: S.destWork };
  const cleanDest = (s) => {
    const t = String(s || "")
      .replace(/,\s*(Belgium|België|Belgique)$/i, "")
      .trim();
    return DEST_NAMES[t] || t;
  };
  const RIDER_M = 300; // phone within this distance of the car (at the phone's fix time) = in the car
  // home = navigating home (arrival card); trip = navigating elsewhere; drive = in D/R and moving, no navigation.
  const carMode = (states, c) => {
    const st = (id) => states[id]?.state;
    // A sleeping car is never on the road; after an HA restart its old navigation values are restored as-is.
    if (st(c.online) === "off") return null;
    if (st(c.nav) === "on") return "home";
    const d = st(c.dist);
    if (d !== undefined && d !== "unknown" && d !== "unavailable")
      return "trip";
    const shift = String(st(c.shift) || "").toLowerCase();
    const loc = states[c.loc];
    const moved = loc && Date.now() - Date.parse(loc.last_updated) < 3 * 60000;
    return (shift === "d" || shift === "r") && moved ? "drive" : null;
  };
  const distM = (a, b) => {
    const r = Math.PI / 180;
    const h =
      Math.sin(((b[0] - a[0]) * r) / 2) ** 2 +
      Math.cos(a[0] * r) *
        Math.cos(b[0] * r) *
        Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  // Generic destination pin for trips that do not end at home.
  const DEST_PIN = `<svg width="28" height="34" viewBox="0 0 28 34" aria-hidden="true"><path d="M14 33 C14 33 3 20 3 12 A11 11 0 0 1 25 12 C25 20 14 33 14 33 Z" fill="#E8A571" stroke="#1d1a17" stroke-width="2"/><circle cx="14" cy="12" r="4" fill="#1d1a17"/></svg>`;
  const TRIP_GAP_MS = 10 * 60000; // a pause in position updates longer than this marks the start of the trip
  const ROUTE_REFRESH_MS = 120000; // expected route (OSRM) is recalculated at most this often
  const TRAIL_REFRESH_MS = 300000; // driven trail is reloaded from the recorder at most this often
  const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  // Subresource Integrity: the browser refuses Leaflet when cdnjs serves anything other than exactly these files
  // (hashes from the cdnjs SRI list, checked against the downloaded files). New Leaflet version = new hashes.
  const LEAFLET_JS_SRI =
    "sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==";
  const LEAFLET_CSS_SRI =
    "sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==";
  let leafletJs, leafletCss;
  const loadLeaflet = () =>
    leafletJs ||
    (leafletJs = new Promise((ok, fail) => {
      if (window.L?.map) return ok(window.L);
      const s = document.createElement("script");
      s.src = `${LEAFLET}leaflet.min.js`;
      s.integrity = LEAFLET_JS_SRI;
      s.crossOrigin = "anonymous";
      s.referrerPolicy = "no-referrer";
      s.onload = () => ok(window.L);
      s.onerror = () => {
        leafletJs = null;
        fail(new Error("Leaflet not loaded"));
      };
      document.head.appendChild(s);
    }));
  // Plain house for the destination (no circle); dark outline keeps it visible on any map.
  const HOUSE_PIN = `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 16 L16 4 L29 16 H25 V29 H7 V16 Z" fill="#F5C9AE" stroke="#1d1a17" stroke-width="2" stroke-linejoin="round"/><path d="M13 29 V20 H19 V29" fill="#1d1a17"/></svg>`;
  // Car badges come from tesla-map-card.js (window.CW_TESLA_BADGES) so both maps share one drawing; without it, a round
  // badge with the car's initial in the car's colour.
  const genericBadge = (name, color, size = 38) =>
    `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="${C.card}" stroke="${color}" stroke-width="3"/><text x="24" y="31" text-anchor="middle" font-family="Figtree, system-ui, sans-serif" font-size="20" font-weight="700" fill="${color}">${esc(String(name || "?").trim().charAt(0).toUpperCase())}</text></svg>`;
  // Config `badge`: an example name from tesla-map-card.js (lightning, plaid) or your own <svg>; else the badge that
  // tesla-map-card.js registered for this car; else a circle with the initial.
  const carPin = (c) => {
    const ex = window.CW_TESLA_BADGE_EXAMPLES?.[c.badge];
    const own = String(c.badge || "").trim().startsWith("<svg") ? c.badge : null;
    const svg = (typeof ex === "function" ? ex(c.color || C.car) : null) || own || window.CW_TESLA_BADGES?.[c.p];
    return svg
      ? svg.replace('width="44" height="44"', 'width="38" height="38"')
      : genericBadge(c.name, c.color || C.car);
  };
  // Expected route coloured by Mapbox congestion per segment, in the same palette as the navigation-night traffic layer.
  const TRAFFIC = {
    low: "#2fbfa6",
    moderate: "#f5a524",
    heavy: "#f2622e",
    severe: "#d93636",
    unknown: "#9aa5b1",
  };
  const loadLeafletCss = () =>
    leafletCss ||
    (leafletCss = fetch(`${LEAFLET}leaflet.min.css`, {
      integrity: LEAFLET_CSS_SRI,
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => ""));
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const nf = (v, d = 1) =>
    Number.isFinite(v)
      ? v.toLocaleString(S.locale, {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        })
      : "–";
  const hhmm = (d) =>
    d.toLocaleTimeString(S.locale, { hour: "2-digit", minute: "2-digit" });
  const svg = (
    w,
    h,
    vb,
    body,
    attrs = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',
  ) =>
    `<svg width="${w}" height="${h}" viewBox="${vb}" ${attrs} aria-hidden="true">${body}</svg>`;
  const I = {
    gate: (s = 22) =>
      svg(
        s,
        s,
        "0 0 24 24",
        '<path d="M3 21 V6 M21 21 V6 M3 9 H21 M3 15 H21 M8 9 V21 M12 9 V21 M16 9 V21"/>',
      ),
  };
  class TeslaArrivalCard extends HTMLElement {
    // cars: [{ p, name, called, driver, color, badge, entities }] (p = entity prefix of the car, called = the name
    // with its article inside a sentence, e.g. "the Red X" (default: the name), driver = person key);
    // people: [{ name, key, tracker }]; home: zone of home (default zone.home); mapbox_token: public pk.* token;
    // routing: auto (default: Mapbox with a token, else OSRM) or none (no route or place-name requests leave the
    // browser; the Tesla's own route is still drawn, grey);
    // gate (optional, module gate): { sensor, relay, open_script, close_script, enabled, dry_run, last, zone,
    // away_minutes, far_distance } with the ha-kit entity_ids as defaults.
    setConfig(config) {
      if (!Array.isArray(config?.cars) || !config.cars.length)
        throw new Error(S.configError);
      this._cfg = { ...config };
      this._routing = String(config.routing ?? "auto").toLowerCase() !== "none";
      this._home = config.home || "zone.home";
      this._cars = config.cars.map((a, i) => {
        const p = a.p;
        return {
          name: a.name || p,
          called: a.called || a.name || p,
          p,
          // driver: who usually drives this car; named when no phone is seen in the car (see _whoDrives).
          driver: a.driver || null,
          // Own colour, else a fixed slot of the palette (resolved at draw time, so it follows the theme).
          color: a.color || ["#AEBF92", "#E8A571", "#8FA3B8", "#F5C9AE"][i % 4],
          badge: a.badge,
          nav: `binary_sensor.gate_${p}_navigating_home`,
          away: `binary_sensor.gate_${p}_away_long_enough`,
          loc: `device_tracker.${p}_location`,
          dest: `device_tracker.${p}_route`,
          eta: `sensor.${p}_time_to_arrival`,
          dist: `sensor.${p}_distance_to_arrival`,
          delay: `sensor.${p}_traffic_delay`,
          socArr: `sensor.${p}_state_of_charge_at_arrival`,
          // The car's own planned route (custom integration teslemetry_route, Fleet Telemetry RouteLine).
          route: `sensor.${p}_tesla_route`,
          // Defaults are the English Teslemetry names and the ids of module gate; the kit passes the real ids.
          destName: `sensor.${p}_destination`,
          shift: `sensor.${p}_shift_state`,
          speed: `sensor.${p}_speed`,
          online: `binary_sensor.${p}_status`,
          // Override single entity_ids, e.g. { loc: "device_tracker.<car>_location" } in an English installation.
          ...(a.entities || {}),
        };
      });
      // Phones (HA companion app) used to show who is in which car.
      this._people = (config.people || []).map((x) => ({
        name: x.name,
        key: x.key,
        tracker: x.tracker,
      }));
      // Gate row only with a `gate` block (module gate installed). Without `sensor` the state is unknown.
      const g = config.gate;
      this._gate = g
        ? {
            door: g.sensor || null,
            relay: g.relay || null,
            enabled: g.enabled || "input_boolean.gate_auto_open_enabled",
            dryRun: g.dry_run || "input_boolean.gate_auto_open_dry_run",
            last: g.last || "input_datetime.gate_last_auto_open",
            open: g.open_script || "script.gate_open_manual",
            close: g.close_script || "script.gate_close_manual",
            zone: g.zone || "zone.gate_approach",
            awayMin: g.away_minutes || "input_number.gate_away_minutes",
            far: g.far_distance || "input_number.gate_far_distance",
          }
        : null;
      this._watch = [
        ...this._cars.flatMap((c) => [
          c.nav,
          c.away,
          c.eta,
          c.dist,
          c.delay,
          c.socArr,
          c.route,
          c.destName,
          c.shift,
          c.speed,
          c.online,
        ]),
        ...Object.values(this._gate || {}),
      ].filter(Boolean);
      this._sig = null;
    }
    getCardSize() {
      return 6;
    }
    set hass(hass) {
      this._hass = hass;
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
      }
      const tk = themeKey(hass);
      if (tk !== this._tk) {
        this._tk = tk;
        this._tries = 0;
        // Right away with the fallback of HA's light/dark mode, then again once the view theme is applied.
        readPalette(this, hass);
        clearTimeout(this._tkTimer);
        this._tkTimer = setTimeout(() => this._retheme(), 60);
      }
      // Car positions only count while that car is on the road, otherwise every position update would re-render.
      const moving = this._cars.filter((c) => carMode(hass.states, c));
      const live = moving.length
        ? [...moving.map((c) => c.loc), ...this._people.map((p) => p.tracker)]
        : [];
      const sig = [...this._watch, ...live]
        .map((id) => hass.states[id]?.last_updated)
        .join("|");
      if (sig === this._sig) return;
      this._sig = sig;
      this._schedule();
    }
    // First render immediately, then at most once per THROTTLE_MS; the pending render always uses the latest hass.
    _schedule() {
      const fast = Date.now() < (this._fastUntil || 0);
      const wait = fast
        ? 0
        : (this._lastRender || 0) + THROTTLE_MS - Date.now();
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
    // Style and outer wrapper are built once; each render only replaces the wrapper's content.
    _wrap() {
      if (!this._wrapEl) {
        this.shadowRoot.innerHTML = `<style class="cw">${css()}</style><div class="wrap"></div>`;
        this._wrapEl = this.shadowRoot.querySelector(".wrap");
      }
      return this._wrapEl;
    }
    // Theme changed: re-read the tokens, restyle, swap the map tiles (day/night) and redraw lines and badges.
    _retheme() {
      clearTimeout(this._tkTimer);
      // The view theme can arrive later than the first hass: retry until the --cw-* tokens are there (max ±10 s).
      if (!hasTokens(this) && (this._tries = (this._tries || 0) + 1) < 40)
        this._tkTimer = setTimeout(() => this._retheme(), 250);
      const pal = readPalette(this, this._hass);
      if (pal === this._pal) return;
      this._pal = pal;
      const style = this.shadowRoot?.querySelector("style.cw");
      if (style) style.textContent = css();
      for (const st of Object.values(this._arr || {})) {
        if (!st.map) continue;
        st.tiles?.setUrl(tileUrl(this._cfg.mapbox_token));
        st.el.classList.toggle("osm", !this._cfg.mapbox_token && !C.light);
        st.trailLine.setStyle({ color: C.text });
        st.planDrawn = null;
        st.badged = false;
        this._updateArrival(st.c, st);
      }
    }
    connectedCallback() {
      clearInterval(this._clock);
      // Every minute: "in 12 min" counts down even when no state changes.
      this._clock = setInterval(() => this._hass && this._render(), 60000);
      if (this._hass && this.shadowRoot && !this._throttle) this._schedule();
    }
    disconnectedCallback() {
      clearInterval(this._clock);
      this._clock = null;
      clearTimeout(this._throttle);
      this._throttle = null;
    }
    _n(id) {
      const v = parseFloat(this._hass.states[id]?.state);
      return Number.isFinite(v) ? v : NaN;
    }
    _s(id) {
      return this._hass.states[id]?.state;
    }
    _a(id, k) {
      return this._hass.states[id]?.attributes?.[k];
    }
    _ok(id) {
      const s = this._s(id);
      return s !== undefined && s !== "unknown" && s !== "unavailable";
    }
    _render() {
      if (!this._hass || !this._cfg) return;
      this._lastRender = Date.now();
      const onRoad = this._cars
        .map((c) => ({ ...c, mode: carMode(this._hass.states, c) }))
        .filter((c) => c.mode);
      const arriving = onRoad.filter((c) => c.mode === "home");
      const trips = onRoad.filter((c) => c.mode !== "home");
      // No car on the road: the card takes no space on the dashboard.
      this.style.display = onRoad.length ? "" : "none";
      this._wrap().innerHTML = `${arriving.length ? `<div class="arrives ${arriving.length > 1 ? "duo" : ""}">${arriving.map((c) => `<div class="arrive-slot" data-car="${c.p}"></div>`).join("")}</div>` : ""}
${trips.length ? `<div class="trips">${trips.map((c) => `<div class="arrive-slot" data-car="${c.p}"></div>`).join("")}</div>` : ""}`;
      this._mountArrivals(onRoad);
    }
    // ---- Arrival card -------------------------------------------------------------------------------
    // One persistent element per car: it survives the innerHTML re-render, so the Leaflet map is built once.
    _mountArrivals(arriving) {
      this._arr = this._arr || {};
      for (const c of arriving) {
        if (this._arr[c.p] && this._arr[c.p].mode !== c.mode) {
          this._arr[c.p].map?.remove();
          delete this._arr[c.p];
        }
        const st = this._arr[c.p] || (this._arr[c.p] = this._newArrival(c));
        st.c = c;
        const slot = this._wrapEl.querySelector(
          `.arrive-slot[data-car="${c.p}"]`,
        );
        if (slot) slot.replaceWith(st.el);
        this._updateArrival(c, st);
      }
      for (const p of Object.keys(this._arr)) {
        if (arriving.some((c) => c.p === p)) continue;
        this._arr[p].map?.remove();
        delete this._arr[p];
      }
    }
    _newArrival(c) {
      const home = c.mode === "home";
      const el = document.createElement("div");
      el.className = `card arrive ${home ? "" : "trip"}`;
      this._open = this._open || new Set();
      el.classList.toggle("open", home || this._open.has(c.p));
      const head = home
        ? `<span class="lbl"><span>${esc(S.onTheWayHome)}</span><span class="tag">${esc(c.name)}</span></span>`
        : `<button class="lbl trip-head" data-act="trip" data-car="${c.p}" aria-expanded="false"><span>${esc(c.mode === "trip" ? S.onTheRoad : S.driving)}</span><span class="tag">${esc(c.name)} <i class="chev">›</i></span></button>`;
      el.innerHTML = `<style></style>
${head}
<div class="arr-top" ${home ? "" : `data-act="trip" data-car="${c.p}"`}><span class="eta-box"><b class="eta">–</b><span class="spd"></span></span><span class="t"><b class="arr-title"></b><span class="muted arr-sub"></span></span></div>
${home && this._gate ? `<div class="gate"><span class="gic">${I.gate()}</span><span class="t"><b class="g-title"></b><span class="muted g-sub"></span></span><button class="gbtn" data-act="gate">${esc(S.buttonOpen)}</button></div>` : ""}
<div class="trip-body">
<div class="map"></div>
<span class="small muted arr-legend"><i class="ln"></i>${esc(S.legendDriven)}${c.mode === "drive" ? "" : `<i class="ln traffic"></i><span><span class="arr-src">${esc(S.sourceRoute)}</span>: ${esc(S.legendTraffic)}</span>`}</span>
</div>`;
      const st = {
        el,
        mode: c.mode,
        c,
        trail: [],
        plan: null,
        departed: null,
        routeAt: 0,
        trailAt: 0,
        fitted: false,
      };
      loadLeafletCss().then((css) => {
        el.querySelector("style").textContent = css;
      });
      // A collapsed trip card builds its map only when opened: Leaflet loses its layers when started at size 0.
      if (home || this._open.has(c.p)) this._ensureMap(c, st);
      return st;
    }
    _ensureMap(c, st) {
      if (st.mapStarted) return;
      st.mapStarted = true;
      loadLeaflet()
        .then((L) => this._initMap(c, st, L))
        .catch(() => {
          const box = st.el.querySelector(".map");
          if (box)
            box.outerHTML = `<span class="small muted">${esc(S.unavailable)}</span>`;
        });
    }
    _initMap(c, st, L) {
      const box = st.el.querySelector(".map");
      if (!box || this._arr?.[c.p] !== st) return;
      const map = L.map(box, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile,
      });
      // Start with a view right away: paths added to a map without a view crash in Leaflet's clipping.
      const startLat = this._a(c.loc, "latitude");
      const startLon = this._a(c.loc, "longitude");
      const homeLat = this._a(this._home, "latitude");
      const homeLon = this._a(this._home, "longitude");
      map.setView(
        Number.isFinite(startLat) && Number.isFinite(startLon)
          ? [startLat, startLon]
          : [homeLat || 0, homeLon || 0],
        12,
      );
      map.attributionControl.setPrefix(false);
      // Mapbox navigation-night/-day (with live traffic) when the card config has mapbox_token (public pk.* token),
      // otherwise OpenStreetMap, darkened by CSS in dark mode.
      const token = this._cfg.mapbox_token;
      st.el.classList.toggle("osm", !token && !C.light);
      st.tiles = L.tileLayer(
        tileUrl(token),
        token
          ? {
              tileSize: 512,
              zoomOffset: -1,
              maxZoom: 20,
              attribution:
                '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            }
          : {
              maxZoom: 19,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
                (this._routing ? " · route OSRM" : ""),
            },
      ).addTo(map);
      st.L = L;
      st.map = map;
      st.planGroup = L.layerGroup().addTo(map);
      st.trailLine = L.polyline([], {
        color: C.text,
        weight: 5,
        opacity: 0.9,
      }).addTo(map);
      st.home = L.marker([0, 0], {
        icon:
          c.mode === "home"
            ? L.divIcon({
                className: "house",
                html: HOUSE_PIN,
                iconSize: [30, 30],
                iconAnchor: [15, 26],
              })
            : L.divIcon({
                className: "house",
                html: DEST_PIN,
                iconSize: [28, 34],
                iconAnchor: [14, 33],
              }),
        keyboard: false,
      }).addTo(map);
      st.car = L.marker([0, 0], {
        icon: this._carIcon(c, st),
        keyboard: false,
        zIndexOffset: 100,
      }).addTo(map);
      this._updateArrival(c, st);
    }
    _carIcon(c, st) {
      st.badged = Boolean(c.badge || window.CW_TESLA_BADGES?.[c.p]);
      return st.L.divIcon({
        className: "carpin",
        html: carPin(c),
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
    }
    // Draw the expected route as runs of equal congestion (dashed grey when there is no traffic data, e.g. OSRM).
    _drawPlan(st) {
      st.planGroup.clearLayers();
      const pts = st.plan || [];
      if (pts.length < 2) return;
      // Dark casing under the whole route so it stands out from the traffic colours of the roads.
      st.L.polyline(pts, { color: "#14110f", weight: 10, opacity: 0.85 }).addTo(
        st.planGroup,
      );
      const cong = st.cong || [];
      let start = 0;
      for (let i = 1; i <= pts.length - 1; i++) {
        const lvl = cong[i - 1] || "none";
        const next = i < pts.length - 1 ? cong[i] || "none" : null;
        if (next === lvl) continue;
        st.L.polyline(pts.slice(start, i + 1), {
          color: lvl === "none" ? C.muted : TRAFFIC[lvl] || TRAFFIC.unknown,
          weight: 6,
          opacity: 1,
          dashArray: lvl === "none" ? "6 8" : null,
        }).addTo(st.planGroup);
        start = i;
      }
    }
    _updateArrival(c, st) {
      const now = Date.now();
      const eta = new Date(this._s(c.eta));
      const etaOk = this._ok(c.eta) && !isNaN(eta);
      const mins = etaOk ? Math.max(0, Math.round((eta - now) / 60000)) : NaN;
      const km = this._n(c.dist);
      const delay = this._n(c.delay);
      const socA = this._n(c.socArr);
      const mode = st.mode;
      const when = !etaOk
        ? S.whenSoon
        : mins < 1
          ? S.whenWithinMinute
          : fmt(S.whenMinutes, { min: mins });
      const speed = this._n(c.speed);
      const destName = this._destName(c);
      st.el.querySelector(".eta").textContent =
        mode === "drive"
          ? Number.isFinite(speed)
            ? `${nf(speed, 0)} ${S.speedUnit}`
            : "–"
          : etaOk
            ? hhmm(eta)
            : "–";
      // Current speed under the arrival time; in drive mode the speed is already the big number.
      st.el.querySelector(".spd").textContent =
        mode !== "drive" && Number.isFinite(speed)
          ? `${nf(speed, 0)} ${S.speedUnit}`
          : "";
      // Tesla does not report who drives (only seat occupancy), so the card names the people whose phones ride along;
      // without a matching phone it falls back to the car's name.
      const { riders, usual } = this._whoDrives(c, st);
      st.riders = riders;
      const who = riders.length ? riders.join(` ${S.and} `) : c.name;
      const many = riders.length > 1;
      st.el.querySelector(".arr-title").textContent =
        mode === "home"
          ? fmt(many ? S.titleHomeMany : S.titleHomeOne, { who, when })
          : mode === "trip"
            ? riders.length
              ? fmt(many ? S.titleTripMany : S.titleTripOne, { who, dest: destName })
              : `${c.name} → ${destName}`
            : fmt(many ? S.titleDriveMany : S.titleDriveOne, { who });
      st.el.querySelector(".arr-sub").textContent = [
        mode === "trip" && etaOk ? fmt(S.subArrival, { when }) : null,
        riders.length
          ? fmt(S.subInCar, { car: c.name, the_car: c.called }) + (usual ? ` ${S.subUsualDriver}` : "")
          : null,
        Number.isFinite(km) && mode !== "drive" ? fmt(S.subKmLeft, { km: nf(km) }) : null,
        st.departed ? fmt(S.subDeparted, { time: hhmm(new Date(st.departed)) }) : null,
        delay > 0 ? fmt(S.subTraffic, { min: nf(delay, 0) }) : null,
        Number.isFinite(socA) ? fmt(S.subBatteryAtArrival, { soc: nf(socA, 0) }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (mode === "home" && this._gate) this._updateGate(c, st);
      const ll = (id) => {
        const la = this._a(id, "latitude");
        const lo = this._a(id, "longitude");
        return Number.isFinite(la) && Number.isFinite(lo) ? [la, lo] : null;
      };
      const here = ll(c.loc);
      // The route tracker keeps the last destination after navigation ends: ignore it without navigation.
      const dest = mode === "drive" ? null : ll(c.dest);
      if (here) {
        const last = st.trail[st.trail.length - 1];
        if (!last || last.ll[0] !== here[0] || last.ll[1] !== here[1])
          st.trail.push({ t: now, ll: here });
      }
      if (now - st.trailAt > TRAIL_REFRESH_MS) {
        st.trailAt = now;
        this._loadTrail(c, st);
      }
      // Reload the expected route when the Tesla sends a new one, and otherwise every ROUTE_REFRESH_MS (traffic).
      const teslaAt = this._a(c.route, "updated");
      if (teslaAt !== st.teslaAt) {
        st.teslaAt = teslaAt;
        st.routeAt = 0;
      }
      if (here && dest && now - st.routeAt > ROUTE_REFRESH_MS) {
        st.routeAt = now;
        this._loadRoute(c, st, here, dest);
      }
      if (!st.map) return;
      st.map.invalidateSize();
      const src = st.el.querySelector(".arr-src");
      if (src && st.source) src.textContent = st.source;
      if (!st.badged && window.CW_TESLA_BADGES?.[c.p])
        st.car.setIcon(this._carIcon(c, st));
      if (here) st.car.setLatLng(here);
      if (dest) st.home.setLatLng(dest);
      st.trailLine.setLatLngs(st.trail.map((p) => p.ll));
      if (st.planDrawn !== st.plan) {
        this._drawPlan(st);
        st.planDrawn = st.plan;
      }
      if (dest) st.home.setOpacity(1);
      else st.home.setOpacity(0);
      // Fit only while the map is visible (a collapsed trip card has a map of size 0).
      if (
        !st.fitted &&
        here &&
        (dest || mode === "drive") &&
        st.map.getContainer().offsetHeight > 0
      ) {
        const pts = [
          ...st.trail.map((p) => p.ll),
          ...(st.plan || []),
          here,
          ...(dest ? [dest] : []),
        ];
        st.map.fitBounds(st.L.latLngBounds(pts), {
          padding: [24, 24],
          maxZoom: 15,
        });
        st.fitted = true;
      }
    }
    // Destination label: the Tesla's name (favourites translated), otherwise the place from Mapbox reverse
    // geocoding of the destination coordinates (cached per coordinate), otherwise a neutral text.
    _destName(c) {
      if (this._ok(c.destName)) return cleanDest(this._s(c.destName));
      const la = this._a(c.dest, "latitude");
      const lo = this._a(c.dest, "longitude");
      const token = this._routing ? this._cfg.mapbox_token : null;
      if (!token || !Number.isFinite(la) || !Number.isFinite(lo))
        return S.aDestination;
      this._geo = this._geo || new Map();
      const key = `${la.toFixed(4)},${lo.toFixed(4)}`;
      if (!this._geo.has(key)) {
        this._geo.set(key, null);
        fetch(
          `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lo}&latitude=${la}&language=${encodeURIComponent(S.geocodeLanguage)}&limit=1&access_token=${encodeURIComponent(token)}`,
        )
          .then((r) => r.json())
          .then((r) => {
            const p = r?.features?.[0]?.properties;
            const place = p?.context?.place?.name;
            const name = p
              ? place && place !== p.name
                ? `${p.name}, ${place}`
                : p.name
              : null;
            this._geo.set(key, name || S.aDestination);
            this._render();
          })
          .catch(() => this._geo.set(key, S.aDestination));
      }
      return this._geo.get(key) || S.aDestination;
    }
    // Phones in the car first; without one, the car's usual driver, unless that person's phone is fresh (then it
    // shows them elsewhere). A phone that stopped reporting (location only "while in use") cannot rule them out.
    _whoDrives(c, st) {
      const riders = this._riders(c, st);
      if (riders.length || !c.driver) return { riders, usual: false };
      const p = this._people.find(
        (x) => x.key === c.driver || x.name === c.driver,
      );
      const s = p && this._hass.states[p.tracker];
      const fresh = s && Date.now() - Date.parse(s.last_updated) < 20 * 60000;
      return fresh
        ? { riders, usual: false }
        : { riders: [p ? p.name : c.driver], usual: true };
    }
    // Who is in this car: a phone counts when its last fix lies within RIDER_M of where the car was at that moment
    // (from the trip trail, so a phone that updates only every few minutes is still compared fairly).
    _riders(c, st) {
      const out = [];
      for (const p of this._people) {
        const s = this._hass.states[p.tracker];
        const la = s?.attributes?.latitude;
        const lo = s?.attributes?.longitude;
        if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
        // A phone at home is never in a car on the road (an arriving car passes close to the house).
        if (s.state === "home") continue;
        const t = Date.parse(s.last_updated);
        if (!(Date.now() - t < 20 * 60000)) continue;
        let ref = null;
        for (const q of st.trail)
          if (!ref || Math.abs(q.t - t) < Math.abs(ref.t - t)) ref = q;
        const at = ref && Math.abs(ref.t - t) < 5 * 60000 ? ref.ll : null;
        const now = [this._a(c.loc, "latitude"), this._a(c.loc, "longitude")];
        const pos =
          at ||
          (Number.isFinite(now[0]) && Date.now() - t < 3 * 60000 ? now : null);
        if (pos && distM(pos, [la, lo]) < RIDER_M) out.push(p.name);
      }
      return out;
    }
    // Gate status for this arrival: what the gate is now and whether automation.gate_auto_open will open it.
    _updateGate(c, st) {
      const g = this._gate;
      const hasDoor = Boolean(g.door);
      const door = hasDoor ? this._s(g.door) : null;
      const moving = Boolean(g.relay) && this._s(g.relay) === "on";
      const title = moving
        ? S.gateMoving
        : !hasDoor
          ? S.gate
          : door === "on"
            ? S.gateIsOpen
            : door === "off"
              ? S.gateIsClosed
              : S.gateUnreachable;
      const lastTs = this._a(g.last, "timestamp");
      const recent =
        Number.isFinite(lastTs) && Date.now() / 1000 - lastTs < 600;
      // The rule is per car (automation.gate_auto_open): navigating home and away long enough.
      // An unreachable gate state does not stop the automatic opening; only "open" does.
      let sub;
      if (recent)
        sub = fmt(S.gateHandled, { time: hhmm(new Date(lastTs * 1000)) });
      else if (door === "on") sub = S.gateAlreadyOpen;
      else if (this._s(g.enabled) !== "on") sub = S.gateAutoOff;
      else if (this._s(g.dryRun) === "on") sub = S.gateTestMode;
      else if (this._s(c.away) !== "on")
        sub = fmt(S.gateNotAway, {
          car: c.name,
          the_car: c.called,
          min: nf(this._n(g.awayMin), 0),
          km: nf(this._n(g.far) / 1000),
        });
      else sub = fmt(S.gateOpensAt, { m: nf(this._a(g.zone, "radius"), 0) });
      st.el.querySelector(".g-title").textContent = title;
      st.el.querySelector(".g-sub").textContent = sub;
      st.el.querySelector(".gate").classList.toggle("open", door === "on");
      // Open gate: the button closes it (override); otherwise it opens.
      const btn = st.el.querySelector(".gbtn");
      btn.hidden = moving;
      btn.textContent = door === "on" ? S.buttonClose : S.buttonOpen;
      btn.dataset.act = door === "on" ? "gate-close" : "gate";
    }
    // Driven trail = recorder history of the car since its last stop (a gap > TRIP_GAP_MS between position updates).
    async _loadTrail(c, st) {
      try {
        const start = new Date(Date.now() - 6 * 3600000).toISOString();
        const res = await this._hass.callApi(
          "GET",
          `history/period/${start}?filter_entity_id=${c.loc}&significant_changes_only=0`,
        );
        const pts = (res?.[0] || [])
          .filter(
            (s) =>
              Number.isFinite(s.attributes?.latitude) &&
              Number.isFinite(s.attributes?.longitude),
          )
          .map((s) => ({
            t: Date.parse(s.last_updated),
            ll: [s.attributes.latitude, s.attributes.longitude],
          }));
        let i = pts.length - 1;
        while (i > 0 && pts[i].t - pts[i - 1].t < TRIP_GAP_MS) i--;
        if (pts.length) {
          st.departed = pts[i].t;
          st.trail = pts.slice(i > 0 ? i - 1 : 0);
          st.fitted = false;
        }
      } catch (e) {}
      if (this._arr?.[c.p] === st) this._updateArrival(c, st);
    }
    // Expected rest of the route from the car to the Tesla's destination. In order of preference:
    // 1. the Tesla's own route (sensor.<car>_tesla_route) from the point nearest the car, coloured with traffic via
    //    Mapbox Map Matching; grey when matching is not possible;
    // 2. Mapbox Directions (driving-traffic) with a token;
    // 3. the public OSRM demo server.
    async _loadRoute(c, st, from, to) {
      const token = this._routing ? this._cfg.mapbox_token : null;
      const tesla = this._a(c.route, "route");
      if (Array.isArray(tesla) && tesla.length > 1) {
        const d2 = (p) =>
          (p[0] - from[0]) ** 2 +
          ((p[1] - from[1]) * Math.cos((from[0] * Math.PI) / 180)) ** 2;
        let k = 0;
        tesla.forEach((p, i) => {
          if (d2(p) < d2(tesla[k])) k = i;
        });
        const rest = [from, ...tesla.slice(k + 1)];
        st.plan = rest;
        st.cong = Array(rest.length - 1).fill("unknown");
        st.source = S.sourceTesla;
        st.fitted = false;
        if (token && rest.length > 1) {
          try {
            // Map Matching takes at most 100 coordinates: sample the route evenly, keep both ends.
            const n = Math.min(100, rest.length);
            const sample = Array.from(
              { length: n },
              (_, i) => rest[Math.round((i * (rest.length - 1)) / (n - 1))],
            );
            const coords = sample
              .map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`)
              .join(";");
            const url = `https://api.mapbox.com/matching/v5/mapbox/driving-traffic/${coords}?geometries=geojson&overview=full&annotations=congestion&tidy=true&access_token=${encodeURIComponent(token)}`;
            const r = await (await fetch(url)).json();
            const matches = Array.isArray(r?.matchings) ? r.matchings : [];
            const line = matches.flatMap((m) => m.geometry?.coordinates || []);
            const cong = matches.flatMap((m) =>
              (m.legs || []).flatMap((l) => l.annotation?.congestion || []),
            );
            if (
              line.length > 1 &&
              cong.length === line.length - matches.length
            ) {
              // Several matchings are joined by a gap segment without traffic data.
              const joined = [];
              let ci = 0;
              matches.forEach((m, mi) => {
                const len = (m.geometry?.coordinates || []).length;
                for (let j = 0; j < len - 1; j++) joined.push(cong[ci++]);
                if (mi < matches.length - 1) joined.push("unknown");
              });
              st.plan = line.map(([lo, la]) => [la, lo]);
              st.cong = joined;
              st.source = S.sourceTesla;
            }
          } catch (e) {}
        }
        if (this._arr?.[c.p] === st) this._updateArrival(c, st);
        return;
      }
      if (!this._routing) return; // routing: none, no Mapbox Directions or OSRM
      try {
        const pts = `${from[1]},${from[0]};${to[1]},${to[0]}`;
        const url = token
          ? `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${pts}?overview=full&geometries=geojson&annotations=congestion&access_token=${encodeURIComponent(token)}`
          : `https://router.project-osrm.org/route/v1/driving/${pts}?overview=full&geometries=geojson`;
        const r = await (await fetch(url)).json();
        const route = r?.routes?.[0];
        const line = route?.geometry?.coordinates;
        if (Array.isArray(line) && line.length) {
          st.cong = (route.legs || []).flatMap(
            (l) => l.annotation?.congestion || [],
          );
          st.plan = line.map(([lo, la]) => [la, lo]);
          st.source = token ? S.sourceMapbox : S.sourceOsrm;
          st.fitted = false;
        }
      } catch (e) {}
      if (this._arr?.[c.p] === st) this._updateArrival(c, st);
    }
    _onClick(ev) {
      const el = ev.composedPath().find((n) => n.dataset && n.dataset.act);
      if (!el) return;
      const { act } = el.dataset;
      this._fastUntil = Date.now() + FAST_MS;
      if (act === "trip") {
        const p = el.dataset.car;
        const st = this._arr?.[p];
        this._open = this._open || new Set();
        if (this._open.has(p)) this._open.delete(p);
        else this._open.add(p);
        if (st) {
          const open = this._open.has(p);
          st.el.classList.toggle("open", open);
          st.el
            .querySelector(".trip-head")
            ?.setAttribute("aria-expanded", String(open));
          st.fitted = false;
          if (open) this._ensureMap(st.c, st);
          requestAnimationFrame(() => this._updateArrival(st.c, st));
        }
        return;
      }
      if (act === "gate" && this._gate) {
        if (!confirm(S.confirmOpen)) return;
        this._hass.callService("script", "turn_on", {
          entity_id: this._gate.open,
        });
        return;
      }
      if (act === "gate-close" && this._gate) {
        if (!confirm(S.confirmClose)) return;
        this._hass.callService("script", "turn_on", {
          entity_id: this._gate.close,
          variables: { reason: S.closeReason },
        });
        return;
      }
    }
  }
  const css = () => `
:host { display: block; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; text-align: left; }
button:focus-visible { outline: 2px solid ${C.sun}; outline-offset: 2px; }
.wrap { font-family: Figtree, system-ui, sans-serif; color: ${C.text}; display: flex; flex-direction: column; gap: 14px; }
.muted { color: ${C.muted}; }
.small { font-size: 13px; }
.card { background: ${C.card}; border-radius: 22px; padding: 16px; display: flex; flex-direction: column; gap: 10px; width: 100%; }
.lbl { display: flex; justify-content: space-between; align-items: center; font-size: 15px; color: ${C.muted}; }
.t { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex-grow: 1; }
.t b { font-size: 17px; }
.t .muted { font-size: 14px; line-height: 1.4; }
.arrives { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
.arrives.duo { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.trips { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 10px; align-items: start; }
.arrive.trip { border-color: ${C.raised}; gap: 8px; }
.trip-head { width: 100%; }
.trip .arr-top { cursor: pointer; }
.trip .eta { font-size: 24px; }
.trip .t b { font-size: 15px; }
.trip .t .muted { font-size: 13px; }
.chev { display: inline-block; font-style: normal; transition: transform .15s; }
.trip.open .chev { transform: rotate(90deg); }
.trip:not(.open) .trip-body { display: none; }
.trip-body { display: flex; flex-direction: column; gap: 10px; }
.arrive { border: 2px solid ${C.car}; }
.tag { color: ${C.car}; font-weight: 700; font-size: 14px; }
.arr-top { display: flex; align-items: center; gap: 14px; }
.eta { font-family: Caprasimo, Georgia, serif; font-weight: 400; font-size: 34px; line-height: 1; color: ${C.car}; flex: none; }
.eta-box { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; flex: none; }
.spd { font-size: 14px; font-weight: 700; color: ${C.muted}; font-variant-numeric: tabular-nums; white-space: nowrap; }
.spd:empty { display: none; }
.arrive .map { height: 260px; border-radius: 16px; overflow: hidden; background: ${C.bg}; }
@media (min-width: 900px) { .arrive .map { height: 340px; } }
.arr-legend { display: flex; align-items: center; gap: 6px; }
.gate { display: flex; align-items: center; gap: 12px; background: ${C.bg}; border-radius: 16px; padding: 10px 12px; }
.gic { width: 40px; height: 40px; border-radius: 99px; background: ${C.card}; color: ${C.muted}; display: flex; align-items: center; justify-content: center; flex: none; }
.gate.open .gic { color: ${C.green}; }
.gate .t b { font-size: 15px; }
.gate .t .muted { font-size: 13px; }
.gbtn { flex: none; height: 40px; padding: 0 16px; border-radius: 99px; background: ${C.accent}; color: ${C.onAccent}; font-weight: 700; }
@media (max-width: 600px) {
  .arrives.duo .arrive { padding: 12px; gap: 8px; }
  .arrives.duo .arr-top { flex-direction: column; align-items: flex-start; gap: 4px; }
  .arrives.duo .eta { font-size: 26px; }
  .arrives.duo .t b { font-size: 15px; }
  .arrives.duo .t .muted { font-size: 12px; }
  .arrives.duo .lbl > span:first-child { display: none; }
  .arrives.duo .map { height: 200px; }
  .arrives.duo .arr-legend { display: none; }
  .arrives.duo .gate { padding: 8px; gap: 8px; flex-wrap: wrap; }
  .arrives.duo .gic { display: none; }
  .arrives.duo .gbtn { height: 34px; padding: 0 12px; width: 100%; text-align: center; }
  .arrives.duo .leaflet-control-attribution { font-size: 8px; line-height: 1.3; padding: 0 3px; }
}
.ln { display: inline-block; width: 22px; height: 4px; background: ${C.text}; border-radius: 2px; }
.ln.traffic { width: 33px; margin-left: 10px; background: linear-gradient(90deg, ${TRAFFIC.low} 0 33%, ${TRAFFIC.moderate} 33% 66%, ${TRAFFIC.severe} 66%); }
.house { filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6)); }
.carpin { filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6)); }
.carpin svg { display: block; }
.leaflet-container { font: inherit; background: ${C.bg}; }
.arrive.osm .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.5); }
.leaflet-control-attribution { background: ${C.bg}BF !important; color: ${C.muted} !important; }
.leaflet-control-attribution a { color: ${C.muted} !important; }
`;
  if (!customElements.get("tesla-arrival-card"))
    customElements.define("tesla-arrival-card", TeslaArrivalCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "tesla-arrival-card",
    name: S.cardName,
    description: `v${VERSION}: ${S.cardDescription}`,
  });
})();

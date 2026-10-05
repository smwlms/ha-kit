(() => {
  const VERSION = "7";
  // "Where are they": every car of the card config on one map with its own badge; the map follows light/dark.
  // Config: see lovelace/tesla-map.yaml (module tesla-route of the ha-kit). Nothing about the house is built in:
  // cars and entity_ids come from the card config, home is zone.home (or `home:` in the config).
  // Mapbox navigation-night/-day (with live traffic) when a token is available (card config mapbox_token, or the one
  // of another card in the same dashboard, e.g. tesla-arrival-card), otherwise OpenStreetMap (darkened in dark mode).
  // User-facing texts in house.language, filled in from tesla-route/strings.yaml by tools/fill.py.
  const S = {
    configError: <@ t('map_config_error') | tojson @>,
    cardName: <@ t('map_card_name') | tojson @>,
    unavailable: <@ t('map_unavailable') | tojson @>,
    home: <@ t('map_home') | tojson @>,
  };
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const DARK = {
    bg: "#1d1a17",
    card: "#2a2622",
    text: "#F5EAD8",
    muted: "#BFB3A1",
    car: "#AEBF92",
    sun: "#E8A571",
    accent: "#C67139",
    house: "#F5C9AE",
  };
  // ---------- theme palette ----------
  // Colours come from the --cw-* tokens of theme Organic (light/dark) and are re-read when the theme changes.
  // The token names (right) belong to module base; the keys (left) are this card's own names.
  // DARK is the fallback when the tokens are missing. Values stay concrete hex strings for SVG attributes.
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
    sun: "zon",
    batt: "batterij",
    net: "net",
    house: "huis",
    car: "wagen",
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
      .map((v) =>
        (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
      )
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
  // Light mode only: deepen a colour towards the text colour until it reaches `min` contrast on the card
  // (3:1 for icons, strokes and large numbers; pass 4.5 for small text).
  const INK = new Map();
  const ink = (c, min = 3) => {
    if (!C.light || !rgbOf(c)) return c;
    const key = `${c}|${C.card}|${min}`;
    if (!INK.has(key)) {
      let out = c;
      for (let t = 0.1; t < 0.95 && contrast(out, C.card) < min; t += 0.1)
        out = mix(c, C.text, t);
      INK.set(key, out);
    }
    return INK.get(key);
  };
  // Separator lines: the raised tone in dark, the line tone in light (raised is lighter than the card there).
  const sep = () => (C.light ? C.line : C.raised);
  // Soft background behind an icon: the colour blended into the card.
  const tint = (c, t = 0.16) => mix(C.card, c, t);
  // Reads the tokens from the element's computed style; returns a signature to detect real changes.
  const readPalette = (el, hass) => {
    const cs = getComputedStyle(el);
    const fb = hass?.themes?.darkMode === false ? { ...DARK, ...LIGHT } : DARK;
    for (const k of Object.keys(DARK))
      C[k] =
        (TOKEN[k] && cs.getPropertyValue(`--cw-${TOKEN[k]}`).trim()) || fb[k];
    C.light = lum(C.bg) > 0.4;
    return Object.keys(DARK)
      .map((k) => C[k])
      .join();
  };
  // Fallback for light mode when the tokens are not there yet (Organic light values).
  const LIGHT = { bg: "#F5EAD8", card: "#EBDDC5", raised: "#F9F3EA", line: "#D8C6A8", text: "#201E1D", muted: "#645C50", accent: "#C67139", onAccent: "#201E1D", green: "#41692F", amber: "#7E5409", red: "#A63B28", inj: "#874B22", water: "#4F7F92" };
  const hasTokens = (el) => !!getComputedStyle(el).getPropertyValue("--cw-bg").trim();
  const themeKey = (hass) =>
    `${hass?.themes?.darkMode}|${hass?.themes?.theme}|${hass?.selectedTheme?.theme}`;
  // Badges (48×48), per car: the card config `badge` (an example name below, or your own <svg>), else a circle with
  // the car's initial in its colour. Functions, so they are redrawn in the colours of the current theme.
  const EXAMPLES = {
    lightning(color = C.car) {
      return `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
<circle cx="24" cy="24" r="22" fill="${C.card}" stroke="${color}" stroke-width="3"/>
<path d="M28 8 L16 26 H23.5 L20 40 L33.5 20.5 H26 Z" fill="${color}"/>
<path d="M6.5 20 H13 M5 25 H12 M7.5 30 H13" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;
    },
    plaid() {
      return `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
<defs><clipPath id="plaid-clip"><circle cx="24" cy="24" r="22"/></clipPath></defs>
<g clip-path="url(#plaid-clip)">
<rect width="48" height="48" fill="#4a2219"/>
<rect x="6" width="8" height="48" fill="${C.accent}" opacity=".55"/><rect x="26" width="8" height="48" fill="${C.accent}" opacity=".55"/>
<rect y="6" width="48" height="8" fill="${C.accent}" opacity=".55"/><rect y="26" width="48" height="8" fill="${C.accent}" opacity=".55"/>
<rect x="18" width="1.6" height="48" fill="${C.house}" opacity=".7"/><rect x="38" width="1.6" height="48" fill="${C.house}" opacity=".7"/>
<rect y="18" width="48" height="1.6" fill="${C.house}" opacity=".7"/><rect y="38" width="48" height="1.6" fill="${C.house}" opacity=".7"/>
</g>
<circle cx="24" cy="24" r="22" fill="none" stroke="${C.sun}" stroke-width="3"/>
<path d="M19 29 L36.5 11.5" stroke="#4fb8ff" stroke-width="8" stroke-linecap="round" opacity=".75"/>
<path d="M19 29 L36.5 11.5" stroke="#f4fcff" stroke-width="2.6" stroke-linecap="round"/>
<path d="M11.5 36.5 L19.5 28.5" stroke="#d9d4cc" stroke-width="4.5" stroke-linecap="round"/>
<path d="M14 34 L15.2 32.8 M16.4 31.6 L17.6 30.4" stroke="#3a3530" stroke-width="2" stroke-linecap="round"/>
</svg>`;
    },
  };
  const PALETTE = () => [C.car, C.sun, "#8FA3B8", C.house];
  const genericBadge = (name, color) =>
    `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="${C.card}" stroke="${color}" stroke-width="3"/><text x="24" y="31" text-anchor="middle" font-family="Figtree, system-ui, sans-serif" font-size="20" font-weight="700" fill="${color}">${esc(String(name || "?").trim().charAt(0).toUpperCase())}</text></svg>`;
  // Shared with tesla-arrival-card.js (window.CW_TESLA_BADGES, per car prefix) so both maps use the same badges.
  // Each entry is a getter: the drawing follows the theme colours at the moment it is used.
  const BADGE = (window.CW_TESLA_BADGES = window.CW_TESLA_BADGES || {});
  window.CW_TESLA_BADGE_EXAMPLES = EXAMPLES;
  const badgeFor = (car) => {
    const own = car.badge;
    if (typeof own === "string" && own.trim().startsWith("<svg")) return () => own;
    if (EXAMPLES[own]) return () => EXAMPLES[own](car.colorFixed || C.car);
    return () => genericBadge(car.name, car.colorFixed || PALETTE()[car.i % 4]);
  };
  // Plain house (no circle); dark outline keeps it visible on any map.
  const HOUSE = `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 16 L16 4 L29 16 H25 V29 H7 V16 Z" fill="#F5C9AE" stroke="#1d1a17" stroke-width="2" stroke-linejoin="round"/><path d="M13 29 V20 H19 V29" fill="#1d1a17"/></svg>`;
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
  // Finds mapbox_token in any card of a dashboard config (the token can be kept in one place, e.g. tesla-arrival-card).
  const findToken = (o) => {
    if (Array.isArray(o)) {
      for (const x of o) {
        const t = findToken(x);
        if (t) return t;
      }
    } else if (o && typeof o === "object") {
      if (
        typeof o.mapbox_token === "string" &&
        o.mapbox_token.startsWith("pk.")
      )
        return o.mapbox_token;
      for (const v of Object.values(o)) {
        const t = findToken(v);
        if (t) return t;
      }
    }
    return null;
  };

  class TeslaMapCard extends HTMLElement {
    // cars: [{ p, name, color, badge, entities: { loc, soc, home } }]; home; mapbox_token; token_dashboard; height.
    setConfig(config) {
      if (!Array.isArray(config?.cars) || !config.cars.length)
        throw new Error(S.configError);
      this._cfg = { height: 340, ...config };
      this._home = config.home || "zone.home";
      this._cars = config.cars.map((a, i) => {
        const car = {
          i,
          p: a.p,
          name: a.name || a.p,
          badge: a.badge,
          colorFixed: a.color || null,
          // English Teslemetry names by default; the kit always passes the real ids under `entities`.
          loc: `device_tracker.${a.p}_location`,
          soc: `sensor.${a.p}_battery_level`,
          home: `binary_sensor.${a.p}_located_at_home`,
          ...(a.entities || {}),
        };
        const draw = badgeFor(car);
        Object.defineProperty(BADGE, a.p, { get: draw, configurable: true, enumerable: true });
        return car;
      });
    }
    getCardSize() {
      return 6;
    }
    getGridOptions() {
      return { columns: "full", rows: 6, min_rows: 4 };
    }
    set hass(hass) {
      this._hass = hass;
      if (!this._root) this._build();
      const tk = themeKey(hass);
      if (tk !== this._tk) {
        this._tk = tk;
        this._tries = 0;
        // Right away with the fallback of HA's current light/dark mode, then again once the view theme is applied.
        readPalette(this, hass);
        clearTimeout(this._tkTimer);
        this._tkTimer = setTimeout(() => this._retheme(), 60);
      }
      const sig = [this._home, ...this._cars.flatMap((c) => [c.loc, c.soc, c.home])]
        .map((id) => hass.states[id]?.last_updated)
        .join("|");
      if (sig === this._sig) return;
      this._sig = sig;
      this._update();
    }
    _build() {
      this._root = this.attachShadow({ mode: "open" });
      this._root.innerHTML = `<style></style><style class="cw">${css()}</style><ha-card><div class="map" style="min-height:${Number(this._cfg.height) || 340}px"></div></ha-card>`;
      loadLeafletCss().then(
        (css) => (this._root.querySelector("style").textContent = css),
      );
      loadLeaflet()
        .then((L) => this._initMap(L))
        .catch(
          () =>
            (this._root.querySelector(".map").innerHTML =
              `<p class="err">${esc(S.unavailable)}</p>`),
        );
    }
    // Theme changed: re-read the tokens, restyle, swap the map style and redraw the badges.
    _retheme() {
      clearTimeout(this._tkTimer);
      // The view theme can arrive later than the first hass: retry until the --cw-* tokens are there (max ±10 s).
      if (!hasTokens(this) && (this._tries = (this._tries || 0) + 1) < 40)
        this._tkTimer = setTimeout(() => this._retheme(), 250);
      const pal = readPalette(this, this._hass);
      if (pal === this._pal) return;
      this._pal = pal;
      this._root.querySelector("style.cw").textContent = css();
      this._setTiles();
      if (this._map) {
        this._sig = null;
        this._update();
      }
    }
    _setTiles() {
      if (!this._map || !this._tokenReady) return;
      const token = this._tokenValue;
      const style = C.light ? "navigation-day-v1" : "navigation-night-v1";
      const url = token
        ? `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
      this._root
        .querySelector(".map")
        .classList.toggle("osm", !token && !C.light);
      if (this._tiles) {
        if (this._tiles._url !== url) this._tiles.setUrl(url);
        return;
      }
      this._tiles = this._L
        .tileLayer(
          url,
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
                  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
              },
        )
        .addTo(this._map);
    }
    async _token() {
      if (this._cfg.mapbox_token) return this._cfg.mapbox_token;
      try {
        return findToken(
          await this._hass.callWS({
            type: "lovelace/config",
            url_path: this._cfg.token_dashboard ?? null,
          }),
        );
      } catch (e) {
        return null;
      }
    }
    async _initMap(L) {
      const box = this._root.querySelector(".map");
      const map = L.map(box, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile,
      });
      map.attributionControl.setPrefix(false);
      this._tokenValue = await this._token();
      this._tokenReady = true;
      this._L = L;
      this._map = map;
      readPalette(this, this._hass);
      this._setTiles();
      this._homeMarker = L.marker([0, 0], {
        icon: L.divIcon({
          className: "house",
          html: HOUSE,
          iconSize: [30, 30],
          iconAnchor: [15, 26],
        }),
        keyboard: false,
        zIndexOffset: -100,
      }).addTo(map);
      this._markers = {};
      for (const c of this._cars) {
        const m = L.marker([0, 0], {
          icon: this._icon(c, ""),
          keyboard: false,
          riseOnHover: true,
        }).addTo(map);
        m.on("click", () =>
          this.dispatchEvent(
            new CustomEvent("hass-more-info", {
              detail: { entityId: c.loc },
              bubbles: true,
              composed: true,
            }),
          ),
        );
        this._markers[c.p] = m;
      }
      new ResizeObserver(() => map.invalidateSize()).observe(box);
      this._fitted = false;
      this._update();
    }
    _icon(c, sub) {
      return this._L.divIcon({
        className: "car",
        html: `<div class="badge">${BADGE[c.p]}</div><div class="tag"><b>${esc(c.name)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
    }
    _ll(id) {
      const a = this._hass.states[id]?.attributes || {};
      return Number.isFinite(a.latitude) && Number.isFinite(a.longitude)
        ? [a.latitude, a.longitude]
        : null;
    }
    _update() {
      if (!this._map || !this._hass) return;
      const st = (id) => this._hass.states[id]?.state;
      const home = this._ll(this._home);
      if (home) this._homeMarker.setLatLng(home);
      const pts = home ? [home] : [];
      const both = [];
      for (const c of this._cars) {
        const pos = this._ll(c.loc);
        const m = this._markers[c.p];
        if (!pos) {
          m.setOpacity(0);
          continue;
        }
        const soc = parseFloat(st(c.soc));
        const loc = st(c.loc);
        const where =
          st(c.home) === "on" || loc === "home"
            ? S.home
            : loc && !["not_home", "unknown", "unavailable"].includes(loc)
              ? loc
              : "";
        m.setLatLng(pos);
        m.setOpacity(1);
        m.setIcon(
          this._icon(
            c,
            [Number.isFinite(soc) ? `${Math.round(soc)} %` : null, where]
              .filter(Boolean)
              .join(" · "),
          ),
        );
        pts.push(pos);
        both.push(pos);
      }
      if (!pts.length) return;
      // Fit once, and again whenever a car leaves the visible area.
      const view = this._fitted ? this._map.getBounds() : null;
      const outside =
        this._fitted && view && both.some((p) => !view.contains(p));
      if (!this._fitted || outside) {
        if (pts.length === 1) this._map.setView(pts[0], 14);
        else
          this._map.fitBounds(this._L.latLngBounds(pts), {
            padding: [56, 56],
            maxZoom: 15,
          });
        this._fitted = true;
      }
    }
  }

  const css = () => `
:host { display: block; height: 100%; }
ha-card { display: block; height: 100%; overflow: hidden; border-radius: var(--ha-card-border-radius, 22px); }
.map { height: 100%; background: ${C.bg}; }
.err { color: ${C.muted}; padding: 16px; margin: 0; }
.leaflet-container { font: inherit; background: ${C.bg}; }
.osm .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.5); }
.leaflet-control-attribution { background: ${C.bg}BF !important; color: ${C.muted} !important; font-size: 10px; }
.leaflet-control-attribution a { color: ${C.muted} !important; }
.house { filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6)); }
.car { overflow: visible; cursor: pointer; }
.car .badge { width: 44px; height: 44px; filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6)); }
.car .badge svg { display: block; }
.car .tag { position: absolute; top: 48px; left: 50%; transform: translateX(-50%); white-space: nowrap; background: ${C.bg}E0; color: ${C.text}; border-radius: 99px; padding: 3px 10px; font-size: 12px; line-height: 1.3; text-align: center; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4); }
.car .tag b { font-weight: 700; }
.car .tag span { color: ${C.muted}; margin-left: 6px; }
`;
  if (!customElements.get("tesla-map-card"))
    customElements.define("tesla-map-card", TeslaMapCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "tesla-map-card",
    name: S.cardName,
    description: `v${VERSION}`,
  });
})();

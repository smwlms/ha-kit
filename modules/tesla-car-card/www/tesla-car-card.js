// One card per car, custom:tesla-car-card (ha-kit module tesla-car-card), after the Tesla app: icons first, little text.
// Config: see lovelace/tesla-car.yaml (filled in from house.yaml). Nothing about the house is built in: every entity id
// comes from the card config, the pictures from `images` (default the ones this module uploads).
//   - the car picture with invisible tap zones on frunk and trunk; an open lid shows the open-lid picture;
//   - battery as a percentage with the range; the charge state in the picture: a fast charger or the wall box with the
//     cable, energy running through the cable while charging (green from the sun, red from the grid);
//   - icon grid like the Tesla app: lock, frunk, trunk, charge port, climate, charging, lights, horn, sentry, windows
//     (a tile without its entity is left out);
//   - the detail (charge limit, tyres, range, odometer) in one popup behind the battery; the climate screen behind
//     the climate tile; a gear to the charge settings (settings_path, optional).
// Commands: only from a real tap or change (event.isTrusted). Moving parts, unlocking, charging, lights and horn ask
// a second tap within 4 seconds; lock, climate, sentry and seats are direct. Renders and tests never send a command.
// Colours only from the --cw-* tokens of the house styles (module base). User-facing texts in house.language, filled
// in from tesla-car-card/strings.yaml by tools/fill.py.
(() => {
  const VERSION = "1";
  const LANG = <@ (house.language if house is defined and house.get('language') else 'en') | tojson @>;
  const S = {
    cardName: <@ t('card_name') | tojson @>,
    cardDescription: <@ t('card_description') | tojson @>,
    configError: <@ t('config_error') | tojson @>,
    batteryAria: <@ t('battery_aria') | tojson @>,
    unlock: <@ t('unlock') | tojson @>,
    lock: <@ t('lock') | tojson @>,
    frunk: <@ t('frunk') | tojson @>,
    frunkOpen: <@ t('frunk_open') | tojson @>,
    trunk: <@ t('trunk') | tojson @>,
    chargePort: <@ t('charge_port') | tojson @>,
    climate: <@ t('climate') | tojson @>,
    startCharging: <@ t('start_charging') | tojson @>,
    stopCharging: <@ t('stop_charging') | tojson @>,
    lights: <@ t('lights') | tojson @>,
    horn: <@ t('horn') | tojson @>,
    sentry: <@ t('sentry') | tojson @>,
    windows: <@ t('windows') | tojson @>,
    vent: <@ t('vent') | tojson @>,
    defrost: <@ t('defrost') | tojson @>,
    powerOn: <@ t('power_on') | tojson @>,
    powerOff: <@ t('power_off') | tojson @>,
    areaOpen: <@ t('area_open') | tojson @>,
    areaClosed: <@ t('area_closed') | tojson @>,
    more: <@ t('more') | tojson @>,
    close: <@ t('close') | tojson @>,
    chargeSettings: <@ t('charge_settings') | tojson @>,
    fastCharging: <@ t('fast_charging') | tojson @>,
    fastChargingKw: <@ t('fast_charging_kw') | tojson @>,
    fastChargingStation: <@ t('fast_charging_station') | tojson @>,
    charging: <@ t('charging') | tojson @>,
    chargingVolt: <@ t('charging_volt') | tojson @>,
    pluggedIn: <@ t('plugged_in') | tojson @>,
    notPluggedIn: <@ t('not_plugged_in') | tojson @>,
    badgeFast: <@ t('badge_fast') | tojson @>,
    badgeCharging: <@ t('badge_charging') | tojson @>,
    fromGrid: <@ t('from_grid') | tojson @>,
    fromSun: <@ t('from_sun') | tojson @>,
    home: <@ t('home') | tojson @>,
    homeGarage: <@ t('home_garage') | tojson @>,
    homeDriveway: <@ t('home_driveway') | tojson @>,
    away: <@ t('away') | tojson @>,
    tyreLow: <@ t('tyre_low') | tojson @>,
    range: <@ t('range') | tojson @>,
    odometer: <@ t('odometer') | tojson @>,
    tyres: <@ t('tyres') | tojson @>,
    open: <@ t('open') | tojson @>,
    allClosed: <@ t('all_closed') | tojson @>,
    unknown: <@ t('unknown') | tojson @>,
    chargeLimit: <@ t('charge_limit') | tojson @>,
    climateOn: <@ t('climate_on') | tojson @>,
    stateOn: <@ t('state_on') | tojson @>,
    stateOff: <@ t('state_off') | tojson @>,
    insideOutside: <@ t('inside_outside') | tojson @>,
    lower: <@ t('lower') | tojson @>,
    higher: <@ t('higher') | tojson @>,
    steeringWheel: <@ t('steering_wheel') | tojson @>,
    seatLeft: <@ t('seat_left') | tojson @>,
    seatRight: <@ t('seat_right') | tojson @>,
    coolingLeft: <@ t('cooling_left') | tojson @>,
    coolingRight: <@ t('cooling_right') | tojson @>,
  };
  // HA weather states -> the drawn weather icon and its word (similar states share one).
  const WEATHER = {
    "clear-night": ["w:clear-night", <@ t('weather_clear_night') | tojson @>],
    sunny: ["w:sunny", <@ t('weather_sunny') | tojson @>],
    partlycloudy: ["w:partlycloudy", <@ t('weather_partlycloudy') | tojson @>],
    cloudy: ["w:cloudy", <@ t('weather_cloudy') | tojson @>],
    exceptional: ["w:cloudy", <@ t('weather_exceptional') | tojson @>],
    fog: ["w:fog", <@ t('weather_fog') | tojson @>],
    hail: ["w:snowy", <@ t('weather_hail') | tojson @>],
    lightning: ["w:lightning", <@ t('weather_lightning') | tojson @>],
    "lightning-rainy": ["w:lightning", <@ t('weather_lightning') | tojson @>],
    pouring: ["w:pouring", <@ t('weather_pouring') | tojson @>],
    rainy: ["w:rainy", <@ t('weather_rainy') | tojson @>],
    snowy: ["w:snowy", <@ t('weather_snowy') | tojson @>],
    "snowy-rainy": ["w:snowy", <@ t('weather_snowy_rainy') | tojson @>],
    windy: ["w:windy", <@ t('weather_windy') | tojson @>],
    "windy-variant": ["w:windy", <@ t('weather_windy') | tojson @>],
  };
  const fill = (text, values) =>
    Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), text);

  // ---------- pictures ----------
  // Every picture of one model shares one canvas (tools/align_samen.py): the car sits on exactly the same pixels in
  // every state and S and Y show at the same metres per pixel. The card draws one fixed contact shadow (.ground).
  // model_s -> "s", model_y -> "y". Files in `images` (default /local/ha-kit/tesla-car-card/images/):
  //   <m>-base, <m>-frunk, <m>-trunk                 the car alone, closed / frunk open / trunk open
  //   <m>-fast[-frunk|-trunk]                        with a fast charger and its cable
  //   <m>-home[-frunk|-trunk]                        with a wall box and its cable
  //   <m>-interior                                   from above, for the climate screen
  const MODELS = { model_s: "s", model_y: "y" };
  const DEFAULT_IMAGES = "/local/ha-kit/tesla-car-card/images/";
  // Tap areas in % of the picture: [left, top, width, height] (mapped onto the car box of the shared canvas).
  const AREAS = {
    s: { frunk: [7.4, 50.6, 10.1, 18.1], trunk: [65.6, 45.9, 10.8, 22.1] },
    y: { frunk: [8.7, 48.2, 9.0, 17.9], trunk: [65.2, 42.8, 10.3, 23.2] },
  };
  // With a lid open the tap area is the open lid plus the opening below it, so tapping the raised lid closes it.
  const AREAS_OPEN = {
    s: { frunk: [7.4, 23.5, 20.6, 52.0], trunk: [55.9, 17.7, 20.6, 50.3] },
    y: { frunk: [7.3, 27.2, 22.5, 50.5], trunk: [58.4, 14.8, 20.6, 51.2] },
  };
  // Contact shadow under the wheels, the same in every state: [left %, right %, top %] of the shared canvas.
  const GROUND = { s: [8.7, 26.4, 76.1], y: [10.5, 26.9, 78.0] };
  // The cable in each charger picture, from the charger to the charge port, in pixels of the full-size canvas
  // (printed by tools/compose_chargers.py into cable.json). The SVG uses the same viewBox, so the pictures may be
  // scaled. While charging, energy runs along it.
  const CABLE = {
    "s-fast": { w: 2435, h: 1342, pts: [[2043, 634], [2029, 708], [2013, 774], [1993, 832], [1972, 882], [1950, 924], [1926, 957], [1902, 982], [1879, 999], [1856, 1008], [1835, 1009], [1795, 990], [1772, 950], [1763, 880], [1760, 800], [1757, 740]] },
    "s-home": { w: 2435, h: 1342, pts: [[2195, 644], [2189, 733], [2170, 807], [2141, 867], [2103, 915], [2059, 952], [2011, 979], [1963, 996], [1915, 1007], [1871, 1010], [1835, 1009], [1795, 990], [1772, 950], [1763, 880], [1760, 800], [1757, 740]] },
    "y-fast": { w: 2238, h: 1248, pts: [[1860, 618], [1848, 719], [1830, 796], [1807, 852], [1781, 885], [1753, 896], [1722, 886], [1691, 854], [1661, 801], [1631, 728], [1606, 640]] },
    "y-home": { w: 2238, h: 1248, pts: [[1999, 627], [1992, 715], [1966, 781], [1926, 826], [1877, 851], [1821, 857], [1765, 844], [1710, 815], [1663, 770], [1627, 710], [1606, 640]] },
  };
  // Top of the charger in each charger picture, in % of the picture [centre x, top y]: the charge badge sits above it.
  const CHARGER_TOP = { "s-fast": [89.5, 26.7], "s-home": [89.6, 37.0], "y-fast": [88.7, 29.2], "y-home": [88.8, 39.4] };
  // Climate screen: centres [x %, y %] of steering wheel and front seats on the interior picture of each model.
  const SEATS = {
    s: { wheel: [36, 24], left: [33, 40], right: [67, 40] },
    y: { wheel: [36, 24], left: [33, 40], right: [67, 40] },
  };
  const TYRE_MIN_BAR = 2.7; // below this one tyre is flagged
  const CONFIRM_MS = 4000;

  // Smooth path through the points (Catmull-Rom as cubic Béziers), so the light follows the cable without corners.
  const smooth = (pts) => {
    const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
    }
    return d;
  };

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const num = (x) => {
    const v = parseFloat(x);
    return Number.isFinite(v) ? v : NaN;
  };
  const NF = {};
  const nf = (v, d = 0) => {
    if (!Number.isFinite(v)) return "–";
    NF[d] = NF[d] || new Intl.NumberFormat(LANG, { minimumFractionDigits: d, maximumFractionDigits: d });
    return NF[d].format(v);
  };
  // Fallbacks are the Organic light values, used only when the theme token is missing.
  const tok = (name, fb) => `var(--cw-${name}, ${fb})`;
  const battTok = (lvl) =>
    lvl <= 20 ? tok("bad", "#A63B28") : lvl <= 50 ? tok("warn", "#7E5409") : tok("good", "#41692F");

  // Icons drawn here, so they show without the HA icon set: lock, charge port and gear after Lucide (ISC), fan, headlights,
  // horn, sentry eye, steering wheel, seat cooler and power after Phosphor Light (MIT), the rest own fine-line
  // drawings. Unknown names show nothing.
  const SV = (body) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const PH = (d) =>
    `<svg class="ic" viewBox="0 0 256 256" aria-hidden="true"><path d="${d}" fill="currentColor" stroke="none"/></svg>`;
  const ICONS = {
    plug: SV('<rect x="6" y="3" width="12" height="7" rx="2"/><path d="M9 10v4a3 3 0 0 0 6 0v-4M12 17v4"/>'),
    "car-side": SV('<g transform="translate(-1.86 -1.69) scale(1.15)" stroke-width=".96"><path d="M4.8 16H2.5v-2.4c0-.6.4-1 1-1.2M8.6 11.6 4.3 7.6M8.6 11.6 11.6 8.6c.4-.4.9-.6 1.4-.6h3.2c.6 0 1.1.2 1.5.6l2.7 3 .7.3c.5.2.9.7.9 1.2V16h-2.3M9.2 16h5.6"/><circle cx="7" cy="16" r="2.2"/><circle cx="17" cy="16" r="2.2"/></g>'),
    "car-back": SV('<g transform="translate(-1.86 -1.69) scale(1.15)" stroke-width=".96"><path d="M4.8 16H2.5v-2.4c0-.6.4-1 1-1.2L8.6 11.6 11.6 8.6c.4-.4.9-.6 1.4-.6h3.2c.6 0 1.1.2 1.5.6M17.7 8.6 21.6 5.6M20.4 11.6l.7.3c.5.2.9.7.9 1.2V16h-2.3M9.2 16h5.6"/><circle cx="7" cy="16" r="2.2"/><circle cx="17" cy="16" r="2.2"/></g>'),
    lock: SV('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/> <path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    "lock-open": SV('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/> <path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
    "charge-port": SV('<path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/> <path d="m2 22 3-3"/> <path d="M7.5 13.5 10 11"/> <path d="M10.5 16.5 13 14"/> <path d="m18 3-4 4h6l-4 4"/>'),
    fan: PH("M231.06,135.52a58,58,0,0,0-88-33.42c-.69-.41-1.41-.8-2.14-1.15l16.86-67.32a6,6,0,0,0-2.58-6.51A58,58,0,1,0,98,127.86V128c0,.77,0,1.54.1,2.3L31.37,149.36A6,6,0,0,0,27,154.85,58,58,0,1,0,142.88,154c.7-.4,1.39-.83,2.06-1.29L194.81,201a6,6,0,0,0,6.94,1,58,58,0,0,0,29.31-66.51ZM110,128a18,18,0,1,1,18,18A18,18,0,0,1,110,128ZM78,76a46,46,0,0,1,67.08-40.9L129.32,98q-.66,0-1.32,0a30,30,0,0,0-27.33,17.66A45.84,45.84,0,0,1,78,76Zm30,121.3a46,46,0,0,1-69-37.64l62.39-17.82A30,30,0,0,0,128,158a29.29,29.29,0,0,0,3-.15A45.85,45.85,0,0,1,108,197.3Zm106.9-23.76a45.91,45.91,0,0,1-15,15.7l-46.63-45.12a29.91,29.91,0,0,0-.93-33.62,46,46,0,0,1,62.52,63Z"),
    pause: SV('<path d="M8 5v14M16 5v14"/>'),
    play: SV('<path d="M7 5l12 7-12 7z"/>'),
    headlights: PH("M162,80a6,6,0,0,1,6-6h72a6,6,0,0,1,0,12H168A6,6,0,0,1,162,80Zm78,90H168a6,6,0,0,0,0,12h72a6,6,0,0,0,0-12Zm0-64H168a6,6,0,0,0,0,12h72a6,6,0,0,0,0-12Zm0,32H168a6,6,0,0,0,0,12h72a6,6,0,0,0,0-12ZM142,64V192a14,14,0,0,1-14,14H88a78,78,0,0,1-78-78.59C10.32,84.73,45.71,50,88.9,50H128A14,14,0,0,1,142,64Zm-12,0a2,2,0,0,0-2-2H88.9C52.28,62,22.27,91.38,22,127.5A66,66,0,0,0,88,194h40a2,2,0,0,0,2-2Z"),
    horn: PH("M228,88.59l-176.08-54A14,14,0,0,0,34,48V192a14,14,0,0,0,14,14,14.59,14.59,0,0,0,4-.59L138,179v13a14,14,0,0,0,14,14h32a14,14,0,0,0,14-14V160.62l30-9.19A14.07,14.07,0,0,0,238,138V102A14,14,0,0,0,228,88.59ZM48.56,193.92a2,2,0,0,1-1.76-.32A2,2,0,0,1,46,192V48a2,2,0,0,1,.8-1.6A2.05,2.05,0,0,1,48,46a1.79,1.79,0,0,1,.49.08L138,73.53v92.95ZM186,192a2,2,0,0,1-2,2H152a2,2,0,0,1-2-2V175.35l36-11Zm40-54a2,2,0,0,1-1.44,1.92l-.08,0L150,162.8V77.21l74.56,22.87A2,2,0,0,1,226,102Z"),
    sentry: PH("M245.48,125.57c-.34-.78-8.66-19.23-27.24-37.81C201,70.54,171.38,50,128,50S55,70.54,37.76,87.76c-18.58,18.58-26.9,37-27.24,37.81a6,6,0,0,0,0,4.88c.34.77,8.66,19.22,27.24,37.8C55,185.47,84.62,206,128,206s73-20.53,90.24-37.75c18.58-18.58,26.9-37,27.24-37.8A6,6,0,0,0,245.48,125.57ZM128,194c-31.38,0-58.78-11.42-81.45-33.93A134.77,134.77,0,0,1,22.69,128,134.56,134.56,0,0,1,46.55,95.94C69.22,73.42,96.62,62,128,62s58.78,11.42,81.45,33.94A134.56,134.56,0,0,1,233.31,128C226.94,140.21,195,194,128,194Zm0-112a46,46,0,1,0,46,46A46.06,46.06,0,0,0,128,82Zm0,80a34,34,0,1,1,34-34A34,34,0,0,1,128,162Z"),
    "window-open": SV('<path d="M5 20h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-8L4 11v8a1 1 0 0 0 1 1zM4 12.5h16M9.5 7l2.5 2.5L14.5 7"/>'),
    "window-closed": SV('<path d="M5 20h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-8L4 11v8a1 1 0 0 0 1 1zM4 12.5h16"/>'),
    tune: SV('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
    gear: SV('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    "pin-home": SV('<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    "pin-away": SV('<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    "tyre-alert": SV('<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16v.5"/>'),
    "w:sunny": SV('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    "w:clear-night": SV('<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>'),
    "w:partlycloudy": SV('<circle cx="9" cy="8.5" r="3"/><path d="M9 3v1.3M3.5 8.5h1.3M5.1 4.6l.9.9M12.9 4.6l-.9.9"/><path d="M8.5 20h9a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 8.8 13.5 3.25 3.25 0 0 0 8.5 20z"/>'),
    "w:cloudy": SV('<path d="M7 19h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 11.5 3.75 3.75 0 0 0 7 19z"/>'),
    "w:rainy": SV('<path d="M7 15.5h10a3.75 3.75 0 0 0 .6-7.45A5.5 5.5 0 0 0 7 8.5a3.5 3.5 0 0 0 0 7zM8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"/>'),
    "w:pouring": SV('<path d="M7 15.5h10a3.75 3.75 0 0 0 .6-7.45A5.5 5.5 0 0 0 7 8.5a3.5 3.5 0 0 0 0 7zM8 18l-1.5 3M12 18l-1.5 3M16 18l-1.5 3"/>'),
    "w:snowy": SV('<path d="M7 15.5h10a3.75 3.75 0 0 0 .6-7.45A5.5 5.5 0 0 0 7 8.5a3.5 3.5 0 0 0 0 7z"/><circle cx="8.5" cy="19.5" r=".6"/><circle cx="12" cy="20.5" r=".6"/><circle cx="15.5" cy="19.5" r=".6"/>'),
    "w:fog": SV('<path d="M4 9h16M6 12.5h12M4 16h16M7 19.5h10"/>'),
    "w:lightning": SV('<path d="M7 15.5h10a3.75 3.75 0 0 0 .6-7.45A5.5 5.5 0 0 0 7 8.5a3.5 3.5 0 0 0 0 7zM12.5 16l-2 3.5h3l-2 3"/>'),
    "w:windy": SV('<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7"/>'),
    garage: SV('<path d="M3.5 20V9.5L12 4.5l8.5 5V20M7 20v-7.5h10V20M7 15h10M7 17.5h10"/>'),
    // home on the driveway: a small garage at the back, a simple car silhouette in front of it
    driveway: SV('<path d="M10.5 11.5V7L16 3.5 21.5 7v8M13 10h6M13 12.5h6"/><path d="M2.5 19.5H3.8M7.8 19.5h4.4M16.2 19.5h1.3v-2.1c0-.6-.4-1.1-1-1.3l-1.8-.5-2.4-1.9c-.4-.3-.9-.5-1.4-.5H7.4c-.6 0-1.1.2-1.5.6L4.3 15.6l-.9.3c-.5.2-.9.6-.9 1.2v2.4"/><circle cx="5.8" cy="19.5" r="1.7"/><circle cx="14.2" cy="19.5" r="1.7"/>'),
    close: SV('<path d="M6 6l12 12M18 6L6 18"/>'),
    "chevron-down": SV('<path d="M6 9l6 6 6-6"/>'),
    battery: SV('<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 11v2"/>'),
    steering: PH("M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26ZM46.43,166h44a2,2,0,0,1,1.87,1.3l18.33,49A90.3,90.3,0,0,1,46.43,166Zm98.87,50.32,18.37-49a2,2,0,0,1,1.88-1.3h44A90.29,90.29,0,0,1,145.3,216.32ZM214.17,154H165.55a14,14,0,0,0-13.11,9.09l-20.55,54.82c-1.29.06-2.59.09-3.89.09s-2.63,0-3.94-.09l-20.5-54.81A14.06,14.06,0,0,0,90.45,154H41.83c-.65-2.17-1.23-4.37-1.72-6.61a122,122,0,0,1,175.78,0C215.4,149.63,214.82,151.83,214.17,154ZM128,98a134.38,134.38,0,0,0-89.88,34.64C38,131.1,38,129.56,38,128a90,90,0,0,1,180,0c0,1.56,0,3.1-.12,4.64A134.38,134.38,0,0,0,128,98Zm10,42a10,10,0,1,1-10-10A10,10,0,0,1,138,140Z"),
    "seat-heater": SV('<path d="M6.6 4h.9l2 11.5H17a1.5 1.5 0 0 1 1.5 1.5v1.5H9.9a1.5 1.5 0 0 1-1.5-1.2L5.6 5.2A1 1 0 0 1 6.6 4zM11 18.5l-.8 2M16.5 18.5l.8 2M13 4.5c-.7.8.7 1.6 0 2.4s.7 1.6 0 2.4M15.8 4.5c-.7.8.7 1.6 0 2.4s.7 1.6 0 2.4M18.6 4.5c-.7.8.7 1.6 0 2.4s.7 1.6 0 2.4"/>'),
    "seat-cooler": PH("M221.83,150.57a6,6,0,0,1-4.4,7.26l-26.62,6.54,7,26.08a6,6,0,0,1-4.24,7.35,6.4,6.4,0,0,1-1.55.2,6,6,0,0,1-5.8-4.45L178.27,164,134,138.39v51.13l22.24,22.24a6,6,0,1,1-8.48,8.48L128,200.49l-19.76,19.75a6,6,0,0,1-8.48-8.48L122,189.52V138.39L77.73,164l-7.93,29.6A6,6,0,0,1,64,198a6.4,6.4,0,0,1-1.55-.2,6,6,0,0,1-4.24-7.35l7-26.08-26.62-6.54a6,6,0,0,1,2.86-11.66l30.23,7.43L116,128,71.66,102.4l-30.23,7.43A5.88,5.88,0,0,1,40,110a6,6,0,0,1-1.43-11.83l26.62-6.54-7-26.08a6,6,0,1,1,11.59-3.1l7.93,29.6L122,117.61V66.48L99.76,44.24a6,6,0,0,1,8.48-8.48L128,55.51l19.76-19.75a6,6,0,0,1,8.48,8.48L134,66.48v51.13l44.27-25.56,7.93-29.6a6,6,0,1,1,11.59,3.1l-7,26.08,26.62,6.54A6,6,0,0,1,216,110a5.88,5.88,0,0,1-1.43-.17l-30.23-7.43L140,128l44.34,25.6,30.23-7.43A6,6,0,0,1,221.83,150.57Z"),
    power: PH("M122,128V48a6,6,0,0,1,12,0v80a6,6,0,0,1-12,0Zm57.28-77A6,6,0,0,0,172.72,61C196.41,76.47,210,100.88,210,128a82,82,0,0,1-164,0c0-27.12,13.59-51.53,37.28-67A6,6,0,0,0,76.72,51C49.57,68.68,34,96.75,34,128a94,94,0,0,0,188,0C222,96.75,206.43,68.68,179.28,51Z"),
    minus: SV('<path d="M5 12h14"/>'),
    plus: SV('<path d="M5 12h14M12 5v14"/>'),
    "defrost-front": SV('<path d="M5 20v-4.5l1.5-3.5h11l1.5 3.5V20M5 17.5h14M8 4c-1 1.2 1 2.3 0 3.5M12 4c-1 1.2 1 2.3 0 3.5M16 4c-1 1.2 1 2.3 0 3.5"/>'),
  };
  const icon = (name, attrs = "") => (ICONS[name] || "").replace('class="ic"', `class="ic" ${attrs}`);

  // In the garage: the last garage photo (module tesla-driveway-lock, input_text JSON {"<spot>": "<prefix>", ...})
  // names this car on one of its spots. Without spots in the config every key except the known ones counts.
  const NOT_SPOTS = ["t", "car", "why", "drive", "tried", "description"];
  const inGarage = (raw, prefix, spots) => {
    try {
      const f = JSON.parse(raw || "{}");
      const keys = spots?.length ? spots : Object.keys(f).filter((k) => !NOT_SPOTS.includes(k));
      return keys.some((k) => f[k] === prefix);
    } catch {
      return false;
    }
  };

  // Everything the card shows, read from the states of one car (e = entity ids per role from the card config).
  const readModel = (h, cfg) => {
    const e = cfg.entities || {};
    const st = (role) => (e[role] ? h.states[e[role]]?.state : undefined);
    const at = (role, k) => (e[role] ? h.states[e[role]]?.attributes?.[k] : undefined);
    const has = (role) => !!(e[role] && h.states[e[role]]);
    const lvl = num(st("battery"));
    const charging = st("charging_state") === "charging";
    const kw = num(st("charger_power"));
    const volt = num(st("charger_voltage"));
    const plugged = st("charge_cable") === "on";
    // Fast charger: more than 22 kW, or a voltage below 50 V (a Supercharger reports ~0 kW and ~1 V); at home ~230 V.
    const fast = charging && (kw > 22 || volt < 50);
    const mode = fast ? "fast" : charging ? "slow" : plugged ? "plugged" : "off";
    const ids = (list) => (Array.isArray(list) ? list : []);
    const open = [
      ...ids(e.doors)
        .filter((id) => h.states[id]?.state === "on")
        .map((id) => h.states[id]?.attributes?.friendly_name || id),
      ...(st("frunk") === "open" ? [S.frunk] : []),
      ...(st("trunk") === "open" ? [S.trunk] : []),
    ];
    // Tyre pressure in bar; a sensor in psi is converted.
    const tyres = ids(e.tyres).map((id) => {
      const v = num(h.states[id]?.state);
      return h.states[id]?.attributes?.unit_of_measurement === "psi" ? v / 14.504 : v;
    });
    const grid = cfg.grid_power ? h.states[cfg.grid_power] : null;
    const gridW = num(grid?.state) * (grid?.attributes?.unit_of_measurement === "kW" ? 1000 : 1);
    const weather = cfg.weather ? h.states[cfg.weather] : null;
    const home = st("location") === "home";
    const photo = cfg.garage_photo ? h.states[cfg.garage_photo]?.state : undefined;
    return {
      name: cfg.name,
      lvl, mode, kw, volt, plugged, fast, charging, open, tyres,
      minBar: Math.min(...tyres.filter(Number.isFinite)),
      has: Object.fromEntries(
        ["lock", "frunk", "trunk", "charge_port", "climate", "charge_switch", "flash_lights", "honk", "sentry", "windows",
          "charge_limit", "defrost"].map((r) => [r, has(r)]),
      ),
      lock: st("lock"),
      frunk: st("frunk"),
      trunk: st("trunk"),
      // can the car close it remotely? (cover feature 2 = close). Many frunks only open: close them by hand.
      frunkCloses: (num(at("frunk", "supported_features")) & 2) === 2,
      trunkCloses: (num(at("trunk", "supported_features")) & 2) === 2,
      chargePort: st("charge_port"),
      windows: st("windows"),
      chargeOn: st("charge_switch") === "on",
      limit: num(st("charge_limit")),
      limitMin: num(at("charge_limit", "min")) || 50,
      limitMax: num(at("charge_limit", "max")) || 100,
      range: num(st("range")),
      odometer: num(st("odometer")),
      sentry: st("sentry") === "on",
      climate: st("climate"),
      temp: num(at("climate", "current_temperature")),
      target: num(at("climate", "temperature")),
      tmin: num(at("climate", "min_temp")) || 15,
      tmax: num(at("climate", "max_temp")) || 28,
      inside: num(st("inside_temperature")),
      outside: num(st("outside_temperature")),
      defrost: st("defrost") === "on",
      home,
      hasPhoto: photo !== undefined,
      garage: home && photo !== undefined && inGarage(photo, cfg.prefix, cfg.garage_spots),
      weather: weather?.state,
      weatherTemp: num(weather?.attributes?.temperature),
      gridW,
      // seats: [state, options] per role, only for the entities that exist
      seats: Object.fromEntries(
        ["steering_wheel_heater", "seat_heater_left", "seat_heater_right", "seat_cooler_left", "seat_cooler_right"]
          .filter(has)
          .map((r) => [r, [st(r), at(r, "options") || []]]),
      ),
    };
  };

  const stateText = (m) => {
    if (m.mode === "fast") return m.kw > 0 ? fill(S.fastChargingKw, { kw: nf(m.kw, 1) }) : S.fastChargingStation;
    if (m.mode === "slow") return Number.isFinite(m.volt) ? fill(S.chargingVolt, { v: nf(m.volt) }) : S.charging;
    if (m.mode === "plugged") return S.pluggedIn;
    return S.notPluggedIn;
  };

  // The battery as one line, like the Tesla app: the fill is the charge level, the colour the status.
  const batteryLine = (lvl) => {
    const w = Number.isFinite(lvl) ? Math.max(0, Math.min(100, lvl)) : 0;
    return `<span class="line" role="img" aria-label="${esc(fill(S.batteryAria, { pct: nf(lvl) }))}"><i style="width:${w}%;background:${battTok(lvl)}"></i></span>`;
  };

  // Icon tile, like the Tesla app: round icon, one word underneath.
  const tile = (act, ic, label, { on = false, warn = false, dis = false } = {}) => `
    <button class="tile${on ? " on" : ""}${warn ? " warn" : ""}" data-act="${act}" aria-label="${esc(label)}"
      aria-pressed="${on}" ${dis ? "disabled" : ""}>
      <span class="round">${icon(ic)}</span><small>${esc(label)}</small></button>`;

  class TeslaCarCard extends HTMLElement {
    setConfig(cfg) {
      if (!cfg?.name || !(MODELS[cfg.model] || cfg.image)) throw new Error(S.configError);
      this._cfg = cfg;
      this._m0 = MODELS[cfg.model] || null; // "s" / "y", or null with an own picture
      this._img = String(cfg.images || DEFAULT_IMAGES).replace(/\/?$/, "/");
      this._sig = null;
    }
    getCardSize() {
      return 6;
    }
    set hass(hass) {
      this._hass = hass;
      if (!this.shadowRoot) this._build();
      this._m = readModel(hass, this._cfg);
      const sig = JSON.stringify(this._m);
      if (sig === this._sig) return;
      this._sig = sig;
      this._render();
      if (this._popOpen() && !this._drag) this._renderPop();
      if (this._climOpen()) this._renderClimate();
      this._mark();
    }

    _build() {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="card"></div><dialog class="pop"></dialog><dialog class="clim"></dialog>`;
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
      this.shadowRoot.addEventListener("change", (e) => this._change(e));
      this.shadowRoot.addEventListener("input", (e) => this._input(e));
      this.shadowRoot.addEventListener("pointerdown", (e) => {
        if (e.target.matches?.("input[type=range]")) this._drag = true;
      });
      // Released outside the slider too: the popup catches up with the states it skipped while dragging.
      window.addEventListener("pointerup", () => {
        if (!this._drag) return;
        this._drag = false;
        if (this._popOpen()) this._renderPop();
      });
    }

    _popOpen() {
      return this.shadowRoot?.querySelector(".pop")?.open === true;
    }

    _areas() {
      const m = this._m;
      const area = AREAS[this._m0] || {};
      const out = [];
      for (const [kind, box] of Object.entries(area)) {
        if (!m.has[kind]) continue;
        const open = m[kind] === "open";
        const [l, t, w, h] = open ? AREAS_OPEN[this._m0]?.[kind] || box : box;
        const part = kind === "frunk" ? S.frunk : S.trunk;
        out.push(
          `<button class="area${open ? " open" : ""}" data-act="${kind}" aria-label="${esc(fill(open ? S.areaOpen : S.areaClosed, { part }))}"
            style="left:${l}%;top:${t}%;width:${w}%;height:${h}%"></button>`,
        );
      }
      return out.join("");
    }

    _render() {
      const m = this._m;
      const range = Number.isFinite(m.range) ? `${nf(m.range)} km` : "";
      const card = this.shadowRoot.querySelector(".card");
      const charging = m.mode === "fast" || m.mode === "slow";
      // only while charging; plugged in without charging needs no badge, the charger in the picture shows it
      const badge = !charging
        ? ""
        : `<span class="badge" style="${this._badgePlace()}" title="${esc(stateText(m))}"><b>${
            m.kw > 0 ? `${nf(m.kw, 1)} kW` : m.mode === "fast" ? esc(S.badgeFast) : esc(S.badgeCharging)
          }</b></span>`;
      const tiles = [
        m.has.lock && tile("lock", m.lock === "locked" ? "lock" : "lock-open", m.lock === "locked" ? S.unlock : S.lock, { warn: m.lock === "unlocked" }),
        m.has.frunk && tile("frunk", "car-side", m.frunk === "open" && !m.frunkCloses ? S.frunkOpen : S.frunk, { on: m.frunk === "open" }),
        m.has.trunk && tile("trunk", "car-back", S.trunk, { on: m.trunk === "open" }),
        m.has.charge_port && tile("charge_port", "charge-port", S.chargePort, { on: m.chargePort === "open" }),
        m.has.climate && tile("climate_screen", "fan", S.climate, { on: m.climate !== "off" && m.climate !== undefined }),
        m.has.charge_switch && tile("charge", m.chargeOn ? "pause" : "play", m.chargeOn ? S.stopCharging : S.startCharging, { on: m.chargeOn, dis: !m.plugged && !m.charging }),
        m.has.flash_lights && tile("lights", "headlights", S.lights),
        m.has.honk && tile("horn", "horn", S.horn),
        m.has.sentry && tile("sentry", "sentry", S.sentry, { on: m.sentry }),
        m.has.windows && tile("windows", m.windows === "open" ? "window-open" : "window-closed", S.windows, { on: m.windows === "open" }),
      ].filter(Boolean);
      const own = !this._m0;
      card.innerHTML = `
        <div class="head">
          <b>${esc(m.name)}</b>
          ${this._place()}
        </div>
        <div class="stage${own ? " own" : ""}" style="${this._floor()}">
          ${own ? "" : `<div class="ground" style="${this._ground()}"></div>`}
          ${badge}
          <img src="${esc(this._picture())}" alt="" draggable="false">
          ${this._energy()}
          ${this._areas()}
        </div>
        <button class="batt" data-act="more" aria-label="${esc(fill(S.batteryAria, { pct: nf(m.lvl) }))}">
          <span class="pct" style="color:${battTok(m.lvl)}">${nf(m.lvl)}<small> %</small></span>
          <small>${esc(range)}</small>
          ${batteryLine(m.lvl)}
        </button>
        ${tiles.length ? `<div class="grid">${tiles.join("")}</div>` : ""}
        <div class="foot">
          <button class="pill" data-act="more" aria-label="${esc(S.more)}" title="${esc(S.more)}">${icon("tune")}</button>
          <span class="pill${m.home ? " on" : ""}" title="${esc(m.home ? S.home : S.away)}">${icon(m.home ? "pin-home" : "pin-away")}</span>
          ${Number.isFinite(m.minBar) && m.minBar < TYRE_MIN_BAR ? `<span class="pill warn" title="${esc(S.tyreLow)}">${icon("tyre-alert")}</span>` : ""}
          ${this._cfg.settings_path ? `<button class="pill" data-act="settings" aria-label="${esc(S.chargeSettings)}" title="${esc(S.chargeSettings)}">${icon("gear")}</button>` : ""}
        </div>`;
      // Dark house style: the card colour is dark, so the picture is lit a little brighter (see .dark).
      // Before the card is in the page the colour is not resolved yet: then the card stays light.
      const rgb = (getComputedStyle(card).backgroundColor.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
      card.classList.toggle("dark", 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 128);
    }

    _openPop() {
      const d = this.shadowRoot.querySelector(".pop");
      this._renderPop();
      if (!d.open) d.showModal();
    }

    // The detail: range, odometer, tyres, the open parts, charge limit, climate and sentry.
    _renderPop() {
      const m = this._m;
      const lim = Number.isFinite(m.limit) ? m.limit : m.limitMax;
      const tyres = m.tyres.some(Number.isFinite)
        ? m.tyres.map((v) => (Number.isFinite(v) ? nf(v, 1) : "–")).join(" · ") + " bar"
        : S.unknown;
      const range = Number.isFinite(m.range) ? `${nf(m.range)} km` : S.unknown;
      const odo = Number.isFinite(m.odometer) ? `${nf(m.odometer)} km` : S.unknown;
      const openTxt = m.open.length ? m.open.join(", ") : S.allClosed;
      this.shadowRoot.querySelector(".pop").innerHTML = `
        <div class="ph"><span class="t"><b>${esc(m.name)}</b><small>${esc(stateText(m))}</small></span>
          <button class="rnd" data-act="close" aria-label="${esc(S.close)}">${icon("close")}</button></div>
        <div class="block">
          <div class="row"><span>${esc(S.range)}</span><b>${esc(range)}</b></div>
          <div class="row"><span>${esc(S.odometer)}</span><b>${esc(odo)}</b></div>
          <div class="row"><span>${esc(S.tyres)}</span><b>${esc(tyres)}</b></div>
          <div class="row"><span>${esc(S.open)}</span><b>${esc(openTxt)}</b></div>
        </div>
        ${m.has.charge_limit ? `<div class="block">
          <div class="limit"><span>${icon("battery")} ${esc(S.chargeLimit)}</span><b data-lv>${nf(lim)} %</b></div>
          <input type="range" data-limit min="${m.limitMin}" max="${m.limitMax}" step="1" value="${lim}" aria-label="${esc(S.chargeLimit)}">
        </div>` : ""}
        ${m.has.climate || m.has.sentry ? `<div class="block">
          ${m.has.climate ? `<div class="row"><span>${esc(S.climate)}</span><b>${m.climate === "off" ? esc(S.stateOff) : esc(fill(S.climateOn, { t: nf(m.temp) }))}</b></div>` : ""}
          ${m.has.sentry ? `<div class="row"><span>${esc(S.sentry)}</span><b>${esc(m.sentry ? S.stateOn : S.stateOff)}</b></div>` : ""}
        </div>` : ""}`;
      this._mark();
    }

    // Top right: in the garage only the garage; outside the weather (+ temperature), at home with the driveway icon
    // before it (the garage photo said: not in the garage) or a home pin (no garage photo configured).
    _place() {
      const m = this._m;
      if (m.garage) return `<span class="place" title="${esc(S.homeGarage)}">${icon("garage")}</span>`;
      const w = WEATHER[m.weather];
      const t = Number.isFinite(m.outside) ? m.outside : m.weatherTemp;
      const tt = Number.isFinite(t) ? `${nf(t)}°` : "";
      const weather = w ? `${icon(w[0])}${tt ? `<small>${tt}</small>` : ""}` : "";
      const where = m.home ? (m.hasPhoto ? S.homeDriveway : S.home) : S.away;
      const text = `${where}${w ? " · " + w[1] : ""}${tt ? " · " + tt : ""}`;
      const homeIcon = m.home ? icon(m.hasPhoto ? "driveway" : "pin-home") : "";
      return `<span class="place" title="${esc(text)}">${homeIcon}${weather}</span>`;
    }

    // Key of the charger picture shown ("s-fast", "y-home") or null.
    _chargerKey() {
      const m = this._m;
      if (!this._m0) return null;
      return m.fast ? `${this._m0}-fast` : m.plugged || m.charging ? `${this._m0}-home` : null;
    }

    // Energy flowing through the cable while charging, like the Tesla app: the cable glows softly in the colour and a
    // bright comet (head + fading tail) glides from the charger to the car.
    _energy() {
      const m = this._m;
      const k = CABLE[this._chargerKey()];
      if (!k || !m.charging) return "";
      const grid = m.fast || m.gridW > 100;
      const colour = grid ? tok("bad", "#A63B28") : tok("good", "#41692F");
      const d = smooth(k.pts);
      // Speed follows the charge power on a log scale: ~1.4 kW 2.9 s, 11 kW 0.8 s, fast charger 0.45 s (a fast
      // charger may report 0 kW: it counts as 150 kW). The negative delay keeps the comet in phase with the clock, so
      // a re-render on a new reading does not restart it.
      const kw = m.kw > 0 ? m.kw : m.fast ? 150 : 1.4;
      const dur = Math.min(3.2, Math.max(0.45, 3.2 - Math.log(kw)));
      const phase = -((Date.now() / 1000) % dur);
      return `<svg class="energy" viewBox="0 0 ${k.w} ${k.h}" preserveAspectRatio="none" aria-hidden="true"
        style="--flow:${colour};--dur:${dur.toFixed(2)}s;--phase:${phase.toFixed(2)}s">
        <title>${esc(grid ? S.fromGrid : S.fromSun)}</title>
        <path class="glow" d="${d}" pathLength="100"/>
        <g class="comet"><path class="tail2" d="${d}" pathLength="100"/><path class="tail1" d="${d}" pathLength="100"/>
        <path class="tip" d="${d}" pathLength="100"/></g></svg>`;
    }

    // Charge badge just above the charger in the picture, else top left.
    _badgePlace() {
      const l = CHARGER_TOP[this._chargerKey()];
      return l ? `left:auto;right:3%;top:${l[1]}%;transform:translateY(calc(-100% - 6px))` : "";
    }

    _ground() {
      const g = GROUND[this._m0];
      return g ? `left:${g[0]}%;right:${g[1]}%` : "";
    }

    // Wheel line of this model in % of the picture: the floor of the stage starts there.
    _floor() {
      const g = GROUND[this._m0];
      return g ? `--floor:${(g[2] - 0.3).toFixed(1)}%` : "";
    }

    _picture() {
      if (!this._m0) return this._cfg.image;
      const m = this._m;
      // An open lid shows on top: with a charger the charger picture with that lid open (charger and cable stay),
      // else the open-lid picture of the car alone. Trunk before frunk when both are open.
      const open = m.trunk === "open" ? "trunk" : m.frunk === "open" ? "frunk" : null;
      const base = this._chargerKey() || `${this._m0}-base`;
      if (base.endsWith("-base")) return `${this._img}${open ? `${this._m0}-${open}` : base}.webp`;
      return `${this._img}${base}${open ? `-${open}` : ""}.webp`;
    }

    _climOpen() {
      return this.shadowRoot?.querySelector(".clim")?.open === true;
    }

    _openClimate() {
      const d = this.shadowRoot.querySelector(".clim");
      this._renderClimate();
      if (!d.open) d.showModal();
    }

    // The climate screen, after the Tesla app: the interior from above with the seat and wheel heating on the seats,
    // the temperature, and power, defrost and vent below. Only what has an entity is shown.
    _renderClimate() {
      const m = this._m;
      // Level 0-3 of a seat/wheel select (off/low/medium/high).
      const level = (v) => ({ off: 0, low: 1, medium: 2, high: 3, on: 1 })[v] ?? 0;
      const Z = SEATS[this._m0] || null;
      // Seat and wheel: a round button on the seat, three short bars below for the level (red = heating, accent =
      // cooling). A tap steps to the next level the entity offers.
      const seat = (role, pos, ic, label, cool = false) => {
        if (!m.seats[role]) return "";
        const [v] = m.seats[role];
        const n = level(v);
        const bars = [1, 2, 3].map((k) => `<i class="${k <= n ? "full" : ""}"></i>`).join("");
        const style = Z && pos ? `style="left:${pos[0]}%;top:${pos[1]}%"` : "";
        return `<button class="seat${n ? " on" : ""}${cool ? " cool" : ""}" data-act="seat" data-role="${role}"
          aria-label="${esc(label)}: ${esc(v)}" ${style}>
          <span class="knob">${icon(ic)}</span><span class="level">${bars}</span></button>`;
      };
      const seats = [
        seat("steering_wheel_heater", Z?.wheel, "steering", S.steeringWheel),
        seat("seat_heater_left", Z?.left, "seat-heater", S.seatLeft),
        seat("seat_heater_right", Z?.right, "seat-heater", S.seatRight),
        seat("seat_cooler_left", Z && [Z.left[0], Z.left[1] + 14], "seat-cooler", S.coolingLeft, true),
        seat("seat_cooler_right", Z && [Z.right[0], Z.right[1] + 14], "seat-cooler", S.coolingRight, true),
      ].join("");
      const off = m.climate === "off";
      this.shadowRoot.querySelector(".clim").innerHTML = `
        <div class="cl-head">
          <span><b>${esc(m.name)}</b><small>${esc(fill(S.insideOutside, { in: nf(m.inside), out: nf(m.outside) }))}</small></span>
          <button class="rnd" data-act="climate_close" aria-label="${esc(S.close)}">${icon("chevron-down")}</button>
        </div>
        ${Z ? `<div class="cl-stage">
          <img src="${esc(`${this._img}${this._m0}-interior.webp`)}" alt="" draggable="false">
          ${seats}
        </div>` : seats ? `<div class="cl-row">${seats}</div>` : ""}
        <div class="cl-temp">
          <button data-act="temp" data-d="-0.5" aria-label="${esc(S.lower)}" ${off ? "disabled" : ""}>${icon("minus")}</button>
          <b>${nf(m.target, 1)} °</b>
          <button data-act="temp" data-d="0.5" aria-label="${esc(S.higher)}" ${off ? "disabled" : ""}>${icon("plus")}</button>
        </div>
        <div class="grid cl-grid">
          ${tile("climate_power", "power", off ? S.powerOn : S.powerOff, { on: !off })}
          ${m.has.defrost ? tile("defrost", "defrost-front", S.defrost, { on: m.defrost }) : ""}
          ${m.has.windows ? tile("windows", m.windows === "open" ? "window-open" : "window-closed", S.vent, { on: m.windows === "open" }) : ""}
        </div>`;
      this._mark();
    }

    // Two taps for moving parts, unlocking, charging, lights and horn. The pending confirm lives on the card
    // (this._pending), not on the button: a charging car re-renders every few seconds, which replaced the button and
    // lost the first tap.
    _confirm(act, run) {
      if (this._pending?.act === act && Date.now() < this._pending.until) {
        clearTimeout(this._pending.timer);
        this._pending = null;
        this._mark();
        run();
        return;
      }
      clearTimeout(this._pending?.timer);
      this._pending = {
        act,
        until: Date.now() + CONFIRM_MS,
        timer: setTimeout(() => ((this._pending = null), this._mark()), CONFIRM_MS),
      };
      this._mark();
    }

    // Shows the pending confirm ("Trunk ?") on every button of that action, also right after a re-render.
    _mark() {
      const act = this._pending && Date.now() < this._pending.until ? this._pending.act : null;
      this.shadowRoot?.querySelectorAll("[data-act]").forEach((el) => el.classList.toggle("confirm", el.dataset.act === act));
    }

    // Commands only from a real tap or change: a render or a test never sends one.
    _call(domain, service, data, ev) {
      if (!ev?.isTrusted) return;
      this._hass.callService(domain, service, data);
    }

    _click(ev) {
      const b = ev.composedPath().find((el) => el.dataset && el.dataset.act);
      if (!b) return;
      if (!ev.isTrusted) return; // a synthetic click opens nothing and sends nothing
      const e = this._cfg.entities || {};
      const m = this._m;
      const id = (role) => ({ entity_id: e[role] });
      const cover = (role, isOpen) => this._call("cover", isOpen ? "close_cover" : "open_cover", id(role), ev);
      switch (b.dataset.act) {
        case "more":
          return this._openPop();
        case "close":
          return this.shadowRoot.querySelector(".pop").close();
        case "settings":
          history.pushState(null, "", this._cfg.settings_path);
          return window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
        case "climate_screen":
          return this._openClimate();
        case "climate_close":
          return this.shadowRoot.querySelector(".clim").close();
        case "seat": {
          // Step to the next level the entity offers (off -> low -> medium -> high -> off).
          const role = b.dataset.role;
          const [cur, opts] = m.seats[role] || [null, []];
          if (!opts.length) return;
          const option = opts[(opts.indexOf(cur) + 1) % opts.length];
          return this._call("select", "select_option", { ...id(role), option }, ev);
        }
        case "temp": {
          if (!Number.isFinite(m.target)) return;
          const t = Math.min(m.tmax, Math.max(m.tmin, m.target + Number(b.dataset.d)));
          return this._call("climate", "set_temperature", { ...id("climate"), temperature: t }, ev);
        }
        case "climate_power":
          return this._call("climate", "set_hvac_mode", { ...id("climate"), hvac_mode: m.climate === "off" ? "heat_cool" : "off" }, ev);
        case "defrost":
          return this._call("switch", m.defrost ? "turn_off" : "turn_on", id("defrost"), ev);
        case "sentry":
          return this._call("switch", m.sentry ? "turn_off" : "turn_on", id("sentry"), ev);
        case "lock":
          // locking is direct; unlocking asks a second tap
          if (m.lock === "locked") return this._confirm("lock", () => this._call("lock", "unlock", id("lock"), ev));
          return this._call("lock", "lock", id("lock"), ev);
        case "charge":
          return this._confirm("charge", () =>
            this._call("switch", m.chargeOn ? "turn_off" : "turn_on", id("charge_switch"), ev));
        case "frunk":
          // an open frunk the car cannot close: nothing to send (it is closed by hand)
          if (m.frunk === "open" && !m.frunkCloses) return;
          return this._confirm("frunk", () => cover("frunk", m.frunk === "open"));
        case "trunk":
          if (m.trunk === "open" && !m.trunkCloses) return;
          return this._confirm("trunk", () => cover("trunk", m.trunk === "open"));
        case "charge_port":
          return this._confirm("charge_port", () => cover("charge_port", m.chargePort === "open"));
        case "windows":
          return this._confirm("windows", () => cover("windows", m.windows === "open"));
        case "lights":
          return this._confirm("lights", () => this._call("button", "press", id("flash_lights"), ev));
        case "horn":
          return this._confirm("horn", () => this._call("button", "press", id("honk"), ev));
      }
    }

    // While the slider moves only the number next to it changes; the command follows on release.
    _input(ev) {
      if (!ev.target.matches?.("[data-limit]")) return;
      const lv = this.shadowRoot.querySelector("[data-lv]");
      if (lv) lv.textContent = `${nf(Number(ev.target.value))} %`;
    }

    _change(ev) {
      if (!ev.target.matches?.("[data-limit]")) return;
      this._call("number", "set_value", { entity_id: this._cfg.entities.charge_limit, value: Number(ev.target.value) }, ev);
    }
  }

  const CSS = `
:host { display: block; color: var(--cw-text, var(--primary-text-color)); font-family: Figtree, system-ui, sans-serif; }
.card { background: var(--cw-card, var(--ha-card-background, var(--card-background-color, #fff))); border-radius: 26px;
  padding: 14px 14px 12px; box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0;
  -webkit-tap-highlight-color: transparent; }
button:focus-visible { outline: 2px solid var(--cw-accent-ink); outline-offset: 2px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.head b { font-size: 18px; font-weight: 600; }
.place { display: inline-flex; align-items: center; gap: 4px; color: var(--cw-muted); }
.place small { font-size: 14px; font-variant-numeric: tabular-nums; }
/* a small photo studio: a lit wall, a floor from the wheel line down, a light pool under the car, so the car stands
   on something instead of floating on the card. Only mixes of --cw-card with white/black, so every house style and
   light/dark get their own version. --floor = wheel line, set per model by _floor(). */
.stage { position: relative; display: block; width: 100%; margin: 6px 0 0; border-radius: 20px; overflow: hidden; --floor: 76%;
  background:
    radial-gradient(ellipse 62% 16% at 46% var(--floor), color-mix(in srgb, var(--cw-card) 82%, white), transparent 72%),
    radial-gradient(ellipse 80% 70% at 50% 30%, color-mix(in srgb, var(--cw-card) 90%, white), transparent 75%),
    linear-gradient(to bottom, color-mix(in srgb, var(--cw-card) 95%, white) 0%,
      color-mix(in srgb, var(--cw-card) 93%, white) calc(var(--floor) - 14%),
      color-mix(in srgb, var(--cw-card) 96%, black) calc(var(--floor) - 1%),
      color-mix(in srgb, var(--cw-card) 90%, black) 100%); }
.dark .stage { background:
    radial-gradient(ellipse 62% 16% at 46% var(--floor), color-mix(in srgb, var(--cw-card) 82%, white), transparent 72%),
    radial-gradient(ellipse 80% 70% at 50% 30%, color-mix(in srgb, var(--cw-card) 88%, white), transparent 75%),
    linear-gradient(to bottom, color-mix(in srgb, var(--cw-card) 93%, white) 0%,
      color-mix(in srgb, var(--cw-card) 90%, white) calc(var(--floor) - 14%),
      color-mix(in srgb, var(--cw-card) 85%, black) calc(var(--floor) - 1%),
      color-mix(in srgb, var(--cw-card) 70%, black) 100%); }
.stage.own { background: none; }
/* the cut-out cars (transparent WebP) sit on the stage itself, never with a blend mode: multiply turns a cut-out car
   black on a dark card. On dark a little brighter. */
.stage img { position: relative; display: block; width: 100%; height: auto; user-select: none;
  filter: drop-shadow(0 2px 3px rgba(60, 40, 20, 0.12)); }
.dark .stage img { filter: brightness(1.2) saturate(1.1); }
/* contact shadow on the floor: a tight dark core right under the tyres plus a wide soft one (the same in every state) */
.stage .ground { position: absolute; left: 12%; right: 12%; top: calc(var(--floor) - 3%); height: 7%;
  background: radial-gradient(ellipse 50% 22% at 50% 45%, rgba(30, 20, 10, 0.38), transparent 100%),
    radial-gradient(ellipse 54% 50% at 50% 45%, rgba(30, 20, 10, 0.16), transparent 100%); }
.dark .stage .ground { background: radial-gradient(ellipse 50% 22% at 50% 45%, rgba(0, 0, 0, 0.7), transparent 100%),
    radial-gradient(ellipse 54% 50% at 50% 45%, rgba(0, 0, 0, 0.35), transparent 100%); }
/* invisible tap zone on frunk / trunk; the open-lid picture already shows what is open */
.area { position: absolute; z-index: 1; border-radius: 40% 40% 30% 30%; background: transparent; border: 0; padding: 0;
  outline: none; -webkit-tap-highlight-color: transparent; cursor: pointer; }
.batt { display: flex; flex-direction: column; align-items: flex-start; width: 100%; margin-top: 6px; text-align: left; }
.pct { font-size: 30px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.pct small { font-size: 16px; font-weight: 600; }
.batt > small { font-size: 13px; color: var(--cw-muted); }
.line { display: block; width: 100%; height: 8px; margin-top: 8px; border-radius: 999px; background: var(--cw-raised); overflow: hidden; }
.line i { display: block; height: 100%; border-radius: 999px; }
/* the icon grid: five per row, round icons like the Tesla app */
.grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px 4px; margin-top: 12px; }
.tile { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.tile .round { display: flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 50%;
  background: var(--cw-raised); }
.tile.on .round { box-shadow: inset 0 0 0 2px var(--cw-accent-ink); }
.tile:disabled { opacity: .45; cursor: default; }
.tile small { font-size: 11px; color: var(--cw-muted); text-align: center; line-height: 1.1; }
.tile.confirm .round { background: var(--cw-accent-ink); }
.tile.confirm small::after { content: " ?"; }
.foot { display: flex; justify-content: center; gap: 10px; margin-top: 12px; }
.pill { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;
  background: var(--cw-raised); }
/* drawn icons: thin lines in accent-ink; warn/raised where the state needs it */
.ic { width: 22px; height: 22px; flex: none; color: var(--cw-accent-ink); fill: none; stroke: currentColor; stroke-width: 1.1;
  stroke-linecap: round; stroke-linejoin: round; }
.place .ic { color: var(--cw-muted); }
.tile .ic { width: 24px; height: 24px; }
.tile.warn .ic, .pill.warn .ic { color: var(--cw-warn); }
.tile.confirm .ic { color: var(--cw-raised); }
/* energy in the cable while charging: the whole cable glows softly in the colour, and a comet glides charger -> car.
   pathLength=100; each part is one dash (length L, gap 400) whose front runs 0 -> 165, so dashoffset goes L -> L-165. */
.energy { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.energy path { fill: none; stroke: var(--flow); stroke-linecap: round; stroke-linejoin: round; }
.energy .glow { stroke-width: 11; opacity: .35; }
.energy .comet { filter: drop-shadow(0 0 2px var(--flow)) drop-shadow(0 0 5px var(--flow)); }
.energy .tip { stroke-width: 15; stroke-dasharray: 14 400;
  animation: comet-tip var(--dur, 1.5s) cubic-bezier(.45, 0, .55, 1) var(--phase, 0s) infinite; }
.energy .tail1 { stroke-width: 12; opacity: .6; stroke-dasharray: 36 400;
  animation: comet-1 var(--dur, 1.5s) cubic-bezier(.45, 0, .55, 1) var(--phase, 0s) infinite; }
.energy .tail2 { stroke-width: 10; opacity: .28; stroke-dasharray: 64 400;
  animation: comet-2 var(--dur, 1.5s) cubic-bezier(.45, 0, .55, 1) var(--phase, 0s) infinite; }
.dark .energy .tip { stroke: color-mix(in srgb, var(--flow) 55%, white); }
@keyframes comet-tip { from { stroke-dashoffset: 14; } to { stroke-dashoffset: -151; } }
@keyframes comet-1 { from { stroke-dashoffset: 36; } to { stroke-dashoffset: -129; } }
@keyframes comet-2 { from { stroke-dashoffset: 64; } to { stroke-dashoffset: -101; } }
@media (prefers-reduced-motion: reduce) { .energy .comet { display: none; } .energy .glow { opacity: .7; } }
/* charge badge above the charger: only the kW (or a word when no power is reported), no icon */
.badge { position: absolute; z-index: 2; left: 4%; top: 4%; display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 999px; background: var(--cw-raised); color: var(--cw-text); font-size: 13px; }
.badge b { font-weight: 600; font-variant-numeric: tabular-nums; }
/* climate screen: the interior picture fills the height, the seat and wheel buttons sit on the seats */
.clim { border: 0; border-radius: 26px; padding: 14px; box-sizing: border-box; width: min(96vw, 440px);
  max-height: 94vh; background: var(--cw-card); color: var(--cw-text); font-family: Figtree, system-ui, sans-serif; }
.clim::backdrop { background: rgb(0 0 0 / .5); }
.cl-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cl-head b { display: block; font-size: 18px; font-weight: 600; }
.cl-head small { font-size: 13px; color: var(--cw-muted); }
.cl-stage { position: relative; width: min(100%, calc(52vh * 0.667)); aspect-ratio: 2 / 3; margin: 8px auto 0; }
.cl-stage img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: contain; user-select: none; }
.cl-stage .seat { position: absolute; transform: translate(-50%, -50%); }
.cl-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin-top: 12px; }
.seat { display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: 0; padding: 0; }
.seat .knob { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--cw-raised) 92%, transparent); box-shadow: 0 1px 4px rgb(0 0 0 / .18); }
.seat.on .knob { box-shadow: inset 0 0 0 2px var(--cw-bad, #A63B28), 0 1px 4px rgb(0 0 0 / .18); }
.seat.on .knob .ic { color: var(--cw-bad, #A63B28); }
.seat.cool.on .knob { box-shadow: inset 0 0 0 2px var(--cw-accent-ink), 0 1px 4px rgb(0 0 0 / .18); }
.seat.cool.on .knob .ic { color: var(--cw-accent-ink); }
.seat .level { display: flex; gap: 3px; padding: 2px 4px; border-radius: 999px; background: color-mix(in srgb, var(--cw-raised) 85%, transparent); }
.seat .level i { width: 9px; height: 3px; border-radius: 2px; background: var(--cw-line, rgb(0 0 0 / .2)); }
.seat .level i.full { background: var(--cw-bad, #A63B28); }
.seat.cool .level i.full { background: var(--cw-accent-ink); }
.seat:focus-visible .knob { outline: 2px solid var(--cw-accent-ink); outline-offset: 2px; }
.cl-temp { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 10px; font-size: 26px; font-weight: 600; }
.cl-temp button { width: 44px; height: 44px; border-radius: 50%; background: var(--cw-raised); display: inline-flex; align-items: center; justify-content: center; }
.cl-temp button:disabled { opacity: .45; cursor: default; }
.cl-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; }
/* detail popup */
.pop { border: 0; border-radius: 22px; padding: 16px; width: min(92vw, 420px); box-sizing: border-box;
  background: var(--cw-card); color: var(--cw-text); font-family: Figtree, system-ui, sans-serif; }
.pop::backdrop { background: rgb(0 0 0 / .45); }
.ph { display: flex; align-items: center; gap: 10px; }
.ph .t { flex: 1; min-width: 0; }
.ph b { display: block; font-size: 18px; }
.ph small { font-size: 14px; color: var(--cw-muted); }
.rnd { width: 44px; height: 44px; border-radius: 50%; background: var(--cw-raised); flex: none;
  display: inline-flex; align-items: center; justify-content: center; }
.block { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--cw-line); }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 15px; }
.row span { color: var(--cw-muted); }
.row b { font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.limit { display: flex; justify-content: space-between; align-items: center; font-size: 15px; color: var(--cw-muted); }
.limit b { font-size: 16px; color: var(--cw-text); }
.limit span { display: inline-flex; align-items: center; gap: 6px; }
input[type=range] { width: 100%; height: 40px; margin: 0; accent-color: var(--cw-accent-ink); }
@media (max-width: 340px) {
  .grid { gap: 6px 2px; }
  .tile .round { width: 42px; height: 42px; }
  .tile small { font-size: 10px; }
  .pct { font-size: 26px; }
}
`;

  if (!customElements.get("tesla-car-card")) customElements.define("tesla-car-card", TeslaCarCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "tesla-car-card"))
    window.customCards.push({ type: "tesla-car-card", name: S.cardName, description: `${S.cardDescription} (v${VERSION})` });
})();

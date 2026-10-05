<% from '_themes.jinja' import default_light with context %>
// Shared header components for the own screens and native views (themes Organic, Garden, … with --cw-* tokens).
//   <cw-kop titel="…" sub="…">  one-line page header: title (+ one muted sub line) left, round action buttons right.
//       Page actions go in slot="acties" (e.g. <cw-knop slot="acties" …>); the theme button is always last.
//       Rich sub line: put an element with slot="sub". Plain text children show only until this file has loaded.
//   <cw-knop icoon="lagen|tandwiel|…" label="…" [aan]>  round icon button (40px, 44px tap target); aan = accent fill.
//       Clicks bubble out of the shadow DOM, so a page's data-act/data-open delegation keeps working on the host.
//   <cw-thema-knop>  round button with the current mode icon; opens a small menu: Style (every HA theme with --cw-* tokens
//       in light and dark, see base/tools/build_themes.py; only when there are two or more) and Appearance (Automatic /
//       Light / Dark), texts from strings.yaml. Fires HA's own "settheme" event (themes-mixin): saved per HA user
//       (frontend user data "theme"), so each person keeps their own style on all their devices.
//   <cw-status chips='[{"icon":"…","value":"…","label":"…","tone":"aan|warn|bad","path":"…","entity":"…","act":"…"}]'>
//       row of compact status chips (icon + value, one short word below). Tap: path = navigate, entity = more-info,
//       act = data-act on the chip for the page's own click handler. Max 4 per row on a phone, never scrolls sideways.
//       bewaar="key": every HA user picks which chips show and in which order (frontend user data "cw-status-<key>",
//       like the theme). Long press on the row or el.kies(button) opens the picker. Chips then need a stable "id"
//       (+ "naam" for the picker); without a saved choice calm chips with "minder" (higher = first) drop out until
//       the row needs at most 2 rows. Shortcut chips ({vul: 1, nav: true, path}) only fill free spots of the last
//       row by default (lowest vul first); after a saved choice they stay off until the user turns them on.
//   <cw-chip icoon="…" label="…" [toon="aan|goed|warn|bad"] [kaal] [uit]>tekst</cw-chip>  small inline chip (icon + short
//       text) for inside cards; label = full meaning (title + aria-label). kaal = no background, uit = dimmed, icon struck through.
//       naar="…" adds "→ icon" (a flow, e.g. zon → huisje); bij="…" adds a second icon without arrow. Icon colours via style="--ic: #…; --ic2: #…".
//       Tap on a chip with label/info/entity/path opens the info sheet: titel (or label), info (one sentence),
//       waarden='[["k","v"],…]', Details button (entity = HA more-info, path = navigate, pad-label = button text).
//   <cw-metric items='[{"icon","color","value","label","info","titel","entity","path","padLabel","waarden"}]' [kolommen="4"]>
//       grid of metrics: (icon) big value, one or two words below. Cells with info/entity/path open the info sheet.
//   <cw-toggles items='[{"icon","label","sub","on","act","entity","dir","info","titel"}]'>  grid of small icon toggles
//       (icon + 1–2 words + optional small line with the effect, "\n" = next line, ≥ 44 px). A split item {icon, label, split: [{label, icon,
//       act, dir, kind, …}, {…}]} is one tile with the name on top and two arrow-only halves (↑ | ↓; label goes to aria-label/title). on = accent icon + tint; act/entity/dir become data-* for the page's click handler;
//       long press or right-click opens the info sheet; stap: {label, entity, min, max, step, unit} puts a − value + row in it.
//   Colours fall back to HA's own theme variables when the --cw-* tokens are missing. Accent icons use --cw-accent-ink
//   (the accent at ≥ 4.5:1 on card and page, for people with low vision).
//   <cw-icoon naam="…" [maat="20"] [kleur="…"] [vul="0.7"]>  one icon from ICONS for the screens in other modules, so the same
//       thing has the same icon everywhere. Light DOM + display: contents, so the page's own CSS for "svg" keeps working;
//       maat = width/height in px (else the page CSS sizes it), kleur = stroke colour, vul = battery level 0–1 (batterij).
//   <cw-info label="…">  small (i) button; tap shows the text in the same info sheet.
//   Info sheet (openSheet): small dialog in document.body (never clipped), Esc / tap outside closes, focus returns.
// Lovelace cards: custom:cw-kop (title, subtitle), custom:cw-status (chips) and custom:cw-thema-kiezer (theme button).
// Loaded as an inline Lovelace module resource.
(() => {
  // The language is part of the version, so browsers reload the file when house.language changes.
  const VERSION = "28-<@ t('language_code') @>";
  // Default style when the user has not picked one of the themes (house.yaml base.default_theme, light).
  const THEME = <@ t('theme_name_' ~ default_light) | tojson @>;
  const svg = (body) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  // Battery outline without the level; ICONS.batterij adds two level lines, <cw-icoon vul> a filled level.
  const BATT = `<rect x="6" y="4" width="12" height="18" rx="2"/><path d="M10 2h4"/>`;
  const ICONS = {
    // Theme modes (separate names: "auto" is the car icon below).
    "modus-auto": `<circle cx="12" cy="12" r="8"/><path d="M12 4 A8 8 0 0 1 12 20 Z" fill="currentColor" stroke="none"/>`,
    "modus-licht": `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>`,
    "modus-donker": `<path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z"/>`,
    // Status icons (cw-status), 24x24 strokes.
    thermo: `<path d="M3 11 L12 3 L21 11"/><path d="M5 9.5 V21 H19 V9.5"/><path d="M12 9 V15"/><circle cx="12" cy="16.5" r="1.8"/>`,
    zon: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>`,
    maan: `<path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z"/>`,
    wolk: `<path d="M7 19h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 19z"/>`,
    zonwolk: `<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M1.5 8H3M3.4 3.4l1 1M12.6 3.4l-1 1"/><path d="M9 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A3 3 0 0 0 9 20z"/>`,
    regen: `<path d="M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>`,
    // Weather on the same cloud as regen: small flakes = "*" of three short strokes.
    sneeuw: `<path d="M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 17.2v3.6M6.4 18.1l3.2 1.8M6.4 19.9l3.2-1.8M16 17.2v3.6M14.4 18.1l3.2 1.8M14.4 19.9l3.2-1.8M12 19.6v2.4M10.9 20.2l2.2 1.2M10.9 21.4l2.2-1.2"/>`,
    stortregen: `<path d="M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M7 17.5l-1.5 4.5M10 17.5l-1.5 4.5M13 17.5l-1.5 4.5M16 17.5l-1.5 4.5M19 17.5l-1 3"/>`,
    onweerregen: `<path d="M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 16l-2.5 3.5h3l-2 3.5"/><path d="M7 18l-1 3M17 18l-1 3"/>`,
    hagel: `<path d="M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><circle cx="7.5" cy="18.5" r="1.1"/><circle cx="12" cy="18.5" r="1.1"/><circle cx="16.5" cy="18.5" r="1.1"/><circle cx="9.8" cy="21.6" r="1.1"/>`,
    natsneeuw: `<path d="M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M9 17.2v3.6M7.4 18.1l3.2 1.8M7.4 19.9l3.2-1.8"/><path d="M14.5 17.5l-1 3M17.5 17.5l-1 3"/>`,
    wind: `<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>`,
    poort: `<path d="M3 21V5M21 21V5M3 8h18M3 13h18M3 18h18M8 8v10M13 8v10M18 8v10"/>`,
    rolluik: `<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 7h16M4 11h16M4 15h16"/>`,
    mensen: `<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.3c3 0 5.5 2.2 5.5 5.7"/>`,
    // Side view (rounded fastback), shifted up 1 so it sits centred in the 24 box.
    auto: `<g transform="translate(0 -1)"><path d="M4.7 16.5 H3 V13.6 c0-1 .7-1.7 1.6-1.9 L8.2 11 c1.4-1.9 3.2-3.6 6-3.6 c2.4 0 4.3 1.3 5.7 3.3 l1 .3 c.7.2 1.1.8 1.1 1.5 v3.9 H19.3"/><path d="M9.3 16.5 H14.7"/><circle cx="7" cy="16.5" r="2.3"/><circle cx="17" cy="16.5" r="2.3"/><path d="M8.5 11 H19.6"/></g>`,
    bliksem: `<path d="M13 2 L5 13 H11 L10 22 L18 10 H12 Z" fill="currentColor" stroke="none"/>`,
    schild: `<path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z"/>`,
    euro: `<path d="M18 6.5 A7 7 0 1 0 18 17.5"/><path d="M4 10 H13 M4 14 H13"/>`,
    klok: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
    stekker: `<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>`,
    huisje: `<path d="M4 11 L12 4 L20 11M6 9.5V20h12V9.5M10 20v-5h4v5"/>`,
    kantoor: `<path d="M4 21V4h10v17M14 9h6v12M7 8h2M7 12h2M7 16h2M17 13h1M17 17h1M2 21h20"/>`,
    navigatie: `<path d="M12 2 L20 21 L12 17 L4 21 Z"/>`,
    pin: `<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>`,
    net: `<path d="M12 2 L6 22 M12 2 L18 22 M8 15 H16 M9.5 9 H14.5 M3 6 H21"/>`,
    batterij: `${BATT}<path d="M9 14h6M9 18h6"/>`,
    op: `<path d="M12 20V5M6 11l6-6 6 6"/>`,
    neer: `<path d="M12 4v15M6 13l6 6 6-6"/>`,
    pijl: `<path d="M4 12h14M13 7l5 5-5 5"/>`,
    vlag: `<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>`,
    pauze: `<path d="M9 6v12M15 6v12"/>`,
    vink: `<path d="M5 12.5 L10 17 L19 7"/>`,
    druppel: `<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 16.5l5-5M9.8 12h.01M14.2 16h.01"/>`,
    boom: `<path d="M12 2l6 9h-3l4 6H5l4-6H6z"/><path d="M12 17v5"/>`,
    vloer: `<path d="M3 20h18M5 16c2-2 4 2 6 0s4 2 6 0 2-1 2-1M5 11c2-2 4 2 6 0s4 2 6 0 2-1 2-1"/>`,
    ventilator: `<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 2 3 0 5l-4 2M14 12c4 0 7 1 7 4 0 2-3 2-5 0l-2-4M12 14c0 4-1 7-4 7-2 0-2-3 0-5l4-2M10 12c-4 0-7-1-7-4 0-2 3-2 5 0l2 4"/>`,
    koud: `<path d="M12 2v20M4 7l16 10M4 17l16-10M9 4l3 2 3-2M9 20l3-2 3 2"/>`,
    warm: `<path d="M8 21c-2-3 2-5 0-8M12 21c-2-3 2-5 0-8M16 21c-2-3 2-5 0-8"/><path d="M5 9a7 7 0 0 1 14 0"/>`,
    boiler: `<rect x="6" y="2" width="12" height="18" rx="4"/><path d="M9 22v-2M15 22v-2M12 7c-1.5 2-2 3-2 4a2 2 0 0 0 4 0c0-1-.5-2-2-4z"/>`,
    piek: `<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>`,
    info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>`,
    waarschuwing: `<path d="M12 3 L22 20 H2 Z"/><path d="M12 10v4M12 17.2v.01"/>`,
    douche: `<path d="M4 20V8a4 4 0 0 1 8 0"/><path d="M9 8h6l-1 3h-4z"/><path d="M10.5 14v1M13 14.5v1M15.5 14v1M11.5 17.5v1M14.5 17.5v1"/>`,
    lamp: `<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>`,
    mist: `<path d="M3 8c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 13c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 18c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0"/>`,
    maanwolk: `<path d="M13.5 9.5A5 5 0 1 1 6.6 4a4 4 0 0 0 6.9 5.5z"/><path d="M9 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A3 3 0 0 0 9 20z"/>`,
    deurbel: `<rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="12" cy="8" r="2.5"/><circle cx="12" cy="16" r="1.5"/>`,
    pakje: `<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9M7.8 5.2l8.5 4.6"/>`,
    warmwater: `<rect x="3" y="2" width="11" height="17" rx="3.5"/><path d="M5.5 21.5V19M11.5 21.5V19M8.5 6.5c-1.3 1.7-1.8 2.6-1.8 3.4a1.8 1.8 0 0 0 3.6 0c0-.8-.5-1.7-1.8-3.4z"/><circle cx="18" cy="16.5" r="4.2"/><path d="M18 14.3v2.2l1.4.9"/>`,
    gordijn: `<path d="M3 3h18M5 3v18M19 3v18M5 3c3 4 4 10 2 18M19 3c-3 4-4 10-2 18"/>`,
    laadpaal: `<rect x="5" y="3" width="9" height="18" rx="2"/><path d="M8 8h3M14 10h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8l-2-2"/>`,
    // Energy screens: self-use (blad), charge current (golf), history link (grafiek); kruis = no / close.
    blad: `<path d="M19.5 4C9 4 4.5 9 4.5 18c9 0 15-4.5 15-14zM4.5 20 12 12"/>`,
    golf: `<path d="M3 12c3-6 6-6 9 0s6 6 9 0"/>`,
    grafiek: `<path d="M3 20h18M6 16l4-5 4 3 6-8"/>`,
    kruis: `<path d="M6 6l12 12M18 6 6 18"/>`,
    // Outdoor unit with fan (Vaillant aroTHERM), jacuzzi tub with steam.
    warmtepomp: `<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="9.5" cy="12" r="4"/><path d="M9.5 10v4M7.5 12h4M16.5 9h2.5M16.5 12h2.5M16.5 15h2.5"/>`,
    bad: `<path d="M3 14h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 10c0-2 2-2 2-4M12 10c0-2 2-2 2-4M17 10c0-2 2-2 2-4"/>`,
    lagen: `<path d="M12 3 L22 8 L12 13 L2 8 Z"/><path d="M2 12 L12 17 L22 12"/><path d="M2 16 L12 21 L22 16"/>`,
    camera: `<path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/>`,
    kalender: `<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
    luidspreker: `<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>`,
    schuif: `<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>`,
    tandwiel: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>`,
  };
  const MODES = [
    { k: "auto", label: <@ t('theme_auto') | tojson @> },
    { k: "licht", label: <@ t('theme_light') | tojson @> },
    { k: "donker", label: <@ t('theme_dark') | tojson @> },
  ];
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const app = () => document.querySelector("home-assistant");
  // Fill the {name} placeholders of a translated text (strings.yaml) with values that are already escaped.
  const fmt = (text, vars) =>
    text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

  // Round button look, shared by cw-knop and cw-thema-knop.
  const ROUND = `
:host { display: inline-flex; width: 44px; height: 44px; align-items: center; justify-content: center; flex: none; }
button { width: 40px; height: 40px; border: 0; padding: 0; border-radius: 999px; cursor: pointer; font: inherit;
  display: flex; align-items: center; justify-content: center;
  background: var(--cw-card, var(--card-background-color, #2a2622)); color: var(--cw-text, var(--primary-text-color, #F5EAD8)); }
button:hover { filter: brightness(1.08); }
button.on { background: var(--cw-accent, var(--primary-color, #D67F48)); color: var(--cw-on-accent, #1d1a17); }
button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: 2px; }
svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
`;

  // ---------- theme state (shared by every button on the page) ----------
  let picked = null; // optimistic choice until HA's hass reflects it
  const knoppen = new Set();
  const fresh = () => picked && Date.now() - picked.at < 4000;
  const currentMode = () => {
    if (fresh()) return picked.k;
    const d = app()?.hass?.selectedTheme?.dark;
    return d === true ? "donker" : d === false ? "licht" : "auto";
  };
  // House styles = HA themes that carry the --cw-* tokens (Organic first, then alphabetical).
  const stijlen = () => {
    const all = app()?.hass?.themes?.themes || {};
    return Object.keys(all)
      .filter((n) => all[n]?.modes?.light?.["cw-bg"] && all[n]?.modes?.dark?.["cw-bg"])
      .sort((a, b) => (a === THEME ? -1 : b === THEME ? 1 : a.localeCompare(b, <@ t('language_code') | tojson @>)));
  };
  const currentStijl = () => {
    if (fresh()) return picked.stijl;
    const h = app()?.hass;
    const list = stijlen();
    const s = h?.selectedTheme?.theme || h?.themes?.theme;
    return list.includes(s) ? s : THEME;
  };
  const apply = (stijl, k) => {
    picked = { k, stijl, at: Date.now() };
    // dark: undefined = follow the device (prefers-color-scheme).
    app()?.dispatchEvent(
      new CustomEvent("settheme", {
        detail: { theme: stijl, dark: k === "auto" ? undefined : k === "donker" },
        bubbles: true,
        composed: true,
      }),
    );
    // Every theme button on the page shows the new choice right away.
    knoppen.forEach((b) => b._render());
  };
  const setMode = (k) => apply(currentStijl(), k);
  const setStijl = (s) => apply(s, currentMode());
  // Swatch of a style in the mode that is showing now: page colour, card ring, accent half (values escaped: they come
  // from a theme file).
  const staal = (naam) => {
    const h = app()?.hass;
    const m = h?.themes?.themes?.[naam]?.modes?.[h?.themes?.darkMode ? "dark" : "light"] || {};
    return `<span class="staal" style="--s-bg:${esc(m["cw-bg"])};--s-card:${esc(m["cw-card"])};--s-acc:${esc(m["cw-accent"])};--s-ink:${esc(m["cw-accent-ink"])}"></span>`;
  };
  // ---------- popover menu: one element in document.body, so no card or shadow root can clip it ----------
  const MENU_CSS = `
.cw-tmenu { position: fixed; z-index: 1000; width: 256px; max-width: calc(100vw - 16px); box-sizing: border-box; padding: 6px; border-radius: 18px; margin: 0;
  background: var(--cw-card, var(--card-background-color, #2a2622)); color: var(--cw-text, var(--primary-text-color, #F5EAD8)); font: 15px/1.2 Figtree, system-ui, sans-serif;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .35); border: 1px solid var(--cw-line, var(--divider-color, #4a433c)); display: flex; flex-direction: column; gap: 2px; }
.cw-tmenu button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px;
  border-radius: 12px; cursor: pointer; color: inherit; }
.cw-tmenu button:hover, .cw-tmenu button:focus-visible { background: var(--cw-raised, var(--secondary-background-color, #3a3530)); }
.cw-tmenu button[aria-checked="true"] { background: var(--cw-accent, var(--primary-color, #D67F48)); color: var(--cw-on-accent, #1d1a17); font-weight: 700; }
.cw-tmenu svg { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cw-tmenu .kop { padding: 8px 12px 4px; font-size: 13px; font-weight: 700; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
.cw-tmenu [role="group"] { display: flex; flex-direction: column; gap: 2px; }
.cw-tmenu .modi { flex-direction: row; }
.cw-tmenu .modi button { flex: 1 1 0; flex-direction: column; justify-content: center; gap: 2px; min-height: 56px; padding: 6px 4px; font-size: 13px; text-align: center; }
.cw-tmenu .staal { width: 26px; height: 26px; flex: none; border-radius: 999px; box-sizing: border-box;
  background: linear-gradient(135deg, var(--s-bg) 0 50%, var(--s-acc) 50% 100%); border: 3px solid var(--s-card);
  box-shadow: 0 0 0 1px var(--s-ink); }
.cw-tmenu .vink { margin-left: auto; width: 18px; height: 18px; }
`;
  const TOKENS = ["card", "text", "muted", "line", "raised", "accent", "on-accent"];
  let menu = null;
  let opener = null;
  const closeMenu = (refocus = true) => {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    const o = opener;
    opener = null;
    o?._setExpanded(false);
    if (refocus && o?.isConnected) o.focus();
  };
  const onOutside = (ev) => {
    const path = ev.composedPath();
    if (path.includes(menu) || (opener && path.includes(opener))) return;
    closeMenu(false);
  };
  const onResize = () => closeMenu(false);
  const items = () => [...(menu?.querySelectorAll("button") || [])];
  const onKey = (ev) => {
    if (!menu) return;
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeMenu();
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const d = ev.key === "ArrowDown" ? 1 : -1;
      list[(i + d + list.length) % list.length]?.focus();
    } else if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      list[ev.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (ev.key === "Tab") {
      closeMenu(false);
    }
  };
  const openMenu = (knop) => {
    if (menu) {
      const same = opener === knop;
      closeMenu(false);
      if (same) return;
    }
    if (!document.getElementById("cw-tmenu-css")) {
      const st = document.createElement("style");
      st.id = "cw-tmenu-css";
      st.textContent = MENU_CSS;
      document.head.appendChild(st);
    }
    const cur = currentMode();
    const stijl = currentStijl();
    menu = document.createElement("div");
    menu.className = "cw-tmenu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", <@ t('theme_style_and_menu') | tojson @>);
    // Copy the tokens of the button's context (a view theme may not be on the document root).
    const cs = getComputedStyle(knop);
    for (const t of TOKENS) {
      const v = cs.getPropertyValue(`--cw-${t}`).trim();
      if (v) menu.style.setProperty(`--cw-${t}`, v);
    }
    const lijst = stijlen();
    // Styles only when there is something to choose; the modes are one row of three below.
    menu.innerHTML = `${
      lijst.length > 1
        ? `<div class="kop" id="cw-tm-stijl">${esc(<@ t('theme_style') | tojson @>)}</div><div role="group" aria-labelledby="cw-tm-stijl">${lijst
            .map(
              (n) =>
                `<button role="menuitemradio" aria-checked="${n === stijl}" data-stijl="${esc(n)}" tabindex="-1">${staal(n)}<span>${esc(n)}</span>${
                  n === stijl ? `<svg class="vink" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : ""
                }</button>`,
            )
            .join("")}</div>`
        : ""
    }<div class="kop" id="cw-tm-modus">${esc(<@ t('theme_menu') | tojson @>)}</div><div role="group" class="modi" aria-labelledby="cw-tm-modus">${MODES.map(
      (m) =>
        `<button role="menuitemradio" aria-checked="${m.k === cur}" data-k="${m.k}" tabindex="-1">${svg(ICONS[`modus-${m.k}`])}<span>${m.label}</span></button>`,
    ).join("")}</div>`;
    menu.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-k], button[data-stijl]");
      if (!b) return;
      if (b.dataset.stijl) setStijl(b.dataset.stijl);
      else setMode(b.dataset.k);
      closeMenu();
    });
    document.body.appendChild(menu);
    // Right-aligned under the button, kept inside the viewport.
    const r = knop.getBoundingClientRect();
    const w = menu.offsetWidth,
      h = menu.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = r.bottom + 6;
    const top =
      below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    opener = knop;
    knop._setExpanded(true);
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    (
      items().find((b) => b.getAttribute("aria-checked") === "true") ||
      items()[0]
    )?.focus();
  };

  // ---------- <cw-knop> ----------
  class CwKnop extends HTMLElement {
    static get observedAttributes() {
      return ["icoon", "label", "aan"];
    }
    connectedCallback() {
      this._render();
    }
    attributeChangedCallback() {
      if (this.shadowRoot) this._render();
    }
    focus() {
      this.shadowRoot?.querySelector("button")?.focus();
    }
    _render() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      const label = esc(this.getAttribute("label") || "");
      const on = this.hasAttribute("aan");
      const toggle = this.hasAttribute("aan") || this.hasAttribute("toggle");
      this.shadowRoot.innerHTML = `<style>${ROUND}</style><button class="${on ? "on" : ""}" aria-label="${label}" title="${label}"${
        toggle ? ` aria-pressed="${on}"` : ""
      }>${svg(ICONS[this.getAttribute("icoon")] || "")}</button>`;
    }
  }

  // ---------- <cw-thema-knop> ----------
  class CwThemaKnop extends HTMLElement {
    connectedCallback() {
      knoppen.add(this);
      this._render();
    }
    disconnectedCallback() {
      knoppen.delete(this);
    }
    focus() {
      this.shadowRoot?.querySelector("button")?.focus();
    }
    _setExpanded(v) {
      this.shadowRoot
        ?.querySelector("button")
        ?.setAttribute("aria-expanded", String(v));
    }
    _render() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openMenu(this);
        });
        this.shadowRoot.addEventListener("keydown", (ev) => {
          if (ev.key === "ArrowDown") {
            ev.preventDefault();
            openMenu(this);
          }
        });
      }
      const cur = currentMode();
      const label = fmt(<@ t('theme_button_label') | tojson @>, {
        style: esc(currentStijl()),
        mode: MODES.find((m) => m.k === cur).label.toLowerCase(),
      });
      this.shadowRoot.innerHTML = `<style>${ROUND}</style><button aria-haspopup="menu" aria-expanded="${opener === this}" aria-label="${label}" title="${label}">${svg(ICONS[`modus-${cur}`])}</button>`;
    }
  }

  // ---------- <cw-kop> ----------
  const KOP_CSS = `
:host { display: flex; align-items: center; gap: 12px; min-height: 56px; max-width: 1100px; margin: 0 auto 12px;
  color: var(--cw-text, var(--primary-text-color, #F5EAD8)); font-family: Figtree, system-ui, sans-serif; }
.tl { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
h1 { margin: 0; font-family: Caprasimo, Georgia, serif; font-weight: 400; font-size: 28px; line-height: 1.15;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { font-size: 14px; line-height: 1.3; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub:empty { display: none; }
.acties { display: flex; align-items: center; gap: 4px; flex: none; }
.set[hidden] { display: none; }
@media (max-width: 420px) { h1 { font-size: 24px; } .sub { font-size: 13px; } }
`;
  class CwKop extends HTMLElement {
    static get observedAttributes() {
      return ["titel", "sub"];
    }
    // Lovelace card: type: custom:cw-kop, title, subtitle, settings (path: a gear button left of the theme button)
    setConfig(config) {
      this._card = true;
      this._settings = config?.settings || "";
      this.setAttribute("titel", config?.title || "");
      if (config?.subtitle) this.setAttribute("sub", config.subtitle);
      else this.removeAttribute("sub");
    }
    set hass(h) {}
    getCardSize() {
      return 1;
    }
    getGridOptions() {
      return { columns: "full", rows: "auto" };
    }
    connectedCallback() {
      this._render();
    }
    attributeChangedCallback() {
      if (this.shadowRoot) this._render();
    }
    _render() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `<style>${KOP_CSS}</style><div class="tl"><h1></h1><span class="sub"><slot name="sub"></slot></span></div><div class="acties"><slot name="acties"></slot><cw-knop class="set" icoon="tandwiel" label="${esc(<@ t('settings') | tojson @>)}" hidden></cw-knop><cw-thema-knop></cw-thema-knop></div>`;
        this.shadowRoot
          .querySelector(".set")
          .addEventListener(
            "click",
            () => this._settings && nav(this._settings),
          );
      }
      this.shadowRoot.querySelector(".set").hidden = !this._settings;
      const r = this.shadowRoot;
      r.querySelector("h1").textContent = this.getAttribute("titel") || "";
      const sub = this.getAttribute("sub");
      const slot = r.querySelector('slot[name="sub"]');
      slot.textContent = sub || "";
      r.querySelector(".sub").style.display =
        sub || this.querySelector('[slot="sub"]') ? "" : "none";
    }
  }

  // ---------- status chip choice per HA user (frontend user data, like the theme) ----------
  // prefs[key] = {volgorde: [ids], uit: [ids]} or null (= default). An id missing from volgorde is a new chip: it keeps its own spot.
  const prefs = {};
  const asked = new Set();
  const statusEls = new Set();
  const saveTimers = {};
  let pressedUntil = 0; // a long press opened the picker: swallow the click that follows
  const lsKey = (k) => {
    const u = app()?.hass?.user?.id;
    return u ? `cw-status-${k}-${u}` : "";
  };
  const loadPref = async (k) => {
    const conn = app()?.hass?.connection;
    if (!conn) return;
    asked.add(k);
    try {
      const r = await conn.sendMessagePromise({
        type: "frontend/get_user_data",
        key: `cw-status-${k}`,
      });
      setPref(k, r?.value || null, false);
    } catch (e) {
      asked.delete(k);
    }
  };
  // Sync: the copy in localStorage (instant first paint), HA's user data follows once.
  const getPref = (k) => {
    if (!(k in prefs)) {
      try {
        const v = lsKey(k) && localStorage.getItem(lsKey(k));
        if (v) prefs[k] = JSON.parse(v);
      } catch (e) {}
    }
    if (!asked.has(k)) loadPref(k);
    return prefs[k] || null;
  };
  const savePref = async (k) => {
    try {
      await app()?.hass?.connection?.sendMessagePromise({
        type: "frontend/set_user_data",
        key: `cw-status-${k}`,
        value: prefs[k] || null,
      });
    } catch (e) {}
  };
  const setPref = (k, v, save = true) => {
    const same = JSON.stringify(prefs[k] || null) === JSON.stringify(v || null);
    prefs[k] = v || null;
    try {
      const key = lsKey(k);
      if (key && v) localStorage.setItem(key, JSON.stringify(v));
      else if (key) localStorage.removeItem(key);
    } catch (e) {}
    if (save) {
      clearTimeout(saveTimers[k]);
      saveTimers[k] = setTimeout(() => savePref(k), 400);
    }
    if (!same)
      statusEls.forEach(
        (el) => el.isConnected && el._bewaar === k && el._render(),
      );
  };
  // Saved order; ids the user has never seen go right after their natural predecessor.
  const orderIds = (ids, pref) => {
    const out = (pref?.volgorde || []).filter((id) => ids.includes(id));
    ids.forEach((id, i) => {
      if (out.includes(id)) return;
      const prev = ids
        .slice(0, i)
        .reverse()
        .find((p) => out.includes(p));
      out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id);
    });
    return out;
  };
  // Without a choice: drop calm chips with "minder" (highest first) until the row needs at most 2 rows,
  // then let shortcuts (vul, lowest first) fill the free spots of the last row. perRow 0 = width unknown yet.
  const fitDefault = (chips, perRow) => {
    const out = chips.filter((c) => !c.vul);
    while (perRow && out.length > perRow * 2) {
      let j = -1;
      out.forEach((c, i) => {
        if (c.minder && !c.tone && (j < 0 || c.minder > out[j].minder)) j = i;
      });
      if (j < 0) break;
      out.splice(j, 1);
    }
    const free = perRow ? (perRow - (out.length % perRow)) % perRow : 0;
    const fill = chips
      .filter((c) => c.vul)
      .sort((a, b) => a.vul - b.vul)
      .slice(0, free);
    return chips.filter((c) => out.includes(c) || fill.includes(c));
  };
  const chooseChips = (all, k, perRow) => {
    const pref = getPref(k);
    if (!pref) return fitDefault(all, perRow);
    const byId = Object.fromEntries(all.map((c) => [c.id, c]));
    const off = new Set(pref.uit || []);
    const known = new Set(pref.volgorde || []);
    // A new shortcut stays off for someone who already chose; a new status chip shows up.
    return orderIds(
      all.map((c) => c.id),
      pref,
    )
      .filter((id) => !off.has(id) && (known.has(id) || !byId[id].vul))
      .map((id) => byId[id]);
  };
  // Chips per row of the status grid (minmax(76px, 1fr), gap 6px); 0 = not laid out yet.
  const perRowOf = (el) => {
    const w = el?.getBoundingClientRect().width || 0;
    return w ? Math.max(1, Math.floor((w + 6) / 82)) : 0;
  };
  const liveStatus = (k) =>
    [...statusEls].find((el) => el.isConnected && el._bewaar === k);

  // Picker sheet: one row per chip (switch + up/down). Every change shows on the page right away and is saved.
  const KIES_CSS = `
.cw-sheet .kies { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: min(52vh, 440px); overflow-y: auto; }
.cw-sheet .kies li { display: flex; align-items: center; gap: 2px; }
.cw-sheet .kies button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 44px; border-radius: 12px; display: flex; align-items: center; }
.cw-sheet .kies button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: -2px; }
.cw-sheet .kies .sw { flex: 1 1 auto; min-width: 0; gap: 10px; padding: 0 10px; background: var(--cw-raised, var(--secondary-background-color, #3a3530)); }
.cw-sheet .kies .n { flex: 1 1 auto; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cw-sheet .kies small { flex: none; max-width: 32%; font-size: 13px; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cw-sheet .kies .tg { flex: none; position: relative; width: 36px; height: 22px; border-radius: 999px; background: var(--cw-line, var(--divider-color, #4a433c)); }
.cw-sheet .kies .tg::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--cw-card, var(--card-background-color, #2a2622)); transition: transform .15s; }
.cw-sheet .kies [aria-checked="true"] .tg { background: var(--cw-accent, var(--primary-color, #D67F48)); }
.cw-sheet .kies [aria-checked="true"] .tg::after { transform: translateX(14px); }
.cw-sheet .kies [aria-checked="false"] .n, .cw-sheet .kies [aria-checked="false"] svg { opacity: .5; }
.cw-sheet .kies .mv { flex: none; width: 36px; justify-content: center; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
.cw-sheet .kies .mv:hover { color: var(--cw-text, var(--primary-text-color, #F5EAD8)); }
.cw-sheet .kies .mv:disabled { opacity: .25; cursor: default; }
.cw-sheet .hint { font-size: 13px; }
.cw-sheet .hint.warn { color: var(--cw-warn, var(--warning-color, #E8B04A)); }
`;
  const openKiezer = (from, el) => {
    const k = el._bewaar;
    const all = (el._all || []).filter((c) => c.id);
    if (!k || !all.length) return;
    closeSheet(false);
    newSheet(from, <@ t('status_choose') | tojson @>);
    if (!document.getElementById("cw-kies-css")) {
      const st = document.createElement("style");
      st.id = "cw-kies-css";
      st.textContent = KIES_CSS;
      document.head.appendChild(st);
    }
    const byId = Object.fromEntries(all.map((c) => [c.id, c]));
    const ids = all.map((c) => c.id);
    // Start from what is on screen now (on a phone that can be the 2-row default).
    const shown = new Set((el._chips || []).map((c) => c.id));
    let order = orderIds(ids, prefs[k]);
    let off = new Set(order.filter((id) => !shown.has(id)));
    const perRow = () => perRowOf(liveStatus(k) || el) || 4;
    const who = app()?.hass?.user?.name;
    const commit = () => setPref(k, { volgorde: [...order], uit: [...off] });
    const draw = (focusSel, fallbackSel) => {
      const scroll = sheet.querySelector(".kies")?.scrollTop || 0;
      const n = order.filter((id) => !off.has(id)).length;
      const per = perRow();
      const rows = Math.ceil(n / per);
      sheet.innerHTML = `<h3>${svg(ICONS.schuif)}<span>${esc(<@ t('status_row') | tojson @>)}</span></h3><p>${esc(<@ t('status_choose_help') | tojson @>)}${who ? ` ${fmt(<@ t('status_saved_for') | tojson @>, { who: esc(who) })}` : ""}</p><ul class="kies">${order
        .map((id, i) => {
          const c = byId[id];
          const name = esc(c.naam || c.titel || c.label || id);
          const d = esc(id);
          return `<li><button class="sw" role="switch" aria-checked="${!off.has(id)}" data-id="${d}">${ICONS[c.icon] ? svg(ICONS[c.icon]) : ""}<span class="n">${name}</span>${c.value ? `<small>${esc(c.value)}</small>` : ""}<span class="tg" aria-hidden="true"></span></button><button class="mv" data-id="${d}" data-d="-1" aria-label="${fmt(<@ t('move_up') | tojson @>, { name })}"${i ? "" : " disabled"}>${svg(ICONS.op)}</button><button class="mv" data-id="${d}" data-d="1" aria-label="${fmt(<@ t('move_down') | tojson @>, { name })}"${i < order.length - 1 ? "" : " disabled"}>${svg(ICONS.neer)}</button></li>`;
        })
        .join(
          "",
        )}</ul><p class="hint${rows > 2 ? " warn" : ""}" aria-live="polite">${
        n
          ? `${fmt(rows === 1 ? <@ t('status_count_one_row') | tojson @> : <@ t('status_count_rows') | tojson @>, { n, total: order.length, rows })}${rows > 2 ? fmt(<@ t('status_too_many_rows') | tojson @>, { extra: n - per * 2 }) : ""}`
          : <@ t('status_empty') | tojson @>
      }</p><div class="acts"><button data-a="reset">${esc(<@ t('button_default') | tojson @>)}</button><button data-a="klaar" class="main">${esc(<@ t('button_done') | tojson @>)}</button></div>`;
      sheet.querySelector(".kies").scrollTop = scroll;
      const f = focusSel && sheet.querySelector(focusSel);
      (f && !f.disabled
        ? f
        : fallbackSel && sheet.querySelector(fallbackSel)
      )?.focus();
    };
    sheet.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b || b.disabled) return;
      const id = b.dataset.id;
      const sel = id && `[data-id="${CSS.escape(id)}"]`;
      if (b.dataset.a === "klaar") return closeSheet(true);
      if (b.dataset.a === "reset") {
        setPref(k, null);
        // Default = every chip, minus the calm "minder" chips that do not fit in 2 rows on this screen.
        const fit = new Set(fitDefault(all, perRow()).map((c) => c.id));
        order = [...ids];
        off = new Set(ids.filter((i) => !fit.has(i)));
        return draw('[data-a="reset"]');
      }
      if (b.classList.contains("sw")) {
        if (off.has(id)) off.delete(id);
        else off.add(id);
        commit();
        return draw(`.sw${sel}`);
      }
      if (b.classList.contains("mv")) {
        const i = order.indexOf(id);
        const j = i + +b.dataset.d;
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        commit();
        draw(`.mv${sel}[data-d="${b.dataset.d}"]`, `.sw${sel}`);
      }
    });
    draw();
    mountSheet(from);
    sheet.querySelector(".sw")?.focus();
  };

  // ---------- <cw-status> ----------
  const STATUS_CSS = `
:host { display: block; max-width: 1100px; margin: 0 auto 12px; }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(76px, 1fr)); gap: 6px; }
button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 52px; padding: 6px 6px; border-radius: 16px; min-width: 0;
  background: var(--cw-card, var(--card-background-color, #2a2622)); color: var(--cw-text, var(--primary-text-color, #F5EAD8)); font-family: Figtree, system-ui, sans-serif;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center; }
button:hover { filter: brightness(1.08); }
button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: 2px; }
:host([bewaar]) button { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
.v { display: flex; align-items: center; gap: 4px; font-weight: 700; font-size: 15px; line-height: 1.1; white-space: nowrap; max-width: 100%; }
.v span { overflow: hidden; text-overflow: ellipsis; }
small { font-size: 12px; line-height: 1.1; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
/* Hierarchy: aan = calm chip with an accent icon; warn = coloured outline; only bad (a real alarm) is filled. */
.aan svg { color: var(--cw-accent-ink, var(--cw-accent, var(--primary-color, #D67F48))); }
.warn { box-shadow: inset 0 0 0 2px var(--cw-warn, var(--warning-color, #E8B04A)); color: var(--cw-warn, var(--warning-color, #E8B04A)); }
.warn small { color: inherit; }
.bad { background: var(--cw-bad, var(--error-color, #E36B5A)); color: var(--cw-on-accent, #1d1a17); }
.bad small { color: inherit; opacity: .85; }
`;
  const nav = (path) => {
    history.pushState(null, "", path);
    window.dispatchEvent(
      new CustomEvent("location-changed", { detail: { replace: false } }),
    );
  };
  class CwStatus extends HTMLElement {
    static get observedAttributes() {
      return ["chips"];
    }
    // Lovelace card: type: custom:cw-status, chips: [{icon, entity | value, label?, path?, aan?: [states], warn?: [states]}]
    setConfig(config) {
      if (!Array.isArray(config?.chips)) throw new Error("chips: lijst nodig");
      this._cfg = config;
      this._render();
    }
    set hass(hass) {
      this._hass = hass;
      if (!this._cfg) return;
      const sig = this._cfg.chips
        .map((c) => hass.states[c.entity]?.last_updated)
        .join("|");
      if (sig !== this._sig) {
        this._sig = sig;
        this._render();
      }
    }
    getCardSize() {
      return 1;
    }
    getGridOptions() {
      return { columns: "full", rows: "auto" };
    }
    connectedCallback() {
      statusEls.add(this);
      this._render();
      // Re-fit when the number of chips per row changes (phone rotation, side panel).
      this._ro =
        this._ro ||
        new ResizeObserver(() => {
          const per = perRowOf(this);
          if (this._bewaar && per && per !== this._per) this._render();
        });
      this._ro.observe(this);
    }
    disconnectedCallback() {
      statusEls.delete(this);
      this._ro?.disconnect();
    }
    attributeChangedCallback() {
      if (this.isConnected) this._render();
    }
    // Opens the picker (from = the button that asked for it, for position and focus).
    kies(from) {
      openKiezer(from || this, this);
    }
    // Chips of the Lovelace card: value from the entity (rounded number + unit, or HA's own formatted state).
    _fromConfig() {
      const h = this._hass;
      return this._cfg.chips.map((c) => {
        const st = h?.states[c.entity];
        let value = c.value ?? "–";
        if (st) {
          const n = parseFloat(st.state);
          const unit = st.attributes.unit_of_measurement || "";
          value =
            Number.isFinite(n) && !/^\d{4}-/.test(st.state)
              ? `${n.toLocaleString(<@ t('number_locale') | tojson @>, { maximumFractionDigits: unit === "°C" || Math.abs(n) < 10 ? 1 : 0 })}${unit === "°C" ? "°" : unit ? ` ${unit}` : ""}`
              : h.formatEntityState
                ? h.formatEntityState(st)
                : st.state;
        }
        const tone =
          st && (c.warn || []).includes(st.state)
            ? "warn"
            : st && (c.aan || []).includes(st.state)
              ? "aan"
              : c.tone || "";
        return {
          id: c.id || c.entity,
          naam: c.name,
          icon: c.icon,
          value,
          label: c.label,
          tone,
          path: c.path,
          entity: c.entity,
          info: c.info,
          titel: c.title,
          nav: c.nav,
          pathLabel: c.path_label,
        };
      });
    }
    _render() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.addEventListener("click", (ev) => {
          if (Date.now() < pressedUntil) {
            ev.stopPropagation();
            return;
          }
          const b = ev.composedPath().find((n) => n.dataset?.i !== undefined);
          const c = b && this._chips?.[+b.dataset.i];
          if (!c) return;
          // A click re-sent by the sheet's action button goes through to the page's data-act handler.
          if (b._pass) {
            b._pass = false;
            return;
          }
          if (c.direct) return; // the page opens its own sheet through data-act
          ev.stopPropagation();
          if (c.nav && c.path) return nav(c.path); // pure navigation (e.g. Meer tiles)
          openSheet(b, {
            title: c.titel || [c.label, c.value].filter(Boolean).join(" "),
            icon: c.icon,
            text: c.info,
            rows: c.rows,
            entity: c.entity,
            path: c.path,
            pathLabel: c.pathLabel,
            actions: c.act
              ? [
                  {
                    label: c.actLabel || <@ t('button_run') | tojson @>,
                    main: true,
                    run: () => ((b._pass = true), b.click()),
                  },
                ]
              : [],
          });
        });
        // Long press on the row (bewaar only) = picker. Window listeners: the page may redraw the row mid-press.
        this.shadowRoot.addEventListener("pointerdown", (ev) => {
          if (!this._bewaar || ev.button > 0) return;
          const k = this._bewaar;
          const x = ev.clientX,
            y = ev.clientY;
          const stop = () => {
            clearTimeout(t);
            window.removeEventListener("pointerup", stop, true);
            window.removeEventListener("pointercancel", stop, true);
            window.removeEventListener("pointermove", move, true);
          };
          const move = (e) =>
            Math.hypot(e.clientX - x, e.clientY - y) > 10 && stop();
          const t = setTimeout(() => {
            stop();
            pressedUntil = Date.now() + 800;
            const el = this.isConnected ? this : liveStatus(k);
            if (el) openKiezer(el, el);
          }, 550);
          window.addEventListener("pointerup", stop, true);
          window.addEventListener("pointercancel", stop, true);
          window.addEventListener("pointermove", move, true);
        });
        this.shadowRoot.addEventListener(
          "contextmenu",
          (ev) => this._bewaar && ev.preventDefault(),
        );
      }
      let chips = [];
      try {
        chips = this._cfg
          ? this._fromConfig()
          : JSON.parse(this.getAttribute("chips") || "[]");
      } catch (e) {
        chips = [];
      }
      this._bewaar = this.getAttribute("bewaar") || this._cfg?.bewaar || "";
      this._all = chips;
      if (this._bewaar) {
        this._per = perRowOf(this);
        chips = chooseChips(chips, this._bewaar, this._per);
      }
      this._chips = chips;
      this.shadowRoot.innerHTML = `<style>${STATUS_CSS}</style><div class="row" role="list">${chips
        .map((c, i) => {
          const name = [c.label, c.value].filter(Boolean).join(" ");
          return `<button role="listitem" class="${esc(c.tone || "")}" data-i="${i}"${c.act ? ` data-act="${esc(c.act)}"` : ""} aria-label="${esc(c.aria || name)}" title="${esc(c.aria || name)}"><span class="v">${ICONS[c.icon] ? svg(ICONS[c.icon]) : ""}<span>${esc(c.value)}</span></span>${c.label ? `<small>${esc(c.label)}</small>` : ""}</button>`;
        })
        .join("")}</div>`;
    }
  }

  // ---------- <cw-chip> ----------
  const CHIP_CSS = `
:host { display: inline-flex; flex: none; vertical-align: middle; }
:host([role="button"]) { cursor: pointer; }
:host(:focus-visible) { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: 2px; border-radius: 999px; }
.c { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  background: var(--cw-bg, var(--primary-background-color, #1d1a17)); color: var(--cw-text, var(--primary-text-color, #F5EAD8)); font: 600 13px/1 Figtree, system-ui, sans-serif; position: relative; }
:host([kaal]) .c { background: none; padding: 0 3px; height: 24px; }
.c.leeg { padding: 0 6px; }
:host([kaal]) .c.leeg { padding: 0 2px; }
svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
svg.a { color: var(--ic, currentColor); }
svg.b { color: var(--ic2, currentColor); }
svg.p { width: 12px; height: 12px; opacity: .6; margin: 0 -2px; }
:host([toon="aan"]) svg { color: var(--cw-accent-ink, var(--cw-accent, var(--primary-color, #D67F48))); }
:host([toon="goed"]) .c { color: var(--cw-good, var(--success-color, #6FBF73)); }
:host([toon="warn"]) .c { color: var(--cw-warn, var(--warning-color, #E8B04A)); }
:host([toon="bad"]) .c { color: var(--cw-bad, var(--error-color, #E36B5A)); }
:host([uit]) .c { color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); opacity: .55; }
:host([uit]) .c.zonder::after { content: ""; position: absolute; left: 3px; right: 3px; top: 50%; height: 2px; background: currentColor; transform: rotate(-35deg); border-radius: 2px; }
/* uit with an icon: only the icon is struck through, the text stays readable. */
.ai { position: relative; display: inline-flex; }
:host([uit]) .ai::after { content: ""; position: absolute; left: -2px; right: -2px; top: 50%; height: 2px; margin-top: -1px; background: currentColor; transform: rotate(-45deg); border-radius: 2px; }
`;
  class CwChip extends HTMLElement {
    static get observedAttributes() {
      return ["icoon", "label", "naar", "bij"];
    }
    connectedCallback() {
      this._render();
    }
    attributeChangedCallback() {
      if (this.shadowRoot) this._render();
    }
    _render() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      const naar = this.getAttribute("naar");
      const ic2 = ICONS[naar || this.getAttribute("bij")];
      const label = this.getAttribute("label");
      if (label) {
        this.setAttribute("title", label);
        this.setAttribute("aria-label", label);
      }
      // Every chip with a meaning opens the info sheet on tap (and Enter/Space).
      const tappable = !!(
        label ||
        this.hasAttribute("info") ||
        this.hasAttribute("entity") ||
        this.hasAttribute("path")
      );
      this.setAttribute("role", tappable ? "button" : "img");
      if (tappable) {
        this.setAttribute("tabindex", "0");
        this.setAttribute("aria-haspopup", "dialog");
        if (!this._wired) {
          this._wired = true;
          const open = (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            let rows = [];
            try {
              rows = JSON.parse(this.getAttribute("waarden") || "[]");
            } catch (e) {}
            openSheet(this, {
              title:
                this.getAttribute("titel") ||
                this.getAttribute("label") ||
                this.textContent.trim(),
              icon: this.getAttribute("icoon"),
              text:
                this.getAttribute("info") ||
                (this.getAttribute("titel") ? this.getAttribute("label") : ""),
              rows,
              entity: this.getAttribute("entity") || undefined,
              path: this.getAttribute("path") || undefined,
              pathLabel: this.getAttribute("pad-label") || undefined,
            });
          };
          this.addEventListener("click", open);
          this.addEventListener(
            "keydown",
            (ev) => (ev.key === "Enter" || ev.key === " ") && open(ev),
          );
        }
      }
      const ic = ICONS[this.getAttribute("icoon")];
      const mk = (body, cls) =>
        `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
      this.shadowRoot.innerHTML = `<style>${CHIP_CSS}</style><span class="c${this.textContent.trim() ? "" : " leeg"}${ic ? "" : " zonder"}">${ic ? `<span class="ai">${mk(ic, "a")}</span>` : ""}${ic2 ? (naar ? mk(ICONS.pijl, "p") : "") + mk(ic2, "b") : ""}<slot></slot></span>`;
    }
  }

  // ---------- info sheet (shared by cw-chip, cw-status and cw-info) ----------
  const SHEET_CSS = `
.cw-sheet { position: fixed; z-index: 1001; width: min(340px, calc(100vw - 16px)); padding: 14px 16px 12px; border-radius: 20px; box-sizing: border-box;
  background: var(--cw-card, var(--card-background-color, #2a2622)); color: var(--cw-text, var(--primary-text-color, #F5EAD8)); font: 15px/1.4 Figtree, system-ui, sans-serif;
  box-shadow: 0 12px 36px rgba(0, 0, 0, .4); border: 1px solid var(--cw-line, var(--divider-color, #4a433c)); display: flex; flex-direction: column; gap: 10px; }
.cw-sheet h3 { margin: 0; display: flex; align-items: center; gap: 8px; font: 700 17px/1.2 Figtree, system-ui, sans-serif; }
.cw-sheet h3 svg, .cw-sheet button svg { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cw-sheet .snap { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 14px; background: var(--cw-raised, var(--secondary-background-color, #3a3530)); display: block; }
.cw-sheet input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--cw-line, var(--divider-color, #4a433c));
  background: var(--cw-bg, var(--primary-background-color, #1d1a17)); color: inherit; font: inherit; }
.cw-sheet .quick { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
.cw-sheet .quick button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 44px; padding: 6px 12px; border-radius: 14px; display: flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--cw-accent, var(--primary-color, #D67F48)); color: var(--cw-on-accent, #1d1a17); font-weight: 700; text-align: center; }
.cw-sheet .quick button:focus-visible { outline: 2px solid var(--cw-text, var(--primary-text-color, #F5EAD8)); outline-offset: 2px; }
.cw-sheet .sugg { display: flex; flex-wrap: wrap; gap: 6px; }
.cw-sheet .sugg button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 999px; font-size: 13px; background: var(--cw-raised, var(--secondary-background-color, #3a3530)); }
.cw-sheet p { margin: 0; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
.cw-sheet dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 14px; }
.cw-sheet dt { color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
.cw-sheet dd { margin: 0; text-align: right; font-weight: 700; }
.cw-sheet .step { display: flex; align-items: center; gap: 8px; }
.cw-sheet .step .k { flex: 1; font-size: 14px; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
.cw-sheet .step button { all: unset; box-sizing: border-box; cursor: pointer; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--cw-raised, var(--secondary-background-color, #3a3530)); font: 700 22px/1 Figtree, system-ui, sans-serif; }
.cw-sheet .step button:disabled { opacity: .35; cursor: default; }
.cw-sheet .step button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: 2px; }
.cw-sheet .step output { min-width: 64px; text-align: center; font-weight: 700; font-size: 17px; font-variant-numeric: tabular-nums; }
.cw-sheet .acts { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.cw-sheet .acts button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 40px; padding: 0 14px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px;
  background: var(--cw-raised, var(--secondary-background-color, #3a3530)); font-weight: 600; }
.cw-sheet .acts button.main { background: var(--cw-accent, var(--primary-color, #D67F48)); color: var(--cw-on-accent, #1d1a17); }
.cw-sheet .acts button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: 2px; }
@media (max-width: 520px) { .cw-sheet { left: 8px !important; right: 8px; width: auto; top: auto !important; bottom: 8px; } }
`;
  let sheet = null;
  let sheetFrom = null;
  let snapTimer = null;
  const closeSheet = (refocus = true) => {
    clearInterval(snapTimer);
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    document.removeEventListener("pointerdown", onSheetOut, true);
    document.removeEventListener("keydown", onSheetKey, true);
    const f = sheetFrom;
    sheetFrom = null;
    if (refocus && f?.isConnected) f.focus?.();
  };
  const onSheetOut = (ev) => {
    if (!ev.composedPath().includes(sheet)) closeSheet(false);
  };
  const onSheetKey = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeSheet();
    }
  };
  // o: {title, icon, quick: [{label, icon, run}] (big buttons under the title), text, image (refreshed every 2 s),
  //    input: {placeholder, suggestions}, rows: [[k, v]], entity, path,
  //    stepper: {label, entity (input_number), min, max, step, unit} (− value + row, sets the helper on every tap),
  //    pathLabel, actions: [{label, run(inputValue), main}]}
  // New empty sheet with the tokens of the opener's context (a view theme may not be on the document root).
  const newSheet = (from, label) => {
    if (!document.getElementById("cw-sheet-css")) {
      const st = document.createElement("style");
      st.id = "cw-sheet-css";
      st.textContent = SHEET_CSS;
      document.head.appendChild(st);
    }
    sheet = document.createElement("div");
    sheet.className = "cw-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", label);
    const cs = getComputedStyle(from);
    for (const t of [
      "card",
      "text",
      "muted",
      "line",
      "raised",
      "accent",
      "on-accent",
      "warn",
    ]) {
      const v = cs.getPropertyValue(`--cw-${t}`).trim();
      if (v) sheet.style.setProperty(`--cw-${t}`, v);
    }
  };
  // Into the page under (or above) the opener, kept inside the viewport; Esc / tap outside closes.
  const mountSheet = (from) => {
    document.body.appendChild(sheet);
    const r = from.getBoundingClientRect();
    const w = sheet.offsetWidth,
      h = sheet.offsetHeight;
    sheet.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    const below = r.bottom + 8;
    sheet.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : below}px`;
    sheetFrom = from;
    document.addEventListener("pointerdown", onSheetOut, true);
    document.addEventListener("keydown", onSheetKey, true);
  };
  const openSheet = (from, o) => {
    closeSheet(false);
    const hass = app()?.hass;
    let rows = o.rows || [];
    const stObj = o.entity ? hass?.states?.[o.entity] : null;
    if (!o.text && !rows.length && stObj)
      rows = [
        [
          stObj.attributes.friendly_name || o.entity,
          hass.formatEntityState ? hass.formatEntityState(stObj) : stObj.state,
        ],
      ];
    const acts = [...(o.actions || [])];
    if (o.entity)
      acts.push({
        label: <@ t('button_details') | tojson @>,
        run: () =>
          app()?.dispatchEvent(
            new CustomEvent("hass-more-info", {
              detail: { entityId: o.entity },
              bubbles: true,
              composed: true,
            }),
          ),
      });
    if (o.path)
      acts.push({
        label: o.pathLabel || <@ t('button_open') | tojson @>,
        run: () => nav(o.path),
        main: !o.actions?.length,
      });
    acts.push({ label: <@ t('button_close') | tojson @>, close: true, run: () => {} });
    // Stepper bounds: the sheet's own min/max, never outside the helper's own range.
    let stepVal = null;
    const stepOf = () => {
      const c = o.stepper;
      const so = c && hass?.states?.[c.entity];
      if (!so) return null;
      const min = Math.max(c.min ?? -Infinity, +so.attributes.min);
      const max = Math.min(c.max ?? Infinity, +so.attributes.max);
      return { min, max, step: c.step || +so.attributes.step || 1, unit: c.unit || so.attributes.unit_of_measurement || "",
        v: stepVal ?? +so.state };
    };
    newSheet(from, o.title || <@ t('info_title') | tojson @>);
    sheet.innerHTML = `<h3>${ICONS[o.icon] ? svg(ICONS[o.icon]) : ""}<span>${esc(o.title || "")}</span></h3>${
      o.quick?.length
        ? `<div class="quick">${o.quick.map((q, i) => `<button data-q="${i}">${ICONS[q.icon] ? svg(ICONS[q.icon]) : ""}<span>${esc(q.label)}</span></button>`).join("")}</div>`
        : ""
    }${o.image ? `<img class="snap" alt="${esc(o.title || "")}" src="${esc(o.image)}">` : ""}${o.text ? `<p>${esc(o.text)}</p>` : ""}${
      o.input
        ? `<input type="text" enterkeyhint="send" placeholder="${esc(o.input.placeholder || "")}" aria-label="${esc(o.input.placeholder || <@ t('text_input') | tojson @>)}">${o.input.suggestions?.length ? `<div class="sugg">${o.input.suggestions.map((t) => `<button data-s="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}`
        : ""
    }${
      stepOf()
        ? `<div class="step" role="group" aria-label="${esc(o.stepper.label)}"><span class="k">${esc(o.stepper.label)}</span><button data-st="-1" aria-label="${esc(<@ t('step_down') | tojson @>)}">−</button><output aria-live="polite"></output><button data-st="1" aria-label="${esc(<@ t('step_up') | tojson @>)}">+</button></div>`
        : ""
    }${
      rows.length
        ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
        : ""
    }<div class="acts">${acts.map((a, i) => `<button data-i="${i}" class="${a.main ? "main" : ""}">${esc(a.label)}</button>`).join("")}</div>`;
    const stepBox = sheet.querySelector(".step");
    const showStep = () => {
      const st = stepOf();
      stepBox.querySelector("output").textContent = `${st.v.toLocaleString(<@ t('number_locale') | tojson @>)} ${st.unit}`;
      stepBox.querySelector('[data-st="-1"]').disabled = st.v <= st.min;
      stepBox.querySelector('[data-st="1"]').disabled = st.v >= st.max;
    };
    if (stepBox) showStep();
    sheet.addEventListener("click", (ev) => {
      const sb = ev.target.closest("button[data-st]");
      if (sb) {
        const st = stepOf();
        const v = Math.min(st.max, Math.max(st.min, Math.round((st.v + +sb.dataset.st * st.step) * 100) / 100));
        if (v === st.v) return;
        stepVal = v;
        showStep();
        app()?.hass?.callService("input_number", "set_value", { entity_id: o.stepper.entity, value: v });
        return;
      }
      const sg = ev.target.closest("button[data-s]");
      if (sg) {
        const inp = sheet.querySelector("input");
        inp.value = sg.dataset.s;
        inp.focus();
        return;
      }
      const qb = ev.target.closest("button[data-q]");
      if (qb) {
        closeSheet(true);
        o.quick[+qb.dataset.q].run();
        return;
      }
      const b = ev.target.closest("button[data-i]");
      if (!b) return;
      const a = acts[+b.dataset.i];
      const value = sheet.querySelector("input")?.value?.trim() || "";
      closeSheet(!!a.close);
      a.run(value);
    });
    sheet.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.localName === "input")
        sheet.querySelector("button.main")?.click();
    });
    mountSheet(from);
    (
      sheet.querySelector("input") ||
      sheet.querySelector(".quick button") ||
      sheet.querySelector(".acts button")
    )?.focus();
    // Camera snapshot: refresh while the sheet is open.
    const img = sheet.querySelector("img.snap");
    if (img) {
      img.addEventListener(
        "load",
        () => {
          const r2 = from.getBoundingClientRect();
          if (
            sheet &&
            r2.bottom + 8 + sheet.offsetHeight > window.innerHeight - 8
          )
            sheet.style.top = `${Math.max(8, window.innerHeight - sheet.offsetHeight - 8)}px`;
        },
        { once: true },
      );
      snapTimer = setInterval(() => {
        if (!img.isConnected) return clearInterval(snapTimer);
        img.src = `${o.image}${o.image.includes("?") ? "&" : "?"}_t=${Date.now()}`;
      }, 2000);
    }
  };
  window.cwInfoSheet = openSheet;

  // ---------- weather (one mapping for every page) ----------
  // HA weather condition -> icon name; at night (sun.sun below_horizon) sun becomes moon.
  const WEER = {
    sunny: "zon",
    "clear-night": "maan",
    partlycloudy: "zonwolk",
    cloudy: "wolk",
    fog: "mist",
    rainy: "regen",
    pouring: "stortregen",
    "lightning-rainy": "onweerregen",
    lightning: "bliksem",
    snowy: "sneeuw",
    "snowy-rainy": "natsneeuw",
    hail: "hagel",
    windy: "wind",
    "windy-variant": "wind",
    exceptional: "waarschuwing",
  };
  // Name of a HA weather state, in house.language (strings.yaml weather_*).
  const WEATHER_NAMES = {
    sunny: <@ t('weather_sunny') | tojson @>,
    "clear-night": <@ t('weather_clear_night') | tojson @>,
    partlycloudy: <@ t('weather_partlycloudy') | tojson @>,
    cloudy: <@ t('weather_cloudy') | tojson @>,
    fog: <@ t('weather_fog') | tojson @>,
    rainy: <@ t('weather_rainy') | tojson @>,
    pouring: <@ t('weather_pouring') | tojson @>,
    "lightning-rainy": <@ t('weather_lightning_rainy') | tojson @>,
    lightning: <@ t('weather_lightning') | tojson @>,
    snowy: <@ t('weather_snowy') | tojson @>,
    "snowy-rainy": <@ t('weather_snowy_rainy') | tojson @>,
    hail: <@ t('weather_hail') | tojson @>,
    windy: <@ t('weather_windy') | tojson @>,
    "windy-variant": <@ t('weather_windy_variant') | tojson @>,
    exceptional: <@ t('weather_exceptional') | tojson @>,
  };
  const cwWeerIcoon = (state, night) => {
    const i = WEER[state] || "wolk";
    return night ? { zon: "maan", zonwolk: "maanwolk" }[i] || i : i;
  };
  window.cwWeerIcoon = cwWeerIcoon;
  window.cwWeerNaam = (state) => WEATHER_NAMES[state] || "";

  // ---------- <cw-info> ----------
  class CwInfo extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>:host { display: inline-flex; vertical-align: middle; }
button { all: unset; cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 99px; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }</style><button aria-label="${esc(<@ t('explain') | tojson @>)}" title="${esc(<@ t('explain') | tojson @>)}" aria-haspopup="dialog">${svg(ICONS.info)}</button>`;
      this.shadowRoot
        .querySelector("button")
        .addEventListener("click", (ev) => {
          ev.stopPropagation();
          openSheet(this, {
            title: this.getAttribute("titel") || <@ t('explain') | tojson @>,
            icon: "info",
            text: this.getAttribute("label") || "",
          });
        });
    }
    focus() {
      this.shadowRoot?.querySelector("button")?.focus();
    }
  }

  // ---------- <cw-metric> ----------
  const METRIC_CSS = `
:host { display: block; }
.g { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 6px; }
:host([kolommen="4"]) .g { grid-template-columns: repeat(4, minmax(0, 1fr)); }
:host([kolommen="3"]) .g { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.m { all: unset; box-sizing: border-box; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 2px; border-radius: 14px; text-align: center; }
button.m { cursor: pointer; }
button.m:hover { background: var(--cw-raised, var(--secondary-background-color, #3a3530)); }
button.m:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); }
.i { color: var(--c, currentColor); display: flex; }
svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
b { font-size: 17px; line-height: 1.15; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--cw-text, var(--primary-text-color, #F5EAD8)); }
small { font-size: 12px; line-height: 1.2; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); overflow-wrap: anywhere; }
@media (max-width: 420px) { b { font-size: 15px; } }
`;
  const parseItems = (el) => {
    try {
      return JSON.parse(el.getAttribute("items") || "[]");
    } catch (e) {
      return [];
    }
  };
  const sheetFor = (from, it) =>
    openSheet(from, {
      title: it.titel || it.label,
      icon: it.icon,
      text: it.info,
      rows: it.waarden,
      entity: it.entity,
      path: it.path,
      pathLabel: it.padLabel,
      stepper: it.stap,
    });
  class CwMetric extends HTMLElement {
    static get observedAttributes() {
      return ["items"];
    }
    connectedCallback() {
      this._render();
    }
    attributeChangedCallback() {
      if (this.shadowRoot) this._render();
    }
    _render() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.addEventListener("click", (ev) => {
          const b = ev.composedPath().find((n) => n.dataset?.i !== undefined);
          if (!b) return;
          ev.stopPropagation();
          sheetFor(b, this._items[+b.dataset.i]);
        });
      }
      this._items = parseItems(this);
      this.shadowRoot.innerHTML = `<style>${METRIC_CSS}</style><div class="g">${this._items
        .map((it, i) => {
          const tap = it.info || it.entity || it.path;
          const tag = tap ? "button" : "div";
          const name = it.titel || `${it.label} ${it.value}`;
          return `<${tag} class="m"${tap ? ` data-i="${i}" aria-haspopup="dialog"` : ""} aria-label="${esc(name)}" title="${esc(name)}">${
            ICONS[it.icon]
              ? `<span class="i" style="--c:${esc(it.color || "currentColor")}">${svg(ICONS[it.icon])}</span>`
              : ""
          }<b>${esc(it.value)}</b><small>${esc(it.label)}</small></${tag}>`;
        })
        .join("")}</div>`;
    }
  }

  // ---------- <cw-toggles> ----------
  const TOGGLE_CSS = `
:host { display: block; }
/* 6-unit grid: a toggle spans 2 units, a split tile 3, so a phone shows 3 toggles or 2 split tiles per row. */
.g { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
/* Toggles top-aligned: icons and titles sit on one line across a row, however many sub lines a tile has. */
.g > button { grid-column: span 2; justify-content: flex-start; padding-top: 12px; }
.g > button > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Split tile: same 6px inset on every side; the halves are arrow-only (name in aria-label) and may shrink
   (minmax(0, …) + min-width: 0), so they never run past the tile edge. */
.split { grid-column: span 3; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 6px; border-radius: 16px; background: var(--cw-bg, var(--primary-background-color, #1d1a17)); }
.sh { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 22px; font-size: 13px; font-weight: 600; }
.sb { flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.sb button { min-width: 0; min-height: 44px; padding: 4px; border-radius: 12px; background: var(--cw-card, var(--card-background-color, #2a2622)); }
.sb svg { flex: none; width: 22px; height: 22px; color: currentColor; }
@media (min-width: 700px) { .g { grid-template-columns: repeat(12, minmax(0, 1fr)); } }
button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 64px; padding: 8px 4px; border-radius: 16px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px; text-align: center; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  background: var(--cw-bg, var(--primary-background-color, #1d1a17)); color: var(--cw-text, var(--primary-text-color, #F5EAD8)); }
button:hover { filter: brightness(1.05); }
button:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: 2px; }
button.on { background: color-mix(in srgb, var(--cw-accent, var(--primary-color, #D67F48)) 18%, var(--cw-bg, var(--primary-background-color, #1d1a17))); }
button.on svg { color: var(--cw-accent-ink, var(--cw-accent, var(--primary-color, #D67F48))); }
svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
span { font-size: 13px; font-weight: 600; line-height: 1.15; }
small { white-space: pre-line; font-size: 11.5px; line-height: 1.2; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); }
`;
  class CwToggles extends HTMLElement {
    static get observedAttributes() {
      return ["items"];
    }
    connectedCallback() {
      this._render();
    }
    attributeChangedCallback() {
      if (this.shadowRoot) this._render();
    }
    _render() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        const r = this.shadowRoot;
        const btn = (ev) =>
          ev.composedPath().find((n) => n.dataset?.i !== undefined);
        // Long press (or right-click) = info sheet; the click that follows is swallowed.
        r.addEventListener("pointerdown", (ev) => {
          const b = btn(ev);
          if (!b) return;
          clearTimeout(this._lpT);
          this._lpT = setTimeout(() => {
            this._lp = true;
            sheetFor(b, this._items[+b.dataset.i]);
          }, 550);
        });
        for (const t of ["pointerup", "pointerleave", "pointercancel"])
          r.addEventListener(t, () => clearTimeout(this._lpT));
        r.addEventListener("contextmenu", (ev) => {
          const b = btn(ev);
          if (!b) return;
          ev.preventDefault();
          clearTimeout(this._lpT);
          if (!this._lp) sheetFor(b, this._items[+b.dataset.i]);
          this._lp = true;
        });
        r.addEventListener(
          "click",
          (ev) => {
            if (!this._lp) return;
            this._lp = false;
            ev.stopPropagation();
            ev.preventDefault();
          },
          true,
        );
      }
      this._items = parseItems(this);
      const dataOf = (it) =>
        [
          it.act && ` data-act="${esc(it.act)}"`,
          it.entity && ` data-entity="${esc(it.entity)}"`,
          it.dir && ` data-dir="${esc(it.dir)}"`,
          it.kind && ` data-kind="${esc(it.kind)}"`,
        ]
          .filter(Boolean)
          .join("");
      this.shadowRoot.innerHTML = `<style>${TOGGLE_CSS}</style><div class="g" role="group">${this._items
        .map((it, i) => {
          if (it.split)
            return `<div class="split" role="group" aria-label="${esc(it.titel || it.label)}"><div class="sh">${svg(ICONS[it.icon] || "")}<span>${esc(it.label)}</span></div><div class="sb">${it.split
              .map(
                (h) =>
                  `<button data-i="${i}"${dataOf(h)} aria-label="${esc(`${it.label} ${h.label}`)}" title="${esc(`${it.label} ${h.label}${it.info ? ` · ${it.info}` : ""}`)}">${svg(ICONS[h.icon] || "")}</button>`,
              )
              .join("")}</div></div>`;
          const aria = `${it.titel || it.label}${it.sub ? `, ${it.sub}` : it.on === true ? ": " + <@ t('state_on') | tojson @> : it.on === false ? ": " + <@ t('state_off') | tojson @> : ""}`;
          return `<button data-i="${i}"${dataOf(it)} class="${it.on ? "on" : ""}"${typeof it.on === "boolean" ? ` aria-pressed="${it.on}"` : ""} aria-label="${esc(aria)}" title="${esc(`${aria}${it.info ? ` · ${it.info}` : ""} (${<@ t('long_press_hint') | tojson @>})`)}">${svg(ICONS[it.icon] || "")}<span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`;
        })
        .join("")}</div>`;
    }
  }

  // ---------- custom:cw-thema-kiezer (compatibility): only the round theme button, right-aligned ----------
  class CwThemaKiezer extends HTMLElement {
    setConfig() {}
    set hass(h) {
      this.shadowRoot?.querySelector("cw-thema-knop")?._render?.();
    }
    getCardSize() {
      return 1;
    }
    getGridOptions() {
      return { columns: "full", rows: 1, min_rows: 1 };
    }
    connectedCallback() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `<style>:host { display: flex; justify-content: flex-end; }</style><cw-thema-knop></cw-thema-knop>`;
      }
    }
  }

  class CwIcoon extends HTMLElement {
    static get observedAttributes() {
      return ["naam", "maat", "kleur", "vul"];
    }
    connectedCallback() {
      this.render();
    }
    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }
    render() {
      const naam = this.getAttribute("naam");
      const maat = this.getAttribute("maat");
      const kleur = this.getAttribute("kleur");
      const vul = parseFloat(this.getAttribute("vul"));
      let body = ICONS[naam] || "";
      if (naam === "batterij" && Number.isFinite(vul)) {
        const f = Math.min(Math.max(vul, 0), 1);
        body = `${BATT}<rect x="8.5" y="${(6.5 + 13 * (1 - f)).toFixed(2)}" width="7" height="${(13 * f).toFixed(2)}" rx="1" fill="currentColor" stroke="none"/>`;
      }
      this.style.display = "contents";
      this.innerHTML = `<svg viewBox="0 0 24 24"${maat ? ` width="${esc(maat)}" height="${esc(maat)}"` : ""} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${kleur ? ` style="color:${esc(kleur)}"` : ""}>${body}</svg>`;
    }
  }

  const def = (tag, cls) =>
    customElements.get(tag) || customElements.define(tag, cls);
  def("cw-knop", CwKnop);
  def("cw-thema-knop", CwThemaKnop);
  def("cw-kop", CwKop);
  def("cw-thema-kiezer", CwThemaKiezer);
  def("cw-status", CwStatus);
  def("cw-chip", CwChip);
  def("cw-info", CwInfo);
  def("cw-metric", CwMetric);
  def("cw-toggles", CwToggles);
  def("cw-icoon", CwIcoon);
  window.customCards = window.customCards || [];
  window.customCards.push(
    {
      type: "cw-kop",
      name: <@ t('card_header') | tojson @>,
      description: `v${VERSION}`,
    },
    {
      type: "cw-status",
      name: <@ t('card_status') | tojson @>,
      description: `v${VERSION}`,
    },
    {
      type: "cw-thema-kiezer",
      name: <@ t('card_theme') | tojson @>,
      description: `v${VERSION}`,
    },
  );
})();

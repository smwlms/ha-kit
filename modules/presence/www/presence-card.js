<# Card "Our week" (ha-kit module presence), filled in by tools/fill.py: every text comes from strings.yaml in
   house.language; the tables KIND_OF, DETAIL_OF, STAY_OF hold the texts of EVERY language, so calendar events
   written before a language switch are still read. #>
<% from '_presence.jinja' import every, kind_of, det_of, stay_of with context %>
<% set dm = t('days_full_mon').split() %>
<% set ds = t('days_short_mon').split() %>
(() => {
  const VERSION = "3";
  // "Our week" (ha-kit module presence): presence view on its own dashboard tab. A timeline per weekday
  // (work, travel, school runs, Supercharger), a usual week, time spent per place, and the Supercharger history.
  // Reads the log calendar and the stays calendar. Everything house-specific (people, cars, calendars, places, sleep
  // window) comes from the card config: see lovelace/our-week.yaml and presence/LOGIC.md.
  const C = {
    bg: "#1d1a17",
    card: "#2a2622",
    raised: "#3a3530",
    line: "#4a433c",
    text: "#F5EAD8",
    muted: "#BFB3A1",
    sun: "#E8A571",
    batt: "#9CAE7E",
    house: "#F5C9AE",
    car: "#AEBF92",
    grid: "#C98A5A",
    accent: "#C67139",
    green: "#6FBF73",
    red: "#E36B5A",
    amber: "#E8B04A",
    tesla: "#E31937", // Tesla red: Supercharger sessions on the presence view
    warn: "#3a2c26",
    good: "#2a3326",
  };
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const distM = (a, b) => {
    const r = Math.PI / 180;
    const h =
      Math.sin(((b[0] - a[0]) * r) / 2) ** 2 +
      Math.cos(a[0] * r) *
        Math.cos(b[0] * r) *
        Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  // Text with {placeholders} filled in from an object; unknown placeholders stay.
  const fmt = (s, v) =>
    String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
  const AND = ` ${<@ t('word_and') | tojson @>} `;
  // Presence log settings, filled from the card config (setConfig). One presence-card per page.
  const PRES = {
    cal: "calendar.presence", // config: calendar
    spreadCal: "calendar.stays", // config: stay_calendar
    weeks: 8, // averages ("A usual week")
    historyWeeks: 104, // fetched from the calendar: week browsing and the Supercharger history
    people: [], // [{ name, key, person, tracker, work, color }]
    school: true, // config: school (false = no school marks or legend item)
    family: [], // config: family [{ name, label }]: pick-up places outside school
    cars: [], // config: cars [{ name, called }]; none = no Supercharger list or legend item
    nightStart: 23 * 60, // config: sleep_window.start; equal to NIGHT_START in stay.py (both from house.yaml)
    nightEnd: 7 * 60 + 30, // config: sleep_window.end
  };
  // Detail "place" of a pick-up ("at <zone name>"): the family place it matches, or null (a school run).
  const familyOf = (place) => {
    const p = String(place || "").toLowerCase();
    return (
      PRES.family.find((f) => p.includes(String(f.name).toLowerCase())) || null
    );
  };
  // A car's name with its article for inside a sentence ("the Red X", from the config), plus a space; the bare name
  // for a car that is not in the config (e.g. renamed since the event was logged).
  const theCar = (name) => {
    const car = PRES.cars.find((c) => c.name === name);
    return `${(car && car.called) || name} `;
  };
  const hhmmToMin = (s, dflt) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ""));
    return m ? +m[1] * 60 + +m[2] : dflt;
  };
  // ---- Presence log (see presence/LOGIC.md) ------------------------------------------------------------------
  // The log is the presence calendar (Local Calendar), written by script.presence_log: one event per arrival, school
  // run, working day or Supercharger session, title "<kind>: <name>" or "<kind>: <name> and <name>", and "key: value"
  // lines in the description. Editing an event in the HA calendar corrects the dashboard too.
  // Titles and keys are read in every language of strings.yaml and turned into canonical names: kinds home,
  // home_from_work, drop_off, pick_up, work, charge; detail keys away, left_work, car, place, source, duration,
  // arrival, departure, work_trips, appointments, location, battery.
  const PRES_TTL = 3 * 60000;
  // Sunday first, like Date.getDay().
  const DAYS = <@ ([ds[6]] + ds[:6]) | tojson @>;
  const DAYS_FULL = <@ ([dm[6]] + dm[:6]) | tojson @>;
  const KIND_OF = <@ kind_of | tojson @>;
  const DETAIL_OF = <@ det_of | tojson @>;
  const STAY_OF = <@ stay_of | tojson @>;
  const STAY_TITLES = <@ every.kind_stay | tojson @>;
  const UNKNOWN = <@ every.unknown | tojson @>;
  const reEsc = (s) => String(s).replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const AND_RE = new RegExp(
    `\\s+(?:${<@ every.word_and | tojson @>.map(reEsc).join("|")})\\s+|\\s*[&,]\\s*`,
  );
  // Longest title first, so "Home from work" is not read as "Home".
  const PRES_RE = new RegExp(
    `^(${Object.keys(KIND_OF)
      .sort((a, b) => b.length - a.length)
      .map(reEsc)
      .join("|")}):\\s*(.+)$`,
  );
  const STAY_RE = new RegExp(`^(?:${STAY_TITLES.map(reEsc).join("|")}):\\s*(.+)$`);
  const isHome = (e) => e.kind === "home" || e.kind === "home_from_work";
  const isKnown = (place) => !!place && !UNKNOWN.includes(place);
  const UNKNOWN_PLACE = <@ t('card_unknown_place') | tojson @>;
  const parsePres = (e) => {
    const m = PRES_RE.exec(String(e.summary || "").trim());
    const t = new Date(e.start?.dateTime || e.start?.date);
    if (!m || Number.isNaN(+t)) return null;
    const det = {};
    for (const line of String(e.description || "").split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) {
        const k = line.slice(0, i).trim();
        det[DETAIL_OF[k] || k] = line.slice(i + 1).trim();
      }
    }
    const who = m[2]
      .split(AND_RE)
      .map((s) => s.trim())
      .filter(Boolean);
    const end = new Date(e.end?.dateTime || e.end?.date || t);
    return { kind: KIND_OF[m[1]], who, t, end: Number.isNaN(+end) ? t : end, det };
  };
  const minOfDay = (d) => d.getHours() * 60 + d.getMinutes();
  const fmtMin = (m) => {
    const r = Math.round(m);
    return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
  };
  const fmtDur = (m) =>
    Math.round(m) < 60
      ? `${Math.round(m)} min`
      : fmt(<@ t('card_dur_hm') | tojson @>, {
          h: Math.floor(Math.round(m) / 60),
          m: String(Math.round(m) % 60).padStart(2, "0"),
        });
  const personColor = (name) =>
    PRES.people.find((p) => p.name === name)?.color || C.muted;
  const whoChips = (who) =>
    who
      .map(
        (w) =>
          `<span class="who"><i style="background:${personColor(w)}"></i>${esc(w)}</span>`,
      )
      .join("");
  // One calendar fetch, at most once per PRES_TTL unless the
  // calendar entity changed. A failed fetch keeps the previous data.
  const presCache = { at: 0, sig: null, data: null, pending: null };
  const loadPres = (hass) => {
    const sig = hass.states[PRES.cal]?.last_updated;
    if (
      presCache.data &&
      sig === presCache.sig &&
      Date.now() - presCache.at < PRES_TTL
    )
      return Promise.resolve(presCache.data);
    if (presCache.pending) return presCache.pending;
    const from = new Date(Date.now() - PRES.historyWeeks * 7 * 86400000);
    from.setHours(0, 0, 0, 0);
    const to = new Date(Date.now() + 86400000);
    presCache.pending = hass
      .callApi(
        "GET",
        `calendars/${PRES.cal}?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`,
      )
      .then((res) => {
        presCache.data = (res || [])
          .map(parsePres)
          .filter(Boolean)
          .sort((a, b) => a.t - b.t);
        presCache.at = Date.now();
        presCache.sig = sig;
        return presCache.data;
      })
      .catch(() => presCache.data || [])
      .finally(() => {
        presCache.pending = null;
      });
    return presCache.pending;
  };
  // Time at work per person and day: from arrival to the last departure of each working day (see workSpans), work
  // trips included.
  const workDays = (data) =>
    dayModel(data)
      .filter((d) => d.works.length)
      .map((d) => ({
        name: d.name,
        t: d.date,
        start: d.works[0][0],
        end: d.works.at(-1)[1],
        total: d.works.reduce((s, [a, b]) => s + b - a, 0),
      }));
  // "11:05-12:20, 14:00-14:30" (detail work_trips of a work event) → [[665, 740], [840, 870]].
  const parseTrips = (s) =>
    [
      ...String(s || "").matchAll(
        /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/g,
      ),
    ].map((m) => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
  // Working days of one person on one day, as [arrival, departure] with .trips = [[from, to], ...]. Leaving work and
  // coming back without being home in between is a work trip: it stays work.
  // Older days have one work event per stay in the work zone; those are joined here the same way.
  const workSpans = (ev) => {
    const out = [];
    const homeAt = ev.filter(isHome).map((e) => minOfDay(e.t));
    for (const e of ev
      .filter((x) => x.kind === "work")
      .sort((x, y) => x.t - y.t)) {
      const a = minOfDay(e.t),
        b = minOfDay(e.end);
      const trips = parseTrips(e.det.work_trips);
      // Appointments on the way after leaving work (workday.py): shown in the work trip's tooltip.
      const appts = parseTrips(e.det.appointments);
      const last = out.at(-1);
      if (last && !homeAt.some((h) => h > last[1] && h < a)) {
        if (a > last[1]) last.trips.push([last[1], a]);
        last.trips.push(...trips);
        last.appts.push(...appts);
        last.open = !!e.det.open;
        last[1] = Math.max(last[1], b);
      } else out.push(Object.assign([a, b], { trips, appts, open: !!e.det.open }));
    }
    return out;
  };
  const weekStart = (d, back = 0) => {
    const w = new Date(d);
    w.setHours(0, 0, 0, 0);
    w.setDate(w.getDate() - ((w.getDay() + 6) % 7) - 7 * back);
    return w;
  };
  // One day per person: departure from home (the "dd/mm HH:MM" in the detail away of that day's arrival event), the
  // stays at work, and the arrival home (the last arrival after noon). Travel time = the gaps home → work and
  // work → home.
  const SINCE_RE = /(\d\d)\/(\d\d) (\d\d):(\d\d)/;
  // Helpers of the open working day (automation presence_workday), per person key.
  const LIVE_HELPERS = ["arrived_at_work", "left_work", "away_since"];
  const dayModel = (data) => {
    const days = new Map();
    for (const e of data)
      for (const w of e.who) {
        const k = `${w}|${e.t.toDateString()}`;
        const d =
          days.get(k) ||
          days
            .set(k, {
              name: w,
              date: new Date(e.t.getFullYear(), e.t.getMonth(), e.t.getDate()),
              ev: [],
            })
            .get(k);
        d.ev.push(e);
      }
    for (const d of days.values()) {
      d.works = workSpans(d.ev);
      d.charges = d.ev
        .filter((e) => e.kind === "charge")
        .map((e) => ({
          a: minOfDay(e.t),
          b: minOfDay(e.end),
          det: e.det,
          ev: e,
        }));
      const home = d.ev.filter((e) => isHome(e) && e.t.getHours() >= 12).at(-1);
      d.arr = home ? minOfDay(home.t) : null;
      const deps = d.ev
        .map((e) => SINCE_RE.exec(e.det.away || ""))
        .filter(Boolean)
        .filter(
          (m) => +m[1] === d.date.getDate() && +m[2] === d.date.getMonth() + 1,
        )
        .map((m) => +m[3] * 60 + +m[4]);
      d.dep =
        d.works.length && deps.length
          ? Math.max(...deps.filter((m) => m < d.works[0][0]), -1)
          : -1;
      if (d.dep < 0 || d.works[0][0] - d.dep > 180) d.dep = null;
      if (
        d.arr !== null &&
        d.works.length &&
        (d.arr < d.works.at(-1)[1] || d.arr - d.works.at(-1)[1] > 180)
      )
        d.back = false;
      else d.back = d.arr !== null && d.works.length > 0;
    }
    return [...days.values()];
  };
  const avgOf = (a) =>
    a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
  // Average travel time per person over the given days (from dayModel): home → work and work → home.
  const tripsOf = (model, people) => {
    const trips = {};
    for (const n of people) {
      const ds = model.filter((d) => d.name === n && d.works.length);
      const there = avgOf(
        ds.filter((d) => d.dep !== null).map((d) => d.works[0][0] - d.dep),
      );
      const back = avgOf(
        ds.filter((d) => d.back).map((d) => d.arr - d.works.at(-1)[1]),
      );
      if (Number.isFinite(there) || Number.isFinite(back))
        trips[n] = { there, back };
    }
    return trips;
  };
  // School run markers, drawn in the colour of who did it (currentColor): a graduation cap for the school, and two
  // grandparents (grandad with a cane) for picking up at the grandparents'.
  const ICON_SCHOOL = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 15.5 6 8 9.5 .5 6Z" fill="currentColor"/><path d="M3.5 7.8V11c0 1.6 9 1.6 9 0V7.8L8 9.9Z" fill="currentColor"/><path d="M14.2 6.6v4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  const ICON_FAMILY = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.6" cy="3.2" r="2" fill="currentColor"/><path d="M2 15V8.6C2 6.4 7.2 6.4 7.2 8.6V15Z" fill="currentColor"/><circle cx="11" cy="3.6" r="1.9" fill="currentColor"/><path d="M8.7 15V9c0-2 4.6-2 4.6 0v6Z" fill="currentColor"/><path d="M15.2 8.4V15M15.2 8.4c0-1-1.4-1-1.4 0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  // Office building in the person's colour, in front of the office-hours bars.
  const ICON_OFFICE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 15V2.2c0-.4.3-.7.7-.7h6.6c.4 0 .7.3.7.7V15Zm8 0V6h2.8c.4 0 .7.3.7.7V15Z" fill="currentColor"/><path d="M4.5 4h1.5v1.5H4.5Zm2.5 0h1.5v1.5H7ZM4.5 7h1.5v1.5H4.5Zm2.5 0h1.5v1.5H7ZM4.5 10h1.5v1.5H4.5Zm2.5 0h1.5v1.5H7ZM6 13h1.5v2H6Z" fill="${C.card}"/></svg>`;
  const ICON_CAR = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 7 4.5 3.6c.2-.5.6-.8 1.1-.8h4.8c.5 0 .9.3 1.1.8L12.8 7H14c.6 0 1 .4 1 1v3.5c0 .4-.3.7-.7.7H13v1.1c0 .4-.3.7-.7.7h-1c-.4 0-.7-.3-.7-.7v-1.1H5.4v1.1c0 .4-.3.7-.7.7h-1c-.4 0-.7-.3-.7-.7v-1.1H1.7c-.4 0-.7-.3-.7-.7V8c0-.6.4-1 1-1ZM4.8 7h6.4l-1-2.8H5.8Z" fill="currentColor"/></svg>`;
  // Most frequent Supercharger in a list of charge events: [name, count, all counts as text].
  const topPlace = (evs) => {
    const c = {};
    for (const e of evs) {
      const p = isKnown(e.det.place) ? e.det.place : UNKNOWN_PLACE;
      c[p] = (c[p] || 0) + 1;
    }
    const all = Object.entries(c).sort((a, b) => b[1] - a[1]);
    return all.length
      ? [all[0][0], all[0][1], all.map(([p, n]) => `${p} ${n}×`).join(" · ")]
      : [null, 0, ""];
  };
  const ICON_BOLT = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1 3 9h4.2L6.3 15 13 6.8H8.8Z" fill="currentColor"/></svg>`;
  // ---- Time split per week: where we spend our time ----------------------------------------------------------------
  // Stored per day in the stays calendar (PRES.spreadCal) by the automation presence_stays (presence/stay.py); days
  // not stored yet (today) come straight from the recorder.
  const SPREAD_TTL = 30 * 60000;
  // Phone tracker per person (as TRACKERS in stay.py); since/until (ms) cover a replaced phone.
  const spreadTrackers = () =>
    PRES.people
      .filter((p) => p.tracker)
      .map((p) => ({ id: p.tracker, name: p.name }));
  const SPREAD_CATS = [
    { key: "sleep", label: <@ t('card_cat_sleep') | tojson @>, color: "#5E6E91" },
    { key: "home", label: <@ t('card_cat_home') | tojson @>, color: C.house },
    { key: "work", label: <@ t('card_cat_work') | tojson @>, color: C.grid },
    { key: "elsewhere", label: <@ t('card_cat_elsewhere') | tojson @>, color: "#8FA3B8" },
    { key: "travel", label: <@ t('card_cat_travel') | tojson @>, color: C.raised },
  ];
  // Night window (PRES.nightStart/nightEnd): at home this counts as asleep. Same window as stay.py.
  const nightOverlap = (a, b) => {
    const d = new Date(a);
    const at = (min) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min).getTime();
    const next = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + 1,
    ).getTime();
    return [
      [at(0), at(PRES.nightEnd)],
      [at(PRES.nightStart), next],
    ].reduce(
      (s, [w0, w1]) => s + Math.max(0, Math.min(b, w1) - Math.max(a, w0)),
      0,
    );
  };
  const isoDay = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Same rule as cells_per_day() in stay.py: per pair of fixes, standing still (next fix within 150 m or slower
  // than 2 km/h) counts for the spot, at most 16 h; otherwise travel time, at most 3 h; split at midnight.
  const dayCells = (fixes, out = {}) => {
    const fs = fixes.filter((f) => !(f.acc > 200));
    for (let i = 0; i + 1 < fs.length; i++) {
      const a = fs[i],
        b = fs[i + 1];
      if (b.t <= a.t) continue;
      const d = distM(a.ll, b.ll);
      const still = d <= 150 || d / ((b.t - a.t) / 1000) < 2 / 3.6;
      const key = still
        ? `${a.ll[0].toFixed(3)},${a.ll[1].toFixed(3)}`
        : "travel";
      const end = Math.min(b.t, a.t + (still ? 16 : 3) * 3600000);
      for (let cur = a.t; cur < end; ) {
        const day = new Date(cur);
        const midnight = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate() + 1,
        ).getTime();
        const partEnd = Math.min(end, midnight);
        const cells = (out[isoDay(day)] ||= {});
        cells[key] = (cells[key] || 0) + (partEnd - cur) / 60000;
        const night = still ? nightOverlap(cur, partEnd) : 0;
        if (night > 0)
          (cells.night ||= {})[key] =
            ((cells.night ||= {})[key] || 0) + night / 60000;
        cur = partEnd;
      }
    }
    return out;
  };
  // "spots: 52.370,5.220=705;…\non the road: 141\nnight: 52.370,5.220=480" (labels in any language of strings.yaml)
  // → {"52.370,5.220": 705, …, travel: 141, night: {…}} (made-up coordinates)
  const parseCells = (desc) => {
    const out = {};
    for (const line of String(desc || "").split("\n")) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const k = STAY_OF[line.slice(0, i).trim()];
      const v = line.slice(i + 1).trim();
      if (k === "travel") out.travel = +v || 0;
      if (k === "spots" || k === "night")
        for (const part of v.split(";")) {
          const [cell, min] = part.split("=");
          if (cell && min)
            (k === "night" ? (out.night ||= {}) : out)[cell] = +min || 0;
        }
    }
    return out;
  };
  // ---- Presence view (own tab "our-week"): a timeline per weekday, little text ---------------------------------
  class PresenceCard extends HTMLElement {
    // people: [{ name, key, person, tracker, work_zone, color }]; cars: [{ name, called }]; calendar, stay_calendar:
    // calendar entities; children: how the sentences name the children; school: true|false;
    // family: [{ name, label }]; sleep_window: { start: "23:00", end: "07:30" }.
    setConfig(config) {
      const palette = [C.sun, C.batt, "#8FA3B8", C.house];
      PRES.cal = config.calendar || "calendar.presence";
      PRES.spreadCal = config.stay_calendar || "calendar.stays";
      PRES.school = config.school !== false;
      PRES.family = (config.family || []).map((f) =>
        typeof f === "string" ? { name: f, label: f } : { name: f.name, label: f.label || f.name },
      );
      PRES.cars = config.cars || [];
      PRES.nightStart = hhmmToMin(config.sleep_window?.start, 23 * 60);
      PRES.nightEnd = hhmmToMin(config.sleep_window?.end, 7 * 60 + 30);
      PRES.people = (config.people || []).map((p, i) => ({
        name: p.name,
        key: p.key,
        person: p.person || `person.${p.key}`,
        tracker: p.tracker,
        work: p.work_zone || `zone.work_${p.key}`,
        color: p.color || palette[i % palette.length],
      }));
      if (!PRES.people.length)
        throw new Error("presence-card: list the people under 'people'");
      this._cfg = {
        children: <@ t('children_default') | tojson @>,
        calendar_path: `/calendar?entity_id=${PRES.cal}`,
        ...config,
      };
      this._week = 0;
    }
    getCardSize() {
      return 10;
    }
    set hass(hass) {
      this._hass = hass;
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="pv"></div><div class="pv-foot"></div><div class="tip" hidden></div></div>`;
        // Tooltip for every mark with data-tip: on hover with a mouse, on tap on a touch screen (no hover there).
        const markOf = (ev) => ev.composedPath().find((n) => n.dataset?.tip);
        this.shadowRoot.addEventListener("mouseover", (ev) => {
          const m = markOf(ev);
          if (m) this._showTip(m);
        });
        this.shadowRoot.addEventListener("mouseout", (ev) => {
          if (markOf(ev) && !this._tipPinned) this._hideTip();
        });
        this.shadowRoot.addEventListener(
          "toggle",
          (ev) => {
            if (ev.target.classList?.contains("lg"))
              this._lgOpen = ev.target.open;
          },
          true,
        );
        this.shadowRoot.addEventListener("click", (ev) => {
          const mark = markOf(ev);
          if (mark) {
            this._showTip(mark, true);
            return;
          }
          const el = ev
            .composedPath()
            .find((n) => n.dataset?.nav || n.dataset?.week);
          if (!el) return;
          if (el.dataset.week) {
            this._week = Math.max(0, this._week + Number(el.dataset.week));
            this._draw();
            return;
          }
          history.pushState(null, "", el.dataset.nav);
          window.dispatchEvent(
            new CustomEvent("location-changed", { detail: { replace: false } }),
          );
        });
      }
      const sig = [
        PRES.cal,
        ...PRES.people.flatMap((p) => [p.person, ...LIVE_HELPERS.map((h) => `input_datetime.presence_${p.key}_${h}`)]),
      ]
        .map((id) => hass.states[id]?.last_updated)
        .join("|");
      if (sig !== this._sig) {
        this._sig = sig;
        this._load();
      }
    }
    connectedCallback() {
      clearInterval(this._tick);
      this._tick = setInterval(() => this._hass && this._load(), PRES_TTL);
    }
    disconnectedCallback() {
      clearInterval(this._tick);
    }
    async _load() {
      const data = await loadPres(this._hass);
      if (data === this._data && this._drawn && !this._live().length) return;
      this._data = data || [];
      this._draw();
    }
    _showTip(mark, pinned = false) {
      const t = this.shadowRoot.querySelector(".tip");
      t.textContent = mark.dataset.tip;
      t.hidden = false;
      const r = mark.getBoundingClientRect();
      const w = t.offsetWidth;
      const left = Math.max(
        8,
        Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2),
      );
      const above = r.top - t.offsetHeight - 8;
      t.style.left = `${left}px`;
      t.style.top = `${above > 8 ? above : r.bottom + 8}px`;
      clearTimeout(this._tipTimer);
      this._tipPinned = pinned;
      if (pinned) this._tipTimer = setTimeout(() => this._hideTip(), 4000);
    }
    _hideTip() {
      this._tipPinned = false;
      const t = this.shadowRoot.querySelector(".tip");
      if (t) t.hidden = true;
    }
    _draw() {
      this._drawn = true;
      const people = PRES.people.map((p) => p.name);
      // Legend: compact, at the bottom, collapsed unless the viewer opened it (kept across re-renders).
      const c0 = personColor(people[0]);
      const item = (mark, text) =>
        `<span class="lg-item"><span class="lg-mark" style="--c:${c0};color:${c0}">${mark}</span>${text}</span>`;
      const legend = `<details class="lg" ${this._lgOpen ? "open" : ""}><summary>${esc(<@ t('card_legend') | tojson @>)}</summary><div class="lg-grid">
${people.map((n) => item(`<i class="pdot" style="background:${personColor(n)}"></i>`, n)).join("")}
${PRES.school ? item(`<i class="g-ic">${ICON_SCHOOL}</i>`, esc(<@ t('card_legend_school') | tojson @>)) : ""}
${PRES.family.map((f) => item(`<i class="g-ic">${ICON_FAMILY}</i>`, esc(f.label))).join("")}
${item('<i class="g-trip"></i>', esc(<@ t('card_legend_travel') | tojson @>))}
${item('<i class="g-bar"></i>', esc(<@ t('card_legend_work') | tojson @>))}
${item('<i class="g-move"></i>', esc(<@ t('card_legend_work_trip') | tojson @>))}
${item('<i class="g-home"></i>', esc(<@ t('card_legend_home') | tojson @>))}
${PRES.cars.length ? item(`<i class="g-chg"></i>`, esc(<@ t('card_legend_supercharger') | tojson @>)) : ""}
</div><span class="small muted">${esc(<@ t('card_legend_help') | tojson @>)}</span></details>`;
      this.shadowRoot.querySelector(".pv").innerHTML =
        `<div class="head"><div class="hl"><h1>${esc(<@ t('view_title') | tojson @>)}</h1></div></div>
<div class="pcols">${this._weekCard(people)}${this._avgCard(people)}</div>
<div class="pcols one">${this._spreadCard(people)}</div>
<div class="pcols one">${this._chargeList()}</div>`;
      this.shadowRoot.querySelector(".pv-foot").innerHTML =
        `<div class="pfoot">${legend}<button class="link" data-nav="${this._cfg.calendar_path}">${esc(<@ t('card_calendar_link') | tojson @>)}</button></div>`;
    }
    // ---- Supercharger history: every logged session, newest first ---------------------------------------------
    _chargeList() {
      const evs = this._data.filter((e) => e.kind === "charge").reverse();
      if (!evs.length || !PRES.cars.length) return "";
      const maxMin = Math.max(...evs.map((e) => (e.end - e.t) / 60000), 30);
      const rows = evs
        .map((e) => {
          const mins = (e.end - e.t) / 60000;
          const bat = /(\d+)\s*→\s*(\d+)/.exec(e.det.battery || "");
          const [b0, b1] = bat ? [+bat[1], +bat[2]] : [null, null];
          const known = isKnown(e.det.place);
          const place = known
            ? e.det.place.replace(/^Supercharger\s*/i, "")
            : UNKNOWN_PLACE;
          const tip = fmt(<@ t('card_tip_charge') | tojson @>, {
            who: e.who.join(AND),
            car: e.det.car ? theCar(e.det.car) : "",
            day: `${DAYS_FULL[e.t.getDay()]} ${e.t.getDate()}/${e.t.getMonth() + 1}`,
            where: known
              ? fmt(<@ t('card_at_place') | tojson @>, { place: e.det.place })
              : <@ t('card_at_supercharger') | tojson @>,
            from: fmtMin(minOfDay(e.t)),
            to: fmtMin(minOfDay(e.end)),
            duration: fmtDur(mins),
            battery: bat ? `: ${b0} → ${b1} %` : "",
          });
          return `<div class="cl-row" data-tip="${esc(tip)}">
<span class="cl-day">${DAYS[e.t.getDay()]} <b>${e.t.getDate()}/${e.t.getMonth() + 1}</b>${e.t.getFullYear() !== new Date().getFullYear() ? ` <small>${e.t.getFullYear()}</small>` : ""}</span>
<span class="cl-place">${esc(place)}${e.who.map((n) => `<i class="pdot" style="background:${personColor(n)}"></i>`).join("")}</span>
<span class="cl-bat">${bat ? `<span class="cl-bat-fill" style="left:${b0}%;width:${Math.max(1, b1 - b0)}%"></span><small>${b0} → ${b1} %</small>` : ""}</span>
<span class="cl-dur"><span class="cl-dur-bar" style="width:${(mins / maxMin) * 100}%"></span><b>${fmtDur(mins)}</b></span>
</div>`;
        })
        .join("");
      const total = evs.reduce((s, e) => s + (e.end - e.t) / 60000, 0);
      return `<div class="card"><span class="lbl"><span><i class="g-ic wt-ic wt-bolt lbl-ic">${ICON_BOLT}</i>${esc(<@ t('card_charges_title') | tojson @>)}</span><span class="small muted">${evs.length}× · ${fmtDur(total)}</span></span>
<div class="cl">${rows}</div></div>`;
    }
    // ---- Time split per week: stored days + today from the recorder ------------------------------------------
    async _loadSpread() {
      if (
        this._spreadBusy ||
        (this._spread && Date.now() - this._spreadAt < SPREAD_TTL)
      )
        return;
      this._spreadBusy = true;
      try {
        const now = new Date();
        const from = new Date(now.getTime() - PRES.historyWeeks * 7 * 86400000);
        const evs = await this._hass.callApi(
          "GET",
          `calendars/${PRES.spreadCal}?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
        );
        const days = {};
        for (const e of evs || []) {
          const m = STAY_RE.exec(e.summary || "");
          const day = (e.start?.date || e.start?.dateTime || "").slice(0, 10);
          if (m && day)
            (days[m[1].trim()] ||= {})[day] = parseCells(e.description);
        }
        // Days after the last stored one (normally only today) straight from the recorder, at most 9 days back.
        const stored = Object.values(days)
          .flatMap((d) => Object.keys(d))
          .sort();
        const lastStored = stored.at(-1);
        const since = new Date(
          Math.max(
            now.getTime() - 9 * 86400000,
            lastStored ? Date.parse(`${lastStored}T00:00:00`) + 86400000 : 0,
          ) - 86400000,
        );
        const ids = [...new Set(spreadTrackers().map((t) => t.id))].join(",");
        const res = await this._hass.callApi(
          "GET",
          `history/period/${since.toISOString()}?filter_entity_id=${ids}&end_time=${encodeURIComponent(now.toISOString())}&significant_changes_only=0`,
        );
        const fixes = {};
        for (const series of Array.isArray(res) ? res : []) {
          if (!Array.isArray(series)) continue;
          const id = series[0]?.entity_id;
          for (const x of series) {
            const t = Date.parse(x.last_updated);
            const who = spreadTrackers().find(
              (k) =>
                k.id === id &&
                (!k.until || t < k.until) &&
                (!k.since || t >= k.since),
            );
            if (who && Number.isFinite(x.attributes?.latitude))
              (fixes[who.name] ||= []).push({
                t,
                ll: [x.attributes.latitude, x.attributes.longitude],
                acc: x.attributes.gps_accuracy,
              });
          }
        }
        for (const [n, fs] of Object.entries(fixes)) {
          fs.sort((a, b) => a.t - b.t);
          for (const [day, cells] of Object.entries(dayCells(fs)))
            if (!lastStored || day > lastStored) (days[n] ||= {})[day] = cells;
        }
        this._spread = days;
        this._spreadAt = Date.now();
        this._draw();
      } catch (e) {
        this._spreadAt = Date.now();
      } finally {
        this._spreadBusy = false;
      }
    }
    // Per person and week: share of the measured time asleep (at home 23:00–07:30), at home, at work (own work zone),
    // elsewhere and on the road.
    _spreadCard(people) {
      this._loadSpread();
      if (!this._spread)
        return `<div class="card"><span class="lbl"><span>${esc(<@ t('card_spread_title') | tojson @>)}</span></span><span class="small muted">${esc(<@ t('card_loading') | tojson @>)}</span></div>`;
      const z = (id) => {
        const a = this._hass.states[id]?.attributes;
        return a && Number.isFinite(a.latitude)
          ? { ll: [a.latitude, a.longitude], r: (a.radius || 100) + 50 }
          : null;
      };
      const home = z("zone.home");
      const work = Object.fromEntries(
        PRES.people.map((p) => [p.name, z(p.work)]),
      );
      const cat = (n, cell) => {
        if (cell === "travel") return "travel";
        const ll = cell.split(",").map(Number);
        if (home && distM(ll, home.ll) <= home.r) return "home";
        if (work[n] && distM(ll, work[n].ll) <= work[n].r) return "work";
        return "elsewhere";
      };
      const thisWeek = weekStart(new Date()).getTime();
      // Logged working day per person and day (arrival to departure, work trips included).
      const logged = {};
      for (const d of workDays(this._data))
        logged[`${d.name}|${isoDay(d.t)}`] = d.total;
      const blocks = people
        .map((n) => {
          const weeks = {};
          for (const [day, cells] of Object.entries(this._spread[n] || {})) {
            const wk = weekStart(new Date(`${day}T12:00:00`)).getTime();
            const w = (weeks[wk] ||= {
              sleep: 0,
              home: 0,
              work: 0,
              elsewhere: 0,
              travel: 0,
            });
            const d = { sleep: 0, home: 0, work: 0, elsewhere: 0, travel: 0 };
            for (const [cell, min] of Object.entries(cells))
              if (cell !== "night") d[cat(n, cell)] += min;
            // Night minutes at home are sleep, taken out of "home".
            for (const [cell, min] of Object.entries(cells.night || {}))
              if (cat(n, cell) === "home") {
                d.home -= min;
                d.sleep += min;
              }
            // The logged working day wins when the phone saw less of it (no fix in the work zone, came by car, a
            // work trip): the missing work minutes come out of "elsewhere", then "travel", and the rest was time the
            // phone did not measure at all (some phones report little on the road).
            let extra = (logged[`${n}|${day}`] || 0) - d.work;
            for (const k of ["elsewhere", "travel"]) {
              const take = Math.max(0, Math.min(extra, d[k]));
              d[k] -= take;
              d.work += take;
              extra -= take;
            }
            if (extra > 0) d.work += extra;
            for (const k of Object.keys(d)) w[k] += d[k];
          }
          const rows = Object.entries(weeks)
            .sort((a, b) => b[0] - a[0])
            .slice(0, PRES.weeks)
            .map(([wk, w]) => {
              const start = new Date(+wk);
              const total = SPREAD_CATS.reduce((s, c) => s + w[c.key], 0);
              if (!total) return "";
              const name =
                +wk === thisWeek
                  ? <@ t('card_this_week_lower') | tojson @>
                  : fmt(<@ t('card_week_of_lower') | tojson @>, {
                      date: `${start.getDate()}/${start.getMonth() + 1}`,
                    });
              const label =
                +wk === thisWeek
                  ? <@ t('card_this_week_lower') | tojson @>
                  : `${start.getDate()}/${start.getMonth() + 1}`;
              const segs = SPREAD_CATS.filter((c) => w[c.key] > 0)
                .map(
                  (c) =>
                    `<span class="sp-seg ${c.key}" style="width:${((w[c.key] / total) * 100).toFixed(2)}%;background:${c.color}" data-tip="${esc(`${n}, ${name}: ${c.label} ${fmtDur(w[c.key])} (${Math.round((w[c.key] / total) * 100)} %)`)}"></span>`,
                )
                .join("");
              return `<div class="sp-row"><span class="sp-wk">${label}</span><span class="sp-bar">${segs}</span></div>`;
            })
            .join("");
          return rows
            ? `<div class="sp-person"><span class="sp-name">${whoChips([n])}</span>${rows}</div>`
            : "";
        })
        .join("");
      const legend = SPREAD_CATS.map(
        (c) =>
          `<span class="sp-lg"><i class="${c.key}" style="background:${c.color}"></i>${c.label}</span>`,
      ).join("");
      return `<div class="card"><span class="lbl"><span>${esc(<@ t('card_spread_title') | tojson @>)}</span><span class="sp-legend">${legend}</span></span>
${blocks || `<span class="small muted">${esc(<@ t('card_no_data') | tojson @>)}</span>`}</div>`;
    }
    // rows: [{label, school: [{m, who, family, tip}], lanes: {name: {dep, works, arr, back}}}]
    // Hover/tap text per mark, as a sentence. Week rows tell what happened; average rows what usually happens.
    _tip(kind, n, r, a, b, det = {}) {
      const dur = b !== undefined ? Math.round(b - a) : 0;
      const v = {
        n,
        day: DAYS_FULL[r.wd],
        from: fmtMin(a),
        to: b !== undefined ? fmtMin(b) : "",
        duration: dur < 60 ? `${dur} min` : fmtDur(dur),
      };
      const list = (spans) =>
        spans.map(([p, q]) => `${fmtMin(p)}–${fmtMin(q)}`).join(", ");
      if (r.avg)
        return {
          home: () => fmt(<@ t('card_avg_home') | tojson @>, v),
          work: () => fmt(<@ t('card_avg_work') | tojson @>, v),
          there: () => fmt(<@ t('card_avg_there') | tojson @>, v),
          back: () => fmt(<@ t('card_avg_back') | tojson @>, v),
          charge: () =>
            fmt(<@ t('card_avg_charge') | tojson @>, {
              ...v,
              count: det.count,
              top: det.top ? fmt(<@ t('card_mostly') | tojson @>, { place: det.top }) : "",
            }),
        }[kind]();
      return {
        home: () => fmt(<@ t('card_tip_home') | tojson @>, v),
        workNow: () => fmt(<@ t('card_tip_work_now') | tojson @>, v),
        work: () =>
          fmt(<@ t('card_tip_work') | tojson @>, {
            ...v,
            trips: !det.trips?.length
              ? ""
              : det.trips.length === 1
                ? fmt(<@ t('card_with_trip') | tojson @>, { list: list(det.trips) })
                : fmt(<@ t('card_with_trips') | tojson @>, { count: det.trips.length, list: list(det.trips) }),
          }),
        move: () =>
          fmt(<@ t('card_tip_move') | tojson @>, {
            ...v,
            appointments: !det.appts?.length
              ? ""
              : det.appts.length === 1
                ? fmt(<@ t('card_one_appointment') | tojson @>, { list: list(det.appts) })
                : fmt(<@ t('card_appointments') | tojson @>, { count: det.appts.length, list: list(det.appts) }),
          }),
        there: () => fmt(<@ t('card_tip_there') | tojson @>, v),
        back: () =>
          fmt(<@ t('card_tip_back') | tojson @>, {
            ...v,
            origin: det.appt
              ? <@ t('card_from_last_appointment') | tojson @>
              : <@ t('card_from_work') | tojson @>,
          }),
        gap: () => fmt(<@ t('card_tip_gap') | tojson @>, v),
        charge: () =>
          fmt(<@ t('card_tip_charge') | tojson @>, {
            who: n,
            car: det.car ? theCar(det.car) : "",
            day: v.day,
            where: isKnown(det.place)
              ? fmt(<@ t('card_at_place') | tojson @>, { place: det.place })
              : <@ t('card_at_supercharger') | tojson @>,
            from: v.from,
            to: v.to,
            duration: v.duration,
            battery: det.battery ? `: ${det.battery}` : "",
          }),
      }[kind]();
    }
    _gantt(rows, people) {
      const ms = rows.flatMap((r) => [
        ...r.school.map((s) => s.m),
        ...Object.values(r.lanes).flatMap((l) =>
          [
            l.dep,
            l.arr,
            ...l.works.flat(),
            ...(l.charges || []).flatMap((c) => [c.a, c.b]),
          ].filter((v) => v !== null && Number.isFinite(v)),
        ),
      ]);
      // Whole hours with at least 20 min margin, so a marker at the edge stays visible.
      const lo = Math.min(
        7 * 60,
        Math.floor((Math.min(...ms, 1e9) - 20) / 60) * 60,
      );
      const hi = Math.max(
        19 * 60,
        Math.ceil((Math.max(...ms, 0) + 20) / 60) * 60,
      );
      const x = (m) => `${(((m - lo) / (hi - lo)) * 100).toFixed(2)}%`;
      const w = (a, b) => `${(((b - a) / (hi - lo)) * 100).toFixed(2)}%`;
      const ticks = [];
      for (let m = Math.ceil(lo / 120) * 120; m <= hi; m += 120) ticks.push(m);
      const grid = ticks
        .map((m) => `<span class="grid" style="left:${x(m)}"></span>`)
        .join("");
      const LANE = 18;
      const body = rows
        .map((r) => {
          const school = r.school
            .map((s) =>
              s.who
                .map(
                  (n, i) =>
                    `<i class="g-ic" style="left:calc(${x(s.m)} + ${i * 15}px);top:1px;color:${personColor(n)}" data-tip="${esc(s.tip)}">${s.family ? ICON_FAMILY : ICON_SCHOOL}</i>`,
                )
                .join(""),
            )
            .join("");
          const lanes = people
            .map((n, i) => {
              const l = r.lanes[n];
              if (!l) return "";
              const top = LANE * (i + 1) + 3;
              const c = personColor(n);
              const out = [];
              if (l.dep !== null && l.works.length)
                out.push(
                  `<i class="g-trip" style="left:${x(l.dep)};width:${w(l.dep, l.works[0][0])};top:${top + 4}px;--c:${c}" data-tip="${esc(this._tip("there", n, r, l.dep, l.works[0][0]))}"></i>`,
                );
              // Two working days on one day only when the person was home in between (see workSpans).
              l.works.slice(1).forEach(([a], k) => {
                const b0 = l.works[k][1];
                out.push(
                  `<i class="g-gap" style="left:${x(b0)};width:${w(b0, a)};top:${top + 4}px;--c:${c}" data-tip="${esc(this._tip("gap", n, r, b0, a))}"></i>`,
                );
              });
              // One bar from arrival to departure, both times written in it when the bar is wide enough; work trips
              // are hatched on top: still work.
              for (const span of l.works) {
                const [a, b] = span;
                const trips = span.trips || [];
                const times =
                  (b - a) / (hi - lo) >= 0.2
                    ? `<b>${fmtMin(a)}</b><b>${span.open ? esc(<@ t('card_now') | tojson @>) : fmtMin(b)}</b>`
                    : "";
                out.push(
                  `<i class="g-bar" style="left:${x(a)};width:${w(a, b)};top:${top - 2}px;--c:${c}" data-tip="${esc(this._tip(span.open ? "workNow" : "work", n, r, a, b, { trips }))}">${times}</i>`,
                );
                for (const [p, q] of trips)
                  if (q > p)
                    out.push(
                      `<i class="g-move" style="left:${x(p)};width:${w(p, q)};top:${top - 2}px" data-tip="${esc(this._tip("move", n, r, p, q, { appts: (span.appts || []).filter(([c, d]) => c < q && d > p) }))}"></i>`,
                    );
              }
              if (l.back)
                out.push(
                  `<i class="g-trip" style="left:${x(l.works.at(-1)[1])};width:${w(l.works.at(-1)[1], l.arr)};top:${top + 4}px;--c:${c}" data-tip="${esc(this._tip("back", n, r, l.works.at(-1)[1], l.arr, { appt: (l.works.at(-1).appts || []).some(([, d]) => d === l.works.at(-1)[1]) }))}"></i>`,
                );
              for (const ch of l.charges || [])
                out.push(
                  `<i class="g-chg" style="left:${x(ch.a)};width:${w(ch.a, ch.b)};top:${top}px" data-tip="${esc(this._tip("charge", n, r, ch.a, ch.b, ch.det))}"></i><i class="g-ic g-bolt" style="left:${x(ch.a)};top:${top - 4}px" data-tip="${esc(this._tip("charge", n, r, ch.a, ch.b, ch.det))}">${ICON_BOLT}</i>`,
                );
              if (l.arr !== null)
                out.push(
                  `<i class="g-home" style="left:${x(l.arr)};top:${top - 1}px;--c:${c}" data-tip="${esc(this._tip("home", n, r, l.arr))}"></i>`,
                );
              return out.join("");
            })
            .join("");
          return `<div class="g-row ${r.future ? "future" : ""}"><span class="g-day">${r.label}</span><div class="g-track" style="height:${LANE * (people.length + 1) + 6}px">${grid}${school}${lanes}</div></div>`;
        })
        .join("");
      const axis = `<div class="g-row axis"><span class="g-day"></span><div class="g-track">${ticks.map((m) => `<span class="tick" style="left:${x(m)}">${fmt(<@ t('card_hour_tick') | tojson @>, { h: m / 60 })}</span>`).join("")}</div></div>`;
      return `<div class="gantt">${axis}${body}</div>`;
    }
    _schoolMarks(ev) {
      return ev
        .filter((e) => e.kind === "drop_off" || e.kind === "pick_up")
        .map((e) => {
          const fam = familyOf(e.det.place);
          const family = !!fam;
          const street =
            e.det.place && !family
              ? ` (${e.det.place.replace(/\s*\(.*\)$/, "")})`
              : "";
          const v = {
            who: e.who.join(AND),
            children: this._cfg.children,
            day: DAYS_FULL[e.t.getDay()],
            time: fmtMin(minOfDay(e.t)),
            street,
            label: fam?.label,
          };
          const tip = family
            ? fmt(<@ t('card_tip_family') | tojson @>, v)
            : e.kind === "drop_off"
              ? fmt(<@ t('card_tip_drop_off') | tojson @>, v)
              : fmt(<@ t('card_tip_pick_up') | tojson @>, v);
          return { m: minOfDay(e.t), who: e.who, family, tip };
        });
    }
    // Bars under a timeline: hours at the office per person (an office icon in their colour), then one line with
    // the time at a Supercharger. avg = per-week averages for "Een gewone week".
    _totals(people, hours, charge, avg, extra = {}) {
      const per = avg
        ? <@ t('card_per_week_avg') | tojson @>
        : <@ t('card_per_week_this') | tojson @>;
      const rows = people
        .map((n) => {
          const t = hours[n] || 0;
          return `<div class="wt" data-tip="${esc(fmt(<@ t('card_tip_work_hours') | tojson @>, { n, duration: fmtDur(t), period: per }))}"><i class="g-ic wt-ic" style="color:${personColor(n)}">${ICON_OFFICE}</i><span class="wt-bar"><span style="width:${Math.min(100, (t / (45 * 60)) * 100)}%;background:${personColor(n)}"></span></span><b>${esc(fmt(<@ t('card_hours') | tojson @>, { h: Math.round(t / 60) }))}</b></div>`;
        })
        .join("");
      const sum = people.reduce((s, n) => s + (charge[n] || 0), 0);
      const who = people
        .filter((n) => charge[n] > 0)
        .map((n) => `${n} ${fmtDur(charge[n])}`)
        .join(", ");
      // Travel time door to door (school stops included), averaged per person over the week or the usual week.
      const trips = (extra.trips ? people : [])
        .filter((n) => extra.trips[n])
        .map((n) => {
          const t = extra.trips[n];
          const v = {
            n,
            there: Number.isFinite(t.there) ? fmtDur(t.there) : "–",
            back: Number.isFinite(t.back) ? fmtDur(t.back) : "–",
            period: avg
              ? <@ t('card_period_avg') | tojson @>
              : <@ t('card_period_week_avg') | tojson @>,
          };
          return `<div class="wt" data-tip="${esc(fmt(<@ t('card_tip_trips') | tojson @>, v))}"><i class="g-ic wt-ic" style="color:${personColor(n)}">${ICON_CAR}</i><span class="muted">${esc(fmt(<@ t('card_trip_line') | tojson @>, v))}</span></div>`;
        })
        .join("");
      const [top, topN, allPlaces] = topPlace(extra.charges || []);
      const where =
        top && top !== UNKNOWN_PLACE
          ? fmt(
              avg
                ? <@ t('card_where_usually') | tojson @>
                : <@ t('card_where') | tojson @>,
              { place: top.replace(/^Supercharger\s*/i, "") },
            )
          : "";
      const chgTip = fmt(
        avg
          ? <@ t('card_tip_charge_avg') | tojson @>
          : <@ t('card_tip_charge_week') | tojson @>,
        { who },
      );
      const chg =
        sum > 0
          ? `<div class="wt" data-tip="${esc(chgTip)}${allPlaces ? ` — ${esc(allPlaces)}` : ""}"><i class="g-ic wt-ic wt-bolt">${ICON_BOLT}</i><span class="muted">${esc(fmt(<@ t('card_charge_line') | tojson @>, { duration: fmtDur(sum) }))}${avg ? esc(<@ t('card_per_week') | tojson @>) : ""}${esc(where)}</span></div>`
          : "";
      return `<div class="wts">${rows}${trips}${chg}</div>`;
    }
    // The working day that is still open: the automation logs it only when it closes (at home, or 23:55), so until
    // then it is drawn from the helpers: arrival at work, departure from home, work trips so far; the end is now, or
    // the departure from work when the person left and is not home yet.
    _live() {
      const now = new Date();
      const st = (id) => this._hass?.states[id];
      const ts = (id) => Number(st(id)?.attributes?.timestamp) * 1000 || 0;
      const two = (v) => String(v).padStart(2, "0");
      return PRES.people.flatMap((p) => {
        const h = (k) => ts(`input_datetime.presence_${p.key}_${k}`);
        const arrived = h("arrived_at_work");
        if (!arrived || new Date(arrived).toDateString() !== now.toDateString()) return [];
        // At work = the person's state is the name of their work zone (zone states use the zone name).
        const workName = st(p.work)?.attributes?.friendly_name;
        const atWork = !!workName && st(p.person)?.state === workName;
        const left = h("left_work");
        const away = h("away_since");
        const trips = st(`input_text.presence_${p.key}_work_trips`)?.state;
        const det = { work_trips: trips && trips !== "unknown" ? trips : "", open: atWork ? "1" : "" };
        if (away && away < arrived) {
          const w = new Date(away);
          det.away = `${two(w.getDate())}/${two(w.getMonth() + 1)} ${two(w.getHours())}:${two(w.getMinutes())}`;
        }
        return [{ kind: "work", who: [p.name], t: new Date(arrived), end: atWork || left <= arrived ? now : new Date(left), det }];
      });
    }
    _weekCard(people) {
      const from = weekStart(new Date(), this._week);
      const all = [...this._data, ...this._live()];
      const model = dayModel(all);
      const hasEvents = (i) => {
        const d = new Date(from);
        d.setDate(d.getDate() + i - 1);
        return this._data.some((e) => e.t.toDateString() === d.toDateString());
      };
      // Mon–Fri always; Saturday and Sunday only in a week where something was logged then (e.g. a Supercharger stop).
      const rows = [1, 2, 3, 4, 5, ...[6, 7].filter(hasEvents)].map((i) => {
        const day = new Date(from);
        day.setDate(day.getDate() + i - 1);
        const ev = this._data.filter(
          (e) => e.t.toDateString() === day.toDateString(),
        );
        const lanes = {};
        for (const d of model)
          if (d.date.toDateString() === day.toDateString()) lanes[d.name] = d;
        return {
          label: `${DAYS[day.getDay()]}<small>${day.getDate()}/${day.getMonth() + 1}</small>`,
          wd: day.getDay(),
          school: this._schoolMarks(ev),
          lanes,
          future: day > new Date(),
        };
      });
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      const hours = {},
        charge = {};
      for (const d of workDays(all))
        if (d.t >= from && d.t < to)
          hours[d.name] = (hours[d.name] || 0) + d.total;
      for (const e of this._data)
        if (e.kind === "charge" && e.t >= from && e.t < to)
          for (const n of e.who)
            charge[n] = (charge[n] || 0) + (e.end - e.t) / 60000;
      const label =
        this._week === 0
          ? <@ t('card_this_week') | tojson @>
          : this._week === 1
            ? <@ t('card_last_week') | tojson @>
            : fmt(<@ t('card_week_of') | tojson @>, {
                date: `${from.getDate()}/${from.getMonth() + 1}`,
              });
      return `<div class="card"><span class="lbl"><span>${esc(label)}</span><span class="wnav"><button class="round sm" data-week="1" aria-label="${esc(<@ t('card_prev_week') | tojson @>)}">‹</button><button class="round sm" data-week="-1" aria-label="${esc(<@ t('card_next_week') | tojson @>)}" ${this._week === 0 ? "disabled" : ""}>›</button></span></span>
${this._gantt(rows, people)}
${this._totals(people, hours, charge, false, {
  trips: tripsOf(
    model.filter((d) => d.date >= from && d.date < to),
    people,
  ),
  charges: this._data.filter(
    (e) => e.kind === "charge" && e.t >= from && e.t < to,
  ),
})}</div>`;
    }
    // A usual week: per weekday the average departure, stay at work, Supercharger stop and arrival, over the last weeks.
    _avgCard(people) {
      const since = Date.now() - PRES.weeks * 7 * 86400000;
      const data = this._data.filter((e) => +e.t >= since);
      const model = dayModel(data);
      const runs = data.filter(
        (e) => e.kind === "drop_off" || e.kind === "pick_up",
      );
      // Weekend rows only when someone charged at a Supercharger on that weekday in the period.
      const weekend = [6, 0].filter((wd) =>
        model.some((d) => d.date.getDay() === wd && d.charges.length),
      );
      const rows = [1, 2, 3, 4, 5, ...weekend].map((wd) => {
        const lanes = {};
        for (const n of people) {
          const all = model.filter(
            (d) => d.name === n && d.date.getDay() === wd,
          );
          const ds = all.filter((d) => d.works.length);
          const ch = all.flatMap((d) => d.charges);
          if (!ds.length && !ch.length) continue;
          const lane = {
            dep: null,
            works: [],
            arr: null,
            back: false,
            charges: [],
          };
          if (ds.length) {
            const dep = avgOf(ds.map((d) => d.dep).filter((v) => v !== null));
            const s = avgOf(ds.map((d) => d.works[0][0])),
              e = avgOf(ds.map((d) => d.works.at(-1)[1]));
            const arr = avgOf(ds.filter((d) => d.back).map((d) => d.arr));
            Object.assign(lane, {
              dep: Number.isFinite(dep) ? dep : null,
              works: [[s, e]],
              arr: Number.isFinite(arr) ? arr : null,
              back: Number.isFinite(arr),
            });
          }
          if (ch.length) {
            const [top] = topPlace(ch.map((c) => c.ev));
            lane.charges = [
              {
                a: avgOf(ch.map((c) => c.a)),
                b: avgOf(ch.map((c) => c.b)),
                det: {
                  count: ch.length,
                  top: top !== UNKNOWN_PLACE ? top : null,
                },
              },
            ];
          }
          lanes[n] = lane;
        }
        // School: per run type the person who did it most often, at the average time.
        const school = [];
        const kinds = [
          [<@ t('card_avg_drop_off') | tojson @>, null, (e) => e.kind === "drop_off"],
          [
            <@ t('card_avg_pick_up') | tojson @>,
            null,
            (e) => e.kind === "pick_up" && !familyOf(e.det.place),
          ],
          ...PRES.family.map((f) => [
            <@ t('card_avg_family') | tojson @>,
            f,
            (e) => e.kind === "pick_up" && familyOf(e.det.place) === f,
          ]),
        ];
        for (const [text, fam, pick] of kinds) {
          const rs = runs.filter((e) => pick(e) && e.t.getDay() === wd);
          if (!rs.length) continue;
          const count = {};
          for (const e of rs)
            for (const n of e.who) count[n] = (count[n] || 0) + 1;
          const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
          const m = avgOf(rs.map((e) => minOfDay(e.t)));
          school.push({
            m,
            who: [top],
            family: !!fam,
            tip: fmt(text, {
              day: DAYS_FULL[wd],
              who: top,
              children: this._cfg.children,
              label: fam?.label,
              time: fmtMin(m),
              count: rs.length,
            }),
          });
        }
        return { label: DAYS[wd], wd, avg: true, school, lanes };
      });
      // Per-week averages: office hours over the weeks with at least one work day for that person; Supercharger time
      // over all weeks since the first logged event (at most PRES.weeks).
      const weeks = {};
      for (const d of workDays(data)) {
        const k = weekStart(d.t).toDateString();
        (weeks[d.name] ||= {})[k] = (weeks[d.name]?.[k] || 0) + d.total;
      }
      const hours = Object.fromEntries(
        people.map((n) => [n, avgOf(Object.values(weeks[n] || {})) || 0]),
      );
      const first = data.length ? data[0].t : new Date();
      const nWeeks = Math.max(
        1,
        Math.min(
          PRES.weeks,
          Math.ceil(
            (weekStart(new Date()) - weekStart(first)) / (7 * 86400000),
          ) + 1,
        ),
      );
      const charge = {};
      for (const e of data)
        if (e.kind === "charge")
          for (const n of e.who)
            charge[n] = (charge[n] || 0) + (e.end - e.t) / 60000 / nWeeks;
      const trips = tripsOf(model, people);
      return `<div class="card"><span class="lbl"><span>${esc(<@ t('card_usual_week') | tojson @>)}</span><span class="small muted">${esc(fmt(<@ t('card_avg_weeks') | tojson @>, { weeks: PRES.weeks }))}</span></span>
${this._gantt(rows, people)}
${this._totals(people, hours, charge, true, { trips, charges: data.filter((e) => e.kind === "charge") })}</div>`;
    }
  }
  const CSS = `
:host { display: block; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; text-align: left; }
button:focus-visible { outline: 2px solid ${C.sun}; outline-offset: 2px; }
.wrap { font-family: Figtree, system-ui, sans-serif; color: ${C.text}; background: ${C.bg}; min-height: calc(100vh - var(--header-height, 56px)); padding: 20px 16px 32px; }
.muted { color: ${C.muted}; }
.small { font-size: 13px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin: 0 auto 14px; max-width: 1100px; }
.hl { display: flex; flex-direction: column; gap: 4px; font-size: 14px; min-width: 0; }
.hl h1 { margin: 0; font-family: Caprasimo, Georgia, serif; font-weight: 400; font-size: clamp(26px, 8vw, 34px); line-height: 1.1; }
.card { background: ${C.card}; border-radius: 22px; padding: 16px; display: flex; flex-direction: column; gap: 10px; width: 100%; }
.lbl { display: flex; justify-content: space-between; align-items: center; font-size: 15px; color: ${C.muted}; }
.link { color: ${C.sun}; font-size: 15px; }
.round { width: 44px; height: 44px; border-radius: 99px; background: ${C.card}; display: flex; align-items: center; justify-content: center; flex: none; }
.who { display: inline-flex; align-items: center; gap: 6px; margin-right: 12px; white-space: nowrap; }
.who i, .pdot { width: 10px; height: 10px; border-radius: 99px; flex: none; display: inline-block; }
.pv .head { max-width: 1100px; align-items: center; }
.legend { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; font-size: 15px; }
.pcols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; max-width: 1100px; margin: 0 auto; align-items: start; }
@media (min-width: 900px) { .pcols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pfoot { max-width: 1100px; margin: 14px auto 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.pcols.one { grid-template-columns: minmax(0, 1fr) !important; margin-top: 14px; }
.lbl-ic { margin-right: 6px; vertical-align: -2px; }
.cl { display: flex; flex-direction: column; }
.cl-row { display: grid; grid-template-columns: 76px minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1.2fr); gap: 10px; align-items: center; padding: 9px 4px; border-top: 1px solid ${C.raised}; font-size: 14px; cursor: pointer; }
.cl-row:hover { background: ${C.raised}; border-radius: 10px; }
.cl-day { color: ${C.muted}; white-space: nowrap; }
.cl-day b { color: ${C.text}; }
.cl-place { display: flex; align-items: center; gap: 6px; font-weight: 700; min-width: 0; }
.cl-bat { position: relative; height: 18px; border-radius: 6px; background: ${C.bg}; overflow: hidden; }
.cl-bat-fill { position: absolute; top: 0; bottom: 0; background: ${C.batt}; opacity: .8; }
.cl-bat small { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: ${C.text}; text-shadow: 0 0 3px ${C.bg}; }
.cl-dur { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cl-dur-bar { height: 10px; border-radius: 99px; background: ${C.tesla}; min-width: 4px; }
.cl-dur b { white-space: nowrap; font-size: 13px; }
@media (max-width: 600px) { .cl-row { grid-template-columns: 64px minmax(0, 1fr); } .cl-bat, .cl-dur { grid-column: 2; } }
.sp-legend { display: inline-flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; color: ${C.muted}; }
.sp-lg { display: inline-flex; align-items: center; gap: 5px; }
.sp-lg i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.sp-person { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
.sp-name { font-weight: 700; font-size: 14px; }
.sp-row { display: flex; align-items: center; gap: 10px; }
.sp-wk { width: 76px; flex: none; font-size: 13px; color: ${C.muted}; }
.sp-bar { flex-grow: 1; display: flex; height: 16px; border-radius: 99px; overflow: hidden; background: ${C.bg}; gap: 2px; }
.sp-seg { height: 100%; min-width: 3px; cursor: pointer; }
.sp-seg.travel, .sp-lg i.travel { background: repeating-linear-gradient(90deg, ${C.muted} 0 4px, ${C.raised} 4px 7px) !important; }
.pv-foot { max-width: 1100px; margin: 0 auto; }
.tip { position: fixed; z-index: 10; max-width: min(320px, calc(100vw - 16px)); background: ${C.text}; color: ${C.bg}; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.35; font-weight: 600; box-shadow: 0 6px 18px rgba(0, 0, 0, .45); pointer-events: none; }
[data-tip] { cursor: pointer; }
.g-track i[data-tip]:hover { filter: brightness(1.25); }
.pfoot { align-items: flex-start; }
.lg { flex: 1 1 auto; min-width: 0; font-size: 13px; color: ${C.muted}; }
.lg summary { cursor: pointer; font-size: 14px; color: ${C.muted}; list-style: none; display: inline-flex; align-items: center; gap: 6px; }
.lg summary::-webkit-details-marker { display: none; }
.lg summary::before { content: "›"; display: inline-block; transition: transform .15s; }
.lg[open] summary::before { transform: rotate(90deg); }
.lg-grid { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 8px 0 6px; color: ${C.text}; }
.lg-item { display: inline-flex; align-items: center; gap: 6px; }
.lg-mark { width: 22px; height: 16px; display: inline-flex; align-items: center; justify-content: center; }
.lg-mark i { position: static; display: block; margin: 0; }
.lg-mark .g-bar, .lg-mark .g-trip { width: 20px; }
.gantt { display: flex; flex-direction: column; gap: 6px; }
.g-row { display: flex; align-items: stretch; gap: 8px; }
.g-row.future { opacity: .35; }
.g-day { width: 34px; flex: none; font-weight: 700; font-size: 14px; display: flex; flex-direction: column; justify-content: center; line-height: 1.1; }
.g-day small { font-weight: 400; font-size: 11px; color: ${C.muted}; }
.g-track { position: relative; flex-grow: 1; background: ${C.bg}; border-radius: 12px; min-width: 0; overflow: hidden; }
.g-row.axis .g-track { background: none; height: 16px; overflow: visible; }
.tick { position: absolute; top: 0; transform: translateX(-50%); font-size: 12px; color: ${C.muted}; }
.grid { position: absolute; top: 0; bottom: 0; width: 1px; background: ${C.raised}; }
.g-track i { position: absolute; display: block; }
.g-bar { height: 14px; border-radius: 99px; background: var(--c); min-width: 4px; display: flex !important; justify-content: space-between; align-items: center; padding: 0 6px; overflow: hidden; font-style: normal; }
.g-bar b { position: relative; z-index: 2; font-size: 10px; line-height: 1; font-weight: 700; color: ${C.bg}; white-space: nowrap; font-variant-numeric: tabular-nums;
  /* A line in the bar colour around the digits, so they stay readable on the hatched work trip. */
  -webkit-text-stroke: 2px var(--c); paint-order: stroke fill;
  text-shadow: 1px 0 0 var(--c), -1px 0 0 var(--c), 0 1px 0 var(--c), 0 -1px 0 var(--c); }
.g-move { height: 14px; background: repeating-linear-gradient(135deg, transparent 0 3px, ${C.bg} 3px 5px); opacity: .7; }
.lg-mark .g-move { width: 20px; background-color: var(--c); }
.g-trip { height: 2px; background: repeating-linear-gradient(90deg, var(--c) 0 4px, transparent 4px 7px); }
.g-chg { height: 10px; border-radius: 99px; background: ${C.tesla}; min-width: 6px; box-shadow: 0 0 0 2px ${C.bg}; }
.g-bolt { color: ${C.tesla}; width: 14px; height: 14px; margin-left: -10px; filter: drop-shadow(0 0 2px ${C.bg}); }
.g-bolt svg { width: 14px; height: 14px; }
.lg-mark .g-chg { width: 20px; }
.wt-ic { position: static; width: 16px; height: 16px; display: inline-block; flex: none; }
.wt-ic svg { width: 16px; height: 16px; display: block; }
.wt-bolt { color: ${C.tesla}; }
.g-gap { height: 2px; background: var(--c); opacity: .35; }
.g-home { width: 12px; height: 12px; margin-left: -6px; border-radius: 99px; border: 3px solid var(--c); background: ${C.bg}; box-sizing: border-box; }
.g-ic { width: 16px; height: 16px; margin-left: -8px; }
.g-ic svg { display: block; width: 16px; height: 16px; }
.wts { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
.wt { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.wt-bar { flex-grow: 1; height: 8px; border-radius: 99px; background: ${C.bg}; overflow: hidden; display: flex; }
.wt-bar span { height: 100%; border-radius: 99px; }
.wt b { width: 40px; text-align: right; }
.wnav { display: inline-flex; gap: 6px; }
.round.sm { width: 34px; height: 34px; background: ${C.bg}; color: ${C.text}; font-size: 18px; justify-content: center; }
.round.sm:disabled { opacity: .35; cursor: default; }
`;
  if (!customElements.get("presence-card"))
    customElements.define("presence-card", PresenceCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "presence-card",
    name: <@ t('view_title') | tojson @>,
    description: fmt(<@ t('card_description') | tojson @>, { version: VERSION }),
  });
})();

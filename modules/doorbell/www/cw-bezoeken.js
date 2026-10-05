// custom:cw-bezoeken: doorbell visits of the last N days, with photo (module doorbell, see LOGIC.md).
// Source: a Local Calendar with one event per ring / parcel, written by the doorbell automations. The event
// description ends with "photo: doorbell/archive/<file>.jpg" ("foto:" in Dutch and in older events); the photo is
// resolved to a signed /media URL. Photos older than 31 days are deleted by the doorbell archive sensor, so older
// rows show an empty thumbnail.
// Texts: filled in by tools/fill.py from doorbell/strings.yaml in house.language.
// Config (all optional):
//   calendar: calendar.doorbell          the Local Calendar of the doorbell visits
//   visit:    input_text.doorbell_visit  helper written after each visit; its change triggers a reload
//                                        (the old key 'bezoek' still works)
//   days: 31, limit: 8                   period and number of rows before "Show all N"
(() => {
  const VERSION = "3";
  const STRINGS = <@ {
    'locale': t('card_locale'), 'today': t('card_today'), 'visit': t('card_visit'), 'error': t('card_error'),
    'show_all': t('card_show_all'), 'empty': t('card_empty'), 'parcel': t('card_parcel_regex'),
    'name': t('card_name'), 'description': t('card_description')
  } | tojson @>;
  const PARCEL = new RegExp(STRINGS.parcel, "i");
  const CSS = `
:host { display: block; font-family: Figtree, system-ui, sans-serif; color: var(--cw-text, var(--primary-text-color, #F5EAD8)); }
.list { display: grid; gap: 6px; }
.row { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 72px 1fr; gap: 10px; align-items: center;
  padding: 6px; border-radius: 16px; background: var(--cw-card, var(--card-background-color, #2a2622)); min-height: 60px; }
.row:hover { filter: brightness(1.06); }
.row:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); outline-offset: 2px; }
.thumb { width: 72px; height: 54px; border-radius: 12px; object-fit: cover; background: var(--cw-raised, var(--secondary-background-color, #3a3530)); display: block; }
.txt { min-width: 0; display: grid; gap: 2px; }
.top { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
.what { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.parcel .what { color: var(--cw-warn, var(--warning-color, #E8B04A)); }
.when { font-size: 13px; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); white-space: nowrap; margin-left: auto; }
.sentence { font-size: 13px; line-height: 1.3; color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.empty { padding: 14px; border-radius: 16px; background: var(--cw-card, var(--card-background-color, #2a2622)); color: var(--cw-muted, var(--secondary-text-color, #BFB3A1)); font-size: 14px; }
.more { all: unset; cursor: pointer; justify-self: center; padding: 10px 16px; min-height: 44px; box-sizing: border-box; border-radius: 999px; font-size: 14px; font-weight: 600;
  color: var(--cw-accent, var(--primary-color, #D67F48)); }
.more:focus-visible { outline: 2px solid var(--cw-accent, var(--primary-color, #D67F48)); }
.large { position: fixed; inset: 0; z-index: 9999; background: rgba(20, 17, 14, .86); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 16px; cursor: zoom-out; }
.large img { max-width: min(100%, 1100px); max-height: 78vh; border-radius: 16px; }
.large p { margin: 0; max-width: 1100px; color: #F5EAD8; font-size: 15px; text-align: center; }
`;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const when = (d) => {
    const today = new Date().toDateString() === d.toDateString();
    const hm = d.toLocaleTimeString(STRINGS.locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return today
      ? `${STRINGS.today} ${hm}`
      : `${d.toLocaleDateString(STRINGS.locale, { weekday: "short", day: "numeric", month: "short" })} ${hm}`;
  };

  class CwVisits extends HTMLElement {
    setConfig(config) {
      this._cfg = {
        calendar: "calendar.doorbell",
        days: 31,
        limit: 8,
        ...config,
      };
      this._cfg.visit = config.visit || config.bezoek || "input_text.doorbell_visit";
      this._all = false;
    }
    getCardSize() {
      return 4;
    }
    getGridOptions() {
      return { columns: "full" };
    }
    set hass(hass) {
      this._hass = hass;
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      // Reload when a visit was just logged (the automations write the 'visit' helper) or every 10 min.
      const sig = hass.states[this._cfg.visit]?.last_updated;
      const stale = !this._at || Date.now() - this._at > 600000;
      if (sig !== this._sig || stale) {
        const first = this._sig === undefined;
        this._sig = sig;
        this._at = Date.now();
        clearTimeout(this._t);
        // The calendar event is written a moment after the helper: wait a little before reading.
        this._t = setTimeout(() => this._load(), first ? 0 : 4000);
      }
    }
    async _load() {
      const h = this._hass;
      if (!h) return;
      const end = new Date(Date.now() + 3600000);
      const start = new Date(Date.now() - this._cfg.days * 86400000);
      try {
        const evs = await h.callApi(
          "GET",
          `calendars/${this._cfg.calendar}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
        );
        this._items = evs
          .map((e) => {
            const desc = e.description || "";
            const m = desc.match(/(?:photo|foto):\s*(\S+\.jpg)/);
            return {
              start: new Date(e.start.dateTime || e.start.date),
              what: e.summary || STRINGS.visit,
              sentence: desc.replace(/\n?(?:photo|foto):\s*\S+/, "").trim(),
              photo: m ? m[1] : "",
            };
          })
          .sort((a, b) => b.start - a.start);
        await Promise.all(
          this._items.map(async (it) => {
            if (!it.photo || this._urls?.[it.photo]) return;
            try {
              const r = await h.callWS({
                type: "media_source/resolve_media",
                media_content_id: `media-source://media_source/local/${it.photo}`,
                expires: 3600,
              });
              (this._urls ||= {})[it.photo] = r.url;
            } catch (_) {
              /* photo deleted (older than 31 days) or not written: show the empty thumbnail */
            }
          }),
        );
        this._err = "";
      } catch (e) {
        this._err = STRINGS.error;
      }
      this._render();
    }
    _render() {
      const items = this._items || [];
      const shown = this._all ? items : items.slice(0, this._cfg.limit);
      const rows = shown
        .map((it, i) => {
          const url = this._urls?.[it.photo] || "";
          const label = `${it.what}, ${when(it.start)}${it.sentence ? `. ${it.sentence}` : ""}`;
          return `<button class="row${PARCEL.test(it.what) ? " parcel" : ""}" data-i="${i}" aria-label="${esc(label)}">${
            url
              ? `<img class="thumb" alt="" loading="lazy" src="${esc(url)}">`
              : `<span class="thumb" aria-hidden="true"></span>`
          }<span class="txt"><span class="top"><span class="what">${esc(it.what)}</span><span class="when">${esc(when(it.start))}</span></span>${
            it.sentence ? `<span class="sentence">${esc(it.sentence)}</span>` : ""
          }</span></button>`;
        })
        .join("");
      const more =
        !this._all && items.length > shown.length
          ? `<button class="more" data-more>${esc(STRINGS.show_all.replace("{n}", items.length))}</button>`
          : "";
      this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="list" role="list">${
        this._err
          ? `<div class="empty">${esc(this._err)}</div>`
          : rows ||
            `<div class="empty">${esc(STRINGS.empty.replace("{days}", this._cfg.days))}</div>`
      }${more}</div>`;
      this.shadowRoot
        .querySelector("[data-more]")
        ?.addEventListener("click", () => {
          this._all = true;
          this._render();
        });
      this.shadowRoot
        .querySelectorAll(".row")
        .forEach((b) =>
          b.addEventListener("click", () => this._open(shown[+b.dataset.i])),
        );
    }
    // Enlarged photo + sentence; tap or Escape closes. Own overlay: the shared info sheet refreshes its image with an
    // extra query parameter, which breaks a signed /media URL.
    _open(it) {
      const url = this._urls?.[it.photo];
      if (!url) return;
      const d = document.createElement("div");
      d.className = "large";
      d.setAttribute("role", "dialog");
      d.setAttribute("aria-label", it.what);
      d.tabIndex = -1;
      d.innerHTML = `<img alt="${esc(it.sentence || it.what)}" src="${esc(url)}"><p><b>${esc(it.what)}</b> · ${esc(when(it.start))}${it.sentence ? `<br>${esc(it.sentence)}` : ""}</p>`;
      const close = () => {
        d.remove();
        document.removeEventListener("keydown", onKey);
      };
      const onKey = (ev) => ev.key === "Escape" && close();
      d.addEventListener("click", close);
      document.addEventListener("keydown", onKey);
      this.shadowRoot.appendChild(d);
      d.focus();
    }
  }
  customElements.get("cw-bezoeken") ||
    customElements.define("cw-bezoeken", CwVisits);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "cw-bezoeken",
    name: STRINGS.name,
    description: STRINGS.description.replace("{version}", VERSION),
  });
})();

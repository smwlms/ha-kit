// custom:connection-watchdog-card (ha-kit module connection-watchdog, see connection-watchdog/LOGIC.md).
// Reads sensor.connection_watchdog (attribute sources) and shows, in one ha-card:
//   - Problems: per broken source what stops working, since when, how far the reloads got, what to do, with a
//     Reload button per config entry (homeassistant.reload_config_entry) and a link to the integration page;
//   - All sources: one row per source with its status and since when.
// Config (rendered by tools/fill.py from lovelace/connections.yaml): { entity, strings }. The card has no entity id
// and no text of its own: every text comes from strings.yaml through the config.
(() => {
  const VERSION = "1-<@ t('language_code') @>";
  const CSS = `
:host { display: block; }
ha-card { overflow: hidden; padding: 4px 0 8px; }
h2 { margin: 0; padding: 12px 16px 4px; font-size: 16px; font-weight: 600; color: var(--primary-text-color); }
.problem { padding: 8px 16px 12px; border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, .12)); color: var(--primary-text-color); }
.problem:last-of-type { border-bottom: none; }
.problem p { margin: 4px 0; line-height: 1.4; }
.problem small { color: var(--secondary-text-color); }
.head { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.ok-line { display: flex; align-items: center; gap: 6px; padding: 4px 16px 8px; color: var(--primary-text-color); }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
button { font: inherit; font-size: 14px; min-height: 36px; padding: 0 14px; border-radius: 18px; cursor: pointer;
  border: 1px solid var(--divider-color, rgba(0, 0, 0, .2)); background: transparent; color: var(--primary-text-color); }
button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; color: var(--primary-text-color); }
th, td { padding: 8px 16px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, .12)); overflow-wrap: anywhere; }
th { font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
tr:last-child td { border-bottom: none; }
/* Status and time never break inside a word; the name takes the rest of the width (narrow phone included). */
th:first-child, td:first-child { width: 100%; }
td:nth-child(2), td:nth-child(3), th:nth-child(2), th:nth-child(3) { white-space: nowrap; }
.status { display: inline-flex; align-items: center; gap: 4px; }
ha-icon { --mdc-icon-size: 18px; flex: none; }
/* Theme tokens of the module base (contrast >= 4.5:1 per theme), else Home Assistant's own colours. */
.good { color: var(--cw-good, var(--success-color, #2e7d32)); }
.bad { color: var(--cw-bad, var(--error-color, #b3261e)); }
`;
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (text, values) => String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

  class ConnectionWatchdogCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._key = "";
    }
    setConfig(config) {
      if (!config || typeof config.entity !== "string" || typeof config.strings !== "object")
        throw new Error("connection-watchdog-card: entity and strings are rendered by ha-kit (tools/fill.py): paste connection-watchdog/lovelace/connections.yaml");
      this._cfg = config;
      this._S = config.strings;
      this._key = "";
      this._draw();
    }
    set hass(hass) {
      this._hass = hass;
      this._draw();
    }
    getCardSize() {
      return 4;
    }
    t(key, values = {}) {
      return fmt(this._S[key] ?? key, values);
    }
    _when(iso) {
      const d = new Date(iso);
      if (isNaN(d)) return "";
      return d.toLocaleString(this._S.locale || undefined, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    _status(s) {
      return this._S[`status_${s}`] || s;
    }
    _draw() {
      if (!this._cfg || !this._hass) return;
      const st = this._hass.states[this._cfg.entity];
      // Redraw only when the sensor changed: a click on a button must not be lost to a redraw.
      const key = st ? st.last_updated : "none";
      if (key === this._key) return;
      this._key = key;
      if (!st) {
        this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card><p class="ok-line">${esc(this.t("card_no_sensor"))}</p></ha-card>`;
        return;
      }
      const sources = Array.isArray(st.attributes.sources) ? st.attributes.sources : [];
      const down = sources.filter((x) => x.status !== "ok");
      const icon = (ok) => `<ha-icon class="${ok ? "good" : "bad"}" icon="${ok ? "mdi:check-circle" : "mdi:alert-circle"}"></ha-icon>`;
      const problems = down.length
        ? down.map((x) => this._problem(x, icon(false))).join("")
        : `<div class="ok-line">${icon(true)}<span>${esc(this.t("card_all_ok", { n: sources.length }))}</span></div>`;
      // Broken sources first, then the rest in the order of house.yaml.
      const rows = [...down, ...sources.filter((x) => x.status === "ok")]
        .map((x) => `<tr><td>${esc(x.name)}</td><td><span class="status">${icon(x.status === "ok")}${esc(this._status(x.status))}</span></td><td>${esc(this._when(x.since))}</td></tr>`)
        .join("");
      this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card>
        <h2>${esc(this.t("card_problems"))}</h2>${problems}
        <h2>${esc(this.t("card_all"))}</h2>
        <table><thead><tr><th>${esc(this.t("col_source"))}</th><th>${esc(this.t("col_status"))}</th><th>${esc(this.t("col_since"))}</th></tr></thead><tbody>${rows}</tbody></table>
      </ha-card>`;
      this.shadowRoot.querySelectorAll("button[data-entry]").forEach((b) =>
        b.addEventListener("click", () => this._hass.callService("homeassistant", "reload_config_entry", { entry_id: b.dataset.entry })),
      );
      this.shadowRoot.querySelectorAll("button[data-domain]").forEach((b) =>
        b.addEventListener("click", () => {
          history.pushState(null, "", `/config/integrations/integration/${encodeURIComponent(b.dataset.domain)}`);
          window.dispatchEvent(new CustomEvent("location-changed"));
        }),
      );
    }
    _problem(x, icon) {
      const entries = Array.isArray(x.entries) ? x.entries : [];
      let reloads = "";
      if (x.reloadable && entries.length)
        reloads = this.t(x.attempts >= x.max ? "card_reloads_done" : "card_reloads", { n: x.attempts, max: x.max });
      else if (entries.length) reloads = this.t("card_retrying");
      const line = [reloads, x.notified ? this.t("card_notified") : ""].filter(Boolean).join(" ");
      const buttons = entries.map(
        (e, i) => `<button data-entry="${esc(e)}">${esc(this.t("card_reload"))}${entries.length > 1 ? ` ${i + 1}/${entries.length}` : ""}</button>`,
      );
      if (x.domain) buttons.push(`<button data-domain="${esc(x.domain)}">${esc(this.t("card_integration"))}</button>`);
      return `<div class="problem">
        <div class="head">${icon}<span>${esc(x.name)} · ${esc(this._status(x.status))} · ${esc(this._when(x.since))}</span></div>
        ${x.impact ? `<p>${esc(x.impact)}</p>` : ""}
        ${line ? `<p>${esc(line)}</p>` : ""}
        <p><b>${esc(this.t("card_do"))}</b> ${esc(x.action)}</p>
        ${x.reason ? `<p><small>${esc(x.reason)}</small></p>` : ""}
        ${buttons.length ? `<div class="buttons">${buttons.join("")}</div>` : ""}
      </div>`;
    }
  }

  if (!customElements.get("connection-watchdog-card")) customElements.define("connection-watchdog-card", ConnectionWatchdogCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "connection-watchdog-card",
    name: "Connection watchdog",
    description: `${<@ t('card_description') | tojson @>} v${VERSION}`,
  });
})();

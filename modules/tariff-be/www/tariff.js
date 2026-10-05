// Tariff (Belgium): window.haKitTariff for the analysis screens (ha-kit module tariff-be, see tariff-be/LOGIC.md).
// Same formula and coefficients as custom_templates/tariff.jinja, rendered from house.yaml (tariff:) by tools/fill.py.
// Uploaded by tariff-be/deploy.py to /config/www/ha-kit/tariff/tariff.js and registered as dashboard resource
// /local/ha-kit/tariff/tariff.js. Do not edit it in Home Assistant: edit house.yaml and deploy again.
//
//   haKitTariff.importPrice(spotEurPerMwh, date[, hass])  all-in import price in EUR/kWh
//   haKitTariff.exportPrice(spotEurPerMwh, date)          export price in EUR/kWh (may be negative)
//   haKitTariff.isNight(date)                             true in the night register (house time zone)
//   haKitTariff.area, haKitTariff.currency
// `date` is a Date, epoch milliseconds or an ISO string. Without `hass` the grid fees and levies are the start
// values from house.yaml; with `hass` the current helpers (input_number.tariff_*) are used, as the sensors do.
(() => {
  const VERSION = "1";
  const C = {
    importFactor: <@ tariff['import'].factor | float | tojson @>,
    importMarkup: <@ tariff['import'].markup | float | tojson @>, // c€/kWh
    vat: <@ tariff['import'].vat | float | tojson @>,
    exportFactor: <@ tariff['export'].factor | float | tojson @>,
    exportDeduction: <@ tariff['export'].deduction | float | tojson @>, // c€/kWh
    gridDay: <@ tariff.grid.day | float | tojson @>, // c€/kWh incl. VAT, start value of input_number.tariff_grid_fee_day
    gridNight: <@ tariff.grid.night | float | tojson @>, // start value of input_number.tariff_grid_fee_night
    levies: <@ tariff.grid.levies | float | tojson @>, // start value of input_number.tariff_levies
    nightStart: <@ tariff.night.start | int | tojson @>, // hour
    nightEnd: <@ tariff.night.end | int | tojson @>, // hour
    nightWeekend: <@ 'true' if tariff.night.get('weekend') else 'false' @>,
    capacityEurPerKwYear: <@ tariff.capacity.eur_per_kw_year | float | tojson @>,
    capacityMinimumKw: <@ tariff.capacity.minimum_kw | float | tojson @>,
  };
  const TIME_ZONE = <@ house.timezone | tojson @>;
  const HELPERS = {
    gridDay: "input_number.tariff_grid_fee_day",
    gridNight: "input_number.tariff_grid_fee_night",
    levies: "input_number.tariff_levies",
    capacityEurPerKwYear: "input_number.tariff_capacity_eur_per_kw_year",
  };
  const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const toDate = (date) => (date instanceof Date ? date : new Date(date));
  const round4 = (v) => Math.round(v * 10000) / 10000;

  // Hour (0-23) and weekday (0 = Sunday) in the house time zone, not the browser's.
  function local(date) {
    const p = Object.fromEntries(parts.formatToParts(toDate(date)).map((x) => [x.type, x.value]));
    return { hour: Number(p.hour), weekday: WEEKDAY[p.weekday] };
  }

  function isNight(date) {
    const { hour, weekday } = local(date);
    const inHours =
      C.nightStart > C.nightEnd
        ? hour >= C.nightStart || hour < C.nightEnd
        : hour >= C.nightStart && hour < C.nightEnd;
    return inHours || (C.nightWeekend && (weekday === 0 || weekday === 6));
  }

  // Grid fees and levies: the live helpers when hass is given, else the start values from house.yaml.
  function coefficients(hass) {
    const out = { ...C };
    for (const [key, id] of Object.entries(HELPERS)) {
      const v = parseFloat(hass?.states?.[id]?.state);
      if (Number.isFinite(v)) out[key] = v;
    }
    return out;
  }

  function importPrice(spotEurPerMwh, date, hass) {
    const c = hass ? coefficients(hass) : C;
    const energy = (c.importFactor * (spotEurPerMwh / 10) + c.importMarkup) * c.vat;
    return round4((energy + c.levies + (isNight(date) ? c.gridNight : c.gridDay)) / 100);
  }

  function exportPrice(spotEurPerMwh, date) {
    return round4((C.exportFactor * (spotEurPerMwh / 10) - C.exportDeduction) / 100);
  }

  window.haKitTariff = {
    VERSION,
    importPrice,
    exportPrice,
    isNight,
    coefficients,
    area: <@ tariff.area | string | tojson @>,
    currency: "EUR",
    timeZone: TIME_ZONE,
  };
})();

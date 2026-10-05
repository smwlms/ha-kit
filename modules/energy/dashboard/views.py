"""The views of the two energy dashboards, built from dashboard/config.json (rendered from house.yaml by fill.py).

- dashboard energy-analysis: period, power, tariff, consumers, trends, battery. A view whose role or provider module is
  missing is left out (tariff: a module that provides `tariff`; battery: entities.battery_soc); inside a view every
  section and card follows the same rule (phases, charger, heat pump, ventilation, consumers, capacity tariff ...).
- dashboard energy-screen: view energy (custom:energy-screen-card, panel) and view flows (energy flows per day).
The data generators of the charts live in www/analysis/*.js (window.haKitEnergy.<topic>) and www/energy-flows.js.
"""
from __future__ import annotations

import json
from datetime import date

from style import CHART, CONSUMER_TONES, PHASES, Style, group, heading, hline, note, page_header, pill, section, stats, \
    status_row

NO_HEADER = {"in_header": False, "legend_value": False}
IN_HEADER = {"in_header": True, "in_chart": False, "legend_value": False}


class Views:
    def __init__(self, cfg: dict) -> None:
        self.cfg = cfg
        self.a = cfg["analysis"]
        self.ids = self.a["ids"]
        self.f = cfg["features"]
        self.s = Style(cfg["strings"], self.a["locale"])
        self.t = self.s.t
        self.loc = json.dumps(self.a["locale"])
        # Jinja filter for the decimal comma of the locale (numbers in markdown notes).
        self.dec = " | string | replace('.', ',')" if self.a["locale"].startswith(("nl", "de", "fr")) else ""
        start = self.a.get("analysis_from") or ""
        try:
            self.since = date.fromisoformat(start)
        except ValueError:
            self.since = None

    # ---- helpers ----
    def span_days(self, default: int, cap: int = 760) -> str:
        """graph_span in days: from energy.analysis_from (at most `cap` days), else `default`."""
        if not self.since:
            return f"{default}d"
        return f"{min(max((date.today() - self.since).days + 1, 14), cap)}d"

    def registers(self, ids: list[str], base: str, colors: list[str]) -> list[tuple]:
        """Names for the registers of one meter: day/night for two, a number for more."""
        if len(ids) == 2:
            names = [self.t(f"an_{base}_day"), self.t(f"an_{base}_night")]
        elif len(ids) == 1:
            names = [self.t(f"an_{base}")]
        else:
            names = [f"{self.t(f'an_{base}')} {i + 1}" for i in range(len(ids))]
        return [(e, n, colors[i % len(colors)]) for i, (e, n) in enumerate(zip(ids, names))]

    def consumers(self) -> list[dict]:
        """The measured consumers of the analysis (same keys as window.haKitEnergy.consumers.list)."""
        out = []
        if self.ids.get("charger_w") or self.ids.get("charger_kwh"):
            out.append({"key": "car", "name": self.t("an_car"), "color": CHART["car"], "power": self.ids.get("charger_w")})
        if self.ids.get("hp_kwh") or self.ids.get("hp_w"):
            out.append({"key": "heat_pump", "name": self.t("an_heat_pump"), "color": CHART["heat_pump"],
                        "power": self.ids.get("hp_w") or self.ids.get("hp_state")})
        if self.ids.get("vent_w"):
            out.append({"key": "ventilation", "name": self.t("an_ventilation"), "color": CHART["ventilation"],
                        "power": self.ids["vent_w"]})
        for i, c in enumerate(self.a.get("consumers") or []):
            out.append({"key": c["key"], "name": c["name"], "color": CONSUMER_TONES[i % len(CONSUMER_TONES)],
                        "power": c.get("power")})
        return out

    # ---- view: period (HA energy cards, one date picker) ----
    def period(self) -> list[dict]:
        full = {"columns": "full"}
        gauges = []
        if self.f["solar"] or self.f["battery"]:
            gauges.append("energy-self-sufficiency-gauge")
        if self.f["solar"]:
            gauges += ["energy-solar-consumed-gauge", "energy-grid-neutrality-gauge"]
        if self.f["co2"]:
            gauges.append("energy-carbon-consumed-gauge")
        out = [
            section([{"type": "energy-date-selection", "grid_options": full}]),
            group(self.t("an_flows"), [{"type": "energy-distribution", "grid_options": full}], "mdi:transit-connection-variant", 1),
            group(self.t("an_course"), [{"type": "energy-usage-graph", "grid_options": full}], "mdi:chart-bar", 2),
        ]
        cards = []
        if gauges:
            cards += group(self.t("an_self_sufficient"), [{"type": g, "grid_options": {"columns": 6}} for g in gauges], "mdi:gauge")["cards"]
        if self.f["solar"]:
            cards += group(self.t("an_solar"), [{"type": "energy-solar-graph", "grid_options": full}], "mdi:solar-power-variant")["cards"]
        if cards:
            out.append(section(cards, 2))
        out += [
            group(self.t("an_costs"), [{"type": "energy-sources-table", "grid_options": full}], "mdi:currency-eur", 1),
            group(self.t("an_per_device"), [{"type": "energy-devices-detail-graph", "grid_options": {"columns": 24}},
                                            {"type": "energy-devices-graph", "grid_options": {"columns": 12}}], "mdi:chart-bar", 3),
        ]
        return out

    # ---- view: power (base load, phases, month peak, peaks above the target, cause) ----
    def night_tooltip(self) -> str:
        return ("EVAL:function(t){var d=new Date(t),p=new Date(d.getFullYear(),d.getMonth(),d.getDate()-1),"
                "o={day:'numeric',month:'numeric'};return '%s '+p.toLocaleDateString(%s,o)+' → '+d.toLocaleDateString(%s,o)}"
                % (self.t("an_night"), self.loc, self.loc))

    def power(self) -> list[dict]:
        s, t, ids, f = self.s, self.t, self.ids, self.f
        out = []
        chips = []
        if ids.get("month_peak"):
            chips.append({"icon": "piek", "entity": ids["month_peak"], "label": t("an_chip_month_peak"), "title": t("an_month_peak"),
                          "info": t("an_month_peak_info")})
        if ids.get("quarter"):
            chips.append({"icon": "klok", "entity": ids["quarter"], "label": t("an_chip_quarter"), "title": t("an_quarter"),
                          "info": t("an_quarter_info")})
        if f["tariff"]:
            chips.append({"icon": "lagen", "entity": "sensor.capacity_average_peak_kw", "label": t("an_chip_average_peak"),
                          "title": t("an_average_peak"), "info": t("an_average_peak_info")})
        if chips:
            out.append(section([status_row(chips)]))
        # Base load
        eur_tip = ("EVAL:function(v){if(v==null||isNaN(v))return '';var a=window.haKitEnergy&&window.haKitEnergy.baseLoad,"
                   "p=a&&a.price,s=%s+' kW';if(p)s+=' · ≈ € '+Math.round(v*8760*p).toLocaleString(%s)+' %s';return s}"
                   % (s.num(2), self.loc, t("an_per_year")))
        span = self.span_days(730)
        night = s.chart(t("an_per_night"), "baseLoad", [
            {"fn": "night", "name": t("an_per_night"), "color": CHART["grey"], "type": "line", "stroke_width": 1, "curve": "straight"},
            {"fn": "rolling", "name": t("an_median_30"), "color": CHART["battery"], "type": "area", "stroke_width": 2,
             "opacity": 0.15, "curve": "monotoneCubic"}],
            kind="mixed", x="month", graph_span=span, span={"end": "day"}, unit="kW", decimals=1,
            yaxis=[{"min": 0, "forceNiceScale": True}], tooltip_y=s.fmt("kW", 2), update_interval="1h",
            extra_apex={"tooltip": {"x": {"formatter": self.night_tooltip()}}})
        month_items = [{"fn": "month", "name": t("an_house_without_car" if f["charger"] else "an_house"), "color": CHART["battery"], "show": NO_HEADER},
                       {"fn": "costPerYear", "opts": {"out": "kw", "nights": 30}, "name": t("an_average"), "color": CHART["battery"],
                        "unit": "kW", "float_precision": 2, "show": IN_HEADER}]
        if f["tariff"]:
            month_items.append({"fn": "costPerYear", "opts": {"nights": 30}, "name": t("an_per_year"), "color": CHART["grid"],
                                "unit": "€", "float_precision": 0, "show": IN_HEADER})
        month = s.chart(t("an_per_month"), "baseLoad", month_items, kind="column", x="month", graph_span=span, span={"end": "day"},
                        unit="kW", decimals=1, yaxis=[{"min": 0}], tooltip_y=eur_tip, update_interval="1h",
                        column_width="70%", show_states=True)
        out.append(section([heading(t("an_base_load"), "mdi:weather-night"), night, month]))
        # Per phase and ventilation
        phase_cards = []
        n = len(ids.get("phases") or [])
        if n:
            phase_cards.append(s.chart(t("an_per_phase"), "baseLoad",
                                       [{"fn": "phase", "opts": {"phase": k + 1}, "name": f"L{k + 1}", "color": PHASES[k % 4]} for k in range(n)],
                                       kind="column", x="day", graph_span="90d", span={"end": "day"}, stacked=True, unit="W",
                                       decimals=0, yaxis=[{"min": 0}], update_interval="1h",
                                       extra_apex={"tooltip": {"x": {"formatter": self.night_tooltip()}}}))
        if ids.get("vent_w"):
            phase_cards.append(s.chart(t("an_ventilation"), "baseLoad", [
                {"fn": "ventilation", "opts": {"series": "ventilation"}, "name": t("an_ventilation"), "color": CHART["ventilation"]},
                {"fn": "ventilation", "opts": {"series": "rest"}, "name": t("an_rest"), "color": CHART["rest"]}],
                kind="column", x="day", graph_span="90d", span={"end": "day"}, stacked=True, unit="W", decimals=0,
                yaxis=[{"min": 0}], update_interval="1h", extra_apex={"tooltip": {"x": {"formatter": self.night_tooltip()}}}))
        if phase_cards:
            out.append(section([heading(t("an_per_phase") if n else t("an_ventilation"), "mdi:fuse")] + phase_cards))
        # Month peak
        target = float(self.a.get("peak_target_kw") or 3)
        floor = float(self.a.get("capacity_minimum_kw") or 0)
        target_line = hline(target, t("an_target", kw=s_num(target, self.a["locale"])), CHART["good"])
        lines = [target_line] + ([hline(floor, t("an_floor", kw=s_num(floor, self.a["locale"])), CHART["grey"], left=True)] if floor else [])
        info = "(window.haKitEnergy&&window.haKitEnergy.peak&&window.haKitEnergy.peak.info)||{}"
        kw2 = "function(x){return x.toLocaleString(%s,{minimumFractionDigits:2,maximumFractionDigits:2})+' kW'}" % self.loc
        month_tip = ("EVAL:function(t){var d=new Date(t),I=%s;var k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');"
                     "var s=(I.month||{})[k];return d.toLocaleDateString(%s,{month:'long',year:'numeric'})+(s?' · '+s:'')}" % (info, self.loc))
        month_y = ("EVAL:function(v,o){var s=o.w.globals.series,j=o.dataPointIndex,f=%s;"
                   "if(o.seriesIndex===0)return f(v||0);return v?f(s[0][j]+v):'–'}" % kw2)
        mp_items = [{"fn": "monthPeak", "opts": {"source": "hour"}, "name": t("an_lower_bound"), "color": CHART["house"], "show": NO_HEADER},
                    {"fn": "monthPeak", "opts": {"source": "meter"}, "name": t("an_meter"), "color": CHART["grid"], "show": NO_HEADER}]
        if f["tariff"]:
            mp_items.append({"fn": "monthPeak", "opts": {"source": "year_cost"}, "name": t("an_capacity_tariff"), "color": CHART["grey"],
                             "unit": " €/" + t("an_year_short"), "float_precision": 0, "show": IN_HEADER})
        peak_cards = [heading(t("an_month_peak"), "mdi:speedometer"),
                      s.chart(t("an_per_month"), "peak", mp_items, kind="column", x="month", graph_span=self.span_days(760), span={"end": "month"},
                              stacked=True, unit="kW", decimals=0, yaxis=[{"min": 0, "forceNiceScale": True}], height=270,
                              update_interval="30min", tooltip_y=month_y, annotations={"yaxis": lines}, column_width="70%",
                              extra_apex={"tooltip": {"x": {"formatter": month_tip}}, "xaxis": {"tickAmount": 12}},
                              show_states=f["tariff"])]
        if f["tariff"]:
            kw_axis = ("EVAL:function(v,t){var d=new Date(t);var m=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();"
                       "var x=Math.round((t-m)/180000)/20;return x.toLocaleString(%s)+' kW'}" % self.loc)
            kw_tip = ("EVAL:function(t){var d=new Date(t);var m=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();"
                      "var x=Math.round((t-m)/180000)/20;return '%s '+x.toLocaleString(%s,{minimumFractionDigits:1})+' kW'}"
                      % (t("an_target_limit"), self.loc))
            tip_y = ("EVAL:function(v,o){if(v==null)return '';if(o.seriesIndex===0)return '€ '+Math.round(v);"
                     "var k=(" + info + ").kwh||{};var e=k[o.dataPointIndex];"
                     "return v.toLocaleString(%s,{maximumFractionDigits:1})+' %s'+(e!=null?' · '+e.toLocaleString(%s,{maximumFractionDigits:2})+' %s':'')}"
                     % (self.loc, t("an_per_day"), self.loc, t("an_kwh_to_shift")))
            peak_cards.append(s.chart(t("an_target_limit"), "peak", [
                {"fn": "cost", "opts": {"series": "cost"}, "name": t("an_per_year"), "color": CHART["grid"], "type": "column"},
                {"fn": "cost", "opts": {"series": "quarters"}, "name": t("an_quarters_above"), "color": CHART["grey"], "type": "line",
                 "stroke_width": 2, "curve": "straight"}],
                kind="mixed", x="hour", graph_span="7h", span={"start": "day", "offset": "+2h"}, update_interval="30min",
                column_width="55%", tooltip_y=tip_y,
                yaxis=[{"min": 0, "labels": {"formatter": "EVAL:function(v){return '€ '+Math.round(v)}"}},
                       {"min": 0, "opposite": True, "forceNiceScale": True, "labels": {"formatter": s.fmt("", 0)}}],
                extra_apex={"xaxis": {"tickAmount": 7, "labels": {"formatter": kw_axis}}, "tooltip": {"x": {"formatter": kw_tip}},
                            "markers": {"size": [0, 4]}}))
        out.append(section(peak_cards))
        # Above the target
        day_tip = ("EVAL:function(t){var d=new Date(t),I=%s;var p=function(n){return String(n).padStart(2,'0')};"
                   "var k=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());var s=(I.%%s||{})[k];"
                   "return d.toLocaleDateString(%s,{weekday:'short',day:'numeric',month:'numeric'})+(s?' · '+s:'')}" % (info, self.loc))
        tip_y = ("EVAL:function(v,o){var s=o.w.globals.series,j=o.dataPointIndex,f=%s;"
                 "if(o.seriesIndex===0)return f((s[0][j]||0)+(s[1][j]||0));return v?'+'+f(v):'–'}" % kw2)
        above = t("an_above", kw=s_num(target, self.a["locale"]))
        out.append(section([
            heading(above, "mdi:clock-alert-outline"),
            s.chart(t("an_per_day_cap"), "peak", [
                {"fn": "dayPeak", "opts": {"part": "below", "target": target}, "name": t("an_highest"), "color": CHART["grey"]},
                {"fn": "dayPeak", "opts": {"part": "above", "target": target}, "name": above, "color": CHART["bad"]}],
                kind="column", x="day", graph_span="30d", span={"end": "day"}, stacked=True, unit="kW", decimals=0,
                yaxis=[{"min": 0, "forceNiceScale": True}], tooltip_y=tip_y, annotations={"yaxis": [target_line]},
                column_width="70%", extra_apex={"tooltip": {"x": {"formatter": day_tip % "day"}}}),
            s.chart(t("an_per_hour"), "peak", [
                {"fn": "perHour", "opts": {"series": "single", "target": target}, "name": t("an_one_quarter"), "color": CHART["warn"]},
                {"fn": "perHour", "opts": {"series": "long", "target": target}, "name": t("an_longer"), "color": CHART["bad"]}],
                kind="column", x="hour", graph_span="24h", span={"start": "day"}, stacked=True, unit="", decimals=0,
                yaxis=[{"min": 0, "forceNiceScale": True}], column_width="75%",
                tooltip_y="EVAL:function(v){return v==null?'':v+' %s'}" % t("an_quarters"),
                extra_apex={"tooltip": {"x": {"formatter": s.hour_range()}}}),
        ]))
        # Cause: phases of the day peak and quarter per phase
        if n:
            who = [{"fn": "whoPeak", "opts": {"phase": k + 1}, "name": f"L{k + 1}", "color": PHASES[k % 4]} for k in range(n)]
            who.append({"fn": "whoPeak", "opts": {"phase": "back"}, "name": t("an_netted"), "color": CHART["export"]})
            area = {"type": "area", "stroke_width": 0, "opacity": 1, "curve": "stepline"}
            layers = [dict(area, fn="phases", opts={"layer": f"L{k}"}, name=f"L{k}", color=PHASES[(k - 1) % 4]) for k in range(n, 0, -1)]
            layers.append(dict(area, fn="phases", opts={"layer": "back"}, name=t("an_netted"), color=CHART["export"]))
            layers.append({"fn": "phases", "opts": {"layer": "net"}, "name": t("an_net_quarter"), "color": CHART["grey"], "type": "line",
                           "stroke_width": 1.5, "opacity": 1, "curve": "stepline"})
            # Pre-stacked layers: each layer's own value (Lk = top - next, 'back' as a positive number).
            stack_tip = ("EVAL:function(v,o){var s=o.w.globals.series,i=o.seriesIndex,j=o.dataPointIndex,n=%d;"
                         "var x=i<n-1?s[i][j]-s[i+1][j]:(i===n?-s[i][j]:s[i][j]);if(x==null||isNaN(x))x=0;return %s}"
                         % (n, kw2.replace("function(x)", "(function(x)") + ")(x)"))
            quarter_tip = ("EVAL:function(t){var o={hour:'2-digit',minute:'2-digit'},d=new Date(t),e=new Date(t+900000);"
                           "return d.toLocaleDateString(%s,{weekday:'short',day:'numeric',month:'numeric'})+' '"
                           "+d.toLocaleTimeString(%s,o)+'–'+e.toLocaleTimeString(%s,o)}" % (self.loc, self.loc, self.loc))
            zoom = {"chart": {"zoom": {"enabled": True, "type": "x", "autoScaleYaxis": False},
                              "toolbar": {"show": True, "tools": {"download": False, "selection": False, "zoom": True, "zoomin": True,
                                                                  "zoomout": True, "pan": False, "reset": True}}},
                    "tooltip": {"x": {"formatter": quarter_tip}}}
            out.append(section([
                heading(t("an_cause"), "mdi:sine-wave"),
                s.chart(t("an_day_peak"), "peak", who, kind="column", x="day", graph_span="10d", span={"end": "day"}, stacked=True,
                        unit="kW", decimals=0, yaxis=[{"forceNiceScale": True}], tooltip_y=s.fmt("kW", 2),
                        annotations={"yaxis": [target_line]}, column_width="60%",
                        extra_apex={"tooltip": {"x": {"formatter": day_tip % "who"}}}),
                s.chart(t("an_per_phase"), "peak", layers, kind="mixed", x="day", graph_span="10d", span={"end": "day"}, unit="kW",
                        decimals=0, yaxis=[{"forceNiceScale": True}], height=300, tooltip_y=stack_tip,
                        annotations={"yaxis": [target_line]}, extra_apex=zoom),
            ]))
        return out

    # ---- view: tariff (needs a tariff module) ----
    def tariff(self) -> list[dict]:
        s, t = self.s, self.t
        cmp = bool(self.a.get("compare"))
        c_dyn, c_var, c_fixed, c_flat = CHART["car"], CHART["battery"], CHART["grid"], CHART["grey"]
        cent = s.fmt("c€", 1)
        day_items = [{"fn": "day", "opts": {"key": "dyn"}, "name": t("an_dynamic"), "color": c_dyn}]
        if cmp:
            day_items += [{"fn": "day", "opts": {"key": "var"}, "name": t("an_variable"), "color": c_var},
                          {"fn": "day", "opts": {"key": "fixed"}, "name": t("an_fixed"), "color": c_fixed}]
        cards = [heading(t("an_comparison"), "mdi:cash-multiple"),
                 s.chart(t("an_cost_per_day"), "tariff", day_items, kind="column", x="day", graph_span="30d", span={"end": "day"},
                         yaxis=[{"labels": {"formatter": s.eur(0)}}], tooltip_y=s.eur(2), column_width="75%", height=260)]
        if cmp:
            cum = s.chart(t("an_advantage"), "tariff", [
                {"fn": "cumulative", "opts": {"key": "var"}, "name": t("an_vs_variable"), "color": c_var, "unit": " €",
                 "float_precision": 2, "show": {"in_header": True, "legend_value": False}},
                {"fn": "cumulative", "opts": {"key": "fixed"}, "name": t("an_vs_fixed"), "color": c_fixed, "unit": " €",
                 "float_precision": 2, "show": {"in_header": True, "legend_value": False}}],
                kind="line", x="day", graph_span="60d", span={"end": "day"}, yaxis=[{"labels": {"formatter": s.eur(0)}}],
                tooltip_y=s.eur(2), height=260, show_states=True)
            cards.append(cum)
        out = [section(cards)]
        imp = [{"fn": "price", "opts": {"key": "weighted"}, "name": t("an_you_paid"), "color": c_dyn},
               {"fn": "price", "opts": {"key": "flat"}, "name": t("an_day_average"), "color": c_flat}]
        exp = [{"fn": "price", "opts": {"key": "exp_weighted"}, "name": t("an_your_export"), "color": c_dyn},
               {"fn": "price", "opts": {"key": "exp_flat"}, "name": t("an_day_average"), "color": c_flat}]
        if cmp:
            imp.append({"fn": "price", "opts": {"key": "variable"}, "name": t("an_variable"), "color": c_var, "stroke_dash": 4})
            exp.append({"fn": "price", "opts": {"key": "exp_fixed"}, "name": t("an_variable_fixed"), "color": c_var, "stroke_dash": 4})
        out.append(section([
            heading(t("an_per_kwh"), "mdi:scale-balance"),
            s.chart(t("an_import_price"), "tariff", imp, kind="line", x="day", graph_span="30d", span={"end": "day"}, unit="c€",
                    decimals=0, tooltip_y=cent, columns=18),
            s.chart(t("an_export_price"), "tariff", exp, kind="line", x="day", graph_span="30d", span={"end": "day"}, unit="c€",
                    decimals=0, tooltip_y=cent, columns=18),
        ]))

        def per_hour(title, price_key, energy_key, price_name, energy_name, color):
            tip = ("EVAL:function(v,o){if(v==null||isNaN(v))return '';return o.seriesIndex===0?"
                   "%s+' c€/kWh':%s+' kWh'}" % (s.num(1), s.num(2)))
            return s.chart(title, "tariff", [
                {"fn": "hour", "opts": {"key": price_key, "days": 14}, "name": price_name, "color": CHART["house"], "type": "column",
                 "opacity": 0.9, "stroke_width": 0},
                {"fn": "hour", "opts": {"key": energy_key, "days": 14}, "name": energy_name, "color": color, "type": "line",
                 "stroke_width": 3, "curve": "smooth"}],
                kind="mixed", x="hour", graph_span="24h", span={"start": "day"},
                yaxis=[{**({"min": 0} if price_key == "price" else {}), "labels": {"formatter": s.fmt("c€", 0)}},
                       {"min": 0, "opposite": True, "labels": {"formatter": s.fmt("kWh", 1)}}],
                tooltip_y=tip, columns=18, column_width="70%", extra_apex={"tooltip": {"x": {"formatter": s.hour_range()}}})
        out.append(section([
            heading(t("an_per_hour"), "mdi:clock-outline"),
            per_hour(t("an_import_per_hour"), "price", "import", t("an_import_price_short"), t("an_your_import"), CHART["grid"]),
            per_hour(t("an_export_per_hour"), "exp_price", "export", t("an_export_price_short"), t("an_your_export_short"), CHART["export"]),
        ]))
        helpers = [("input_number.tariff_grid_fee_day", t("an_grid_fee_day")), ("input_number.tariff_grid_fee_night", t("an_grid_fee_night")),
                   ("input_number.tariff_levies", t("an_levies")), ("input_number.tariff_capacity_eur_per_kw_year", t("an_capacity_price")),
                   ("input_number.tariff_fixed_eur_per_year", t("an_fixed_fee"))]
        now = ("{% set i = states('sensor.power_price_import') | float(none) %}{% set e = states('sensor.power_price_export') | float(none) %}"
               "{% if i is not none %}" + t("an_price_now_line", import_c="{{ (i * 100) | round(1)" + self.dec + " }}",
                                                        export_c="{{ ((e or 0) * 100) | round(1)" + self.dec + " }}") + "{% endif %}")
        out.append(section([heading(t("an_parameters"), "mdi:clipboard-check-outline"),
                            *[{"type": "tile", "entity": e, "name": n, "grid_options": {"columns": 6}} for e, n in helpers],
                            note(now)]))
        return out

    # ---- view: consumers (who uses what, starts, the car, seasons, day profile) ----
    def consumers_view(self) -> list[dict]:
        s, t, ids, f = self.s, self.t, self.ids, self.f
        out = []
        cons = self.consumers()
        if cons:
            items = [{"fn": "mix", "opts": {"key": c["key"], "days": 30}, "name": c["name"], "color": c["color"]} for c in cons]
            items.append({"fn": "mix", "opts": {"key": "rest", "days": 30}, "name": t("an_not_explained"), "color": CHART["rest"]})
            cards = [heading(t("an_split"), "mdi:chart-donut"),
                     s.donut(t("an_last_30_days"), "consumers", items, unit="kWh", decimals=0, columns=18)]
            starters = [c for c in cons if c.get("power")]
            if starters:
                band = {"xaxis": [{"x": "EVAL:new Date().setHours(9,0,0,0)", "x2": "EVAL:new Date().setHours(17,0,0,0)",
                                   "fillColor": CHART["sun"], "opacity": 0.12, "borderColor": "transparent",
                                   "label": {"text": t("an_sun_window"), "borderColor": "transparent", "orientation": "horizontal",
                                             "style": {"color": CHART["grey"], "background": "transparent"}}}]}
                cards.append(s.chart(t("an_starts"), "consumers",
                                     [{"fn": "starts", "opts": {"key": c["key"]}, "name": c["name"], "color": c["color"]} for c in starters],
                                     kind="column", x="hour", graph_span="24h", span={"start": "day"}, unit="%", decimals=0,
                                     annotations=band, update_interval="1h", tooltip_y=s.fmt("%", 0), column_width="90%", columns=18,
                                     extra_apex={"tooltip": {"x": {"formatter": s.hour_range()}}}))
            out.append(section(cards))
        if f["charger"]:
            kwh_pct = ("EVAL:function(v,o){if(v==null||isNaN(v))return '';var s=o.w.globals.series,j=o.dataPointIndex,tt=0;"
                       "for(var k=0;k<s.length;k++)tt+=(s[k][j]||0);return %s+' kWh ('+(tt?Math.round(100*v/tt):0)+'%%)'}" % s.num(1))
            out.append(section([
                heading(t("an_car"), "mdi:car-electric"),
                s.chart(t("an_car_source"), "consumers", [
                    {"fn": "carSource", "opts": {"key": "solar"}, "name": t("an_from_sun_or_battery"), "color": CHART["sun"]},
                    {"fn": "carSource", "opts": {"key": "grid"}, "name": t("an_at_most_grid"), "color": CHART["grid"]}],
                    kind="column", x="month", graph_span="365d", span={"end": "month"}, stacked=True, unit="kWh", decimals=0,
                    tooltip_y=kwh_pct, update_interval="1h", column_width="70%"),
                s.chart(t("an_car_profile"), "consumers", [
                    {"fn": "carProfile", "opts": {"key": "charging", "days": 30}, "name": t("an_car_charging"), "color": CHART["car"],
                     "type": "area", "curve": "monotoneCubic", "stroke_width": 0, "opacity": 0.6},
                    {"fn": "carProfile", "opts": {"key": "export", "days": 30}, "name": t("an_export"), "color": CHART["export"],
                     "type": "line", "curve": "monotoneCubic", "stroke_width": 2},
                    {"fn": "carProfile", "opts": {"key": "import", "days": 30}, "name": t("an_import"), "color": CHART["grid"],
                     "type": "line", "curve": "monotoneCubic", "stroke_width": 2}],
                    kind="mixed", x="hour", graph_span="24h", span={"start": "day"}, unit="kW", decimals=2, update_interval="1h",
                    tooltip_y=s.fmt("kW", 2)),
            ]))
        out.append(self.seasons())
        out.append(self.day_profile())
        if ids.get("vent_w"):
            out.append(group(t("an_ventilation"), [status_row([
                {"icon": "ventilator", "entity": ids["vent_w"], "label": t("an_now"), "title": t("an_ventilation_now")}])], "mdi:fan", 3))
        return out

    def season_window_jinja(self, sm: str) -> str:
        """Jinja that sets y, begin, last (last complete day) and running for the season starting in month sm."""
        since = (f"strptime('{self.since.isoformat()}', '%Y-%m-%d').date()" if self.since else None)
        begin = "strptime('%04d-%02d-01' | format(y, sm), '%Y-%m-%d').date()"
        return (
            "{%- set t = now().date() -%}"
            f"{{%- set sm = {sm} -%}}"
            "{%- set c = t - timedelta(days=14) -%}"
            "{%- set y = c.year if c.month >= sm else c.year - 1 -%}"
            "{%- set ey = y + 1 if sm + 3 > 12 else y -%}"
            "{%- set em = sm + 3 - 12 if sm + 3 > 12 else sm + 3 -%}"
            "{%- set end = strptime('%04d-%02d-01' | format(ey, em), '%Y-%m-%d').date() -%}"
            + (f"{{%- set begin = [{begin}, {since}] | max -%}}" if since else f"{{%- set begin = {begin} -%}}")
            + "{%- set last = ([end, t] | min) - timedelta(days=1) -%}"
            "{%- set running = end > t -%}"
        )

    def dates_jinja(self) -> str:
        months = json.dumps(self.t("an_months_short").split(","), ensure_ascii=False)
        return ("{% set mnd = " + months + " -%}"
                "{{ begin.day }} {{ mnd[begin.month-1] }} {{ begin.year }} – {{ last.day }} {{ mnd[last.month-1] }} {{ last.year }}"
                "{{ ' (" + self.t("an_running") + ")' if running else '' }}")

    def seasons(self) -> dict:
        s, t, ids, f = self.s, self.t, self.ids, self.f
        layers = (["car"] if f["charger"] else []) + (["ventilation"] if ids.get("vent_w") else []) + ["rest"]
        names = {"car": t("an_car"), "ventilation": t("an_ventilation"), "rest": t("an_rest_of_house")}
        colors = {"car": CHART["car"], "ventilation": CHART["ventilation"], "rest": CHART["rest"]}
        months = {"winter": 12, "spring": 3, "summer": 6, "autumn": 9}
        y_axis = {"min": "EVAL:function(m){return -3*Math.max(1,Math.ceil(-m/3))}",
                  "max": "EVAL:function(m){return 3*Math.max(1,Math.ceil(m/3))}", "tickAmount": 6}
        cards = [heading(t("an_seasons"), "mdi:weather-partly-snowy-rainy")]
        area = {"type": "area", "curve": "monotoneCubic", "stroke_width": 0, "opacity": 1, "show": NO_HEADER}
        for pair in (("winter", "spring"), ("summer", "autumn")):
            for name in pair:
                label = t(f"an_season_{name}") + (" {{ y }}-{{ '%02d' | format((y + 1) % 100) }}" if name == "winter" else " {{ y }}")
                cards.append(note(self.season_window_jinja(str(months[name])) + f"**{label}** · " + self.dates_jinja(), columns=18))
            for name in pair:
                items = [dict(area, fn="season", name=names[k], color=colors[k], opts={"season": name, "layer": k, "layers": layers})
                         for k in reversed(layers)]
                kinds = ["c"] * (len(layers) - 1) + ["b"]
                items.append(dict(area, fn="season", name=t("an_export"), color=CHART["export"], opacity=0.8,
                                  opts={"season": name, "layer": "export"}))
                items.append({"fn": "season", "name": t("an_from_grid"), "color": CHART["grid"], "type": "line", "curve": "monotoneCubic",
                              "stroke_width": 2, "show": NO_HEADER, "opts": {"season": name, "layer": "import"}})
                kinds += ["n", "l"]
                head = {"show": {"in_chart": False, "legend_value": False}, "color": CHART["grey"]}
                items += [dict(head, fn="seasonHead", name=t("an_house_per_day"), unit=" kWh", float_precision=1,
                               opts={"season": name, "what": "house"}),
                          dict(head, fn="seasonHead", name=t("an_grid_per_day"), unit=" kWh", float_precision=1,
                               opts={"season": name, "what": "import"}),
                          dict(head, fn="seasonHead", name=t("an_measured"), unit=" " + t("an_days"), float_precision=0,
                               opts={"season": name, "what": "days"})]
                tip = ("EVAL:function(v,o){var s=o.w.globals.series,i=o.seriesIndex,j=o.dataPointIndex,k=%s;"
                       "var v=k[i]==='c'?s[i][j]-s[i+1][j]:(k[i]==='n'?-s[i][j]:s[i][j]);if(v==null||isNaN(v))v=0;return %s+' kW'}"
                       % (json.dumps(kinds), s.num(2)))
                cards.append(s.chart(t(f"an_season_{name}"), "profiles", items, kind="mixed", x="hour", graph_span="24h",
                                     span={"start": "day"}, unit="kW", decimals=1, columns=18, height=260, yaxis=[dict(y_axis)],
                                     tooltip_y=tip, extra_apex={"tooltip": {"x": {"formatter": s.hour_range()}}}, show_states=True,
                                     update_interval="1h"))
        return section(cards)

    def day_profile(self) -> dict:
        s, t, f = self.s, self.t, self.f
        helper = "input_select.energy_profiles_period"
        options = [("30_days", t("an_period_30_days")), ("winter", t("an_season_winter")), ("spring", t("an_season_spring")),
                   ("summer", t("an_season_summer")), ("autumn", t("an_season_autumn"))]
        buttons = []
        for opt, name in options:
            act = {"action": "perform-action", "perform_action": "input_select.select_option",
                   "target": {"entity_id": helper}, "data": {"option": opt}}
            buttons.append({"type": "button", "entity": helper, "name": name, "show_icon": False, "show_state": False,
                            "tap_action": act, "grid_options": {"columns": 6, "rows": 1}})
        sm = "{'winter': 12, 'spring': 3, 'summer': 6, 'autumn': 9}.get(p, 0)"
        labels = {k: v for k, v in options}
        label = ("{%- set p = states('" + helper + "') -%}"
                 "{%- set names = " + json.dumps(labels, ensure_ascii=False) + " -%}"
                 "{%- if p in ['winter', 'spring', 'summer', 'autumn'] -%}" + self.season_window_jinja(sm)
                 + "**{{ names[p] }} {{ y }}{{ '-%02d' | format((y + 1) % 100) if sm == 12 else '' }}** · " + self.dates_jinja()
                 + "{%- else -%}{%- set t = now().date() -%}{%- set b = t - timedelta(days=30) -%}{%- set l = t - timedelta(days=1) -%}"
                 "**" + t("an_period_30_days") + "** · {{ b.day }}/{{ b.month }} – {{ l.day }}/{{ l.month }}/{{ l.year }}{%- endif %}")
        flows = [("import", t("an_from_grid"), CHART["grid"]),
                 ("house_without_car" if f["charger"] else "house", t("an_house_without_car" if f["charger"] else "an_house"), CHART["house"])]
        if f["charger"]:
            flows.append(("car", t("an_car"), CHART["car"]))
        if f["battery"]:
            flows += [("charge", t("an_battery_charges"), CHART["battery"]), ("discharge", t("an_battery_discharges"), CHART["battery_out"])]
        if f["solar"]:
            flows.append(("export", t("an_export"), CHART["export"]))
        share = ("EVAL:function(v,o){var s=o.w.globals.series[o.seriesIndex],tt=0;for(var i=0;i<s.length;i++)tt+=s[i]||0;"
                 "if(v==null||isNaN(v))v=0;return %s+' kWh · '+(tt?Math.round(100*v/tt):0)+'%% %s'}" % (s.num(2), t("an_of_the_day")))
        cards = [heading(t("an_day_profile"), "mdi:clock-time-four-outline"), *buttons, note(label)]
        for flow, title, color in flows:
            c = s.chart(title, "profiles", [
                {"fn": "clock", "name": title, "color": color, "opts": {"flow": flow}, "show": NO_HEADER, "entity": helper},
                {"fn": "clockHead", "name": t("an_per_day"), "color": CHART["grey"], "unit": " kWh", "float_precision": 1,
                 "show": {"in_chart": False, "legend_value": False}, "opts": {"flow": flow, "what": "day"}, "entity": helper},
                {"fn": "clockHead", "name": t("an_sun_window_short"), "color": CHART["grey"], "unit": "%", "float_precision": 0,
                 "show": {"in_chart": False, "legend_value": False}, "opts": {"flow": flow, "what": "solar_window"}, "entity": helper}],
                kind="column", x="hour", graph_span="24h", span={"start": "day"}, unit="kWh", decimals=1, columns=12, height=130,
                column_width="80%", yaxis=[{"show": False, "min": 0}], tooltip_y=share, update_interval=None, show_states=True,
                extra_apex={"legend": {"show": False}, "tooltip": {"x": {"formatter": s.hour_range()}},
                            "grid": {"yaxis": {"lines": {"show": False}}}})
            cards.append(c)
        return section(cards)

    # ---- view: trends (long-term statistics) ----
    def trends(self) -> list[dict]:
        t, ids, f = self.t, self.ids, self.f
        imp = self.registers(ids["imp_kwh"], "import", [CHART["grid"], CHART["grid_night"]])
        exp = self.registers(ids["exp_kwh"], "export", [CHART["export"], CHART["export_night"]])
        solar = [(ids["solar_kwh"], t("an_solar"), CHART["sun"])] if ids.get("solar_kwh") else []
        out = [group(t("an_30_days"), [stats(t("an_grid_kwh"), imp), stats(t("an_solar_export_kwh"), solar + exp)], "mdi:calendar-month", 3),
               group(t("an_per_month"), [stats(t("an_solar_and_grid") if solar else t("an_grid_kwh"), solar + imp, "month", 365)],
                     "mdi:calendar-blank-multiple", 2)]
        if f["charger"]:
            out.append(group(t("an_charger"), [stats(t("an_per_day_cap"), [("sensor.ev_charger_energy_today", t("an_total"), CHART["car"]),
                                                                        ("sensor.ev_charger_solar_energy_today", t("an_solar"), CHART["good"])])],
                             "mdi:ev-station"))
        if ids.get("hp_kwh"):
            out.append(group(t("an_heat_pump"), [stats(t("an_per_day_cap"), [(ids["hp_kwh"], t("an_heat_pump"), CHART["heat_pump"])]),
                                                   stats(t("an_per_month"), [(ids["hp_kwh"], t("an_heat_pump"), CHART["heat_pump"])], "month", 365)],
                             "mdi:heat-pump-outline", 3))
        return out

    # ---- view: battery (needs entities.battery_soc) ----
    def battery(self) -> list[dict]:
        s, t, ids, f = self.s, self.t, self.ids, self.f
        b = self.a.get("battery") or {}
        soc = ids["soc"]
        out = [section([status_row([{"icon": "batterij", "entity": soc, "label": t("an_charge"), "title": t("an_charge_level")}])])]
        charge = [heading(t("an_charge_level"), "mdi:battery-outline"),
                  {"type": "history-graph", "hours_to_show": 168, "grid_options": {"columns": "full", "rows": 5},
                   "entities": [{"entity": soc, "name": t("an_charge"), "color": CHART["battery"]}]}]
        if ids.get("chg_kwh") and ids.get("dis_kwh"):
            charge.append(stats(t("an_charged_kwh"), [(ids["chg_kwh"], t("an_charged"), CHART["battery"]),
                                                      (ids["dis_kwh"], t("an_discharged"), CHART["battery_out"])], days=14))
        out.append(section(charge))
        days90 = {"graph_span": "90d", "span": {"end": "day"}}
        if f["tariff"]:
            eur0 = "EVAL:function(v){if(v==null||isNaN(v))return '';return '€ '+%s}" % s.num(0)
            eur2 = "EVAL:function(v){if(v==null||isNaN(v))return '';return '€ '+%s}" % s.num(2)
            names = (t("an_saving_per_day"), t("an_saving_total"), t("an_investment"))
            items = [{"fn": "savingDay", "name": names[0], "color": CHART["battery"], "type": "column", "unit": "€", "float_precision": 2,
                      "opacity": 0.9},
                     {"fn": "savingTotal", "name": names[1], "color": CHART["good"], "type": "line", "unit": "€", "float_precision": 2,
                      "stroke_width": 2.5, "curve": "straight"}]
            right = [names[1]]
            if b.get("investment_eur"):
                items.append({"fn": "investment", "name": names[2], "color": CHART["grey"], "type": "line", "unit": "€",
                              "float_precision": 0, "stroke_width": 1.5, "curve": "straight", "stroke_dash": 4})
                right.append(names[2])
            yaxis = [{"seriesName": [names[0]], "labels": {"formatter": eur2}, "tickAmount": 4},
                     {"seriesName": right, "opposite": True, "min": 0, "tickAmount": 4, "labels": {"formatter": eur0}}]
            out.append(section([heading(t("an_return"), "mdi:piggy-bank-outline"),
                                s.chart(t("an_saving"), "battery", items, kind="mixed", x="day", yaxis=yaxis, height=280,
                                        column_width="70%", **days90)]))
        reserve = b.get("reserve_percent", 20)
        hour_axis = "EVAL:function(v){var h=Math.round(v)%24;return String(h).padStart(2,'0')+':00'}"
        hour_tip = ("EVAL:function(v){if(v==null||isNaN(v))return '';if(v>=33)return '%s';"
                    "var h=Math.floor(v),m=Math.round((v-h)*60);if(m===60){h++;m=0}"
                    "return String(h%%24).padStart(2,'0')+':'+String(m).padStart(2,'0')}" % t("an_not_empty"))
        evening = [heading(t("an_evening"), "mdi:battery-clock"),
                   s.chart(t("an_soc_over_day"), "battery", [
                       {"fn": "socToday", "name": t("an_today"), "color": CHART["battery"], "unit": "%", "float_precision": 0, "stroke_width": 2.5},
                       {"fn": "socAverage", "name": t("an_average_30"), "color": CHART["grey"], "unit": "%", "float_precision": 0,
                        "opts": {"days": 30}, "stroke_dash": 4}],
                       kind="line", x="hour", span={"start": "day"},
                       yaxis=[{"min": 0, "max": 100, "tickAmount": 5, "labels": {"formatter": s.fmt("%", 0)}}],
                       annotations={"yaxis": [hline(reserve, t("an_reserve", pct=reserve), CHART["bad"])]}, update_interval="5min",
                       tooltip_y=s.fmt("%", 0)),
                   s.chart(t("an_empty_at"), "battery", [{"fn": "emptyAt", "name": t("an_empty_at"), "color": CHART["grid"]}],
                           kind="column", x="day", columns=24,
                           yaxis=[{"min": 12, "max": 33, "tickAmount": 7, "labels": {"formatter": hour_axis}}],
                           annotations={"yaxis": [hline(24, t("an_midnight"))]}, tooltip_y=hour_tip, height=260, column_width="70%",
                           **days90),
                   s.donut(t("an_days_full"), "battery", [{"fn": "daysFull", "name": t("an_full"), "color": CHART["good"]},
                                                          {"fn": "daysNotFull", "name": t("an_not_full"), "color": CHART["grey"]}],
                           unit=t("an_days"), decimals=0, height=260, **days90)]
        out.append(section(evening))
        if b.get("module_kwh"):
            names = (t("an_module_shift"), t("an_module_total_1"), t("an_module_total_2"))
            items = [{"fn": "moduleKwh", "name": names[0], "color": CHART["battery"], "type": "column", "unit": "kWh", "float_precision": 2,
                      "opacity": 0.9, "opts": {"modules": 1}}]
            if f["tariff"]:
                items += [{"fn": "moduleTotal", "name": names[1], "color": CHART["good"], "type": "line", "unit": "€", "float_precision": 2,
                           "stroke_width": 2.5, "curve": "straight", "opts": {"modules": 1}},
                          {"fn": "moduleTotal", "name": names[2], "color": CHART["export"], "type": "line", "unit": "€",
                           "float_precision": 2, "stroke_width": 2, "curve": "straight", "opts": {"modules": 2}, "stroke_dash": 4}]
            yaxis = [{"seriesName": [names[0]], "min": 0, "tickAmount": 3, "labels": {"formatter": s.fmt("kWh", 1)}}]
            if f["tariff"]:
                yaxis.append({"seriesName": [names[1], names[2]], "opposite": True, "min": 0, "tickAmount": 3,
                              "labels": {"formatter": "EVAL:function(v){return '€ '+%s}" % s.num(0)}})
            out.append(section([heading(t("an_extra_module"), "mdi:battery-plus-outline"),
                                s.chart(t("an_module_potential"), "battery", items, kind="mixed", x="day", yaxis=yaxis, height=280,
                                        column_width="70%", **days90)]))

        def profile(series):
            imp = series == "import"
            return s.chart(t("an_import_per_hour" if imp else "an_export_per_hour"), "battery", [
                {"fn": "profile", "name": t("an_last_30_days"), "color": CHART["grid" if imp else "export"], "unit": "kW",
                 "float_precision": 2, "stroke_width": 2.5, "opts": {"series": series, "period": "recent"}},
                {"fn": "profile", "name": t("an_without_battery"), "color": CHART["battery"], "unit": "kW", "float_precision": 2,
                 "opts": {"series": series, "period": "without"}, "stroke_dash": 4},
                {"fn": "profile", "name": t("an_last_year"), "color": CHART["grey"], "unit": "kW", "float_precision": 2,
                 "opts": {"series": series, "period": "last_year"}}],
                kind="line", x="hour", span={"start": "day"}, update_interval="1h",
                yaxis=[{"min": 0, "tickAmount": 4, "labels": {"formatter": s.fmt("kW", 1)}}], tooltip_y=s.fmt("kW", 2))
        out.append(section([heading(t("an_effect"), "mdi:chart-bell-curve-cumulative"), profile("import"), profile("export")]))
        return out

    # ---- the dashboards ----
    def analysis_dashboard(self) -> dict:
        t, f = self.t, self.f
        tabs = [("period", t("an_view_period"), "mdi:calendar-range", self.period),
                ("power", t("an_view_power"), "mdi:speedometer", self.power)]
        if f["tariff"]:
            tabs.append(("tariff", t("an_view_tariff"), "mdi:cash-multiple", self.tariff))
        tabs += [("consumers", t("an_view_consumers"), "mdi:power-plug-outline", self.consumers_view),
                 ("trends", t("an_view_trends"), "mdi:chart-timeline-variant", self.trends)]
        if f["battery"]:
            tabs.append(("battery", t("an_view_battery"), "mdi:home-battery-outline", self.battery))
        views = [{"title": title, "path": path, "icon": icon, "type": "sections", "max_columns": 3,
                  "sections": [page_header(title)] + build()} for path, title, icon, build in tabs]
        return {"title": t("an_dashboard_title"), "views": views}

    def flows_view(self) -> dict:
        """Energy flows per day: date picker, kWh/% switch, where the use came from and where the sun went."""
        t, f = self.t, self.f
        date_e, unit_e = "input_datetime.energy_flows_date", "input_select.energy_flows_unit"
        sources = [("h_grid", t("an_from_grid"), CHART["grid"]), ("h_sun", t("an_direct_sun"), CHART["sun"])]
        if f["battery"]:
            sources.insert(1, ("h_batt", t("an_from_battery"), CHART["battery"]))
        dest = [("c_house", t("an_to_house"), CHART["house"]), ("z_net_neg", t("an_to_grid"), CHART["export"])]
        if f["charger"]:
            dest.insert(1, ("c_car", t("an_to_car"), CHART["car"]))
        if f["battery"]:
            dest.insert(-1, ("c_batt", t("an_to_battery"), CHART["battery"]))
        # Pre-stacked layers, top of the stack first (h_grid = everything, h_batt = sun + battery, h_sun = sun).
        src_stack = sorted(sources, key=lambda x: ["h_grid", "h_batt", "h_sun"].index(x[0]))
        dest_pos = [d for d in dest if d[0] != "z_net_neg"]
        dest_stack = list(reversed(dest_pos)) + [d for d in dest if d[0] == "z_net_neg"]
        donut_src = [("n_house", t("an_from_grid"), CHART["grid"]), ("z_dir", t("an_direct_sun"), CHART["sun"])]
        if f["battery"]:
            donut_src.insert(1, ("b_house", t("an_from_battery"), CHART["battery"]))
        donut_dest = [("z_house", t("an_to_house"), CHART["house"])] + ([("z_car", t("an_to_car"), CHART["car"])] if f["charger"] else []) \
            + ([("z_batt", t("an_to_battery"), CHART["battery"])] if f["battery"] else []) + [("z_net", t("an_to_grid"), CHART["export"])]
        if f["charger"]:
            src_stack.append(("car", t("an_of_which_car"), CHART["car"], "line"))

        def gen(key, mode, unit, out):
            return ("const S = window.haKitEnergyFlows || await new Promise((r) => { let n = 0; const i = setInterval(() => {"
                    " if (window.haKitEnergyFlows || ++n > 100) { clearInterval(i); r(window.haKitEnergyFlows); } }, 100); });\n"
                    "if (!S) throw new Error('energy-flows.js is not loaded');\n"
                    f"return S.get(hass, {{ key: '{key}', mode: '{mode}', unit: '{unit}', out: '{out}' }});")

        def series(items, mode, unit, out):
            res = []
            for i, (k, n, col, *kind) in enumerate(items):
                se = {"entity": date_e if i == 0 else "sun.sun", "name": n, "color": col, "data_generator": gen(k, mode, unit, out)}
                if kind and kind[0] == "line":
                    se.update({"type": "line", "stroke_width": 2, "opacity": 1})
                res.append(se)
            return res

        def axis(unit):
            return ("EVAL:function(v){return Math.round(v)+' %'}" if unit == "percent"
                    else "EVAL:function(v){return %s+' kWh'}" % self.s.num(2))

        def visible(unit):
            return [{"condition": "state", "entity": unit_e, "state": unit}]

        def tooltip(unit, diffs, neg):
            fm = "Math.round(x)+' %'" if unit == "percent" else self.s.num(2).replace("v", "x") + "+' kWh'"
            return ("EVAL:function(v,o){var s=o.w.globals.series,i=o.seriesIndex,j=o.dataPointIndex;"
                    f"var x=i<{diffs}?s[i][j]-s[i+1][j]:(i==={neg}?-s[i][j]:s[i][j]);if(x==null||isNaN(x))x=0;return {fm}}}")

        def timeline(title, mode, unit, items, diffs, neg):
            yaxis = {"labels": {"formatter": axis(unit)}}
            has_neg = any(k[0] == "z_net_neg" for k in items)
            if unit == "percent":
                yaxis.update({"min": -100 if has_neg else 0, "max": 100})
            elif not has_neg:
                yaxis["min"] = 0
            return {"type": "custom:apexcharts-card", "graph_span": "24h", "span": {"start": "day"}, "stacked": False,
                    "header": {"show": True, "title": title, "show_states": False},
                    "all_series_config": {"type": "area", "curve": "monotoneCubic", "stroke_width": 0, "opacity": 1, "extend_to": False,
                                          "unit": " %" if unit == "percent" else " kWh", "float_precision": 0 if unit == "percent" else 2,
                                          "show": {"legend_value": False}},
                    "apex_config": {"chart": {"height": 250, "type": "area", "stackOnlyBar": False, "fontFamily": "Figtree, system-ui, sans-serif"},
                                    "legend": {"show": True, "position": "bottom", "markers": {"shape": "circle"}, "inverseOrder": True,
                                               "onItemClick": {"toggleDataSeries": False}},
                                    "grid": {"strokeDashArray": 0, "borderColor": "rgba(128,128,128,0.14)",
                                             "xaxis": {"lines": {"show": False}}, "yaxis": {"lines": {"show": True}}},
                                    "xaxis": {"tickAmount": 6, "labels": {"formatter": self.s.hour_label()}, "axisTicks": {"show": False}},
                                    "yaxis": [yaxis], "dataLabels": {"enabled": False},
                                    "tooltip": {"shared": True, "x": {"formatter": self.s.time_label()}, "y": {"formatter": tooltip(unit, diffs, neg)}}},
                    "series": series(items, mode, unit, "series"), "grid_options": {"columns": 24}, "visibility": visible(unit)}

        def donut(title, mode, unit, items):
            apex = {"chart": {"height": 250, "fontFamily": "Figtree, system-ui, sans-serif"}, "stroke": {"width": 0},
                    "legend": {"show": True, "position": "bottom", "markers": {"shape": "circle"}},
                    "plotOptions": {"pie": {"donut": {"size": "72%", "labels": {"show": True, "total": {
                        "show": True, "label": t("an_total"),
                        "formatter": "EVAL:function(w){var v=w.globals.seriesTotals.reduce((a,b)=>a+b,0);return %s+' kWh'}" % self.s.num(1)}}}}}}
            if unit == "percent":
                apex["dataLabels"] = {"enabled": True, "formatter": "EVAL:function(v){return Math.round(v)+'%'}"}
            return {"type": "custom:apexcharts-card", "graph_span": "24h", "span": {"start": "day"}, "chart_type": "donut",
                    "header": {"show": True, "title": title, "show_states": False},
                    "all_series_config": {"unit": " kWh", "float_precision": 1}, "apex_config": apex,
                    "series": series(items, mode, "kwh", "total"), "grid_options": {"columns": 12}, "visibility": visible(unit)}

        days = json.dumps(t("an_weekdays_long").split(","), ensure_ascii=False)
        months = json.dumps(t("an_months_long").split(","), ensure_ascii=False)
        date_text = ("{% set d = strptime(states('" + date_e + "'), '%Y-%m-%d', none) %}"
                     "{% if d %}{% set days = " + days + " %}{% set months = " + months + " %}{% set age = (now().date() - d.date()).days %}"
                     "### {{ days[d.weekday()] | capitalize }} {{ d.day }} {{ months[d.month - 1] }} {{ d.year }}{{ ' · " + t("an_today")
                     + "' if age == 0 else '' }}\n{{ '" + t("an_per_hour") + "' if age > 9 else '" + t("an_per_quarter") + "' }}{% endif %}")
        week_text = ("{% set d = strptime(states('" + date_e + "'), '%Y-%m-%d', none) %}{% if d %}"
                     "{% set e = d if d.date() < now().date() else d - timedelta(days=1) %}{% set b = e - timedelta(days=6) %}"
                     + t("an_week_text", start="{{ b.day }}/{{ b.month }}", end="{{ e.day }}/{{ e.month }}") + "{% endif %}")

        def nav(name, icon, script):
            act = {"action": "perform-action", "perform_action": f"script.{script}"}
            return {"type": "tile", "entity": f"script.{script}", "name": name, "icon": icon, "hide_state": True,
                    "tap_action": act, "icon_tap_action": act, "grid_options": {"columns": 6, "rows": 1}}

        def unit_button(opt, name):
            act = {"action": "perform-action", "perform_action": "input_select.select_option", "target": {"entity_id": unit_e},
                   "data": {"option": opt}}
            return {"type": "button", "entity": unit_e, "name": name, "show_icon": False, "show_state": False, "tap_action": act,
                    "grid_options": {"columns": 6, "rows": 1}}

        controls = {"type": "grid", "column_span": 3, "cards": [
            heading(t("an_flows_title"), "mdi:chart-areaspline"),
            {"type": "markdown", "content": date_text, "grid_options": {"columns": 12, "rows": 2}},
            {"type": "tile", "entity": date_e, "name": t("an_pick_date"), "icon": "mdi:calendar", "grid_options": {"columns": 12, "rows": 1}},
            unit_button("kwh", "kWh"), unit_button("percent", "%"),
            nav(t("an_previous"), "mdi:chevron-left", "energy_flows_day_back"),
            nav(t("an_today_cap"), "mdi:calendar-today", "energy_flows_today"),
            nav(t("an_next"), "mdi:chevron-right", "energy_flows_day_forward"),
        ]}

        def block(mode):
            if mode == "day":
                cards = [heading(t("an_where_energy_went"), "mdi:chart-areaspline")]
                sub = t("an_total")
            else:
                cards = [heading(t("an_average_week"), "mdi:calendar-week"),
                         {"type": "markdown", "content": week_text, "text_only": True, "grid_options": {"columns": "full"}}]
                sub = t("an_average_per_day")
            n_src = len([x for x in src_stack if len(x) == 3])
            n_dest = len(dest_stack) - 1
            for unit in ("kwh", "percent"):
                cards += [timeline(t("an_where_use_came_from"), mode, unit, src_stack, n_src - 1, -1), donut(sub, mode, unit, donut_src),
                          timeline(t("an_where_sun_went"), mode, unit, dest_stack, n_dest - 1, n_dest), donut(sub, mode, unit, donut_dest)]
            return {"type": "grid", "column_span": 3, "cards": cards}

        body = [controls, block("day"), block("week")] if f["solar"] else [controls, block("day")]
        return {"title": t("an_view_flows"), "path": "flows", "icon": "mdi:chart-areaspline", "type": "sections", "max_columns": 3,
                "sections": [page_header(t("an_view_flows"))] + body}

    def screen_dashboard(self) -> dict:
        card = dict(self.cfg["card"])
        return {"title": self.t("an_screen_title"), "views": [
            {"title": self.cfg["card"]["strings"]["title"], "path": "energy", "icon": "mdi:lightning-bolt-outline", "type": "panel",
             "cards": [card]},
            self.flows_view()]}


def s_num(v: float, locale: str) -> str:
    """Number as text with the decimal separator of the locale (1 decimal when not whole)."""
    text = f"{v:g}"
    return text.replace(".", ",") if locale.startswith(("nl", "de", "fr")) else text

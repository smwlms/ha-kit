"""Card factories in the style of theme Organic for the energy dashboards (apexcharts-card 2.x, HA core cards).

Rules learned the hard way:
- stacked areas need apex_config.chart.type 'area' + stackOnlyBar False; stacked columns work with the default.
- apexcharts stacks a negative area on top of the positive ones: the data generators pre-stack charts with
  negative layers.
- nulls break the monotoneCubic curve: generators return 0 (or drop points) for area series.
- give the y-axis via apex_config.yaxis (a card-level 'yaxis' clips stacked peaks).
- apexcharts-card resolves var(--x) only against document.documentElement and without a fallback, so charts use hex
  colours (CHART); other cards use the theme tokens with a fallback (TOKENS).
Every text comes from strings (strings.yaml through dashboard/config.json); number and date formats follow the locale.
"""
from __future__ import annotations

import json

# Organic palette (module base, theme tokens --cw-*). Chart tones keep >= ~2.2:1 on the light and the dark card.
CHART = {
    "sun": "#C98A3E", "battery": "#7F8B64", "grid": "#BB7644", "car": "#6F8455", "house": "#B9876A",
    "export": "#9C5A2C", "heat_pump": "#B07E45", "ventilation": "#6F8784", "rest": "#9E9688", "good": "#7A8A5E",
    "warn": "#C98A3E", "bad": "#C67139", "grey": "#8E887E", "grid_night": "#8F5A36", "export_night": "#A07A5A",
    "battery_out": "#5E6A45", "hot_water": "#9A6A3A", "cooling": "#7A8FA0",
}
PHASES = ["#BB7644", "#7F8B64", "#C98A3E", "#6F8784"]
CONSUMER_TONES = ["#B07A72", "#6F8784", "#9A6A3A", "#7A8FA0", "#8A9670", "#A07A5A"]
TOKENS = {
    "accent": "var(--cw-accent-ink, var(--cw-accent, #C67139))",
    "good": "var(--cw-good, #7A8A5E)",
}
FONT = "Figtree, system-ui, sans-serif"
INFO_BAND = 54  # px reserved above the plot for the fixed hover line


class Style:
    """Formatters and card factories for one locale and one set of strings."""

    def __init__(self, strings: dict, locale: str, bundle_global: str = "haKitEnergy") -> None:
        self.s = strings
        self.loc = json.dumps(locale)
        self.glob = bundle_global

    def t(self, key: str, **values) -> str:
        text = self.s.get(key, key)
        for k, v in values.items():
            text = text.replace("{" + k + "}", str(v))
        return text

    # ---- EVAL formatters (JavaScript functions as strings, read by apexcharts-card) ----
    def num(self, decimals: int) -> str:
        """JS expression that formats v with the locale and a fixed number of decimals."""
        return (f"(Math.abs(v)<{0.5 * 10 ** -decimals}?0:v).toLocaleString({self.loc},"
                f"{{minimumFractionDigits:{decimals},maximumFractionDigits:{decimals}}})")

    def fmt(self, unit: str, decimals: int = 1) -> str:
        sep = "" if unit in ("", "%") else " "
        return f"EVAL:function(v){{if(v==null||isNaN(v))return '';return {self.num(decimals)}+'{sep}{unit}'}}"

    def eur(self, decimals: int = 2) -> str:
        return (f"EVAL:function(v){{if(v==null||isNaN(v))return '';var a=Math.abs(v)<{0.5 * 10 ** -decimals}?0:v;"
                f"return (a<0?'− ':'')+'€ '+Math.abs(a).toLocaleString({self.loc},"
                f"{{minimumFractionDigits:{decimals},maximumFractionDigits:{decimals}}})}}")

    def hour_label(self) -> str:
        return ("EVAL:function(v,t){var d=new Date(t);return d.toLocaleTimeString(%s,{hour:'2-digit',minute:'2-digit'})}"
                % self.loc)

    def time_label(self) -> str:
        return "EVAL:function(t){return new Date(t).toLocaleTimeString(%s,{hour:'2-digit',minute:'2-digit'})}" % self.loc

    def day_label(self) -> str:
        return "EVAL:function(v,t){return new Date(t).toLocaleDateString(%s,{day:'numeric',month:'numeric'})}" % self.loc

    def day_tooltip(self) -> str:
        return ("EVAL:function(t){return new Date(t).toLocaleDateString(%s,{weekday:'short',day:'numeric',month:'numeric',"
                "year:'numeric'})}" % self.loc)

    def month_label(self) -> str:
        return "EVAL:function(v,t){return new Date(t).toLocaleDateString(%s,{month:'short',year:'2-digit'})}" % self.loc

    def month_tooltip(self) -> str:
        return "EVAL:function(t){return new Date(t).toLocaleDateString(%s,{month:'long',year:'numeric'})}" % self.loc

    def hour_range(self) -> str:
        return ("EVAL:function(t){var o={hour:'2-digit',minute:'2-digit'},a=new Date(t);a.setMinutes(0,0,0);"
                "var b=new Date(a.getTime()+3600000);return a.toLocaleTimeString(%s,o)+'–'+b.toLocaleTimeString(%s,o)}"
                % (self.loc, self.loc))

    def x_labels(self, x: str) -> tuple[str, str]:
        return {"hour": (self.hour_label(), self.time_label()), "day": (self.day_label(), self.day_tooltip()),
                "month": (self.month_label(), self.month_tooltip())}[x]

    # ---- data generators ----
    def gen(self, topic: str, fn: str, **opts) -> str:
        """data_generator body: waits for the bundle, then returns window.haKitEnergy[topic][fn](hass, opts)."""
        o = json.dumps(opts, ensure_ascii=False)
        g = self.glob
        return ("const A = window.%(g)s?.['%(t)s'] || await new Promise((r) => { let n = 0; const i = setInterval(() => {"
                " const m = window.%(g)s?.['%(t)s']; if (m || ++n > 150) { clearInterval(i); r(m); } }, 100); });\n"
                "if (!A) throw new Error('energy-analysis.js (%(t)s) is not loaded');\n"
                "return A['%(f)s'](hass, Object.assign({start, end}, %(o)s));") % {"g": g, "t": topic, "f": fn, "o": o}

    def series(self, topic: str, items: list[dict], default_type: str | None = None, entity: str = "sun.sun") -> list[dict]:
        """items: dicts with fn, name, color and optional opts, type, entity, yaxis_id, stroke_width, opacity, curve,
        unit, float_precision, show, stroke_dash. The entity only triggers redraws (sun.sun by default)."""
        out = []
        for it in items:
            s = {"entity": it.get("entity", entity), "name": it["name"], "color": it["color"],
                 "data_generator": self.gen(topic, it["fn"], **it.get("opts", {}))}
            t = it.get("type", default_type)
            if t:
                s["type"] = t
            for k in ("yaxis_id", "stroke_width", "opacity", "curve", "unit", "float_precision", "show", "stroke_dash"):
                if k in it:
                    s[k] = it[k]
            out.append(s)
        return out

    def fixed_info(self) -> str:
        """Hover info on a fixed spot: one compact line (period + value per visible series) above the plot."""
        return ("EVAL:function(o){var w=o.w,i=o.dataPointIndex,g=w.globals,c=w.config.tooltip,tx=c.x&&c.x.formatter,"
                "ty=c.y,x=null,out=[];for(var k=0;k<g.seriesX.length;k++){if(g.seriesX[k]&&g.seriesX[k][i]!=null){"
                "x=g.seriesX[k][i];break}}var head=tx?tx(x,{dataPointIndex:i,w:w}):'';"
                "for(var s=0;s<o.series.length;s++){if(g.collapsedSeriesIndices.indexOf(s)>-1)continue;"
                "var v=o.series[s][i],f=Array.isArray(ty)?(ty[s]&&ty[s].formatter):(ty&&ty.formatter),"
                "t=f?f(v,{series:o.series,seriesIndex:s,dataPointIndex:i,w:w}):v;if(t===''||t==null)t='–';"
                "out.push('<span style=\"white-space:nowrap;margin-right:10px\"><i style=\"display:inline-block;"
                "width:8px;height:8px;border-radius:50%;margin-right:4px;background:'+g.colors[s]+'\"></i>'"
                "+g.seriesNames[s]+' <b>'+t+'</b></span>')}"
                "return '<div style=\"padding:3px 8px;font-size:12px;line-height:1.45;white-space:normal;max-width:'"
                "+Math.max(g.gridWidth,160)+'px\"><span style=\"opacity:.7;margin-right:10px\">'+head+'</span>'"
                "+out.join('')+'</div>'}")

    def chart(self, title: str, topic: str, items: list[dict], *, kind: str = "area", x: str = "hour",
              graph_span: str = "24h", span: dict | None = None, stacked: bool = False, yaxis: list | None = None,
              height: int = 250, update_interval: str | None = "15min", unit: str = "", decimals: int = 1,
              columns=36, tooltip_y: str | None = None, legend_inverse: bool = False, annotations: dict | None = None,
              extra_apex: dict | None = None, column_width: str = "85%", show_states: bool = False) -> dict:
        """Timeline card. kind: 'area' | 'column' | 'line' | 'mixed' (per-item 'type'). x: 'hour', 'day', 'month'."""
        xl, xt = self.x_labels(x)
        ya = yaxis or [{}]
        for y in ya:
            y.setdefault("labels", {"formatter": self.fmt(unit, decimals)})
        apex = {
            "chart": {"height": height, "fontFamily": FONT},
            "legend": {"show": True, "position": "bottom", "markers": {"shape": "circle"}, "inverseOrder": legend_inverse},
            "grid": {"strokeDashArray": 0, "borderColor": "rgba(128,128,128,0.14)", "padding": {"top": INFO_BAND},
                     "xaxis": {"lines": {"show": False}}, "yaxis": {"lines": {"show": True}}},
            "xaxis": {"labels": {"formatter": xl}, "axisTicks": {"show": False}, "tooltip": {"enabled": False}},
            "yaxis": ya,
            "dataLabels": {"enabled": False},
            "tooltip": {"shared": True, "intersect": False, "x": {"formatter": xt}, "custom": self.fixed_info(),
                        "fixed": {"enabled": True, "position": "topRight", "offsetX": 0, "offsetY": 0}},
        }
        if x == "hour":
            apex["xaxis"]["tickAmount"] = 6
        if kind == "area" and stacked:
            apex["chart"].update({"type": "area", "stackOnlyBar": False})
        if kind in ("column", "mixed"):
            apex["plotOptions"] = {"bar": {"columnWidth": column_width, "borderRadius": 5, "borderRadiusApplication": "end",
                                           "borderRadiusWhenStacked": "last"}}
        if tooltip_y:
            apex["tooltip"]["y"] = {"formatter": tooltip_y}
        if annotations:
            apex["annotations"] = annotations
        if extra_apex:
            deep_merge(apex, extra_apex)
        default_type = None if kind == "mixed" else kind
        asc = {"extend_to": False, "show": {"legend_value": False}}
        if default_type == "area":
            asc.update({"curve": "monotoneCubic", "stroke_width": 0, "opacity": 0.9})
        elif default_type == "line":
            asc.update({"curve": "monotoneCubic", "stroke_width": 2.5})
        elif default_type == "column":
            asc.update({"opacity": 0.9})
        c = {"type": "custom:apexcharts-card", "graph_span": graph_span,
             "header": {"show": True, "title": title, "show_states": show_states, "colorize_states": show_states},
             "stacked": stacked, "all_series_config": asc, "apex_config": apex,
             "series": self.series(topic, items, default_type), "grid_options": {"columns": columns}}
        if update_interval:
            c["update_interval"] = update_interval
        if span:
            c["span"] = span
        return c

    def donut(self, title: str, topic: str, items: list[dict], *, unit: str = "kWh", decimals: int = 1, height: int = 250,
              columns=12, update_interval: str = "1h", graph_span: str = "24h", span: dict | None = None) -> dict:
        """Donut from generators that return [[ts, value]] (the last value is used)."""
        total = ("EVAL:function(w){var v=w.globals.seriesTotals.reduce((a,b)=>a+b,0);return %s+' %s'}"
                 % (self.num(decimals), unit))
        apex = {"chart": {"height": height, "fontFamily": FONT}, "stroke": {"width": 0},
                "legend": {"show": True, "position": "bottom", "markers": {"shape": "circle"}},
                "plotOptions": {"pie": {"donut": {"size": "72%", "labels": {"show": True, "total": {
                    "show": True, "label": self.t("an_total"), "formatter": total}}}}},
                "dataLabels": {"enabled": True, "formatter": "EVAL:function(v){return Math.round(v)+'%'}"},
                "tooltip": {"enabled": False}}
        c = {"type": "custom:apexcharts-card", "chart_type": "donut", "graph_span": graph_span,
             "header": {"show": True, "title": title, "show_states": False}, "update_interval": update_interval,
             "all_series_config": {"unit": f" {unit}", "float_precision": decimals}, "apex_config": apex,
             "series": self.series(topic, items), "grid_options": {"columns": columns}}
        if span:
            c["span"] = span
        return c


# ---- cards without formatters ----
LABEL_BG, LABEL_TEXT = "#FBF6EE", "#201E1D"


def pill(text: str, color: str) -> dict:
    """Annotation label: a pill with dark text on a light fill and a border in the line colour."""
    return {"text": text, "borderColor": color, "borderWidth": 2, "borderRadius": 11,
            "style": {"color": LABEL_TEXT, "background": LABEL_BG, "fontSize": "12px", "fontWeight": 600,
                      "fontFamily": FONT, "padding": {"left": 9, "right": 9, "top": 3, "bottom": 4}}}


def hline(value: float, label: str, color: str = "#A19786", left: bool = False) -> dict:
    a = {"y": value, "borderColor": color, "strokeDashArray": 4, "label": pill(label, color)}
    if left:
        a["label"].update({"position": "left", "textAnchor": "start"})
    return a


def heading(text: str, icon: str = "mdi:chart-areaspline") -> dict:
    return {"type": "heading", "heading": text, "heading_style": "title", "icon": icon}


def note(markdown: str, columns="full") -> dict:
    return {"type": "markdown", "content": markdown, "text_only": True, "grid_options": {"columns": columns}}


def section(cards: list, column_span: int = 3) -> dict:
    return {"type": "grid", "column_span": column_span, "cards": cards}


def group(title: str, cards: list, icon: str | None = None, column_span: int | None = None) -> dict:
    h = {"type": "heading", "heading": title, "heading_style": "title"}
    if icon:
        h["icon"] = icon
    sec = {"type": "grid", "cards": [h] + list(cards)}
    if column_span:
        sec["column_span"] = column_span
    return sec


def page_header(title: str) -> dict:
    """First section of every view: the page title and the theme button (custom:cw-kop of module base)."""
    return {"type": "grid", "column_span": 3, "cards": [{"type": "custom:cw-kop", "title": title, "grid_options": {"columns": "full"}}]}


def status_row(chips: list[dict]) -> dict:
    """custom:cw-status (module base): icon + value chips. chips: {icon, entity, label, title, info}."""
    return {"type": "custom:cw-status", "chips": chips, "grid_options": {"columns": "full"}}


def stats(title: str, entities: list[tuple], period: str = "day", days: int = 30, stat: str = "change",
          rows: int = 5, chart_type: str = "bar") -> dict:
    """statistics-graph; entities: (entity, name, hex colour)."""
    return {"type": "statistics-graph", "title": title,
            "entities": [{"entity": e, "name": n, "color": c} for e, n, c in entities],
            "period": period, "days_to_show": days, "chart_type": chart_type, "stat_types": [stat],
            "grid_options": {"columns": "full", "rows": rows}}


def deep_merge(a: dict, b: dict) -> None:
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            deep_merge(a[k], v)
        else:
            a[k] = v

"""Themes of module base: generates themes/<id>.yaml from tools/palettes.yaml and checks the contrast of every theme.

Organic (themes/organic.yaml) is tuned by hand; every other theme gets the same cw-* tokens (light and dark), the
same fonts and shapes as Organic, and the regular HA variables derived from its palette the way Organic does.
The check: text and icons >= 4.5:1 on card, page and raised surface, also cw-accent-ink and the energy palette as
the kit's screens use it for icons (ink()); HA's own text on its primary/accent fills; the sidebar.
It also checks that the committed files are up to date and that strings.yaml and _themes.jinja know every theme.

  uv run --quiet --with-requirements tools/requirements.txt python modules/base/tools/build_themes.py          # check only
  uv run --quiet --with-requirements tools/requirements.txt python modules/base/tools/build_themes.py --write  # (re)write, then check
  (check only exits 1 on a problem)
  add -v to list every pair, not only the failing ones.

The theme files keep a fill.py marker as their key (the theme name comes from strings.yaml in house.language), so
they are rendered by tools/fill.py like every other module file; run this script on the kit, not on a build.
"""
import pathlib
import re
import sys

import yaml

BASE = pathlib.Path(__file__).resolve().parent.parent
THEMES = BASE / "themes"
PALETTES = pathlib.Path(__file__).resolve().with_name("palettes.yaml")
STRINGS = BASE / "strings.yaml"
PARTIAL = BASE / "_themes.jinja"
HAND_MADE = "organic"
MIN = 4.5
# The key of a theme file: a fill.py marker for t('theme_name_<id>'). Built from parts so fill.py never renders it
# in this script.
OPEN, CLOSE = "<" + "@", "@" + ">"
MARKER = re.compile(re.escape(OPEN) + r".*?" + re.escape(CLOSE))


def key_marker(theme_id):
    return f"{OPEN} t('theme_name_{theme_id}') {CLOSE}"


# ---------- colour maths (same formulas as the screens' ink()) ----------
def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexs(c):
    return "#" + "".join(f"{round(max(0, min(255, v))):02X}" for v in c)


def lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


def mix(a, b, t):
    return hexs(tuple(p + (q - p) * t for p, q in zip(rgb(a), rgb(b))))


def ink(c, text, card, bg, minimum=MIN):
    """ink() of the screens: move c towards the text colour until it reaches `minimum` on card and page."""
    out, t = c, 0.05
    while t < 0.96 and min(contrast(out, card), contrast(out, bg)) < minimum:
        out = mix(c, text, t)
        t += 0.05
    return out


# ---------- theme generation ----------
def mode_vars(p, energy, mode):
    light = mode == "light"
    e = energy[mode]
    # HA also uses primary-color as text (links, text buttons): in light the fill accent is too pale for that, so
    # HA gets the ink tone (its fills turn a bit deeper); cw-accent keeps the fill tone for the own screens.
    prim = p["ink"] if light else p["accent"]
    text_rgb = ", ".join(map(str, rgb(p["text"])))
    return {
        "cw-bg": p["bg"], "cw-card": p["card"], "cw-raised": p["raised"], "cw-line": p["line"], "cw-text": p["text"],
        "cw-muted": p["muted"], "cw-accent": p["accent"], "cw-accent-ink": p["ink"], "cw-on-accent": p["on"],
        "cw-good": p["good"], "cw-warn": p["warn"], "cw-bad": p["bad"],
        **{f"cw-{k}": c for k, c in e.items()},
        "energy-solar-color": e["zon"], "energy-grid-consumption-color": e["net"],
        "energy-grid-return-color": e["injectie"], "energy-battery-out-color": e["batterij"],
        "energy-battery-in-color": e["batterij"], "energy-non-fossil-color": e["wagen"],
        "primary-color": prim, "accent-color": p["second"],
        "rgb-primary-color": ", ".join(map(str, rgb(prim))),
        "rgb-accent-color": ", ".join(map(str, rgb(p["second"]))),
        "primary-background-color": p["bg"], "secondary-background-color": p["side"],
        "card-background-color": p["card"], "ha-card-background": p["card"],
        "ha-card-box-shadow": f"0 1px 2px rgba({text_rgb}, 0.14)" if light else "none",
        "primary-text-color": p["text"], "secondary-text-color": p["muted"],
        "disabled-text-color": mix(p["muted"], p["card"], 0.45),
        "divider-color": f"rgba({text_rgb}, 0.16)" if light else p["raised"],
        "state-icon-color": p["muted"],
        "app-header-background-color": p["bg"], "app-header-text-color": p["text"],
        "sidebar-background-color": p["side"], "sidebar-text-color": mix(p["text"], p["muted"], 0.5),
        "sidebar-icon-color": p["muted"], "sidebar-selected-icon-color": p["ink"],
        "sidebar-selected-text-color": p["text"],
        # Text on HA's own primary/accent fills (filled buttons, sidebar badge): never white on a light fill.
        "text-primary-color": "#FFFFFF" if contrast("#FFFFFF", prim) >= MIN else p["on"],
        "text-accent-color": "#FFFFFF" if contrast("#FFFFFF", p["second"]) >= MIN else p["bg"],
        "switch-checked-color": p["accent"], "input-fill-color": p["raised"],
        "state-cover-active-color": p["second"], "state-active-color": p["ink"],
        "state-switch-active-color": p["ink"], "state-inactive-color": p["muted"], "disabled-color": p["muted"],
        # Unavailable devices: same muted tone as "off" (HA uses disabled-text-color: 2.2:1); the tile text says why.
        "state-unavailable-color": p["muted"],
    }


def load_organic():
    """Organic as a dict; its key (a fill.py marker) is replaced before parsing."""
    text = (THEMES / f"{HAND_MADE}.yaml").read_text(encoding="utf-8")
    return next(iter(yaml.safe_load(MARKER.sub("Organic", text)).values()))


def render(theme_id, palette, organic, energy):
    """Text of themes/<id>.yaml for one palette."""
    shape = {k: v for k, v in organic.items() if k != "modes"}  # fonts and shapes: identical to Organic
    theme = {**shape, "modes": {m: mode_vars(palette[m], energy, m) for m in ("light", "dark")}}
    body = yaml.safe_dump({"__KEY__": theme}, sort_keys=False, allow_unicode=True, width=200)
    head = (f"# Theme {theme_id}: {palette['about']}\n"
            "# Generated by modules/base/tools/build_themes.py from tools/palettes.yaml: do not edit by hand.\n"
            f"# The theme name comes from strings.yaml (theme_name_{theme_id}). Deployed by modules/base/deploy.py.\n")
    return head + body.replace("__KEY__:", key_marker(theme_id) + ":", 1)


# ---------- check ----------
def check(theme, mode):
    """Returns (rows, fails): every foreground against the surfaces it is drawn on."""
    v = theme["modes"][mode]
    surf = {"card": v["cw-card"], "page": v["cw-bg"], "raised": v["cw-raised"]}
    pairs = [
        ("text", v["cw-text"], surf), ("muted", v["cw-muted"], surf), ("accent-ink", v["cw-accent-ink"], surf),
        ("good", v["cw-good"], surf), ("warn", v["cw-warn"], surf), ("bad", v["cw-bad"], surf),
        ("state-icon", v["state-icon-color"], surf), ("state-active", v["state-active-color"], surf),
        ("state-inactive", v["state-inactive-color"], surf),
        ("unavailable", v.get("state-unavailable-color", v["disabled-text-color"]), surf),
        ("cover open", v["state-cover-active-color"], surf), ("accent-color", v["accent-color"], surf),
        ("primary as text", v["primary-color"], surf),
        ("text on accent", v["cw-on-accent"], {"accent": v["cw-accent"]}),
        ("HA text on primary", v.get("text-primary-color", "#FFFFFF"), {"primary": v["primary-color"]}),
        ("HA text on accent", v.get("text-accent-color", "#FFFFFF"), {"accent-color": v["accent-color"]}),
        ("sidebar text", v["sidebar-text-color"], {"sidebar": v["sidebar-background-color"]}),
        ("sidebar icon", v["sidebar-icon-color"], {"sidebar": v["sidebar-background-color"]}),
        ("sidebar selected", v["sidebar-selected-icon-color"], {"sidebar": v["sidebar-background-color"]}),
    ]
    # Energy colours as icons: through ink() (card + page), as the own screens do.
    for k in ("zon", "batterij", "net", "huis", "injectie", "wagen", "water"):
        c = v.get(f"cw-{k}")
        if c:
            pairs.append((f"{k} (ink)", ink(c, v["cw-text"], v["cw-card"], v["cw-bg"]),
                          {"card": v["cw-card"], "page": v["cw-bg"]}))
    rows, fails = [], 0
    for label, fg, bgs in pairs:
        worst = min(contrast(fg, b) for b in bgs.values())
        ok = worst >= MIN
        fails += not ok
        rows.append((label, fg, worst, ok))
    return rows, fails


def consistency(ids):
    """Problems outside the colours: names in strings.yaml, the id list in _themes.jinja, stray theme files."""
    problems = []
    strings = yaml.safe_load(STRINGS.read_text(encoding="utf-8"))
    for theme_id in ids:
        names = strings.get(f"theme_name_{theme_id}") or {}
        for lang in ("en", "nl"):
            if not names.get(lang):
                problems.append(f"strings.yaml: theme_name_{theme_id} has no '{lang}' name")
    listed = re.search(r"set theme_ids = \[(.*?)\]", PARTIAL.read_text(encoding="utf-8"))
    listed = re.findall(r"'([\w-]+)'", listed.group(1)) if listed else []
    if sorted(listed) != sorted(ids):
        problems.append(f"_themes.jinja: theme_ids {listed} differs from the theme files {ids}")
    stray = sorted(p.stem for p in THEMES.glob("*.yaml") if p.stem not in ids)
    if stray:
        problems.append(f"themes/: no palette for {', '.join(stray)} (remove the file or add a palette)")
    return problems


def main():
    data = yaml.safe_load(PALETTES.read_text(encoding="utf-8"))
    energy, palettes = data["energy"], data["themes"]
    organic = load_organic()
    texts = {tid: render(tid, p, organic, energy) for tid, p in palettes.items()}
    problems = []
    if "--write" in sys.argv:
        for tid, text in texts.items():
            (THEMES / f"{tid}.yaml").write_text(text, encoding="utf-8")
            print("wrote", (THEMES / f"{tid}.yaml").relative_to(BASE.parent.parent))
    for tid, text in texts.items():
        path = THEMES / f"{tid}.yaml"
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            problems.append(f"themes/{tid}.yaml is not up to date with palettes.yaml: run --write")
    problems += consistency([HAND_MADE, *palettes])

    themes = {HAND_MADE: organic}
    themes.update({tid: next(iter(yaml.safe_load(MARKER.sub(tid, t)).values())) for tid, t in texts.items()})
    for tid, theme in themes.items():
        for mode in ("light", "dark"):
            rows, fails = check(theme, mode)
            worst = min(rows, key=lambda r: r[2])
            print(f"{tid:9} {mode:5}  {'OK  ' if not fails else 'FAIL'}  lowest {worst[2]:.2f}:1 ({worst[0]})")
            for label, fg, w, ok in rows:
                if not ok or "-v" in sys.argv:
                    print(f"    {'  ' if ok else 'x '}{label:18} {fg}  {w:.2f}:1")
            if fails:
                problems.append(f"{tid} {mode}: {fails} pair(s) under {MIN}:1")
    for p in problems:
        print("PROBLEM", p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()

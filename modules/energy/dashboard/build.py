"""Build the two energy dashboards from dashboard/config.json (rendered from house.yaml by tools/fill.py).

  python energy/dashboard/build.py            writes energy/dashboard/out/energy-analysis.json and energy-screen.json

The views are in views.py, the card factories in style.py. deploy.py imports build() and saves the result in Home
Assistant (lovelace/config/save); run this file alone to look at the JSON, or to paste a view by hand (Edit dashboard >
three dots > Raw configuration editor).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from views import Views  # noqa: E402


def load_config() -> dict:
    return json.loads((HERE / "config.json").read_text(encoding="utf-8"))


def build(cfg: dict | None = None) -> dict:
    """{'analysis': dashboard config, 'screen': dashboard config} for lovelace/config/save."""
    views = Views(cfg or load_config())
    return {"analysis": views.analysis_dashboard(), "screen": views.screen_dashboard()}


def write(out_dir: Path | None = None) -> dict[str, Path]:
    out_dir = out_dir or HERE / "out"
    out_dir.mkdir(exist_ok=True)
    cfg = load_config()
    built = build(cfg)
    paths = {}
    for key, name in (("analysis", cfg["dashboards"]["analysis"]), ("screen", cfg["dashboards"]["screen"])):
        p = out_dir / f"{name}.json"
        p.write_text(json.dumps(built[key], indent=1, ensure_ascii=False), encoding="utf-8")
        paths[key] = p
    return paths


def summary(dash: dict) -> str:
    """'path (n sections, m charts)' per view."""
    parts = []
    for v in dash["views"]:
        secs = v.get("sections") or []
        cards = [c for s in secs for c in s.get("cards", [])] + list(v.get("cards") or [])
        charts = sum(1 for c in cards if str(c.get("type", "")).startswith("custom:apexcharts"))
        parts.append(f"{v['path']} ({len(secs)} sections, {charts} charts)" if secs else f"{v['path']} (panel)")
    return ", ".join(parts)


if __name__ == "__main__":
    for key, p in write().items():
        print(key, "->", p)

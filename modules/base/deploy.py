<% from '_themes.jinja' import chosen_themes, default_light, default_dark with context %>
"""Deploy module 'base': the themes (Organic, Garden, ...) and the shared cw-* components (cw-thema.js).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python base/deploy.py [--default-theme] [--no-fonts] [--dry-run]

Steps:
  1. checks configuration.yaml for the lines of configuration.snippet.yaml (only reports, never edits it)
  2. creates the folders packages/, templates/, command_line/, themes/ and www/ when missing
  3. uploads the themes of house.yaml base.themes (default: all) to /config/themes/<id>.yaml, reloads the themes and
     names the themes with cw-* tokens that HA has but this build does not (leftovers, e.g. after a language change)
  4. uploads www/cw-thema.js to /config/www/ and registers it as dashboard resource /local/cw-thema.js?v=(VERSION in the file)
  5. registers the Google Fonts stylesheet (Figtree, Caprasimo) as a css resource (not with --no-fonts)
  --default-theme  also sets house.yaml base.default_theme as the default theme (light and dark) for every user
                   without an own choice
  --no-fonts       does not register the Google Fonts stylesheet (self-hosted fonts or none; README "Privacy");
                   an existing resource is left alone: delete it in Settings > Dashboards > Resources
  --dry-run        dry run: only prints what it would do, does not connect to Home Assistant
Uploading goes through the File editor app (HA OS / Supervised). Without it, copy the files yourself to the
paths printed with --dry-run. The /local/ path only works when /config/www existed at HA start: restart once
after the first upload.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

# Theme id (file themes/<id>.yaml) -> the name HA shows (strings.yaml theme_name_<id> in house.language).
THEMES = {
<% for id in chosen_themes %>
    <@ id | tojson @>: <@ t('theme_name_' ~ id) | tojson @>,
<% endfor %>
}
# Default theme per mode for --default-theme (house.yaml base.default_theme).
DEFAULT = {"light": <@ t('theme_name_' ~ default_light) | tojson @>, "dark": <@ t('theme_name_' ~ default_dark) | tojson @>}
THEME_DIR = HERE / "themes"
CARD = HERE / "www" / "cw-thema.js"
FOLDERS = ("packages", "templates", "command_line", "themes", "www")
FONTS = "https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700&display=swap"
# Fragments that must be present in configuration.yaml for the kit's modules to load.
REQUIRED = {
    "packages: !include_dir_named packages": "homeassistant: packages",
    "themes: !include_dir_merge_named themes": "frontend: themes",
    "template: !include_dir_merge_list templates": "template",
    "command_line: !include_dir_merge_list command_line": "command_line",
}


def check_configuration(editor: "ha_api.FileEditor") -> None:
    text = editor.read(f"{ha_api.CONFIG_DIR}/configuration.yaml")
    flat = " ".join(text.replace("/", " ").split())
    missing = [label for needle, label in REQUIRED.items() if " ".join(needle.split()) not in flat]
    if missing:
        print("configuration.yaml still misses:", ", ".join(missing))
        print("  -> merge configuration.snippet.yaml into configuration.yaml and restart HA")
    else:
        print("configuration.yaml: every line of the kit is there")


def check_themes() -> None:
    """After the reload: every uploaded theme must be there; name other themes with cw-* tokens (leftovers)."""
    themes = (ha_api.ws1({"type": "frontend/get_themes"}) or {}).get("themes") or {}
    missing = [name for name in THEMES.values() if name not in themes]
    if missing:
        print("not loaded by HA:", ", ".join(missing), "-> check the themes: line of configuration.yaml and the HA log")
    ours = set(THEMES.values())
    others = sorted(n for n, t in themes.items()
                    if n not in ours and isinstance(t, dict) and (t.get("modes") or {}).get("light", {}).get("cw-bg"))
    if others:
        print("other themes with cw-* tokens:", ", ".join(others))
        print("  -> a leftover of an older install or another house.language? Remove its file from /config/themes")
        print("     (README 'Migrating'); users who picked it fall back to the default theme")


def main() -> None:
    dry = "--dry-run" in sys.argv
    files = {tid: THEME_DIR / f"{tid}.yaml" for tid in THEMES}
    card_dst = f"{ha_api.CONFIG_DIR}/www/{CARD.name}"
    if dry:
        print("dry run: nothing sent")
        print("  folders:", ", ".join(f"{ha_api.CONFIG_DIR}/{f}" for f in FOLDERS))
        for tid, src in files.items():
            print("  upload", src.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/themes/{src.name}",
                  f"(theme {THEMES[tid]})")
        print("  frontend.reload_themes + check the theme list")
        print("  upload", CARD.relative_to(HERE.parent), "->", card_dst, "+ resource /local/" + CARD.name)
        print("  css resource", "skipped (--no-fonts)" if "--no-fonts" in sys.argv else FONTS)
        if "--default-theme" in sys.argv:
            print("  frontend.set_theme", DEFAULT["light"], "(light),", DEFAULT["dark"], "(dark)")
        return

    editor = ha_api.FileEditor()
    check_configuration(editor)
    for folder in FOLDERS:
        editor.ensure_folder(f"{ha_api.CONFIG_DIR}/{folder}")
    for src in files.values():
        editor.save(src, f"{ha_api.CONFIG_DIR}/themes/{src.name}")
    ha_api.reload_themes()
    check_themes()
    ha_api.publish_card(CARD)
    if "--no-fonts" not in sys.argv:
        ha_api.ensure_resource(FONTS)
    if "--default-theme" in sys.argv:
        for mode, name in DEFAULT.items():
            ha_api.rest("/api/services/frontend/set_theme", {"name": name, "mode": mode})
        print(f"default theme: {DEFAULT['light']} (light), {DEFAULT['dark']} (dark)")
    print("done. Pick the theme per user with the theme button or in Profile > Theme, or use --default-theme.")


if __name__ == "__main__":
    main()

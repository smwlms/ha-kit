"""Deploy module 'doorbell': helpers, archive sensor, TvOverlay, automations, scripts and the cw-bezoeken card.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python doorbell/deploy.py [--dry-run]

Steps:
  1. uploads package.yaml -> packages/doorbell.yaml and command_line/doorbell.yaml (archive sensor, TvOverlay notify)
  2. with a TV: uploads tvoverlay/doorbell.py -> /config/tvoverlay/doorbell.py
  3. checks the configuration, reloads input_text and command_line
  4. writes the automations and scripts through the config API (same API as the UI editors) and reloads them
  5. uploads www/cw-bezoeken.js and registers it as dashboard resource /local/cw-bezoeken.js?v=(VERSION)
  6. checks the entities this module expects from the UI (calendar, ai_task, TTS, doorbell) and only reports
  --dry-run  dry run: only prints what it would do, does not connect to Home Assistant
Needs the base module first (folders packages/ and command_line/ and their lines in configuration.yaml).
Added the module 'parcel-service' later? Fill in again and run this script again: the doorbell automation and
script doorbell_reply get extra steps for it.
"""
import sys
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

MODULE = "doorbell"
HAS_TV = <@ 'True' if doorbell.tv | default(none) else 'False' @>
WITH_PARCEL_SERVICE = <@ 'True' if 'parcel-service' in modules else 'False' @>
# doorbell.ai_task none = no photo goes to an AI service (see README, Privacy); empty = the first ai_task entity
WITH_AI = <@ 'False' if (doorbell.ai_task | default(none) is sameas false) or ((doorbell.ai_task | default('', true) | string | trim | lower) in ['none', 'off', 'false']) else 'True' @>
UPLOADS = [
    (HERE / "package.yaml", f"{ha_api.CONFIG_DIR}/packages/{MODULE}.yaml"),
    (HERE / "command_line" / f"{MODULE}.yaml", f"{ha_api.CONFIG_DIR}/command_line/{MODULE}.yaml"),
] + ([(HERE / "tvoverlay" / "doorbell.py", f"{ha_api.CONFIG_DIR}/tvoverlay/doorbell.py")] if HAS_TV else [])
CARD = HERE / "www" / "cw-bezoeken.js"
# Entities that come from integrations set up in the UI (README.md, "What you do in the UI").
EXPECTED = {
    <@ entities.doorbell_camera | tojson @>: "doorbell camera (UniFi Protect)",
    <@ entities.doorbell_button | tojson @>: "bell button event (UniFi Protect)",
    <@ entities.doorbell_text | tojson @>: "LCD text of the doorbell (UniFi Protect)",
    <@ doorbell.calendar | tojson @>: "Local Calendar for the doorbell visits",
    <@ doorbell.tts | tojson @>: "Google Translate TTS",
}
PACKAGE = HERE / "package.yaml"
HELPERS = ("input_text",)
RELOADS = ("command_line",)


def exists(entity_id: str) -> bool:
    try:
        ha_api.rest(f"/api/states/{entity_id}")
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def check_ui_entities() -> None:
    missing = [f"{eid} ({why})" for eid, why in EXPECTED.items() if not exists(eid)]
    ai = [s["entity_id"] for s in ha_api.rest("/api/states") if s["entity_id"].startswith("ai_task.")]
    if not WITH_AI:
        print("  doorbell.ai_task is none: no photo goes to an AI service (no description)")
    elif not ai:
        missing.append("ai_task.* (integration Google Generative AI): without it the notification has no description")
    for line in missing:
        print("  missing:", line)
    if not missing:
        print("every expected entity exists")


def main() -> None:
    automations = HERE / "automations.yaml"
    scripts = HERE / "scripts.yaml"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config + reload", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ",", ", ".join(RELOADS))
        print("  automations:", ", ".join(a["id"] for a in _load(automations)))
        print("  scripts:", ", ".join(_load(scripts)))
        print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{CARD.name}",
              "+ resource /local/" + CARD.name)
        print("  check entities:", ", ".join(EXPECTED), "+ ai_task.*")
        print("  parcel-service steps:", "yes" if WITH_PARCEL_SERVICE else "no")
        return

    editor = ha_api.FileEditor()
    for src, dst in UPLOADS:
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, HELPERS)
    for domain in RELOADS:
        ha_api.rest(f"/api/services/{domain}/reload", {})
        print("reloaded:", domain)
    ha_api.push_automations_and_scripts(automations, scripts)
    ha_api.publish_card(CARD)
    check_ui_entities()
    print("done. Test: Developer tools > Actions > script.doorbell_reply (button: coming), then ring the doorbell.")


def _load(path: Path):
    import yaml

    return yaml.safe_load(path.read_text())


if __name__ == "__main__":
    main()

"""Deploy module 'doorbell': helpers, macros, archive sensor, TvOverlay, automations, scripts and the cw-bezoeken card.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python doorbell/deploy.py [--dry-run]

Steps:
  1. uploads package.yaml -> packages/doorbell.yaml (helpers, one input_select per person for who gets a
     notification), custom_templates/doorbell.jinja (who gets it, see LOGIC.md) and command_line/doorbell.yaml
     (archive sensor, TvOverlay notify)
  2. with a TV: uploads tvoverlay/doorbell.py -> /config/tvoverlay/doorbell.py
  3. checks the configuration, reloads input_text, input_select, the custom templates and command_line
  4. writes the automations and scripts through the config API (same API as the UI editors) and reloads them
  5. uploads www/cw-bezoeken.js and registers it as dashboard resource /local/cw-bezoeken.js?v=(VERSION)
  6. checks the entities this module expects from the UI (calendar, ai_task, TTS, doorbell) and only reports
  7. prints the Home Assistant user id of every person without people[].user_id (for the cards in
     lovelace/doorbell.yaml) and warns when a filled-in one differs; copy it into house.yaml yourself
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
    (HERE / "custom_templates" / f"{MODULE}.jinja", f"{ha_api.CONFIG_DIR}/custom_templates/{MODULE}.jinja"),
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
# input_select: always reloaded, so the helpers of a person who left people (or doorbell.recipients) disappear.
HELPERS = ("input_text", "input_select")
RELOADS = ("command_line",)
<% from '_doorbell.jinja' import recipients with context %>
# Person entity and people[].user_id (None = not filled in) of everyone who may get a notification.
USER_IDS = {
<% for p in recipients %>
    <@ (p.get('person') or 'person.' ~ p.key) | tojson @>: (<@ p.key | tojson @>, <@ p.user_id | string | tojson if p.get('user_id') else 'None' @>),
<% endfor %>
}


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


def report_user_ids() -> None:
    """people[].user_id decides who sees which card of lovelace/doorbell.yaml; HA knows it as attribute of the person."""
    for person, (key, filled_in) in USER_IDS.items():
        try:
            found = ha_api.rest(f"/api/states/{person}")["attributes"].get("user_id")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            print(f"  people[].user_id for {key}: {person} does not exist")
            continue
        if not found:
            print(f"  people[].user_id for {key}: {person} is not linked to a user")
        elif not filled_in:
            print(f"  people[].user_id for {key}: {found} (from {person}; add it to house.yaml for the cards)")
        elif filled_in != found:
            print(f"  WARNING: people[].user_id for {key} is {filled_in}, but {person} belongs to user {found}")


def main() -> None:
    automations = HERE / "automations.yaml"
    scripts = HERE / "scripts.yaml"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in UPLOADS:
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check_config + reload", ha_api.describe_helper_reload(PACKAGE, HELPERS) + ", custom templates,",
              ", ".join(RELOADS))
        print("  who gets a notification (input_select):",
              ", ".join(ha_api.package_helpers(PACKAGE).get("input_select", [])) or "nobody has notify")
        print("  automations:", ", ".join(a["id"] for a in _load(automations)))
        print("  scripts:", ", ".join(_load(scripts)))
        print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{CARD.name}",
              "+ resource /local/" + CARD.name)
        print("  check entities:", ", ".join(EXPECTED), "+ ai_task.*")
        print("  parcel-service steps:", "yes" if WITH_PARCEL_SERVICE else "no")
        print("  report people[].user_id from:", ", ".join(USER_IDS) or "nobody")
        return

    editor = ha_api.FileEditor()
    for src, dst in UPLOADS:
        editor.save(src, dst)
    ha_api.check_config()
    ha_api.reload_helpers(PACKAGE, HELPERS)
    ha_api.rest("/api/services/homeassistant/reload_custom_templates", {})
    print("custom templates reloaded")
    for domain in RELOADS:
        ha_api.rest(f"/api/services/{domain}/reload", {})
        print("reloaded:", domain)
    ha_api.push_automations_and_scripts(automations, scripts)
    ha_api.publish_card(CARD)
    check_ui_entities()
    report_user_ids()
    print("done. Test: Developer tools > Actions > script.doorbell_reply (button: coming), then ring the doorbell.")


def _load(path: Path):
    import yaml

    return yaml.safe_load(path.read_text())


if __name__ == "__main__":
    main()

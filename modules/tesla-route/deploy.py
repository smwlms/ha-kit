"""Deploy module 'tesla-route': the integration teslemetry_route and the cards tesla-map-card and tesla-arrival-card.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python tesla-route/deploy.py [--dry-run] [--setup] [--integration]

Steps:
  1. uploads custom_components/teslemetry_route/* to /config/custom_components/teslemetry_route/
  2. checks the configuration (a new or changed integration needs a restart of Home Assistant: not done here)
  3. uploads www/tesla-map-card.js and www/tesla-arrival-card.js and registers them as dashboard resources
     (/local/<file>?v=VERSION). tesla-map-card.js first: tesla-arrival-card uses the badges it registers.
  --setup        one-off: enables the Teslemetry entities the cards read (disabled by default)
  --integration  after the restart: adds the integration "Teslemetry route" (same as Settings > Devices & services >
                 Add integration); does nothing when it is already there
  --dry-run      prints what it would do, does not connect to Home Assistant
The cards themselves go on a dashboard by hand: see lovelace/arrival.yaml and lovelace/tesla-map.yaml.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

DOMAIN = "teslemetry_route"
SRC = HERE / "custom_components" / DOMAIN
DST = f"{ha_api.CONFIG_DIR}/custom_components/{DOMAIN}"
CARDS = [HERE / "www" / "tesla-map-card.js", HERE / "www" / "tesla-arrival-card.js"]
# Cards of the module before its ids were translated (kit versions up to db5b2fe): their resources are reported, not
# removed (see README, "Migrating").
OLD_RESOURCES = ["/local/tesla-kaart.js", "/local/aankomst-card.js"]
# Teslemetry entities the cards read that the integration creates disabled (enabling an enabled one is harmless).
ENABLE = [
<% for a in cars %>
    <@ car_entity(a, 'destination') | tojson @>,
    <@ car_entity(a, 'distance_to_arrival') | tojson @>,
    <@ car_entity(a, 'time_to_arrival') | tojson @>,
    <@ car_entity(a, 'traffic_delay') | tojson @>,
    <@ car_entity(a, 'battery_at_arrival') | tojson @>,
    <@ car_entity(a, 'shift_state') | tojson @>,
    <@ car_entity(a, 'speed') | tojson @>,
<% endfor %>
]


def setup() -> None:
    msgs = [{"type": "config/entity_registry/update", "entity_id": e, "disabled_by": None} for e in ENABLE]
    for m, r in zip(msgs, ha_api.ws(msgs)):
        print("enable", m["entity_id"], "OK" if r["success"] else r.get("error", {}).get("message"))
    print("  enabled entities only get a value after reloading Teslemetry (or a restart)")


def add_integration() -> None:
    entries = ha_api.rest("/api/config/config_entries/entry")
    if any(e["domain"] == DOMAIN for e in entries):
        print("integration Teslemetry route is already there")
        return
    flow = ha_api.rest("/api/config/config_entries/flow", {"handler": DOMAIN})
    print("integration Teslemetry route:", flow.get("type"), flow.get("title") or flow.get("reason") or "")


def report_old_resources() -> None:
    old = [r["url"] for r in ha_api.ws1({"type": "lovelace/resources"})
           if r["url"].split("?")[0] in OLD_RESOURCES]
    if old:
        print("NOTE: resources of the earlier (Dutch) cards are still registered:", ", ".join(old),
              "- replace custom:tesla-kaart-card and custom:aankomst-card on your dashboards with the new cards"
              " (lovelace/*.yaml), then remove these resources in Settings > Dashboards > Resources")


def main() -> None:
    files = sorted(f for f in SRC.glob("*") if f.suffix in (".py", ".json"))
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        if "--setup" in sys.argv:
            print("  enable:", ", ".join(ENABLE))
        for f in files:
            print("  upload", f.relative_to(HERE.parent), "->", f"{DST}/{f.name}")
        print("  check_config")
        for js in CARDS:
            print("  upload", js.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{js.name}",
                  "+ resource /local/" + js.name)
        print("  report old resources:", ", ".join(OLD_RESOURCES))
        if "--integration" in sys.argv:
            print("  add integration", DOMAIN, "when it is missing (after the restart)")
        return

    if "--setup" in sys.argv:
        setup()
    if "--integration" in sys.argv:
        add_integration()
        return
    editor = ha_api.FileEditor()
    for f in files:
        editor.save(f, f"{DST}/{f.name}")
    ha_api.check_config()
    for js in CARDS:
        ha_api.publish_card(js)
    report_old_resources()
    print("done. Restart Home Assistant (Settings > System > Restart), then:")
    print("  uv run --with-requirements requirements.txt python tesla-route/deploy.py --integration")


if __name__ == "__main__":
    main()

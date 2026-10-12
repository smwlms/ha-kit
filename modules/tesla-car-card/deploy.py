<% from '_tesla_car_card.jinja' import reminder with context %>
"""Deploy module 'tesla-car-card': the card tesla-car-card, its pictures and the optional plug-in reminder.

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python tesla-car-card/deploy.py [--dry-run] [--no-images]

Steps:
  1. uploads www/images/*.webp to /config/www/ha-kit/tesla-car-card/images/ (skip with --no-images when they did not
     change; about 1 MB)
  2. uploads www/tesla-car-card.js to /config/www/ha-kit/tesla-car-card/ and registers it as a dashboard resource
     (/local/ha-kit/tesla-car-card/tesla-car-card.js?v=VERSION)
  3. with tesla_car_card.plug_in_reminder: true, writes automations.yaml (automation tesla_car_plug_in_reminder)
     through the config API (same as the automation editor). Built for: reminder <@ 'on' if reminder else 'off' @>.
  --dry-run  prints what it would do, does not connect to Home Assistant
The cards go on a dashboard by hand: see lovelace/tesla-car-view.yaml (a view, or one card per car).
The first upload into /config/www needs one restart of Home Assistant when that folder did not exist yet.
"""
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

FOLDER = "ha-kit/tesla-car-card"
CARD = HERE / "www" / "tesla-car-card.js"
IMAGES = sorted((HERE / "www" / "images").glob("*.webp"))
AUTOMATIONS = HERE / "automations.yaml"


def main() -> None:
    automations = yaml.safe_load(AUTOMATIONS.read_text()) or []
    ids = [a["id"] for a in automations]
    images_dst = f"{ha_api.CONFIG_DIR}/www/{FOLDER}/images"
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        if "--no-images" in sys.argv:
            print("  pictures: skipped (--no-images)")
        else:
            size = sum(f.stat().st_size for f in IMAGES) / 1e6
            print(f"  upload {len(IMAGES)} pictures ({size:.1f} MB) ->", images_dst)
        print("  upload", CARD.relative_to(HERE.parent), "->", f"{ha_api.CONFIG_DIR}/www/{FOLDER}/{CARD.name}",
              f"+ resource /local/{FOLDER}/{CARD.name}")
        print("  config API: automations", ", ".join(ids) if ids else "none (plug_in_reminder is off)")
        return

    if "--no-images" not in sys.argv:
        editor = ha_api.FileEditor()
        for f in IMAGES:
            editor.upload(f, images_dst)
    ha_api.publish_card(CARD, folder=FOLDER)
    if ids:
        ha_api.push_automations_and_scripts(AUTOMATIONS, None)
    print("done. Put the cards on a dashboard (lovelace/tesla-car-view.yaml), then follow the test plan in"
          " tesla-car-card/LOGIC.md.")


if __name__ == "__main__":
    main()

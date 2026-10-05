"""Deploy module 'room-sensor': put the ESPHome firmware files in /config/esphome/ (see room-sensor/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python room-sensor/deploy.py [--dry-run]

Steps:
  1. uploads esphome/kamersensor.yaml (shared base) and esphome/kamersensor-<room>.yaml (one per room with
     sensor: true) to /config/esphome/ through the File editor app; a file with the same name is overwritten
  2. reports which keys from module.yaml (secrets:) are missing in /config/esphome/secrets.yaml
     (key names only; values are never printed or uploaded)
  --dry-run  dry run: only prints what it would upload, does not connect to Home Assistant
Flashing is NOT done here and cannot be done through the HA API: install each device from the ESPHome Device
Builder (README.md, "Flashing"). Nothing else in Home Assistant is changed.
"""
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

ESPHOME_DIR = f"{ha_api.CONFIG_DIR}/esphome"
META = yaml.safe_load((HERE / "module.yaml").read_text()) or {}
# Shared base first, then one file per room with sensor: true.
FILES = [HERE / "esphome" / "kamersensor.yaml"] + sorted((HERE / "esphome").glob("kamersensor-*.yaml"))


def missing_secrets(editor: "ha_api.FileEditor") -> list[str] | None:
    """Keys from module.yaml that are not in secrets.yaml; None when the file cannot be read."""
    try:
        text = editor.read(f"{ESPHOME_DIR}/secrets.yaml")
    except Exception:  # noqa: BLE001 - File editor answers with an HTTP error for a missing file
        return None
    present = set(re.findall(r"(?m)^([A-Za-z0-9_]+)\s*:", text))
    return [k for k in META.get("secrets") or [] if k not in present]


def main() -> None:
    if len(FILES) == 1:
        sys.exit("no room with sensor: true in house.yaml: nothing to do")
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for f in FILES:
            print("  upload", f.relative_to(HERE.parent), "->", f"{ESPHOME_DIR}/{f.name}")
        print("  check: keys in", f"{ESPHOME_DIR}/secrets.yaml:", ", ".join(META.get("secrets") or []))
        return

    editor = ha_api.FileEditor()
    for f in FILES:
        editor.save(f, f"{ESPHOME_DIR}/{f.name}")
    missing = missing_secrets(editor)
    if missing is None:
        print(f"{ESPHOME_DIR}/secrets.yaml not found: create it in the ESPHome Device Builder (Secrets),")
        print("  with the keys from room-sensor/secrets.example.yaml")
    elif missing:
        print("secrets.yaml still misses:", ", ".join(missing), "(see room-sensor/secrets.example.yaml)")
    else:
        print("secrets.yaml: every key is there")
    print("done. Flash: ESPHome Device Builder > kamersensor-<room> > Install (first time over USB, see README).")


if __name__ == "__main__":
    main()

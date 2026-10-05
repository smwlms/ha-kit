"""Deploy module 'spa-spanet': put the ESPHome firmware in /config/esphome/ (see spa-spanet/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python spa-spanet/deploy.py [--dry-run]

Steps:
  1. uploads esphome/jacuzzi.yaml as /config/esphome/<spa.name>.yaml and esphome/spanet.h (the parser it
     includes) to /config/esphome/spanet.h through the File editor app (files with the same name are overwritten)
  2. reports which keys from module.yaml (secrets:) are missing in /config/esphome/secrets.yaml
     (key names only; values are never printed or uploaded)
  --dry-run  dry run: only prints what it would upload, does not connect to Home Assistant
Flashing is NOT done here and cannot be done through the HA API: the first flash goes over USB (README.md,
"Flashing"). Nothing else in Home Assistant is changed. The test/ and tools/ folders stay on your computer.
"""
<% from '_spa.jinja' import device_name with context %>
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ha_api  # noqa: E402

ESPHOME_DIR = f"{ha_api.CONFIG_DIR}/esphome"
META = yaml.safe_load((HERE / "module.yaml").read_text()) or {}
NAME = <@ device_name | tojson @>
FILES = {
    HERE / "esphome" / "jacuzzi.yaml": f"{ESPHOME_DIR}/{NAME}.yaml",
    HERE / "esphome" / "spanet.h": f"{ESPHOME_DIR}/spanet.h",
}


def missing_secrets(editor: "ha_api.FileEditor") -> list[str] | None:
    """Keys from module.yaml that are not in secrets.yaml; None when the file cannot be read."""
    try:
        text = editor.read(f"{ESPHOME_DIR}/secrets.yaml")
    except Exception:  # noqa: BLE001 - File editor answers with an HTTP error for a missing file
        return None
    present = set(re.findall(r"(?m)^([A-Za-z0-9_]+)\s*:", text))
    return [k for k in META.get("secrets") or [] if k not in present]


def main() -> None:
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check: keys in", f"{ESPHOME_DIR}/secrets.yaml:", ", ".join(META.get("secrets") or []))
        return

    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    missing = missing_secrets(editor)
    if missing is None:
        print(f"{ESPHOME_DIR}/secrets.yaml not found: create it in the ESPHome Device Builder (Secrets),")
        print("  with the keys from spa-spanet/secrets.example.yaml")
    elif missing:
        print("secrets.yaml still misses:", ", ".join(missing), "(see spa-spanet/secrets.example.yaml)")
        if "spa_api_encryption_key" in missing:
            print("  upgrading? copy the value of jacuzzi_api_encryption_key to spa_api_encryption_key")
    else:
        print("secrets.yaml: every key is there")
    print(f"done. First flash over USB (README, 'Flashing'), then Device Builder > {NAME} > Install > Wirelessly.")


if __name__ == "__main__":
    main()

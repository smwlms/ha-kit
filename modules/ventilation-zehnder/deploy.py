"""Deploy module 'ventilation-zehnder': put the ESPHome firmware in /config/esphome/ (see ventilation-zehnder/README.md).

Run from the filled-in folder (output of tools/fill.py), with HA_URL and HA_TOKEN set (see ha_api.py):
  uv run --with-requirements requirements.txt python ventilation-zehnder/deploy.py [--dry-run]

Steps:
  1. uploads esphome/ventilation.yaml as /config/esphome/<ventilation.name>.yaml through the File editor app
     (a file with the same name is overwritten)
  2. with ventilation.comfoclime: true also esphome/components/comfoclime/* to /config/esphome/components/comfoclime/
  3. reports which keys from module.yaml (secrets:) are missing in /config/esphome/secrets.yaml
     (key names only; values are never printed or uploaded)
  --dry-run  dry run: only prints what it would upload, does not connect to Home Assistant
Flashing is NOT done here and cannot be done through the HA API: install from the ESPHome Device Builder
(README.md, "Flashing"). Nothing else in Home Assistant is changed.
"""
<% from '_ventilation.jinja' import device_name, clime, web with context %>
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
COMFOCLIME = <@ 'True' if clime else 'False' @>
WEB_SERVER = <@ 'True' if web else 'False' @>
SECRETS = list(META.get("secrets") or []) + (list(META.get("secrets_web_server") or []) if WEB_SERVER else [])
FILES = {HERE / "esphome" / "ventilation.yaml": f"{ESPHOME_DIR}/{NAME}.yaml"}
if COMFOCLIME:
    for f in sorted((HERE / "esphome" / "components" / "comfoclime").glob("*")):
        if f.is_file() and f.suffix in {".py", ".h"}:
            FILES[f] = f"{ESPHOME_DIR}/components/comfoclime/{f.name}"


def missing_secrets(editor: "ha_api.FileEditor") -> list[str] | None:
    """Keys from module.yaml that are not in secrets.yaml; None when the file cannot be read."""
    try:
        text = editor.read(f"{ESPHOME_DIR}/secrets.yaml")
    except Exception:  # noqa: BLE001 - File editor answers with an HTTP error for a missing file
        return None
    present = set(re.findall(r"(?m)^([A-Za-z0-9_]+)\s*:", text))
    return [k for k in SECRETS if k not in present]


def main() -> None:
    if "--dry-run" in sys.argv:
        print("dry run: nothing sent")
        for src, dst in FILES.items():
            print("  upload", src.relative_to(HERE.parent), "->", dst)
        print("  check: keys in", f"{ESPHOME_DIR}/secrets.yaml:", ", ".join(SECRETS))
        return

    editor = ha_api.FileEditor()
    for src, dst in FILES.items():
        editor.save(src, dst)
    missing = missing_secrets(editor)
    if missing is None:
        print(f"{ESPHOME_DIR}/secrets.yaml not found: create it in the ESPHome Device Builder (Secrets),")
        print("  with the keys from ventilation-zehnder/secrets.example.yaml")
    elif missing:
        print("secrets.yaml still misses:", ", ".join(missing), "(see ventilation-zehnder/secrets.example.yaml)")
        if "ventilation_api_encryption_key" in missing:
            print("  upgrading? copy the value of ventilatie_api_encryption_key to ventilation_api_encryption_key")
    else:
        print("secrets.yaml: every key is there")
    print(f"done. Flash: ESPHome Device Builder > {NAME} > Install (see README, first time over USB).")


if __name__ == "__main__":
    main()

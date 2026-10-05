## What and why

<!-- One or two sentences: what this pull request changes and why. Link the issue if there is one. -->

## Module(s)

<!-- e.g. new module heat-pump-vaillant, or a fix in gate -->

## Checklist

- [ ] `uv run --with-requirements tools/requirements.txt python tools/check.py --esphome` passes locally
- [ ] No personal names, addresses, coordinates, IPs, MAC addresses, e-mail addresses, phone numbers, tokens or passwords (only invented examples; `tools/scan.py` is clean)
- [ ] No screenshots of a real house unless masked
- [ ] Entity ids come from roles in `house.yaml` (`entities.*`, `car_entity()`), not hard-coded for one house
- [ ] New `house.yaml` fields are documented in `house.example.yaml` (what, required or optional, which module) and listed under `house_fields:` in `module.yaml`
- [ ] User-facing texts go through `t()` with an `en` text in `strings.yaml` (`nl` welcome)
- [ ] No `initial` on helpers the user tunes; start values in `defaults:` (set once by `deploy.py`)
- [ ] `LOGIC.md` describes every decision; its test plan was followed on a real Home Assistant, or the README status says "not tested on HA"

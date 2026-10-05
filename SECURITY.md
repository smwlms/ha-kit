# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: on the repository page go to **Security > Advisories > Report a vulnerability** (GitHub private vulnerability reporting). Only the maintainers see the report, and the fix can be prepared in a private security advisory before anything is published.

Include:

- the module or tool (e.g. `modules/doorbell`, `tools/fill.py`) and the kit version (commit)
- what an attacker can do, and under which conditions (on the LAN, as a Home Assistant user, from the internet)
- steps to reproduce with **invented** values

## Scope

In scope: the code and configuration of this kit: the tools in `tools/`, the module templates in `modules/`, the generated YAML, JavaScript cards, Python scripts and ESPHome firmware configuration, the GitHub workflow.

Out of scope: Home Assistant itself, its integrations and add-ons, ESPHome, Leaflet and other third-party projects the kit uses. Report those to the project concerned. A weakness that only exists because of a setting you changed against the documentation (e.g. a device web server without a password) is out of scope too, unless the documentation is wrong.

## What to expect

This is a hobby project maintained in spare time: handling is **best effort**, without a guaranteed response time. We aim to confirm a report within two weeks and to fix confirmed problems in the next commit on `main`, with credit in the advisory unless you prefer otherwise.

## Never post publicly

Not in an issue, a pull request, a discussion or a screenshot:

- your `house.yaml` or a filled-in build folder
- Home Assistant logs or traces (they contain names, places, entity ids and sometimes coordinates)
- tokens and keys: `HA_TOKEN`, the Mapbox token, `secrets.yaml`, API keys, ESPHome encryption keys

Replace them with invented values first (`tools/scan.py <file>` helps to find what is left). Did a token end up in public anyway? Revoke it right away (Home Assistant: Profile > Security > Long-lived access tokens; Mapbox: Account > Tokens) and create a new one.

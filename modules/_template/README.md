# <@ module.name @>

<@ module.description @>.

Copy this folder to `modules/<your-module>/` to start a new module; CONTRIBUTING.md explains every file.

## Requirements

| What | Why |
| ---- | --- |
| Module `base` | `packages/` in `configuration.yaml` |

## Fields in `house.yaml`

- `people[].name`: the first person is greeted in the notification.
- `entities.template_light` (optional): a light that turns on with the switch.

## Install

```bash
uv run --with-requirements requirements.txt python _template/deploy.py --dry-run
uv run --with-requirements requirements.txt python _template/deploy.py
```

## Test plan

See `LOGIC.md`, "Test plan".

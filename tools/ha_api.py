"""Shared Home Assistant access for the deploy scripts of every module.

The connection comes from the environment only, never from a file in the repo and never from a default:
    export HA_URL=http://<ip-or-host-of-your-ha>:8123   # or https://..., no trailing slash needed
    export HA_TOKEN=<long-lived access token>           # Profile -> Security -> Long-lived access tokens (admin user)

Uploading files uses the File editor app (add-on "File editor", slug core_configurator) through its ingress API,
so it needs Home Assistant OS or Supervised. Without it: copy the files yourself (Samba/SSH) to the paths printed.
Needs `websockets` (run deploy scripts with: uv run --with-requirements requirements.txt python <module>/deploy.py).
fill.py copies this file to the root of the filled-in folder, next to the module folders.
HA_TOKEN is an admin token: over http:// it travels unencrypted. That is only OK on your own LAN or over Tailscale/VPN;
the scripts print a warning when HA_URL is http:// and its host is not a private, loopback or Tailscale address.
"""
from __future__ import annotations

import asyncio
import fnmatch
import ipaddress
import json
import os
import re
import socket
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HA_URL = os.environ.get("HA_URL", "").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "")
CONFIG_DIR = "/homeassistant"  # how the File editor app sees the HA config folder (/config inside HA)


def _require() -> None:
    """Stop with a clear message when the connection is not configured; there is deliberately no default."""
    missing = [name for name, value in (("HA_URL", HA_URL), ("HA_TOKEN", HA_TOKEN)) if not value]
    if missing:
        sys.exit(
            f"Missing in the environment: {', '.join(missing)}.\n"
            "  export HA_URL=http://<address-of-your-ha>:8123\n"
            "  export HA_TOKEN=<long-lived access token>   (Profile > Security > Long-lived access tokens)\n"
            "There is deliberately no default address."
        )
    if not HA_URL.startswith(("http://", "https://")):
        sys.exit(f"HA_URL must start with http:// or https:// (now: {HA_URL[:12]}...).")
    _warn_plain_http()


TAILSCALE = ipaddress.ip_network("100.64.0.0/10")  # Tailscale (CGNAT range); traffic inside the tailnet is encrypted
LOCAL_SUFFIXES = (".local", ".lan", ".home.arpa", ".internal", ".ts.net")
_warned = False


def _local_address(host: str) -> bool:
    """True when `host` is (or resolves only to) a private, loopback, link-local or Tailscale address."""
    if host == "localhost" or host.endswith(LOCAL_SUFFIXES):
        return True
    try:
        addrs = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            addrs = {ipaddress.ip_address(info[4][0].split("%")[0]) for info in socket.getaddrinfo(host, None)}
        except (OSError, ValueError):
            return False
    return bool(addrs) and all(a.is_private or a.is_loopback or a.is_link_local or
                               (a.version == 4 and a in TAILSCALE) for a in addrs)


def _warn_plain_http() -> None:
    """Warn once when the token would go unencrypted over http:// to an address outside the LAN or tailnet."""
    global _warned
    if _warned or not HA_URL.startswith("http://"):
        return
    _warned = True
    host = urllib.parse.urlsplit(HA_URL).hostname or ""
    if not _local_address(host):
        print(f"WARNING: HA_URL is http:// to {host}, which is not a LAN, loopback or Tailscale address: the admin "
              "token HA_TOKEN goes over the network unencrypted. Use https:// (e.g. Nabu Casa or a reverse proxy) "
              "or connect over Tailscale/VPN.", file=sys.stderr)


def rest(path: str, body=None, method: str | None = None, timeout: int = 120):
    """REST call on the HA API; body None = GET."""
    _require()
    req = urllib.request.Request(
        f"{HA_URL}{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read() or "null")


async def _ws(msgs: list[dict]) -> list[dict]:
    import websockets

    url = ("wss://" if HA_URL.startswith("https") else "ws://") + HA_URL.split("://", 1)[1] + "/api/websocket"
    async with websockets.connect(url, max_size=64 * 1024 * 1024) as w:
        await w.recv()
        await w.send(json.dumps({"type": "auth", "access_token": HA_TOKEN}))
        auth = json.loads(await w.recv())
        if auth.get("type") != "auth_ok":
            sys.exit(f"websocket: authentication failed ({auth.get('message', auth.get('type'))})")
        out = []
        for i, m in enumerate(msgs, 1):
            await w.send(json.dumps({**m, "id": i}))
            while True:
                r = json.loads(await w.recv())
                if r.get("id") == i and r.get("type") == "result":
                    out.append(r)
                    break
        return out


def ws(msgs: list[dict]) -> list[dict]:
    """Send websocket commands in order; returns the raw result messages (check r['success'])."""
    _require()
    return asyncio.run(_ws(msgs))


def ws1(msg: dict):
    """One websocket command; exits on failure, returns its result."""
    r = ws([msg])[0]
    if not r["success"]:
        sys.exit(f"{msg['type']}: {r.get('error')}")
    return r.get("result")


class FileEditor:
    """Upload files into the HA config folder through the File editor app's ingress API."""

    def __init__(self) -> None:
        sup = ws([{"type": "supervisor/api", "endpoint": "/ingress/session", "method": "post"},
                  {"type": "supervisor/api", "endpoint": "/addons/core_configurator/info", "method": "get"}])
        if not all(r["success"] for r in sup):
            sys.exit("File editor app not reachable (HA OS/Supervised only; the app must be installed and running).\n"
                     "Copy the files to /config yourself instead.")
        self.session = sup[0]["result"]["session"]
        self.entry = sup[1]["result"]["ingress_entry"]

    def _call(self, path: str, form: dict | None = None) -> str:
        req = urllib.request.Request(
            f"{HA_URL}{self.entry}{path}",
            data=None if form is None else urllib.parse.urlencode(form).encode(),
            headers={"Cookie": f"ingress_session={self.session}"},
        )
        return urllib.request.urlopen(req, timeout=30).read().decode()

    def read(self, path: str) -> str:
        return self._call("/api/file?filename=" + urllib.parse.quote(path))

    def ensure_folder(self, path: str) -> None:
        """Create path (and its parents) below CONFIG_DIR; the File editor does not create folders on save."""
        rel = Path(path).relative_to(CONFIG_DIR)
        cur = Path(CONFIG_DIR)
        for part in rel.parts:
            listing = json.loads(self._call("/api/listdir?path=" + urllib.parse.quote(str(cur))))["content"]
            if not any(x["name"] == part and x["type"] == "dir" for x in listing):
                print("folder", cur / part, "→", self._call("/api/newfolder", {"path": str(cur), "name": part}))
            cur = cur / part

    def save(self, src: Path, dst: str) -> None:
        self.ensure_folder(str(Path(dst).parent))
        msg = json.loads(self._call("/api/save", {"filename": dst, "text": src.read_text()}))["message"]
        print("upload", src.name, "→", dst, ":", msg)


def check_config() -> None:
    """Exit when the HA configuration does not validate."""
    check = rest("/api/config/core/check_config", {})
    print("check_config:", check["result"], check.get("errors") or "")
    if check["result"] != "valid":
        sys.exit("configuration invalid: nothing reloaded")


def push_automations_and_scripts(automations: Path | None, scripts: Path | None) -> None:
    """Write automations/scripts through the config API (the same API as the UI editors) and reload them.
    Needs automation: !include automations.yaml and script: !include scripts.yaml (the HA default)."""
    import yaml

    if automations:
        for a in yaml.safe_load(automations.read_text()):
            print("automation", a["id"], rest(f"/api/config/automation/config/{a['id']}", a)["result"])
    if scripts:
        for sid, cfg in yaml.safe_load(scripts.read_text()).items():
            print("script", sid, rest(f"/api/config/script/config/{sid}", cfg)["result"])


def publish_card(js: Path, folder: str = "") -> None:
    """Upload a dashboard card (or another frontend file) to /config/www[/<folder>] and register it as a Lovelace
    resource /local/[<folder>/]<file>?v=VERSION (VERSION from `const VERSION = "..."` in the file, else 1); an
    existing resource with the same path gets the new version. Phase-4 modules pass folder="ha-kit/<module>".
    The /local/ path only works when the www folder existed when HA started: restart once after the first upload."""
    text = js.read_text()
    version = text.split('const VERSION = "', 1)[1].split('"', 1)[0] if 'const VERSION = "' in text else "1"
    rel = f"{folder.strip('/')}/{js.name}" if folder.strip("/") else js.name
    FileEditor().save(js, f"{CONFIG_DIR}/www/{rel}")
    url = f"/local/{rel}?v={version}"
    resources = ws1({"type": "lovelace/resources"})
    mine = [r for r in resources if r["url"].split("?")[0] == f"/local/{rel}"]
    if mine:
        ws1({"type": "lovelace/resources/update", "resource_id": mine[0]["id"], "res_type": "module", "url": url})
        print("resource updated:", url)
    else:
        ws1({"type": "lovelace/resources/create", "res_type": "module", "url": url})
        print("resource added:", url)


def ensure_resource(url: str, res_type: str = "css") -> None:
    """Register an external Lovelace resource (e.g. a font stylesheet) once; leaves an existing one untouched."""
    if any(r["url"] == url for r in ws1({"type": "lovelace/resources"})):
        print("resource already there:", url)
        return
    ws1({"type": "lovelace/resources/create", "res_type": res_type, "url": url})
    print("resource added:", url)


def entity_ids() -> set[str]:
    """Every entity_id Home Assistant has a state for right now."""
    return {s["entity_id"] for s in rest("/api/states")}


def _hms(text: str) -> str:
    """'7:30' / '07:30' / '07:30:00' -> '07:30:00'."""
    parts = text.split(":") + ["00"]
    return ":".join(p.zfill(2) for p in parts[:3])


def _datetime_data(value) -> dict:
    """Service data for input_datetime.set_datetime from a default: time, date, date + time, or the data itself."""
    if isinstance(value, dict):
        return value
    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return {"date": text}
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)", text)
    if m:
        return {"datetime": f"{m.group(1)} {_hms(m.group(2))}"}
    if re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", text):
        return {"time": _hms(text)}
    raise ValueError(f"no time or date: {value!r} (expected HH:MM, YYYY-MM-DD or YYYY-MM-DD HH:MM)")


def _default_call(entity_id: str, value) -> tuple[str, dict] | None:
    """(service, data) that gives one helper its default; None for a domain without defaults (e.g. zone.*)."""
    domain = entity_id.split(".", 1)[0]
    if domain == "input_boolean":
        return f"input_boolean/turn_{'on' if str(value).lower() in ('on', 'true') else 'off'}", {}
    if domain == "input_number":
        return "input_number/set_value", {"value": value}
    if domain == "input_datetime":
        return "input_datetime/set_datetime", _datetime_data(value)
    if domain == "input_text":
        return "input_text/set_value", {"value": str(value)}
    if domain == "input_select":
        return "input_select/select_option", {"option": str(value)}
    return None


def set_defaults(values: dict, before: set[str], after: set[str] | None = None) -> list[str]:
    """Give helpers their default ONCE: only a helper that is new (it exists now and was not in `before`, the entity
    ids taken with entity_ids() before uploading the package) gets a value. An existing helper keeps the user's value,
    which is why the modules never use `initial` (that resets on every restart).

    values  {entity_id: default}, e.g. module.yaml `defaults:`. A key with * covers every new helper that matches it,
            the * standing for any text: at the end (input_number.shading_angle_*: one per facade) or in the middle
            (input_number.ev_plan_*_target: one per car). Per domain:
              input_boolean "on"/"off" (or true/false) · input_number a number · input_text text ·
              input_select an option · input_datetime "HH:MM[:SS]", "YYYY-MM-DD", "YYYY-MM-DD HH:MM" or service data.
            Other domains (e.g. zone.*: a radius used by --setup) are skipped.
    after   the entity ids after reloading; fetched when not given.
    Returns the helpers that got their default."""
    after = entity_ids() if after is None else after
    new = sorted(after - before)
    done: list[str] = []
    # Exact keys first, so they win over a wildcard that also matches; then the wildcards, the most specific (longest
    # literal text) first.
    def order(kv):
        key = kv[0]
        return (0, 0) if "*" not in key else (1, -len(key.replace("*", "")))

    for key, value in sorted(values.items(), key=order):
        targets = [e for e in new if fnmatch.fnmatchcase(e, key)] if "*" in key else ([key] if key in new else [])
        for entity_id in targets:
            if entity_id in done:
                continue
            try:
                call = _default_call(entity_id, value)
            except ValueError as e:
                print(f"NOTE: {entity_id}: {e}; set the value yourself in Settings > Helpers")
                continue
            if call is None:
                continue
            service, data = call
            rest(f"/api/services/{service}", {"entity_id": entity_id, **data})
            print("new:", entity_id, "=", value)
            done.append(entity_id)
    return done


def reload_themes() -> None:
    """Reload the frontend themes (after uploading a file into /config/themes)."""
    rest("/api/services/frontend/reload_themes", {})
    print("themes reloaded")

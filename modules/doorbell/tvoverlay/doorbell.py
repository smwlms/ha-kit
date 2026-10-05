"""Doorbell picture on the Google TV via TvOverlay (called by notify.tvoverlay_doorbell, command_line).

Reads the snapshot that script.doorbell_tv just wrote to /media/doorbell/tv.jpg, scales it down,
and POSTs it as base64 to TvOverlay. Base64 because TvOverlay (Android) does not load plain http://
image URLs (cleartext), and HA is usually only reachable over http on the LAN. No token involved.
The notify message (stdin) becomes the text line under the title.
Uploaded to /config/tvoverlay/doorbell.py by doorbell/deploy.py (only when doorbell.tv is filled in).
"""
import base64
import io
import json
import sys
import urllib.request

# TvOverlay REST API on the TV (default port 5001). Give the TV a fixed IP in your router.
<% set tv_ip = doorbell.tv_ip | default('', true) | string %>
<% if doorbell.tv | default(none) and not tv_ip is regex_search('^[A-Za-z0-9][A-Za-z0-9.-]*$') %><@ fail('house.yaml: doorbell.tv_ip must be the IP address or host name of the TV, e.g. 192.0.2.20') @><% endif %>
# Plain http on the LAN without authentication (TvOverlay has none): see doorbell/README.md, "Privacy".
TV = <@ ('http://' ~ tv_ip ~ ':5001/notify') | tojson @>
SNAPSHOT = "/media/doorbell/tv.jpg"
TITLE = <@ t('tv_title') | tojson @>
DEFAULT_MESSAGE = <@ t('ringing') | tojson @>

message = sys.stdin.read().strip() or DEFAULT_MESSAGE
data = open(SNAPSHOT, "rb").read()
try:
    from PIL import Image  # Pillow ships with Home Assistant core

    im = Image.open(io.BytesIO(data))
    im.thumbnail((640, 480))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=70)
    data = buf.getvalue()
except Exception as err:  # still send the full-size picture
    print(f"resize skipped: {err}", file=sys.stderr)

payload = {
    "id": "doorbell",  # same id replaces the previous popup, so repeated calls refresh the picture
    "title": TITLE,
    "message": message,
    "smallIcon": "mdi:doorbell",
    "corner": "top_end",
    "duration": 6,
    "image": base64.b64encode(data).decode("ascii"),
}
req = urllib.request.Request(TV, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=5) as resp:
    print(resp.status, len(data), "bytes")

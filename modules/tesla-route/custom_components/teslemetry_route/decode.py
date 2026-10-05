"""Decode Tesla Fleet Telemetry RouteLine values.

The exact wire format is not documented in Home Assistant: one third-party source describes it as a base64
protobuf whose field 1 holds a Google encoded polyline with precision 6. The decoder therefore tries the
candidates (protobuf string fields, the raw value) at precision 6 and 5 and keeps the first plausible line,
preferring one that passes close to the car.
"""

from __future__ import annotations

import base64
import binascii
import math

MAX_POINTS = 2000


def decode_polyline(text: str, precision: int) -> list[list[float]]:
    """Decode a Google encoded polyline; raises ValueError on malformed input."""
    factor = 10**precision
    points: list[list[float]] = []
    index = lat = lon = 0
    length = len(text)
    while index < length:
        deltas = []
        for _ in range(2):
            result = shift = 0
            while True:
                if index >= length:
                    raise ValueError("truncated polyline")
                byte = ord(text[index]) - 63
                index += 1
                if byte < 0 or byte > 63:
                    raise ValueError("invalid polyline character")
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append([lat / factor, lon / factor])
    return points


def _varint(data: bytes, pos: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        if pos >= len(data):
            raise ValueError("truncated varint")
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, pos


def protobuf_strings(data: bytes) -> list[tuple[int, str]]:
    """Return (field number, text) of the top-level length-delimited fields that are ASCII text."""
    out: list[tuple[int, str]] = []
    pos = 0
    while pos < len(data):
        key, pos = _varint(data, pos)
        field, wire = key >> 3, key & 7
        if wire == 0:
            _, pos = _varint(data, pos)
        elif wire == 1:
            pos += 8
        elif wire == 5:
            pos += 4
        elif wire == 2:
            size, pos = _varint(data, pos)
            chunk = data[pos : pos + size]
            pos += size
            try:
                text = chunk.decode("ascii")
            except UnicodeDecodeError:
                continue
            if text and all(63 <= ord(c) <= 126 for c in text):
                out.append((field, text))
        else:
            raise ValueError(f"unsupported wire type {wire}")
    return out


def _km(a: list[float], b: list[float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def _plausible(points: list[list[float]], near: list[float] | None) -> bool:
    if len(points) < 2:
        return False
    if not all(-90 <= p[0] <= 90 and -180 <= p[1] <= 180 for p in points):
        return False
    if near is not None:
        step = max(1, len(points) // 400)
        return min(_km(near, p) for p in points[::step]) < 5
    return True


def decode_route_line(raw: str, near: list[float] | None = None) -> tuple[list[list[float]], str]:
    """Return (points, format description); points is empty when nothing plausible was found."""
    candidates: list[tuple[str, str]] = []
    try:
        data = base64.b64decode(raw + "=" * (-len(raw) % 4), validate=True)
        candidates += [(f"protobuf field {f}", text) for f, text in protobuf_strings(data)]
    except (binascii.Error, ValueError):
        pass
    candidates.append(("raw polyline", raw))
    fallback: tuple[list[list[float]], str] | None = None
    for name, text in candidates:
        for precision in (6, 5):
            try:
                points = decode_polyline(text, precision)
            except ValueError:
                continue
            if _plausible(points, near):
                return thin(points), f"{name}, precision {precision}"
            if fallback is None and _plausible(points, None):
                fallback = (thin(points), f"{name}, precision {precision} (not near the car)")
    return fallback or ([], "unknown")


def thin(points: list[list[float]]) -> list[list[float]]:
    """Keep at most MAX_POINTS points (always the last one) and round to ~1 m."""
    step = max(1, math.ceil(len(points) / MAX_POINTS))
    kept = points[::step]
    if kept[-1] is not points[-1]:
        kept.append(points[-1])
    return [[round(p[0], 5), round(p[1], 5)] for p in kept]

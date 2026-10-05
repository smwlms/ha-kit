"""Scan files for secrets and personal data before an export or a commit.

  python3 tools/scan.py                 # the whole kit (git-ignored files skipped)
  python3 tools/scan.py path [path...]  # files and/or folders
  python3 tools/scan.py --staged        # the staged version of every staged file (pre-commit hook)

Two sources:
  1. Fixed patterns: private and Tailscale IPs, MAC addresses, ULIDs (config entry ids), serial numbers in
     entity ids, coordinates with 4+ decimals, e-mail addresses, Belgian phone numbers, tokens, and
     token:/password:/api_key: with a real value.
  2. A denylist of personal words (names, streets, car names, ...) OUTSIDE the repo, so the list itself never
     leaks: $HA_KIT_DENYLIST or ~/.config/ha-kit/denylist.txt, one entry per line, # = comment,
     case-insensitive, matched on word boundaries (an underscore counts as a boundary, so it also hits
     entity ids).
     The denylist is REQUIRED (exit 2 without it) when the folder ~/.config/ha-kit/ exists (the maintainer's
     machine) or when HA_KIT_REQUIRE_DENYLIST=1. Otherwise (a contributor, CI) a missing denylist is a warning
     and only the fixed patterns run. Keep your own list there if you work with real data.

Inside binary files:
  - zip containers (.fzz Fritzing, .3mf 3D print, .zip): every text member is scanned like a file, shown as
    archive.fzz!member.fz;
  - PNG and JPEG metadata: text chunks (tEXt, zTXt, iTXt), XMP and JPEG comments are scanned like text; EXIF with
    GPS coordinates is a hit, other EXIF/IPTC metadata (camera, date, author) a warning. Strip it with e.g.
    `exiftool -all= file.jpg` or by exporting without metadata.
Warnings (exit 0) for things that may be personal but often are not: 12-hex entity suffixes (MAC?) and pairs of
3-decimal numbers that look like a latitude 49-54 and longitude 2-7 (Belgium and around, ~100 m precision) on the
same or the next line.

Deliberate exceptions live in scan-allowlist.txt: `file-glob<TAB>regex<TAB>reason` per line.
A hit is allowed when its text lies inside a match of the regex on the same line of a matching file.

Output is file:line:type with at most 3 characters of the value (never the full value).
Exit 0 = clean, 1 = hits, 2 = configuration problem.
"""
from __future__ import annotations

import fnmatch
import io
import os
import re
import struct
import subprocess
import sys
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
ALLOW_FILE = KIT / "scan-allowlist.txt"
CONFIG_DIR = Path.home() / ".config" / "ha-kit"
DEFAULT_DENYLIST = CONFIG_DIR / "denylist.txt"
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv"}
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".stl", ".3mf", ".fzz", ".svg", ".pdf", ".zip",
          ".gz", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".wav", ".sqlite", ".db", ".pyc"}

OCTET = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)"
NB = r"(?<![\w.])"  # not preceded by a word character or a dot
NA = r"(?![\w.]?\d)"  # not followed by (a dot and) another digit

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("private-ip", re.compile(
        NB + rf"(?:10\.{OCTET}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.{OCTET}\.{OCTET}" + NA)),
    ("tailscale-ip", re.compile(NB + rf"100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.{OCTET}\.{OCTET}" + NA)),
    ("mac", re.compile(r"(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])")),
    ("ulid", re.compile(r"(?<![0-9A-Za-z])[0-7][0-9A-HJKMNP-TV-Z]{25}(?![0-9A-Za-z])")),
    ("serial-number", re.compile(r"(?<![0-9A-Za-z])[a-z][a-z0-9]*(?:[._][a-z0-9]+)*_\d{8,}(?![0-9])")),
    ("coordinate", re.compile(r"(?<![\w.])-?(?:49|5[0-4]|[2-7])\.\d{4,}(?![\w.])")),
    ("email", re.compile(r"(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    ("phone", re.compile(r"(?<![\w+])(?:\+32|0032)[\s./-]?\(?0?\)?\d(?:[\s./-]?\d){7,9}(?!\d)")),
    ("token-jwt", re.compile(r"eyJ[A-Za-z0-9_-]{10,}")),
    ("token-mapbox", re.compile(r"(?<![\w.])pk\.[A-Za-z0-9_-]{20,}")),
    ("token-sk", re.compile(r"(?<![\w-])sk-[A-Za-z0-9_-]{16,}")),
    ("token-google", re.compile(r"AIza[0-9A-Za-z_-]{30,}")),
    ("token-github", re.compile(r"(?<![\w])gh[opsu]_[A-Za-z0-9]{20,}")),
]
WARN_PATTERNS: list[tuple[str, re.Pattern]] = [
    # 12 hex characters after an underscore: often a MAC address as entity suffix (shelly1_<mac>).
    ("mac-suffix?", re.compile(r"(?<=_)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12}(?![0-9A-Za-z])")),
]
# 3 decimals (~100 m): a latitude 49-54 and a longitude 2-7 close together = maybe a real place (warning only).
LAT3 = re.compile(r"(?<![\w.])(?:49|5[0-4])\.\d{3}(?![\w.]?\d)")
LON3 = re.compile(r"(?<![\w.])[2-7]\.\d{3}(?![\w.]?\d)")
ARCHIVES = {".fzz", ".3mf", ".zip"}
IMAGES = {".png", ".jpg", ".jpeg"}
SAFE_EMAIL_DOMAINS = re.compile(r"@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|example|invalid|test|localhost)$", re.I)
SECRET_KEY = re.compile(
    r"""(?i)(?<![\w-])["']?(token|password|passwd|api_key|apikey|secret)["']?\s*[:=]\s*(.+)$""")
PLACEHOLDER_VALUE = re.compile(
    r"""(?x)^(
        |!secret\b.*            # YAML secret reference
        |<[^>]*>|<@.*@>|\$\{.*\}|\{\{.*\}\}|%\(.*\)s
        |(?i:null|none|~|true|false)|""|''
        |[A-Z_][A-Z0-9_]*       # env var name (upper case only)
        |.*(?i:plak|jouw|your|hier|here|paste|xxx|\.\.\.|…|changeme|voorbeeld|example).*
    )$""")


@dataclass
class Hit:
    file: str
    line: int
    kind: str
    value: str
    warn: bool = False

    def show(self) -> str:
        shown = self.value[: min(3, max(1, len(self.value) // 3))]
        level = "warning" if self.warn else "hit"
        return f"{self.file}:{self.line}:{self.kind} {shown}*** ({level})"


def denylist_required() -> bool:
    """Required on the maintainer's machine (~/.config/ha-kit/ exists) or when HA_KIT_REQUIRE_DENYLIST=1."""
    return os.environ.get("HA_KIT_REQUIRE_DENYLIST") == "1" or CONFIG_DIR.is_dir()


def load_denylist() -> re.Pattern | None:
    env = os.environ.get("HA_KIT_DENYLIST")
    path = Path(env).expanduser() if env else DEFAULT_DENYLIST
    if not path.is_file():
        where = "$HA_KIT_DENYLIST" if env else str(path)
        if not denylist_required():
            print(f"warning: no denylist ({where}); only the fixed patterns run, names and streets are not checked.",
                  file=sys.stderr)
            return None
        print(f"WARNING: no denylist found ({where}).\n"
              "  Without a denylist the scan does not see names, streets or car names. Create the file\n"
              "  (one word or phrase per line, # = comment) or set HA_KIT_DENYLIST. Scan stopped.",
              file=sys.stderr)
        sys.exit(2)
    words = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        word = raw.strip()
        if word and not word.startswith("#"):
            words.append(word)
    if not words:
        print(f"WARNING: denylist {path} is empty. Scan stopped.", file=sys.stderr)
        sys.exit(2)
    words.sort(key=len, reverse=True)  # longest first, so phrases win over their parts
    alternation = "|".join(re.escape(w) for w in words)
    return re.compile(rf"(?<![A-Za-z0-9])(?:{alternation})(?![A-Za-z0-9])", re.IGNORECASE)


def load_allowlist() -> list[tuple[str, re.Pattern]]:
    rules = []
    if not ALLOW_FILE.is_file():
        return rules
    for n, raw in enumerate(ALLOW_FILE.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) < 3 or not parts[2].strip():
            print(f"{ALLOW_FILE.name}:{n}: expected 'glob<TAB>regex<TAB>reason'", file=sys.stderr)
            sys.exit(2)
        try:
            rules.append((parts[0].strip(), re.compile(parts[1])))
        except re.error as e:
            print(f"{ALLOW_FILE.name}:{n}: invalid regex: {e}", file=sys.stderr)
            sys.exit(2)
    return rules


def display_path(path: Path) -> str:
    """Kit files relative to the kit root (what scan-allowlist.txt globs match), others relative to cwd."""
    path = path.resolve()
    if KIT == path or KIT in path.parents:
        return path.relative_to(KIT).as_posix()
    return Path(os.path.relpath(path)).as_posix()


def is_binary(path: Path, data: bytes) -> bool:
    return path.suffix.lower() in BINARY or b"\0" in data[:8192]


def secret_value_hit(line: str, yaml_like: bool) -> str | None:
    m = SECRET_KEY.search(line)
    if not m:
        return None
    value = m.group(2).strip().rstrip(",;").strip()
    value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
    quoted = len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'`"
    inner = value[1:-1] if quoted else value
    if PLACEHOLDER_VALUE.match(inner):
        return None
    if quoted:
        return inner if len(inner) >= 6 else None
    if yaml_like:
        return inner
    # In code an unquoted value is an expression (variable, call): only flag it when it looks like a literal.
    if re.fullmatch(r"[A-Za-z0-9_\-]{16,}", inner) and re.search(r"\d", inner) and re.search(r"[A-Za-z]", inner):
        return inner
    return None


def scan_text(name: str, text: str, deny: re.Pattern | None, allow: list[tuple[str, re.Pattern]]) -> list[Hit]:
    rules = [rx for glob, rx in allow if fnmatch.fnmatch(name, glob) or fnmatch.fnmatch(Path(name).name, glob)]
    yaml_like = Path(name).suffix.lower() in {".yaml", ".yml", ".env", ".ini", ".cfg", ".toml", ".txt", ""}
    hits: list[Hit] = []
    for n, line in enumerate(text.splitlines(), 1):
        allowed = [m.span() for rx in rules for m in rx.finditer(line)]

        def ok(span: tuple[int, int]) -> bool:
            return any(a <= span[0] and span[1] <= b for a, b in allowed)

        candidates: list[tuple[str, re.Match, bool]] = []
        for kind, rx in PATTERNS:
            candidates += [(kind, m, False) for m in rx.finditer(line)]
        for kind, rx in WARN_PATTERNS:
            candidates += [(kind, m, True) for m in rx.finditer(line)]
        if deny is not None:
            candidates += [("denylist", m, False) for m in deny.finditer(line)]
        reported: list[tuple[int, int]] = []
        for kind, m, warn in candidates:
            if kind == "email" and SAFE_EMAIL_DOMAINS.search(m.group(0)):
                continue
            # One report per spot: a denylist word inside an IP that a pattern already reported is not repeated.
            if ok(m.span()) or any(a <= m.start() and m.end() <= b for a, b in reported):
                continue
            reported.append(m.span())
            hits.append(Hit(name, n, kind, m.group(0), warn))
        secret = secret_value_hit(line, yaml_like)
        if secret is not None:
            start = line.find(secret)
            if not ok((start, start + len(secret))):
                hits.append(Hit(name, n, "secret-value", secret))
    hits += coordinate_pairs(name, text, rules)
    return hits


def coordinate_pairs(name: str, text: str, rules: list[re.Pattern]) -> list[Hit]:
    """Warnings for a 3-decimal latitude (49-54) with a 3-decimal longitude (2-7) on the same or the next line."""
    lines = text.splitlines()
    out: list[Hit] = []
    for n, line in enumerate(lines):
        allowed = [m.span() for rx in rules for m in rx.finditer(line)]
        for m in LAT3.finditer(line):
            if any(a <= m.start() and m.end() <= b for a, b in allowed):
                continue
            window = line[:m.start()] + " " + line[m.end():] + "\n" + (lines[n + 1] if n + 1 < len(lines) else "")
            if LON3.search(window):
                out.append(Hit(name, n + 1, "coordinate-3dp?", m.group(0), warn=True))
                break
    return out


def zip_members(name: str, data: bytes) -> list[tuple[str, bytes]]:
    """(archive!member, bytes) for every file inside a zip container (.fzz, .3mf, .zip)."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return [(f"{name}!{i.filename}", z.read(i)) for i in z.infolist() if not i.is_dir()]
    except (zipfile.BadZipFile, OSError, RuntimeError):
        return []


EXIF_TEXT_TAGS = {0x010E: "ImageDescription", 0x010F: "Make", 0x0110: "Model", 0x0131: "Software",
                  0x013B: "Artist", 0x8298: "Copyright"}


def exif_info(blob: bytes) -> tuple[bool, list[str]]:
    """(has GPS, 'Tag: text' lines) of a TIFF/EXIF block; tolerant of truncated or odd data."""
    if blob.startswith(b"Exif\0\0"):
        blob = blob[6:]
    if len(blob) < 8 or blob[:2] not in (b"II", b"MM"):
        return False, []
    end = "<" if blob[:2] == b"II" else ">"
    try:
        (ifd,) = struct.unpack_from(end + "I", blob, 4)
        (count,) = struct.unpack_from(end + "H", blob, ifd)
    except struct.error:
        return False, []
    gps, texts = False, []
    for i in range(min(count, 512)):
        try:
            tag, typ, num, value = struct.unpack_from(end + "HHII", blob, ifd + 2 + 12 * i)
        except struct.error:
            break
        if tag == 0x8825:
            gps = True
        elif tag in EXIF_TEXT_TAGS and typ == 2:
            raw = blob[ifd + 10 + 12 * i: ifd + 14 + 12 * i] if num <= 4 else blob[value:value + num]
            texts.append(f"{EXIF_TEXT_TAGS[tag]}: {raw.split(b'\0')[0].decode('latin-1')}")
    return gps, texts


def image_metadata(data: bytes) -> tuple[list[str], list[str]]:
    """(text to scan, findings) from PNG chunks or JPEG segments. Findings: 'exif-gps' (hit), 'exif'/'iptc' (warning)."""
    texts: list[str] = []
    found: list[str] = []

    def exif(blob: bytes) -> None:
        gps, lines = exif_info(blob)
        found.append("exif-gps" if gps else "exif")
        texts.extend(lines)

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        pos = 8
        while pos + 8 <= len(data):
            length, kind = struct.unpack_from(">I4s", data, pos)
            body = data[pos + 8: pos + 8 + length]
            pos += 12 + length
            if kind == b"tEXt":
                texts.append(body.replace(b"\0", b": ", 1).decode("latin-1"))
            elif kind == b"zTXt":
                key, _, rest = body.partition(b"\0")
                try:
                    texts.append(key.decode("latin-1") + ": " + zlib.decompress(rest[1:]).decode("latin-1"))
                except zlib.error:
                    pass
            elif kind == b"iTXt":
                key, _, rest = body.partition(b"\0")
                compressed, rest = rest[:1] == b"\1", rest[2:]
                rest = rest.split(b"\0", 2)[-1]  # skip language tag and translated keyword
                try:
                    rest = zlib.decompress(rest) if compressed else rest
                except zlib.error:
                    continue
                texts.append(key.decode("latin-1") + ": " + rest.decode("utf-8", errors="replace"))
            elif kind == b"eXIf":
                exif(body)
            elif kind == b"IEND":
                break
    elif data.startswith(b"\xff\xd8"):
        pos = 2
        while pos + 4 <= len(data) and data[pos] == 0xFF:
            marker = data[pos + 1]
            if marker in (0xD9, 0xDA):  # end of image / start of scan: no metadata after this
                break
            (length,) = struct.unpack_from(">H", data, pos + 2)
            body = data[pos + 4: pos + 2 + length]
            pos += 2 + length
            if marker == 0xE1 and body.startswith(b"Exif\0\0"):
                exif(body)
            elif marker == 0xE1 and b"<x:xmpmeta" in body[:4096]:
                texts.append(body.decode("utf-8", errors="replace"))
            elif marker == 0xED:
                found.append("iptc")
            elif marker == 0xFE:
                texts.append(body.decode("latin-1"))
    return texts, found


def ignored_by_git(files: list[Path]) -> set[Path]:
    """Files git ignores (house.yaml, build/, ...) when they lie inside a git work tree."""
    by_root: dict[Path, list[Path]] = {}
    for f in files:
        try:
            root = subprocess.run(["git", "-C", str(f.parent), "rev-parse", "--show-toplevel"],
                                  capture_output=True, text=True, check=True).stdout.strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
        by_root.setdefault(Path(root), []).append(f)
    ignored: set[Path] = set()
    for root, group in by_root.items():
        out = subprocess.run(["git", "-C", str(root), "check-ignore", "--stdin"], input="\n".join(map(str, group)),
                             capture_output=True, text=True).stdout
        ignored |= {Path(p).resolve() for p in out.splitlines() if p}
    return ignored


def collect(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for p in paths:
        if p.is_file():
            files.append(p.resolve())
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and not any(part in SKIP_DIRS for part in f.relative_to(p).parts):
                    files.append(f.resolve())
        else:
            print(f"does not exist: {p}", file=sys.stderr)
            sys.exit(2)
    if any(p.is_dir() for p in paths):
        skip = ignored_by_git(files)
        files = [f for f in files if f not in skip]
    return files


def staged() -> list[tuple[str, bytes]]:
    names = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
                           capture_output=True, check=True).stdout.decode().split("\0")
    out = []
    for name in filter(None, names):
        data = subprocess.run(["git", "show", f":{name}"], capture_output=True, check=True).stdout
        out.append((name, data))
    return out


def main() -> None:
    args = sys.argv[1:]
    use_staged = "--staged" in args
    args = [a for a in args if a != "--staged"]
    if any(a.startswith("-") for a in args):
        sys.exit(__doc__)
    deny = load_denylist()
    allow = load_allowlist()

    items: list[tuple[str, bytes]] = []
    if use_staged:
        items = staged()
    else:
        for f in collect([Path(a) for a in args] or [KIT]):
            items.append((display_path(f), f.read_bytes()))

    hits: list[Hit] = []
    scanned = 0
    queue = list(items)
    while queue:
        name, data = queue.pop(0)
        if any(part in SKIP_DIRS for part in Path(name).parts):
            continue
        suffix = Path(name.split("!")[-1]).suffix.lower()
        if suffix in ARCHIVES:
            queue += zip_members(name, data)
            scanned += 1
            continue
        if suffix in IMAGES:
            texts, found = image_metadata(data)
            scanned += 1
            for kind in found:
                hits.append(Hit(name, 0, kind, kind, warn=kind != "exif-gps"))
            if texts:
                hits += scan_text(name, "\n".join(texts), deny, allow)
            continue
        if is_binary(Path(name), data):
            continue
        scanned += 1
        hits += scan_text(name, data.decode("utf-8", errors="replace"), deny, allow)

    for h in hits:
        print(h.show())
    errors = [h for h in hits if not h.warn]
    warnings = len(hits) - len(errors)
    print(f"scan: {scanned} files, {len(errors)} hits, {warnings} warnings" + ("" if deny else " (no denylist)"))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()

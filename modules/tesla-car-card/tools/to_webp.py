"""Step 4 of making your own pictures (see the module README): the pictures the card shows, as WebP with alpha, at
twice the largest size the card shows them (retina): 1200 px wide for the car pictures, 820 px for the interior.
Metadata is not copied. Writes into the folder given as the second argument (e.g. ../www/images).
Usage: python3 to_webp.py <folder with the PNGs> <output folder>"""
import sys
from pathlib import Path

from PIL import Image

NAMES = [f"{m}-{n}" for m in "sy" for n in (
    "base", "frunk", "trunk", "fast", "fast-frunk", "fast-trunk", "home", "home-frunk", "home-trunk", "interior")]


def main() -> None:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    for n in NAMES:
        p = src / f"{n}.png"
        if not p.exists():
            print("missing", p)
            continue
        im = Image.open(p)
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        w = 820 if n.endswith("interior") else 1200
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        clean = Image.new(im.mode, im.size)
        clean.paste(im)
        clean.save(dst / f"{n}.webp", "WEBP", quality=90, method=6)
        print(n, im.size, (dst / f"{n}.webp").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()

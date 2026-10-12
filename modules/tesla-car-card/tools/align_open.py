"""Step 2 of making your own pictures (see the module README): open frunk / open trunk on the same canvas as the base
picture (align_base.py), without a cable that is in the open-lid photo.
The open-lid photos (cut-outs <m>-frunk-cutout.png, <m>-trunk-cutout.png) may show a charge cable and may be framed
differently. So only the part that changes is taken over:
- the open picture is scaled/shifted onto the base car: first guess from the body width, then a small search that
  minimises the difference on the doors (which are the same in both);
- frunk: everything left of a vertical seam behind the bonnet; trunk: right of a seam and above the charge port, so
  the plug and cable below stay from the cable-free base. Seams are feathered.
SEAM and CANVAS belong to the author's pictures: measure your own.
Usage: python3 align_open.py   -> <m>-frunk.png, <m>-trunk.png"""
import numpy as np
from PIL import Image, ImageFilter

CANVAS = {"s": 2435, "y": 2238}  # same widths as align_base.py (same metres per pixel for S and Y)
# per model: seam x behind the bonnet, seam x for the trunk, row limit above the charge port (base frame)
SEAM = {"s": (700, 1380, 705), "y": (640, 1270, 585)}


def body(alpha):
    """Rows/cols of the car; a body row at 3/4 height avoids the lifted lids."""
    a = alpha > 128
    r, c = np.where(a)
    mid = int(r.max() - 0.25 * (r.max() - r.min()))
    cs = np.where(a[mid])[0]
    return r.max(), cs.min(), cs.max()


def place(img, s, dx, dy, size):
    im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    if dx >= 0 and dy >= 0:
        out.alpha_composite(im, (round(dx), round(dy)))
    else:
        out.paste(im, (round(dx), round(dy)), im)
    return out


def fit(base, opn):
    """Scale and offset that put the open car on the base car."""
    bb, bl, br = body(np.array(base.getchannel("A")))
    ob, ol, orr = body(np.array(opn.getchannel("A")))
    s0 = (br - bl) / (orr - ol)
    g = np.array(base.convert("L"), np.float32)
    ys, xs = slice(int(bb * 0.62), int(bb * 0.9)), slice(int(bl + 0.38 * (br - bl)), int(bl + 0.62 * (br - bl)))
    best = None
    for s in s0 * np.linspace(0.985, 1.015, 7):
        for ddx in range(-8, 9, 2):
            for ddy in range(-8, 9, 2):
                dx, dy = bl - ol * s + ddx, bb - ob * s + ddy
                o = np.array(place(opn, s, dx, dy, base.size).convert("L"), np.float32)
                err = np.abs(o[ys, xs] - g[ys, xs]).mean()
                if best is None or err < best[0]:
                    best = (err, s, dx, dy)
    return best


def build(model, kind):
    base = Image.open(f"{model}-clean-cutout.png").convert("RGBA")
    opn = Image.open(f"{model}-{kind}-cutout.png").convert("RGBA")
    err, s, dx, dy = fit(base, opn)
    o = place(opn, s, dx, dy, base.size)
    W, H = base.size
    m = np.zeros((H, W), np.float32)
    fx, kx, py = SEAM[model]
    if kind == "frunk":
        m[:, :fx] = 1
    else:
        m[:py, kx:] = 1
    m = np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12)), np.float32)[..., None] / 255
    out = np.array(base, np.float32) * (1 - m) + np.array(o, np.float32) * m
    res = Image.new("RGBA", (CANVAS[model], H), (0, 0, 0, 0))
    res.paste(Image.fromarray(out.round().clip(0, 255).astype(np.uint8), "RGBA"), (0, 0))
    res.save(f"{model}-{kind}.png")
    print(f"{model} {kind}: scale {s:.4f}, offset {dx:.0f},{dy:.0f}, door difference {err:.1f}")


if __name__ == "__main__":
    for m in ("s", "y"):
        for k in ("frunk", "trunk"):
            build(m, k)

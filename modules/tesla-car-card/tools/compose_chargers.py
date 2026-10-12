"""Step 3 of making your own pictures (see the module README): car + charger on the shared canvas of each model
(align_base.py), all combinations: fast charger and wall box, with the lids closed, frunk open and trunk open.
- car     : Y = y-base.png (cut-out, no cable). S = s-charge-port-open.png: the car with the open charge port and an own
            cable drawn from the port down to the floor (it ends on the floor at ~(1835, 1009)).
- charger : fast-charger.png (a cut-out without its cable, 1.9 m high, feet on the wheel line) or wall-box.png cut
            just below the box (so its own cable drops away), 0.43 m high with its bottom 1.07 m above the floor.
- cable   : a cubic Bézier, 9 px, drawn at 3x and scaled down (smooth edges), from the charger to the port or to the
            end of the own cable. Never the original cable of the car maker: always an own drawing.
The cable points (port side last) go into cable.json; copy them into CABLE of www/tesla-car-card.js (the light that
runs through the cable while charging), and the top of each charger into CHARGER_TOP.
Real scale: S 347 px/m, Y 319 px/m; the wheel line is the floor (S 1017, Y 970). All coordinates belong to the
author's pictures: measure your own.
Usage: python3 compose_chargers.py -> <m>-<fast|home>[-frunk|-trunk].png + cable.json"""
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PXM = {"s": 347, "y": 319}
FLOOR = {"s": 1017, "y": 970}
CANVAS = {"s": (2435, 1342), "y": (2238, 1248)}
CAR_REAR = {"s": 1877, "y": 1707}
PORT = {"y": (1606, 640)}  # Y: the cable enters at the charge port below the tail light
S_CABLE = [(1757, 740), (1760, 800), (1763, 880), (1772, 950), (1795, 990), (1835, 1009)]  # own cable, port -> floor
CABLE_RGB = (24, 22, 22)
SS = 3  # supersampling for the cable
# where the open lid sits (same seams as align_open.py): frunk left of x, trunk right of x and above y
SEAM = {"s": (700, 1380, 705), "y": (640, 1270, 585)}


def bez(p0, p1, p2, p3, n=200):
    t = np.linspace(0, 1, n)[:, None]
    P = [np.array(p, float) for p in (p0, p1, p2, p3)]
    return (1 - t) ** 3 * P[0] + 3 * (1 - t) ** 2 * t * P[1] + 3 * (1 - t) * t * t * P[2] + t ** 3 * P[3]


def car_layer(m, open_=None):
    """The car; open_ = 'frunk' / 'trunk' puts that open lid on it (align_open.py made those pictures on this canvas)."""
    if m == "y":
        return Image.open(f"y-{open_}.png" if open_ else "y-base.png").convert("RGBA")
    car = Image.open("s-charge-port-open.png").convert("RGBA")
    if not open_:
        return car
    lid = Image.open(f"s-{open_}.png").convert("RGBA")
    W, H = car.size
    fx, kx, py = SEAM[m]
    mask = np.zeros((H, W), np.uint8)
    if open_ == "frunk":
        mask[:, :fx] = 255
    else:
        mask[:py, kx:] = 255
    mask = Image.fromarray(mask).filter(ImageFilter.GaussianBlur(12))
    return Image.composite(lid, car, mask)


def fast_charger(m):
    sc = Image.open("fast-charger.png").convert("RGBA").crop((243, 155, 1000, 1703))  # just the stall
    th = round(1.9 * PXM[m])
    sc = sc.resize((round(sc.width * th / sc.height), th), Image.LANCZOS)
    x0 = CAR_REAR[m] + round(0.41 * PXM[m])  # gap behind the car
    ytop = FLOOR[m] - th
    a = np.array(sc)[:, :, 3]
    edge = int(np.where(a[int(0.42 * th)] > 128)[0].min())
    return sc, (x0, ytop), (x0 + edge - 2, ytop + int(0.42 * th))  # image, position, cable start (holster side)


def wall_box(m):
    z = Image.open("wall-box.png").convert("RGBA").crop((181, 175, 1055, 1385))
    h = round(0.43 * PXM[m])
    s = h / z.height
    z = z.resize((round(z.width * s), h), Image.LANCZOS)
    x0 = CAR_REAR[m] + round(0.72 * PXM[m])
    ybot = FLOOR[m] - round(1.07 * PXM[m])
    exit_ = (x0 + round((730 - 181) * s), ybot - 2)  # where the plug's cable leaves the socket
    return z, (x0, ybot - h), exit_


def draw_cable(size, pts):
    W, H = size
    lay = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    ImageDraw.Draw(lay).line([(x * SS, y * SS) for x, y in pts], fill=CABLE_RGB + (255,), width=9 * SS, joint="curve")
    return lay.resize((W, H), Image.LANCZOS)


def build(m, kind, open_=None):
    W, H = CANVAS[m]
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.alpha_composite(car_layer(m, open_))
    if kind == "fast":
        ch, pos, start = fast_charger(m)
        if m == "s":
            end = S_CABLE[-1]
            path = bez(start, (start[0] - 40, start[1] + 260), (1905, FLOOR[m] + 2), end)
        else:
            end = PORT[m]
            path = bez(start, (start[0] - 30, FLOOR[m] + 20), (1690, FLOOR[m] + 10), end)
    else:
        ch, pos, start = wall_box(m)
        if m == "s":
            end = S_CABLE[-1]
            path = bez(start, (start[0] + 5, start[1] + 320), (1950, FLOOR[m] + 4), end)
        else:
            end = PORT[m]
            path = bez(start, (start[0] + 10, start[1] + 330), (1650, 905), end)
    out.alpha_composite(draw_cable((W, H), [tuple(p) for p in path]))
    out.alpha_composite(ch, pos)  # charger over the cable end, so the plug tucks in
    name = f"{m}-{kind}{'-' + open_ if open_ else ''}.png"
    out.save(name)
    pts = [[round(x), round(y)] for x, y in path[::20]] + [[round(path[-1][0]), round(path[-1][1])]]
    if m == "s":
        pts += [list(p) for p in reversed(S_CABLE[:-1])]
    top = [round(100 * (pos[0] + ch.width / 2) / W, 1), round(100 * pos[1] / H, 1)]
    return name, {"w": W, "h": H, "pts": pts, "top": top}


if __name__ == "__main__":
    cable = {}
    for m in ("s", "y"):
        for kind in ("fast", "home"):
            name, k = build(m, kind)
            cable[f"{m}-{kind}"] = k
            print(name, len(k["pts"]), "cable points, charger top", k["top"])
            for open_ in ("frunk", "trunk"):  # same charger and cable, lid open (the card reuses the cable path)
                print(build(m, kind, open_)[0])
    with open("cable.json", "w") as f:
        json.dump(cable, f)

"""Step 1 of making your own pictures (see the module README, "Make your own pictures"): put the car of one model on
one shared canvas, so the car never moves between states. The card draws one contact shadow (.ground) at a fixed
spot; shadows in the photos are cut away so the shadow always looks the same.
The photo with a charger (<m>-with-charger.png) is the cable-free photo widened to the right, so the car sits on the
same pixels in both: no scaling needed.
- base : cut-out of the cable-free photo (<m>-clean-cutout.png, transparent background), padded on the right
         -> <m>-base.png
- wide : car + cable alpha from a cut-out (<m>-with-charger-cutout.png). A background remover may drop a white
         charger, so the charger alpha is rebuilt from the colour distance to the backdrop, right of the car and above
         the wheel line -> <m>-with-charger-wide.png (a check picture; compose_chargers.py builds the final ones)
The numbers in the calls at the bottom (charge port x, left edge of the charger x, canvas width) belong to the
author's pictures: measure your own in an image editor.
Usage: python3 align_base.py   (in the folder with your pictures; needs numpy and Pillow)"""
import numpy as np
from PIL import Image, ImageFilter


def charger_alpha(rgb, x_from, y_to):
    """Alpha for what differs from the backdrop right of x_from and above y_to. The backdrop per row is taken from the
    last columns (the widened canvas, never the charger): a row median fails where a tall charger fills most of the row."""
    reg = rgb[:y_to, x_from:].astype(np.int16)
    bg = rgb[:y_to, -6:].astype(np.int16).mean(axis=1, keepdims=True)
    d = np.sqrt(((reg - bg) ** 2).sum(axis=2))
    a = np.clip((d - 14) * 14, 0, 255).astype(np.uint8)
    out = np.zeros(rgb.shape[:2], np.uint8)
    out[:y_to, x_from:] = np.array(Image.fromarray(a).filter(ImageFilter.MedianFilter(5)))
    return out


def build(model, port_x, charger_x, width=None):
    """width: pad the canvas on the right, so both models show at the same metres per pixel in the card."""
    src = np.array(Image.open(f"{model}-with-charger.png").convert("RGB"))
    H, W = src.shape[:2]
    W = max(W, width or 0)
    base = Image.open(f"{model}-clean-cutout.png").convert("RGBA")
    assert base.height == H, f"{model}: base and charger picture must share the height"
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(base, (0, 0))
    canvas.save(f"{model}-base.png")

    cut = np.array(Image.open(f"{model}-with-charger-cutout.png").convert("RGBA").getchannel("A"))
    wheels = np.where((np.array(base.getchannel("A"))[:, :port_x] > 128).any(axis=1))[0].max()
    alpha = np.maximum(cut, charger_alpha(src, charger_x, wheels + 4))
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(Image.fromarray(np.dstack([src, alpha]), "RGBA"), (0, 0))
    out.save(f"{model}-with-charger-wide.png")
    print(f"{model}: canvas {W}x{H}, wheel line y={wheels}")


if __name__ == "__main__":
    # S 347 px/m on 2435 px, Y 319 px/m: the Y canvas becomes 2435 * 319 / 347 = 2238 px wide, so the S shows longer,
    # as it is. charger_x: left edge of the charger; the cable comes from the cut-out.
    build("y", 1605, 1900, 2238)
    build("s", 1725, 2000)

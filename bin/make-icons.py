#!/usr/bin/env python3
"""Rasterises the app icon from the same geometry as frontend/public/favicon.svg.

The SVG is the source of truth; these PNGs exist only because a web app manifest cannot
use one. Regenerate with `make icons` after changing the mark, and commit the result —
CI must not need a rasteriser.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public"

ACCENT = (178, 98, 45, 255)  # #b2622d, --accent
IVORY = (255, 250, 242, 255)  # #fffaf2, --surface
SUPERSAMPLE = 4

# favicon.svg, 512 viewBox. Bubble and tail are one outline, filled and stroked 20 wide
# with round joins. Every joint is tangent: the tail's bottom edge continues the circle's
# bottom tangent, its top edge enters the circle through a concave r40 fillet, tip r12.
CIRCLE = ((262, 242), 150)
BOTTOM = (262, 392)  # circle's lowest point; the tail's bottom edge starts here
TIP = ((122.2, 380), 12, (122.2, 392), (111.4, 374.8))  # centre, r, from, to
FILLET = ((91.1, 325), 40, (127.1, 342.5), (127.1, 307.5))  # centre, r, from (on edge), to (on circle)
BUBBLE_STROKE = 20
M = [(184, 310), (184, 178), (262, 268), (340, 178), (340, 310)]  # stroke 56, round caps/joins
M_STROKE = 56


def _arc(c, r, p0, p1, clockwise, steps=48):
    """Points on a circle from p0 to p1 (y down; clockwise = increasing angle)."""
    a0 = math.atan2(p0[1] - c[1], p0[0] - c[0])
    a1 = math.atan2(p1[1] - c[1], p1[0] - c[0])
    if clockwise and a1 < a0:
        a1 += 2 * math.pi
    if not clockwise and a1 > a0:
        a1 -= 2 * math.pi
    return [(c[0] + r * math.cos(a0 + (a1 - a0) * i / steps), c[1] + r * math.sin(a0 + (a1 - a0) * i / steps))
            for i in range(steps + 1)]


def densify(points: list[tuple[float, float]], step: float = 1.0) -> list[tuple[float, float]]:
    """Points every `step` units along a polyline. A stroke traced with discs has to have a
    disc along every straight edge too, or the edge shows as beads between its two ends."""
    out = [points[0]]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        n = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        out += [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(1, n + 1)]
    return out


def bubble_outline() -> list[tuple[float, float]]:
    """Same path as favicon.svg: circle over the top to its bottom point, straight left to
    the tip, round the tip, up the top edge, through the fillet back onto the circle."""
    (c, r), (tc, tr, ta, tb), (fc, fr, fa, fb) = CIRCLE, TIP, FILLET
    pts = _arc(c, r, fb, BOTTOM, True, 240)
    pts += _arc(tc, tr, ta, tb, True)
    pts += _arc(fc, fr, fa, fb, False)
    return pts


def draw_icon(size: int, *, radius_ratio: float, mark_scale: float) -> Image.Image:
    """Terracotta square, ivory speech bubble, the M cut through it in terracotta.
    The mark already sits inside the maskable safe circle (r 205 of 256)."""
    s = size * SUPERSAMPLE
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * radius_ratio), fill=ACCENT)

    def pt(p: tuple[float, float]) -> tuple[float, float]:
        return tuple((256 + (v - 256) * mark_scale) / 512 * s for v in p)

    def w(v: float) -> float:
        return v / 512 * s * mark_scale

    def dot(p: tuple[float, float], r: float, fill) -> None:
        x, y = pt(p)
        rr = w(r)
        draw.ellipse((x - rr, y - rr, x + rr, y + rr), fill=fill)

    # Fill, then trace the outline with discs: a round-joined stroke, as in the SVG.
    outline = bubble_outline()
    draw.polygon([pt(p) for p in outline], fill=IVORY)
    for p in densify(outline + outline[:1]):
        dot(p, BUBBLE_STROKE / 2, IVORY)

    # The M the same way: discs along the line are a stroke with round caps and joins,
    # which ImageDraw.line with joint="curve" is not — it notches the inner corners.
    for p in densify(M):
        dot(p, M_STROKE / 2, ACCENT)

    return image.resize((size, size), Image.LANCZOS)


def opaque(image: Image.Image) -> Image.Image:
    """iOS ignores transparency and composites onto black, so flatten deliberately."""
    flat = Image.new("RGB", image.size, ACCENT[:3])
    flat.paste(image, mask=image.split()[3])
    return flat


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    draw_icon(192, radius_ratio=0.22, mark_scale=1.0).save(OUT / "pwa-192x192.png")
    draw_icon(512, radius_ratio=0.22, mark_scale=1.0).save(OUT / "pwa-512x512.png")
    # Maskable: full bleed, no corner radius; small margin inside the safe circle.
    draw_icon(512, radius_ratio=0.0, mark_scale=0.92).save(OUT / "maskable-512x512.png")
    opaque(draw_icon(180, radius_ratio=0.0, mark_scale=1.0)).save(OUT / "apple-touch-icon.png")

    for path in sorted(OUT.glob("*.png")):
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size:>6} B")


if __name__ == "__main__":
    main()

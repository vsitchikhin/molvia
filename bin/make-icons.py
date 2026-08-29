#!/usr/bin/env python3
"""Rasterises the app icon from the same geometry as frontend/public/favicon.svg.

The SVG is the source of truth; these PNGs exist only because a web app manifest cannot
use one. Regenerate with `make icons` after changing the mark, and commit the result —
CI must not need a rasteriser.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "pwa" / "public"

SURFACE = (27, 27, 31, 255)  # --surface, dark scheme
GOOD = (27, 175, 122, 255)  # --good
SUPERSAMPLE = 4


def draw_icon(size: int, *, radius_ratio: float, mark_scale: float) -> Image.Image:
    """One rounded square with a check. mark_scale shrinks the check for maskable icons,
    where the launcher may crop everything outside the central circle."""
    s = size * SUPERSAMPLE
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * radius_ratio), fill=SURFACE)

    # The path of favicon.svg, in a 512 viewBox, scaled to this canvas.
    points = [(140, 268), (212, 340), (372, 180)]
    centre = 256
    scaled = [
        ((centre + (x - centre) * mark_scale) / 512 * s, (centre + (y - centre) * mark_scale) / 512 * s)
        for x, y in points
    ]
    width = int(56 / 512 * s * mark_scale)

    draw.line(scaled, fill=GOOD, width=width, joint="curve")
    for x, y in scaled:  # round caps, which ImageDraw.line does not give us
        draw.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), fill=GOOD)

    return image.resize((size, size), Image.LANCZOS)


def opaque(image: Image.Image) -> Image.Image:
    """iOS ignores transparency and composites onto black, so flatten deliberately."""
    flat = Image.new("RGB", image.size, SURFACE[:3])
    flat.paste(image, mask=image.split()[3])
    return flat


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    draw_icon(192, radius_ratio=0.22, mark_scale=1.0).save(OUT / "pwa-192x192.png")
    draw_icon(512, radius_ratio=0.22, mark_scale=1.0).save(OUT / "pwa-512x512.png")
    # Maskable: full bleed, no corner radius, mark inside the safe circle.
    draw_icon(512, radius_ratio=0.0, mark_scale=0.62).save(OUT / "maskable-512x512.png")
    opaque(draw_icon(180, radius_ratio=0.0, mark_scale=1.0)).save(OUT / "apple-touch-icon.png")

    for path in sorted(OUT.glob("*.png")):
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size:>6} B")


if __name__ == "__main__":
    main()

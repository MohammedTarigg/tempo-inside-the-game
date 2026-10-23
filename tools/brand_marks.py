"""Draws the Tempo mark (black and white) and the two club crests (in club colours) as SVG. Everything is built from
measured shapes, so a change of proportion is a change of one number. The files are written to web/public/brand/.

    uv run python tools/brand_marks.py"""

import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "web", "public", "brand")
BLACK, WHITE = "#000", "#fff"
ORANGE, SKY, NAVY = "#FF8A3D", "#7FD0F5", "#12233A"
pts = lambda p: " ".join(f"{x:.1f},{y:.1f}" for x, y in p)
svg = lambda body, title, w=120, h=120: (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">{body}</svg>\n'
)


def mark(
    c, Ro: float = 34, w: float = 13, stub: float = 20, rp: float = 13.2, dx: float = 0, cx: float = 60, cy: float = 60
):
    """The Tempo mark: the centre circle and the halfway line, with round ends, and the centre spot as an eye looking
    straight out at whoever looks at it, as the film leaves it. Ro: outer radius of the ring. w: its thickness. stub: how far
    the line runs beyond the ring. rp: the spot's radius, wide open. dx: how far the spot sits off centre, for a glance."""
    sw = w * 0.78
    return (
        f'<circle cx="{cx}" cy="{cy}" r="{Ro - w / 2}" fill="none" stroke="{c}" stroke-width="{w}"/>'
        f'<rect x="{cx - sw / 2}" y="{cy - Ro - stub}" width="{sw}" height="{stub + w / 2}" rx="{sw / 2}" fill="{c}"/>'
        f'<rect x="{cx - sw / 2}" y="{cy + Ro - w / 2}" width="{sw}" height="{stub + w / 2}" rx="{sw / 2}" fill="{c}"/>'
        f'<circle cx="{cx + dx}" cy="{cy}" r="{rp}" fill="{c}"/>'
    )


def northgate():
    """The badge is the gate itself: an arch with a portcullis, and a pointer to north above it."""

    def arch(x0, x1, top, base):
        r = (x1 - x0) / 2
        return f"M{x0},{base} V{top + r} A{r},{r} 0 0 1 {x1},{top + r} V{base} Z"

    outer, inner = arch(20, 100, 8, 114), arch(38, 82, 44, 114)
    bars = "".join(f'<rect x="{x - 2.5}" y="40" width="5" height="80"/>' for x in (49, 60, 71)) + "".join(
        f'<rect x="34" y="{y - 2.5}" width="52" height="5"/>' for y in (70, 86, 102)
    )
    return svg(
        f'<defs><clipPath id="g"><path d="{inner}"/></clipPath></defs>'
        f'<path d="{outer}" fill="{ORANGE}" stroke="{WHITE}" stroke-width="5" stroke-linejoin="round"/>'
        f'<path d="{inner}" fill="{NAVY}"/>'
        f'<g clip-path="url(#g)" fill="{ORANGE}">{bars}</g>'
        f'<polygon points="{pts([(60, 17), (51, 36), (60, 31), (69, 36)])}" fill="{NAVY}"/>',
        "Northgate crest",
    )


def harbour():
    """A roundel: a lighthouse on the sea wall, its lamp throwing a beam each way."""
    c, r = 60, 52
    wave = lambda y: pts([(8 + i * 104 / 60, y + 3.2 * math.sin(i / 60 * 10 * math.pi)) for i in range(61)])
    tower = pts([(50, 86), (70, 86), (66, 48), (54, 48)])
    beams = "".join(
        f'<polygon points="{pts([(60 + s * 6, 42), (60 + s * 56, 24), (60 + s * 56, 52)])}"/>' for s in (-1, 1)
    )
    return svg(
        f'<defs><clipPath id="r"><circle cx="{c}" cy="{c}" r="{r}"/></clipPath><clipPath id="t">'
        f'<polygon points="{tower}"/></clipPath></defs>'
        f'<circle cx="{c}" cy="{c}" r="{r}" fill="{SKY}"/><g clip-path="url(#r)">'
        f'<g fill="{WHITE}" opacity=".6">{beams}</g><rect x="0" y="86" width="120" height="40" fill="{NAVY}"/>'
        f'<polyline points="{wave(96)}" fill="none" stroke="{SKY}" stroke-width="3.5" stroke-linecap="round"/>'
        f'<polyline points="{wave(106)}" fill="none" stroke="{SKY}" stroke-width="3.5"'
        f' stroke-linecap="round" opacity=".6"/>'
        f"</g>"
        f'<polygon points="{tower}" fill="{WHITE}"/><g clip-path="url(#t)" fill="{NAVY}">'
        f'<rect x="40" y="56" width="40" height="9"/><rect x="40" y="72" width="40" height="9"/></g>'
        f'<rect x="52" y="37" width="16" height="11" rx="1.5" fill="{WHITE}" stroke="{NAVY}" stroke-width="3"/>'
        f'<polygon points="{pts([(49, 37), (71, 37), (60, 25)])}" fill="{NAVY}"/>'
        f'<circle cx="{c}" cy="{c}" r="{r}" fill="none" stroke="{WHITE}" stroke-width="5"/>',
        "Harbour City crest",
    )


FILES = {
    "tempo-mark.svg": svg(mark(BLACK), "Tempo"),  # for light backgrounds
    "tempo-mark-white.svg": svg(mark(WHITE), "Tempo"),  # for dark backgrounds
    "tempo.svg": svg(
        f'<rect width="120" height="120" rx="26" fill="{BLACK}"/>' + mark(WHITE, Ro=30, w=12, stub=14, rp=11.4),
        "Tempo",
    ),  # app icon
    "tempo-small.svg": svg(
        f'<rect width="120" height="120" rx="26" fill="{BLACK}"/>' + mark(WHITE, Ro=34, w=16, stub=14, rp=10.8),
        "Tempo",
    ),  # 16 to 24 pixels: a heavier ring keeps the eye open
    "northgate.svg": northgate(),
    "harbour-city.svg": harbour(),
}


def main():
    for name, body in FILES.items():
        with open(os.path.join(BRAND, name), "w") as f:
            f.write(body)
    print("wrote", ", ".join(FILES))


if __name__ == "__main__":
    main()

"""Draws the Tempo mark (black and white) and the two club crests (in club colours) as SVG. Everything is built from measured
shapes, so a change of proportion is a change of one number. Run: python3 ui/brand/make.py"""

import math, os

HERE = os.path.dirname(os.path.abspath(__file__))
BLACK, WHITE = "#000", "#fff"
ORANGE, SKY, NAVY = "#FF8A3D", "#7FD0F5", "#12233A"
pts = lambda p: " ".join(f"{x:.1f},{y:.1f}" for x, y in p)
svg = lambda body, title, w=120, h=120: (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">{body}</svg>\n'
)


def mark(c, Ro=34, w=13, stub=20, rp=11, dx=7, cx=60, cy=60):
    """The Tempo mark: the centre circle and the halfway line, with the centre spot looking to one side.
    Ro: outer radius of the ring. w: its thickness. stub: how far the line runs beyond the ring. rp: the spot's radius.
    dx: how far the spot sits off centre. At 0 it is a pitch marking; off centre it is an eye."""
    sw = w * 0.78
    return (
        f'<circle cx="{cx}" cy="{cy}" r="{Ro - w / 2}" fill="none" stroke="{c}" stroke-width="{w}"/>'
        f'<rect x="{cx - sw / 2}" y="{cy - Ro - stub}" width="{sw}" height="{stub + w / 2}" fill="{c}"/><rect x="{cx - sw / 2}" y="{cy + Ro - w / 2}" width="{sw}" height="{stub + w / 2}" fill="{c}"/>'
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
        f'<defs><clipPath id="g"><path d="{inner}"/></clipPath></defs><path d="{outer}" fill="{ORANGE}" stroke="{WHITE}" stroke-width="5" stroke-linejoin="round"/><path d="{inner}" fill="{NAVY}"/>'
        f'<g clip-path="url(#g)" fill="{ORANGE}">{bars}</g><polygon points="{pts([(60, 17), (51, 36), (60, 31), (69, 36)])}" fill="{NAVY}"/>',
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
        f'<defs><clipPath id="r"><circle cx="{c}" cy="{c}" r="{r}"/></clipPath><clipPath id="t"><polygon points="{tower}"/></clipPath></defs>'
        f'<circle cx="{c}" cy="{c}" r="{r}" fill="{SKY}"/><g clip-path="url(#r)"><g fill="{WHITE}" opacity=".6">{beams}</g><rect x="0" y="86" width="120" height="40" fill="{NAVY}"/>'
        f'<polyline points="{wave(96)}" fill="none" stroke="{SKY}" stroke-width="3.5" stroke-linecap="round"/><polyline points="{wave(106)}" fill="none" stroke="{SKY}" stroke-width="3.5" stroke-linecap="round" opacity=".6"/></g>'
        f'<polygon points="{tower}" fill="{WHITE}"/><g clip-path="url(#t)" fill="{NAVY}"><rect x="40" y="56" width="40" height="9"/><rect x="40" y="72" width="40" height="9"/></g>'
        f'<rect x="52" y="37" width="16" height="11" rx="1.5" fill="{WHITE}" stroke="{NAVY}" stroke-width="3"/><polygon points="{pts([(49, 37), (71, 37), (60, 25)])}" fill="{NAVY}"/>'
        f'<circle cx="{c}" cy="{c}" r="{r}" fill="none" stroke="{WHITE}" stroke-width="5"/>',
        "Harbour City crest",
    )


FILES = {
    "tempo-mark.svg": svg(mark(BLACK), "Tempo"),  # for light backgrounds
    "tempo-mark-white.svg": svg(mark(WHITE), "Tempo"),  # for dark backgrounds
    "tempo.svg": svg(
        f'<rect width="120" height="120" rx="26" fill="{BLACK}"/>' + mark(WHITE, Ro=30, w=12, stub=14, rp=9.5, dx=6),
        "Tempo",
    ),  # app icon
    "tempo-small.svg": svg(
        f'<rect width="120" height="120" rx="26" fill="{BLACK}"/>' + mark(WHITE, Ro=34, w=16, stub=14, rp=9, dx=5),
        "Tempo",
    ),  # 16 to 24 pixels: a heavier ring keeps the eye open
    "northgate.svg": northgate(),
    "harbour-city.svg": harbour(),
}
for name, body in FILES.items():
    open(os.path.join(HERE, name), "w").write(body)
print("wrote", ", ".join(FILES))

"""Ritar EPAkollens appikon (bil bakifrån med LGF-triangel) i alla storlekar.

    python scripts/make_icons.py

Skriver icons/icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png och apple-touch-icon.png.
Geometrin är definierad i en 100x100-ruta och används av både SVG:n och PNG-ritningen.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"

BG = "#0E0B1A"
GLOW = "#FF4FA3"
CAR = "#F6F3FF"
LIGHT = "#FF3B3B"
TRI = "#FF7A1A"
EDGE = "#E8202A"

CABIN = "M27 42 L31 27 Q33 21 39 21 H61 Q67 21 69 27 L73 42 Z"
WINDOW = "M33 39 L36 29 Q37 26 40 26 H60 Q63 26 64 29 L67 39 Z"
RECTS = [  # x, y, w, h, rx, färg
    (15, 40, 70, 28, 9, CAR),     # kaross
    (20, 66, 15, 13, 3.5, CAR),   # däck vänster
    (65, 66, 15, 13, 3.5, CAR),   # däck höger
    (20, 47, 11, 7, 2.5, LIGHT),  # bakljus vänster
    (69, 47, 11, 7, 2.5, LIGHT),  # bakljus höger
]
TRIANGLE = [(50, 45), (59.5, 62), (40.5, 62)]


def svg():
    rects = "\n  ".join(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{c}"/>' for x, y, w, h, r, c in RECTS
    )
    tri = " ".join(f"{x} {y}" for x, y in TRIANGLE)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><radialGradient id="g" cx="1" cy="0" r="1"><stop offset="0" stop-color="{GLOW}" stop-opacity=".45"/><stop offset=".6" stop-color="{GLOW}" stop-opacity="0"/></radialGradient></defs>
  <rect width="100" height="100" rx="22" fill="{BG}"/>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <path d="{CABIN}" fill="{CAR}"/>
  <path d="{WINDOW}" fill="{BG}"/>
  {rects}
  <path d="M{tri} Z" fill="{TRI}" stroke="{EDGE}" stroke-width="3.5" stroke-linejoin="round"/>
</svg>
'''


def quad(p0, c, p1, steps=12):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1])
            for t in (i / steps for i in range(steps + 1))]


def trapezoid(bl, tl_corner, tl_ctrl, tl_end, tr_start, tr_ctrl, tr_corner, br):
    return [bl, tl_corner, *quad(tl_corner, tl_ctrl, tl_end), *quad(tr_start, tr_ctrl, tr_corner), br]


CABIN_PTS = trapezoid((27, 42), (31, 27), (33, 21), (39, 21), (61, 21), (67, 21), (69, 27), (73, 42))
WINDOW_PTS = trapezoid((33, 39), (36, 29), (37, 26), (40, 26), (60, 26), (63, 26), (64, 29), (67, 39))


def png(size, *, rounded=True, scale=1.0):
    """scale < 1 krymper motivet mot mitten (säker zon för maskable-ikoner)."""
    S = size * 4
    k = S / 100
    off = S * (1 - scale) / 2

    def P(x, y):
        return (off + x * k * scale, off + y * k * scale)

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = 22 * k if rounded else 0
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=BG)

    # Rosa glöd från övre högra hörnet
    g = Image.radial_gradient("L").resize((S * 2, S * 2))  # 0 i mitten, 255 vid kanten
    g = g.point(lambda v: int(max(0, 1 - v / 255 / 0.6) * 0.45 * 255))
    g = g.crop((0, S, S, S * 2))  # centrum hamnar i övre högra hörnet
    glow = Image.new("RGBA", (S, S), GLOW)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    glow.putalpha(Image.composite(g, Image.new("L", (S, S), 0), mask))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)

    d.polygon([P(*p) for p in CABIN_PTS], fill=CAR)
    d.polygon([P(*p) for p in WINDOW_PTS], fill=BG)
    for x, y, w, h, r, c in RECTS:
        d.rounded_rectangle([P(x, y), P(x + w, y + h)], radius=r * k * scale, fill=c)
    tri = [P(*p) for p in TRIANGLE]
    d.polygon(tri, fill=TRI)
    d.line(tri + [tri[0], tri[1]], fill=EDGE, width=max(1, round(3.5 * k * scale)), joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def main():
    (OUT / "icon.svg").write_text(svg(), encoding="utf-8")
    png(192).save(OUT / "icon-192.png")
    png(512).save(OUT / "icon-512.png")
    png(512, rounded=False, scale=0.8).save(OUT / "icon-maskable-512.png")
    png(180, rounded=False).save(OUT / "apple-touch-icon.png")  # iOS rundar hörnen själv
    print("Ikoner skrivna till", OUT)


if __name__ == "__main__":
    main()

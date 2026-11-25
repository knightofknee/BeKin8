# art/build_beacons.py
# Turns the painted source images in art/in/ into the app assets for THE BEACONS skin
# (assets/images/skins/beacons/) and writes components/scenes/beaconsArt.ts beside them.
#
#   python3 art/build_beacons.py            build everything
#   python3 art/build_beacons.py --mock     also write a phone-sized mock-up to art/mock-beacons.png
#
# What it does to each image:
#   background   fades the top edge to flat sky and the bottom edge to near-black, so the app can
#                extend both past the painting
#   huts, pyre   trims, cleans the cut-out fringe, grades them to night, then builds one sprite per
#                chain site (hut + pyre on one ground line) in two states: dark, and firelit (warm
#                light falling from the pyre, windows glowing). Farther sites are hazed.
#   main pyre    same grade, dark + firelit
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "in")
OUT = os.path.join(ROOT, "assets", "images", "skins", "beacons")
TS = os.path.join(ROOT, "components", "scenes", "beaconsArt.ts")

BG = "Moonlit Milky Way Over Alpine Peaks.png"
PYRE = "beacons-pyre.png"
# The painted "somebody home" version of hut 0 (same canvas, so it takes the same crop).
HUT0_LIT = "beacons-hut-lit.png"
MAIN = "beacons-main.png"
# file, window rects as fractions of the source image (x0, y0, x1, y1)
HUTS = [
    ("a_realistic_highly_detailed_isolated_png_transpar.png",
     [(0.181, 0.557, 0.210, 0.674), (0.462, 0.549, 0.508, 0.678), (0.733, 0.562, 0.768, 0.680)]),
    ("beacons-hut-02-steep-gable.png", []),
    ("beacons-hut-03-longhouse.png", [(0.381, 0.617, 0.453, 0.723), (0.771, 0.621, 0.826, 0.723)]),
    ("beacons-hut-04-hipped-roof.png", [(0.387, 0.556, 0.458, 0.651)]),
    ("beacons-hut-05-timber-stone.png", [(0.260, 0.557, 0.323, 0.609)]),
    ("beacons-hut-06-woodland-shelter.png", [(0.719, 0.581, 0.776, 0.660)]),
]

# The chain, nearest first: where each site stands ON THE PAINTING (u, v = fractions of the image,
# v at the ground line), how wide the whole site is drawn (fraction of the image width), which hut,
# and whether the site is mirrored (pyre on the left).
SITES = [
    # Every (u, v) below was read off the painting's ridge SKYLINES (a crest with sky or mist
    # behind it), so each site stands on top of something. Keep u within 0.2..0.8: the app crops
    # the painting's sides.
    {"u": 0.715, "v": 0.602, "w": 0.230, "hut": 0, "flip": False},  # near right snow plateau
    {"u": 0.285, "v": 0.448, "w": 0.150, "hut": 5, "flip": True},   # near left rock crest
    {"u": 0.680, "v": 0.363, "w": 0.125, "hut": 2, "flip": True},   # flat ground under the rocky ridge, right
    {"u": 0.250, "v": 0.227, "w": 0.100, "hut": 3, "flip": False},  # far skyline, left
    {"u": 0.616, "v": 0.207, "w": 0.082, "hut": 1, "flip": False},  # the high peak, top
]
# Where your own pyre stands on the painting's foreground rock.
LEDGE = {"u": 0.5, "v": 0.868}

NIGHT = (0.40, 0.48, 0.70)   # moonlit grade for anything standing in the scene
HAZE = (44, 62, 98)          # distance colour the far sites sink into
WARM = (1.00, 0.60, 0.26)    # firelight


def load_cut(name, erode=5):
    """A cut-out with the generator's coloured fringe eroded off the alpha edge (erode=0 keeps
    the original alpha: for painted sprites with fine detail such as pine needles)."""
    im = Image.open(os.path.join(SRC, name)).convert("RGBA")
    if erode:
        a = im.getchannel("A").point(lambda v: 255 if v > 200 else 0)
        a = a.filter(ImageFilter.MinFilter(erode)).filter(ImageFilter.GaussianBlur(1.2))
        im.putalpha(a)
    return im


def mul(im, rgb):
    r, g, b, a = im.split()
    r = r.point(lambda v: min(255, int(v * rgb[0])))
    g = g.point(lambda v: min(255, int(v * rgb[1])))
    b = b.point(lambda v: min(255, int(v * rgb[2])))
    return Image.merge("RGBA", (r, g, b, a))


def radial(size, cx, cy, radius, power=1.6):
    """L mask: 255 at (cx, cy) falling to 0 at `radius`."""
    w, h = size
    small = Image.new("L", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            dx = (x + 0.5) / 64 * w - cx
            dy = (y + 0.5) / 64 * h - cy
            d = (dx * dx + dy * dy) ** 0.5 / radius
            px[x, y] = int(255 * max(0.0, 1.0 - d) ** power)
    return small.resize(size, Image.BICUBIC)


def firelit(orig, dark, fx, fy, radius, strength=1.25):
    """`dark` plus warm light from (fx, fy): the original colours show through, tinted by fire."""
    warm = mul(orig, tuple(c * strength for c in WARM))
    mask = radial(orig.size, fx, fy, radius)
    out = Image.composite(ImageChops.lighter(warm, dark), dark, mask)
    out.putalpha(orig.getchannel("A"))
    return out


def glow_windows(im, rects):
    if not rects:
        return im
    w, h = im.size
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x0, y0, x1, y1 in rects:
        d.rectangle([x0 * w, y0 * h, x1 * w, y1 * h], fill=(255, 190, 96, 255))
    halo = layer.filter(ImageFilter.GaussianBlur(w * 0.022))
    halo.putalpha(halo.getchannel("A").point(lambda v: int(v * 0.6)))
    core = layer.filter(ImageFilter.GaussianBlur(w * 0.003))
    out = Image.alpha_composite(im, halo)
    out = Image.alpha_composite(out, core)
    # keep the cut-out's own silhouette (the halo may spill a little past it, softly)
    a = ImageChops.lighter(im.getchannel("A"), halo.getchannel("A").point(lambda v: int(v * 0.5)))
    out.putalpha(a)
    return out


def trim(im, *others):
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return [x.crop(box) for x in (im,) + others]


def haze(im, k):
    if k <= 0:
        return im
    flat = Image.new("RGBA", im.size, HAZE + (255,))
    out = Image.blend(im, flat, k)
    out.putalpha(im.getchannel("A"))
    return out


def save(im, name, q=86):
    os.makedirs(OUT, exist_ok=True)
    im.save(os.path.join(OUT, name), "WEBP", quality=q, method=6)


def build_bg():
    bg = Image.open(os.path.join(SRC, BG)).convert("RGB")
    w, h = bg.size
    top = bg.crop((0, 0, w, 24)).resize((1, 1), Image.BOX).getpixel((0, 0))
    # top 7% -> flat sky, bottom 9% -> near-black
    mask = Image.new("L", (1, h), 0)
    mp = mask.load()
    for y in range(h):
        t = y / h
        mp[0, y] = int(255 * max(0.0, 1 - t / 0.07))
    bg = Image.composite(Image.new("RGB", bg.size, top), bg, mask.resize(bg.size))
    floor = (5, 8, 14)
    for y in range(h):
        t = y / h
        mp[0, y] = int(255 * max(0.0, (t - 0.91) / 0.09) ** 1.2)
    bg = Image.composite(Image.new("RGB", bg.size, floor), bg, mask.resize(bg.size))
    save(bg, "bg.webp", 84)
    return bg, top, floor


def build():
    bg, top, floor = build_bg()

    pyre_o = load_cut(PYRE)
    (pyre_o,) = trim(pyre_o)
    huts = []
    for name, rects in HUTS:
        full = load_cut(name)
        lit_marks = Image.new("RGBA", full.size, (0, 0, 0, 0))
        box = full.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        fw, fh = full.size
        cut = full.crop(box)
        cw, ch = cut.size
        rel = [((x0 * fw - box[0]) / cw, (y0 * fh - box[1]) / ch, (x1 * fw - box[0]) / cw, (y1 * fh - box[1]) / ch)
               for x0, y0, x1, y1 in rects]
        del lit_marks
        painted_lit = None
        if len(huts) == 0:
            # Same full-canvas crop as the dark hut, and the dark hut's silhouette, so the two
            # states register exactly (the edit shifted the outer bounds by a few pixels).
            pl = Image.open(os.path.join(SRC, HUT0_LIT)).convert("RGBA").resize(full.size, Image.LANCZOS)
            pl = pl.crop(box)
            pl.putalpha(ImageChops.darker(pl.getchannel("A"), cut.getchannel("A")))
            painted_lit = pl
            rel = []  # its windows are already painted lit
        huts.append((cut, rel, painted_lit))

    meta = []
    for i, s in enumerate(SITES):
        hut_o, rects, hut_lit_o = huts[s["hut"]]
        # hut normalised by area so the longhouse is not a giant; pyre a bit over half its height
        area = 300 * 300
        k = (area / (hut_o.width * hut_o.height)) ** 0.5
        hut = hut_o.resize((int(hut_o.width * k), int(hut_o.height * k)), Image.LANCZOS)
        ph = int(hut.height * 0.66)
        pyre = pyre_o.resize((int(pyre_o.width * ph / pyre_o.height), ph), Image.LANCZOS)
        gap = int(hut.width * 0.10)
        pad = 10
        W = hut.width + gap + pyre.width + pad * 2
        H = max(hut.height, pyre.height) + pad * 2
        base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        hx, hy = pad, H - pad - hut.height
        px, py = pad + hut.width + gap, H - pad - pyre.height
        base.alpha_composite(hut, (hx, hy))
        base.alpha_composite(pyre, (px, py))
        fire_x = px + pyre.width * 0.5
        fire_y = py + pyre.height * 0.12

        dark = mul(base, NIGHT)
        lit = firelit(base, dark, fire_x, fire_y - ph * 0.3, W * 0.78)
        if hut_lit_o is not None:
            # the painted lit hut (cool outside, warm windows), under the same firelight
            hl = hut_lit_o.resize(hut.size, Image.LANCZOS)
            hl_dark = mul(hl, (0.62, 0.66, 0.80))
            hl_base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            hl_base.alpha_composite(hl, (hx, hy))
            hl_night = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            hl_night.alpha_composite(hl_dark, (hx, hy))
            hut_fire = firelit(hl_base, hl_night, fire_x, fire_y - ph * 0.3, W * 0.78)
            mask = Image.new("L", (W, H), 0)
            mask.paste(hut.getchannel("A"), (hx, hy))
            lit = Image.composite(hut_fire, lit, mask)
        lit = glow_windows(lit, [((hx + a * hut.width) / W, (hy + b * hut.height) / H,
                                  (hx + c * hut.width) / W, (hy + d * hut.height) / H) for a, b, c, d in rects])
        depth = i / (len(SITES) - 1)
        dark = haze(dark, 0.10 + depth * 0.40)
        lit = haze(lit, depth * 0.30)
        fx = fire_x / W
        if s["flip"]:
            dark = dark.transpose(Image.FLIP_LEFT_RIGHT)
            lit = lit.transpose(Image.FLIP_LEFT_RIGHT)
            fx = 1 - fx
        out_w = 300
        size = (out_w, int(H * out_w / W))
        save(dark.resize(size, Image.LANCZOS), f"site{i}.webp")
        save(lit.resize(size, Image.LANCZOS), f"site{i}-lit.webp")
        meta.append({
            "u": s["u"], "v": s["v"], "w": s["w"],
            "aspect": round(W / H, 4),
            "fireX": round(fx, 4),                          # pyre centre, fraction of sprite width
            "fireY": round(fire_y / H, 4),                  # flame seat, fraction of sprite height
            "ground": round((H - pad) / H, 4),              # ground line, fraction of sprite height
            "pyreW": round(pyre.width / W, 4),
        })

    main_o = load_cut(MAIN)
    (main_o,) = trim(main_o)
    main_dark = mul(main_o, (0.52, 0.58, 0.78))
    main_lit = firelit(main_o, main_dark, main_o.width * 0.5, main_o.height * 0.05, main_o.width * 0.75, 1.35)
    msize = (540, int(main_o.height * 540 / main_o.width))
    save(main_dark.resize(msize, Image.LANCZOS), "main.webp", 90)
    save(main_lit.resize(msize, Image.LANCZOS), "main-lit.webp", 90)

    hexc = lambda c: "#%02X%02X%02X" % tuple(c)
    lines = [
        "// components/scenes/beaconsArt.ts",
        "// GENERATED by art/build_beacons.py from the paintings in art/in/. Do not edit by hand:",
        "// change the SITES table in that script and run it again.",
        "export const BEACONS_BG = require('../../assets/images/skins/beacons/bg.webp');",
        "/** The painting is 2:3. */",
        "export const BEACONS_BG_ASPECT = %s;" % round(bg.width / bg.height, 4),
        "export const BEACONS_SKY = '%s';" % hexc(top),
        "export const BEACONS_FLOOR = '%s';" % hexc(floor),
        "/** Where your own pyre stands on the painting (fractions of the image). */",
        "export const BEACONS_LEDGE = %s;" % json.dumps(LEDGE),
        "export const BEACONS_MAIN = require('../../assets/images/skins/beacons/main.webp');",
        "export const BEACONS_MAIN_LIT = require('../../assets/images/skins/beacons/main-lit.webp');",
        "export const BEACONS_MAIN_ASPECT = %s;" % round(main_o.width / main_o.height, 4),
        "",
        "export type BeaconSite = {",
        "  /** ground point on the painting, fractions of the image */",
        "  u: number; v: number;",
        "  /** drawn width of the whole site, fraction of the image width */",
        "  w: number;",
        "  aspect: number;",
        "  /** pyre centre / flame seat / ground line, fractions of the sprite */",
        "  fireX: number; fireY: number; ground: number;",
        "  pyreW: number;",
        "  dark: number; lit: number;",
        "};",
        "",
        "/** The chain, nearest first. */",
        "export const BEACONS_SITES: BeaconSite[] = [",
    ]
    for i, m in enumerate(meta):
        body = ", ".join(f"{k}: {v}" for k, v in m.items())
        lines.append(
            f"  {{ {body}, dark: require('../../assets/images/skins/beacons/site{i}.webp'), "
            f"lit: require('../../assets/images/skins/beacons/site{i}-lit.webp') }},"
        )
    lines.append("];")
    with open(TS, "w") as f:
        f.write("\n".join(lines) + "\n")
    return bg, meta


def mock(bg, meta, lit=True):
    """Phone-sized preview using the same layout maths as the scene."""
    W, H = 402, 874
    near_top = H * 0.74
    img_w = W * 1.25
    img_h = img_w * 1.5
    ix = (W - img_w) / 2
    iy = near_top - LEDGE["v"] * img_h
    can = Image.new("RGBA", (W, H), (5, 8, 14, 255))
    b = Image.open(os.path.join(OUT, "bg.webp")).convert("RGBA").resize((int(img_w), int(img_h)), Image.LANCZOS)
    can.alpha_composite(b, (int(ix), int(iy))) if iy >= 0 else can.paste(b, (int(ix), int(iy)))
    for i in reversed(range(len(meta))):
        m = meta[i]
        sp = Image.open(os.path.join(OUT, f"site{i}{'-lit' if lit else ''}.webp")).convert("RGBA")
        sw = m["w"] * img_w
        sh = sw / m["aspect"]
        sp = sp.resize((max(1, int(sw)), max(1, int(sh))), Image.LANCZOS)
        x = ix + m["u"] * img_w - sw / 2
        y = iy + m["v"] * img_h - sh * m["ground"]
        can.alpha_composite(sp, (int(x), int(y)))
    mp = Image.open(os.path.join(OUT, "main-lit.webp" if lit else "main.webp")).convert("RGBA")
    mw = 138
    mp = mp.resize((mw, int(mw * mp.height / mp.width)), Image.LANCZOS)
    can.alpha_composite(mp, (int(W / 2 - mw / 2), int(near_top - mp.height + 6)))
    name = "mock-beacons-lit.png" if lit else "mock-beacons.png"
    can.convert("RGB").save(os.path.join(ROOT, "art", name))


if __name__ == "__main__":
    bg, meta = build()
    if "--mock" in sys.argv:
        mock(bg, meta, True)
        mock(bg, meta, False)
    print("ok", len(meta), "sites")

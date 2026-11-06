"""Usage: python tools/deep.py [ground|props|landmarks|seeds]
The art for Under the Skin, the world's second layer: raw muscle for ground,
fat, clots, marrow and gut for props, the Knot (where the Navel comes out
underneath) and the Heart. Made the same way as tools/world.py (height map +
colour + gloss, one warm key light from the upper left, graded to the
character renders), whose helpers it uses, into the same folder.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from world import (  # noqa: E402
    HOLE_OFFSET, HOLE_RADIUS, cells, composite, field, fine_skin, lines, mix, normals, save, seed_icon, shade,
    shadow_of, spectral, stamped, stripes, tone, HALF,
)

MEAT = np.array([0.56, 0.17, 0.16])      # muscle: a deep, wet red
DARK_MEAT = np.array([0.34, 0.07, 0.08])
FASCIA = np.array([0.80, 0.62, 0.60])    # the silvery-pink film over muscle
FAT = np.array([0.93, 0.80, 0.48])       # yellow fat
CLOT = np.array([0.26, 0.03, 0.05])      # old blood, nearly black
BONE = np.array([0.88, 0.80, 0.66])
VESSEL = np.array([0.42, 0.10, 0.20])    # capillaries, plum-red


# ---------- ground ----------

def redder(rgb, keep=None, sat=1.3, hue=-6):
    """Raw meat after the grade, which pulls everything toward skin: back
    toward crimson, more saturated (except where `keep` says, such as fat)."""
    from world import from_hsv, to_hsv
    h, s, v = to_hsv(rgb)
    k = 1 - (np.clip(keep, 0, 1) if keep is not None else 0)
    signed = np.where(h > 180, h - 360, h)
    h2 = signed + hue * k * (np.abs(signed - 10) < 40)
    s2 = np.clip(s * (1 + (sat - 1) * k), 0, 1)
    return np.clip(from_hsv(h2, s2, v), 0, 1)


def deep_ground(n=1024, seed=17):
    """Raw muscle: bundles of fibres bending across the tile, marbled with fat
    between them, a net of capillaries over it, and everything wet."""
    rng = np.random.default_rng(seed)
    patchy = lambda bias: np.clip(spectral(n, rng, 3.4, fmax=0.012) * 0.7 + bias, 0, 1)

    # Fibres: fine grooves all running one way, bent by a slow warp; bundle
    # seams: deeper grooves the same way, further apart.
    fibres = stripes(n, rng, 2, 64, 0.35, 5.0, wiggle=0.01) * patchy(0.45)
    bundles = stripes(n, rng, 1, 9, 0.10, 3.5, wiggle=0.008)
    cross = stripes(n, rng, 23, -3, 0.08, 2.0, wiggle=0.02) * patchy(0.0)   # faint striations across
    h = -0.9 * gaussian_filter(fibres, 1.1, mode="wrap") - 0.4 * cross
    h -= 10.0 * gaussian_filter(bundles, 4.0, mode="wrap")
    # Each bundle bulges a little between its seams.
    l1, l2, _, _ = cells(n, rng, 46)
    swell = np.clip(1 - l1 / (0.6 * l2 + 1e-6), 0, 1)
    h += 18.0 * gaussian_filter(swell ** 1.4, 18, mode="wrap") + 10.0 * spectral(n, rng, 3.0, fmax=0.02)

    # Fat, marbled through the seams and in soft lumps.
    seam = gaussian_filter(bundles, 3.0, mode="wrap")
    marble = np.clip((spectral(n, rng, 2.4, fmax=0.05) - 0.6) * 1.6, 0, 1) * np.clip(seam * 2.5, 0, 1)
    f1, _, _, _ = cells(n, rng, 160)
    globs = np.clip(1 - f1 / 9.0, 0, 1) ** 0.8 * np.clip(spectral(n, rng, 3.0, fmax=0.03) - 0.4, 0, 1)
    fat = gaussian_filter(np.clip(marble + globs * 1.2, 0, 1), 1.2, mode="wrap")
    h += 9.0 * gaussian_filter(fat, 2.0, mode="wrap")

    # Capillaries: a fine net of raised plum threads.
    net = lines(spectral(n, rng, 2.2, fmax=0.04), 0.05) * patchy(0.35) + 0.6 * lines(spectral(n, rng, 2.0, fmax=0.07), 0.035) * patchy(0.1)
    net = np.clip(gaussian_filter(net, 0.6, mode="wrap"), 0, 1)
    h += 2.5 * net

    albedo = np.broadcast_to(MEAT, (n, n, 3)).copy()
    albedo = mix(albedo, DARK_MEAT, 0.35 + 0.35 * spectral(n, rng, 3.4, fmax=0.015))
    albedo = mix(albedo, DARK_MEAT * 0.8, 0.5 * gaussian_filter(bundles, 3, mode="wrap"))
    albedo = mix(albedo, FASCIA, np.clip(spectral(n, rng, 3.2, fmax=0.02) - 1.0, 0, 1) * 0.45)   # sheets of fascia
    albedo = mix(albedo, FAT, fat * 0.95)
    albedo = mix(albedo, VESSEL, net * 0.7)
    albedo *= (1 - 0.07 * gaussian_filter(fibres, 0.8, mode="wrap"))[..., None]

    # Pools of blood lying in the seams.
    pool = np.clip((gaussian_filter(bundles, 6, mode="wrap") - 0.25) * 5, 0, 1) * np.clip(spectral(n, rng, 3.0, fmax=0.02) - 0.5, 0, 1)
    pool = gaussian_filter(np.clip(pool * 2, 0, 1), 2, mode="wrap")
    h += 6 * pool
    albedo = mix(albedo, CLOT * 1.4, pool * 0.85)

    wet = 0.9 + 0.5 * fat + 1.2 * pool
    color = shade(h, albedo, wet, bump=1.0, shine=55, ao=0.05, periodic=True, sss=1.4)
    rgb = redder(tone(color, 0.85), fat)
    # A crisp wet glint over everything (it's all wet in here).
    nx, ny, nz = normals(h, periodic=True)
    ndh = np.clip(nx * HALF[0] + ny * HALF[1] + nz * HALF[2], 0, 1)
    rgb += ((0.25 + 0.6 * pool + 0.3 * fat) * (0.7 * ndh ** 250))[..., None] * np.array([1.0, 0.93, 0.88])
    return save(np.clip(rgb, 0, 1), "deep-ground")


def deep_plot_bed(name, seed, n=512, span=176, plot=144, tile=48):
    """A plot dug into the muscle: a ragged, glistening cut with a rim of fascia
    and a 3x3 grid of holes, darker and wetter than a sore on the skin."""
    rng = np.random.default_rng(seed)
    px_per = n / span
    x, y = field(n)
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    half = plot / span
    ang = np.arctan2(y, x)
    edge_noise = gaussian_filter(rng.standard_normal((n, n)), 14) * 14
    sq = (np.abs(x) ** 4 + np.abs(y) ** 4) ** (1 / 4)
    d = sq / (half * 0.95) * (1 + 0.09 * edge_noise)
    bed = np.clip((1 - d) * 10, 0, 1)
    depth = np.clip(1 - d, 0, 1)
    rim = np.exp(-(((d - 1.03) / 0.09) ** 2))
    shreds = 0.5 + 0.5 * np.sin(ang * 26 + 5 * edge_noise)            # torn fibres round the edge
    h = -12 * gaussian_filter(bed, 6) - 7 * depth * bed + 8 * rim * (0.6 + 0.6 * shreds)

    f1, _, _, _ = cells(n, rng, 2600, periodic=False)
    gran = np.exp(-((f1 / 2.4) ** 2))
    h += bed * (1.2 * gran + 2.0 * gaussian_filter(rng.standard_normal((n, n)), 2))

    holes = np.zeros((n, n))
    lips = np.zeros((n, n))
    rad = HOLE_RADIUS * px_per
    for row in range(3):
        for col in range(3):
            cx = n / 2 + ((col + 0.5) * tile - plot / 2) * px_per + rng.normal(0, 1.5)
            cy = n / 2 + ((row + 0.5) * tile - plot / 2 + HOLE_OFFSET) * px_per + rng.normal(0, 1.5)
            rr = np.sqrt((xx - cx) ** 2 + ((yy - cy) * 1.25) ** 2)
            holes = np.maximum(holes, np.clip((1 - rr / rad) * 3, 0, 1))
            lips = np.maximum(lips, np.exp(-(((rr - rad * 1.08) / (rad * 0.4)) ** 2)))
    h += -16 * gaussian_filter(holes, 2) + 4 * lips

    blotch = gaussian_filter(rng.standard_normal((n, n)), 12) * 12
    meat = mix(np.broadcast_to(np.array([0.22, 0.03, 0.04]), (n, n, 3)), np.array([0.58, 0.14, 0.14]), np.clip(d ** 2 * 1.2 + 0.25 * blotch, 0, 1))
    fatty = np.clip(gaussian_filter(rng.standard_normal((n, n)), 6) * 6 - 1.0, 0, 1)
    meat = mix(meat, FAT * 0.9, fatty * 0.6)
    edge = mix(np.broadcast_to(FASCIA, (n, n, 3)), MEAT, np.clip((d - 1.0) * 6, 0, 1))
    albedo = mix(edge, meat, bed)
    albedo = mix(albedo, np.array([0.06, 0.01, 0.02]), holes)
    gloss = 0.8 + 2.0 * bed + 0.8 * lips + 0.6 * rim
    color = shade(h, albedo, gloss, bump=1.1, shine=120, ao=0.2, sss=1.3)
    alpha = np.clip((1.16 - d) * 9, 0, 1)
    return save(redder(tone(color, 1.0), fatty, sat=1.15), name, alpha)


# ---------- props ----------

def blob_cluster(n, rng, count, spread, size):
    """Height of a cluster of soft round globs (fat, clots)."""
    x, y = field(n)
    h = np.zeros((n, n))
    for _ in range(count):
        cx, cy = rng.normal(0, spread, 2)
        r = rng.uniform(*size)
        d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
        h = np.maximum(h, np.clip(1 - d ** 2, 0, 1) ** 0.5 * r)
    return h


def fat(name, seed, n=160):
    """A clump of yellow fat: shiny little globes packed together."""
    rng = np.random.default_rng(seed)
    body = blob_cluster(n, rng, 14, 0.22, (0.14, 0.3))
    h = 60 * body + 1.5 * spectral(n, rng, 2.0, fmax=0.2) * (body > 0)
    alpha = np.clip(body * 40, 0, 1)
    albedo = mix(np.broadcast_to(FAT, (n, n, 3)), np.array([0.85, 0.55, 0.30]), np.clip(1 - body * 6, 0, 1) * 0.6)
    color = shade(h, albedo, 1.2, bump=1.0, shine=90, ao=0.3, sss=0.5)
    shadow = shadow_of(alpha, 4, 6, 3, 0.45) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def clot(name, seed, n=128):
    """A clot of old blood: dark, lumpy, glossy, with a lighter red edge."""
    rng = np.random.default_rng(seed)
    body = blob_cluster(n, rng, 7, 0.16, (0.18, 0.36))
    edge = np.clip(body * 30, 0, 1)
    h = 40 * body + 3 * spectral(n, rng, 1.8, fmax=0.25) * edge
    albedo = mix(np.broadcast_to(np.array([0.50, 0.06, 0.08]), (n, n, 3)), CLOT, np.clip(body * 6, 0, 1))
    color = shade(h, albedo, 1.6, bump=1.0, shine=120, ao=0.2)
    shadow = shadow_of(edge, 3, 5, 3, 0.4) * (1 - edge)
    rgb, a = composite(tone(color), edge, shadow)
    return save(rgb, name, a)


def marrow(name, seed, n=192):
    """A pit of spongy marrow: ivory bone full of holes, red jelly in them."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.15) ** 2) / 0.8
    dish = np.clip(1 - r, 0, 1)
    f1, f2, _, _ = cells(n, rng, 70, periodic=False)
    pores = np.clip(1 - f1 / (0.62 * f2 + 1e-6), 0, 1)                 # the holes of the sponge
    walls = 1 - np.clip(pores * 1.6, 0, 1)
    h = 14 * dish ** 0.6 * walls - 6 * np.clip(pores - 0.4, 0, 1) + 2 * spectral(n, rng, 1.6, fmax=0.3) * dish
    jelly = np.clip((pores - 0.35) * 3, 0, 1)
    albedo = mix(np.broadcast_to(BONE, (n, n, 3)), np.array([0.60, 0.10, 0.10]), jelly)
    albedo = mix(albedo, np.array([0.70, 0.55, 0.40]), np.clip(r * 1.2 - 0.5, 0, 1) * 0.5)
    gloss = 0.25 + 1.6 * jelly
    color = shade(h, albedo, gloss, bump=1.0, shine=90, ao=0.5)
    alpha = np.clip((1 - r) * 5, 0, 1)
    shadow = shadow_of(alpha, 3, 5, 3, 0.35) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def coil(name, seed, n=256):
    """A loop of gut lying coiled: a fat pink tube, wet, with its own little veins."""
    rng = np.random.default_rng(seed)
    img = Image.new("F", (n, n), 0.0)
    pts = []
    turns = 1.7
    wob = rng.uniform(0, 6, 3)
    for i in range(400):
        t = i / 399
        a = t * turns * 2 * np.pi
        rad = 0.10 + 0.25 * t + 0.03 * np.sin(t * 9 + wob[0])
        pts.append((n / 2 + np.cos(a) * rad * n + 6 * np.sin(t * 13 + wob[1]), n / 2 + np.sin(a) * rad * n * 0.85 + 6 * np.sin(t * 11 + wob[2])))
    # Distance to the coiled path, as a raised tube.
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    d = np.full((n, n), 1e9)
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
        d = np.minimum(d, np.hypot(xx - (x0 + t * dx), yy - (y0 + t * dy)))
    width = n * 0.085
    tube = np.clip(1 - (d / width) ** 2, 0, 1) ** 0.5
    rings = 0.5 + 0.5 * np.sin(np.arctan2(yy - n / 2, xx - n / 2) * 30)   # bulges along it
    h = 26 * tube * (0.97 + 0.03 * rings) + 1.2 * spectral(n, rng, 2.0, fmax=0.2) * tube
    net = lines(spectral(n, rng, 2.2, fmax=0.08), 0.06) * tube
    albedo = mix(np.broadcast_to(np.array([0.84, 0.50, 0.50]), (n, n, 3)), np.array([0.55, 0.22, 0.26]), np.clip(1 - tube * 2, 0, 1))
    albedo = mix(albedo, VESSEL, net * 0.7)
    color = shade(h, albedo, 1.3, bump=1.0, shine=90, ao=0.3, sss=1.2)
    alpha = np.clip(tube * 8, 0, 1)
    shadow = shadow_of(alpha, 4, 6, 4, 0.45) * (1 - alpha)
    rgb, a = composite(redder(tone(color), None, sat=1.15, hue=-3), alpha, shadow)
    return save(rgb, name, a)


# ---------- landmarks ----------

def knot(name, seed, n=640):
    """Where the Navel comes out underneath: a twisted knot of flesh, tied off,
    with the hole up to the skin at its middle, a little light coming down it."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.08) ** 2)
    ang = np.arctan2(y, x)
    warp = 0.04 * spectral(n, rng, 3.0, fmax=5 / n)
    rr = r + warp
    twist = np.cos(ang * 5 + rr * 14 + 2 * spectral(n, rng, 3.0, fmax=4 / n))   # strands twisting round
    strands = np.exp(-((rr - 0.42) / 0.22) ** 2) * (0.5 + 0.5 * twist)
    rim = np.exp(-((rr - 0.66) / 0.1) ** 2)
    hole = np.clip(1 - rr / 0.17, 0, 1)
    h = 60 * strands + 26 * rim - 90 * hole ** 1.2 + 4 * fine_skin(n, n, rng, pore=6.0) * (rr < 0.75)
    albedo = mix(np.broadcast_to(MEAT, (n, n, 3)), np.array([0.82, 0.48, 0.44]), np.clip(strands * 1.3, 0, 1))
    albedo = mix(albedo, FASCIA, rim * 0.6)
    albedo = mix(albedo, np.array([0.10, 0.02, 0.03]), np.clip(hole * 2, 0, 1))
    gloss = 0.9 + 0.8 * strands + 0.5 * rim
    color = shade(h, albedo, gloss, bump=0.6, shine=80, ao=0.03, sss=1.4)
    # Daylight from the skin, faint, at the bottom of the hole.
    light = np.exp(-((rr / 0.08) ** 2))
    color += light[..., None] * np.array([1.0, 0.85, 0.6]) * 0.9
    alpha = np.clip((0.98 - rr) * 4, 0, 1)
    return save(redder(tone(color), light * 3, sat=1.2), name, alpha)


def heart(name, seed, n=512):
    """A heart, big as a house: swollen and glistening, the stubs of its great
    vessels on top, fat in the groove down its front, veins all over."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    hx, hy = x * 1.25, -(y - 0.08) * 1.25
    f = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3                    # the classic heart curve
    body = np.clip(-f, 0, None) ** 0.33
    body = gaussian_filter(body / body.max(), 2)
    # Great vessels: short fat tubes going up off the top, between the lobes.
    tubes = np.zeros((n, n))
    for cx, w, top, lean in [(-0.14, 0.13, -0.97, -0.12), (0.08, 0.11, -0.92, 0.05), (0.27, 0.085, -0.80, 0.2)]:
        xs = x - cx - lean * (y + 0.4)
        cap = np.clip(1 - ((y - top) / 0.05) ** 2, 0, 1) * 0.6               # an open end, a little swollen
        t = np.clip(1 - (xs / w) ** 2, 0, 1) ** 0.5 * np.clip((y - top) * 30, 0, 1) * (y < -0.25)
        tubes = np.maximum(tubes, t * 0.62 + cap * t * 0.1)
    shape = np.maximum(body, tubes)
    net = lines(spectral(n, rng, 2.2, fmax=0.05), 0.05) * (body > 0.05)
    groove = np.exp(-(((x - 0.05 + (y + 0.2) * 0.45 - 0.12 * np.sin(y * 3)) / 0.02) ** 2)) * np.clip(body * 3, 0, 1) * np.clip(0.9 - y, 0, 1)
    h = 110 * shape + 5 * net - 2 * groove + 2 * spectral(n, rng, 2.0, fmax=0.1)
    albedo = mix(np.broadcast_to(np.array([0.62, 0.10, 0.12]), (n, n, 3)), np.array([0.36, 0.04, 0.07]), np.clip(1 - shape * 1.6, 0, 1))
    albedo = mix(albedo, FAT * 0.85, groove * 0.12)
    albedo = mix(albedo, np.array([0.30, 0.08, 0.30]), net * 0.6)
    albedo = mix(albedo, np.array([0.80, 0.42, 0.46]), np.clip((tubes - body) * 4, 0, 1) * 0.75)
    color = shade(h, albedo, 1.5, bump=0.8, shine=90, ao=0.05, sss=1.5)
    alpha = np.clip(shape * 14, 0, 1)
    shadow = shadow_of(alpha, 10, 16, 10, 0.55) * (1 - alpha)
    rgb, a = composite(redder(tone(color), groove), alpha, shadow)
    return save(rgb, name, a)


def ground():
    deep_ground()


def props():
    for i, seed in enumerate([201, 202, 203]):
        deep_plot_bed(f"deep-plot-{i}", seed)
    fat("fat-0", 211)
    fat("fat-1", 212)
    clot("clot-0", 213)
    clot("clot-1", 214)
    marrow("marrow-0", 215)
    marrow("marrow-1", 216)
    coil("coil-0", 217)


def landmarks():
    knot("knot", 221)
    heart("heart", 222)


def seeds():
    seed_icon("seed-vein", 231, [0.50, 0.08, 0.16], head=np.array([0.42, 0.12, 0.30]), rough=0.2)
    seed_icon("seed-marrow", 232, [0.90, 0.82, 0.68], head=np.array([0.70, 0.12, 0.12]), rough=0.5)


def main():
    parts = {"ground": ground, "props": props, "landmarks": landmarks, "seeds": seeds}
    for part in sys.argv[1:] or parts:
        parts[part]()


if __name__ == "__main__":
    main()

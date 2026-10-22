"""Usage: python tools/world.py [ground|events|life|gross]
Generates the world art into packages/client/public/world/. Deterministic (fixed seeds).
Everything is a height map + color + gloss, shaded with one warm key light from the
upper left, like the character renders, so ground, plots and props read as one scene,
then graded to the renders' skin (see grade). WORLD_OUT=dir renders somewhere else.
"""

import os
import sys
from pathlib import Path

import numpy as np
from numpy.fft import fft2, fftfreq, ifft2
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

# WORLD_OUT renders somewhere else, to compare a change before it replaces the art.
OUT = Path(os.environ.get("WORLD_OUT") or Path(__file__).resolve().parent.parent / "packages/client/public/world")
QUALITY = 84
# Must match HOLE_OFFSET in packages/client/src/world/layout.js: crops stand in the holes.
HOLE_OFFSET = 7     # world px below each tile's center
HOLE_RADIUS = 6.5

LIGHT = np.array([-0.55, -0.6, 0.58])
LIGHT /= np.linalg.norm(LIGHT)
HALF = LIGHT + np.array([0.0, 0.0, 1.0])
HALF /= np.linalg.norm(HALF)
KEY = np.array([1.0, 0.82, 0.66])       # warm, like candlelight in the renders
AMBIENT = np.array([0.20, 0.17, 0.21])  # dim, slightly cool fill
SSS = np.array([0.55, 0.10, 0.06])      # light bleeding red through flesh in the shadows
SHEEN = 0.6                              # the renders' highlights are a soft wet sheen, never a hard glint


# ---------- noise ----------

def spectral(n, rng, beta, fmax=None, fmin=None):
    """Tileable fractal noise: white noise shaped by 1/f^beta in frequency space."""
    fx = fftfreq(n)[:, None]
    fy = fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    amp = f ** (-beta / 2)
    if fmax:
        amp *= np.exp(-((f / fmax) ** 2))
    if fmin:
        amp *= 1 - np.exp(-((f / fmin) ** 2))
    amp[0, 0] = 0
    out = np.real(ifft2(fft2(rng.standard_normal((n, n))) * amp))
    return (out - out.mean()) / out.std()


def cells(n, rng, count, periodic=True):
    """Distances to the nearest and second-nearest of `count` random points (Worley)."""
    pts = rng.random((count, 2)) * n
    tree = cKDTree(pts, boxsize=n if periodic else None)
    yy, xx = np.mgrid[0:n, 0:n]
    query = np.stack([yy.ravel() + 0.5, xx.ravel() + 0.5], 1) % n
    d, idx = tree.query(query, k=2)
    return d[:, 0].reshape(n, n), d[:, 1].reshape(n, n), idx[:, 0].reshape(n, n), pts


def lines(noise, width):
    """Thin lines along the zero crossings of a noise field."""
    return np.exp(-((noise / width) ** 2))


def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return a * (1 - t) + np.asarray(b) * t


# ---------- shading ----------

def shade(height, albedo, gloss, bump=1.0, shine=60, wrap=0.35, ao=1.0, periodic=False, sss=1.0):
    if periodic:
        gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / 2
        gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / 2
        local = gaussian_filter(height, 6, mode="wrap")
    else:
        gy, gx = np.gradient(height)
        local = gaussian_filter(height, 6, mode="nearest")
    nx, ny, nz = -gx * bump, -gy * bump, np.ones_like(height)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / norm, ny / norm, nz / norm

    ndl = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
    diffuse = np.clip((ndl + wrap) / (1 + wrap), 0, 1)
    cavity = np.clip(1 + ao * (height - local), 0.35, 1.2)
    ndh = np.clip(nx * HALF[0] + ny * HALF[1] + nz * HALF[2], 0, 1)
    spec = SHEEN * gloss * (0.9 * ndh ** shine + 0.12 * ndh ** 6)

    color = albedo * (AMBIENT * cavity[..., None] + KEY * (diffuse * cavity)[..., None])
    color += sss * SSS * albedo * ((1 - diffuse) * cavity)[..., None] * 0.35
    color += (spec * cavity)[..., None] * np.array([1.0, 0.92, 0.84])
    return color


def tone(color, exposure=1.0):
    """Soft filmic shoulder so wet highlights roll off instead of clipping."""
    c = np.clip(color * exposure, 0, None)
    c = c / (1 + 0.35 * c)
    return grade(np.clip(c ** (1 / 1.1), 0, 1))


def to_hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    safe = np.maximum(d, 1e-9)
    h = np.where(mx == r, ((g - b) / safe) % 6, np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4)) * 60
    return np.where(d > 0, h, 0), np.where(mx > 0, d / np.maximum(mx, 1e-9), 0), mx


def from_hsv(h, s, v):
    h = (h % 360) / 60
    c = v * s
    x = c * (1 - np.abs(h % 2 - 1))
    z = np.zeros_like(h)
    i = np.floor(h).astype(int) % 6
    r = np.choose(i, [c, x, z, z, x, c])
    g = np.choose(i, [x, c, c, x, z, z])
    b = np.choose(i, [z, z, x, c, c, x])
    return np.stack([r, g, b], -1) + (v - c)[..., None]


def grade(rgb, strength=0.7):
    """The character renders' skin: red-brown in the shadows warming to ochre in
    the lights, rich in the dark and paler toward the highlights. Flesh-coloured
    pixels are pulled toward that, so the world reads as lit and graded like them
    (measured off the renders: hue ~10 degrees in shadow to ~27 in the lights),
    while strong reds keep their crimson."""
    h, s, v = to_hsv(rgb)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    signed = np.where(h > 180, h - 360, h)
    flesh = np.clip((50 - np.abs(signed - 10)) / 25, 0, 1) * np.clip(s * 6, 0, 1)
    k = np.clip(lum / 0.7, 0, 1)
    vivid = np.clip((s - 0.5) * 2.5, 0, 0.8)   # a strong red stays red, as blood and raw flesh do in the renders
    hue = signed + (10 + 17 * k - signed) * strength * flesh * (1 - vivid)
    sat = s + ((0.78 - 0.5 * k) - s) * 0.45 * flesh
    return np.clip(from_hsv(hue, np.clip(sat, 0, 1), v), 0, 1)


def fine_skin(h, w, rng, pore=5.0):
    """Pores and a net of fine creases, the surface detail of the renders' skin, as
    a height to add (pores and creases dip). `pore`: px between pores."""
    count = max(8, int(h * w / (pore * pore * 9)))
    tree = cKDTree(rng.random((count, 2)) * [h, w])
    yy, xx = np.mgrid[0:h, 0:w]
    d, _ = tree.query(np.stack([yy.ravel(), xx.ravel()], 1))
    pores = np.exp(-((d.reshape(h, w) / (pore * 0.32)) ** 2))
    n = gaussian_filter(rng.standard_normal((h, w)), pore * 0.7)
    creases = np.exp(-((n / (n.std() * 0.16)) ** 2))
    return -pores - 0.5 * creases


def save(rgb, name, alpha=None):
    OUT.mkdir(parents=True, exist_ok=True)
    data = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    if alpha is not None:
        a = (np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8)
        img = Image.fromarray(np.dstack([data, a]), "RGBA")
    else:
        img = Image.fromarray(data, "RGB")
    path = OUT / f"{name}.webp"
    img.save(path, "WEBP", quality=QUALITY, method=6)
    print(f"{name}: {path.stat().st_size // 1024} KB {img.size}")
    return img


# ---------- ground ----------

SKIN = np.array([0.78, 0.56, 0.50])
FLUSH = np.array([0.74, 0.40, 0.40])
JAUNDICE = np.array([0.76, 0.62, 0.46])
BRUISE = np.array([0.48, 0.36, 0.36])
VEIN = np.array([0.44, 0.32, 0.36])   # a dull plum under the skin, not blue


def stripes(n, rng, a, b, width, warp, wiggle=0.015):
    """Tileable wavy parallel grooves: a, b = how many cross the tile in x and y."""
    yy, xx = np.mgrid[0:n, 0:n]
    phase = 2 * np.pi * (a * xx + b * yy) / n + warp * spectral(n, rng, 3.2, fmax=wiggle)
    return np.clip((np.cos(phase) - (1 - width)) / width, 0, 1) ** 2


def ground(n=1024, seed=7):
    rng = np.random.default_rng(seed)
    patchy = lambda bias: np.clip(spectral(n, rng, 3.4, fmax=0.012) * 0.7 + bias, 0, 1)

    # Skin lines: wavy crossing grooves that cut the surface into little
    # diamonds, the texture you see on the back of a hand.
    sets = [(41, 49, 2.2, 1.0), (-50, 38, 2.2, 0.9), (6, -63, 2.5, 0.5)]
    skin_lines = sum(stripes(n, rng, a, b, 0.2, w, wiggle=0.05) * patchy(0.4) * k for a, b, w, k in sets)
    h = -0.25 * gaussian_filter(np.clip(skin_lines, 0, 1.4), 1.2, mode="wrap")

    # Pores sit where the lines cross, plus a scatter of loose ones.
    crossings = gaussian_filter(np.clip(skin_lines - 1.0, 0, 1), 0.8, mode="wrap")
    p1, _, _, _ = cells(n, rng, 900)
    pores = np.clip(crossings * 1.5 + np.exp(-((p1 / 1.6) ** 2)), 0, 1)
    h -= 1.4 * pores

    # Folds: long soft creases running mostly one way, fading in and out.
    folds = stripes(n, rng, 3, 5, 0.06, 1.4) * patchy(0.5) + stripes(n, rng, -4, 3, 0.05, 1.6) * patchy(0.25)
    wrinkles = stripes(n, rng, 13, 9, 0.10, 1.5, wiggle=0.03) * patchy(0.3)
    h -= 7.0 * gaussian_filter(folds, 6.0, mode="wrap") + 1.8 * gaussian_filter(wrinkles, 2.5, mode="wrap")

    # Lumps: soft fleshy swellings that catch wet highlights.
    l1, l2, _, _ = cells(n, rng, 70)
    lumps = np.clip(1 - l1 / (0.55 * l2 + 1e-6), 0, 1)
    h += 26.0 * gaussian_filter(lumps ** 1.5, 16, mode="wrap")
    h += 12.0 * spectral(n, rng, 3.0, fmax=0.02)

    vein_tint = np.clip(spectral(n, rng, 2.6, fmax=0.03) - 0.8, 0, 1)

    albedo = np.broadcast_to(SKIN, (n, n, 3)).copy()
    albedo = mix(albedo, FLUSH, 0.45 + 0.4 * spectral(n, rng, 3.4, fmax=0.015))
    albedo = mix(albedo, JAUNDICE, 0.3 * spectral(n, rng, 3.4, fmax=0.012))
    albedo = mix(albedo, BRUISE, np.clip(spectral(n, rng, 3.6, fmax=0.01) - 1.4, 0, 1) * 0.5)
    albedo = mix(albedo, VEIN, 0.25 * vein_tint)
    albedo = mix(albedo, FLUSH * 0.6, 0.18 * gaussian_filter(folds, 6, mode="wrap"))
    albedo *= (1 - 0.25 * pores)[..., None]
    albedo *= (1 + 0.05 * spectral(n, rng, 1.0))[..., None]

    wet = np.clip(0.35 + 0.2 * spectral(n, rng, 3, fmax=0.02), 0.1, 1)
    color = shade(h, albedo, wet, bump=1.0, shine=45, ao=0.04, periodic=True)
    # The set behind the characters: softer and a little quieter in colour than
    # anything standing on it, like the background of a portrait.
    rgb = tone(color, 0.82)
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    return save(lum + (rgb - lum) * 0.82, "ground")


def macro(n=256, seed=11):
    """Big, soft light/dark and color drift, stretched over the world to hide the ground tile repeating."""
    rng = np.random.default_rng(seed)
    v = spectral(n, rng, 3.5, fmax=0.06)
    warm = spectral(n, rng, 3.5, fmax=0.05)
    rgb = np.stack([0.80 + 0.14 * v + 0.05 * warm, 0.78 + 0.14 * v - 0.03 * warm, 0.80 + 0.14 * v - 0.04 * warm], -1)
    return save(np.clip(rgb, 0, 1), "ground-macro")


# ---------- props (non-tiling, transparent) ----------

def field(n):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    return (xx + 0.5) / n * 2 - 1, (yy + 0.5) / n * 2 - 1


def shadow_of(alpha, dx, dy, blur, strength):
    a = np.roll(np.roll(alpha, dy, 0), dx, 1)
    return gaussian_filter(a, blur) * strength


def composite(color, alpha, shadow):
    """Object over its own soft shadow (shadow is black)."""
    out_a = alpha + shadow * (1 - alpha)
    rgb = color * (alpha / np.maximum(out_a, 1e-6))[..., None]
    return rgb, out_a


def pimple(name, seed, size=1.0, head=None, n=96):
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y) / (0.62 * size)
    wobble = 1 + 0.08 * gaussian_filter(rng.standard_normal((n, n)), 6) * 6
    dome = np.exp(-((r * wobble) ** 2) * 2.4)
    h = 7 * dome + 0.6 * fine_skin(n, n, rng, pore=4.0)
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.70, 0.30, 0.24]), np.clip(1.6 * dome, 0, 1) * 0.8)
    gloss = 0.5 + 0.4 * dome
    if head is not None:
        cap = np.exp(-((r / 0.33) ** 2) * 3)
        h += 3 * cap
        albedo = mix(albedo, head, np.clip(cap * 1.4, 0, 1))
        gloss = gloss + 0.4 * cap
    color = shade(h, albedo, gloss, bump=1.0, shine=90, ao=0.0)
    alpha = np.clip((1.15 - r) * 2.2, 0, 1)                             # fades into the ground
    shadow = shadow_of(np.clip(dome * 1.5, 0, 1), 3, 4, 2.5, 0.25) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def mole(name, seed, n=96):
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y) / 0.5
    edge = 1 + 0.12 * gaussian_filter(rng.standard_normal((n, n)), 5) * 5
    body = np.clip((1 - r * edge) * 4, 0, 1)
    h = 3 * gaussian_filter(body, 3) + 0.6 * gaussian_filter(rng.standard_normal((n, n)), 1.2) * body
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.28, 0.17, 0.13]), body)
    img = Image.new("L", (n * 4, n * 4), 0)
    draw = ImageDraw.Draw(img)
    for _ in range(rng.integers(1, 3)):                                 # a hair or two growing out of it
        px, py = n * 2 + rng.normal(0, n * 0.25), n * 2 + rng.normal(0, n * 0.25)
        ang = rng.uniform(0, 2 * np.pi)
        pts = []
        for i in range(12):
            ang += rng.normal(0, 0.25)
            px += np.cos(ang) * n * 0.12
            py += np.sin(ang) * n * 0.12
            pts.append((px, py))
        draw.line([(n * 2, n * 2)] + pts, fill=255, width=5)
    hair = np.asarray(img.resize((n, n), Image.LANCZOS), float) / 255
    h += 2.5 * hair
    albedo = mix(albedo, np.array([0.08, 0.06, 0.05]), hair)
    alpha = np.clip(np.maximum(body * 1.2, hair) + np.clip((1.3 - r) * 1.5, 0, 1) * 0.0, 0, 1)
    alpha = np.maximum(alpha, np.clip((1.25 - r) * 3, 0, 1) * 0.6)
    color = shade(h, albedo, 0.4 + 0.3 * hair, bump=1.0, shine=60, ao=0.0)
    shadow = shadow_of(np.maximum(body, hair), 2, 3, 1.5, 0.35) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def hair(name, seed, n=192, curl=0.22, length=40, width=7):
    rng = np.random.default_rng(seed)
    s = 4
    img = Image.new("L", (n * s, n * s), 0)
    draw = ImageDraw.Draw(img)
    x, y = n * s * 0.5, n * s * 0.5
    ang = rng.uniform(0, 2 * np.pi)
    x -= np.cos(ang) * n * s * 0.38                                     # root near one edge, lying across
    y -= np.sin(ang) * n * s * 0.38
    turn = rng.normal(0, curl)
    pts = [(x, y)]
    step = n * s / length * 1.05
    for _ in range(length):
        turn += rng.normal(0, curl * 0.5)
        turn *= 0.92
        ang += turn
        x += np.cos(ang) * step
        y += np.sin(ang) * step
        x = min(max(x, n * s * 0.06), n * s * 0.94)
        y = min(max(y, n * s * 0.06), n * s * 0.94)
        pts.append((x, y))
    for i in range(len(pts) - 1):                                       # tapers toward the tip
        w = max(1, int(width * s * (1 - i / len(pts)) ** 0.6))
        draw.line([pts[i], pts[i + 1]], fill=255, width=w)
        draw.ellipse([pts[i + 1][0] - w / 2, pts[i + 1][1] - w / 2, pts[i + 1][0] + w / 2, pts[i + 1][1] + w / 2], fill=255)
    mask = np.asarray(img.resize((n, n), Image.LANCZOS), float) / 255
    h = 5 * gaussian_filter(mask, 1.0)
    albedo = np.broadcast_to(np.array([0.24, 0.16, 0.12]), (n, n, 3))   # dark brown, not ink: the ground stays quiet
    color = shade(h, albedo, 1.2, bump=1.8, shine=30, ao=0.0, sss=0)
    root = np.zeros((n, n))
    root[int(pts[0][1] / s), int(pts[0][0] / s)] = 1
    follicle = gaussian_filter(root, 2.5) * 60
    alpha = np.clip(mask + follicle, 0, 1)
    shadow = shadow_of(mask, 3, 4, 2.0, 0.45) * (1 - alpha)
    rgb, a = composite(tone(color, 1.2), alpha, shadow)
    return save(rgb, name, a)


def puddle(name, seed, tint, n=256):
    rng = np.random.default_rng(seed)
    x, y = field(n)
    blob = np.zeros((n, n))
    for _ in range(7):                                                  # metaball blob
        cx, cy = rng.normal(0, 0.22, 2)
        rad = rng.uniform(0.18, 0.34)
        blob += np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / rad ** 2))
    blob *= 1 + 0.15 * gaussian_filter(rng.standard_normal((n, n)), 8) * 8
    inside = np.clip((blob - 0.7) * 6, 0, 1)
    h = 14 * gaussian_filter(inside, 7) + 1.5 * gaussian_filter(rng.standard_normal((n, n)), 4) * 4 * inside
    # A thin liquid layer: tints and darkens what's under it, edges refract dark,
    # and the wet highlights are the only opaque part.
    rim = np.clip(inside - gaussian_filter(inside, 2.5), 0, 1) * 2.5
    gy, gx = np.gradient(h)
    nx, ny = -gx * 1.4, -gy * 1.4
    nz = np.ones_like(h)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    ndh = np.clip((nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) / norm, 0, 1)
    glint = np.clip(ndh ** 160 * 2.5 + ndh ** 30 * 0.25, 0, 1) * inside
    tint = np.asarray(tint)
    rgb = np.broadcast_to(tint, (n, n, 3)) * (1 - 0.55 * rim)[..., None]
    rgb = rgb * (1 - glint)[..., None] + glint[..., None]
    alpha = np.clip(inside * 0.28 + rim * 0.55 + glint, 0, 1)
    return save(rgb, name, alpha)


def plot_bed(name, seed, n=512, span=176, plot=144, tile=48):
    """A raw, wet sore in the skin with a puckered rim and a 3x3 grid of follicle holes."""
    rng = np.random.default_rng(seed)
    px_per = n / span
    x, y = field(n)
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    half = plot / span                                                  # bed half-size in field units
    ang = np.arctan2(y, x)
    edge_noise = gaussian_filter(rng.standard_normal((n, n)), 14) * 14
    sq = (np.abs(x) ** 4 + np.abs(y) ** 4) ** (1 / 4)                   # rounded square
    d = sq / (half * 0.95) * (1 + 0.07 * edge_noise)

    bed = np.clip((1 - d) * 10, 0, 1)
    depth = np.clip(1 - d, 0, 1)
    rim = np.exp(-(((d - 1.03) / 0.08) ** 2))
    pucker = 0.5 + 0.5 * np.sin(ang * 40 + 4 * edge_noise)
    h = -10 * gaussian_filter(bed, 6) - 6 * depth * bed + 9 * rim * (0.7 + 0.5 * pucker)

    f1, _, _, _ = cells(n, rng, 2200, periodic=False)                   # granulation, like raw meat
    gran = np.exp(-((f1 / 2.6) ** 2))
    h += bed * (1.0 * gran + 2.4 * gaussian_filter(rng.standard_normal((n, n)), 2))

    # Holes sit a little below each tile's center: crops stand in them, feet down.
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
    meat = mix(np.broadcast_to(np.array([0.30, 0.06, 0.04]), (n, n, 3)), np.array([0.66, 0.24, 0.18]), np.clip(d ** 2 * 1.2 + 0.25 * blotch, 0, 1))
    slough = np.clip(gaussian_filter(rng.standard_normal((n, n)), 7) * 7 - 0.9, 0, 1)
    meat = mix(meat, np.array([0.84, 0.66, 0.36]), slough * 0.8)       # yellowish slough
    skin = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.76, 0.40, 0.32]), np.clip(1.5 - (d - 1) * 8, 0, 1))
    albedo = mix(skin, meat, bed)
    albedo = mix(albedo, np.array([0.08, 0.01, 0.02]), holes)
    gloss = 0.5 + 1.8 * bed + 0.8 * lips
    color = shade(h, albedo, gloss, bump=1.1, shine=120, ao=0.2)
    alpha = np.clip((1.16 - d) * 9, 0, 1)
    return save(tone(color, 1.0), name, alpha)


def candle(name, seed, w=96, h=192):
    """A stubby candle standing in the flesh, seen from above at an angle, lit by its own flame."""
    rng = np.random.default_rng(seed)
    s = 4
    W, H = w * s, h * s
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    cx, rx = W / 2, W * 0.26
    top, bottom = H * 0.30, H * 0.86
    ry = rx * 0.38
    u = (xx - cx) / rx                                                  # -1..1 across the body
    body = (np.abs(u) <= 1) & (yy >= top) & (yy <= bottom + ry * np.sqrt(np.clip(1 - u * u, 0, 1)))
    cap = ((xx - cx) / rx) ** 2 + ((yy - top) / ry) ** 2 <= 1
    pool_noise = gaussian_filter(rng.standard_normal((H, W)), 30) * 30
    pool = ((xx - cx) / (rx * 1.7)) ** 2 + ((yy - bottom) / (ry * 1.7)) ** 2 <= 1 + 0.5 * pool_noise
    drips = np.zeros((H, W), bool)
    for _ in range(10):
        du = rng.uniform(-0.9, 0.9)
        dl = rng.uniform(0.15, 0.6) * (bottom - top)
        dw = rng.uniform(0.07, 0.14) * rx
        dx = cx + du * rx
        y0 = top + ry * np.sqrt(1 - du * du) * 0.6
        drips |= (np.abs(xx - dx) < dw) & (yy > y0) & (yy < y0 + dl)
        drips |= (xx - dx) ** 2 + (yy - y0 - dl) ** 2 < (dw * 1.4) ** 2
    drips &= ~cap
    shape = body | cap | pool | (drips & (np.abs(u) <= 1.12))

    wax = np.array([0.80, 0.68, 0.48])                                  # old, yellowed tallow
    grime = 1 - 0.18 * np.clip(gaussian_filter(rng.standard_normal((H, W)), 6) * 6, -1, 1)
    shade_u = np.clip(1 - u, 0, 2) / 2                                  # lit from the left
    glow = np.exp(-((yy - top) / ((bottom - top) * 0.45)) ** 2)        # flame glowing through the wax
    rgb = np.zeros((H, W, 3))
    lit = (0.22 + 0.7 * shade_u ** 0.8)[..., None] * wax * grime[..., None]
    lit += glow[..., None] * np.array([0.65, 0.30, 0.06]) * 0.8
    rgb[:] = lit
    crater = ((xx - cx) / (rx * 0.75)) ** 2 + ((yy - top) / (ry * 0.75)) ** 2 <= 1
    rgb[cap] = wax * 1.0 + np.array([0.22, 0.10, 0.0])
    rgb[cap & crater] = wax * 0.75 + np.array([0.30, 0.12, 0.0])         # melted pool lit by the flame
    pool_only = pool & ~body
    rgb[pool_only] = (wax * 0.45 * grime[..., None] + np.array([0.04, 0.0, 0.0]))[pool_only]
    rgb[drips] = rgb[drips] * 1.15
    wick = (np.abs(xx - cx) < W * 0.012) & (yy > top - H * 0.05) & (yy < top + ry * 0.2)
    rgb[wick] = [0.05, 0.03, 0.02]
    shape |= wick

    alpha = Image.fromarray((shape * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
    alpha = np.asarray(alpha, float) / 255
    rgb = np.stack([np.asarray(Image.fromarray((np.clip(rgb[..., i], 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS), float) / 255 for i in range(3)], -1)
    shadow = np.zeros((h, w))
    sh = np.roll(np.roll(alpha, 6, 0), 10, 1) * (np.mgrid[0:h, 0:w][0] > h * 0.55)
    shadow = gaussian_filter(sh, 4) * 0.5 * (1 - alpha)
    rgb, a = composite(rgb, alpha, shadow)
    return save(rgb, name, a)


def flame(name, n=64):
    x, y = field(n)
    yy = (y + 0.35) / 1.35
    r = np.sqrt((x / (0.42 * np.clip(1 - yy * 0.7, 0.2, 1))) ** 2 + ((y - 0.25) / 0.75) ** 2)
    core = np.clip(1 - r, 0, 1)
    rgb = np.stack([np.ones_like(core), 0.55 + 0.45 * core, 0.15 + 0.75 * core ** 2], -1)
    return save(rgb, name, np.clip(core * 2.2, 0, 1))


def glow(name, n=256, falloff=2.2):
    x, y = field(n)
    r = np.sqrt(x * x + y * y)
    a = np.clip(1 - r, 0, 1) ** falloff
    return save(np.ones((n, n, 3)), name, a)


# ---------- event and UI art ----------

def boil(name, seed, n=384):
    """The world boss: a huge, tight, shiny boil with a yellow head, veins creeping up its sides."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.08) ** 2) / 0.72
    wobble = 1 + 0.04 * spectral(n, rng, 3.0, fmax=5 / n)
    dome = np.clip(1 - (r * wobble) ** 2, 0, 1) ** 0.8
    hx, hy = -0.08, -0.12                                               # head sits a little toward the light
    hr = np.sqrt((x - hx) ** 2 + (y - hy) ** 2) / 0.36
    head = np.exp(-(hr ** 2) * 2.2)
    h = 150 * dome + 22 * head + 2.0 * spectral(n, rng, 3.0, fmax=14 / n) * dome
    # Veins creep up from the base toward the head, wandering a little.
    ang = np.arctan2(y, x)
    phase = ang * 9 + 2.2 * spectral(n, rng, 3.2, fmax=6 / n) + 3 * r
    veins = np.exp(-((np.sin(phase / 2) / 0.05) ** 2))
    veins *= np.clip((r - 0.45) * 3, 0, 1) * np.clip((1.0 - r) * 8, 0, 1)
    h += 3.0 * veins + 1.0 * fine_skin(n, n, rng, pore=4.0)
    albedo = mix(np.broadcast_to(np.array([0.46, 0.08, 0.08]), (n, n, 3)), np.array([0.78, 0.26, 0.22]), np.clip(dome * 1.3, 0, 1))
    albedo = mix(albedo, np.array([0.36, 0.10, 0.10]), veins * 0.7)
    albedo = mix(albedo, np.array([0.96, 0.86, 0.50]), np.clip(head * 1.6, 0, 1))
    albedo = mix(albedo, np.array([1.0, 0.97, 0.86]), np.clip((head - 0.75) * 4, 0, 1))
    halo = np.clip(1.5 - r, 0, 1) * (1 - np.clip(dome * 3, 0, 1))
    blotch = np.clip(0.6 + 0.6 * spectral(n, rng, 2.6, fmax=20 / n), 0, 1)   # inflamed skin is blotchy, not an even glow
    skin = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.62, 0.28, 0.22]), np.clip(halo * 0.8 * blotch, 0, 0.6))
    albedo = np.where((dome > 0)[..., None], albedo, skin)
    gloss = 0.4 + 1.6 * dome + 0.8 * head
    color = shade(h, albedo, gloss, bump=0.9, shine=140, ao=0.05)
    alpha = np.clip((1.45 - r) * 3, 0, 1)
    shadow = shadow_of(np.clip(dome * 2, 0, 1), 10, 14, 10, 0.5) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def scab(name, seed, n=64):
    """A dry crust over a follicle hole that isn't open yet."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.25) ** 2) / 0.8
    edge = 1 + 0.12 * spectral(n, rng, 3.0, fmax=6 / n)
    body = np.clip((1 - r * edge) * 6, 0, 1)
    f1, f2, _, _ = cells(n, rng, 14, periodic=False)
    cracks = np.exp(-(((f2 - f1) / 1.4) ** 2)) * np.clip((0.75 - r) * 4, 0, 1)
    h = 6 * body + 1.2 * spectral(n, rng, 2.6, fmax=16 / n) * body - 2.0 * cracks * body
    albedo = mix(np.broadcast_to(np.array([0.36, 0.12, 0.08]), (n, n, 3)), np.array([0.55, 0.26, 0.14]), np.clip(0.5 + 0.4 * spectral(n, rng, 2.6, fmax=12 / n), 0, 1))
    albedo = mix(albedo, np.array([0.12, 0.03, 0.03]), cracks * 0.8)
    color = shade(h, albedo, 0.15 + 0.1 * body, bump=1.0, shine=30, ao=0.3)
    shadow = shadow_of(body, 2, 3, 2, 0.4) * (1 - body)
    rgb, a = composite(tone(color), body, shadow)
    return save(rgb, name, a)


def droplet(name, tint, n=48):
    """A glossy blob of goo for bursts and splashes."""
    x, y = field(n)
    r = np.sqrt(x * x + y * y) / 0.8
    dome = np.clip(1 - r ** 2, 0, 1) ** 0.5
    color = shade(10 * dome, np.broadcast_to(np.array(tint), (n, n, 3)), 1.6, shine=60, ao=0.0, sss=0.3)
    return save(tone(color), name, np.clip((1 - r) * 6, 0, 1))


def seed_icon(name, seed, albedo, head=None, rough=0.0, n=128):
    """Dock icons: a seed sitting on a scrap of skin."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt((x * 1.05) ** 2 + ((y + 0.05) * 1.2) ** 2) / 0.62
    dome = np.clip(1 - r ** 2, 0, 1) ** 0.7
    h = 30 * dome + rough * 3 * spectral(n, rng, 1.6) * dome
    alb = np.broadcast_to(np.array(albedo), (n, n, 3)).copy()
    alb = mix(alb, np.array(albedo) * 0.55, np.clip(1 - dome * 1.6, 0, 1))
    gloss = (1.0 - rough) * (0.6 + dome)
    if head is not None:
        hr = np.sqrt((x + 0.08) ** 2 + (y + 0.14) ** 2) / 0.26
        cap = np.exp(-(hr ** 2) * 2.5)
        h += 8 * cap
        alb = mix(alb, head, np.clip(cap * 1.6, 0, 1))
        gloss = gloss + 0.6 * cap
    color = shade(h, alb, gloss, bump=1.0, shine=90, ao=0.1)
    alpha = np.clip((1 - r) * 8, 0, 1)
    shadow = shadow_of(alpha, 4, 6, 4, 0.55) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


# ---------- life: critters, trails, regions, landmarks ----------

def legs_mask(n, s, pairs, spread, bend, length, width, frame, rng, cx=None, cy=None):
    """Jointed legs fanning out from a body, drawn at s x supersampling."""
    img = Image.new("L", (n * s, n * s), 0)
    draw = ImageDraw.Draw(img)
    cx = n * s / 2 if cx is None else cx
    cy = n * s / 2 if cy is None else cy
    for i in range(pairs):
        base_y = cy + (i - (pairs - 1) / 2) * spread * s
        swing = (0.32 if (i + frame) % 2 else -0.32)                     # alternate legs step
        for side in (-1, 1):
            ang = side * (np.pi / 2) + side * (i - (pairs - 1) / 2) * 0.45 + swing * side
            knee = (cx + side * 6 * s + np.cos(ang - side * bend) * length * 0.5 * s,
                    base_y + np.sin(ang - side * bend) * length * 0.5 * s)
            foot = (knee[0] + np.cos(ang + side * bend) * length * 0.55 * s,
                    knee[1] + np.sin(ang + side * bend) * length * 0.55 * s + rng.normal(0, 0.5) * s)
            draw.line([(cx + side * 4 * s, base_y), knee, foot], fill=255, width=int(width * s), joint="curve")
    return np.asarray(img.resize((n, n), Image.LANCZOS), float) / 255


def mite(name, seed, frame, n=96):
    """A dust mite seen from above: a pale, lumpy, translucent sack on eight jointed legs."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    abdomen = np.clip(1 - ((x / 0.34) ** 2 + ((y - 0.08) / 0.42) ** 2), 0, 1)
    head = np.clip(1 - ((x / 0.16) ** 2 + ((y + 0.42) / 0.14) ** 2), 0, 1)
    body = np.clip(np.maximum(abdomen, head) * 4, 0, 1)
    lumps = gaussian_filter(rng.standard_normal((n, n)), 2.2) * 3
    h = 9 * np.sqrt(abdomen) + 5 * np.sqrt(head) + 0.8 * lumps * body
    legs = legs_mask(n, 4, 4, 9, 0.5, 26, 2.2, frame, rng) * (1 - body)
    h += 2.0 * gaussian_filter(legs, 0.7)
    albedo = mix(np.broadcast_to(np.array([0.86, 0.74, 0.62]), (n, n, 3)), np.array([0.62, 0.34, 0.26]), np.clip(0.5 + 0.35 * lumps, 0, 1))
    albedo = mix(albedo, np.array([0.48, 0.26, 0.18]), np.clip(head * 3, 0, 1))
    albedo = mix(albedo, np.array([0.40, 0.22, 0.16]), legs)
    color = shade(h, albedo, 0.9 * body + 0.3 * legs, bump=1.0, shine=70, ao=0.2, sss=1.2)
    alpha = np.clip(body + legs, 0, 1)
    shadow = shadow_of(alpha, 3, 4, 2.0, 0.45) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def flea(name, seed, n=96):
    """A flea from above: a glossy dark-amber shell in bands, big hind legs folded at its sides."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    shell = np.clip(1 - ((x / 0.26) ** 2 + (y / 0.46) ** 2), 0, 1)
    head = np.clip(1 - ((x / 0.14) ** 2 + ((y + 0.5) / 0.12) ** 2), 0, 1)
    body = np.clip(np.maximum(shell, head) * 5, 0, 1)
    bands = 0.5 + 0.5 * np.cos((y + 0.5) * 30)
    h = 10 * np.sqrt(shell) + 4 * np.sqrt(head) - 0.8 * bands * body
    legs = legs_mask(n, 4, 3, 10, 0.9, 30, 3.2, 0, rng) * (1 - body)
    h += 2.5 * gaussian_filter(legs, 0.7)
    albedo = mix(np.broadcast_to(np.array([0.36, 0.18, 0.08]), (n, n, 3)), np.array([0.18, 0.08, 0.04]), bands * 0.6)
    albedo = mix(albedo, np.array([0.30, 0.16, 0.08]), legs)
    color = shade(h, albedo, 1.4 * body + 0.4 * legs, bump=1.2, shine=110, ao=0.1, sss=0.4)
    alpha = np.clip(body + legs, 0, 1)
    shadow = shadow_of(alpha, 3, 4, 2.0, 0.5) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def worm(name, seed, head=False, n=96):
    """One ring of a big pale worm (or its head, with a puckered mouth), front toward -y."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt((x / 0.62) ** 2 + (y / 0.5) ** 2)
    dome = np.clip(1 - r ** 2, 0, 1) ** 0.6
    rings = 0.5 + 0.5 * np.cos(y * 22)
    h = 18 * dome - 1.4 * rings * dome + 0.6 * gaussian_filter(rng.standard_normal((n, n)), 2) * 3 * dome
    albedo = mix(np.broadcast_to(np.array([0.90, 0.66, 0.62]), (n, n, 3)), np.array([0.74, 0.40, 0.42]), rings * 0.5)
    if head:
        mouth = np.exp(-((x / 0.14) ** 2 + ((y + 0.28) / 0.1) ** 2))
        h -= 9 * mouth
        albedo = mix(albedo, np.array([0.30, 0.04, 0.06]), np.clip(mouth * 2, 0, 1))
    color = shade(h, albedo, 0.9 + 0.5 * dome, bump=0.8, shine=80, ao=0.2, sss=1.4)
    alpha = np.clip((1 - r) * 8, 0, 1)
    shadow = shadow_of(alpha, 4, 6, 3.0, 0.45) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def smear(name, seed, n=96):
    """A wet streak of slime left behind by something walking: mostly highlights."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    blob = np.exp(-((x / 0.22) ** 2 + (y / 0.55) ** 2))
    blob *= 1 + 0.25 * gaussian_filter(rng.standard_normal((n, n)), 5) * 5
    inside = np.clip((blob - 0.35) * 4, 0, 1)
    h = 6 * gaussian_filter(inside, 3)
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * 1.6, -gy * 1.6, np.ones_like(h)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    ndh = np.clip((nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) / norm, 0, 1)
    glint = np.clip(ndh ** 120 * 2.5 + ndh ** 20 * 0.2, 0, 1) * inside
    rim = np.clip(inside - gaussian_filter(inside, 2.0), 0, 1) * 2.5
    rgb = np.broadcast_to(np.array([0.70, 0.78, 0.52]), (n, n, 3)) * (1 - 0.5 * rim)[..., None]
    rgb = rgb * (1 - glint)[..., None] + glint[..., None]
    return save(rgb, name, np.clip(inside * 0.5 + rim * 0.5 + glint, 0, 1))


def freckle(name, seed, n=64):
    """A flat brown freckle: no height, a ragged soft edge."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y) / 0.7
    edge = 1 + 0.25 * spectral(n, rng, 2.4, fmax=6 / n)
    body = np.clip((1 - r * edge) * 2.5, 0, 1)
    tint = mix(np.broadcast_to(np.array([0.52, 0.30, 0.18]), (n, n, 3)), np.array([0.40, 0.20, 0.12]), np.clip(0.5 + 0.4 * spectral(n, rng, 2.0, fmax=10 / n), 0, 1))
    return save(tint, name, body * 0.75)


def wart(name, seed, n=128):
    """A cauliflower wart: a rough grey-pink dome of little knobs."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y) / 0.62
    dome = np.clip(1 - r ** 2, 0, 1) ** 0.7
    f1, _, _, _ = cells(n, rng, 40, periodic=False)
    knobs = np.clip(1 - f1 / (n * 0.09), 0, 1) ** 0.6
    h = 16 * dome + 7 * knobs * dome
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.70, 0.62, 0.58]), np.clip(dome * 1.5, 0, 1))
    albedo = mix(albedo, np.array([0.50, 0.30, 0.28]), (1 - knobs) * dome * 0.6)
    color = shade(h, albedo, 0.15 + 0.1 * knobs, bump=1.0, shine=25, ao=0.5)
    alpha = np.clip((1.02 - r) * 6, 0, 1)
    shadow = shadow_of(np.clip(dome * 2, 0, 1), 4, 6, 3, 0.35) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def navel(name, seed, n=640):
    """The belly button at the middle of the world: a deep, folded pit, glistening at the bottom."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.12) ** 2)
    ang = np.arctan2(y, x)
    warp = 0.05 * spectral(n, rng, 3.0, fmax=5 / n)
    rr = r + warp
    folds = np.cos(ang * 7 + 3 * spectral(n, rng, 3.0, fmax=4 / n)) * np.exp(-((rr - 0.40) / 0.2) ** 2)
    rim = np.exp(-((rr - 0.62) / 0.12) ** 2)                            # a soft swelling lip
    pit = -np.clip(1 - rr / 0.5, 0, 1) ** 1.6
    h = 120 * pit + 30 * rim + 30 * folds + 3 * spectral(n, rng, 2.8, fmax=60 / n) + 3 * fine_skin(n, n, rng, pore=7.0)
    depth = np.clip(-pit, 0, 1)
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.60, 0.30, 0.24]), np.clip(depth * 1.4, 0, 1))
    albedo = mix(albedo, np.array([0.18, 0.04, 0.05]), np.clip((depth - 0.6) * 2.5, 0, 1))
    lint = np.clip(spectral(n, rng, 1.6, fmax=60 / n) - 1.6, 0, 1) * np.clip(depth * 2, 0, 1)
    albedo = mix(albedo, np.array([0.55, 0.55, 0.62]), lint * 0.7)    # a little belly-button lint
    gloss = 0.3 + 1.2 * np.clip((depth - 0.5) * 2, 0, 1) + 0.4 * rim
    color = shade(h, albedo, gloss, bump=0.5, shine=90, ao=0.02, sss=1.2)
    color *= (1 - 0.75 * np.clip((depth - 0.45) * 2, 0, 1))[..., None]  # the bottom is dark
    alpha = np.clip((1.0 - rr) * 4, 0, 1)
    return save(tone(color), name, alpha)


def eye_socket(name, seed, n=512):
    """Skin around a giant eye: puffy lids, creases and lashes, with an almond-shaped opening."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    almond = (x / 0.62) ** 2 + (y / (0.30 * np.clip(1 - x * x / 0.42, 0.05, 1))) ** 2
    hole = almond < 1
    lid = np.exp(-((np.sqrt(almond) - 1.15) / 0.22) ** 2)
    crease = np.exp(-((np.sqrt((x / 0.72) ** 2 + ((y + 0.06) / 0.5) ** 2) - 1) / 0.03) ** 2) * (y < 0)
    r = np.sqrt(x * x + y * y)
    h = 22 * lid - 6 * crease + 1.5 * spectral(n, rng, 2.8, fmax=30 / n)
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.72, 0.38, 0.40]), np.clip(lid * 1.2, 0, 1))
    albedo = mix(albedo, np.array([0.40, 0.18, 0.22]), crease * 0.6)
    img = Image.new("L", (n * 2, n * 2), 0)
    draw = ImageDraw.Draw(img)
    for i in range(46):                                                 # lashes along the upper lid
        t = -0.95 + 1.9 * i / 45
        bx = t * 0.62
        by = -0.30 * np.sqrt(max(1 - bx * bx / 0.42, 0.05)) * np.sqrt(max(1 - t * t, 0))
        ang = -np.pi / 2 + t * 0.9 + rng.normal(0, 0.08)
        ln = 0.10 + 0.06 * (1 - abs(t)) + rng.normal(0, 0.01)
        p0 = ((bx + 1) * n, (by + 1) * n)
        p1 = ((bx + np.cos(ang) * ln * 0.6 + 1) * n, (by + np.sin(ang) * ln + 1) * n)
        p2 = ((bx + np.cos(ang) * ln * 0.9 + 1 + 0.03 * np.sign(t)) * n, (by + np.sin(ang) * ln * 1.25 + 1) * n)
        draw.line([p0, p1, p2], fill=255, width=4, joint="curve")
    lashes = np.asarray(img.resize((n, n), Image.LANCZOS), float) / 255
    albedo = mix(albedo, np.array([0.06, 0.04, 0.04]), lashes)
    color = shade(h, albedo, 0.35 + 0.5 * lid + 0.6 * lashes, bump=0.7, shine=50, ao=0.3)
    alpha = np.clip((0.98 - r) * 5, 0, 1)
    alpha = np.where(hole, 0, alpha)
    alpha = np.maximum(alpha, lashes)
    return save(tone(color), name, alpha)


def eye_ball(name, seed, n=256):
    """The white of a giant eye: a wet bulging dome threaded with red veins."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y)
    dome = np.clip(1 - r ** 2, 0, 1) ** 0.5
    veins = lines(spectral(n, rng, 2.6, fmax=12 / n), 0.06) * np.clip((r - 0.35) * 3, 0, 1)
    albedo = mix(np.broadcast_to(np.array([0.95, 0.88, 0.82]), (n, n, 3)), np.array([0.85, 0.20, 0.18]), veins * 0.85)
    albedo = mix(albedo, np.array([0.80, 0.52, 0.50]), np.clip((r - 0.7) * 3, 0, 1))
    color = shade(30 * dome + 1.5 * veins, albedo, 1.6, bump=0.6, shine=160, ao=0.0, sss=0.6)
    return save(tone(color), name, np.clip((1 - r) * 10, 0, 1))


def eye_iris(name, seed, n=160):
    """Iris and pupil, which look about; the highlight on them stays put toward the light."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y)
    ang = np.arctan2(y, x)
    fibers = 0.5 + 0.5 * np.cos(ang * 60 + 4 * spectral(n, rng, 2.4, fmax=8 / n))
    albedo = mix(np.broadcast_to(np.array([0.36, 0.48, 0.20]), (n, n, 3)), np.array([0.62, 0.46, 0.14]), np.clip((0.55 - r) * 3, 0, 1))
    albedo = albedo * (0.7 + 0.4 * fibers)[..., None]
    albedo = mix(albedo, np.array([0.10, 0.14, 0.06]), np.clip((r - 0.85) * 8, 0, 1))
    albedo = mix(albedo, np.array([0.02, 0.01, 0.01]), np.clip((0.36 - r) * 30, 0, 1))
    color = shade(4 * np.clip(1 - r, 0, 1), albedo, 0.4, bump=0.6, shine=60, ao=0.0, sss=0)
    glint = np.exp(-(((x + 0.32) / 0.12) ** 2 + ((y + 0.34) / 0.12) ** 2))
    color = color * (1 - glint)[..., None] + glint[..., None] * 1.2
    return save(tone(color), name, np.clip((1 - r) * 12, 0, 1))


def eye_lid(name, seed, n=256):
    """The upper lid that comes down over the eye when it blinks (scaled from its top edge)."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    y01 = (y + 1) / 2                                                   # 0 at the top, 1 at the edge
    shape = (np.abs(x) < 0.98 * np.sqrt(np.clip(1 - (y01 * 0.2) ** 2, 0, 1)))
    edge = np.exp(-((y01 - 0.94) / 0.05) ** 2)
    h = 10 * np.sqrt(np.clip(1 - x * x, 0, 1)) + 6 * edge + 1.2 * spectral(n, rng, 2.8, fmax=24 / n)
    albedo = mix(np.broadcast_to(np.array([0.76, 0.48, 0.46]), (n, n, 3)), np.array([0.56, 0.24, 0.26]), edge)
    color = shade(h, albedo, 0.5, bump=0.8, shine=40, ao=0.2)
    alpha = shape * np.clip((1 - np.abs(x)) * 12, 0, 1)
    return save(tone(color), name, alpha)


def vein(name, seed, w=192, h=48):
    """A raised vein running left to right, a dull plum under the skin, fading at the ends so pieces overlap into a path."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = xx / w
    wander = 0.12 * np.sin(u * np.pi * 2 + rng.uniform(0, 6)) * h
    d = np.abs(yy - h / 2 - wander) / (h * 0.16)
    tube = np.clip(1 - d ** 2, 0, 1) ** 0.5
    ends = np.clip(u * 6, 0, 1) * np.clip((1 - u) * 6, 0, 1)
    height = 8 * tube
    albedo = mix(np.broadcast_to(np.array([0.50, 0.34, 0.40]), (h, w, 3)), np.array([0.34, 0.22, 0.30]), np.clip(1 - tube, 0, 1))
    color = shade(height, albedo, 0.9 * tube, bump=1.0, shine=60, ao=0.0, sss=0.6)
    alpha = np.clip(tube * 3, 0, 1) * ends * 0.85
    return save(tone(color), name, alpha)


def plinth(name, seed, w=192, h=160):
    """A pedestal of old, polished bone for the statue in the middle of the world."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    cx, rx = w / 2, w * 0.40
    top, bottom, ry = h * 0.24, h * 0.80, w * 0.40 * 0.32
    u = (xx - cx) / rx
    body = (np.abs(u) <= 1) & (yy >= top) & (yy <= bottom + ry * np.sqrt(np.clip(1 - u * u, 0, 1)))
    cap = u ** 2 + ((yy - top) / ry) ** 2 <= 1
    shape = (body | cap).astype(float)
    bone = np.array([0.86, 0.80, 0.66])
    grain = 1 - 0.12 * np.clip(gaussian_filter(rng.standard_normal((h, w)), 3) * 4, -1, 1)
    lit = (0.25 + 0.65 * (np.clip(1 - u, 0, 2) / 2) ** 0.8)[..., None] * bone * grain[..., None]
    lit[cap] = (bone * 1.05 * grain[..., None])[cap]
    rim = cap & ~(u ** 2 + ((yy - top) / ry) ** 2 <= 0.8)
    lit[rim] = lit[rim] * 0.85
    shadow = gaussian_filter(np.roll(np.roll(shape, 8, 0), 14, 1) * (yy > h * 0.6), 5) * 0.5 * (1 - shape)
    rgb, a = composite(np.clip(lit, 0, 1), shape, shadow)
    return save(rgb, name, a)


def life():
    mite("mite-0", 71, 0)
    mite("mite-1", 71, 1)
    flea("flea", 72)
    worm("worm-body", 73)
    worm("worm-head", 73, head=True)
    smear("smear", 74)
    for i, seed in enumerate([75, 76, 77]):
        freckle(f"freckle-{i}", seed)
    wart("wart-0", 78)
    wart("wart-1", 79)
    navel("navel", 81)
    eye_socket("eye-socket", 82)
    eye_ball("eye-ball", 83)
    eye_iris("eye-iris", 84)
    eye_lid("eye-lid", 85)
    vein("vein", 86)
    plinth("plinth", 87)


# ---------- gross world events: The Scab, The Gash, The Tick ----------

SCAB_PIECES = 10


def scab_bed(name, seed, n=384):
    """Under the big scab: raw, wet, pink new skin, beaded with blood."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.1) ** 2) / 0.78
    edge = 1 + 0.08 * spectral(n, rng, 3.0, fmax=5 / n)
    body = np.clip((1 - r * edge) * 5, 0, 1)
    f1, _, _, _ = cells(n, rng, 70, periodic=False)
    beads = np.clip(1 - f1 / (n * 0.018), 0, 1) ** 1.5 * np.clip((0.85 - r) * 4, 0, 1)
    beads *= np.clip(spectral(n, rng, 2.0, fmax=8 / n) + 0.3, 0, 1)
    h = 4 * body + 1.5 * spectral(n, rng, 2.8, fmax=40 / n) * body + 5 * beads + 0.8 * fine_skin(n, n, rng, pore=5.0) * body
    albedo = mix(np.broadcast_to(np.array([0.86, 0.52, 0.44]), (n, n, 3)), np.array([0.70, 0.26, 0.20]), np.clip((r - 0.45) * 2, 0, 1))
    albedo = mix(albedo, np.array([0.55, 0.03, 0.05]), np.clip(beads * 1.5, 0, 1))
    color = shade(h, albedo, 0.9 + 0.9 * body + 1.2 * beads, bump=0.6, shine=110, ao=0.1, sss=1.0)
    alpha = np.clip((1.06 - r) * 4, 0, 1)
    return save(tone(color), name, alpha)


def scab_pieces(prefix, seed, count=SCAB_PIECES, n=384):
    """A big crusty scab in `count` wedges that peel off one by one; laid over each other they make the whole."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.1) ** 2) / 0.72
    edge = 1 + 0.1 * spectral(n, rng, 3.0, fmax=6 / n)
    body = np.clip((1 - r * edge) * 7, 0, 1)
    f1, f2, _, _ = cells(n, rng, 70, periodic=False)
    cracks = np.exp(-(((f2 - f1) / 3.0) ** 2)) * body
    lip = np.clip((r * edge - 0.72) * 5, 0, 1) * body                  # the edge lifts and curls, paler
    h = 10 * body + 2.5 * spectral(n, rng, 2.6, fmax=24 / n) * body - 3 * cracks + 5 * lip
    albedo = mix(np.broadcast_to(np.array([0.30, 0.09, 0.06]), (n, n, 3)), np.array([0.52, 0.22, 0.12]), np.clip(0.5 + 0.45 * spectral(n, rng, 2.4, fmax=14 / n), 0, 1))
    albedo = mix(albedo, np.array([0.72, 0.55, 0.32]), lip * 0.7)
    albedo = mix(albedo, np.array([0.18, 0.06, 0.03]), cracks * 0.55)
    color = tone(shade(h, albedo, 0.12 + 0.12 * body + 0.2 * lip, bump=1.0, shine=30, ao=0.35))
    ang = (np.arctan2(y, x) + 0.35 * r + 0.12 * spectral(n, rng, 3.0, fmax=5 / n)) % (2 * np.pi)
    bounds = np.sort((2 * np.pi * (np.arange(count) + rng.uniform(-0.25, 0.25, count)) / count) % (2 * np.pi))
    r_px = np.sqrt(x * x + y * y) * n / 2
    for k in range(count):
        lo, hi = bounds[k], bounds[(k + 1) % count]
        span = (hi - lo) % (2 * np.pi)
        into = (ang - lo) % (2 * np.pi)
        inside = into < span
        # A hairline gap between pieces (none at the very middle, where they all meet).
        seam = np.minimum(into, span - into) * np.maximum(r_px, 8)
        alpha = body * inside * np.clip(seam / 1.6, 0, 1)
        save(color, f"{prefix}-{k}", alpha)


def gash(name, seed, w=640, h=160):
    """A long open wound: swollen pink lips around a deep, wet red split, tapering to points."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = xx / w
    v = (yy - h / 2) / (h / 2)
    taper = np.sin(np.pi * np.clip(u, 0, 1)) ** 0.6
    wander = 0.1 * np.sin(u * np.pi * 2.3 + rng.uniform(0, 6)) + 0.04 * np.sin(u * np.pi * 7 + rng.uniform(0, 6))
    d = (v - wander) / (0.5 * taper + 0.02)
    noise = np.asarray(Image.fromarray((rng.random((h // 8, w // 8)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), float) / 255 - 0.5
    split = np.exp(-((d / 0.42) ** 2)) * taper
    lips = np.exp(-(((np.abs(d) - 0.75) / 0.32) ** 2)) * taper
    fibrin = np.clip(noise * 3, 0, 1) * split
    height = 16 * lips - 24 * split + 4 * noise * lips
    height += 2.0 * fine_skin(h, w, rng, pore=5.0) * np.clip(1 - split * 2, 0, 1)
    albedo = mix(np.broadcast_to(SKIN, (h, w, 3)), np.array([0.82, 0.44, 0.34]), np.clip(lips * 1.4, 0, 1))
    albedo = mix(albedo, np.array([0.48, 0.03, 0.05]), np.clip(split * 1.6, 0, 1))
    albedo = mix(albedo, np.array([0.18, 0.0, 0.02]), np.clip((split - 0.7) * 3, 0, 1))
    albedo = mix(albedo, np.array([0.86, 0.72, 0.36]), fibrin * 0.8)
    color = shade(height, albedo, 0.5 + 1.6 * split + 0.6 * lips, bump=0.7, shine=120, ao=0.15, sss=0.8)
    alpha = np.clip((1.45 - np.abs(d)) * 3, 0, 1) * np.clip(taper * 5, 0, 1)
    return save(tone(color), name, alpha)


def crust(name, seed, tint, dark, n=64):
    """A crumb of dried crust: faceted, cracked, glinting a little."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y) / 0.62
    edge = 1 + 0.22 * spectral(n, rng, 2.4, fmax=5 / n)
    body = np.clip((1 - r * edge) * 6, 0, 1)
    f1, f2, _, _ = cells(n, rng, 9, periodic=False)
    facets = (f2 - f1) / n
    h = 9 * body + 30 * facets * body
    albedo = mix(np.broadcast_to(np.array(tint), (n, n, 3)), np.array(dark), np.clip(0.5 + 0.5 * spectral(n, rng, 2.2, fmax=10 / n), 0, 1))
    color = shade(h, albedo, 0.5 + 0.5 * body, bump=1.2, shine=90, ao=0.2)
    shadow = shadow_of(body, 2, 3, 2, 0.45) * (1 - body)
    rgb, a = composite(tone(color), body, shadow)
    return save(rgb, name, a)


def tick(name, seed, n=256):
    """A tick from above, head down in the skin: a swollen, taut dusky-grey sack on eight short legs."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    bx, by = x / 0.46, (y - 0.12) / 0.56
    rb = np.sqrt(bx * bx + by * by)
    dome = np.clip(1 - rb ** 2, 0, 1) ** 0.55
    wrinkles = np.exp(-((np.sin(bx * 9 + 0.6 * spectral(n, rng, 3.0, fmax=6 / n)) / 0.25) ** 2)) * np.clip((rb - 0.3) * 2, 0, 1) * dome
    scutum = np.clip(1 - np.sqrt((x / 0.26) ** 2 + ((y + 0.32) / 0.2) ** 2), 0, 1) ** 0.5
    head = np.clip(1 - np.sqrt((x / 0.1) ** 2 + ((y + 0.55) / 0.1) ** 2), 0, 1) ** 0.6
    legs = legs_mask(n, 3, 4, 0.07 * n, 0.5, 0.26 * n, 7, 0, rng, cy=(1 - 0.30) * n * 3 / 2)
    legs *= 1 - np.clip(dome * 3, 0, 1)
    h = 40 * dome + 6 * scutum + 6 * head + 4 * legs - 2 * wrinkles
    albedo = mix(np.broadcast_to(np.array([0.58, 0.50, 0.45]), (n, n, 3)), np.array([0.38, 0.31, 0.29]), np.clip(rb, 0, 1))
    albedo = mix(albedo, np.array([0.30, 0.24, 0.22]), wrinkles * 0.6)
    albedo = mix(albedo, np.array([0.30, 0.16, 0.10]), np.clip(scutum * 2, 0, 1))
    albedo = mix(albedo, np.array([0.22, 0.10, 0.08]), np.clip(head * 2, 0, 1))
    albedo = np.where((legs > 0.02)[..., None] & (dome < 0.05)[..., None], np.array([0.32, 0.14, 0.10]), albedo)
    color = shade(h, albedo, 0.3 + 1.4 * dome, bump=0.8, shine=120, ao=0.2)
    alpha = np.maximum(np.clip(dome * 8, 0, 1), np.maximum(np.clip(scutum * 6, 0, 1), np.maximum(np.clip(head * 6, 0, 1), legs)))
    shadow = shadow_of(alpha, 6, 9, 6, 0.5) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def gross():
    scab_bed("scab-bed", 91)
    scab_pieces("scab", 92)
    gash("gash", 93)
    crust("crust-0", 94, [0.88, 0.72, 0.34], [0.58, 0.36, 0.14])
    crust("crust-1", 95, [0.82, 0.62, 0.28], [0.50, 0.28, 0.12])
    crust("crust-2", 96, [0.90, 0.80, 0.46], [0.62, 0.44, 0.20])
    crust("crust-deep", 97, [0.52, 0.16, 0.10], [0.28, 0.05, 0.04])
    tick("tick", 98)


# ---------- more world events: Ingrown Hair, Blackheads, Navel Lint ----------

def ingrown(name, seed, n=192):
    """An ingrown hair: a swollen red bump, a dark hair coiled under its stretched skin, a tip just poking out."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + (y * 1.1) ** 2) / 0.62
    dome = np.clip(1 - r ** 2, 0, 1) ** 0.7
    # The coil: a hair's path spiralling under the skin, seen through it.
    img = Image.new("L", (n * 4, n * 4), 0)
    draw = ImageDraw.Draw(img)
    pts = []
    for i in range(160):
        t = i / 159
        ang = t * np.pi * 4.2 + rng.uniform(-0.05, 0.05)
        rad = 0.08 + 0.32 * t
        pts.append(((1 + np.cos(ang) * rad) * n * 2, (1 + np.sin(ang) * rad * 0.9) * n * 2))
    draw.line(pts, fill=255, width=10, joint="curve")
    coil = gaussian_filter(np.asarray(img.resize((n, n), Image.LANCZOS), float) / 255, 1.2) * np.clip(dome * 2, 0, 1)
    tip = np.clip(1 - np.hypot(x - 0.36, y + 0.12) / 0.05, 0, 1)
    h = 26 * dome + 2 * coil + 4 * tip + 0.8 * fine_skin(n, n, rng, pore=4.5)
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.78, 0.34, 0.26]), np.clip(dome * 1.4, 0, 1))
    albedo = mix(albedo, np.array([0.95, 0.85, 0.62]), np.clip((dome - 0.75) * 3, 0, 1) * 0.6)   # a pale tight top
    albedo = mix(albedo, np.array([0.16, 0.09, 0.08]), np.clip(coil * 0.75 + tip, 0, 1))
    color = shade(h, albedo, 0.4 + 1.2 * dome, bump=0.8, shine=110, ao=0.05, sss=0.8)
    alpha = np.clip((1.35 - r) * 3, 0, 1)
    shadow = shadow_of(np.clip(dome * 2, 0, 1), 5, 7, 5, 0.4) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def blackhead(name, seed, n=64, emptied=False):
    """A blackhead: a little raised pore on oily skin, plugged dark (or, emptied, a sore pink pit)."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    r = np.sqrt(x * x + y * y) / 0.55
    dome = np.clip(1 - r ** 2, 0, 1) ** 0.8
    plug = np.clip(1 - np.sqrt(x * x + y * y) / 0.2, 0, 1) ** 0.5
    h = 7 * dome - (6 if emptied else -2) * plug + 0.6 * spectral(n, rng, 2.5, fmax=12 / n) * dome
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.80, 0.42, 0.38] if emptied else [0.74, 0.50, 0.42]), np.clip(dome * 1.2, 0, 1))
    albedo = mix(albedo, np.array([0.55, 0.12, 0.14] if emptied else [0.10, 0.08, 0.06]), np.clip(plug * 1.5, 0, 1))
    color = shade(h, albedo, 0.8 + 1.0 * dome, bump=1.0, shine=120, ao=0.1)   # oily
    alpha = np.clip((1.2 - r) * 3, 0, 1)
    return save(tone(color), name, alpha)


def gunk(name, w=128, h=48):
    """What comes out of a blackhead: a curled worm of waxy yellow-white gunk with a dark tip."""
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = xx / w
    path = h / 2 + 0.22 * h * np.sin(u * np.pi * 1.6 + 0.4)
    thick = 0.22 * h * (0.55 + 0.45 * np.sin(np.pi * np.clip(u * 0.9 + 0.1, 0, 1)))
    d = np.abs(yy - path) / thick
    tube = np.clip(1 - d ** 2, 0, 1) ** 0.5 * np.clip(u * 12, 0, 1) * np.clip((1 - u) * 14, 0, 1)
    height = 8 * tube
    albedo = mix(np.broadcast_to(np.array([0.95, 0.88, 0.66]), (h, w, 3)), np.array([0.82, 0.72, 0.46]), np.clip(0.5 + 0.5 * np.sin(u * 30), 0, 1) * 0.3)
    albedo = mix(albedo, np.array([0.12, 0.09, 0.06]), np.clip((u - 0.86) * 9, 0, 1))
    color = shade(height, albedo, 0.9 * tube, bump=1.0, shine=80, ao=0.0, sss=0.6)
    alpha = np.clip(tube * 4, 0, 1)
    return save(tone(color), name, alpha)


def lint(name, seed, n=64, tint=(0.58, 0.62, 0.74)):
    """A ball of navel lint: grey-blue fluff, fibres sticking out every which way."""
    rng = np.random.default_rng(seed)
    x, y = field(n)
    img = Image.new("L", (n * 4, n * 4), 0)
    draw = ImageDraw.Draw(img)
    for _ in range(140):
        a = rng.uniform(0, 2 * np.pi)
        r0 = rng.uniform(0, 0.4)
        r1 = r0 + rng.uniform(0.15, 0.55)
        bend = rng.normal(0, 0.5)
        p0 = ((1 + np.cos(a) * r0) * n * 2, (1 + np.sin(a) * r0) * n * 2)
        p1 = ((1 + np.cos(a + bend) * min(r1, 0.92)) * n * 2, (1 + np.sin(a + bend) * min(r1, 0.92)) * n * 2)
        draw.line([p0, p1], fill=255, width=3)
    fibres = np.asarray(img.resize((n, n), Image.LANCZOS), float) / 255
    r = np.sqrt(x * x + y * y)
    core = np.clip(1 - r / 0.45, 0, 1) ** 0.7
    body = np.clip(core * 1.4 + fibres * 0.9, 0, 1)
    h = 6 * core + 2 * fibres
    albedo = mix(np.broadcast_to(np.array(tint), (n, n, 3)), np.array([0.85, 0.85, 0.88]), np.clip(fibres * 0.6, 0, 1))
    color = shade(h, albedo, 0.2, bump=0.8, shine=20, ao=0.3)
    shadow = shadow_of(core, 2, 3, 2, 0.35) * (1 - body)
    rgb, a = composite(tone(color), body, shadow)
    return save(rgb, name, a)


def gross_more():
    ingrown("ingrown", 101)
    blackhead("blackhead", 102)
    blackhead("pore", 102, emptied=True)
    gunk("gunk")
    lint("lint", 104)


def main():
    if sys.argv[1:] == ["ground"]:
        return ground()
    if sys.argv[1:] == ["events"]:
        return events()
    if sys.argv[1:] == ["life"]:
        return life()
    if sys.argv[1:] == ["gross"]:
        return gross(), gross_more()
    ground()
    macro()
    for i, seed in enumerate([101, 102, 103]):
        plot_bed(f"plot-{i}", seed)
    pimple("pimple-0", 1)
    pimple("pimple-1", 2, size=0.8)
    pimple("pimple-2", 3, head=np.array([0.95, 0.90, 0.72]))
    pimple("pustule", 4, size=1.0, head=np.array([0.92, 0.82, 0.38]))
    mole("mole-0", 5)
    mole("mole-1", 6)
    for i, seed in enumerate([21, 22, 23, 24]):
        hair(f"hair-{i}", seed, curl=0.06 + 0.04 * i, width=6)
    puddle("slime-0", 31, [0.76, 0.74, 0.54])
    puddle("slime-1", 32, [0.76, 0.74, 0.54])
    puddle("pus-0", 33, [0.88, 0.76, 0.26])
    candle("candle", 41)
    flame("flame")
    glow("glow")
    glow("spore", n=32, falloff=1.6)
    events()
    life()
    gross()
    gross_more()


def events():
    boil("boil", 51)
    scab("scab", 52)
    droplet("drop-pus", [0.92, 0.80, 0.34])
    droplet("drop-blood", [0.62, 0.06, 0.08])
    seed_icon("seed-pimple", 61, [0.80, 0.30, 0.28])
    seed_icon("seed-pus", 62, [0.82, 0.58, 0.30], head=np.array([0.96, 0.88, 0.50]))
    seed_icon("seed-bone", 63, [0.86, 0.80, 0.66], rough=0.6)
    seed_icon("seed-boil", 64, [0.70, 0.12, 0.14], head=np.array([0.98, 0.90, 0.60]))


if __name__ == "__main__":
    main()

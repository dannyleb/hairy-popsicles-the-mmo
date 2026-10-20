"""Usage: python tools/world.py [preview-dir]
Generates the world art into packages/client/public/world/. Deterministic (fixed seeds).
Everything is a height map + color + gloss, shaded with one warm key light from the
upper left, like the character renders, so ground, plots and props read as one scene.
"""

import sys
from pathlib import Path

import numpy as np
from numpy.fft import fft2, fftfreq, ifft2
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

OUT = Path(__file__).resolve().parent.parent / "packages/client/public/world"
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
    spec = gloss * (0.9 * ndh ** shine + 0.12 * ndh ** 6)

    color = albedo * (AMBIENT * cavity[..., None] + KEY * (diffuse * cavity)[..., None])
    color += sss * SSS * albedo * ((1 - diffuse) * cavity)[..., None] * 0.35
    color += (spec * cavity)[..., None] * np.array([1.0, 0.92, 0.84])
    return color


def tone(color, exposure=1.0):
    """Soft filmic shoulder so wet highlights roll off instead of clipping."""
    c = np.clip(color * exposure, 0, None)
    c = c / (1 + 0.35 * c)
    return np.clip(c ** (1 / 1.1), 0, 1)


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
BRUISE = np.array([0.50, 0.38, 0.44])
VEIN = np.array([0.40, 0.40, 0.56])


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
    h = -1.2 * np.clip(skin_lines, 0, 1.4)

    # Pores sit where the lines cross, plus a scatter of loose ones.
    crossings = gaussian_filter(np.clip(skin_lines - 1.0, 0, 1), 0.8, mode="wrap")
    p1, _, _, _ = cells(n, rng, 900)
    pores = np.clip(crossings * 1.5 + np.exp(-((p1 / 1.6) ** 2)), 0, 1)
    h -= 2.5 * pores

    # Folds: long soft creases running mostly one way, fading in and out.
    folds = stripes(n, rng, 3, 5, 0.06, 1.4) * patchy(0.5) + stripes(n, rng, -4, 3, 0.05, 1.6) * patchy(0.25)
    wrinkles = stripes(n, rng, 13, 9, 0.10, 1.5, wiggle=0.03) * patchy(0.3)
    h -= 14.0 * gaussian_filter(folds, 3.0, mode="wrap") + 3.5 * gaussian_filter(wrinkles, 1.5, mode="wrap")

    # Lumps: soft fleshy swellings that catch wet highlights.
    l1, l2, _, _ = cells(n, rng, 70)
    lumps = np.clip(1 - l1 / (0.55 * l2 + 1e-6), 0, 1)
    h += 40.0 * gaussian_filter(lumps ** 1.5, 10, mode="wrap")
    h += 12.0 * spectral(n, rng, 3.0, fmax=0.02)

    vein_tint = np.clip(spectral(n, rng, 2.6, fmax=0.03) - 0.8, 0, 1)

    albedo = np.broadcast_to(SKIN, (n, n, 3)).copy()
    albedo = mix(albedo, FLUSH, 0.45 + 0.4 * spectral(n, rng, 3.4, fmax=0.015))
    albedo = mix(albedo, JAUNDICE, 0.3 * spectral(n, rng, 3.4, fmax=0.012))
    albedo = mix(albedo, BRUISE, np.clip(spectral(n, rng, 3.6, fmax=0.01) - 1.4, 0, 1) * 0.5)
    albedo = mix(albedo, VEIN, 0.35 * vein_tint)
    albedo = mix(albedo, FLUSH * 0.55, 0.6 * gaussian_filter(folds, 3, mode="wrap"))
    albedo *= (1 - 0.5 * pores)[..., None]
    albedo *= (1 + 0.05 * spectral(n, rng, 1.0))[..., None]

    wet = np.clip(0.5 + 0.3 * spectral(n, rng, 3, fmax=0.02), 0.1, 1)
    color = shade(h, albedo, wet, bump=1.0, shine=45, ao=0.04, periodic=True)
    return save(tone(color, 0.82), "ground")


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


def shadow_of(alpha, n, dx, dy, blur, strength):
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
    h = 7 * dome
    albedo = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.78, 0.25, 0.22]), np.clip(1.6 * dome, 0, 1) * 0.85)
    gloss = 0.5 + 0.4 * dome
    if head is not None:
        cap = np.exp(-((r / 0.33) ** 2) * 3)
        h += 3 * cap
        albedo = mix(albedo, head, np.clip(cap * 1.4, 0, 1))
        gloss = gloss + 0.4 * cap
    color = shade(h, albedo, gloss, bump=1.0, shine=90, ao=0.0)
    alpha = np.clip((1.15 - r) * 2.2, 0, 1)                             # fades into the ground
    shadow = shadow_of(np.clip(dome * 1.5, 0, 1), n, 3, 4, 2.5, 0.25) * (1 - alpha)
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
    shadow = shadow_of(np.maximum(body, hair), n, 2, 3, 1.5, 0.35) * (1 - alpha)
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
    albedo = np.broadcast_to(np.array([0.16, 0.11, 0.09]), (n, n, 3))
    color = shade(h, albedo, 1.6, bump=1.8, shine=30, ao=0.0, sss=0)
    root = np.zeros((n, n))
    root[int(pts[0][1] / s), int(pts[0][0] / s)] = 1
    follicle = gaussian_filter(root, 2.5) * 60
    alpha = np.clip(mask + follicle, 0, 1)
    shadow = shadow_of(mask, n, 3, 4, 2.0, 0.45) * (1 - alpha)
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
    meat = mix(np.broadcast_to(np.array([0.30, 0.03, 0.05]), (n, n, 3)), np.array([0.70, 0.18, 0.19]), np.clip(d ** 2 * 1.2 + 0.25 * blotch, 0, 1))
    slough = np.clip(gaussian_filter(rng.standard_normal((n, n)), 7) * 7 - 0.9, 0, 1)
    meat = mix(meat, np.array([0.84, 0.66, 0.36]), slough * 0.8)       # yellowish slough
    skin = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.82, 0.38, 0.36]), np.clip(1.5 - (d - 1) * 8, 0, 1))
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
    h += 3.0 * veins
    albedo = mix(np.broadcast_to(np.array([0.52, 0.08, 0.10]), (n, n, 3)), np.array([0.86, 0.30, 0.28]), np.clip(dome * 1.3, 0, 1))
    albedo = mix(albedo, np.array([0.42, 0.18, 0.40]), veins * 0.8)
    albedo = mix(albedo, np.array([0.96, 0.86, 0.50]), np.clip(head * 1.6, 0, 1))
    albedo = mix(albedo, np.array([1.0, 0.97, 0.86]), np.clip((head - 0.75) * 4, 0, 1))
    halo = np.clip(1.5 - r, 0, 1) * (1 - np.clip(dome * 3, 0, 1))
    skin = mix(np.broadcast_to(SKIN, (n, n, 3)), np.array([0.80, 0.22, 0.22]), np.clip(halo * 1.4, 0, 1))
    albedo = np.where((dome > 0)[..., None], albedo, skin)
    gloss = 0.4 + 1.6 * dome + 0.8 * head
    color = shade(h, albedo, gloss, bump=0.9, shine=140, ao=0.05)
    alpha = np.clip((1.45 - r) * 3, 0, 1)
    shadow = shadow_of(np.clip(dome * 2, 0, 1), n, 10, 14, 10, 0.5) * (1 - alpha)
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
    shadow = shadow_of(body, n, 2, 3, 2, 0.4) * (1 - body)
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
    shadow = shadow_of(alpha, n, 4, 6, 4, 0.55) * (1 - alpha)
    rgb, a = composite(tone(color), alpha, shadow)
    return save(rgb, name, a)


def main():
    if sys.argv[1:] == ["ground"]:
        return ground()
    if sys.argv[1:] == ["events"]:
        return events()
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
    puddle("slime-0", 31, [0.45, 0.80, 0.88])
    puddle("slime-1", 32, [0.45, 0.80, 0.88])
    puddle("pus-0", 33, [0.88, 0.76, 0.26])
    candle("candle", 41)
    flame("flame")
    glow("glow")
    glow("spore", n=32, falloff=1.6)
    events()


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

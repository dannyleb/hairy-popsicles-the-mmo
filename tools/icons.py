"""App icons (favicon, home screen, PWA) from a character render.

    python tools/icons.py [slug]      # default: snoot
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent / "packages/client/public"
SIZES = {"icon-512.png": 512, "icon-192.png": 192, "apple-touch-icon.png": 180, "favicon.png": 48}


def icon(character, size):
    s = size * 4
    base = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    # A dark, warm vignette like the game's backdrop, on a rounded square.
    glow = Image.new("RGBA", (s, s), (14, 6, 8, 255))
    halo = Image.new("L", (s, s), 0)
    ImageDraw.Draw(halo).ellipse((s * 0.12, s * 0.08, s * 0.88, s * 0.84), fill=255)
    halo = halo.filter(ImageFilter.GaussianBlur(s * 0.12))
    glow.paste(Image.new("RGBA", (s, s), (150, 60, 40, 255)), (0, 0), halo.point(lambda v: int(v * 0.45)))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=255)
    base.paste(glow, (0, 0), mask)
    art = character.resize((int(s * 0.94), int(s * 0.94)), Image.LANCZOS)
    base.alpha_composite(art, ((s - art.width) // 2, s - art.height))
    clipped = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    clipped.paste(base, (0, 0), mask)
    return clipped.resize((size, size), Image.LANCZOS)


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else "snoot"
    character = Image.open(ROOT / "characters" / f"{slug}.webp").convert("RGBA")
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    for name, size in SIZES.items():
        icon(character, size).save(out / name, optimize=True)
        print(name, (out / name).stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()

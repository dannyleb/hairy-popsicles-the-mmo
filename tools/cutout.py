"""Usage: python tools/cutout.py render.png slug [render2.png slug2 ...]
Writes packages/client/public/characters/<slug>.webp. Setup: pip install -r tools/requirements.txt
"""

import sys
from pathlib import Path

from PIL import Image
from rembg import new_session, remove

OUT = Path(__file__).resolve().parent.parent / "packages/client/public/characters"
SPRITE = 768
PAD = 8
# Matting leaves faint haze where the old background was (e.g. around
# translucent slime). Dropping near-zero alpha keeps the trim tight.
ALPHA_FLOOR = 12
QUALITY = 82
# Scenery the model kept, as (left, top, right, bottom) fractions of the
# trimmed character, erased before a second trim.
ERASE = {
    "toad": [(0.0, 0.0, 0.225, 1.0)],  # floor groove running off the tail tip
    "snoot-2": [(0.0, 0.0, 0.3, 1.0)],  # moon
    "snoot-3": [(0.0, 0.0, 0.2, 1.0)],  # moon
}


def trim(rgba: Image.Image, src: Path) -> Image.Image:
    box = rgba.getchannel("A").getbbox()
    if box is None:
        raise SystemExit(f"{src}: nothing left after background removal")
    left, top, right, bottom = box
    return rgba.crop((max(left - PAD, 0), max(top - PAD, 0), min(right + PAD, rgba.width), min(bottom + PAD, rgba.height)))


def cut(src: Path, slug: str, session) -> Path:
    im = Image.open(src).convert("RGB")
    rgba = remove(im, session=session)

    alpha = rgba.getchannel("A").point(lambda a: 0 if a < ALPHA_FLOOR else a)
    rgba.putalpha(alpha)
    rgba = trim(rgba, src)

    if slug in ERASE:
        w, h = rgba.size
        for l, t, r, b in ERASE[slug]:
            rgba.paste((0, 0, 0, 0), (round(l * w), round(t * h), round(r * w), round(b * h)))
        rgba = trim(rgba, src)

    scale = SPRITE / max(rgba.size)
    if scale < 1:
        rgba = rgba.resize((round(rgba.width * scale), round(rgba.height * scale)), Image.LANCZOS)

    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{slug}.webp"
    rgba.save(dest, "WEBP", quality=QUALITY, method=6)
    return dest


def main(argv: list[str]) -> None:
    if not argv or len(argv) % 2:
        raise SystemExit(__doc__)
    session = new_session("isnet-general-use")
    for src, slug in zip(argv[0::2], argv[1::2]):
        dest = cut(Path(src), slug, session)
        print(f"{slug}: {dest.stat().st_size // 1024} KB, {Image.open(dest).size}")


if __name__ == "__main__":
    main(sys.argv[1:])

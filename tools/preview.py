"""The link preview card (og.jpg): what shows when someone pastes the game's
link, or an invite link, into a chat. 1200x630, under 300 KB for WhatsApp.

    python tools/preview.py           # needs fonttools and brotli, for the web fonts
"""
from io import BytesIO
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent / "packages/client/public"
W, H = 1200, 630
# Left to right; the middle one stands tallest.
LINEUP = ["conehead", "redeye", "leprechaun", "screamer", "snoot", "bricks", "toad"]
HEIGHTS = [250, 285, 320, 370, 320, 285, 250]
FLESH, FLESH_DIM, INK, BLOOD = (233, 185, 160), (201, 143, 125), (14, 6, 8), (90, 31, 42)


def font(name, size):
    """A web font (woff2) as something Pillow can draw with."""
    ttf = TTFont(ROOT / "fonts" / name)
    ttf.flavor = None
    data = BytesIO()
    ttf.save(data)
    data.seek(0)
    return ImageFont.truetype(data, size)


def backdrop():
    """Dark skin, lit from just above the middle."""
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse((W * 0.12, -H * 0.2, W * 0.88, H * 1.1), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    return Image.composite(Image.new("RGB", (W, H), (70, 24, 30)), Image.new("RGB", (W, H), INK), glow)


def lineup(card):
    step = W / (len(LINEUP) + 0.4)
    for i in sorted(range(len(LINEUP)), key=lambda i: HEIGHTS[i]):  # tallest drawn last, in front
        sprite = Image.open(ROOT / "characters" / f"{LINEUP[i]}.webp").convert("RGBA")
        sprite.thumbnail((int(step * 1.6), HEIGHTS[i]), Image.LANCZOS)
        x = int(step * (i + 0.7) - sprite.width / 2)
        y = H - 18 - sprite.height
        shadow = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
        shadow.putalpha(sprite.getchannel("A").point(lambda a: a * 0.8))
        shadow = shadow.filter(ImageFilter.GaussianBlur(14))
        card.paste(shadow, (x, y + 12), shadow)
        card.paste(sprite, (x, y), sprite)


def title(card):
    draw = ImageDraw.Draw(card)
    big = font("rubik-wet-paint.woff2", 112)
    text = "Hairy Popsicles"
    width = draw.textlength(text, font=big)
    x = (W - width) / 2
    draw.text((x + 5, 32), text, font=big, fill=BLOOD)
    draw.text((x, 26), text, font=big, fill=FLESH)
    small = font("patrick-hand.woff2", 34)
    sub = "T H E   M M O"
    draw.text(((W - draw.textlength(sub, font=small)) / 2, 158), sub, font=small, fill=FLESH_DIM)


def main():
    card = backdrop()
    lineup(card)
    title(card)
    out = ROOT / "og.jpg"
    card.save(out, quality=84, optimize=True, progressive=True)
    print(f"{out.relative_to(ROOT.parent.parent.parent)}: {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

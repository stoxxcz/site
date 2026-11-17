#!/usr/bin/env python3
"""
GTA VI countdown edits: "N days away" over real footage of GTA N, no effects.

  day 2 -> GTA 2 promo film (Rockstar, 1999), digit "2" cut from the GTA2 logo
  day 1 -> GTA 1 PlayStation gameplay (1997), digit "1" cut from the
           GTA London 1969 cover ("Mission Pack #1")

Sources (Internet Archive):
  https://archive.org/details/gta2-promotional-movie-1999
  https://archive.org/details/grand-theft-auto-2-multiplatform-rockstar-games-1999-uk-tv-ad
  https://archive.org/details/grand-theft-auto-1-play-station-pal-gameplay-full-game-longplay-recorded-by-joe-
  https://archive.org/details/gran-theft-auto-london-1-front

Usage: python3 make_countdown.py --src DIR_WITH_DOWNLOADS
"""
import argparse
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1440, 1080
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"

DAYS = {
    2: dict(clip="gta2_promo.mp4", start=171.0, dur=15.0, label="days away",
            alpha="assets/digit2_alpha.png", fill=(214, 36, 46), stroke=None),
    1: dict(clip="gta1_intro.mp4", start=115.0, dur=15.0, label="day away",
            alpha="assets/digit1_alpha.png", fill=(255, 255, 255), stroke=(0, 118, 196)),
}

DIGIT_H = 168          # matches the reference: digit ~15.5% of frame height
DIGIT_TOP = 537
TEXT_X = 626
TEXT_BASELINE = 652
TEXT_SIZE = 100


def overlay_png(day, path):
    cfg = DAYS[day]
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # digit cut-out
    al = Image.open(os.path.join(HERE, cfg["alpha"])).convert("L")
    dw = round(al.width * DIGIT_H / al.height)
    al = al.resize((dw, DIGIT_H), Image.LANCZOS)
    dx = TEXT_X - 75 - dw
    dy = DIGIT_TOP
    if cfg["stroke"]:
        p = 16
        padded = Image.new("L", (al.width + 2 * p, al.height + 2 * p), 0)
        padded.paste(al, (p, p))
        al = padded.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(0.8))
        st = al.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(0.8))
        dx, dy = dx - p, dy - p
        img.paste(cfg["stroke"] + (255,), (dx, dy), st)
    img.paste(cfg["fill"] + (255,), (dx, dy), al)

    # label, white with dark outline + soft shadow like the reference
    font = ImageFont.truetype(FONT, TEXT_SIZE)
    asc, _ = font.getmetrics()
    ty = TEXT_BASELINE - asc
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((TEXT_X + 3, ty + 4), cfg["label"], font=font, fill=(0, 0, 0, 200),
                            stroke_width=3, stroke_fill=(0, 0, 0, 200))
    sh = sh.filter(ImageFilter.GaussianBlur(4))
    img = Image.alpha_composite(sh, img)
    ImageDraw.Draw(img).text((TEXT_X, ty), cfg["label"], font=font, fill=(255, 255, 255, 255),
                             stroke_width=2, stroke_fill=(20, 20, 20, 255))
    img.save(path)


def build(day, src_dir, out_dir):
    cfg = DAYS[day]
    ov = os.path.join(out_dir, f"_overlay_day{day}.png")
    overlay_png(day, ov)
    out = os.path.join(out_dir, f"gta6_countdown_day{day}.mp4")
    d = cfg["dur"]
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-ss", str(cfg["start"]), "-t", str(d), "-i", os.path.join(src_dir, cfg["clip"]),
        "-i", ov,
        "-filter_complex",
        f"[0:v]scale={W}:{H}:flags=lanczos,setsar=1[v];[v][1:v]overlay=0:0,format=yuv420p[out];"
        f"[0:a]afade=t=out:st={d - 0.4}:d=0.4[a]",
        "-map", "[out]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-r", "30",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
    ], check=True)
    os.remove(ov)
    print(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="folder with gta2_promo.mp4 and gta1_intro.mp4")
    ap.add_argument("--out", default=HERE)
    ap.add_argument("--day", type=int, choices=[1, 2], action="append")
    a = ap.parse_args()
    for day in a.day or [2, 1]:
        build(day, a.src, a.out)

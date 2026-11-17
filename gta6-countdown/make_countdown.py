#!/usr/bin/env python3
"""
GTA VI countdown shorts — "N days away" edits in the style of the trend.

Day 2  -> late-90s neon/rain top-down city (GTA 2 era mood)
Day 1  -> sodium-lit 1997 city, police chase + helicopter searchlight (GTA 1 era mood)

Everything (city, cars, rain, lighting, digits, sound) is generated procedurally.
Optionally you can put real footage underneath instead of the generated city:

    python3 make_countdown.py --day 2                       # generated city
    python3 make_countdown.py --day 2 --bg gta2_trailer.mp4 # your own clip as background

Output: 1080x1920, 30 fps, ~11 s, H.264 + AAC.
"""
import argparse
import math
import os
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
S = 4
LW, LH = W // S, H // S          # low-res "game" canvas 360x640
FPS = 30
DUR = 11.0
NF = int(DUR * FPS)
T_SLAM = 3.3
SR = 44100

FONT_DIR = "/usr/share/fonts/opentype/inter/"
FONT_TEXT = FONT_DIR + "InterDisplay-Bold.otf"
FONT_BLACK = FONT_DIR + "InterDisplay-Black.otf"
FONT_MONO = "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf"


def clamp01(x):
    return max(0.0, min(1.0, x))


def ease_out_cubic(x):
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def smoothstep(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------------------
# Themes
# --------------------------------------------------------------------------------------
THEMES = {
    2: dict(
        seed=1999, label="days away", osd_date="NOV.17 1999", osd_clock=(23, 41, 7),
        ambient=(0.24, 0.25, 0.42), lamp=(0.30, 0.52, 0.95), lamp_r=18,
        asphalt=(44, 46, 56), sidewalk=(76, 78, 90), dirt=(34, 34, 40), grass=(28, 54, 44),
        tree=(18, 44, 34), park_tree_hi=(40, 78, 60), line=(190, 190, 186), double_yellow=False,
        roofs=[(92, 98, 112), (70, 82, 98), (104, 92, 92), (56, 64, 80), (116, 114, 124),
               (80, 66, 84), (60, 88, 94), (98, 104, 96)],
        neon=[(40, 255, 250), (255, 40, 210), (255, 80, 150), (130, 90, 255), (255, 150, 40)],
        neon_prob=0.38, win=(255, 196, 140), win_lit=0.33, win_cool=(150, 210, 255),
        h_range=(0.10, 0.36), lamp_em=(190, 225, 255),
        hero_color=(250, 196, 24),
        car_colors=[(180, 30, 40), (30, 60, 150), (200, 200, 205), (40, 40, 44), (20, 120, 110),
                    (130, 40, 140), (210, 120, 30), (70, 90, 60), (160, 160, 170)],
        rain=True, lightning=True, heli=False, police=False, fog=None, wet=True,
        digit="gta2", grade="neon", end_card=None, date_txt="GTA VI  ·  19.11.2026",
    ),
    1: dict(
        seed=1997, label="day away", osd_date="NOV.18 1997", osd_clock=(2, 13, 44),
        ambient=(0.24, 0.19, 0.18), lamp=(1.0, 0.52, 0.18), lamp_r=19,
        asphalt=(52, 50, 50), sidewalk=(92, 86, 80), dirt=(48, 42, 36), grass=(46, 62, 34),
        tree=(32, 50, 26), park_tree_hi=(62, 84, 44), line=(220, 180, 40), double_yellow=True,
        roofs=[(110, 96, 84), (90, 84, 80), (124, 110, 96), (76, 70, 66), (132, 122, 112),
               (100, 76, 64), (84, 90, 84), (118, 102, 90)],
        neon=[(255, 50, 40), (255, 170, 40), (60, 200, 255)],
        neon_prob=0.08, win=(255, 176, 90), win_lit=0.22, win_cool=(255, 220, 160),
        h_range=(0.06, 0.28), lamp_em=(255, 170, 70),
        hero_color=(200, 24, 24),
        car_colors=[(120, 30, 30), (40, 50, 90), (170, 160, 140), (30, 30, 30), (60, 80, 60),
                    (140, 110, 60), (90, 90, 96), (150, 60, 30)],
        rain=False, lightning=False, heli=True, police=True, fog=(0.30, 0.19, 0.12), wet=False,
        digit="gta1", grade="sodium", end_card="TOMORROW", date_txt="GTA VI  ·  19.11.2026",
    ),
}


# --------------------------------------------------------------------------------------
# Sprites
# --------------------------------------------------------------------------------------
def gauss_sprite(r):
    n = int(r * 2.2) | 1
    c = n // 2
    y, x = np.mgrid[0:n, 0:n]
    d = np.sqrt((x - c) ** 2 + (y - c) ** 2) / r
    return np.exp(-d * d * 2.2).astype(np.float32)


def disk_sprite(r):
    n = int(r * 2.6) | 1
    c = n // 2
    y, x = np.mgrid[0:n, 0:n]
    d = np.sqrt((x - c) ** 2 + (y - c) ** 2) / r
    core = np.clip((1.0 - d) / 0.25, 0, 1)
    halo = np.exp(-d * d * 1.6) * 0.35
    return (core * 0.85 + halo).astype(np.float32)


def cone_down(L=46, wd=33):
    y, x = np.mgrid[0:L, 0:wd]
    x = x - wd // 2
    along = y.astype(np.float32)
    spread = 2.0 + along * 0.33
    v = (1 - along / L) ** 1.6 * np.exp(-(x / spread) ** 2)
    return v.astype(np.float32)


CONE_D = cone_down()
CONES = {
    ("v", 1): CONE_D,
    ("v", -1): np.flipud(CONE_D),
    ("h", 1): CONE_D.T.copy(),
    ("h", -1): np.fliplr(CONE_D.T).copy(),
}


def add_sprite_tl(arr, spr, x0, y0, color):
    sh, sw = spr.shape
    ax0, ay0 = max(0, x0), max(0, y0)
    ax1, ay1 = min(arr.shape[1], x0 + sw), min(arr.shape[0], y0 + sh)
    if ax1 <= ax0 or ay1 <= ay0:
        return
    arr[ay0:ay1, ax0:ax1] += spr[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0, None] * np.asarray(color, np.float32)


def add_sprite_c(arr, spr, cx, cy, color):
    add_sprite_tl(arr, spr, int(cx) - spr.shape[1] // 2, int(cy) - spr.shape[0] // 2, color)


def box_blur(a, r):
    """Separable box blur on HxWxC float array (edge-clamped)."""
    if r <= 0:
        return a
    k = 2 * r + 1
    p = np.pad(a, ((r + 1, r), (0, 0), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=0)
    a = (c[k:] - c[:-k]) / k
    p = np.pad(a, ((0, 0), (r + 1, r), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=1)
    return (c[:, k:] - c[:, :-k]) / k


# --------------------------------------------------------------------------------------
# City
# --------------------------------------------------------------------------------------
class City:
    RW = 24
    SW = 5

    def __init__(self, th, rng):
        self.th, self.rng = th, rng
        MW, MH = 1000, 2000
        self.MW, self.MH = MW, MH
        vx, x = [], 70
        while x < MW - 50:
            vx.append(int(x))
            x += int(rng.integers(140, 196))
        hy, y = [], 60
        while y < MH - 50:
            hy.append(int(y))
            y += int(rng.integers(126, 184))
        self.vx, self.hy = vx, hy
        self.hero_x = min(vx, key=lambda v: abs(v - MW / 2))

        R2, SW = self.RW // 2, self.SW
        img = Image.new("RGB", (MW, MH), th["dirt"])
        d = ImageDraw.Draw(img)
        road = Image.new("L", (MW, MH), 0)
        rd = ImageDraw.Draw(road)
        for x in vx:
            d.rectangle([x - R2 - SW, 0, x + R2 + SW - 1, MH], fill=th["sidewalk"])
        for y in hy:
            d.rectangle([0, y - R2 - SW, MW, y + R2 + SW - 1], fill=th["sidewalk"])
        for x in vx:
            d.rectangle([x - R2, 0, x + R2 - 1, MH], fill=th["asphalt"])
            rd.rectangle([x - R2, 0, x + R2 - 1, MH], fill=255)
        for y in hy:
            d.rectangle([0, y - R2, MW, y + R2 - 1], fill=th["asphalt"])
            rd.rectangle([0, y - R2, MW, y + R2 - 1], fill=255)
        # lane markings
        ln = th["line"]
        for x in vx:
            if th["double_yellow"]:
                d.line([(x - 1, 0), (x - 1, MH)], fill=ln)
                d.line([(x + 1, 0), (x + 1, MH)], fill=ln)
            else:
                for yy in range(0, MH, 12):
                    d.line([(x, yy), (x, yy + 5)], fill=ln)
        for y in hy:
            if th["double_yellow"]:
                d.line([(0, y - 1), (MW, y - 1)], fill=ln)
                d.line([(0, y + 1), (MW, y + 1)], fill=ln)
            else:
                for xx in range(0, MW, 12):
                    d.line([(xx, y), (xx + 5, y)], fill=ln)
        cw = (200, 200, 196)
        for x in vx:
            for y in hy:
                d.rectangle([x - R2, y - R2, x + R2 - 1, y + R2 - 1], fill=th["asphalt"])
                for xx in range(x - R2 + 2, x + R2 - 1, 3):
                    d.line([(xx, y - R2 - 7), (xx, y - R2 - 2)], fill=cw)
                    d.line([(xx, y + R2 + 1), (xx, y + R2 + 6)], fill=cw)
                for yy in range(y - R2 + 2, y + R2 - 1, 3):
                    d.line([(x - R2 - 7, yy), (x - R2 - 2, yy)], fill=cw)
                    d.line([(x + R2 + 1, yy), (x + R2 + 6, yy)], fill=cw)

        # blocks -> buildings / parks / parking
        self.buildings = []
        xs = [-R2 - SW - 10] + vx + [MW + R2 + SW + 10]
        ys = [-R2 - SW - 10] + hy + [MH + R2 + SW + 10]
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                bx0 = max(0, xs[i] + R2 + SW + 1)
                bx1 = min(MW - 1, xs[i + 1] - R2 - SW - 2)
                by0 = max(0, ys[j] + R2 + SW + 1)
                by1 = min(MH - 1, ys[j + 1] - R2 - SW - 2)
                if bx1 - bx0 < 8 or by1 - by0 < 8:
                    continue
                self._split(d, (bx0, by0, bx1, by1), 0)

        g = np.asarray(img).astype(np.float32)
        noise = rng.normal(0, 1, (MH, MW, 1)).astype(np.float32)
        g *= 1 + noise * 0.06
        self.ground = np.clip(g, 0, 255).astype(np.uint8)
        self.roadmask = (np.asarray(road) > 0).astype(np.float32)

        # street lamps -> static light map
        self.light = np.zeros((MH, MW, 3), np.float32)
        self.lamps = []
        spr = gauss_sprite(th["lamp_r"])
        for x in vx:
            off = int(rng.integers(0, 40))
            for yy in range(off, MH, 44):
                for lx in (x - R2 - 3, x + R2 + 2):
                    self.lamps.append((lx, yy + (0 if lx < x else 22)))
        for y in hy:
            off = int(rng.integers(0, 40))
            for xx in range(off, MW, 44):
                for ly in (y - R2 - 3, y + R2 + 2):
                    self.lamps.append((xx + (0 if ly < y else 22), ly))
        for lx, ly in self.lamps:
            add_sprite_c(self.light, spr, lx, ly, th["lamp"])
        self.lamps = np.array(self.lamps)

    def _split(self, d, r, depth):
        x0, y0, x1, y1 = r
        w, h = x1 - x0, y1 - y0
        rng = self.rng
        if depth < 4 and (w > 64 or h > 64 or (rng.random() < 0.5 and (w > 34 or h > 34))):
            gap = 2 if rng.random() < 0.7 else 4
            if w >= h:
                s = int(x0 + w * rng.uniform(0.35, 0.65))
                self._split(d, (x0, y0, s - gap // 2, y1), depth + 1)
                self._split(d, (s + gap - gap // 2, y0, x1, y1), depth + 1)
            else:
                s = int(y0 + h * rng.uniform(0.35, 0.65))
                self._split(d, (x0, y0, x1, s - gap // 2), depth + 1)
                self._split(d, (x0, s + gap - gap // 2, x1, y1), depth + 1)
            return
        self._leaf(d, r)

    def _leaf(self, d, r):
        th, rng = self.th, self.rng
        x0, y0, x1, y1 = r
        w, h = x1 - x0, y1 - y0
        if w < 6 or h < 6:
            return
        k = rng.random()
        if k < 0.07 and w > 20 and h > 20:
            d.rectangle(r, fill=th["grass"])
            for _ in range(max(1, w * h // 110)):
                tx, ty = rng.integers(x0 + 2, x1 - 1), rng.integers(y0 + 2, y1 - 1)
                rr = int(rng.integers(2, 5))
                d.ellipse([tx - rr, ty - rr, tx + rr, ty + rr], fill=th["tree"])
                d.point((tx - 1, ty - 1), fill=th["park_tree_hi"])
            return
        if k < 0.14 and w > 24 and h > 22:
            pc = tuple(int(c * 1.12) for c in th["asphalt"])
            d.rectangle(r, fill=pc)
            for sx in range(x0 + 2, x1 - 6, 9):
                d.line([(sx, y0 + 1), (sx, y0 + 11)], fill=(150, 150, 150))
                d.line([(sx, y1 - 11), (sx, y1 - 1)], fill=(150, 150, 150))
                for (cy0, cy1) in ((y0 + 2, y0 + 11), (y1 - 11, y1 - 2)):
                    if rng.random() < 0.55:
                        col = th["car_colors"][rng.integers(len(th["car_colors"]))]
                        d.rectangle([sx + 2, cy0, sx + 7, cy1], fill=col)
                        d.rectangle([sx + 2, cy0 + 3, sx + 7, cy0 + 4], fill=(20, 24, 30))
            return
        hmin, hmax = th["h_range"]
        hh = rng.uniform(hmin, hmax) * (0.6 + 0.4 * min(1.0, (w * h) / 2500))
        base = th["roofs"][rng.integers(len(th["roofs"]))]
        j = rng.uniform(0.85, 1.12)
        roof = tuple(int(min(255, c * j)) for c in base)
        details = []
        for _ in range(int(rng.integers(1, 2 + min(6, w * h // 350)))):
            sw_, sh_ = rng.uniform(2, 6) / w, rng.uniform(2, 6) / h
            fx, fy = rng.uniform(0.12, 0.88 - sw_), rng.uniform(0.12, 0.88 - sh_)
            shade = rng.uniform(0.7, 1.35)
            details.append((fx, fy, fx + sw_, fy + sh_, tuple(int(min(255, c * shade)) for c in roof)))
        neon = None
        if rng.random() < th["neon_prob"]:
            col = th["neon"][rng.integers(len(th["neon"]))]
            neon = dict(edge=int(rng.integers(4)), col=col, flick=rng.random() < 0.35,
                        phase=rng.uniform(0, 10), bits=rng.random(64) < 0.75)
        b = dict(rect=(float(x0), float(y0), float(x1 + 1), float(y1 + 1)), h=hh, roof=roof,
                 wall=tuple(int(c * 0.62) for c in roof), details=details,
                 stripes=rng.random() < 0.2, heli=(w > 44 and h > 44 and rng.random() < 0.35),
                 neon=neon, win=rng.random((4, 8, 128)) < th["win_lit"],
                 wincool=rng.random() < 0.3,
                 center=((x0 + x1) / 2, (y0 + y1) / 2))
        self.buildings.append(b)


# --------------------------------------------------------------------------------------
# Traffic
# --------------------------------------------------------------------------------------
class Car:
    __slots__ = ("axis", "road", "lane", "dir", "pos", "speed", "color", "kind")

    def __init__(self, axis, road, lane, d, pos, speed, color, kind="car"):
        self.axis, self.road, self.lane, self.dir = axis, road, lane, d
        self.pos, self.speed, self.color, self.kind = pos, speed, color, kind

    def world(self, t, length):
        p = (self.pos + self.dir * self.speed * t) % length
        if self.axis == "v":
            return self.road + self.lane, p
        return p, self.road + self.lane


def car_rects(axis, d, cx, cy):
    """returns function seg(i0,i1,j0,j1)->rect where i is along (0=front..10=rear), j across 0..5"""
    def seg(i0, i1, j0, j1):
        if axis == "v":
            xa, xb = cx - 3 + j0, cx - 3 + j1
            if d < 0:
                ya, yb = cy - 5 + i0, cy - 5 + i1
            else:
                ya, yb = cy + 5 - i1, cy + 5 - i0
        else:
            ya, yb = cy - 3 + j0, cy - 3 + j1
            if d > 0:
                xa, xb = cx + 5 - i1, cx + 5 - i0
            else:
                xa, xb = cx - 5 + i0, cx - 5 + i1
        return [xa, ya, xb, yb]
    return seg


def shade(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c)


# --------------------------------------------------------------------------------------
# Scene renderer (low res)
# --------------------------------------------------------------------------------------
class Scene:
    def __init__(self, th):
        self.th = th
        self.rng = np.random.default_rng(th["seed"])
        rng = self.rng
        self.city = City(th, rng)
        c = self.city
        self.hero_speed = 66.0
        self.hero_x = c.hero_x + 6
        self.hero_y0 = c.MH - 230
        self.cars = []
        for x in c.vx:
            for lane, d in ((6, -1), (-6, 1)):
                if x == c.hero_x and lane == 6:
                    continue
                for _ in range(int(c.MH / 110)):
                    self.cars.append(Car("v", x, lane, d, rng.uniform(0, c.MH), rng.uniform(32, 66),
                                         th["car_colors"][rng.integers(len(th["car_colors"]))]))
        for y in c.hy:
            for lane, d in ((6, 1), (-6, -1)):
                for _ in range(int(c.MW / 120)):
                    self.cars.append(Car("h", y, lane, d, rng.uniform(0, c.MW), rng.uniform(30, 60),
                                         th["car_colors"][rng.integers(len(th["car_colors"]))]))
        # pedestrians on sidewalks
        R2 = City.RW // 2
        self.peds = []
        for _ in range(420):
            if rng.random() < 0.5:
                x = c.vx[rng.integers(len(c.vx))] + (-(R2 + 3) if rng.random() < 0.5 else R2 + 2)
                self.peds.append(("v", x, rng.uniform(0, c.MH), rng.choice([-1, 1]) * rng.uniform(4, 9),
                                  tuple(int(v) for v in rng.integers(40, 230, 3))))
            else:
                y = c.hy[rng.integers(len(c.hy))] + (-(R2 + 3) if rng.random() < 0.5 else R2 + 2)
                self.peds.append(("h", y, rng.uniform(0, c.MW), rng.choice([-1, 1]) * rng.uniform(4, 9),
                                  tuple(int(v) for v in rng.integers(40, 230, 3))))
        self.lamp_spr = gauss_sprite(7)
        self.tail_spr = gauss_sprite(6)
        self.police_spr = gauss_sprite(30)
        self.search_spr = disk_sprite(44)

    def hero_pos(self, t):
        # slight acceleration after the slam
        dist = self.hero_speed * t + 22.0 * max(0.0, t - T_SLAM) ** 1.5
        return self.hero_x, self.hero_y0 - dist

    def camera(self, t):
        hx, hy = self.hero_pos(t)
        cx = self.city.hero_x + 14 * math.sin(t * 0.55) + 6
        cy = hy - 55
        return int(round(cx)), int(round(cy))

    def draw_car(self, d_alb, d_em, axis, dr, cx, cy, color, police=False, t=0.0, light=None, tl=(0, 0)):
        seg = car_rects(axis, dr, cx, cy)
        sx = 1
        sh = seg(0, 11, 0, 6)
        d_alb.rectangle([sh[0] + sx, sh[1] + sx, sh[2] + sx - 1, sh[3] + sx - 1], fill=(8, 8, 12))
        d_alb.rectangle([sh[0], sh[1], sh[2] - 1, sh[3] - 1], fill=color)
        r = seg(3, 5, 1, 5); d_alb.rectangle([r[0], r[1], r[2] - 1, r[3] - 1], fill=(18, 22, 30))
        r = seg(5, 8, 1, 5); d_alb.rectangle([r[0], r[1], r[2] - 1, r[3] - 1], fill=shade(color, 1.25))
        r = seg(8, 9, 1, 5); d_alb.rectangle([r[0], r[1], r[2] - 1, r[3] - 1], fill=(18, 22, 30))
        if police:
            r = seg(5, 8, 1, 5); d_alb.rectangle([r[0], r[1], r[2] - 1, r[3] - 1], fill=(235, 235, 235))
            on = (t * 6.0) % 1.0 < 0.5
            ra = seg(6, 7, 1, 3); rb = seg(6, 7, 3, 5)
            d_em.rectangle([ra[0], ra[1], ra[2] - 1, ra[3] - 1], fill=(255, 30, 30) if on else (60, 0, 0))
            d_em.rectangle([rb[0], rb[1], rb[2] - 1, rb[3] - 1], fill=(30, 60, 255) if not on else (0, 0, 60))
        for j in (0, 5):
            r = seg(0, 1, j, j + 1); d_em.point((r[0], r[1]), fill=(255, 244, 210))
            r = seg(10, 11, j, j + 1); d_em.point((r[0], r[1]), fill=(255, 30, 24))
        if light is not None:
            cone = CONES[(axis, dr)]
            ch, cw = cone.shape
            if axis == "v":
                x0 = cx - cw // 2
                y0 = cy - 5 - ch if dr < 0 else cy + 6
            else:
                y0 = cy - ch // 2
                x0 = cx + 6 if dr > 0 else cx - 5 - cw
            add_sprite_tl(light, cone, x0, y0, (1.05, 0.98, 0.84))
            rr = seg(10, 11, 2, 3)
            add_sprite_c(light, self.tail_spr, rr[0], rr[1], (0.55, 0.05, 0.03))
            if police:
                on = (t * 6.0) % 1.0 < 0.5
                pa = seg(6, 7, 0, 1)
                pb = seg(6, 7, 5, 6)
                k = 1.7 * (0.75 + 0.25 * math.sin(t * 60))
                if on:
                    add_sprite_c(light, self.police_spr, pa[0], pa[1], (k, 0.08, 0.06))
                else:
                    add_sprite_c(light, self.police_spr, pb[0], pb[1], (0.08, 0.2, k * 1.2))

    def render(self, t, rng):
        th, c = self.th, self.city
        ccx, ccy = self.camera(t)
        tlx, tly = ccx - LW // 2, ccy - LH // 2
        tlx = max(0, min(c.MW - LW, tlx))
        tly = max(0, min(c.MH - LH, tly))
        ccx, ccy = tlx + LW // 2, tly + LH // 2

        alb = Image.fromarray(c.ground[tly:tly + LH, tlx:tlx + LW].copy())
        em = Image.new("RGB", (LW, LH), 0)
        mask = Image.new("L", (LW, LH), 0)
        da, de, dm = ImageDraw.Draw(alb), ImageDraw.Draw(em), ImageDraw.Draw(mask)
        light = c.light[tly:tly + LH, tlx:tlx + LW].copy()

        # pedestrians
        for axis, k, p0, v, col in self.peds:
            if axis == "v":
                x, y = k - tlx, (p0 + v * t) % c.MH - tly
            else:
                x, y = (p0 + v * t) % c.MW - tlx, k - tly
            if -3 < x < LW + 3 and -3 < y < LH + 3:
                da.rectangle([x, y, x + 1, y + 1], fill=col)
                da.point((x, y), fill=(40, 30, 26))

        # lamp heads
        for lx, ly in c.lamps:
            x, y = lx - tlx, ly - tly
            if 0 <= x < LW and 0 <= y < LH:
                de.point((x, y), fill=th["lamp_em"])

        # traffic
        for car in self.cars:
            L = c.MH if car.axis == "v" else c.MW
            wx, wy = car.world(t, L)
            x, y = int(wx) - tlx, int(wy) - tly
            if -60 < x < LW + 60 and -60 < y < LH + 60:
                self.draw_car(da, de, car.axis, car.dir, x, y, car.color, light=light)

        hx, hy = self.hero_pos(t)
        if th["police"]:
            for i, gap in enumerate((44, 92)):
                px, py = int(hx) - tlx + (0 if i == 0 else -12), int(hy + gap + 6 * math.sin(t * 2 + i)) - tly
                self.draw_car(da, de, "v", -1, px, py, (20, 20, 26), police=True, t=t + i * 0.25, light=light)
        self.draw_car(da, de, "v", -1, int(hx) - tlx, int(hy) - tly, th["hero_color"], light=light)

        # buildings with fake perspective (roof pushed away from screen centre)
        vis = []
        for b in c.buildings:
            x0, y0, x1, y1 = b["rect"]
            if x1 < tlx - 160 or x0 > tlx + LW + 160 or y1 < tly - 160 or y0 > tly + LH + 160:
                continue
            vis.append(b)
        vis.sort(key=lambda b: -((b["center"][0] - ccx) ** 2 + (b["center"][1] - ccy) ** 2))
        win_lit_pts = {}
        for b in vis:
            x0, y0, x1, y1 = b["rect"]
            k = 1 + b["h"]

            def P(px, py, kk):
                return ((ccx + (px - ccx) * kk) - tlx, (ccy + (py - ccy) * kk) - tly)

            B = [P(x0, y0, 1), P(x1, y0, 1), P(x1, y1, 1), P(x0, y1, 1)]
            R = [P(x0, y0, k), P(x1, y0, k), P(x1, y1, k), P(x0, y1, k)]
            rx0, ry0, rx1, ry1 = R[0][0], R[0][1], R[2][0], R[2][1]
            if max(rx1, B[2][0]) < 0 or min(rx0, B[0][0]) > LW or max(ry1, B[2][1]) < 0 or min(ry0, B[0][1]) > LH:
                continue
            walls = []
            if ccy < y0:
                walls.append((0, B[0], B[1], R[1], R[0], 0.50))
            if ccy > y1:
                walls.append((1, B[3], B[2], R[2], R[3], 0.38))
            if ccx < x0:
                walls.append((2, B[0], B[3], R[3], R[0], 0.72))
            if ccx > x1:
                walls.append((3, B[1], B[2], R[2], R[1], 0.60))
            for wi, a0, a1, r1, r0, sh in walls:
                poly = [a0, a1, r1, r0]
                da.polygon(poly, fill=shade(b["roof"], sh))
                dm.polygon(poly, fill=255)
                de.polygon(poly, fill=(0, 0, 0))
                # windows
                elen = math.hypot(a1[0] - a0[0], a1[1] - a0[1])
                ncol = int(min(127, elen / 3))
                nrow = int(min(7, max(1, b["h"] * 14)))
                if ncol < 2:
                    continue
                u = (np.arange(ncol) + 0.5) / ncol
                bx = a0[0] + (a1[0] - a0[0]) * u
                by = a0[1] + (a1[1] - a0[1]) * u
                tx = r0[0] + (r1[0] - r0[0]) * u
                ty = r0[1] + (r1[1] - r0[1]) * u
                for rI in range(nrow):
                    f = (rI + 0.65) / (nrow + 0.4)
                    px = bx + (tx - bx) * f
                    py = by + (ty - by) * f
                    lit = b["win"][wi, rI, :ncol]
                    dark_pts = list(zip(px[~lit].tolist(), py[~lit].tolist()))
                    if dark_pts:
                        da.point(dark_pts, fill=shade(b["roof"], sh * 0.55))
                    col = th["win_cool"] if b["wincool"] else th["win"]
                    lp = list(zip(px[lit].tolist(), py[lit].tolist()))
                    if lp:
                        de.point(lp, fill=col)
            roof = [R[0], R[1], R[2], R[3]]
            da.polygon(roof, fill=b["roof"], outline=shade(b["roof"], 0.72))
            dm.polygon(roof, fill=255)
            de.polygon(roof, fill=(0, 0, 0))
            rw, rh = rx1 - rx0, ry1 - ry0
            if b["stripes"]:
                for sy in np.arange(ry0 + 2, ry1 - 1, 2):
                    da.line([(rx0 + 2, sy), (rx1 - 2, sy)], fill=shade(b["roof"], 0.86))
            for fx0, fy0, fx1, fy1, col in b["details"]:
                ax0, ay0 = rx0 + fx0 * rw, ry0 + fy0 * rh
                ax1, ay1 = rx0 + fx1 * rw, ry0 + fy1 * rh
                da.rectangle([ax0 + 1, ay0 + 1, ax1 + 1, ay1 + 1], fill=shade(b["roof"], 0.6))
                da.rectangle([ax0, ay0, ax1, ay1], fill=col)
            if b["heli"]:
                mx, my = (rx0 + rx1) / 2, (ry0 + ry1) / 2
                rr = min(rw, rh) * 0.3
                da.ellipse([mx - rr, my - rr, mx + rr, my + rr], outline=(200, 200, 190))
                da.line([(mx - rr * 0.4, my - rr * 0.5), (mx - rr * 0.4, my + rr * 0.5)], fill=(200, 200, 190))
                da.line([(mx + rr * 0.4, my - rr * 0.5), (mx + rr * 0.4, my + rr * 0.5)], fill=(200, 200, 190))
                da.line([(mx - rr * 0.4, my), (mx + rr * 0.4, my)], fill=(200, 200, 190))
            n = b["neon"]
            if n:
                on = 1.0
                if n["flick"]:
                    ph = (t * 7 + n["phase"]) % 10
                    on = 0.15 if (ph < 0.6 or 3.0 < ph < 3.25) else 1.0
                col = shade(n["col"], on)
                e = n["edge"]
                if e == 0:
                    a, bb = (rx0 + 2, ry0 + 2), (rx1 - 3, ry0 + 2)
                elif e == 1:
                    a, bb = (rx0 + 2, ry1 - 3), (rx1 - 3, ry1 - 3)
                elif e == 2:
                    a, bb = (rx0 + 2, ry0 + 2), (rx0 + 2, ry1 - 3)
                else:
                    a, bb = (rx1 - 3, ry0 + 2), (rx1 - 3, ry1 - 3)
                L = max(1, int(math.hypot(bb[0] - a[0], bb[1] - a[1]) / 2))
                for q in range(L):
                    if n["bits"][q % 64]:
                        f0, f1 = q / L, (q + 0.7) / L
                        de.line([(a[0] + (bb[0] - a[0]) * f0, a[1] + (bb[1] - a[1]) * f0),
                                 (a[0] + (bb[0] - a[0]) * f1, a[1] + (bb[1] - a[1]) * f1)], fill=col)
                cx_, cy_ = (a[0] + bb[0]) / 2, (a[1] + bb[1]) / 2
                add_sprite_c(light, gauss_sprite(16), cx_, cy_, tuple(v / 255 * 0.9 * on for v in n["col"]))

        # rain splashes
        if th["rain"]:
            pts = list(zip(rng.integers(0, LW, 110).tolist(), rng.integers(0, LH, 110).tolist()))
            de.point(pts, fill=(70, 86, 110))

        A = np.asarray(alb).astype(np.float32) / 255.0
        E = np.asarray(em).astype(np.float32) / 255.0 * 2.2
        M = np.asarray(mask).astype(np.float32)[..., None] / 255.0

        amb = np.array(th["ambient"], np.float32)
        if th["lightning"]:
            fl = 0.0
            for ts, a in ((1.42, 1.0), (1.52, 0.6), (1.66, 1.3), (7.35, 0.55), (7.47, 0.4)):
                if t >= ts:
                    fl += a * math.exp(-(t - ts) * 16)
            amb = amb + fl * np.array([0.85, 0.9, 1.2], np.float32)

        if th["heli"]:
            sx = LW / 2 + 115 * math.sin(0.55 * t + 0.4)
            sy = LH / 2 - 40 + 190 * math.sin(0.33 * t + 2.2)
            add_sprite_c(light, self.search_spr, sx, sy, (2.3, 2.2, 1.95))

        lit_light = amb + light * (1 - 0.6 * M)
        if th["wet"]:
            rm = c.roadmask[tly:tly + LH, tlx:tlx + LW][..., None]
            lit_light = lit_light * (1 + 0.35 * rm)
            E = E + light * rm * 0.10
        out = A * lit_light + E

        if th["heli"]:
            shd = Image.new("L", (LW, LH), 0)
            ds = ImageDraw.Draw(shd)
            hx_, hy_ = sx + 34, sy + 52
            ds.ellipse([hx_ - 16, hy_ - 16, hx_ + 16, hy_ + 16], fill=40)
            ds.ellipse([hx_ - 7, hy_ - 3, hx_ + 7, hy_ + 3], fill=150)
            ds.line([(hx_ + 6, hy_), (hx_ + 18, hy_ - 1)], fill=140, width=2)
            ang = t * 37.0
            for q in range(2):
                a_ = ang + q * math.pi / 2
                ds.line([(hx_ - 16 * math.cos(a_), hy_ - 16 * math.sin(a_)),
                         (hx_ + 16 * math.cos(a_), hy_ + 16 * math.sin(a_))], fill=110)
            shd = shd.filter(ImageFilter.GaussianBlur(1.2))
            out = out * (1 - np.asarray(shd).astype(np.float32)[..., None] / 255.0 * 0.65)

        if th["fog"] is not None:
            yy = np.linspace(1.0, 0.6, LH, dtype=np.float32)[:, None, None]
            f = 0.12 * yy
            out = out * (1 - f) + np.array(th["fog"], np.float32) * f
        return out, E


# --------------------------------------------------------------------------------------
# Typography: digit cut-outs and labels
# --------------------------------------------------------------------------------------
DIGIT_POLY = {
    "2": [(0, 0), (8.6, 0), (10, 1.4), (10, 6.6), (8.6, 8), (3, 8), (3, 10), (10, 10), (10, 13),
          (0, 13), (0, 6.4), (1.4, 5), (7, 5), (7, 3), (0, 3)],
    "1": [(2.6, 0), (6.6, 0), (6.6, 10), (9, 10), (9, 13), (0.4, 13), (0.4, 10), (3.4, 10),
          (3.4, 4.3), (0.4, 4.3), (0.4, 2.7)],
}


def make_digit(ch, style, height):
    """returns dict(rgb, alpha, glow, w, h, pad)"""
    pts = DIGIT_POLY[ch]
    slant = 0.20 if style == "gta1" else 0.0
    pts = [(x + (13 - y) * slant, y) for x, y in pts]
    sc = height / 13.0
    wu = max(p[0] for p in pts)
    pad = 110
    w = int(wu * sc) + 2 * pad
    h = int(height) + 2 * pad
    k = 4
    big = Image.new("L", (w * k, h * k), 0)
    ImageDraw.Draw(big).polygon([((x * sc + pad) * k, (y * sc + pad) * k) for x, y in pts], fill=255)
    m_img = big.resize((w, h), Image.LANCZOS)
    m = np.asarray(m_img).astype(np.float32) / 255.0
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    rng = np.random.default_rng(5)
    grain = rng.normal(0, 1, (h, w)).astype(np.float32)
    grain = np.asarray(Image.fromarray(((grain * 30) + 128).clip(0, 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255 - 0.5

    top, bot = pad / h, (pad + height) / h
    g = np.clip((yy - top) / (bot - top), 0, 1)
    if style == "gta2":
        c0, c1 = np.array([255, 70, 58]), np.array([190, 14, 26])
        outline_px, outline_col = 3, np.array([34, 4, 6])
        glow_col, glow_amt, glow_r = np.array([1.0, 0.13, 0.12]), 0.75, 34
        shadow_off, shadow_blur, shadow_a = (0, 14), 12, 0.65
    else:
        c0, c1 = np.array([255, 240, 110]), np.array([255, 112, 8])
        outline_px, outline_col = 9, np.array([12, 8, 6])
        glow_col, glow_amt, glow_r = np.array([1.0, 0.55, 0.12]), 0.55, 40
        shadow_off, shadow_blur, shadow_a = (16, 16), 2, 0.85
    fill = c0[None, None, :] * (1 - g[..., None]) + c1[None, None, :] * g[..., None]
    fill = fill * (1 + grain[..., None] * 0.22)
    # bevel: light top edge, dark bottom edge
    sh_dn = np.roll(m, 6, axis=0)
    sh_up = np.roll(m, -6, axis=0)
    hi = np.clip(m - sh_dn, 0, 1)
    lo = np.clip(m - sh_up, 0, 1)
    fill = fill + hi[..., None] * np.array([90, 80, 70]) - lo[..., None] * np.array([70, 40, 30])
    fill = np.clip(fill, 0, 255)

    dil = np.asarray(m_img.filter(ImageFilter.MaxFilter(outline_px * 2 + 1))).astype(np.float32) / 255.0
    sh_img = Image.fromarray((dil * 255).astype(np.uint8))
    sh = np.asarray(sh_img.filter(ImageFilter.GaussianBlur(shadow_blur))).astype(np.float32) / 255.0
    sh = np.roll(np.roll(sh, shadow_off[1], axis=0), shadow_off[0], axis=1) * shadow_a

    # composite: shadow -> outline -> fill
    rgb = np.zeros((h, w, 3), np.float32)
    a = sh.copy()
    rgb = rgb * 0  # shadow is black
    a = dil + a * (1 - dil)
    rgb = outline_col[None, None, :] * (dil / np.maximum(a, 1e-4))[..., None]
    rgb = fill * m[..., None] + rgb * (1 - m[..., None])
    a = m + a * (1 - m)

    glow = np.asarray(m_img.filter(ImageFilter.GaussianBlur(glow_r))).astype(np.float32) / 255.0
    glow = glow[..., None] * glow_col[None, None, :] * glow_amt
    return dict(rgb=rgb.astype(np.float32), alpha=a.astype(np.float32), mask=m, glow=glow.astype(np.float32),
                w=w, h=h, pad=pad, inner_w=int(wu * sc), inner_h=int(height))


def make_text(txt, font_path, size, fill=(255, 255, 255), stroke=6, tracking=0, shadow=True):
    font = ImageFont.truetype(font_path, size)
    pad = 40
    widths = [font.getlength(c) for c in txt]
    tw = int(sum(widths) + tracking * (len(txt) - 1))
    asc, desc = font.getmetrics()
    w, h = tw + 2 * pad, asc + desc + 2 * pad
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if shadow:
        sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ds = ImageDraw.Draw(sh)
    x = pad
    for c, cw in zip(txt, widths):
        if shadow:
            ds.text((x + 5, pad + 7), c, font=font, fill=(0, 0, 0, 170), stroke_width=stroke,
                    stroke_fill=(0, 0, 0, 170))
        d.text((x, pad), c, font=font, fill=fill + (255,), stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
        x += cw + tracking
    if shadow:
        sh = sh.filter(ImageFilter.GaussianBlur(6))
        img = Image.alpha_composite(sh, img)
    arr = np.asarray(img).astype(np.float32)
    return dict(rgb=arr[..., :3], alpha=arr[..., 3] / 255.0, w=w, h=h, pad=pad, tw=tw, asc=asc)


def blend(frame, rgb, alpha, x, y, opacity=1.0):
    h, w = alpha.shape
    x, y = int(round(x)), int(round(y))
    fx0, fy0 = max(0, x), max(0, y)
    fx1, fy1 = min(W, x + w), min(H, y + h)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    a = alpha[fy0 - y:fy1 - y, fx0 - x:fx1 - x, None] * opacity
    frame[fy0:fy1, fx0:fx1] = frame[fy0:fy1, fx0:fx1] * (1 - a) + rgb[fy0 - y:fy1 - y, fx0 - x:fx1 - x] * a


def add_layer(frame, rgb, x, y, k=1.0):
    h, w = rgb.shape[:2]
    x, y = int(round(x)), int(round(y))
    fx0, fy0 = max(0, x), max(0, y)
    fx1, fy1 = min(W, x + w), min(H, y + h)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    frame[fy0:fy1, fx0:fx1] += rgb[fy0 - y:fy1 - y, fx0 - x:fx1 - x] * k


def scale_layer(L, s):
    """scale an RGBA-ish layer dict by factor s (returns rgb, alpha, glow)"""
    if abs(s - 1) < 1e-3:
        return L["rgb"], L["alpha"], L.get("glow")
    nw, nh = max(2, int(L["w"] * s)), max(2, int(L["h"] * s))
    rgb = np.asarray(Image.fromarray(np.clip(L["rgb"], 0, 255).astype(np.uint8)).resize((nw, nh), Image.BILINEAR)).astype(np.float32)
    al = np.asarray(Image.fromarray((L["alpha"] * 255).astype(np.uint8)).resize((nw, nh), Image.BILINEAR)).astype(np.float32) / 255
    gl = None
    if L.get("glow") is not None:
        gl = np.asarray(Image.fromarray(np.clip(L["glow"] * 255, 0, 255).astype(np.uint8)).resize((nw, nh), Image.BILINEAR)).astype(np.float32) / 255
    return rgb, al, gl


# --------------------------------------------------------------------------------------
# Grading / post
# --------------------------------------------------------------------------------------
def make_lut(kind):
    x = np.arange(256, dtype=np.float32) / 255
    if kind == "neon":
        r = np.clip(x ** 1.04 * 1.02 + 0.010, 0, 1)
        g = np.clip(x ** 1.06 + 0.012, 0, 1)
        b = np.clip(x ** 0.86 * 1.02 + 0.045, 0, 1)
    else:
        r = np.clip(x ** 0.92 * 1.03 + 0.030, 0, 1)
        g = np.clip(x ** 1.00 + 0.020, 0, 1)
        b = np.clip(x ** 1.22 * 0.90 + 0.018, 0, 1)
    # gentle S-curve
    def s(c):
        return c + 0.12 * (c - 0.5) * (1 - np.abs(2 * c - 1))
    return [(np.clip(s(c), 0, 1) * 255).astype(np.uint8) for c in (r, g, b)]


def osd_layer(lines):
    """VHS on-screen display text -> RGBA arrays"""
    font = ImageFont.truetype(FONT_MONO, 50)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for (x, y, txt, tri) in lines:
        d.text((x + 3, y + 3), txt, font=font, fill=(0, 0, 0, 160))
        d.text((x, y), txt, font=font, fill=(236, 240, 236, 235))
        if tri:
            tx = x + font.getlength(txt) + 22
            d.polygon([(tx + 3, y + 13), (tx + 3, y + 55), (tx + 39, y + 34)], fill=(0, 0, 0, 160))
            d.polygon([(tx, y + 10), (tx, y + 52), (tx + 36, y + 31)], fill=(236, 240, 236, 235))
    arr = np.asarray(img).astype(np.float32)
    return arr[..., :3], arr[..., 3] / 255.0


def bg_reader(path):
    cmd = ["ffmpeg", "-v", "error", "-stream_loop", "-1", "-i", path, "-vf",
           f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS}",
           "-frames:v", str(NF), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    last = np.zeros((H, W, 3), np.uint8)
    while True:
        buf = p.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            while True:
                yield last
        last = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        yield last


# --------------------------------------------------------------------------------------
# Video
# --------------------------------------------------------------------------------------
def render_video(day, out_path, audio_path, bg=None, preview_times=None):
    th = THEMES[day]
    rng = np.random.default_rng(th["seed"] + 11)
    scene = None if bg else Scene(th)
    bgi = bg_reader(bg) if bg else None
    lut = make_lut(th["grade"])

    # static post layers
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rr = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.60)) ** 2)
    vignette = np.clip(1.15 - rr ** 2 * 0.75, 0.2, 1.0)
    scan = np.ones(H, np.float32)
    scan[2::3] = 0.86
    post_mul = (vignette * scan[:, None])[..., None].astype(np.float32)
    band = np.exp(-((yy[:, :1] - H * 0.47) / (H * 0.16)) ** 2)[..., None].astype(np.float32)  # text backdrop
    grains = [rng.normal(0, 9, (H // 2, W // 2, 1)).astype(np.float32).repeat(2, 0).repeat(2, 1) for _ in range(6)]
    del yy, xx, rr

    # rain drops (full res)
    nd = 520
    drops = np.stack([rng.uniform(0, W + 300, nd), rng.uniform(0, H, nd), rng.uniform(1800, 2900, nd),
                      rng.uniform(24, 70, nd), rng.uniform(25, 85, nd)], 1)

    # typography
    digit_h = 300
    D = make_digit(str(day), th["digit"], digit_h)
    T = make_text(th["label"], FONT_TEXT, 112, stroke=6)
    gap = 34
    group_w = D["inner_w"] + gap + T["tw"]
    gx = (W - group_w) / 2
    cy = H * 0.47
    dx, dy = gx - D["pad"], cy - digit_h / 2 - D["pad"]
    tx = gx + D["inner_w"] + gap - T["pad"]
    ty = cy - T["asc"] * 0.62 - T["pad"] + digit_h * 0.06
    DATE = make_text(th["date_txt"], FONT_MONO, 44, fill=(230, 230, 226), stroke=3, tracking=2)
    END = make_text(th["end_card"], FONT_BLACK, 136, stroke=7, tracking=6) if th["end_card"] else None

    glitch_times = [2.86, 2.98, 5.15, 6.7, 7.95, 9.25] + ([8.0, 8.08] if END else [])
    glitch_set = set()
    for gt in glitch_times:
        f0 = int(gt * FPS)
        for k in range(int(rng.integers(2, 4))):
            glitch_set.add(f0 + k)

    proc = None
    if preview_times is None:
        proc = subprocess.Popen(
            ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
             "-r", str(FPS), "-i", "-", "-i", audio_path, "-c:v", "libx264", "-preset", "slow", "-crf", "22",
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
             out_path], stdin=subprocess.PIPE)
        frames = range(NF)
    else:
        frames = [int(t * FPS) for t in preview_times]

    previews = []
    for fi in frames:
        t = fi / FPS
        glitch = fi in glitch_set
        frng = np.random.default_rng(1000 + fi)

        # ---- base image
        if scene is not None:
            lit, E = scene.render(t, frng)
            tm = 1 - np.exp(-lit * 1.55)
            low = (np.clip(tm, 0, 1) * 255).astype(np.uint8)
            frame8 = low.repeat(S, 0).repeat(S, 1)
            bsrc = np.maximum(lit - 0.8, 0) * 0.6 + E * 0.55
        else:
            frame8 = next(bgi).copy()
            low = np.asarray(Image.fromarray(frame8).resize((LW, LH), Image.BILINEAR)).astype(np.float32) / 255
            bsrc = np.maximum(low - 0.7, 0) * 1.4
        b1 = box_blur(box_blur(bsrc, 2), 2)
        b2 = box_blur(box_blur(bsrc, 9), 9)
        bl = 1 - np.exp(-(b1 * 0.9 + b2 * 1.1))
        bl8 = Image.fromarray((np.clip(bl, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
        f = frame8.astype(np.float32) + np.asarray(bl8).astype(np.float32) * 0.95

        # ---- rain
        if th["rain"]:
            rimg = Image.new("L", (W, H), 0)
            dr = ImageDraw.Draw(rimg)
            for x0, y0, vy, ln, br in drops:
                y = (y0 + vy * t) % (H + 200) - 100
                x = (x0 - vy * 0.16 * t) % (W + 300) - 150
                dr.line([(x, y), (x - ln * 0.16, y + ln)], fill=int(br), width=2 if br > 70 else 1)
            ra = np.asarray(rimg).astype(np.float32)[..., None]
            f += ra * np.array([0.75, 0.85, 1.0], np.float32)

        # ---- grade
        f8 = np.clip(f, 0, 255).astype(np.uint8)
        f = np.stack([lut[c][f8[..., c]] for c in range(3)], -1).astype(np.float32)

        # ---- text backdrop darkening grows into the slam
        dk = 0.55 * smoothstep(2.4, T_SLAM, t)
        if END is not None:
            dk = max(dk, 0.65 * smoothstep(7.9, 8.2, t))
        if dk > 0:
            f *= 1 - band * dk

        # ---- digit + label
        ts = t - T_SLAM
        show_group = ts >= 0 and not (END is not None and t >= 8.0)
        if END is not None and 7.95 <= t < 8.0:
            show_group = fi % 2 == 0
        if show_group or (-0.45 < ts < 0 and glitch):
            s = 1.0
            if 0 <= ts < 0.2:
                s = 1.0 + 0.55 * (1 - ease_out_cubic(ts / 0.2))
            if END is None and t > 8.2:
                s *= 1.0 + 0.035 * smoothstep(8.2, 10.4, t)
            rgb, al, gl = scale_layer(D, s)
            ox = dx + D["w"] * (1 - s) / 2
            oy = dy + D["h"] * (1 - s) / 2
            pulse = 0.75 + 0.25 * math.sin(t * 2 * math.pi / 1.15)
            if ts < 0:  # pre-slam ghost flicker
                add_layer(f, gl * 255, ox, oy, 0.8)
            else:
                add_layer(f, gl * 255, ox, oy, pulse)
                if ts < 0.24:
                    # "cut-out" reveal: the digit is a hole showing an over-exposed scene, then fills in
                    k = smoothstep(0.08, 0.24, ts)
                    hole = np.clip(f * 1.9 + 40, 0, 255)
                    h_, w_ = al.shape
                    x0_, y0_ = int(ox), int(oy)
                    fx0, fy0, fx1, fy1 = max(0, x0_), max(0, y0_), min(W, x0_ + w_), min(H, y0_ + h_)
                    sub_a = al[fy0 - y0_:fy1 - y0_, fx0 - x0_:fx1 - x0_, None] * (1 - k)
                    f[fy0:fy1, fx0:fx1] = f[fy0:fy1, fx0:fx1] * (1 - sub_a) + hole[fy0:fy1, fx0:fx1] * sub_a
                    blend(f, rgb, al, ox, oy, k)
                else:
                    if glitch:
                        blend(f, rgb * np.array([1, 0.2, 0.2]), al, ox + 14, oy, 0.7)
                        blend(f, rgb * np.array([0.2, 0.9, 1.0]), al, ox - 14, oy + 4, 0.6)
                    blend(f, rgb, al, ox, oy)
            # label wipe-in
            if ts > 0.32:
                p = ease_out_cubic((ts - 0.32) / 0.45)
                edge = (T["w"]) * p
                xs = np.arange(T["w"], dtype=np.float32)
                wipe = np.clip((edge - xs) / 60.0 + 0.0, 0, 1)[None, :]
                lx = tx + 26 * (1 - p)
                if END is None and t > 8.2:
                    lx += 0  # keep put
                blend(f, T["rgb"], T["alpha"] * wipe, lx, ty)

        # date line
        if t > 5.6 and (END is None or t < 7.95):
            p = smoothstep(5.6, 6.3, t)
            blend(f, DATE["rgb"], DATE["alpha"], (W - DATE["w"]) / 2, cy + digit_h / 2 + 70, p * 0.92)

        # end card (day 1)
        if END is not None and t >= 8.0:
            te = t - 8.0
            on = (t * 3.0) % 1.0 < 0.5
            glow_col = np.array([255, 30, 30] if on else [40, 80, 255], np.float32)
            ex, ey = (W - END["w"]) / 2, cy - END["h"] / 2
            gmask = Image.fromarray((END["alpha"] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(28))
            gm = np.asarray(gmask).astype(np.float32)[..., None] / 255.0
            add_layer(f, gm * glow_col * 0.9, ex + (-30 if on else 30), ey, 1.0)
            s = 1.0 + 0.4 * (1 - ease_out_cubic(te / 0.18))
            Ld = dict(rgb=END["rgb"], alpha=END["alpha"], w=END["w"], h=END["h"])
            rgb, al, _ = scale_layer(Ld, s)
            blend(f, rgb, al, (W - rgb.shape[1]) / 2, ey - (rgb.shape[0] - END["h"]) / 2,
                  smoothstep(0.0, 0.08, te))
            blend(f, DATE["rgb"], DATE["alpha"], (W - DATE["w"]) / 2, cy + END["h"] / 2 + 10,
                  smoothstep(0.6, 1.2, te) * 0.92)

        # ---- VHS OSD
        osd = []
        if 0.3 < t < 2.8 and not (2.2 < t and fi % 16 < 8):
            osd.append((72, 118, "PLAY", True))
        hh, mm, ss = th["osd_clock"]
        secs = ss + int(t)
        osd.append((72, H - 360, f"{th['osd_date']}", False))
        osd.append((72, H - 300, f"{hh:02d}:{mm + secs // 60:02d}:{secs % 60:02d}", False))
        orgb, oal = osd_layer(osd)
        blend(f, orgb, oal, 0, 0, 0.88)

        # ---- slam flash + shake
        if ts >= 0:
            f += 255 * 0.85 * math.exp(-ts * 13)
        if END is not None and t >= 8.0:
            f += 255 * 0.6 * math.exp(-(t - 8.0) * 12)
        amp = 0.0
        if ts >= 0:
            amp = 22 * math.exp(-ts * 7)
        if END is not None and t >= 8.0:
            amp = max(amp, 16 * math.exp(-(t - 8.0) * 8))
        if amp > 0.5:
            f = np.roll(f, (int(frng.normal(0, amp)), int(frng.normal(0, amp))), axis=(0, 1))

        # ---- chroma + tracking
        ca = 3 + (14 if glitch else 0) + (10 * math.exp(-max(0, ts) * 9) if ts >= 0 else 0)
        ca = int(ca)
        if ca:
            f[..., 0] = np.roll(f[..., 0], ca, axis=1)
            f[..., 2] = np.roll(f[..., 2], -ca, axis=1)
        if glitch or t < 0.7 or (fi % 97) < 2:
            for _ in range(3 if glitch else 1):
                y0 = int(frng.integers(0, H - 120))
                hgt = int(frng.integers(20, 120))
                f[y0:y0 + hgt] = np.roll(f[y0:y0 + hgt], int(frng.integers(-60, 60)), axis=1)
                f[y0:y0 + hgt] += frng.normal(0, 25, (hgt, 1, 1)).astype(np.float32)

        f = f * post_mul + grains[fi % 6]

        # ---- tape intro static / fade
        if t < 0.32:
            st = frng.integers(0, 255, (H // 4, W // 4, 1)).astype(np.float32).repeat(4, 0).repeat(4, 1)
            f = np.repeat(st, 3, axis=2) * 0.8
        elif t < 0.9:
            k = smoothstep(0.32, 0.9, t)
            f *= k

        # ---- CRT power-off at the end
        t_off = 10.3
        if t >= t_off:
            img = Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))
            te = t - t_off
            if te < 0.28:
                sy = max(0.004, 1 - ease_out_cubic(te / 0.28))
                nh = max(4, int(H * sy))
                im2 = img.resize((W, nh), Image.BILINEAR)
                f = np.zeros((H, W, 3), np.float32)
                f[(H - nh) // 2:(H - nh) // 2 + nh] = np.asarray(im2).astype(np.float32) * (1 + 1.5 * (1 - sy)) + 60 * (1 - sy)
            elif te < 0.45:
                sx = 1 - smoothstep(0.28, 0.45, te)
                nw = max(4, int(W * sx))
                f = np.zeros((H, W, 3), np.float32)
                f[H // 2 - 3:H // 2 + 3, (W - nw) // 2:(W - nw) // 2 + nw] = 255
                g = Image.fromarray(f.astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
                f = f + np.asarray(g).astype(np.float32) * 2
            else:
                f = np.zeros((H, W, 3), np.float32)
                if te < 0.6:
                    f[H // 2 - 2:H // 2 + 2, W // 2 - 2:W // 2 + 2] = 255 * (1 - (te - 0.45) / 0.15)

        out = np.clip(f, 0, 255).astype(np.uint8)
        if proc is not None:
            proc.stdin.write(out.tobytes())
            if fi % 30 == 0:
                print(f"  day {day}: frame {fi}/{NF}", flush=True)
        else:
            previews.append(out)
    if proc is not None:
        proc.stdin.close()
        proc.wait()
    return previews


# --------------------------------------------------------------------------------------
# Audio
# --------------------------------------------------------------------------------------
def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def fft_filter(x, lo=None, hi=None):
    n = len(x)
    N = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, N)
    fr = np.fft.rfftfreq(N, 1 / SR)
    g = np.ones_like(fr)
    if hi is not None:
        g /= np.sqrt(1 + (fr / hi) ** 4)
    if lo is not None:
        g *= (fr / lo) ** 2 / np.sqrt(1 + (fr / lo) ** 4)
    return np.fft.irfft(X * g, N)[:n]


def lp_var(x, fc):
    """one-pole low-pass with per-sample cutoff (applied twice = 12 dB/oct)"""
    a = np.exp(-2 * np.pi * np.asarray(fc) / SR) * np.ones(len(x))
    for _ in range(2):
        y = np.empty_like(x)
        s = 0.0
        b = 1 - a
        for i in range(len(x)):
            s = b[i] * x[i] + a[i] * s
            y[i] = s
        x = y
    return x


def conv_reverb(x, seconds, decay, seed):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    out = []
    for ch in range(2):
        ir = rng.normal(0, 1, n) * np.exp(-tt / decay)
        ir = fft_filter(ir, hi=5200)
        ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        N = 1 << (len(x) + n).bit_length()
        y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[: len(x)]
        out.append(y / (np.sqrt(np.sum(ir ** 2)) + 1e-9) * 0.5)
    return np.stack(out)


def render_audio(day, path):
    n = int(SR * DUR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(100 + day)
    mix = np.zeros((2, n))
    rev_send = np.zeros(n)

    def put(sig, start, gain=1.0, pan=0.0, send=0.0):
        i0 = int(start * SR)
        if i0 >= n:
            return
        sig = sig[: n - i0]
        gl, gr = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
        mix[0, i0:i0 + len(sig)] += sig * gain * gl * 1.414
        mix[1, i0:i0 + len(sig)] += sig * gain * gr * 1.414
        rev_send[i0:i0 + len(sig)] += sig * gain * send

    def env_ad(nn, a, d):
        tt = np.arange(nn) / SR
        return np.minimum(1, tt / max(a, 1e-4)) * np.exp(-tt / d)

    # ---------- pad
    if day == 2:
        chords = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [38, 50, 53, 57, 62], [40, 52, 56, 59, 64]]
    else:
        chords = [[38, 50, 53, 57], [34, 46, 50, 53], [31, 43, 50, 55, 58], [33, 45, 49, 52, 57]]
    seg = DUR / 4
    pad = np.zeros(n)
    for ci, ch in enumerate(chords):
        e = np.clip(1 - np.abs((t - (ci + 0.5) * seg) / (seg * 0.62)), 0, 1) ** 0.6
        for m in ch:
            for det in (-0.07, 0.0, 0.08):
                fr = mtof(m + det)
                ph = rng.uniform(0, 1)
                pad += (2 * ((fr * t + ph) % 1) - 1) * e * (0.6 if m < 48 else 0.35)
    cutoff = 380 + 1500 * np.clip((t - T_SLAM) / 1.5, 0, 1) + 300 * np.sin(t * 0.7) ** 2
    if day == 1:
        cutoff = cutoff * 0.75
    pad = lp_var(pad, cutoff)
    pad *= 0.10 * (0.35 + 0.65 * np.clip((t - 0.3) / 2.5, 0, 1))
    pad *= (0.6 + 0.4 * np.clip((t - T_SLAM) / 0.4, 0, 1))
    put(pad, 0, 1.0, -0.15, send=0.5)
    pr = np.concatenate([np.zeros(int(0.013 * SR)), pad])[:n]
    put(pr, 0, 1.0, 0.3, send=0.2)

    # ---------- impact (slam)
    def impact(dur=3.0, f0=62, f1=31, big=1.0):
        nn = int(dur * SR)
        tt = np.arange(nn) / SR
        fr = f1 + (f0 - f1) * np.exp(-tt * 7)
        sub = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-tt * 1.4)
        nz = fft_filter(rng.normal(0, 1, nn), hi=2500) * np.exp(-tt * 18) * 0.8
        metal = sum(np.sin(2 * np.pi * f * tt + rng.uniform(0, 6)) for f in (173, 289, 431, 617, 902)) * np.exp(-tt * 3.2) * 0.07
        crack = rng.normal(0, 1, nn) * np.exp(-tt * 60) * 0.6
        return (sub * 1.0 + nz + metal + crack) * big

    put(impact(), T_SLAM, 0.9, 0, send=0.9)

    # ---------- riser before slam
    rs, re_ = T_SLAM - 1.3, T_SLAM
    nn = int((re_ - rs) * SR)
    tt = np.arange(nn) / SR
    pr_ = tt / (re_ - rs)
    riser = lp_var(rng.normal(0, 1, nn), 300 + 7000 * pr_ ** 2) * pr_ ** 2.2 * 0.5
    riser += np.sin(2 * np.pi * np.cumsum(180 + 900 * pr_ ** 2) / SR) * pr_ ** 3 * 0.08
    put(riser, rs, 0.9, 0, send=0.3)

    # ---------- reverse swell before the slam
    nn = int(0.9 * SR)
    tt = np.arange(nn) / SR
    rev = fft_filter(rng.normal(0, 1, nn), lo=3000) * (tt / 0.9) ** 3 * 0.25
    put(rev, T_SLAM - 0.9, 1.0, 0.0, send=0.4)

    if day == 2:
        # rain bed + drops
        rain = fft_filter(rng.normal(0, 1, n), lo=400, hi=7000) * 0.07
        rain2 = fft_filter(rng.normal(0, 1, n), lo=400, hi=7000) * 0.07
        mix[0] += rain
        mix[1] += rain2
        for _ in range(int(DUR * 35)):
            st = rng.uniform(0, DUR)
            nn = int(0.03 * SR)
            tt = np.arange(nn) / SR
            put(np.sin(2 * np.pi * rng.uniform(1800, 5200) * tt) * np.exp(-tt * 260), st,
                rng.uniform(0.005, 0.03), rng.uniform(-1, 1))
        # thunder
        for ts, g in ((1.72, 1.0), (7.7, 0.55)):
            nn = int(4.5 * SR)
            tt = np.arange(nn) / SR
            brown = np.cumsum(rng.normal(0, 1, nn))
            brown = fft_filter(brown - np.mean(brown), lo=25, hi=260)
            brown /= np.max(np.abs(brown)) + 1e-9
            modv = np.repeat(rng.uniform(0.3, 1.0, nn // 2000 + 1), 2000)[:nn]
            modv = fft_filter(modv, hi=8)
            th_env = np.minimum(1, tt / 0.08) * np.exp(-tt / 1.4)
            crack = fft_filter(rng.normal(0, 1, nn), lo=800) * np.exp(-tt * 9) * 0.25
            put((brown * modv * th_env * 1.2 + crack) * g, ts, 0.75, rng.uniform(-0.4, 0.4), send=0.4)
        # synthwave bass + hats after slam
        bpm = 104
        step = 60 / bpm / 2
        k = 0
        tb = T_SLAM
        while tb < 10.3:
            ci = min(3, int(tb / seg))
            root = chords[ci][0] - 12 + (12 if k % 4 == 2 else 0)
            nn = int(step * SR)
            tt = np.arange(nn) / SR
            fr = mtof(root)
            note = (2 * ((fr * tt) % 1) - 1) + 0.5 * np.sin(2 * np.pi * fr * tt)
            note = fft_filter(note, hi=500 + 300 * (k % 2)) * env_ad(nn, 0.004, 0.16)
            put(note, tb, 0.22, 0.0, send=0.05)
            if k % 2 == 1:
                nh = int(0.06 * SR)
                put(fft_filter(rng.normal(0, 1, nh), lo=7000) * env_ad(nh, 0.001, 0.018), tb, 0.10, 0.35)
            if k % 4 == 2 and tb > 5.0:
                ns = int(0.4 * SR)
                sn = fft_filter(rng.normal(0, 1, ns), lo=900, hi=6000) * env_ad(ns, 0.001, 0.09)
                put(sn, tb, 0.18, -0.1, send=0.9)
            tb += step
            k += 1
    else:
        # helicopter
        hel = fft_filter(rng.normal(0, 1, n), hi=380)
        chop = (0.5 + 0.5 * np.cos(2 * np.pi * 11.5 * t)) ** 3
        sx = np.sin(0.55 * t + 0.4)
        lvl = (0.10 + 0.07 * (1 + np.sin(0.33 * t + 2.2)) / 2) * np.clip(t / 1.5, 0, 1)
        hel_sig = hel * (0.25 + chop) * lvl * 2.2
        mix[0] += hel_sig * np.clip(1 - sx, 0.3, 1.6) * 0.7
        mix[1] += hel_sig * np.clip(1 + sx, 0.3, 1.6) * 0.7
        rev_send[:] += hel_sig * 0.15
        # distant siren wail
        fr = 880 + 420 * np.sin(2 * np.pi * t / 2.6)
        ph = 2 * np.pi * np.cumsum(fr) / SR
        sir = (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph))
        sir = fft_filter(sir, hi=1800) * 0.05 * (0.5 + 0.5 * np.clip((t - 0.6) / 2, 0, 1))
        put(sir, 0, 1.0, -0.5, send=1.2)
        fr2 = 760 + 380 * np.sin(2 * np.pi * (t + 0.9) / 2.2)
        ph2 = 2 * np.pi * np.cumsum(fr2) / SR
        sir2 = fft_filter(np.sin(ph2) + 0.3 * np.sin(2 * ph2), hi=1500) * 0.035 * np.clip((t - 4) / 2, 0, 1)
        put(sir2, 0, 1.0, 0.6, send=1.2)
        # clock ticks
        tb = 0.5
        k = 0
        while tb < 10.2:
            if not (T_SLAM - 0.1 < tb < T_SLAM + 0.6):
                nn = int(0.05 * SR)
                tt = np.arange(nn) / SR
                f_ = 2600 if k % 2 == 0 else 2100
                tick = (np.sin(2 * np.pi * f_ * tt) + 0.5 * np.sin(2 * np.pi * f_ * 1.7 * tt)) * np.exp(-tt * 320)
                put(tick, tb, 0.10, 0.15, send=0.3)
            tb += 0.5
            k += 1
        # heartbeat after slam
        tb = T_SLAM + 0.9
        while tb < 10.2:
            for off, f0, g in ((0, 62, 1.0), (0.17, 52, 0.7)):
                nn = int(0.35 * SR)
                tt = np.arange(nn) / SR
                fr_ = f0 * (1 + 0.6 * np.exp(-tt * 40))
                beat = np.sin(2 * np.pi * np.cumsum(fr_) / SR) * env_ad(nn, 0.003, 0.08)
                put(beat, tb + off, 0.55 * g, 0, send=0.1)
            tb += 0.86 if tb < 7.9 else 0.62
        # second hit for TOMORROW
        nn = int(1.2 * SR)
        tt = np.arange(nn) / SR
        put(fft_filter(rng.normal(0, 1, nn), lo=3000) * (tt / 1.2) ** 3 * 0.3, 8.0 - 1.2, 1.0, 0, send=0.5)
        put(impact(3.0, 70, 34, 1.0), 8.0, 0.95, 0, send=1.0)

    # ---------- reverb + master
    wet = conv_reverb(rev_send, 3.2, 1.0, 9)
    mix += wet
    # tape start / stop warp
    speed = np.ones(n)
    a = t < 0.45
    speed[a] = 0.25 + 0.75 * (t[a] / 0.45) ** 0.7
    b = (t >= 10.3)
    speed[b] = np.clip(1 - (t[b] - 10.3) / 0.55, 0, 1) ** 1.3
    pos = np.cumsum(speed) / SR
    out = np.stack([np.interp(pos, t, mix[c]) for c in range(2)])
    out[:, t > 10.85] = 0
    out *= np.clip((t - 0.0) / 0.05, 0, 1)
    pk = np.max(np.abs(out)) + 1e-9
    out = out / pk * 1.1
    out = np.tanh(out * 1.3) / np.tanh(1.3) * 0.9
    data = (out.T * 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(data.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=int, choices=[1, 2], action="append")
    ap.add_argument("--bg", help="optional background clip (your own footage)")
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--preview", type=float, nargs="*", help="only render still frames at these times")
    args = ap.parse_args()
    days = args.day or [2, 1]
    for day in days:
        if args.preview:
            imgs = render_video(day, None, None, args.bg, args.preview)
            for tt, im in zip(args.preview, imgs):
                p = os.path.join(args.out, f"preview_day{day}_{tt:.2f}.png")
                Image.fromarray(im).resize((W // 2, H // 2), Image.LANCZOS).save(p)
                print(p)
            continue
        wav = os.path.join(args.out, f"_audio_day{day}.wav")
        print(f"audio day {day}...", flush=True)
        render_audio(day, wav)
        mp4 = os.path.join(args.out, f"gta6_countdown_day{day}.mp4")
        print(f"video day {day}...", flush=True)
        render_video(day, mp4, wav, args.bg)
        os.remove(wav)
        print("done:", mp4)


if __name__ == "__main__":
    main()

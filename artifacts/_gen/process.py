"""TEMP: raw Krea2 outputs -> web assets (apps/client/assets/ui). Icons get a colour-key matte from the flat navy bg."""
from PIL import Image, ImageFilter
import numpy as np, os

RAW = os.path.join(os.path.dirname(__file__), "raw")
DST = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "client", "assets", "ui")
os.makedirs(DST, exist_ok=True)


def matte(name, out, size=256):
    im = Image.open(os.path.join(RAW, name + ".png")).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape
    border = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    t0, t1 = 14.0, 58.0
    alpha = np.clip((d - t0) / (t1 - t0), 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    # 去掉背景色残留：把半透明像素的颜色从背景里“解混”出来
    al = np.maximum(alpha[..., None], 1e-3)
    fg = np.clip((a - bg * (1 - al)) / al, 0, 255)
    rgba = np.dstack([np.where(alpha[..., None] > 0.02, fg, 0), alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    img = img.filter(ImageFilter.SMOOTH) if False else img
    bbox = Image.fromarray((alpha > 0.08).astype(np.uint8) * 255).getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        half = max(x1 - x0, y1 - y0) / 2 * 1.08
        img = img.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(DST, out + ".webp"), "WEBP", quality=90, method=6)
    print("icon", out, img.size)


def bg(name, out, width=None, q=80):
    im = Image.open(os.path.join(RAW, name + ".png")).convert("RGB")
    if width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(os.path.join(DST, out + ".webp"), "WEBP", quality=q, method=6)
    print("bg", out, im.size)


for n in ["item_hp200", "item_hp250", "item_pp20", "item_pp5", "item_cure",
          "seal_all", "seal_stat", "seal_skill", "seal_common", "nav_battle", "nav_storage", "nav_bag"]:
    matte(n, n)
bg("bg_home", "bg_home")
bg("bg_lab", "bg_lab")
bg("bg_bag", "bg_bag")
bg("tex_crystal", "tex_crystal", width=640, q=82)

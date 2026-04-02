#!/usr/bin/env python3
"""
Generate PNG icons for the Page2PDF Chrome extension.
No external dependencies — builds raw PNG bytes from scratch.

Design: indigo gradient rounded square, white document shape
        with folded top-right corner, and muted text lines.
"""
import struct, zlib, os, math

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
BG_DARK   = (15,  15,  20)    # extension background (outside icon)
IND_TOP   = (108, 98,  229)   # #6c62e5 — indigo top
IND_BOT   = (130, 122, 248)   # slightly lighter indigo bottom
WHITE     = (255, 255, 255)
FOLD_CLR  = (200, 196, 248)   # lavender — fold crease shadow
LINE_CLR  = (172, 167, 232)   # muted indigo — text lines on document

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def lerp(a, b, t):
    return round(a + (b - a) * t)

def make_png(pixels, size):
    """Encode a size×size list-of-rows-of-(R,G,B)-tuples as PNG bytes."""
    def chunk(tag, data):
        payload = tag + data
        return (struct.pack('>I', len(data)) + payload +
                struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF))

    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    raw  = b''.join(b'\x00' + bytes(v for px in row for v in px) for row in pixels)
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend

# ---------------------------------------------------------------------------
# Icon renderer
# ---------------------------------------------------------------------------
def create_icon(size):
    img = [[BG_DARK] * size for _ in range(size)]

    # ── Rounded-square background ──────────────────────────────────────────
    pad = max(1, round(size * 0.05))
    cr  = round(size * 0.20)          # corner radius
    x0, y0 = pad, pad
    x1, y1 = size - pad, size - pad

    def in_bg(px, py):
        if not (x0 <= px < x1 and y0 <= py < y1):
            return False
        in_tl = px < x0 + cr and py < y0 + cr
        in_tr = px >= x1 - cr and py < y0 + cr
        in_bl = px < x0 + cr and py >= y1 - cr
        in_br = px >= x1 - cr and py >= y1 - cr
        if in_tl: return (px-(x0+cr))**2 + (py-(y0+cr))**2 <= cr**2
        if in_tr: return (px-(x1-cr))**2 + (py-(y0+cr))**2 <= cr**2
        if in_bl: return (px-(x0+cr))**2 + (py-(y1-cr))**2 <= cr**2
        if in_br: return (px-(x1-cr))**2 + (py-(y1-cr))**2 <= cr**2
        return True

    for y in range(size):
        for x in range(size):
            if in_bg(x, y):
                t = (y - y0) / max(y1 - y0 - 1, 1)
                img[y][x] = (
                    lerp(IND_TOP[0], IND_BOT[0], t * 0.7),
                    lerp(IND_TOP[1], IND_BOT[1], t * 0.7),
                    lerp(IND_TOP[2], IND_BOT[2], t * 0.7),
                )

    # ── Document shape ─────────────────────────────────────────────────────
    DW = round(size * 0.50)           # doc width
    DH = round(size * 0.60)           # doc height
    DX = (size - DW) // 2             # doc left edge (centered)
    DY = (size - DH) // 2 - max(0, round(size * 0.02))   # slightly above center
    F  = round(size * 0.14)           # fold triangle leg size

    for y in range(DY, DY + DH):
        for x in range(DX, DX + DW):
            lx = x - DX
            ly = y - DY
            # Top-right triangular cutout: remove when lx - ly > DW - F
            if lx - ly > DW - F:
                continue
            # Fold-crease shadow: the triangle that remains after the cut,
            # inside the top-right corner area — drawn in lavender
            if lx >= DW - F and ly <= F:
                img[y][x] = FOLD_CLR
            else:
                img[y][x] = WHITE

    # ── Text lines (only meaningful at ≥ 32 px) ────────────────────────────
    if size >= 32:
        lx0  = DX + round(DW * 0.16)
        lw_f = round(DW * 0.66)      # full-width line
        lw_s = round(DW * 0.44)      # shortened last line
        lh   = max(1, round(size * 0.028))
        lt0  = DY + round(DH * 0.41)
        lgap = round(DH * 0.158)

        for i in range(3):
            ry  = lt0 + i * lgap
            rw  = lw_s if i == 2 else lw_f
            for row in range(ry, min(ry + lh, DY + DH)):
                for col in range(lx0, min(lx0 + rw, DX + DW)):
                    if 0 <= row < size and 0 <= col < size:
                        lx = col - DX
                        ly = row - DY
                        # Only draw inside the document (not in the cutout)
                        if not (lx - ly > DW - F):
                            img[row][col] = LINE_CLR

    return img

# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------
script_dir = os.path.dirname(os.path.abspath(__file__))
icons_dir  = os.path.join(script_dir, 'icons')
os.makedirs(icons_dir, exist_ok=True)

for size in [16, 48, 128]:
    pixels = create_icon(size)
    data   = make_png(pixels, size)
    path   = os.path.join(icons_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Created icon{size}.png  ({len(data):,} bytes)')

print('Done!')

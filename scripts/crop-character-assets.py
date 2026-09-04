#!/usr/bin/env python3
"""
Crops the 4x5 (animal x stage) character growth sheet into 20 individual
square, centered, padded assets. Content-aware (projection-profile based)
rather than a naive fixed pixel grid, so slight irregularities in the
source sheet's layout don't clip ears/tails/props at cell edges.

Usage: python3 scripts/crop-character-assets.py
Input:  assets-source-character-growth-sheet.png.png (project root)
Output: public/characters/{animal}/stage-{1-5}.webp (20 files)
        _scratch-character-contact-sheet.png (visual review grid)
"""
import numpy as np
from PIL import Image
import os

SRC = "assets-source-character-growth-sheet.png.png"
OUT_SIZE = 512  # final square canvas, px
PAD_FRAC = 0.10  # extra padding around each detected character's own bbox
ANIMALS = ["rabbit", "fox", "otter", "panda"]  # row order top->bottom
STAGES = [1, 2, 3, 4, 5]  # column order left->right

img = Image.open(SRC).convert("RGB")
arr = np.asarray(img).astype(np.int16)
h, w, _ = arr.shape
print(f"source: {w}x{h}")

# "content" = any pixel that deviates from near-white by more than a small
# threshold (handles anti-aliasing noise without picking up JPEG-ish speckle).
diff = 255 - arr  # 0 where pure white
mask = (diff.max(axis=2) > 18)

row_density = mask.sum(axis=1)  # content pixels per row (y)
col_density = mask.sum(axis=0)  # content pixels per column (x)


def find_bands(density, min_gap=4, min_band=10):
    """Returns list of (start, end) index ranges where density > 0, merging
    across gaps shorter than min_gap, and dropping bands shorter than
    min_band (noise)."""
    bands = []
    in_band = False
    start = 0
    gap = 0
    for i, v in enumerate(density):
        if v > 0:
            if not in_band:
                start = i
                in_band = True
            gap = 0
        else:
            if in_band:
                gap += 1
                if gap > min_gap:
                    end = i - gap
                    if end - start >= min_band:
                        bands.append((start, end))
                    in_band = False
    if in_band:
        end = len(density) - 1
        if end - start >= min_band:
            bands.append((start, end))
    return bands


row_bands = find_bands(row_density, min_gap=2, min_band=20)
col_bands = find_bands(col_density, min_gap=6, min_band=20)
print(f"row bands ({len(row_bands)}): {row_bands}")
print(f"col bands ({len(col_bands)}): {col_bands}")

# The topmost row band is the "STAGE N" label strip, not a character row.
if len(row_bands) == 5:
    label_band, *char_row_bands = row_bands
    print(f"treating first row band as label strip: {label_band}")
else:
    char_row_bands = row_bands

if len(char_row_bands) != 4:
    raise SystemExit(f"expected 4 character row bands, got {len(char_row_bands)}: {char_row_bands}")
if len(col_bands) != 5:
    raise SystemExit(f"expected 5 column bands, got {len(col_bands)}: {col_bands}")


def bands_to_hard_ranges(bands, axis_len, outer_start, outer_end):
    """Converts detected content bands into non-overlapping cell search
    ranges, cut at the MIDPOINT of the gap between consecutive bands —
    never at each band's own (possibly slightly bleeding) raw extent. This
    is what actually prevents one row/column's stray edge pixels (e.g. an
    ear tip from the next row down) from being pulled into a neighboring
    cell's tight-bbox search."""
    ranges = []
    for i, (b0, b1) in enumerate(bands):
        lo = outer_start if i == 0 else (bands[i - 1][1] + b0) // 2
        hi = outer_end if i == len(bands) - 1 else (b1 + bands[i + 1][0]) // 2
        ranges.append((lo, hi))
    return ranges


# Rows: clip the top hard boundary to just below the label strip (if one was
# detected) rather than the image top, so label pixels can never be pulled
# into row 0's search range either.
row_outer_start = (label_band[1] + char_row_bands[0][0]) // 2 if len(row_bands) == 5 else 0
row_ranges = bands_to_hard_ranges(char_row_bands, h, row_outer_start, h - 1)
col_ranges = bands_to_hard_ranges(col_bands, w, 0, w - 1)
print(f"hard row ranges: {row_ranges}")
print(f"hard col ranges: {col_ranges}")

os.makedirs("_scratch_character_crops", exist_ok=True)
results = {}

for row_idx, (ry0, ry1) in enumerate(row_ranges):
    animal = ANIMALS[row_idx]
    for col_idx, (cx0, cx1) in enumerate(col_ranges):
        stage = STAGES[col_idx]
        # Tight bbox of actual content within this cell's projected region.
        cell_mask = mask[ry0:ry1 + 1, cx0:cx1 + 1]
        ys, xs = np.where(cell_mask)
        if len(xs) == 0:
            raise SystemExit(f"no content found for {animal} stage {stage} in cell rows {ry0}-{ry1}, cols {cx0}-{cx1}")
        bx0, bx1 = xs.min(), xs.max()
        by0, by1 = ys.min(), ys.max()
        # back to full-image coords
        bx0 += cx0; bx1 += cx0; by0 += ry0; by1 += ry0

        bw = bx1 - bx0
        bh = by1 - by0
        pad = int(round(max(bw, bh) * PAD_FRAC))
        # Clamp padding to this cell's own hard range, not just the whole
        # image — padding must never reach into a neighboring cell either.
        bx0 = max(cx0, bx0 - pad); bx1 = min(cx1, bx1 + pad)
        by0 = max(ry0, by0 - pad); by1 = min(ry1, by1 + pad)

        crop = img.crop((bx0, by0, bx1 + 1, by1 + 1))
        cw, ch = crop.size
        side = max(cw, ch)
        canvas = Image.new("RGB", (side, side), (255, 255, 255))
        canvas.paste(crop, ((side - cw) // 2, (side - ch) // 2))
        canvas = canvas.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)

        out_dir = f"public/characters/{animal}"
        os.makedirs(out_dir, exist_ok=True)
        out_path = f"{out_dir}/stage-{stage}.webp"
        canvas.save(out_path, "WEBP", quality=90, method=6)
        size_kb = os.path.getsize(out_path) / 1024
        print(f"{animal} stage {stage}: bbox=({bx0},{by0},{bx1},{by1}) size={cw}x{ch} -> {out_path} ({size_kb:.1f} KB)")
        results[(row_idx, col_idx)] = canvas

# Contact sheet for visual review: 5 cols x 4 rows, each cell OUT_SIZE//3
thumb = OUT_SIZE // 3
sheet = Image.new("RGB", (thumb * 5 + 6 * 10, thumb * 4 + 5 * 10), (240, 240, 240))
for (row_idx, col_idx), im in results.items():
    x = 10 + col_idx * (thumb + 10)
    y = 10 + row_idx * (thumb + 10)
    sheet.paste(im.resize((thumb, thumb), Image.LANCZOS), (x, y))
sheet.save("_scratch-character-contact-sheet.png")
print("\nWrote contact sheet: _scratch-character-contact-sheet.png")

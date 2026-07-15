#!/usr/bin/env python3
"""Regenerate deterministic Songjiang review derivatives.

Canonical input:
  sample-a.png (approved source artwork; never modified by this script)

Outputs:
  sample-b.png              cool muted ink/wash raster treatment
  sample-c.png              high-contrast clean cel raster treatment
  target-scale-preview.png  actual hall composite and target-pixel inspection strip

B and C always reuse A's alpha channel byte-for-byte. The target-scale sprite is
the alpha bounding box contained in a 66x66 transparent source/world review
frame for map zoom 1.0, using Pillow LANCZOS resampling. Across current runtime
zoom presets 0.84-1.25 this is approximately 55-83 CSS px; it is approximately
66 CSS px at zoom 1.0. The inspection strip enlarges that already-resized frame
by exactly 3x with NEAREST; it does not invent animation frames.

Run:
  python derive_review_assets.py
  python derive_review_assets.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import tempfile
from pathlib import Path

import numpy as np
import PIL
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


REVIEW_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = REVIEW_DIR.parents[3]
HALL_PATH = PROJECT_ROOT / "public/juyiting/images/liangshan-hall-base-clean-v3.png"
SOURCE_A = REVIEW_DIR / "sample-a.png"
OUTPUT_NAMES = ("sample-b.png", "sample-c.png", "target-scale-preview.png")

FRAME_SIZE = 66
MAP_SIZE = (1664, 928)
INSPECTION_HEIGHT = 360
PREVIEW_SIZE = (MAP_SIZE[0], MAP_SIZE[1] + INSPECTION_HEIGHT)
REQUIRED_PILLOW_VERSION = "12.2.0"
REQUIRED_NUMPY_VERSION = "2.4.2"


def derive_b_and_c(source_a: Path, output_dir: Path) -> tuple[Path, Path]:
    """Create B/C from A while preserving A's exact alpha bytes."""
    base = Image.open(source_a).convert("RGBA")
    rgb = base.convert("RGB")
    alpha = base.getchannel("A")
    width, height = base.size

    # B: reduce fine detail by 2x LANCZOS downsampling, BICUBIC restoration,
    # and radius-0.75 Gaussian blur. Map luminance through a cool three-stop
    # ink palette, retain 22% muted source hue, add seeded multi-scale wash
    # variation, interrupt strong ink accents with that texture, and lighten
    # a four-pixel interior edge band. Alpha is merged back unchanged.
    b_soft = rgb.resize(
        (width // 2, height // 2), Image.Resampling.LANCZOS,
    ).resize((width, height), Image.Resampling.BICUBIC)
    b_soft = b_soft.filter(ImageFilter.GaussianBlur(0.75))
    source = np.asarray(b_soft, dtype=np.float32)
    luminance = source[..., 0] * 0.299 + source[..., 1] * 0.587 + source[..., 2] * 0.114
    shadow = np.array([29, 39, 47], dtype=np.float32)
    middle = np.array([102, 113, 119], dtype=np.float32)
    light = np.array([205, 207, 194], dtype=np.float32)
    normalized = (luminance / 255.0)[..., None]
    low_ramp = shadow + (middle - shadow) * np.minimum(normalized * 2.0, 1.0)
    high_ramp = middle + (light - middle) * np.maximum((normalized - 0.5) * 2.0, 0.0)
    wash = np.where(normalized <= 0.5, low_ramp, high_ramp)
    muted_source = luminance[..., None] * 0.78 + source * 0.22
    b_pixels = wash * 0.78 + muted_source * 0.22

    rng = np.random.default_rng(250715)
    noise_small = rng.normal(
        0, 1, (max(2, height // 48), max(2, width // 48)),
    ).astype(np.float32)
    noise_range = float(np.ptp(noise_small)) or 1.0
    noise_image = Image.fromarray(
        np.uint8(np.clip((noise_small - noise_small.min()) / noise_range * 255, 0, 255)),
        "L",
    )
    noise = (
        np.asarray(noise_image.resize((width, height), Image.Resampling.BICUBIC), dtype=np.float32)
        / 255.0
        - 0.5
    )
    b_pixels += noise[..., None] * 18.0
    edges = np.asarray(
        ImageOps.grayscale(b_soft)
        .filter(ImageFilter.FIND_EDGES)
        .filter(ImageFilter.GaussianBlur(0.55)),
        dtype=np.float32,
    ) / 255.0
    broken = (noise > -0.06).astype(np.float32)
    ink = np.clip((edges - 0.16) * 1.45, 0, 0.58) * broken
    b_pixels *= 1.0 - ink[..., None]

    alpha_pixels = np.asarray(alpha, dtype=np.uint8)
    inside = Image.fromarray(np.where(alpha_pixels > 0, 255, 0).astype(np.uint8), "L")
    eroded = inside.filter(ImageFilter.MinFilter(9))
    edge_band = (
        np.asarray(inside, dtype=np.float32) - np.asarray(eroded, dtype=np.float32)
    ) / 255.0
    b_pixels = (
        b_pixels * (1.0 - edge_band[..., None] * 0.16)
        + light * (edge_band[..., None] * 0.16)
    )
    b_rgb = Image.fromarray(np.uint8(np.clip(b_pixels, 0, 255)), "RGB")
    b_path = output_dir / "sample-b.png"
    Image.merge("RGBA", (*b_rgb.split(), alpha)).save(b_path, format="PNG", optimize=True)

    # C: reduce painterly micro-detail by 3x LANCZOS downsampling, BICUBIC
    # restoration, and a 3x3 median filter. Apply 1.28 contrast and 1.32 color,
    # quantize to an 18-color median-cut palette without dithering, reinforce
    # major contours with dark ink, then posterize RGB to five bits/channel.
    # Alpha is merged back unchanged.
    c_smooth = rgb.resize(
        (width // 3, height // 3), Image.Resampling.LANCZOS,
    ).resize((width, height), Image.Resampling.BICUBIC)
    c_smooth = c_smooth.filter(ImageFilter.MedianFilter(3))
    c_smooth = ImageEnhance.Contrast(c_smooth).enhance(1.28)
    c_smooth = ImageEnhance.Color(c_smooth).enhance(1.32)
    c_flat = c_smooth.quantize(
        colors=18,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    ).convert("RGB")
    c_pixels = np.asarray(c_flat, dtype=np.float32)
    major_edges = np.asarray(
        ImageOps.grayscale(c_smooth)
        .filter(ImageFilter.FIND_EDGES)
        .filter(ImageFilter.GaussianBlur(0.35)),
        dtype=np.float32,
    ) / 255.0
    outline = np.clip((major_edges - 0.24) * 2.2, 0, 0.72)
    outline *= (alpha_pixels >= 48).astype(np.float32)
    ink_color = np.array([20, 22, 27], dtype=np.float32)
    c_pixels = c_pixels * (1.0 - outline[..., None]) + ink_color * outline[..., None]
    c_rgb = ImageOps.posterize(
        Image.fromarray(np.uint8(np.clip(c_pixels, 0, 255)), "RGB"),
        5,
    )
    c_path = output_dir / "sample-c.png"
    Image.merge("RGBA", (*c_rgb.split(), alpha)).save(c_path, format="PNG", optimize=True)

    assert Image.open(b_path).getchannel("A").tobytes() == alpha.tobytes()
    assert Image.open(c_path).getchannel("A").tobytes() == alpha.tobytes()
    return b_path, c_path


def target_frame(path: Path) -> Image.Image:
    """Contain the subject in a 66x66 source/world frame for map zoom 1.0."""
    source = Image.open(path).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"No visible pixels in {path}")
    subject = source.crop(bounds)
    subject.thumbnail((FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    frame.alpha_composite(
        subject,
        ((FRAME_SIZE - subject.width) // 2, FRAME_SIZE - subject.height),
    )
    return frame


def default_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, size: int = 18) -> None:
    x, y = xy
    font = default_font(size)
    box = draw.textbbox((x, y), text, font=font, stroke_width=2)
    draw.rounded_rectangle(
        (box[0] - 5, box[1] - 3, box[2] + 5, box[3] + 3),
        radius=4,
        fill=(15, 18, 20, 220),
    )
    draw.text((x, y), text, font=font, fill=(246, 229, 181, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))


def render_preview(source_a: Path, source_b: Path, source_c: Path, output_path: Path) -> None:
    hall = Image.open(HALL_PATH).convert("RGBA")
    if hall.size != MAP_SIZE:
        raise ValueError(f"Expected hall {MAP_SIZE}, found {hall.size}")
    frames = {
        "A": target_frame(source_a),
        "B": target_frame(source_b),
        "C": target_frame(source_c),
    }
    preview = Image.new("RGBA", PREVIEW_SIZE, (24, 25, 27, 255))
    preview.alpha_composite(hall, (0, 0))
    draw = ImageDraw.Draw(preview, "RGBA")

    draw.rounded_rectangle((18, 16, 1000, 72), radius=10, fill=(12, 14, 16, 220))
    draw.text(
        (34, 26),
        "Songjiang review | 66x66 world frame @ zoom 1.0 (~55-83 CSS px)",
        font=default_font(22),
        fill=(250, 236, 199, 255),
    )

    # Multiple A instances in representative main-seat, west-floor, and
    # east-floor positions. These are repeated static samples, not animation.
    a_positions = [
        (840, 356, "A / main seat"),
        (654, 570, "A / west floor"),
        (1110, 570, "A / east floor"),
    ]
    for center_x, bottom_y, text in a_positions:
        preview.alpha_composite(frames["A"], (center_x - FRAME_SIZE // 2, bottom_y - FRAME_SIZE))
        label(draw, (center_x - 48, bottom_y - FRAME_SIZE - 28), text, 15)

    # Side-by-side official comparison, each inside a 66x66 source/world review
    # outline at zoom 1.0. The overlays are not runtime UI.
    comparison = [(760, 704, "A"), (880, 704, "B"), (1000, 704, "C")]
    for center_x, bottom_y, key in comparison:
        left = center_x - FRAME_SIZE // 2
        top = bottom_y - FRAME_SIZE
        draw.rectangle((left - 1, top - 1, left + FRAME_SIZE, top + FRAME_SIZE), outline=(246, 229, 181, 230), width=2)
        preview.alpha_composite(frames[key], (left, top))
        label(draw, (center_x - 35, top - 30), f"{key} 66 world", 16)

    strip_top = MAP_SIZE[1]
    draw.rectangle((0, strip_top, PREVIEW_SIZE[0], PREVIEW_SIZE[1]), fill=(24, 25, 27, 255))
    draw.line((0, strip_top, PREVIEW_SIZE[0], strip_top), fill=(205, 173, 102, 255), width=3)
    draw.text(
        (34, strip_top + 18),
        "3x NEAREST inspection of 66x66 world frames (static samples; no animation implied)",
        font=default_font(21),
        fill=(250, 236, 199, 255),
    )

    panel_width = 300
    gap = 60
    total_width = panel_width * 3 + gap * 2
    first_x = (PREVIEW_SIZE[0] - total_width) // 2
    for index, key in enumerate(("A", "B", "C")):
        x = first_x + index * (panel_width + gap)
        y = strip_top + 72
        draw.rounded_rectangle((x, y, x + panel_width, y + 252), radius=12, fill=(43, 44, 46, 255), outline=(110, 95, 64, 255), width=2)
        enlarged = frames[key].resize((FRAME_SIZE * 3, FRAME_SIZE * 3), Image.Resampling.NEAREST)
        # Neutral checkerboard exists only in the separated inspection strip.
        checker = Image.new("RGBA", enlarged.size, (224, 224, 220, 255))
        checker_draw = ImageDraw.Draw(checker)
        cell = 12
        for cy in range(0, checker.height, cell):
            for cx in range(0, checker.width, cell):
                if (cx // cell + cy // cell) % 2:
                    checker_draw.rectangle((cx, cy, cx + cell - 1, cy + cell - 1), fill=(190, 190, 186, 255))
        checker.alpha_composite(enlarged)
        preview.alpha_composite(checker, (x + (panel_width - checker.width) // 2, y + 14))
        draw.text(
            (x + 20, y + 220),
            f"Official {key}: 66 world frame x3",
            font=default_font(15),
            fill=(240, 230, 204, 255),
        )

    preview.convert("RGB").save(output_path, format="PNG", optimize=True)


def generate(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    b_path, c_path = derive_b_and_c(SOURCE_A, output_dir)
    render_preview(SOURCE_A, b_path, c_path, output_dir / "target-scale-preview.png")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_byte_toolchain() -> None:
    problems = []
    if PIL.__version__ != REQUIRED_PILLOW_VERSION:
        problems.append(f"Pillow {REQUIRED_PILLOW_VERSION} (found {PIL.__version__})")
    if np.__version__ != REQUIRED_NUMPY_VERSION:
        problems.append(f"NumPy {REQUIRED_NUMPY_VERSION} (found {np.__version__})")
    if problems:
        raise SystemExit("Byte-for-byte --check requires " + " and ".join(problems) + ".")


def check() -> None:
    require_byte_toolchain()
    with tempfile.TemporaryDirectory(prefix="songjiang-review-") as temporary:
        generated_dir = Path(temporary)
        generate(generated_dir)
        for name in OUTPUT_NAMES:
            generated = generated_dir / name
            committed = REVIEW_DIR / name
            if generated.read_bytes() != committed.read_bytes():
                raise SystemExit(f"MISMATCH: {name}")
            print(f"PASS {name} {sha256(committed)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check", action="store_true",
        help=("regenerate and compare bytes; requires Pillow "
              f"{REQUIRED_PILLOW_VERSION} and NumPy {REQUIRED_NUMPY_VERSION}"),
    )
    args = parser.parse_args()
    if args.check:
        check()
    else:
        generate(REVIEW_DIR)
        for name in OUTPUT_NAMES:
            print(f"WROTE {name} {sha256(REVIEW_DIR / name)}")


if __name__ == "__main__":
    main()

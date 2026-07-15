#!/usr/bin/env python3
"""Regenerate the 45-degree vs 55-degree Songjiang hall comparison.

This script treats the two transparent camera-angle samples as read-only source
art. It only crops/resizes/composites them onto the committed hall image.

Run:
  python derive_camera_angle_preview.py
  python derive_camera_angle_preview.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REVIEW_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = REVIEW_DIR.parents[3]
HALL_PATH = PROJECT_ROOT / "public/juyiting/images/liangshan-hall-base-clean-v3.png"
SOURCE_45 = REVIEW_DIR / "sample-a-2_5d-45-v1.png"
SOURCE_55 = REVIEW_DIR / "sample-a-2_5d-55-v1.png"
OUTPUT_NAME = "sample-a-2_5d-45-55-hall-preview-v1.png"
OUTPUT_PATH = REVIEW_DIR / OUTPUT_NAME

FRAME_SIZE = 66
SUBJECT_MAX = 64
PREVIEW_SIZE = (1664, 1260)


def target_frame(source_path: Path) -> Image.Image:
    """Bottom-center the visible source subject in an exact 66x66 frame."""
    source = Image.open(source_path).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"No visible subject in {source_path}")
    subject = source.crop(bounds)
    subject.thumbnail((SUBJECT_MAX, SUBJECT_MAX), Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    frame.alpha_composite(subject, ((FRAME_SIZE - subject.width) // 2, 65 - subject.height))
    return frame


def render(output_path: Path) -> None:
    hall = Image.open(HALL_PATH).convert("RGBA")
    width, hall_height = hall.size
    if hall.size != (1664, 928):
        raise ValueError(f"Expected 1664x928 hall, found {hall.size}")

    frames = {
        "45 deg": target_frame(SOURCE_45),
        "55 deg": target_frame(SOURCE_55),
    }
    canvas = Image.new("RGBA", PREVIEW_SIZE, (24, 25, 27, 255))
    canvas.alpha_composite(hall)
    draw = ImageDraw.Draw(canvas, "RGBA")
    font = lambda size: ImageFont.load_default(size=size)

    def label(x: int, y: int, text: str, size: int = 16) -> None:
        bounds = draw.textbbox((x, y), text, font=font(size), stroke_width=2)
        draw.rounded_rectangle(
            (bounds[0] - 6, bounds[1] - 4, bounds[2] + 6, bounds[3] + 4),
            5,
            fill=(12, 14, 16, 225),
        )
        draw.text(
            (x, y), text, font=font(size), fill=(250, 236, 199, 255),
            stroke_width=2, stroke_fill=(0, 0, 0, 255),
        )

    draw.rounded_rectangle((18, 16, 830, 72), 10, fill=(12, 14, 16, 225))
    draw.text(
        (34, 26),
        "Songjiang H style | 45-degree vs 55-degree | exact 66x66 hall test",
        font=font(23),
        fill=(250, 236, 199, 255),
    )

    # Same-depth hall placements, each using the exact 66x66 frame.
    for center_x, bottom_y, key in [
        (760, 356, "45 deg"),
        (920, 356, "55 deg"),
        (654, 570, "45 deg"),
        (1110, 570, "55 deg"),
    ]:
        canvas.alpha_composite(frames[key], (center_x - 33, bottom_y - 66))
        label(center_x - 36, bottom_y - 95, key, 16)

    # Explicit frame outlines make the exact runtime-scale comparison auditable.
    for center_x, key in [(780, "45 deg"), (900, "55 deg")]:
        bottom_y = 704
        draw.rectangle(
            (center_x - 34, bottom_y - 67, center_x + 33, bottom_y),
            outline=(246, 229, 181, 230),
            width=2,
        )
        canvas.alpha_composite(frames[key], (center_x - 33, bottom_y - 66))
        label(center_x - 58, bottom_y - 96, f"{key} 66x66", 16)

    # Review-only inspection strip: enlarge the already-created target frame
    # exactly 3x with NEAREST. This is not a source-art rerender or animation.
    strip_top = hall_height
    draw.rectangle((0, strip_top, width, 1260), fill=(24, 25, 27, 255))
    draw.line((0, strip_top, width, strip_top), fill=(205, 173, 102, 255), width=3)
    draw.text(
        (34, 948),
        "Camera-angle comparison at 3x (review aid; hall placements above are exact runtime scale)",
        font=font(22),
        fill=(250, 236, 199, 255),
    )
    for center_x, key, description in [
        (480, "45 deg", "45-degree: balanced top-down"),
        (1184, "55 deg", "55-degree: stronger top-down"),
    ]:
        draw.rounded_rectangle(
            (center_x - 230, 995, center_x + 230, 1240),
            12,
            fill=(43, 44, 46, 255),
            outline=(110, 95, 64, 255),
            width=2,
        )
        enlarged = frames[key].resize((198, 198), Image.Resampling.NEAREST)
        checker = Image.new("RGBA", enlarged.size, (224, 224, 220, 255))
        checker_draw = ImageDraw.Draw(checker)
        for y in range(0, 198, 12):
            for x in range(0, 198, 12):
                if (x // 12 + y // 12) % 2:
                    checker_draw.rectangle((x, y, x + 11, y + 11), fill=(190, 190, 186, 255))
        checker.alpha_composite(enlarged)
        canvas.alpha_composite(checker, (center_x - 99, 1004))
        text_width = draw.textbbox((0, 0), description, font=font(17))[2]
        draw.text(
            (center_x - text_width // 2, 1212),
            description,
            font=font(17),
            fill=(240, 230, 204, 255),
        )

    canvas.convert("RGB").save(output_path, format="PNG", optimize=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check() -> None:
    with tempfile.TemporaryDirectory(prefix="songjiang-camera-review-") as temporary:
        generated = Path(temporary) / OUTPUT_NAME
        render(generated)
        if generated.read_bytes() != OUTPUT_PATH.read_bytes():
            raise SystemExit(f"MISMATCH: {OUTPUT_NAME}")
    print(f"PASS {OUTPUT_NAME} {sha256(OUTPUT_PATH)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="regenerate in a temp directory and compare bytes")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        render(OUTPUT_PATH)
        print(f"WROTE {OUTPUT_NAME} {sha256(OUTPUT_PATH)}")


if __name__ == "__main__":
    main()

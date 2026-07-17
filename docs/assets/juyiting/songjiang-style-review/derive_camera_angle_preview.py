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
SOURCE_SHA256 = {
    SOURCE_45: "38e45ae50d8c4908c98f5436599a08027870f3d74c80db19ebeb17fc7e647904",
    SOURCE_55: "6109be7d51cd19f2bd93304a064309b11cbc7718365a35d3ea327b60bd5d0d47",
    HALL_PATH: "94b581a98fe6b16ea4d200936384efc1d975cf8892c75b2e9151fc8bcf510966",
}


def target_frame(source_path: Path) -> Image.Image:
    """Bottom-center the subject in a 66x66 source/world frame for zoom 1.0."""
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
    require_canonical_sources()
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

    draw.rounded_rectangle((18, 16, 1080, 72), 10, fill=(12, 14, 16, 225))
    draw.text(
        (34, 26),
        "45-degree vs 55-degree | 66x66 world frame @ zoom 1.0 (~55-83 CSS px)",
        font=font(22),
        fill=(250, 236, 199, 255),
    )

    # Same-depth hall placements, each using a 66x66 source/world frame at
    # map zoom 1.0. Runtime CSS size varies with camera zoom.
    for center_x, bottom_y, key in [
        (760, 356, "45 deg"),
        (920, 356, "55 deg"),
        (654, 570, "45 deg"),
        (1110, 570, "55 deg"),
    ]:
        canvas.alpha_composite(frames[key], (center_x - 33, bottom_y - 66))
        label(center_x - 36, bottom_y - 95, key, 16)

    # Explicit outlines make the 66x66 source/world frame auditable.
    for center_x, key in [(780, "45 deg"), (900, "55 deg")]:
        bottom_y = 704
        draw.rectangle(
            (center_x - 34, bottom_y - 67, center_x + 33, bottom_y),
            outline=(246, 229, 181, 230),
            width=2,
        )
        canvas.alpha_composite(frames[key], (center_x - 33, bottom_y - 66))
        label(center_x - 48, bottom_y - 96, f"{key[:2]}: 66 world", 14)

    # Review-only inspection strip: enlarge the already-created target frame
    # exactly 3x with NEAREST. This is not a source-art rerender or animation.
    strip_top = hall_height
    draw.rectangle((0, strip_top, width, 1260), fill=(24, 25, 27, 255))
    draw.line((0, strip_top, width, strip_top), fill=(205, 173, 102, 255), width=3)
    draw.text(
        (34, 948),
        "3x review aid | 66 world px = ~55-83 CSS px at zoom 0.84-1.25 (~66 CSS at 1.0)",
        font=font(21),
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


def require_canonical_sources() -> None:
    for path, expected in SOURCE_SHA256.items():
        actual = sha256(path)
        if actual != expected:
            raise SystemExit(f"Canonical source SHA-256 mismatch: {path.name}: {actual}")


def compare_decoded_png(generated_path: Path, committed_path: Path) -> None:
    with Image.open(generated_path) as generated, Image.open(committed_path) as committed:
        generated.load()
        committed.load()
        if generated.size != committed.size:
            raise SystemExit(
                f"MISMATCH {committed_path.name}: size {generated.size} != {committed.size}"
            )
        if generated.mode != committed.mode:
            raise SystemExit(
                f"MISMATCH {committed_path.name}: mode {generated.mode} != {committed.mode}"
            )
        if generated.tobytes() != committed.tobytes():
            raise SystemExit(f"MISMATCH {committed_path.name}: decoded pixel/channel bytes differ")


def check() -> None:
    with tempfile.TemporaryDirectory(prefix="songjiang-camera-review-") as temporary:
        generated = Path(temporary) / OUTPUT_NAME
        render(generated)
        compare_decoded_png(generated, OUTPUT_PATH)
    with Image.open(OUTPUT_PATH) as committed:
        print(f"PASS {OUTPUT_NAME} decoded-pixels mode={committed.mode} size={committed.size}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check", action="store_true",
        help="regenerate and compare decoded image size, mode, and pixel/channel bytes",
    )
    args = parser.parse_args()
    if args.check:
        check()
    else:
        render(OUTPUT_PATH)
        print(f"WROTE {OUTPUT_NAME} {sha256(OUTPUT_PATH)}")


if __name__ == "__main__":
    main()

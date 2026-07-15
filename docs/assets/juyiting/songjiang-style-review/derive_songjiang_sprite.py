#!/usr/bin/env python3
"""Derive the production 8x2 Songjiang sheet from the canonical 4x4 source."""

from __future__ import annotations

import argparse
import hashlib
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = HERE / "songjiang-animation-source-4x4.png"
OUTPUT = ROOT / "public/juyiting/sprites/persona-sheets-v1/songjiang.png"
SOURCE_SHA256 = "f6a70526ffe4116a6cc4bcf47a0173cbdc24ca6f517d85e4c9d3b835a5c12e1c"
FRAME_SIZE = 128
SUBJECT_HEIGHT = 118
TOP_PADDING = 4


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rounded_grid_edges(length: int, cells: int) -> list[int]:
    # Python's round-to-even behavior is part of the committed derivation.
    return [round(index * length / cells) for index in range(cells + 1)]


def derive(destination: Path) -> list[tuple[int, int, int, int]]:
    if sha256(SOURCE) != SOURCE_SHA256:
        raise RuntimeError("canonical 4x4 Songjiang source hash changed")

    source = Image.open(SOURCE).convert("RGBA")
    x_edges = rounded_grid_edges(source.width, 4)
    y_edges = rounded_grid_edges(source.height, 4)
    sheet = Image.new("RGBA", (FRAME_SIZE * 8, FRAME_SIZE * 2), (0, 0, 0, 0))

    for index in range(16):
        source_column = index % 4
        source_row = index // 4
        frame = source.crop((
            x_edges[source_column], y_edges[source_row],
            x_edges[source_column + 1], y_edges[source_row + 1],
        ))
        alpha_bounds = frame.getchannel("A").getbbox()
        if alpha_bounds is None:
            raise RuntimeError(f"source frame {index} has no visible pixels")
        frame = frame.crop(alpha_bounds)
        target_width = round(frame.width * SUBJECT_HEIGHT / frame.height)
        if target_width <= 0 or target_width >= FRAME_SIZE:
            raise RuntimeError(f"source frame {index} cannot fit the 128x128 runtime cell")
        frame = frame.resize((target_width, SUBJECT_HEIGHT), Image.Resampling.LANCZOS)
        target_x = (index % 8) * FRAME_SIZE + (FRAME_SIZE - target_width) // 2
        target_y = (index // 8) * FRAME_SIZE + TOP_PADDING
        sheet.alpha_composite(frame, (target_x, target_y))

    bounds = validate_frame_alpha(sheet)
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, format="PNG", optimize=False, compress_level=9)
    return bounds


def validate_frame_alpha(sheet: Image.Image) -> list[tuple[int, int, int, int]]:
    if sheet.mode != "RGBA" or sheet.size != (1024, 256):
        raise RuntimeError(f"production sheet must be RGBA 1024x256; received {sheet.mode} {sheet.size}")
    bounds: list[tuple[int, int, int, int]] = []
    for index in range(16):
        x = (index % 8) * FRAME_SIZE
        y = (index // 8) * FRAME_SIZE
        frame_bounds = sheet.crop((x, y, x + FRAME_SIZE, y + FRAME_SIZE)).getchannel("A").getbbox()
        if frame_bounds is None:
            raise RuntimeError(f"production frame {index} has no visible alpha")
        left, top, right, bottom = frame_bounds
        if left <= 0 or top <= 0 or right >= FRAME_SIZE or bottom >= FRAME_SIZE:
            raise RuntimeError(f"production frame {index} touches a cell edge: {frame_bounds}")
        bounds.append((left, top, right - 1, bottom - 1))
    return bounds


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="compare derived decoded pixels with the committed sheet")
    args = parser.parse_args()

    if args.check:
        with tempfile.TemporaryDirectory(prefix="juyiting-songjiang-") as temporary:
            candidate = Path(temporary) / "songjiang.png"
            bounds = derive(candidate)
            committed = Image.open(OUTPUT).convert("RGBA")
            generated = Image.open(candidate).convert("RGBA")
            if committed.size != generated.size or ImageChops.difference(committed, generated).getbbox() is not None:
                raise RuntimeError("committed Songjiang sheet differs from deterministic derivation")
    else:
        bounds = derive(OUTPUT)

    for index, frame_bounds in enumerate(bounds):
        print(f"frame {index:02d} alpha bounds: {frame_bounds}")
    print("Songjiang sprite derivation check passed" if args.check else f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI boundary
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

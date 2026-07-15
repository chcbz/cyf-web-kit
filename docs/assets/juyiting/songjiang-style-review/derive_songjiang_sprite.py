#!/usr/bin/env python3
"""Derive the production 8x2 Songjiang sheet from the canonical 4x4 source."""

from __future__ import annotations

import argparse
import hashlib
import sys
import tempfile
from dataclasses import dataclass
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
MAX_SOURCE_DETACHED_RATIO = 0.06
MAX_RESAMPLE_DETACHED_RATIO = 0.005
MIN_WALK_SOURCE_SCALE = 0.44
MAX_WALK_SOURCE_SCALE = 0.51
MAX_WALK_SCALE_RATIO = 1.12
MIN_WALK_OUTPUT_HEIGHT = 116
MAX_WALK_OUTPUT_HEIGHT = 120
MAX_WALK_OUTPUT_HEIGHT_DELTA = 2


@dataclass(frozen=True)
class Component:
    pixels: tuple[tuple[int, int], ...]
    bounds: tuple[int, int, int, int]

    @property
    def area(self) -> int:
        return len(self.pixels)


@dataclass(frozen=True)
class FrameMetric:
    index: int
    alpha_bounds: tuple[int, int, int, int]
    source_component_count: int
    source_main_area: int
    source_detached_area: int
    source_detached_ratio: float
    source_subject_height: int
    source_scale: float
    output_component_count: int
    output_main_area: int
    output_subject_height: int


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rounded_grid_edges(length: int, cells: int) -> list[int]:
    # Python's round-to-even behavior is part of the committed derivation.
    return [round(index * length / cells) for index in range(cells + 1)]


def alpha_components(alpha: Image.Image) -> list[Component]:
    width, height = alpha.size
    pixels = alpha.load()
    visited: set[tuple[int, int]] = set()
    components: list[Component] = []
    neighbours = (
        (-1, -1), (0, -1), (1, -1),
        (-1, 0),           (1, 0),
        (-1, 1),  (0, 1),  (1, 1),
    )

    for y in range(height):
        for x in range(width):
            if (x, y) in visited or pixels[x, y] == 0:
                continue
            stack = [(x, y)]
            visited.add((x, y))
            component_pixels: list[tuple[int, int]] = []
            min_x = max_x = x
            min_y = max_y = y
            while stack:
                current_x, current_y = stack.pop()
                component_pixels.append((current_x, current_y))
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)
                for delta_x, delta_y in neighbours:
                    next_x = current_x + delta_x
                    next_y = current_y + delta_y
                    point = (next_x, next_y)
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    if point in visited or pixels[next_x, next_y] == 0:
                        continue
                    visited.add(point)
                    stack.append(point)
            components.append(Component(
                pixels=tuple(component_pixels),
                bounds=(min_x, min_y, max_x + 1, max_y + 1),
            ))

    return sorted(components, key=lambda component: component.area, reverse=True)


def isolate_main_component(
    frame: Image.Image,
    index: int,
    context: str,
    maximum_detached_ratio: float,
) -> tuple[Image.Image, list[Component]]:
    components = alpha_components(frame.getchannel("A"))
    if not components:
        raise RuntimeError(f"{context} frame {index} has no visible pixels")
    main = components[0]
    detached_area = sum(component.area for component in components[1:])
    detached_ratio = detached_area / main.area
    if detached_ratio > maximum_detached_ratio:
        raise RuntimeError(
            f"{context} frame {index} detached alpha ratio {detached_ratio:.4f} exceeds "
            f"{maximum_detached_ratio:.4f}",
        )

    membership = Image.new("1", frame.size, 0)
    membership_pixels = membership.load()
    for x, y in main.pixels:
        membership_pixels[x, y] = 1
    cleaned = Image.composite(frame, Image.new("RGBA", frame.size, (0, 0, 0, 0)), membership)
    return cleaned, components


def retain_main_component(frame: Image.Image, index: int) -> tuple[Image.Image, list[Component]]:
    cleaned, components = isolate_main_component(
        frame, index, "source", MAX_SOURCE_DETACHED_RATIO,
    )
    return cleaned.crop(components[0].bounds), components


def derive(destination: Path) -> list[FrameMetric]:
    if sha256(SOURCE) != SOURCE_SHA256:
        raise RuntimeError("canonical 4x4 Songjiang source hash changed")

    source = Image.open(SOURCE).convert("RGBA")
    x_edges = rounded_grid_edges(source.width, 4)
    y_edges = rounded_grid_edges(source.height, 4)
    sheet = Image.new("RGBA", (FRAME_SIZE * 8, FRAME_SIZE * 2), (0, 0, 0, 0))
    source_metrics: list[tuple[list[Component], int, float]] = []

    for index in range(16):
        source_column = index % 4
        source_row = index // 4
        source_frame = source.crop((
            x_edges[source_column], y_edges[source_row],
            x_edges[source_column + 1], y_edges[source_row + 1],
        ))
        frame, components = retain_main_component(source_frame, index)
        source_subject_height = frame.height
        source_scale = SUBJECT_HEIGHT / source_subject_height
        target_width = round(frame.width * source_scale)
        if target_width <= 0 or target_width >= FRAME_SIZE:
            raise RuntimeError(f"source frame {index} cannot fit the 128x128 runtime cell")
        frame = frame.resize((target_width, SUBJECT_HEIGHT), Image.Resampling.LANCZOS)
        frame, _resized_components = isolate_main_component(
            frame, index, "resized", MAX_RESAMPLE_DETACHED_RATIO,
        )
        target_x = (index % 8) * FRAME_SIZE + (FRAME_SIZE - target_width) // 2
        target_y = (index // 8) * FRAME_SIZE + TOP_PADDING
        sheet.alpha_composite(frame, (target_x, target_y))
        source_metrics.append((components, source_subject_height, source_scale))

    metrics = validate_frame_alpha(sheet, source_metrics)
    validate_walk_consistency(metrics)
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, format="PNG", optimize=False, compress_level=9)
    return metrics


def validate_frame_alpha(
    sheet: Image.Image,
    source_metrics: list[tuple[list[Component], int, float]],
) -> list[FrameMetric]:
    if sheet.mode != "RGBA" or sheet.size != (1024, 256):
        raise RuntimeError(f"production sheet must be RGBA 1024x256; received {sheet.mode} {sheet.size}")
    metrics: list[FrameMetric] = []
    for index in range(16):
        x = (index % 8) * FRAME_SIZE
        y = (index // 8) * FRAME_SIZE
        frame = sheet.crop((x, y, x + FRAME_SIZE, y + FRAME_SIZE))
        components = alpha_components(frame.getchannel("A"))
        if not components:
            raise RuntimeError(f"production frame {index} has no visible alpha")
        if len(components) != 1:
            areas = [component.area for component in components]
            raise RuntimeError(f"production frame {index} contains detached alpha components: {areas}")
        left, top, right, bottom = components[0].bounds
        if left <= 0 or top <= 0 or right >= FRAME_SIZE or bottom >= FRAME_SIZE:
            raise RuntimeError(f"production frame {index} touches a cell edge: {components[0].bounds}")
        source_components, source_subject_height, source_scale = source_metrics[index]
        detached_area = sum(component.area for component in source_components[1:])
        metrics.append(FrameMetric(
            index=index,
            alpha_bounds=(left, top, right - 1, bottom - 1),
            source_component_count=len(source_components),
            source_main_area=source_components[0].area,
            source_detached_area=detached_area,
            source_detached_ratio=detached_area / source_components[0].area,
            source_subject_height=source_subject_height,
            source_scale=source_scale,
            output_component_count=len(components),
            output_main_area=components[0].area,
            output_subject_height=bottom - top,
        ))
    return metrics


def validate_walk_consistency(metrics: list[FrameMetric]) -> None:
    walk = metrics[8:16]
    heights = [metric.output_subject_height for metric in walk]
    scales = [metric.source_scale for metric in walk]
    if min(heights) < MIN_WALK_OUTPUT_HEIGHT or max(heights) > MAX_WALK_OUTPUT_HEIGHT:
        raise RuntimeError(f"walk output subject heights are outside bounds: {heights}")
    if max(heights) - min(heights) > MAX_WALK_OUTPUT_HEIGHT_DELTA:
        raise RuntimeError(f"walk output subject height delta is too large: {heights}")
    if min(scales) < MIN_WALK_SOURCE_SCALE or max(scales) > MAX_WALK_SOURCE_SCALE:
        raise RuntimeError(f"walk source-to-runtime scales are outside bounds: {scales}")
    if max(scales) / min(scales) > MAX_WALK_SCALE_RATIO:
        raise RuntimeError(f"walk source-to-runtime scale ratio is inconsistent: {scales}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="compare derived decoded pixels with the committed sheet")
    args = parser.parse_args()

    if args.check:
        with tempfile.TemporaryDirectory(prefix="juyiting-songjiang-") as temporary:
            candidate = Path(temporary) / "songjiang.png"
            metrics = derive(candidate)
            committed = Image.open(OUTPUT).convert("RGBA")
            generated = Image.open(candidate).convert("RGBA")
            if committed.size != generated.size or ImageChops.difference(committed, generated).getbbox() is not None:
                raise RuntimeError("committed Songjiang sheet differs from deterministic derivation")
    else:
        metrics = derive(OUTPUT)

    for metric in metrics:
        print(
            f"frame {metric.index:02d}: bounds={metric.alpha_bounds} "
            f"source-components={metric.source_component_count} "
            f"main-area={metric.source_main_area} detached-area={metric.source_detached_area} "
            f"detached-ratio={metric.source_detached_ratio:.4f} "
            f"source-height={metric.source_subject_height} scale={metric.source_scale:.4f} "
            f"output-components={metric.output_component_count} "
            f"output-area={metric.output_main_area} output-height={metric.output_subject_height}",
        )
    print("Songjiang sprite derivation check passed" if args.check else f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI boundary
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

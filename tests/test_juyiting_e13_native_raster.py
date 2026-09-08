#!/usr/bin/env python3
"""Byte-exact differential checks for the optional E13 C rasterizer."""
import os
import random
import sys
import unittest
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/juyiting/e13'))

from offline_pixel_renderer.compositor import PixelBuffer, sequential_float_sum
from offline_pixel_renderer.native_raster import blit_region as native_blit_region, native_available, test_rounding_api


class NativeRasterEquivalenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get('E13_REFERENCE_RASTER') == '1':
            if REQUIRE_NATIVE:
                raise RuntimeError('native raster gate cannot run with E13_REFERENCE_RASTER=1')
            raise unittest.SkipTest('reference raster explicitly requested')
        if not native_available():
            if REQUIRE_NATIVE:
                raise RuntimeError('native raster gate requires a working gcc compiler')
            raise unittest.SkipTest('gcc native raster unavailable')

    @staticmethod
    def _reference_and_native(src, destination, args):
        reference = PixelBuffer(destination.width, destination.height, destination.pixels)
        native = PixelBuffer(destination.width, destination.height, destination.pixels)
        reference._blit_region_reference(src, *args)
        native.blit_region(src, *args)
        return reference.to_bytes(), native.to_bytes()

    def test_randomized_valid_rectangles_are_exact(self):
        randomizer = random.Random(0xE13C0DE)
        for case in range(180):
            source_width, source_height = randomizer.randint(2, 31), randomizer.randint(2, 29)
            source = PixelBuffer(source_width, source_height, bytes(randomizer.randrange(256) for _ in range(source_width * source_height * 4)))
            destination = PixelBuffer(43, 37, bytes(randomizer.randrange(256) for _ in range(43 * 37 * 4)))
            sx, sy = randomizer.randrange(source_width), randomizer.randrange(source_height)
            sw, sh = randomizer.randint(1, source_width - sx), randomizer.randint(1, source_height - sy)
            dw, dh = randomizer.randint(1, 51), randomizer.randint(1, 47)
            clip = None if case % 3 else (randomizer.randint(-5, 20), randomizer.randint(-5, 20), randomizer.randint(1, 43), randomizer.randint(1, 37))
            args = (sx, sy, sw, sh, randomizer.randint(-20, 30), randomizer.randint(-20, 28), dw, dh,
                    randomizer.random(), ('source-over', 'screen', 'multiply')[case % 3], bool(case % 2), clip)
            reference, native = self._reference_and_native(source, destination, args)
            self.assertEqual(native, reference, f'random case {case}: {args}')

    def test_actual_production_assets_and_blends_are_exact(self):
        prop = PixelBuffer.from_image(str(ROOT / 'public/juyiting/images/props/liangshan-hall-prop-bounty-board-cropped.png'))
        occluder = PixelBuffer.from_image(str(ROOT / 'public/juyiting/images/occluders/east-upper-v2.png'))
        destination = PixelBuffer(400, 300, bytes([23, 41, 67, 211]) * (400 * 300))
        operations = [
            (prop, (0, 0, prop.width, prop.height, -31, 17, 227, 163, 0.73, 'source-over', True, (0, 0, 360, 280))),
            (occluder, (0, 0, occluder.width, occluder.height, 71, -29, 263, 191, 0.85, 'screen', True, None)),
            (prop, (0, 0, prop.width, prop.height, 113, 91, 149, 103, 0.85, 'multiply', True, (40, 30, 310, 220))),
        ]
        reference = PixelBuffer(destination.width, destination.height, destination.pixels)
        native = PixelBuffer(destination.width, destination.height, destination.pixels)
        for source, args in operations:
            reference._blit_region_reference(source, *args)
            native.blit_region(source, *args)
        self.assertEqual(native.to_bytes(), reference.to_bytes())

    def test_fractional_and_invalid_inputs_fall_back_without_calling_native(self):
        source = PixelBuffer(4, 4, bytes([20, 40, 60, 255]) * 16)
        destination = PixelBuffer(8, 8, bytes([11, 22, 33, 44]) * 64)
        invalid_cases = [
            (0.5, 0, 2, 2, 0, 0, 2, 2, 1.0, 'source-over', True, None),
            (0, 0, 5, 2, 0, 0, 2, 2, 1.0, 'source-over', True, None),
            (0, 0, 2, 2, 0, 0, 2, 2, float('nan'), 'source-over', True, None),
            (0, 0, 2, 2, 0, 0, 2, 2, 1e308, 'source-over', True, None),
            (0, 0, 2, 2, 0, 0, 2, 2, 1.001, 'source-over', True, None),
            (0, 0, 2, 2, 0, 0, 2, 2, 1.0, 'source-over', True, (0, 0.25, 2, 2)),
            (0, 0, 2, 2, 2 ** 31, 0, 2, 2, 1.0, 'source-over', True, None),
            (0, 0, 2, 2, 0, 0, 2, 2, 1.0, 'source-over', True, (-(2 ** 31) - 1, 0, 2, 2)),
        ]
        for args in invalid_cases:
            with self.subTest(args=args):
                native = PixelBuffer(destination.width, destination.height, destination.pixels)
                reference = PixelBuffer(destination.width, destination.height, destination.pixels)
                try:
                    reference._blit_region_reference(source, *args)
                except Exception as error:
                    with self.assertRaises(type(error)):
                        native.blit_region(source, *args)
                else:
                    native.blit_region(source, *args)
                    self.assertEqual(native.to_bytes(), reference.to_bytes())

    def test_extreme_signed_coordinates_and_malformed_buffers_never_enter_native_c(self):
        source = PixelBuffer(2, 2, bytes([1, 2, 3, 255]) * 4)
        destination = PixelBuffer(2, 2)
        self.assertTrue(native_blit_region(source, destination, 0, 0, 2, 2, -(2 ** 31), 0, 2, 2, 1.0, 'source-over', True, None))
        self.assertFalse(native_blit_region(source, destination, 0, 0, 2, 2, 2 ** 31, 0, 2, 2, 1.0, 'source-over', True, None))
        source.pixels = bytearray(1)
        self.assertFalse(native_blit_region(source, destination, 0, 0, 2, 2, 0, 0, 2, 2, 1.0, 'source-over', True, None))

    def test_scalar_sum_is_left_to_right_not_runtime_compensated(self):
        self.assertEqual(sequential_float_sum((1e16, 1.0, -1e16)), 0.0)

    def test_native_call_restores_caller_rounding_mode(self):
        set_downward, set_nearest, get_rounding = test_rounding_api()
        self.assertEqual(set_downward(), 0)
        downward_mode = get_rounding()
        try:
            source = PixelBuffer(1, 1, bytes([128, 64, 32, 255]))
            destination = PixelBuffer(2, 2)
            destination.blit_region(source, 0, 0, 1, 1, 0, 0, 2, 2)
            self.assertEqual(get_rounding(), downward_mode)
        finally:
            self.assertEqual(set_nearest(), 0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-native', action='store_true')
    options, unittest_args = parser.parse_known_args()
    REQUIRE_NATIVE = options.require_native
    unittest.main(argv=[sys.argv[0], *unittest_args])
else:
    REQUIRE_NATIVE = False

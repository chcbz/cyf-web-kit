"""Ephemeral ctypes bridge for the E13 scalar-equivalent C rasterizer."""
import atexit
import ctypes
import math
import os
import subprocess
import tempfile
from pathlib import Path

_TEMP_DIR = None
_RASTER = None
_ATTEMPTED = False
INT_MIN = -(2 ** 31)
INT_MAX = 2 ** 31 - 1
INT64_MAX = 2 ** 63 - 1


def _load_raster():
    global _ATTEMPTED, _RASTER, _TEMP_DIR
    if _ATTEMPTED:
        return _RASTER
    _ATTEMPTED = True
    if os.environ.get('E13_REFERENCE_RASTER') == '1':
        return None
    source = Path(__file__).with_name('native_raster.c')
    try:
        _TEMP_DIR = tempfile.TemporaryDirectory(prefix='e13-native-raster-')
        output = Path(_TEMP_DIR.name) / 'native_raster.so'
        subprocess.run([
            'gcc', '-shared', '-fPIC', '-O3', '-std=c11',
            '-ffp-contract=off', '-fno-fast-math', str(source), '-o', str(output), '-lm'
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        library = ctypes.CDLL(str(output))
        library.e13_blit_region.argtypes = [
            ctypes.POINTER(ctypes.c_uint8), ctypes.c_int, ctypes.c_int,
            ctypes.POINTER(ctypes.c_uint8), ctypes.c_int, ctypes.c_int,
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            ctypes.c_double, ctypes.c_int, ctypes.c_int,
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        ]
        library.e13_blit_region.restype = ctypes.c_int
        library.e13_test_set_round_downward.restype = ctypes.c_int
        library.e13_test_set_round_nearest.restype = ctypes.c_int
        library.e13_test_get_rounding.restype = ctypes.c_int
        _RASTER = library
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        if _TEMP_DIR is not None:
            _TEMP_DIR.cleanup()
            _TEMP_DIR = None
    return _RASTER


def native_available():
    return _load_raster() is not None


def test_rounding_api():
    raster = _load_raster()
    if raster is None:
        return None
    return raster.e13_test_set_round_downward, raster.e13_test_set_round_nearest, raster.e13_test_get_rounding


def _finite_integral(value):
    if not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value) and float(value).is_integer() and INT_MIN <= value <= INT_MAX
    except OverflowError:
        return False


def _eligible(src, dst, sx, sy, sw, sh, dx, dy, dw, dh, opacity, blend, smoothing, clip):
    if not all(_finite_integral(value) for value in (src.width, src.height, dst.width, dst.height, sx, sy, sw, sh, dx, dy, dw, dh)):
        return False
    if not isinstance(opacity, (int, float)) or not math.isfinite(opacity) or not 0.0 <= opacity <= 1.0:
        return False
    if blend not in ('source-over', 'screen', 'multiply') or not isinstance(smoothing, bool):
        return False
    if len(src.pixels) != int(src.width) * int(src.height) * 4 or len(dst.pixels) != int(dst.width) * int(dst.height) * 4:
        return False
    if int(src.width) * int(src.height) > INT64_MAX // 4 or int(dst.width) * int(dst.height) > INT64_MAX // 4:
        return False
    sx, sy, sw, sh = map(int, (sx, sy, sw, sh))
    if sx < 0 or sy < 0 or sw <= 0 or sh <= 0 or sx + sw > src.width or sy + sh > src.height:
        return False
    if clip is not None:
        if not isinstance(clip, (tuple, list)) or len(clip) != 4 or not all(_finite_integral(value) for value in clip):
            return False
    return True


def blit_region(src, dst, sx, sy, sw, sh, dx, dy, dw, dh, opacity, blend, smoothing, clip):
    raster = _load_raster()
    if raster is None or not _eligible(src, dst, sx, sy, sw, sh, dx, dy, dw, dh, opacity, blend, smoothing, clip):
        return False
    src_view = (ctypes.c_uint8 * len(src.pixels)).from_buffer(src.pixels)
    dst_view = (ctypes.c_uint8 * len(dst.pixels)).from_buffer(dst.pixels)
    has_clip = clip is not None
    clip_x, clip_y, clip_w, clip_h = (clip if has_clip else (0, 0, 0, 0))
    blend_code = {'source-over': 0, 'screen': 1, 'multiply': 2}.get(blend, 0)
    status = raster.e13_blit_region(
        src_view, src.width, src.height, dst_view, dst.width, dst.height,
        int(sx), int(sy), int(sw), int(sh), int(dx), int(dy), int(dw), int(dh),
        float(opacity), blend_code, int(bool(smoothing)), int(has_clip),
        int(clip_x), int(clip_y), int(clip_w), int(clip_h),
    )
    if status != 0:
        raise RuntimeError(f'fail-closed: native raster rejected eligible input ({status})')
    return True


@atexit.register
def _cleanup_temp_raster():
    if _TEMP_DIR is not None:
        _TEMP_DIR.cleanup()

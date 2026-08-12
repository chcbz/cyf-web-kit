#!/usr/bin/env python3
"""
Pure-Python PNG decoder/encoder for offline pixel rendering.
No external dependencies beyond standard library (zlib, struct).

PNG spec: ISO/IEC 15948:2004 / W3C PNG Second Edition.
Supports: 8-bit RGB, RGBA, grayscale, grayscale+alpha.
No interlacing, no palette (PLTE), no ancillary chunks.
"""
import struct
import zlib


def _paeth(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    elif pb <= pc:
        return b
    else:
        return c


_UNFILTERS = [
    lambda raw, prev, bpp: raw,
    lambda raw, prev, bpp: bytes(
        (raw[i] + (raw[i - bpp] if i >= bpp else 0)) & 0xFF
        for i in range(len(raw))
    ) if True else raw,  # placeholder, will redefine
]


def _unfilter_none(raw, prev, bpp):
    return raw


def _unfilter_sub(raw, prev, bpp):
    out = bytearray(len(raw))
    for i in range(bpp):
        out[i] = raw[i]
    for i in range(bpp, len(raw)):
        out[i] = (raw[i] + out[i - bpp]) & 0xFF
    return bytes(out)


def _unfilter_up(raw, prev, bpp):
    if prev is None:
        return raw
    out = bytearray(len(raw))
    for i in range(len(raw)):
        out[i] = (raw[i] + prev[i]) & 0xFF
    return bytes(out)


def _unfilter_average(raw, prev, bpp):
    out = bytearray(len(raw))
    for i in range(len(raw)):
        a = out[i - bpp] if i >= bpp else 0
        b_v = prev[i] if prev is not None else 0
        out[i] = (raw[i] + ((a + b_v) // 2)) & 0xFF
    return bytes(out)


def _unfilter_paeth(raw, prev, bpp):
    out = bytearray(len(raw))
    for i in range(len(raw)):
        a = out[i - bpp] if i >= bpp else 0
        b_v = prev[i] if prev is not None else 0
        c = prev[i - bpp] if prev is not None and i >= bpp else 0
        out[i] = (raw[i] + _paeth(a, b_v, c)) & 0xFF
    return bytes(out)


_UNFILTER_MAP = {
    0: _unfilter_none,
    1: _unfilter_sub,
    2: _unfilter_up,
    3: _unfilter_average,
    4: _unfilter_paeth,
}

PNG_SIG = b'\x89PNG\r\n\x1a\n'
CT_GRAY = 0
CT_RGB = 2
CT_INDEXED = 3
CT_GRAYA = 4
CT_RGBA = 6


def read_png(filepath):
    with open(filepath, 'rb') as f:
        sig = f.read(8)
        if sig != PNG_SIG:
            raise ValueError(f'Not a PNG file: {filepath}')

        width = height = bit_depth = color_type = None
        idat_chunks = []

        while True:
            lb = f.read(4)
            if len(lb) < 4:
                break
            length = struct.unpack('>I', lb)[0]
            ctype = f.read(4)
            cdata = f.read(length)
            f.read(4)

            if ctype == b'IHDR':
                width, height = struct.unpack('>II', cdata[:8])
                bit_depth = cdata[8]
                color_type = cdata[9]
                compression = cdata[10]
                filter_method = cdata[11]
                interlace = cdata[12]
                if bit_depth not in (8, 16):
                    raise ValueError(f'Unsupported bit depth: {bit_depth}')
                if color_type not in (CT_GRAY, CT_RGB, CT_RGBA, CT_GRAYA):
                    raise ValueError(f'Unsupported color type: {color_type}')
                if interlace != 0:
                    raise ValueError('Interlaced PNG not supported')
            elif ctype == b'IDAT':
                idat_chunks.append(cdata)
            elif ctype == b'IEND':
                break

        if width is None:
            raise ValueError('No IHDR found')

    compressed = b''.join(idat_chunks)
    raw_data = zlib.decompress(compressed)

    bytes_per_sample = bit_depth // 8
    ch_map = {CT_GRAY: 1, CT_RGB: 3, CT_RGBA: 4, CT_GRAYA: 2}
    channels = ch_map.get(color_type, 4)
    bpp = channels * bytes_per_sample
    stride = width * bpp

    pixels = bytearray(width * height * 4)
    row_size = 1 + stride
    prev_row = None

    for y in range(height):
        offset = y * row_size
        ft = raw_data[offset]
        row = raw_data[offset + 1:offset + row_size]

        if ft not in _UNFILTER_MAP:
            raise ValueError(f'Unknown filter {ft} at row {y}')
        unf = _UNFILTER_MAP[ft](row, prev_row, bpp)

        dst = y * width * 4
        if color_type == CT_RGBA:
            pixels[dst:dst + len(unf)] = unf
        elif color_type == CT_RGB:
            for x in range(width):
                s = x * 3
                d = dst + x * 4
                pixels[d] = unf[s]
                pixels[d + 1] = unf[s + 1]
                pixels[d + 2] = unf[s + 2]
                pixels[d + 3] = 255
        elif color_type == CT_GRAY:
            for x in range(width):
                d = dst + x * 4
                v = unf[x]
                pixels[d] = v
                pixels[d + 1] = v
                pixels[d + 2] = v
                pixels[d + 3] = 255
        elif color_type == CT_GRAYA:
            for x in range(width):
                s = x * 2
                d = dst + x * 4
                v = unf[s]
                pixels[d] = v
                pixels[d + 1] = v
                pixels[d + 2] = v
                pixels[d + 3] = unf[s + 1]

        prev_row = unf

    return width, height, 4, bytes(pixels)


def write_png(filepath, width, height, pixels_rgba):
    expected = width * height * 4
    assert len(pixels_rgba) == expected, f'Expected {expected} bytes, got {len(pixels_rgba)}'

    def chunk(ctype, data):
        c = ctype + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + c + crc

    ihdr = struct.pack('>IIBBBBB', width, height, 8, CT_RGBA, 0, 0, 0)
    result = bytearray()
    result += PNG_SIG
    result += chunk(b'IHDR', ihdr)

    stride = width * 4
    raw_rows = bytearray(height * (1 + stride))
    for y in range(height):
        off = y * (1 + stride)
        raw_rows[off] = 0
        s = y * stride
        raw_rows[off + 1:off + 1 + stride] = pixels_rgba[s:s + stride]

    compressed = zlib.compress(bytes(raw_rows))
    result += chunk(b'IDAT', compressed)
    result += chunk(b'IEND', b'')

    with open(filepath, 'wb') as f:
        f.write(result)


def decode_webp(filepath):
    import ctypes
    lib = ctypes.cdll.LoadLibrary('libwebp.so.7')
    lib.WebPGetInfo.argtypes = [
        ctypes.c_char_p, ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)
    ]
    lib.WebPGetInfo.restype = ctypes.c_int
    lib.WebPDecodeRGBA.argtypes = [
        ctypes.c_char_p, ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)
    ]
    lib.WebPDecodeRGBA.restype = ctypes.POINTER(ctypes.c_uint8)
    lib.WebPFree.argtypes = [ctypes.c_void_p]
    lib.WebPFree.restype = None

    with open(filepath, 'rb') as f:
        data = f.read()

    w = ctypes.c_int()
    h = ctypes.c_int()
    if not lib.WebPGetInfo(data, len(data), ctypes.byref(w), ctypes.byref(h)):
        raise RuntimeError(f'Invalid WebP: {filepath}')

    width, height = w.value, h.value
    ptr = lib.WebPDecodeRGBA(data, len(data), ctypes.byref(w), ctypes.byref(h))
    if not ptr:
        raise RuntimeError(f'WebP decode failed: {filepath}')

    size = width * height * 4
    pixels = bytes(ctypes.cast(ptr, ctypes.POINTER(ctypes.c_uint8 * size)).contents)
    pixels = bytes(pixels)
    lib.WebPFree(ptr)
    return width, height, 4, pixels


def load_image(filepath):
    ext = filepath.rsplit('.', 1)[-1].lower()
    if ext == 'png':
        return read_png(filepath)
    elif ext == 'webp':
        return decode_webp(filepath)
    else:
        raise ValueError(f'Unsupported image format: {ext}')

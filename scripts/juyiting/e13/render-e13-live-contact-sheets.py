#!/usr/bin/env python3
"""
E13 live-browser evidence contact sheets (camera / interaction / movement).

Consumes a merged live evidence dir (live/index.json + live/shots/*.png) and
produces exactly three PNGs, one per shot kind:

    live/contact-sheets/camera.png       10 shots
    live/contact-sheets/interaction.png   7 shots
    live/contact-sheets/movement.png      2 movements x before/mid/after

Each cell contains the REAL captured screenshot (scaled down preserving the
source aspect ratio, letterboxed on a dark background) plus an ASCII label
with the shot id and its case id (and, for camera shots, the expected
zoom/pan/pinch facts bound from the current shot plan).

No screen content is ever fabricated: every pixel comes from the captured
PNG via offline_pixel_renderer.png_io; only labels/background are drawn.
"""
import argparse
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from offline_pixel_renderer.compositor import PixelBuffer
from offline_pixel_renderer.png_io import read_png
from offline_pixel_renderer.text import draw_text

LIVE_ID_ORDER = [
    'E13-271', 'E13-272', 'E13-273', 'E13-274', 'E13-275',
    'E13-276', 'E13-277', 'E13-278', 'E13-279', 'E13-280',
    'E13-281', 'E13-282', 'E13-283', 'E13-284', 'E13-285',
    'E13-286', 'E13-287', 'E13-288', 'E13-289',
]
LIVE_ID_RANK = {shot_id: rank for rank, shot_id in enumerate(LIVE_ID_ORDER)}

BG = (24, 24, 30, 255)
BORDER = (70, 72, 84, 255)
LABEL = (245, 245, 245, 255)
ACCENT = (255, 214, 102, 255)

_PANEL_CLASS = {
    'hotspot-bounty-board': 'TASKS',
    'hotspot-library-shelf': 'LIBRARY',
    'hotspot-main-seat': 'CHAT',
}
_MOVEMENT_ACTOR = {
    'movement-bounty-board': 'LUJUNYI',
    'movement-front-door': 'LIKUI',
}


def fit_dimensions(width, height, max_width, max_height):
    """Integer destination size that preserves the source aspect ratio."""
    scale = min(max_width / float(width), max_height / float(height))
    return max(1, int(width * scale)), max(1, int(height * scale))


def draw_rect_border(buffer, x, y, width, height, rgba, thickness=1):
    # edge-only scan: no per-pixel pass over the inner rectangle
    left = max(0, x)
    right = min(buffer.width, x + width)
    top = max(0, y)
    bottom = min(buffer.height, y + height)
    for yy in range(top, bottom):
        for xx in range(left, min(right, x + thickness)):
            index = (yy * buffer.width + xx) * 4
            buffer.pixels[index:index + 4] = bytes(rgba)
        for xx in range(max(left, x + width - thickness), right):
            index = (yy * buffer.width + xx) * 4
            buffer.pixels[index:index + 4] = bytes(rgba)
    for xx in range(left, right):
        for yy in range(top, min(bottom, y + thickness)):
            index = (yy * buffer.width + xx) * 4
            buffer.pixels[index:index + 4] = bytes(rgba)
        for yy in range(max(top, y + height - thickness), bottom):
            index = (yy * buffer.width + xx) * 4
            buffer.pixels[index:index + 4] = bytes(rgba)


def camera_note(record):
    expectations = record.get('cameraExpectations') or {}
    parts = []
    expected_zoom = expectations.get('expectedZoom')
    if expected_zoom is not None:
        parts.append('EXPZOOM %s' % expected_zoom)
    expected_pan = expectations.get('expectedPan')
    if expected_pan:
        parts.append('PAN %s' % expected_pan)
    expected_direction = expectations.get('expectedZoomDirection')
    if expected_direction:
        parts.append('PINCH %s' % expected_direction)
    camera = record.get('camera') or {}
    if camera.get('pinch') is not None:
        parts.append('INIT %s' % camera['pinch'].get('start', ''))
    return '  '.join(parts) if parts else 'CAMERA'


def interaction_note(record):
    case_id = record.get('interactionCase') or record.get('interactionCaseId') or 'interaction'
    if case_id == 'agent-pointer':
        return 'SELECT SONGJIANG'
    if case_id.startswith('hotspot-'):
        return 'PANEL %s' % _PANEL_CLASS.get(case_id, 'OPEN')
    if case_id == 'labels-bubbles':
        return 'BUBBLES SONGJIANG LUJUNYI WUYONG'
    if case_id.startswith('lighting-'):
        return 'LIGHTING DEPTH 300'
    return 'INTERACTION'


def movement_note(record):
    case_id = record.get('movementCase') or record.get('movementCaseId') or 'movement'
    actor = _MOVEMENT_ACTOR.get(case_id, 'ACTOR')
    stage = (record.get('movementStage') or '').upper()
    return 'MOVE %s  %s' % (actor, stage)


def build_sheet(title, records, cols, cell_width, image_height, label_height, pad, note_fn):
    rows = (len(records) + cols - 1) // cols
    header_height = 40
    sheet_width = pad + cols * (cell_width + pad)
    sheet_height = header_height + pad + rows * (image_height + label_height + pad)
    sheet = PixelBuffer(sheet_width, sheet_height)
    sheet.fill(BG)
    draw_text(sheet, pad + 4, 10, title, color=ACCENT, scale=2)
    for index, record in enumerate(records):
        col = index % cols
        row = index // cols
        x0 = pad + col * (cell_width + pad)
        y0 = header_height + pad + row * (image_height + label_height + pad)
        shot_path = os.path.join(_LIVE_DIR, record.get('file') or 'shots/%s.png' % record['id'])
        if not os.path.isfile(shot_path):
            raise RuntimeError('fail-closed: missing live shot %s' % shot_path)
        width, height, _, pixels = read_png(shot_path)
        dst_width, dst_height = fit_dimensions(width, height, cell_width, image_height)
        dx = x0 + (cell_width - dst_width) // 2
        dy = y0 + (image_height - dst_height) // 2
        # nearest-neighbour resize keeps every pixel a real captured sample (fast, honest)
        sheet.blit_region(PixelBuffer(width, height, pixels), 0, 0, width, height, dx, dy, dst_width, dst_height, smoothing=False)
        draw_rect_border(sheet, x0, y0, cell_width, image_height, BORDER)
        case_id = (record.get('displayCase') or record.get('cameraCase') or record.get('interactionCase') or record.get('movementCase') or '')
        draw_text(sheet, x0 + 4, y0 + image_height + 4, '%s  %s' % (record['id'], case_id), color=LABEL, scale=1)
        draw_text(sheet, x0 + 4, y0 + image_height + 4 + 11, note_fn(record), color=ACCENT, scale=1)
    return sheet


def main():
    parser = argparse.ArgumentParser(description='E13 live evidence contact sheets')
    parser.add_argument('--live-dir', default=None, help='merged live evidence dir (default: tests/fixtures/juyiting/occlusion-e13/live)')
    args = parser.parse_args()

    global _LIVE_DIR
    if args.live_dir:
        _LIVE_DIR = os.path.realpath(args.live_dir)
    else:
        repo = os.path.realpath(os.path.join(_HERE, '..', '..', '..'))
        _LIVE_DIR = os.path.join(repo, 'tests/fixtures/juyiting/occlusion-e13/live')

    index_path = os.path.join(_LIVE_DIR, 'index.json')
    if not os.path.isfile(index_path):
        raise RuntimeError('fail-closed: live index missing: %s' % index_path)
    with open(index_path, encoding='utf-8') as handle:
        index = json.load(handle)
    shots = index.get('shots') or []
    if len(shots) != 19:
        raise RuntimeError('fail-closed: live index must contain exactly 19 shots, got %d' % len(shots))

    by_kind = {'camera': [], 'interaction': [], 'movement': []}
    for record in shots:
        kind = record.get('kind')
        if kind not in by_kind:
            raise RuntimeError('fail-closed: unexpected live shot kind %s (%s)' % (kind, record.get('id')))
        by_kind[kind].append(record)
    for kind, records in by_kind.items():
        records.sort(key=lambda record: LIVE_ID_RANK.get(record.get('id'), 999))
    if len(by_kind['camera']) != 10 or len(by_kind['interaction']) != 7 or len(by_kind['movement']) != 2:
        raise RuntimeError(
            'fail-closed: live counts mismatch camera=%d interaction=%d movement=%d'
            % (len(by_kind['camera']), len(by_kind['interaction']), len(by_kind['movement']))
        )

    contact_dir = os.path.join(_LIVE_DIR, 'contact-sheets')
    os.makedirs(contact_dir, exist_ok=True)

    camera_sheet = build_sheet('E13 LIVE CAMERA CONTACT SHEET 10', by_kind['camera'], 5, 380, 250, 52, 10, camera_note)
    interaction_sheet = build_sheet('E13 LIVE INTERACTION CONTACT SHEET 7', by_kind['interaction'], 4, 460, 290, 52, 10, interaction_note)
    movement_frames = []
    for record in by_kind['movement']:
        sequence = record.get('movementSequence') or []
        if len(sequence) != 3 or [frame.get('stage') for frame in sequence] != ['before', 'mid', 'after']:
            raise RuntimeError('fail-closed: movement %s lacks before/mid/after sequence' % record.get('id'))
        for frame in sequence:
            view = dict(record)
            view['file'] = frame['file']
            view['movementStage'] = frame['stage']
            view['displayCase'] = '%s-%s' % (record.get('movementCase') or 'movement', frame['stage'])
            movement_frames.append(view)
    movement_sheet = build_sheet('E13 LIVE MOVEMENT SEQUENCES 2 X BEFORE MID AFTER', movement_frames, 3, 560, 360, 52, 10, movement_note)

    from offline_pixel_renderer.png_io import write_png
    outputs = [
        (os.path.join(contact_dir, 'camera.png'), camera_sheet),
        (os.path.join(contact_dir, 'interaction.png'), interaction_sheet),
        (os.path.join(contact_dir, 'movement.png'), movement_sheet),
    ]
    for path, sheet in outputs:
        write_png(path, sheet.width, sheet.height, sheet.to_bytes())
        print('[render-e13-live] wrote %s (%dx%d)' % (path, sheet.width, sheet.height))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:  # fail-closed CLI
        print('[render-e13-live] FAIL: %s' % error, file=sys.stderr)
        sys.exit(1)

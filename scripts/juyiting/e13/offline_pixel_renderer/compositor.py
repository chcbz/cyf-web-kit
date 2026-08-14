#!/usr/bin/env python3
"""Deterministic crop compositor matching HallScene/melonJS production draw semantics."""
import os
from .png_io import load_image


class PixelBuffer:
    __slots__ = ('width', 'height', 'pixels')
    def __init__(self, width, height, pixels=None):
        self.width, self.height = width, height
        self.pixels = bytearray(width * height * 4) if pixels is None else bytearray(pixels)
    def to_bytes(self):
        return bytes(self.pixels)

    def fill(self, rgba):
        self.pixels[:] = bytes(rgba) * (self.width * self.height)

    def blit_region(self, src, sx, sy, sw, sh, dx, dy, dw=None, dh=None, opacity=1.0, blend='source-over', smoothing=True, clip=None):
        dw, dh = int(dw if dw is not None else sw), int(dh if dh is not None else sh)
        if dw <= 0 or dh <= 0 or sw <= 0 or sh <= 0:
            return
        sp, dp = src.pixels, self.pixels
        dx, dy = int(dx), int(dy)
        ry0, ry1 = max(0, -dy), min(dh, self.height - dy)
        rx0, rx1 = max(0, -dx), min(dw, self.width - dx)
        if clip is not None:
            clip_x, clip_y, clip_w, clip_h = clip
            ry0, ry1 = max(ry0, int(clip_y) - dy), min(ry1, int(clip_y + clip_h) - dy)
            rx0, rx1 = max(rx0, int(clip_x) - dx), min(rx1, int(clip_x + clip_w) - dx)
        if ry0 >= ry1 or rx0 >= rx1:
            return
        for ry in range(ry0, ry1):
            ty = dy + ry
            ssy = int(sy) + int(ry * sh / dh)
            if ssy < 0 or ssy >= src.height:
                continue
            for rx in range(rx0, rx1):
                tx = dx + rx
                if smoothing and (dw != sw or dh != sh):
                    # CanvasRenderer runs with antiAlias=true. Sample at pixel
                    # centers and interpolate premultiplied RGBA, clamped to
                    # the supplied sourceRect so adjacent sprite frames/atlas
                    # fragments cannot bleed into the audit frame.
                    fx = float(sx) + (rx + 0.5) * sw / dw - 0.5
                    fy = float(sy) + (ry + 0.5) * sh / dh - 0.5
                    x0 = max(int(sx), min(int(float(sx) + sw - 1), int(fx // 1)))
                    y0 = max(int(sy), min(int(float(sy) + sh - 1), int(fy // 1)))
                    x1 = max(int(sx), min(int(float(sx) + sw - 1), x0 + 1))
                    y1 = max(int(sy), min(int(float(sy) + sh - 1), y0 + 1))
                    wx, wy = fx - (fx // 1), fy - (fy // 1)
                    weights = ((x0, y0, (1-wx)*(1-wy)), (x1, y0, wx*(1-wy)),
                               (x0, y1, (1-wx)*wy), (x1, y1, wx*wy))
                    alpha = sum(sp[(yy * src.width + xx) * 4 + 3] / 255.0 * weight for xx, yy, weight in weights)
                    if alpha <= 0:
                        continue
                    sc = []
                    for c in range(3):
                        premul = sum((sp[(yy * src.width + xx) * 4 + c] / 255.0) *
                                     (sp[(yy * src.width + xx) * 4 + 3] / 255.0) * weight
                                     for xx, yy, weight in weights)
                        sc.append(premul / alpha)
                    sa = alpha * opacity
                else:
                    ssx = int(sx) + int(rx * sw / dw)
                    if ssx < 0 or ssx >= src.width:
                        continue
                    si = (ssy * src.width + ssx) * 4
                    sa = (sp[si + 3] / 255.0) * opacity
                    if sa <= 0:
                        continue
                    sc = [sp[si + c] / 255.0 for c in range(3)]
                di = (ty * self.width + tx) * 4
                da = dp[di + 3] / 255.0
                out_a = sa + da * (1.0 - sa)
                if out_a <= 0:
                    continue
                dc = [dp[di + c] / 255.0 for c in range(3)]
                for c in range(3):
                    if blend == 'screen':
                        blended = 1.0 - (1.0 - dc[c]) * (1.0 - sc[c])
                    elif blend == 'multiply':
                        blended = dc[c] * sc[c]
                    else:
                        blended = sc[c]
                    premul = sa * ((1.0 - da) * sc[c] + da * blended) + (1.0 - sa) * da * dc[c]
                    dp[di + c] = max(0, min(255, round(premul / out_a * 255.0)))
                dp[di + 3] = max(0, min(255, round(out_a * 255.0)))

    def blend_fill(self, rgb, opacity, blend='multiply'):
        one = PixelBuffer(1, 1, bytes([rgb[0], rgb[1], rgb[2], 255]))
        self.blit_region(one, 0, 0, 1, 1, 0, 0, self.width, self.height, opacity, blend)

    @staticmethod
    def from_image(filepath):
        w, h, _, pixels = load_image(filepath)
        return PixelBuffer(w, h, pixels)


class AssetCache:
    def __init__(self, public_dir):
        self.public_dir, self._cache = public_dir, {}
    def _load(self, key, path):
        if key not in self._cache:
            self._cache[key] = PixelBuffer.from_image(path)
        return self._cache[key]
    def asset(self, ref):
        return self._load(f'asset:{ref}', os.path.join(self.public_dir, ref))
    def persona_sheet(self, code):
        from .world_model import PERSONA_SPRITE
        info = PERSONA_SPRITE[code]
        return self._load(f'sprite:{code}', os.path.join(self.public_dir, 'sprites', 'persona-sheets-v1', info['src']))


class OfflineRenderer:
    MAP_W, MAP_H = 1664, 928

    def __init__(self, public_dir, image_layers=None, render_policy=None):
        self.assets = AssetCache(public_dir)
        self.image_layers = image_layers or {}
        self.render_policy = render_policy or {}
        bands = self.render_policy.get('depthBands', {})
        required = ('BASE_MIN', 'BASE_MAX_EXCLUSIVE', 'V2_WORLD_START', 'V2_WORLD_STRIDE', 'LIGHTING', 'WORLD_UI', 'SCREEN_UI')
        if any(not isinstance(bands.get(key), int) for key in required):
            raise RuntimeError('fail-closed: production HallScene render policy is missing integer depth bands')
        if bands['BASE_MIN'] != 0 or not (bands['BASE_MAX_EXCLUSIVE'] <= bands['V2_WORLD_START'] < bands['LIGHTING'] < bands['WORLD_UI'] < bands['SCREEN_UI']):
            raise RuntimeError('fail-closed: invalid HallScene render-band ordering')
        if self.render_policy.get('legacyOccluderLayers') != ['mid-occluders', 'foreground-occluders']:
            raise RuntimeError('fail-closed: production legacy occluder ownership policy drift')
        self.depth_bands = bands
        self._static_crop_cache = {}

    def _world_depth(self, logical_depth):
        if not isinstance(logical_depth, int) or logical_depth < 0:
            raise RuntimeError(f'fail-closed: invalid logical world depth {logical_depth}')
        depth = self.depth_bands['V2_WORLD_START'] + logical_depth * self.depth_bands['V2_WORLD_STRIDE']
        if depth >= self.depth_bands['LIGHTING']:
            raise RuntimeError(f'fail-closed: mapped world depth {depth} escapes below-lighting band')
        return depth

    def _fixed_events(self):
        # Repaired production V2 stack: opaque tile base remains, legacy full-map
        # mid/foreground handles are detached, and lighting remains independent.
        lighting = self.image_layers.get('lighting-overlay')
        if not lighting:
            raise RuntimeError('fail-closed: production TMX lighting layer missing')
        return [
            {'event': 'base', 'depth': self.depth_bands['BASE_MIN'], 'insertion': 0,
             'source': 'images/liangshan-hall-base-clean-v3.webp'},
            {'event': 'lighting-overlay', 'depth': self.depth_bands['LIGHTING'], 'insertion': 1, **lighting},
        ]

    def _event_stack(self, sorted_objects, agent):
        events = self._fixed_events()
        # Production insertion order is props, agents, then staged fragments;
        # mapped depths are unique because E7 logical depths are contiguous.
        insertion = 10
        for obj in sorted_objects:
            if obj['kind'] == 'prop':
                events.append({'event': 'world', 'depth': self._world_depth(sorted_objects.index(obj)), 'logicalDepth': sorted_objects.index(obj), 'insertion': insertion, 'object': obj})
                insertion += 1
        events.append({'event': 'world', 'depth': self._world_depth(sorted_objects.index(agent)), 'logicalDepth': sorted_objects.index(agent), 'insertion': insertion, 'object': agent})
        insertion += 1
        for obj in sorted_objects:
            if obj['kind'] == 'fragment':
                events.append({'event': 'world', 'depth': self._world_depth(sorted_objects.index(obj)), 'logicalDepth': sorted_objects.index(obj), 'insertion': insertion, 'object': obj})
                insertion += 1
        return sorted(events, key=lambda e: (e['depth'], -e['insertion']))

    def _crop(self, shot, crop_w, crop_h):
        # A target contact sheet is an A/B/C comparison. Its camera must not
        # follow the probe agent, otherwise behind/boundary/front silently use
        # different world viewports and cease to be comparable. Bind the crop
        # only to the authoritative camera center (the target anchor for all
        # matrix shots); map-edge clamping is deterministic for that target.
        center = shot.get('camera', {}).get('center') or shot['targetAnchor']
        cx, cy = int(center['x']), int(center['y'])
        wx = max(0, min(cx - crop_w // 2, self.MAP_W - crop_w))
        wy = max(0, min(cy - crop_h // 2, self.MAP_H - crop_h))
        return wx, wy, min(crop_w, self.MAP_W - wx), min(crop_h, self.MAP_H - wy)

    def render_shot_small(self, shot, fragments, props_list, crop_w=400, crop_h=300):
        from .world_model import build_agent_scene_object, compute_unified_order, compute_world_sort_key
        agent = build_agent_scene_object(shot['persona'], shot['world']['x'], shot['world']['y'])
        sorted_objects, depths = compute_unified_order(fragments, props_list, agent)
        wx, wy, cw, ch = self._crop(shot, crop_w, crop_h)
        stack = [event for event in self._event_stack(sorted_objects, agent) if event.get('object', {}).get('stableId') not in set(shot.get('visualOmissions', []))]
        agent_index = next(i for i, event in enumerate(stack) if event.get('object') is agent)
        prefix_signature = tuple(
            (event['event'], event['depth'], event['insertion'], event.get('object', {}).get('stableId', ''))
            for event in stack[:agent_index]
        )
        cache_key = (wx, wy, cw, ch, prefix_signature)
        cached = self._static_crop_cache.get(cache_key)
        if cached is None:
            prefix = PixelBuffer(cw, ch)
            for event in stack[:agent_index]:
                obj = event.get('object')
                if event['event'] == 'world':
                    if self._obj_overlaps(obj, (wx, wy, cw, ch)):
                        self._draw_world(prefix, obj, wx, wy, frame=0)
                else:
                    self._draw_fixed(prefix, event, wx, wy)
            cached = prefix.to_bytes()
            self._static_crop_cache[cache_key] = cached
        canvas = PixelBuffer(cw, ch, cached)
        self._render_agent(canvas, agent, wx, wy, frame=0)
        # Exact production suffix: every world and fixed renderable after the
        # agent is drawn once, in event order. No precomposited suffix remains
        # underneath semitransparent agent pixels, so lighting cannot double-hit.
        for event in stack[agent_index + 1:]:
            obj = event.get('object')
            if event['event'] == 'world':
                if self._obj_overlaps(obj, (wx, wy, cw, ch)):
                    self._draw_world(canvas, obj, wx, wy, frame=0)
            else:
                self._draw_fixed(canvas, event, wx, wy)
        facts = self._build_facts(sorted_objects, depths, agent, shot, fragments, props_list, stack, wx, wy, cw, ch, canvas)
        return canvas.to_bytes(), sorted_objects, depths, facts

    def render_shot(self, shot, fragments, props_list):
        vp, camera = shot['viewport'], shot['camera']
        zoom = camera['zoom']
        return self.render_shot_small(shot, fragments, props_list, int(vp['width'] / zoom), int(vp['height'] / zoom))

    def _draw_fixed(self, canvas, event, vx, vy, clip=None):
        src = self.assets.asset(event['source'])
        opacity = float(event.get('opacity', 1))
        blend = 'screen' if event['event'] == 'lighting-overlay' else 'source-over'
        canvas.blit_region(src, 0, 0, src.width, src.height, int(event.get('offsetX', 0)) - vx,
                           int(event.get('offsetY', 0)) - vy, int(event.get('width', src.width)),
                           int(event.get('height', src.height)), opacity, blend, clip=clip)
        tint = event.get('tintcolor')
        if tint:
            rgb = tuple(int(tint[i:i + 2], 16) for i in (1, 3, 5))
            # HallScene fills the layer rectangle (not the current crop) while
            # keeping globalAlpha and switching screen -> multiply.
            one = PixelBuffer(1, 1, bytes([rgb[0], rgb[1], rgb[2], 255]))
            canvas.blit_region(one, 0, 0, 1, 1, int(event.get('offsetX', 0)) - vx,
                               int(event.get('offsetY', 0)) - vy, int(event.get('width', src.width)),
                               int(event.get('height', src.height)), opacity, 'multiply', clip=clip)

    def _draw_world(self, canvas, obj, vx, vy, frame=0):
        if obj['kind'] == 'agent':
            self._render_agent(canvas, obj, vx, vy, frame)
        elif obj['kind'] == 'prop':
            self._render_prop(canvas, obj, vx, vy)
        else:
            self._render_fragment(canvas, obj, vx, vy)

    def _render_fragment(self, canvas, obj, vx, vy):
        src = self.assets.asset(obj['assetRef']); s, d = obj['sourceRect'], obj['destinationRect']
        canvas.blit_region(src, int(s['x']), int(s['y']), int(s['width']), int(s['height']),
                           int(d['x']) - vx, int(d['y']) - vy, int(d['width']), int(d['height']))

    def _render_prop(self, canvas, obj, vx, vy):
        src = self.assets.asset(obj['assetRef']); d = obj['destinationRect']
        canvas.blit_region(src, 0, 0, src.width, src.height, int(d['x']) - vx, int(d['y']) - vy,
                           int(d['width']), int(d['height']))

    def _agent_geometry(self, agent, frame=0):
        from .world_model import PERSONA_SPRITE, PERSONAS
        info = PERSONA_SPRITE[agent['personaCode']]
        scale = next(p['scale'] for p in PERSONAS if p['personaCode'] == agent['personaCode'])
        fw, fh = info['frame_w'], info['frame_h']
        return {
            'sx': (frame % info['cols']) * fw, 'sy': (frame // info['cols']) * fh,
            'sw': fw, 'sh': fh, 'x': int(agent['worldX'] - info['anchor_x'] * fw * scale),
            'y': int(agent['worldY'] - info['anchor_y'] * fh * scale),
            'width': int(fw * scale), 'height': int(fh * scale), 'scale': scale,
        }

    def _render_agent(self, canvas, agent, vx, vy, frame=0):
        g = self._agent_geometry(agent, frame); src = self.assets.persona_sheet(agent['personaCode'])
        canvas.blit_region(src, g['sx'], g['sy'], g['sw'], g['sh'], g['x'] - vx, g['y'] - vy, g['width'], g['height'])

    def _obj_overlaps(self, obj, vp):
        vx, vy, vw, vh = vp
        d = self._agent_geometry(obj) if obj['kind'] == 'agent' else obj['destinationRect']
        return not (d['x'] + d['width'] <= vx or d['x'] >= vx + vw or d['y'] + d['height'] <= vy or d['y'] >= vy + vh)

    def _alpha_at_agent(self, agent, x, y, frame=0):
        g = self._agent_geometry(agent, frame)
        if not (g['x'] <= x < g['x'] + g['width'] and g['y'] <= y < g['y'] + g['height']):
            return 0
        sheet = self.assets.persona_sheet(agent['personaCode'])
        fx = g['sx'] + (x - g['x'] + 0.5) * g['sw'] / g['width'] - 0.5
        fy = g['sy'] + (y - g['y'] + 0.5) * g['sh'] / g['height'] - 0.5
        x0 = max(g['sx'], min(g['sx'] + g['sw'] - 1, int(fx // 1)))
        y0 = max(g['sy'], min(g['sy'] + g['sh'] - 1, int(fy // 1)))
        x1, y1 = min(g['sx'] + g['sw'] - 1, x0 + 1), min(g['sy'] + g['sh'] - 1, y0 + 1)
        wx, wy = fx - (fx // 1), fy - (fy // 1)
        alpha = 0.0
        for sx, sy, weight in ((x0,y0,(1-wx)*(1-wy)),(x1,y0,wx*(1-wy)),(x0,y1,(1-wx)*wy),(x1,y1,wx*wy)):
            alpha += sheet.pixels[(sy * sheet.width + sx) * 4 + 3] * weight
        return round(alpha)

    def _alpha_at_target(self, target, x, y):
        d = target['destinationRect']
        if not (d['x'] <= x < d['x'] + d['width'] and d['y'] <= y < d['y'] + d['height']):
            return 0
        if target['kind'] == 'fragment':
            s, src = target['sourceRect'], self.assets.asset(target['assetRef'])
            sx = int(s['x']) + int((x - d['x']) * s['width'] / d['width'])
            sy = int(s['y']) + int((y - d['y']) * s['height'] / d['height'])
        else:
            src = self.assets.asset(target['assetRef'])
            sx = int((x - d['x']) * src.width / d['width'])
            sy = int((y - d['y']) * src.height / d['height'])
        return src.pixels[(sy * src.width + sx) * 4 + 3]

    def _compose_region(self, stack, region, omit_stable_id=None):
        vx, vy, width, height = region
        canvas = PixelBuffer(width, height)
        for event in stack:
            obj = event.get('object')
            if obj is not None:
                if obj.get('stableId') == omit_stable_id:
                    continue
                if self._obj_overlaps(obj, region):
                    self._draw_world(canvas, obj, vx, vy, frame=0)
            else:
                self._draw_fixed(canvas, event, vx, vy)
        return canvas

    def _final_visibility_overlap(self, agent, target, ordering, stack, crop, final_canvas):
        ag, tr = self._agent_geometry(agent), target['destinationRect']
        crop_x, crop_y, crop_w, crop_h = crop
        x0 = max(ag['x'], int(tr['x']), crop_x)
        y0 = max(ag['y'], int(tr['y']), crop_y)
        x1 = min(ag['x'] + ag['width'], int(tr['x'] + tr['width']), crop_x + crop_w)
        y1 = min(ag['y'] + ag['height'], int(tr['y'] + tr['height']), crop_y + crop_h)
        intersection = weighted = agent_px = target_px = 0
        changed_by_target = changed_by_agent = 0
        bounds = None
        if x0 < x1 and y0 < y1:
            region = (x0, y0, x1 - x0, y1 - y0)
            omitted_id = target['stableId'] if ordering == 'agent_behind_target' else agent['stableId']
            without_later = self._compose_region(stack, region, omitted_id)
            minx = miny = 10**9; maxx = maxy = -1
            for y in range(y0, y1):
                for x in range(x0, x1):
                    aa, ta = self._alpha_at_agent(agent, x, y), self._alpha_at_target(target, x, y)
                    agent_px += aa > 0; target_px += ta > 0
                    if aa <= 0 or ta <= 0:
                        continue
                    intersection += 1; weighted += aa * ta / 255.0
                    minx, miny, maxx, maxy = min(minx, x), min(miny, y), max(maxx, x), max(maxy, y)
                    final_index = ((y - crop_y) * crop_w + (x - crop_x)) * 4
                    omitted_index = ((y - y0) * region[2] + (x - x0)) * 4
                    changed = final_canvas.pixels[final_index:final_index + 4] != without_later.pixels[omitted_index:omitted_index + 4]
                    if changed and ordering == 'agent_behind_target': changed_by_target += 1
                    if changed and ordering == 'agent_in_front': changed_by_agent += 1
            if intersection:
                bounds = {'x': minx, 'y': miny, 'width': maxx - minx + 1, 'height': maxy - miny + 1}
        target_after = ordering == 'agent_behind_target'
        agent_after = ordering == 'agent_in_front'
        applicable = changed_by_target if target_after else (changed_by_agent if agent_after else 0)
        return {
            'method': 'source-alpha-intersection-plus-final-composite-difference',
            'visibilityMethod': 'final RGBA differs from the identical full stack with the later agent/target omitted, after lighting',
            'hasAlphaOverlap': intersection > 0,
            'agentOpaquePixelsInAabb': agent_px, 'targetOpaquePixelsInAabb': target_px,
            'opaqueIntersectionPixels': intersection, 'alphaWeightedIntersection': round(weighted, 3),
            'finalCompositeChangedByTargetPixels': changed_by_target,
            'finalCompositeChangedByAgentPixels': changed_by_agent,
            'visibleOcclusionPixels': applicable,
            'agentPixelsVisiblyOccludedByTarget': changed_by_target if target_after else 0,
            'targetPixelsVisiblyOccludedByAgent': changed_by_agent if agent_after else 0,
            'overlapBounds': bounds,
        }

    def frame_alpha_bounds(self, persona):
        from .world_model import PERSONA_SPRITE
        info, sheet = PERSONA_SPRITE[persona], self.assets.persona_sheet(persona)
        result = []
        for frame in range(4):
            sx, sy, fw, fh = (frame % info['cols']) * info['frame_w'], 0, info['frame_w'], info['frame_h']
            xs, ys, count = [], [], 0
            for y in range(fh):
                for x in range(fw):
                    if sheet.pixels[((sy + y) * sheet.width + sx + x) * 4 + 3] > 0:
                        xs.append(x); ys.append(y); count += 1
            result.append({'frame': frame, 'bounds': {'x': min(xs), 'y': min(ys), 'width': max(xs)-min(xs)+1, 'height': max(ys)-min(ys)+1}, 'opaquePixels': count})
        vertical_extents = {(r['bounds']['y'], r['bounds']['y'] + r['bounds']['height']) for r in result}
        exact_bounds = {tuple(r['bounds'][k] for k in ('x', 'y', 'width', 'height')) for r in result}
        return {'animation': 'idle', 'direction': 'down', 'frames': result,
                'sameFrameGeometryAnchorScale': True,
                'sameAlphaVerticalExtent': len(vertical_extents) == 1,
                'allAlphaBoundsEqual': len(exact_bounds) == 1,
                'reviewInvariantPass': len(vertical_extents) == 1 and all(r['opaquePixels'] > 0 for r in result),
                'invariant': 'same frame geometry/anchor/scale and same alpha top/baseline; exact x/width differences are reported, not hidden'}

    def _build_facts(self, order, depths, agent, shot, fragments, props, stack, wx, wy, cw, ch, final_canvas):
        from .world_model import compute_world_sort_key
        target = next(o for o in [*fragments, *props] if o['stableId'] == shot['targetStableId'])
        ad, td = depths[agent['stableId']], depths[target['stableId']]
        ordering = 'agent_behind_target' if ad < td else ('agent_in_front' if ad > td else 'tie')
        fixed = [e for e in stack if e['event'] != 'world']
        return {
            'shotId': shot['id'], 'agentStableId': agent['stableId'], 'targetStableId': target['stableId'],
            'agentWorld': dict(shot['world']), 'agentSortKey': list(compute_world_sort_key(agent)),
            'targetSortKey': list(compute_world_sort_key(target)), 'actualDepth': ad, 'targetDepth': td,
            'actualRenderDepth': self._world_depth(ad), 'targetRenderDepth': self._world_depth(td),
            'ordering': ordering, 'semanticExpectedRelation': shot['expectedRelation'],
            'resolvedExpectedOrdering': shot['resolvedExpectedOrdering'],
            'depthMatch': ordering == shot['resolvedExpectedOrdering'],
            'pixelOverlap': self._final_visibility_overlap(agent, target, ordering, stack, (wx, wy, cw, ch), final_canvas), 'worldOrderLength': len(order),
            'viewportWorld': {'x': wx, 'y': wy, 'width': cw, 'height': ch},
            'sampledSpriteFrame': {'animation': 'idle', 'direction': 'down', 'frame': 0},
            'renderPolicy': self.render_policy,
            'fixedLayerStack': [{'name': e['event'], 'depth': e['depth'], 'opacity': e.get('opacity', 1),
                                 'tintcolor': e.get('tintcolor'), 'blend': 'screen' if e['event'] == 'lighting-overlay' else 'source-over'} for e in fixed],
            'evidenceContext': shot.get('evidenceContext', 'in-context'),
            'visualOmissions': list(shot.get('visualOmissions', [])),
            'navValidation': dict(shot.get('navValidation', {})),
            'probeKind': shot.get('probeKind', 'uniform-anchor-offset'),
            'drawIndices': {
                'agent': next(i for i, e in enumerate(stack) if e.get('object', {}).get('stableId') == agent['stableId']),
                'target': next(i for i, e in enumerate(stack) if e.get('object', {}).get('stableId') == target['stableId']),
            },
        }

    def recompute_pixel_overlap(self, shot, fragments, props, png_pixels):
        """Independently re-derive pixelOverlap from production assets and the
        committed final-composite PNG. This intentionally does not read any
        committed runtimeFacts.pixelOverlap field."""
        from .world_model import build_agent_scene_object, compute_unified_order
        agent = build_agent_scene_object(shot['persona'], shot['world']['x'], shot['world']['y'])
        sorted_objects, depths = compute_unified_order(fragments, props, agent)
        wx, wy, cw, ch = self._crop(shot, 400, 300)
        omissions = set(shot.get('visualOmissions', []))
        stack = [event for event in self._event_stack(sorted_objects, agent)
                 if event.get('object', {}).get('stableId') not in omissions]
        target = next(o for o in [*fragments, *props] if o['stableId'] == shot['targetStableId'])
        ad, td = depths[agent['stableId']], depths[target['stableId']]
        ordering = 'agent_behind_target' if ad < td else ('agent_in_front' if ad > td else 'tie')
        final_canvas = PixelBuffer(cw, ch, png_pixels)
        return self._final_visibility_overlap(agent, target, ordering, stack, (wx, wy, cw, ch), final_canvas)

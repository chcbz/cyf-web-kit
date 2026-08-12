#!/usr/bin/env python3
"""Authoritative E13 shot-plan loader plus deterministic production sort model."""
from pathlib import Path
import copy
import json
import math
import os
import xml.etree.ElementTree as ET

RENDER_BAND_ORDER = {
    'background': 0, 'world': 100, 'overhead': 200,
    'lighting': 300, 'world-ui': 400, 'screen-ui': 500,
}
DEFAULT_FLOOR_REGISTRY = {'floor-1': 0}

PERSONAS = [
    {'personaCode': 'songjiang', 'name': '宋江', 'agentId': 'songjiang', 'scale': 0.52},
    {'personaCode': 'lujunyi', 'name': '卢俊义', 'agentId': 'lujunyi', 'scale': 0.52},
    {'personaCode': 'husanniang', 'name': '扈三娘', 'agentId': 'husanniang', 'scale': 0.50},
    {'personaCode': 'likui', 'name': '李逵', 'agentId': 'likui', 'scale': 0.56},
    {'personaCode': 'linchong', 'name': '林冲', 'agentId': 'linchong', 'scale': 0.54},
    {'personaCode': 'wuyong', 'name': '吴用', 'agentId': 'wuyong', 'scale': 0.50},
]
PERSONA_SPRITE = {
    'songjiang': {'src': 'songjiang-8-direction-v3.webp', 'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'lujunyi': {'src': 'lujunyi-8-direction-v1.webp', 'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'husanniang': {'src': 'husanniang-8-direction-v1.webp', 'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'likui': {'src': 'likui-8-direction-v2.webp', 'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'linchong': {'src': 'linchong-8-direction-v1.webp', 'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'wuyong': {'src': 'wuyong-8-direction-v1.webp', 'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
}


def default_repo_root():
    return str(Path(__file__).resolve().parents[4])


def _props(node):
    result = {}
    pn = node.find('properties')
    if pn is not None:
        for p in pn.findall('property'):
            result[p.get('name', '')] = p.get('value', p.text or '')
    return result


def parse_tmx(filepath):
    root = ET.parse(filepath).getroot()
    fragments, props_list = [], []
    for group in root.findall('objectgroup'):
        group_name = group.get('name', '')
        for obj in group.findall('object'):
            p = _props(obj)
            stable_id = p.get('stableId', '')
            if not stable_id:
                continue
            x, y = float(obj.get('x', 0)), float(obj.get('y', 0))
            w, h = float(obj.get('width', 0)), float(obj.get('height', 0))
            common = {
                'stableId': stable_id, 'sceneId': 'juyiting-main',
                'chunkId': p.get('chunkId', 'props'), 'floorId': p.get('floorId', 'floor-1'),
                'elevation': int(p.get('elevation', 0)), 'renderBand': p.get('renderBand', 'world'),
                'sortMode': p.get('sortMode', 'fixed'),
                'sortAnchor': {'x': float(p.get('sortAnchorX', x)), 'y': float(p.get('sortAnchorY', y))},
                'tieBias': int(p.get('tieBias', 0)), 'assetRef': p.get('assetRef', ''),
                'destinationRect': {'x': x, 'y': y, 'width': w, 'height': h},
            }
            kind = p.get('kind', '')
            if group_name.startswith('v2-fragments') or obj.get('type') == 'occluder-fragment' or kind == 'occluder-fragment':
                common['kind'] = 'fragment'
                common['sourceRect'] = {
                    'x': int(float(p.get('sourceRectX', 0))), 'y': int(float(p.get('sourceRectY', 0))),
                    'width': int(float(p.get('sourceRectW', w))), 'height': int(float(p.get('sourceRectH', h))),
                }
                if common['chunkId'] == 'props' and common['assetRef']:
                    common['chunkId'] = os.path.basename(common['assetRef']).replace('-v2.png', '')
                fragments.append(common)
            elif kind == 'prop':
                common['kind'] = 'prop'
                props_list.append(common)

    image_layers = {}
    for layer in root.findall('imagelayer'):
        image = layer.find('image')
        if image is None:
            continue
        name = layer.get('name', '')
        image_layers[name] = {
            'name': name, 'source': image.get('source', ''),
            'width': int(image.get('width', root.get('width', 0))),
            'height': int(image.get('height', root.get('height', 0))),
            'offsetX': float(layer.get('offsetx', 0)), 'offsetY': float(layer.get('offsety', 0)),
            'opacity': float(layer.get('opacity', 1)), 'tintcolor': layer.get('tintcolor'),
        }
    return fragments, props_list, image_layers


def _js_round(value):
    return math.floor(value + 0.5)


def compute_world_sort_key(obj, floor_registry=None):
    floor_registry = floor_registry or DEFAULT_FLOOR_REGISTRY
    return (
        RENDER_BAND_ORDER[obj.get('renderBand', 'world')],
        floor_registry[obj.get('floorId', 'floor-1')], int(obj.get('elevation', 0)),
        _js_round(float(obj['sortAnchor']['y']) * 256), int(obj.get('tieBias', 0)), obj['stableId'],
    )


def compare_sort_keys(a, b):
    return -1 if a < b else (1 if a > b else 0)


def base_order_sort(objects, floor_registry=None):
    return sorted(objects, key=lambda obj: compute_world_sort_key(obj, floor_registry))


def build_agent_scene_object(persona_code, world_x, world_y):
    if not any(p['personaCode'] == persona_code for p in PERSONAS):
        raise ValueError(f'Unknown persona: {persona_code}')
    return {
        'stableId': f'agent.{persona_code}', 'sceneId': 'juyiting-main', 'chunkId': 'agents',
        'kind': 'agent', 'renderBand': 'world', 'floorId': 'floor-1', 'elevation': 0,
        'sortMode': 'fixed', 'sortAnchor': {'x': world_x, 'y': world_y}, 'tieBias': 0,
        'personaCode': persona_code, 'worldX': world_x, 'worldY': world_y,
    }


def compute_unified_order(fragments, props_list, agent_obj):
    order = base_order_sort([*fragments, *props_list, agent_obj])
    return order, {obj['stableId']: i for i, obj in enumerate(order)}


def build_shot_plan(repo_root=None):
    """Consume, never reconstruct, the authoritative 270 matrix entries."""
    repo_root = os.path.realpath(repo_root or default_repo_root())
    fixture = os.path.join(repo_root, 'tests', 'fixtures', 'juyiting', 'occlusion-e13', 'shot-plan.json')
    with open(fixture, encoding='utf-8') as f:
        authoritative = json.load(f)
    matrix = [copy.deepcopy(s) for s in authoritative.get('shots', []) if s.get('kind') == 'matrix']
    if len(matrix) != 270:
        raise RuntimeError(f'authoritative shot-plan matrix count must be 270, got {len(matrix)}')

    fragments, props_list, image_layers = parse_tmx(os.path.join(repo_root, 'public', 'juyiting', 'hall.tmx'))
    objects = {o['stableId']: o for o in [*fragments, *props_list]}
    seen = set()
    for shot in matrix:
        if shot['id'] in seen:
            raise RuntimeError(f'duplicate authoritative shot id: {shot["id"]}')
        seen.add(shot['id'])
        target = objects.get(shot['targetStableId'])
        if target is None:
            raise RuntimeError(f'{shot["id"]}: target absent from production TMX: {shot["targetStableId"]}')
        if shot['targetKind'] != target['kind']:
            raise RuntimeError(f'{shot["id"]}: targetKind drift: plan={shot["targetKind"]} TMX={target["kind"]}')
        agent = build_agent_scene_object(shot['persona'], shot['world']['x'], shot['world']['y'])
        cmp = compare_sort_keys(compute_world_sort_key(agent), compute_world_sort_key(target))
        shot['resolvedExpectedOrdering'] = 'agent_behind_target' if cmp < 0 else ('agent_in_front' if cmp > 0 else 'tie')
        shot['semanticRelation'] = shot['relation']
        shot['targetAnchor'] = copy.deepcopy(target['sortAnchor'])
        shot['targetRect'] = copy.deepcopy(target['destinationRect'])
        omissions = shot.get('visualOmissions', [])
        if not isinstance(omissions, list) or any(stable_id not in objects for stable_id in omissions):
            raise RuntimeError(f'{shot["id"]}: invalid visualOmissions {omissions}')
    return matrix, fragments, props_list, image_layers

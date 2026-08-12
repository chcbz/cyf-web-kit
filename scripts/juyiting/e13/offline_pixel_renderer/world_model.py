#!/usr/bin/env python3
"""
E13 World Model: TMX parser, sort key computation, shot plan.
Matches production:
  - worldOrder.ts: computeWorldSortKey, compareWorldSortKeys, baseOrderSort
  - hallSceneAssembly.ts: computeUnifiedWorldOrder (base sort, no constraint zones)
  - schema.ts: RENDER_BAND_ORDER, DEFAULT_FLOOR_REGISTRY

Production-identical sort key:
  renderBandOrder → floorOrder → elevation → fixedPointY → tieBias → stableId ASCII bytes
"""
import os
import json
import hashlib
import xml.etree.ElementTree as ET

# ── Production constants from schema.ts ──
RENDER_BAND_ORDER = {
    'background': 0,
    'world': 100,
    'overhead': 200,
    'lighting': 300,
    'world-ui': 400,
    'screen-ui': 500,
}

DEFAULT_FLOOR_REGISTRY = {'floor-1': 0}

# ── E13 personas from world-model.mjs ──
PERSONAS = [
    {'personaCode': 'songjiang',  'name': '宋江',   'agentId': 'songjiang',  'scale': 0.52},
    {'personaCode': 'lujunyi',    'name': '卢俊义', 'agentId': 'lujunyi',    'scale': 0.52},
    {'personaCode': 'husanniang', 'name': '扈三娘', 'agentId': 'husanniang', 'scale': 0.50},
    {'personaCode': 'likui',      'name': '李逵',   'agentId': 'likui',      'scale': 0.56},
    {'personaCode': 'linchong',   'name': '林冲',   'agentId': 'linchong',   'scale': 0.54},
    {'personaCode': 'wuyong',     'name': '吴用',   'agentId': 'wuyong',     'scale': 0.50},
]

RELATIONS = {
    'behind':   {'dy': -34, 'expected': 'agent_behind_target',  'expectedDepth': 'agent < target'},
    'boundary': {'dy': 0,   'expected': 'tie',                  'expectedDepth': 'tie (tieBias/stableId)'},
    'front':    {'dy': +34, 'expected': 'agent_in_front',       'expectedDepth': 'agent > target'},
}

# ── Sprite sheet constants for personas ──
PERSONA_SPRITE = {
    'songjiang':  {'src': 'songjiang-8-direction-v3.webp',  'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'lujunyi':    {'src': 'lujunyi-8-direction-v1.webp',    'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'husanniang': {'src': 'husanniang-8-direction-v1.webp', 'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'likui':      {'src': 'likui-8-direction-v2.webp',      'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'linchong':   {'src': 'linchong-8-direction-v1.webp',   'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
    'wuyong':     {'src': 'wuyong-8-direction-v1.webp',     'frame_w': 128, 'frame_h': 128, 'cols': 8, 'anchor_x': 0.5, 'anchor_y': 0.86},
}


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hashlib.sha256(data).hexdigest()


def parse_tmx(filepath):
    """Parse hall.tmx and return fragments, props, and map properties."""
    tree = ET.parse(filepath)
    root = tree.getroot()

    fragments = []
    props_list = []

    for objgroup in root.findall('.//objectgroup'):
        name = objgroup.get('name', '')

        for obj in objgroup.findall('object'):
            properties = {}
            props_node = obj.find('properties')
            if props_node is not None:
                for p in props_node.findall('property'):
                    properties[p.get('name', '')] = p.get('value', '')

            kind = properties.get('kind', '')
            obj_type = obj.get('type', '')
            stable_id = properties.get('stableId', '')

            if not stable_id:
                continue

            x = float(obj.get('x', 0))
            y = float(obj.get('y', 0))
            w = float(obj.get('width', 0))
            h = float(obj.get('height', 0))

            sort_anchor_x = float(properties.get('sortAnchorX', x))
            sort_anchor_y = float(properties.get('sortAnchorY', y))
            tie_bias = int(properties.get('tieBias', 0))
            asset_ref = properties.get('assetRef', '')
            floor_id = properties.get('floorId', 'floor-1')
            elevation = int(properties.get('elevation', 0))
            chunk_id = properties.get('chunkId', '')
            render_band = properties.get('renderBand', 'world')

            if name.startswith('v2-fragments') or obj_type == 'occluder-fragment' or kind == 'occluder-fragment':
                # Fragment
                src_x = int(float(properties.get('sourceRectX', 0)))
                src_y = int(float(properties.get('sourceRectY', 0)))
                src_w = int(float(properties.get('sourceRectW', w)))
                src_h = int(float(properties.get('sourceRectH', h)))

                # Determine chunk_id from atlas name if not explicit
                if not chunk_id and asset_ref:
                    atlas_name = os.path.basename(asset_ref).replace('-v2.png', '')
                    chunk_id = atlas_name

                fragments.append({
                    'stableId': stable_id,
                    'sceneId': 'juyiting-main',
                    'chunkId': chunk_id,
                    'floorId': floor_id,
                    'elevation': elevation,
                    'renderBand': render_band,
                    'sortMode': 'fixed',
                    'sortAnchor': {'x': sort_anchor_x, 'y': sort_anchor_y},
                    'tieBias': tie_bias,
                    'assetRef': asset_ref,
                    'sourceRect': {'x': src_x, 'y': src_y, 'width': src_w, 'height': src_h},
                    'destinationRect': {'x': x, 'y': y, 'width': w, 'height': h},
                })

            elif kind == 'prop':
                props_list.append({
                    'stableId': stable_id,
                    'sceneId': 'juyiting-main',
                    'chunkId': chunk_id or 'props',
                    'floorId': floor_id,
                    'elevation': elevation,
                    'renderBand': render_band,
                    'sortMode': 'fixed',
                    'sortAnchor': {'x': sort_anchor_x, 'y': sort_anchor_y},
                    'tieBias': tie_bias,
                    'assetRef': asset_ref,
                    'destinationRect': {'x': x, 'y': y, 'width': w, 'height': h},
                    'kind': 'prop',
                })

    return fragments, props_list


def compute_world_sort_key(obj, floor_registry=None):
    """
    Compute deterministic sort key matching production worldOrder.ts.
    Returns a tuple: (renderBandOrder, floorOrder, elevation, fixedPointY, tieBias, stableId)
    """
    if floor_registry is None:
        floor_registry = DEFAULT_FLOOR_REGISTRY

    band = obj.get('renderBand', 'world')
    render_band_order = RENDER_BAND_ORDER.get(band, 100)

    floor_id = obj.get('floorId', 'floor-1')
    floor_order = floor_registry.get(floor_id, 0)

    elevation = int(obj.get('elevation', 0))

    sort_anchor_y = obj['sortAnchor']['y']
    fixed_point_y = round(sort_anchor_y * 256)
    if fixed_point_y == -0:
        fixed_point_y = 0

    tie_bias = int(obj.get('tieBias', 0))
    stable_id = obj['stableId']

    return (render_band_order, floor_order, elevation, fixed_point_y, tie_bias, stable_id)


def compare_stable_ids(a, b):
    """Byte-by-byte ASCII comparison matching compareStableId in worldOrder.ts."""
    for ca, cb in zip(a.encode('ascii'), b.encode('ascii')):
        if ca < cb: return -1
        if ca > cb: return 1
    if len(a) < len(b): return -1
    if len(a) > len(b): return 1
    return 0


def compare_sort_keys(key_a, key_b):
    """Compare two sort keys matching compareWorldSortKeys in worldOrder.ts."""
    for i in range(5):  # first 5 fields are numeric
        if key_a[i] < key_b[i]:
            return -1
        if key_a[i] > key_b[i]:
            return 1
    return compare_stable_ids(key_a[5], key_b[5])


def base_order_sort(objects, floor_registry=None):
    """Sort objects by world sort key. Matches baseOrderSort in worldOrder.ts."""
    decorated = [(compute_world_sort_key(obj, floor_registry), obj) for obj in objects]
    decorated.sort(key=lambda x: (
        x[0][0], x[0][1], x[0][2], x[0][3], x[0][4], x[0][5]
    ))
    return [obj for _, obj in decorated]


def build_agent_scene_object(persona_code, world_x, world_y):
    """Build a pseudo SceneObject for an agent at given world position."""
    persona = next((p for p in PERSONAS if p['personaCode'] == persona_code), None)
    if not persona:
        raise ValueError(f'Unknown persona: {persona_code}')

    return {
        'stableId': f'agent.{persona_code}',
        'sceneId': 'juyiting-main',
        'chunkId': 'agents',
        'kind': 'agent',
        'renderBand': 'world',
        'floorId': 'floor-1',
        'elevation': 0,
        'sortMode': 'fixed',
        'sortAnchor': {'x': world_x, 'y': world_y},
        'tieBias': 0,
        'personaCode': persona_code,
        'worldX': world_x,
        'worldY': world_y,
    }


def compute_unified_order(fragments, props_list, agent_obj):
    """
    Compute unified world order for fragments + props + one agent.
    No constraint zones (none in TMX), so this is pure base sort.
    Returns ordered list of objects and depth map.
    """
    all_objects = list(fragments) + list(props_list) + [agent_obj]
    sorted_objects = base_order_sort(all_objects)

    depths = {}
    for i, obj in enumerate(sorted_objects):
        depths[obj['stableId']] = i

    return sorted_objects, depths


def build_shot_plan(repo_root=None):
    """Build the 270 matrix shot plan matching world-model.mjs buildShotPlan."""
    # First parse TMX to get actual fragments and props
    if repo_root is None:
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    tmx_path = os.path.join(repo_root, 'public', 'juyiting', 'hall.tmx')
    fragments, props_list = parse_tmx(tmx_path)

    # Build targets from fragments and props that match E13 targets
    all_targets = []

    # E13 target stableIds (matching world-model.mjs TARGETS)
    e13_target_ids = {
        'jyt.occ.west-upper.lantern-01.v2',
        'jyt.prop.center-north.main-seat.v1',
        'jyt.prop.northeast.bounty-board.v1',
        'jyt.occ.west-upper.wall-sconce-02.v2',
        'jyt.occ.west-upper.diagonal-brace-01.v2',
        'jyt.occ.east-upper.pillar-01.v2',
        'jyt.occ.west-lower.railing-02.v2',
        'jyt.occ.entrance.hanging-banner-01.v2',
        'jyt.prop.southeast.library-shelf.v1',
        'jyt.occ.east-upper.scroll-table-front-01.v2',
        'jyt.occ.west-lower.railing-01.v2',
        'jyt.occ.east-lower.railing-post-01.v2',
        'jyt.occ.east-upper.pillar-02.v2',
        'jyt.occ.entrance.lantern-post-01.v2',
        'jyt.occ.east-lower.worktable-01.v2',
    }

    # Cell assignments matching world-model.mjs
    cell_map = {
        'jyt.occ.west-upper.lantern-01.v2': 'northwest',
        'jyt.prop.center-north.main-seat.v1': 'north_center',
        'jyt.prop.northeast.bounty-board.v1': 'northeast',
        'jyt.occ.west-upper.wall-sconce-02.v2': 'west_center',
        'jyt.occ.west-upper.diagonal-brace-01.v2': 'center',
        'jyt.occ.east-upper.pillar-01.v2': 'east_center',
        'jyt.occ.west-lower.railing-02.v2': 'southwest',
        'jyt.occ.entrance.hanging-banner-01.v2': 'south_center',
        'jyt.prop.southeast.library-shelf.v1': 'southeast',
        'jyt.occ.east-upper.scroll-table-front-01.v2': 'northeast',
        'jyt.occ.west-lower.railing-01.v2': 'south_center',
        'jyt.occ.east-lower.railing-post-01.v2': 'southeast',
        'jyt.occ.east-upper.pillar-02.v2': 'southeast',
        'jyt.occ.entrance.lantern-post-01.v2': 'south_center',
        'jyt.occ.east-lower.worktable-01.v2': 'southeast',
    }

    focus_ids = {
        'jyt.prop.northeast.bounty-board.v1',
        'jyt.occ.east-upper.pillar-01.v2',
        'jyt.occ.west-lower.railing-02.v2',
        'jyt.occ.entrance.hanging-banner-01.v2',
        'jyt.prop.southeast.library-shelf.v1',
        'jyt.occ.east-upper.scroll-table-front-01.v2',
        'jyt.occ.west-lower.railing-01.v2',
        'jyt.occ.east-lower.railing-post-01.v2',
        'jyt.occ.east-upper.pillar-02.v2',
        'jyt.occ.entrance.lantern-post-01.v2',
        'jyt.occ.east-lower.worktable-01.v2',
    }

    for obj in fragments + props_list:
        sid = obj['stableId']
        if sid in e13_target_ids:
            all_targets.append({
                'stableId': sid,
                'kind': obj.get('kind', 'fragment'),
                'cell': cell_map.get(sid, 'center'),
                'focus': sid in focus_ids,
                'anchor': obj['sortAnchor'],
                'tieBias': obj['tieBias'],
                'rect': obj.get('destinationRect', obj.get('sourceRect', {'x': 0, 'y': 0, 'width': 0, 'height': 0})),
            })

    shots = []
    seq = 0
    for target in all_targets:
        for persona in PERSONAS:
            for rel_name, rel_def in RELATIONS.items():
                seq += 1
                world_x = target['anchor']['x']
                world_y = target['anchor']['y'] + rel_def['dy']
                shots.append({
                    'id': f'E13-{seq:03d}',
                    'kind': 'matrix',
                    'cell': target['cell'],
                    'targetStableId': target['stableId'],
                    'targetKind': target['kind'],
                    'focus': target['focus'],
                    'persona': persona['personaCode'],
                    'personaName': persona['name'],
                    'relation': rel_name,
                    'world': {'x': world_x, 'y': world_y},
                    'expectedRelation': rel_def['expected'],
                    'expectedDepth': rel_def['expectedDepth'],
                    'viewport': {'width': 1280, 'height': 800},
                    'camera': {'center': {'x': target['anchor']['x'], 'y': target['anchor']['y']}, 'zoom': 1.1},
                    'targetAnchor': target['anchor'],
                    'targetRect': target['rect'],
                })

    return shots, fragments, props_list

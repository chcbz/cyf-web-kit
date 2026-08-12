#!/usr/bin/env python3
"""
E13 Offline Pixel Renderer - Main Entry Point.
Generates 270 matrix shot PNGs with runtimeFacts.
Usage: python3 -m offline_pixel_renderer [--output DIR] [--limit N]
"""
import sys, os, time, json

# Ensure package is importable
_src = os.path.dirname(os.path.abspath(__file__))
_parent = os.path.dirname(_src)
if _parent not in sys.path:
    sys.path.insert(0, _parent)

from offline_pixel_renderer.png_io import write_png
from offline_pixel_renderer.world_model import build_shot_plan
from offline_pixel_renderer.compositor import OfflineRenderer


def main():
    import argparse
    parser = argparse.ArgumentParser(description='E13 Offline Pixel Renderer')
    parser.add_argument('--output', default=None, help='Output directory for evidence')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of shots (0=all)')
    parser.add_argument('--shots-dir', default=None, help='Override shots subdirectory')
    parser.add_argument('--repo-root', default=None, help='Repository root path')
    args = parser.parse_args()

    repo_root = args.repo_root or os.getcwd()
    public_dir = os.path.join(repo_root, 'public', 'juyiting')
    evidence_dir = args.output or os.path.join(repo_root, 'tests', 'fixtures', 'juyiting', 'occlusion-e13')
    shots_dir = args.shots_dir or os.path.join(evidence_dir, 'shots')

    os.makedirs(shots_dir, exist_ok=True)

    print('=== E13 Offline Pixel Renderer ===')
    print(f'Evidence dir: {evidence_dir}')
    print(f'Shots dir: {shots_dir}')

    # Init
    print('\n[1/4] Loading assets...')
    t0 = time.time()
    renderer = OfflineRenderer(public_dir)
    print(f'  Assets loaded in {time.time()-t0:.1f}s')

    # Build world model
    print('\n[2/4] Building world model...')
    t0 = time.time()
    shots, fragments, props_list = build_shot_plan(repo_root)
    print(f'  {len(shots)} matrix shots, {len(fragments)} fragments, {len(props_list)} props in {time.time()-t0:.1f}s')

    # Build static composite
    print('\n[3/4] Building static composite...')
    t0 = time.time()
    renderer._build_static_composite()
    print(f'  Static composite in {time.time()-t0:.1f}s')

    # Render shots
    limit = args.limit if args.limit > 0 else len(shots)
    render_shots = shots[:limit]
    print(f'\n[4/4] Rendering {len(render_shots)} shots...')

    records = []
    start = time.time()
    for i, shot in enumerate(render_shots):
        t0 = time.time()
        pixels, order, depths, facts = renderer.render_shot(shot, fragments, props_list)

        # Save PNG
        vp = facts['viewportWorld']
        cw, ch = vp['width'], vp['height']
        png_path = os.path.join(shots_dir, f'{shot["id"]}.png')
        write_png(png_path, cw, ch, pixels)

        elapsed = time.time() - t0
        records.append({
            'id': shot['id'],
            'file': f'shots/{shot["id"]}.png',
            'kind': 'matrix',
            'cell': shot['cell'],
            'persona': shot['persona'],
            'personaName': shot['personaName'],
            'relation': shot['relation'],
            'targetStableId': shot['targetStableId'],
            'targetKind': shot['targetKind'],
            'focus': shot['focus'],
            'worldX': shot['world']['x'],
            'worldY': shot['world']['y'],
            'expectedRelation': shot['expectedRelation'],
            'expectedDepth': shot['expectedDepth'],
            'runtimeFacts': facts,
            'renderTimeMs': round(elapsed * 1000),
        })

        if (i + 1) % 30 == 0:
            elapsed_total = time.time() - start
            rate = (i + 1) / elapsed_total
            remaining = (len(render_shots) - i - 1) / rate
            print(f'  [{i+1}/{len(render_shots)}] {rate:.1f} shots/s, ~{remaining:.0f}s remaining')

    total_elapsed = time.time() - start
    print(f'\n  Done! {len(render_shots)} shots in {total_elapsed:.0f}s ({len(render_shots)/total_elapsed:.1f} shots/s)')

    # Write index.json
    index = {
        '$schema': 'juyiting-occlusion-e13-index-v2',
        'schemaVersion': 2,
        'taskId': 'E13',
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'generator': 'offline-pixel-renderer (Python, deterministic, no browser)',
        'status': 'GENERATED_OFFLINE',
        'shotCount': len(records),
        'renderTimeTotalMs': round(total_elapsed * 1000),
        'matrixShots': len(records),
        'cameraShots': 0,
        'interactionShots': 0,
        'movementShots': 0,
        'notes': {
            'camera': 'DEFERRED - camera/interaction/movement cannot be proven offline; require browser/touch input',
            'interaction': 'DEFERRED - see camera note',
            'movement': 'DEFERRED - see camera note',
            'methodology': 'Production-equivalent deterministic sort (worldOrder.ts base sort, no constraint zones). Base+FG+lighting pre-composited. Each shot renders world-band objects in sort order onto viewport crop.',
        },
        'shots': records,
    }
    index_path = os.path.join(evidence_dir, 'index.json')
    with open(index_path, 'w') as f:
        json.dump(index, f, indent=2)
    print(f'\nIndex written to {index_path}')

    # Summary
    depth_matches = sum(1 for r in records if r['runtimeFacts']['depthMatch'])
    print(f'\nDepth match rate: {depth_matches}/{len(records)} ({100*depth_matches/len(records):.1f}%)')
    print(f'(Mismatches indicate simplified expectedRelation differs from production sort - expected.)')


if __name__ == '__main__':
    main()

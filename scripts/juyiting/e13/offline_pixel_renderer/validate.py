#!/usr/bin/env python3
"""Fail-closed validator for authoritative offline E13 matrix evidence."""
import argparse, hashlib, json, os, sys
from .png_io import read_png, webp_decoder_provenance
from .compositor import OfflineRenderer
from .world_model import build_shot_plan

BIND_FIELDS=('id','kind','cell','probeCell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera','evidenceContext','contextCompanionStableId','visualOmissions','probeKind','visualExerciseContract','visualOverlay','maxAgentOcclusionRatio','navValidation','probeRationale')
PIXEL_KEYS=('method','visibilityMethod','hasAlphaOverlap','agentOpaquePixelsInAabb','targetOpaquePixelsInAabb','opaqueIntersectionPixels','alphaWeightedIntersection','finalCompositeChangedByTargetPixels','finalCompositeChangedByAgentPixels','visibleOcclusionPixels','agentPixelsVisiblyOccludedByTarget','targetPixelsVisiblyOccludedByAgent','overlapBounds')

def _sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()

def validate(evidence_dir, repo_root, write_recompute_report=False):
    results=[]
    def check(name,ok,detail=''):
        results.append({'check':name,'ok':bool(ok),'detail':str(detail)}); return bool(ok)
    def read(path):
        with open(path,encoding='utf-8') as f:return json.load(f)
    index_path=os.path.join(evidence_dir,'index.json')
    if not os.path.exists(index_path): check('index.json exists',False); return results
    index=read(index_path); shots=index.get('shots',[])
    canonical=read(os.path.join(repo_root,'tests/fixtures/juyiting/occlusion-e13/shot-plan.json'))
    matrix=[s for s in canonical['shots'] if s.get('kind')=='matrix']
    check('authoritative matrix/index count = 270',len(matrix)==len(shots)==270,f'{len(matrix)}/{len(shots)}')
    # Independent derivation inputs: re-parse the production TMX and rebuild the
    # deterministic production stack. Committed runtimeFacts are not consulted.
    try:
        _built, fragments, props, layers = build_shot_plan(repo_root)
    except Exception as exc:
        check('fail-closed: production TMX/shot-plan derivation', False, exc)
        return results
    stack_meta = index.get('productionVisualStack', {})
    render_policy = {
        'depthBands': stack_meta.get('depthBands', {}),
        'legacyOccluderLayers': stack_meta.get('legacyMidForeground', {}).get('layerNames'),
    }
    try:
        renderer = OfflineRenderer(os.path.join(repo_root, 'public', 'juyiting'), layers, render_policy)
    except Exception as exc:
        check('fail-closed: production render stack derivation', False, exc)
        return results
    drift=[]
    for i,plan in enumerate(matrix):
        if i>=len(shots): drift.append(f'{plan["id"]}:missing'); continue
        actual=shots[i]
        for field in BIND_FIELDS:
            if actual.get(field)!=plan.get(field): drift.append(f'{plan["id"]}:{field}')
    check('index is field-bound to authoritative shot-plan in order',not drift,'; '.join(drift[:12]))
    check('GENERATED_OFFLINE matrix-only status',index.get('status')=='GENERATED_OFFLINE' and index.get('matrixShots')==270)
    check('matrix pass true / final release pass false',index.get('matrixPass') is True and index.get('releasePass') is False)
    check('camera/interaction/movement independently DEFERRED',all('DEFERRED' in index.get('notes',{}).get(k,'') for k in ('camera','interaction','movement')))
    check('audit sample is idle/down/frame0',index.get('sampledFrame',{}).get('animation')=='idle' and index.get('sampledFrame',{}).get('direction')=='down' and index.get('sampledFrame',{}).get('frame')==0)
    frames=index.get('frameAlphaBoundsChecks',{})
    check('idle-down frame0/1/2/3 alpha bounds invariant checked',len(frames)==6 and all(v.get('reviewInvariantPass') and [x.get('frame') for x in v.get('frames',[])]==[0,1,2,3] for v in frames.values()))
    try: expected_decoder=webp_decoder_provenance(); decoder_ok=index.get('webpDecoder')==expected_decoder
    except Exception as exc: expected_decoder={}; decoder_ok=False; check('WebP decoder provenance fail-closed',False,exc)
    else: check('WebP decoder provenance fail-closed',decoder_ok)
    stack=index.get('productionVisualStack',{})
    bands=stack.get('depthBands',{})
    check('repaired production bands keep base < V2 world < lighting < UI',stack.get('fixedDepths')=={'base':0,'lighting-overlay':300} and bands=={'BASE_MIN':0,'BASE_MAX_EXCLUSIVE':100,'V2_WORLD_START':100,'V2_WORLD_STRIDE':1,'ERROR_STATE_PROP_DEPTH':6,'ERROR_STATE_AGENT_DEPTH':7,'LIGHTING':300,'WORLD_UI':400,'SCREEN_UI':500})
    check('TMX lighting is screen + multiply tint at opacity 0.85',stack.get('lighting')=={'opacity':0.85,'tintcolor':'#ffd8a0','imageBlend':'screen','tintBlend':'multiply'})
    raster=stack.get('canvasRaster',{})
    check('production antiAlias sampling and browser-bit caveat recorded',raster.get('productionAntiAlias') is True and 'bilinear' in raster.get('scaledSpriteSampling','') and raster.get('browserCanvasBitIdentityClaim') is False)
    legacy=stack.get('legacyMidForeground',{})
    check('legacy mid/foreground are absent in V2 and restored only for V1',legacy.get('v2Attached') is False and legacy.get('v1Restored') is True and legacy.get('sameBytes') is True and legacy.get('midSha256')==legacy.get('foregroundSha256'))
    bad=[]; png_bad=[]; png_hash_bad=[]; alpha_bad=[]; recompute_bad=[]; recomputed={}
    for shot in shots:
        facts=shot.get('runtimeFacts',{})
        if facts.get('shotId')!=shot.get('id') or facts.get('resolvedExpectedOrdering')!=shot.get('resolvedExpectedOrdering') or facts.get('ordering')!=shot.get('resolvedExpectedOrdering') or facts.get('depthMatch') is not True:
            bad.append(shot.get('id'))
        overlap=facts.get('pixelOverlap',{})
        mapped_ok=isinstance(facts.get('actualRenderDepth'),int) and isinstance(facts.get('targetRenderDepth'),int) and facts.get('actualRenderDepth')==100+facts.get('actualDepth',-1000) and facts.get('targetRenderDepth')==100+facts.get('targetDepth',-1000) and facts.get('actualRenderDepth')<300 and facts.get('targetRenderDepth')<300
        if overlap.get('method')!='source-alpha-intersection-plus-final-composite-difference' or not isinstance(overlap.get('opaqueIntersectionPixels'),int) or not isinstance(overlap.get('visibleOcclusionPixels'),int) or not isinstance(overlap.get('finalCompositeChangedByTargetPixels'),int) or not isinstance(overlap.get('finalCompositeChangedByAgentPixels'),int) or not mapped_ok: alpha_bad.append(shot.get('id'))
        file=shot.get('screenshotFile',''); path=os.path.join(evidence_dir,file)
        try:
            with open(path, 'rb') as f:
                png_bytes = f.read()
            committed_sha = shot.get('sha256')
            if not committed_sha or _sha256_bytes(png_bytes) != committed_sha:
                png_hash_bad.append(shot.get('id'))
            w,h,_,pixels=read_png(path)
            if (w,h)!=(400,300):
                png_bad.append(f'{shot.get("id")}:{w}x{h}')
            else:
                try:
                    recomputed[shot['id']]=renderer.recompute_pixel_overlap(shot, fragments, props, pixels)
                except Exception as exc:
                    recompute_bad.append(f'{shot.get("id")}:{exc}')
        except Exception as exc: png_bad.append(f'{shot.get("id")}:{exc}')
    check('all 270 resolved production depths match',not bad,','.join(bad[:10]))
    check('all shots report mapped depths plus alpha/final-composite metrics',not alpha_bad,','.join(alpha_bad[:10]))
    check('all 270 pixelOverlap facts independently recomputed from production assets and final-composite PNGs',not recompute_bad,'; '.join(recompute_bad[:8]))
    overlap_drift=[]
    for shot in shots:
        committed=shot.get('runtimeFacts',{}).get('pixelOverlap',{})
        rec=recomputed.get(shot['id'])
        if rec is None: continue
        for key in PIXEL_KEYS:
            if committed.get(key) != rec.get(key):
                overlap_drift.append(f'{shot["id"]}:{key}:{committed.get(key)}!={rec.get(key)}')
    check('270/270 committed pixelOverlap fields match independent recompute',not overlap_drift,'; '.join(overlap_drift[:10]))
    target_viewports={}
    viewport_drift=[]
    for shot in shots:
        target=shot.get('targetStableId')
        viewport=shot.get('runtimeFacts',{}).get('viewportWorld')
        canonical_viewport=target_viewports.setdefault(target,viewport)
        if viewport != canonical_viewport:
            viewport_drift.append(f'{shot.get("id")}:{viewport}!={canonical_viewport}')
    check('all 18 shots for each target reuse one fixed viewportWorld',not viewport_drift,'; '.join(viewport_drift[:12]))
    probe_bad=[]; context_bad=[]; composite_bad=[]; occlusion_ratio_bad=[]
    for shot in shots:
        if shot.get('probeKind') == 'target-specific':
            nav=shot.get('navValidation',{})
            overlap=shot.get('runtimeFacts',{}).get('pixelOverlap',{})
            reachable=nav.get('reachability',{}).get('status') == 'found' and nav.get('reachability',{}).get('colliderWidth') == 42
            target_each=shot.get('visualExerciseContract') == 'target-each-shot'
            transition_sample=shot.get('visualExerciseContract') in ('ownership-transition','composite-transition') and shot.get('relation') == 'behind'
            visibly_exercised=overlap.get('opaqueIntersectionPixels',0) > 0 and overlap.get('visibleOcclusionPixels',0) > 0
            if nav.get('navigable') is not True or not reachable or ((target_each or transition_sample) and not visibly_exercised):
                probe_bad.append(shot.get('id'))
            if shot.get('visualExerciseContract') == 'composite-transition':
                if shot.get('evidenceContext') != 'in-context' or shot.get('visualOmissions') or (shot.get('relation') == 'behind' and not visibly_exercised):
                    composite_bad.append(shot.get('id'))
            limit=shot.get('maxAgentOcclusionRatio')
            if limit is not None and shot.get('relation') == 'behind' and shot.get('runtimeFacts',{}).get('ordering') == 'agent_behind_target':
                agent_pixels=overlap.get('agentOpaquePixelsInAabb',0)
                ratio=(overlap.get('agentPixelsVisiblyOccludedByTarget',0)/agent_pixels) if agent_pixels else 0
                if ratio > limit:
                    occlusion_ratio_bad.append(f'{shot.get("id")}:{ratio:.3f}>{limit}')
        context=shot.get('evidenceContext')
        omissions=shot.get('visualOmissions',[])
        companion=shot.get('contextCompanionStableId')
        if context == 'target-isolated':
            if not companion or omissions != [companion] or shot.get('runtimeFacts',{}).get('visualOmissions') != omissions:
                context_bad.append(shot.get('id'))
        elif context != 'in-context' or omissions:
            context_bad.append(shot.get('id'))
    check('target-specific probes are production reachable and satisfy their visual exercise contract',not probe_bad,','.join(probe_bad[:12]))
    check('composite-transition probes use real context and visibly exercise behind',not composite_bad,','.join(composite_bad[:12]))
    check('declared agent occlusion ratios stay within visual readability limits',not occlusion_ratio_bad,','.join(occlusion_ratio_bad[:12]))
    check('isolated audit context omits only its declared independent companion',not context_bad,','.join(context_bad[:12]))
    check('all screenshotFile PNGs are 400x300',not png_bad,'; '.join(png_bad[:8]))
    check('270/270 screenshotFile PNG bytes match committed sha256',not png_hash_bad,'; '.join(png_hash_bad[:8]))
    for persona in ('lujunyi','husanniang'):
        critical=next((s for s in shots if s['persona']==persona and s['relation']=='behind' and s['targetStableId']=='jyt.prop.northeast.bounty-board.v1'),None)
        ok=critical and critical['runtimeFacts']['ordering']=='agent_behind_target' and critical['runtimeFacts']['pixelOverlap']['opaqueIntersectionPixels']>0 and critical['runtimeFacts']['pixelOverlap']['agentPixelsVisiblyOccludedByTarget']>0 and critical['runtimeFacts']['drawIndices']['target']>critical['runtimeFacts']['drawIndices']['agent']
        check(f'{persona} behind bounty-board has target-after-agent final-composite occlusion',ok)
    front=next((s for s in shots if s['persona']=='lujunyi' and s['relation']=='front' and s['targetStableId']=='jyt.prop.center-north.main-seat.v1'),None)
    check('lujunyi front main-seat has agent-after-target final-composite evidence',front and front['runtimeFacts']['ordering']=='agent_in_front' and front['runtimeFacts']['pixelOverlap']['opaqueIntersectionPixels']>0 and front['runtimeFacts']['pixelOverlap']['targetPixelsVisiblyOccludedByAgent']>0 and front['runtimeFacts']['drawIndices']['agent']>front['runtimeFacts']['drawIndices']['target'])
    sheets=os.path.join(evidence_dir,'contact-sheets')
    files=[f for f in os.listdir(sheets) if f.endswith('.png')] if os.path.isdir(sheets) else []
    check('15 labeled PNG contact sheets exist',len(files)==15,f'got {len(files)}')
    if write_recompute_report:
        report = {
            '$schema': 'juyiting-occlusion-e13-pixel-recompute-v1',
            'taskId': 'E13',
            'pass': bool(not recompute_bad and not overlap_drift and not png_hash_bad and len(recomputed) == len(shots)),
            'matrixShots': len(shots),
            'indexSha256': _sha256_bytes(open(index_path, 'rb').read()),
            'methodology': 'offline_pixel_renderer.compositor re-derives each overlap region from production assets (persona sprite alpha, TMX target source/destination rects) and the committed final-composite PNG; runtimeFacts.pixelOverlap is never read.',
            'recomputed': recomputed,
            'drift': overlap_drift,
            'errors': recompute_bad,
            'pngSha256Drift': png_hash_bad,
        }
        report_path = os.path.join(evidence_dir, 'pixel-recompute-report.json')
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2); f.write('\n')
    print(f'Python E13 validator: {sum(r["ok"] for r in results)}/{len(results)} checks passed')
    for r in results:
        if not r['ok']: print(f'  FAIL {r["check"]}: {r["detail"]}')
    return results

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo-root', default=os.getcwd())
    ap.add_argument('--evidence-dir', default=None)
    ap.add_argument('--write-recompute-report', action='store_true', help='write pixel-recompute-report.json after the independent pixel recompute')
    args=ap.parse_args()
    evidence=args.evidence_dir or os.path.join(args.repo_root,'tests/fixtures/juyiting/occlusion-e13')
    results=validate(os.path.realpath(evidence), os.path.realpath(args.repo_root), write_recompute_report=args.write_recompute_report)
    sys.exit(0 if all(r['ok'] for r in results) else 1)
if __name__=='__main__': main()

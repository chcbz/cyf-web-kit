#!/usr/bin/env python3
"""Fail-closed validator for authoritative offline E13 matrix evidence."""
import argparse, json, os, sys
from .png_io import read_png, webp_decoder_provenance

BIND_FIELDS=('id','kind','cell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera')

def validate(evidence_dir, repo_root):
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
    check('fixed layer depths are production 0/2/5/8',stack.get('fixedDepths')=={'base':0,'mid-occluders':2,'foreground-occluders':5,'lighting-overlay':8})
    check('TMX lighting is screen + multiply tint at opacity 0.85',stack.get('lighting')=={'opacity':0.85,'tintcolor':'#ffd8a0','imageBlend':'screen','tintBlend':'multiply'})
    raster=stack.get('canvasRaster',{})
    check('production antiAlias sampling and browser-bit caveat recorded',raster.get('productionAntiAlias') is True and 'bilinear' in raster.get('scaledSpriteSampling','') and raster.get('browserCanvasBitIdentityClaim') is False)
    duplicate=stack.get('midForegroundDuplicate',{})
    check('mid and foreground same bytes and deliberately drawn twice',duplicate.get('drawnTwice') is True and duplicate.get('sameBytes') is True and duplicate.get('midSha256')==duplicate.get('foregroundSha256'))
    bad=[]; png_bad=[]; alpha_bad=[]
    for shot in shots:
        facts=shot.get('runtimeFacts',{})
        if facts.get('shotId')!=shot.get('id') or facts.get('resolvedExpectedOrdering')!=shot.get('resolvedExpectedOrdering') or facts.get('ordering')!=shot.get('resolvedExpectedOrdering') or facts.get('depthMatch') is not True:
            bad.append(shot.get('id'))
        overlap=facts.get('pixelOverlap',{})
        if overlap.get('method')!='source-alpha-mask-intersection' or not isinstance(overlap.get('opaqueIntersectionPixels'),int) or not isinstance(overlap.get('visibleOcclusionPixels'),int): alpha_bad.append(shot.get('id'))
        file=shot.get('screenshotFile',''); path=os.path.join(evidence_dir,file)
        try:
            w,h,_,_=read_png(path)
            if (w,h)!=(400,300): png_bad.append(f'{shot.get("id")}:{w}x{h}')
        except Exception as exc: png_bad.append(f'{shot.get("id")}:{exc}')
    check('all 270 resolved production depths match',not bad,','.join(bad[:10]))
    check('all shots report true alpha-pixel metrics',not alpha_bad,','.join(alpha_bad[:10]))
    check('all screenshotFile PNGs are 400x300',not png_bad,'; '.join(png_bad[:8]))
    for persona in ('lujunyi','husanniang'):
        critical=next((s for s in shots if s['persona']==persona and s['relation']=='behind' and s['targetStableId']=='jyt.prop.northeast.bounty-board.v1'),None)
        ok=critical and critical['runtimeFacts']['ordering']=='agent_behind_target' and critical['runtimeFacts']['pixelOverlap']['opaqueIntersectionPixels']>0 and critical['runtimeFacts']['pixelOverlap']['agentPixelsOccludedByTarget']>0 and critical['runtimeFacts']['drawIndices']['target']>critical['runtimeFacts']['drawIndices']['agent']
        check(f'{persona} behind bounty-board has target-after-agent alpha occlusion',ok)
    front=next((s for s in shots if s['persona']=='lujunyi' and s['relation']=='front' and s['targetStableId']=='jyt.prop.center-north.main-seat.v1'),None)
    check('lujunyi front main-seat has agent-after-target alpha evidence',front and front['runtimeFacts']['ordering']=='agent_in_front' and front['runtimeFacts']['pixelOverlap']['opaqueIntersectionPixels']>0 and front['runtimeFacts']['pixelOverlap']['targetPixelsOccludedByAgent']>0 and front['runtimeFacts']['drawIndices']['agent']>front['runtimeFacts']['drawIndices']['target'])
    sheets=os.path.join(evidence_dir,'contact-sheets')
    files=[f for f in os.listdir(sheets) if f.endswith('.png')] if os.path.isdir(sheets) else []
    check('15 labeled PNG contact sheets exist',len(files)==15,f'got {len(files)}')
    print(f'Python E13 validator: {sum(r["ok"] for r in results)}/{len(results)} checks passed')
    for r in results:
        if not r['ok']: print(f'  FAIL {r["check"]}: {r["detail"]}')
    return results

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--repo-root',default=os.getcwd()); ap.add_argument('--evidence-dir',default=None); args=ap.parse_args()
    evidence=args.evidence_dir or os.path.join(args.repo_root,'tests/fixtures/juyiting/occlusion-e13')
    sys.exit(0 if all(r['ok'] for r in validate(os.path.realpath(evidence),os.path.realpath(args.repo_root))) else 1)
if __name__=='__main__': main()

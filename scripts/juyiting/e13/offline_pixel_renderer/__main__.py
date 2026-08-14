#!/usr/bin/env python3
"""CLI for deterministic E13 shot/index/contact-sheet generation."""
import argparse, copy, hashlib, json, os, shutil, sys
from .compositor import OfflineRenderer, PixelBuffer
from .png_io import write_png, read_png, webp_decoder_provenance
from .text import draw_text
from .world_model import build_shot_plan, default_repo_root, PERSONAS


def sha(path):
    h=hashlib.sha256(); h.update(open(path,'rb').read()); return h.hexdigest()


def draw_rect_outline(buffer, x, y, width, height, rgba, clip, thickness=2):
    """Draw a diagnostic outline without modifying the authoritative shot PNG."""
    cx, cy, cw, ch = clip
    x0=max(cx,int(round(x))); y0=max(cy,int(round(y)))
    x1=min(cx+cw,int(round(x+width))); y1=min(cy+ch,int(round(y+height)))
    if x0>=x1 or y0>=y1:return
    for yy in range(y0,y1):
        for xx in range(x0,x1):
            if xx < x0+thickness or xx >= x1-thickness or yy < y0+thickness or yy >= y1-thickness:
                i=(yy*buffer.width+xx)*4; buffer.pixels[i:i+4]=bytes(rgba)


def draw_crosshair(buffer, x, y, rgba, clip, radius=3):
    cx, cy, cw, ch=clip; px=int(round(x)); py=int(round(y))
    for xx in range(max(cx,px-radius),min(cx+cw,px+radius+1)):
        if cy<=py<cy+ch:
            i=(py*buffer.width+xx)*4; buffer.pixels[i:i+4]=bytes(rgba)
    for yy in range(max(cy,py-radius),min(cy+ch,py+radius+1)):
        if cx<=px<cx+cw:
            i=(yy*buffer.width+px)*4; buffer.pixels[i:i+4]=bytes(rgba)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo-root', default=default_repo_root())
    ap.add_argument('--output', default=None)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--target', action='append', default=[], help='render only this targetStableId (repeatable)')
    ap.add_argument('--shot-id', action='append', default=[], help='render only this shot id (repeatable)')
    ap.add_argument('--preserve-existing', action='store_true', help='merge selected shots into an existing complete index')
    ap.add_argument('--skip-contact-sheets', action='store_true', help='update PNG/index only; rebuild sheets in a final pass')
    ap.add_argument('--finalize-only', action='store_true', help='rebind existing records and rebuild contact sheets without rendering shots')
    ap.add_argument('--contact-target', action='append', default=[], help='rebuild only this target contact sheet (repeatable)')
    ap.add_argument('--render-policy-json', required=True, help='JSON exported from production hallSceneDepthBands.js')
    args=ap.parse_args()
    repo=os.path.realpath(args.repo_root)
    output=os.path.realpath(args.output or os.path.join(repo,'tests/fixtures/juyiting/occlusion-e13'))
    shots_dir=os.path.join(output,'shots'); contacts=os.path.join(output,'contact-sheets')
    os.makedirs(shots_dir,exist_ok=True); os.makedirs(contacts,exist_ok=True)
    if not args.preserve_existing:
        for d in (shots_dir,contacts):
            for name in os.listdir(d):
                path=os.path.join(d,name)
                if os.path.isfile(path): os.unlink(path)
    try:
        render_policy=json.loads(args.render_policy_json)
    except Exception as exc:
        raise RuntimeError(f'fail-closed: invalid production render policy JSON: {exc}')
    shots,fragments,props,layers=build_shot_plan(repo)
    object_by_stable_id={o['stableId']:o for o in [*fragments,*props]}
    target_filter=set(args.target); shot_filter=set(args.shot_id)
    selected=[] if args.finalize_only else [shot for shot in shots if (not target_filter or shot['targetStableId'] in target_filter) and (not shot_filter or shot['id'] in shot_filter)]
    selected=selected[:args.limit] if args.limit else selected
    if not args.finalize_only and (args.target or args.shot_id) and not selected:
        raise RuntimeError(f'no shots matched target={args.target} shot-id={args.shot_id}')
    renderer=OfflineRenderer(os.path.join(repo,'public','juyiting'),layers,render_policy)
    existing_records=[]
    existing_index_path=os.path.join(output,'index.json')
    if args.preserve_existing and os.path.isfile(existing_index_path):
        with open(existing_index_path,encoding='utf-8') as f: existing_records=json.load(f).get('shots',[])
    records=[]
    for i,shot in enumerate(selected):
        pixels,order,depths,facts=renderer.render_shot_small(shot,fragments,props,400,300)
        name=f'{shot["id"]}.png'; path=os.path.join(shots_dir,name)
        write_png(path,400,300,pixels)
        record={k:shot[k] for k in ('id','kind','cell','probeCell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera','evidenceContext','contextCompanionStableId','visualOmissions','probeKind','visualExerciseContract','visualOverlay','maxAgentOcclusionRatio','navValidation','probeRationale')}
        record.update({'semanticRelation':shot['relation'],'resolvedExpectedOrdering':shot['resolvedExpectedOrdering'],'screenshotFile':f'shots/{name}','sha256':sha(path),'runtimeFacts':facts})
        records.append(record)
        if (i+1)%45==0: print(f'[{i+1}/{len(selected)}]',flush=True)
    if args.preserve_existing or args.finalize_only:
        updated={r['id']:r for r in records}
        prior={r['id']:r for r in existing_records}
        merged=[]
        bind_fields=('id','kind','cell','probeCell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera','evidenceContext','contextCompanionStableId','visualOmissions','probeKind','visualExerciseContract','visualOverlay','maxAgentOcclusionRatio','navValidation','probeRationale')
        for shot in shots:
            record=updated.get(shot['id']) or prior.get(shot['id'])
            if record is None:
                raise RuntimeError(f'preserve-existing index missing {shot["id"]}')
            rebound={key:copy.deepcopy(shot[key]) for key in bind_fields}
            rebound.update({key:value for key,value in record.items() if key not in bind_fields})
            merged.append(rebound)
        records=merged
    if args.finalize_only and existing_records and os.path.isfile(existing_index_path):
        with open(existing_index_path,encoding='utf-8') as f: prior_index=json.load(f)
        frame_checks=prior_index.get('frameAlphaBoundsChecks', {})
        decoder_provenance=prior_index.get('webpDecoder')
    else:
        frame_checks={p['personaCode']:renderer.frame_alpha_bounds(p['personaCode']) for p in PERSONAS}
        decoder_provenance=webp_decoder_provenance()
    mid=os.path.join(repo,'public/juyiting',layers['mid-occluders']['source'])
    foreground=os.path.join(repo,'public/juyiting',layers['foreground-occluders']['source'])
    if not os.path.isfile(mid) or not os.path.isfile(foreground):
        raise RuntimeError('fail-closed: production legacy occluder resources missing')
    index={
      '$schema':'juyiting-occlusion-e13-index-v3','schemaVersion':3,'taskId':'E13','status':'GENERATED_OFFLINE',
      'generator':'scripts/juyiting/e13/generate-e13-offline-evidence.mjs + offline_pixel_renderer',
      'shotCount':len(records),'matrixShots':len(records),'cameraShots':0,'interactionShots':0,'movementShots':0,
      'matrixPass':len(records)==270 and all(r['runtimeFacts']['depthMatch'] for r in records),'releasePass':False,
      'sampledFrame':{'animation':'idle','direction':'down','frame':0,'claim':'single deterministic audit sampling frame, not full animation evidence'},
      'frameAlphaBoundsChecks':frame_checks,'webpDecoder':decoder_provenance,
      'productionVisualStack':{
        'effectiveDrawOrder':'base background, mapped contiguous V2 world band, then independent lighting; ascending melonJS z',
        'canvasRaster':{'productionAntiAlias':True,'scaledSpriteSampling':'premultiplied-RGBA bilinear at destination pixel centers','browserCanvasBitIdentityClaim':False,'difference':'browser Canvas2D backend-specific edge/color rounding is not claimed bit-identical; layer, blend, source/destination geometry, ordering, and final-composite-difference semantics are reproduced deterministically'},
        'depthBands':render_policy['depthBands'],
        'v2WorldMapping':{'formula':'V2_WORLD_START + logicalDepth * V2_WORLD_STRIDE','logicalDepthsRemainContiguous':True},
        'fixedDepths':{'base':render_policy['depthBands']['BASE_MIN'],'lighting-overlay':render_policy['depthBands']['LIGHTING']},
        'lighting':{'opacity':layers['lighting-overlay']['opacity'],'tintcolor':layers['lighting-overlay']['tintcolor'],'imageBlend':'screen','tintBlend':'multiply'},
        'legacyMidForeground':{'v2Attached':False,'v1Restored':True,'layerNames':render_policy['legacyOccluderLayers'],'midSha256':sha(mid),'foregroundSha256':sha(foreground),'sameBytes':sha(mid)==sha(foreground),'reason':'production V2 commit detaches both legacy full-map handles to avoid duplication with 32 fragments'},
      },
      'notes':{
        'camera':'DEFERRED — requires live browser viewport/touch behavior; excluded from matrix pass and blocks releasePass',
        'interaction':'DEFERRED — requires live pointer/hotspot/DOM behavior; excluded from matrix pass and blocks releasePass',
        'movement':'DEFERRED — requires live movement/navmesh engine; excluded from matrix pass and blocks releasePass',
        'methodology':'Direct authoritative shot-plan matrix; production TMX source/destination rects; production sprite manifest idle/down/frame0; repaired base/V2-world/lighting event stream; source-alpha intersection plus final composited RGBA difference.',
      },'shots':records,
    }
    with open(os.path.join(output,'index.json'),'w',encoding='utf-8') as f: json.dump(index,f,ensure_ascii=False,indent=2); f.write('\n')
    if args.limit and not args.preserve_existing: return
    if args.skip_contact_sheets:
        return
    by_target={}
    contact_filter=set(args.contact_target)
    for r in records:
        if not contact_filter or r['targetStableId'] in contact_filter:
            by_target.setdefault(r['targetStableId'],[]).append(r)
    personas=['songjiang','lujunyi','husanniang','likui','linchong','wuyong']; relations=['behind','boundary','front']
    for target in sorted(by_target):
        items=by_target[target]; lookup={(r['persona'],r['relation']):r for r in items}
        tw,th,pad,label_h=120,90,5,36; cw=6*(tw+pad)+pad; ch=3*(th+label_h+pad)+pad
        sheet=PixelBuffer(cw,ch); sheet.fill((24,24,30,255))
        for row,rel in enumerate(relations):
            for col,persona in enumerate(personas):
                r=lookup[(persona,rel)]; w,h,_,px=read_png(os.path.join(output,r['screenshotFile']))
                x=pad+col*(tw+pad); y=pad+row*(th+label_h+pad)
                sheet.blit_region(PixelBuffer(w,h,px),0,0,w,h,x,y,tw,th)
                overlay=r.get('visualOverlay','none')
                if overlay!='none':
                    viewport=r['runtimeFacts']['viewportWorld']; target_obj=object_by_stable_id[r['targetStableId']]
                    def projected(rect):
                        return (x+(rect['x']-viewport['x'])*tw/viewport['width'],
                                y+(rect['y']-viewport['y'])*th/viewport['height'],
                                rect['width']*tw/viewport['width'], rect['height']*th/viewport['height'])
                    draw_rect_outline(sheet,*projected(target_obj['destinationRect']),(255,32,180,255),(x,y,tw,th),2)
                    if overlay=='target-and-companion-outline':
                        companion=object_by_stable_id[r['contextCompanionStableId']]
                        draw_rect_outline(sheet,*projected(companion['destinationRect']),(0,220,255,255),(x,y,tw,th),1)
                    probe=r['world']
                    draw_crosshair(sheet,x+(probe['x']-viewport['x'])*tw/viewport['width'],y+(probe['y']-viewport['y'])*th/viewport['height'],(255,220,0,255),(x,y,tw,th),3)
                draw_text(sheet,x,y+th+2,r['id'],scale=1)
                draw_text(sheet,x,y+th+11,persona,scale=1)
                draw_text(sheet,x,y+th+20,rel,scale=1)
                if overlay=='target-outline': draw_text(sheet,x,y+th+29,'pink=target yel=probe',scale=1)
                elif overlay=='target-and-companion-outline': draw_text(sheet,x,y+th+29,'pink=frag cyan=prop',scale=1)
        safe=target.replace('/','_').replace('.','_')
        write_png(os.path.join(contacts,f'cell-{items[0]["cell"]}-{safe}.png'),cw,ch,sheet.to_bytes())

if __name__=='__main__': main()

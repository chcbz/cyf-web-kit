#!/usr/bin/env python3
"""CLI for deterministic E13 shot/index/contact-sheet generation."""
import argparse, hashlib, json, os, shutil, sys
from .compositor import OfflineRenderer, PixelBuffer
from .png_io import write_png, read_png, webp_decoder_provenance
from .text import draw_text
from .world_model import build_shot_plan, default_repo_root, PERSONAS


def sha(path):
    h=hashlib.sha256(); h.update(open(path,'rb').read()); return h.hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo-root', default=default_repo_root())
    ap.add_argument('--output', default=None)
    ap.add_argument('--limit', type=int, default=0)
    args=ap.parse_args()
    repo=os.path.realpath(args.repo_root)
    output=os.path.realpath(args.output or os.path.join(repo,'tests/fixtures/juyiting/occlusion-e13'))
    shots_dir=os.path.join(output,'shots'); contacts=os.path.join(output,'contact-sheets')
    os.makedirs(shots_dir,exist_ok=True); os.makedirs(contacts,exist_ok=True)
    for d in (shots_dir,contacts):
        for name in os.listdir(d):
            path=os.path.join(d,name)
            if os.path.isfile(path): os.unlink(path)
    shots,fragments,props,layers=build_shot_plan(repo)
    selected=shots[:args.limit] if args.limit else shots
    renderer=OfflineRenderer(os.path.join(repo,'public','juyiting'),layers)
    records=[]
    for i,shot in enumerate(selected):
        pixels,order,depths,facts=renderer.render_shot_small(shot,fragments,props,400,300)
        name=f'{shot["id"]}.png'; path=os.path.join(shots_dir,name)
        write_png(path,400,300,pixels)
        record={k:shot[k] for k in ('id','kind','cell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera')}
        record.update({'semanticRelation':shot['relation'],'resolvedExpectedOrdering':shot['resolvedExpectedOrdering'],'screenshotFile':f'shots/{name}','sha256':sha(path),'runtimeFacts':facts})
        records.append(record)
        if (i+1)%45==0: print(f'[{i+1}/{len(selected)}]',flush=True)
    frame_checks={p['personaCode']:renderer.frame_alpha_bounds(p['personaCode']) for p in PERSONAS}
    mid=os.path.join(repo,'public/juyiting',layers['mid-occluders']['source'])
    foreground=os.path.join(repo,'public/juyiting',layers['foreground-occluders']['source'])
    index={
      '$schema':'juyiting-occlusion-e13-index-v3','schemaVersion':3,'taskId':'E13','status':'GENERATED_OFFLINE',
      'generator':'scripts/juyiting/e13/generate-e13-offline-evidence.mjs + offline_pixel_renderer',
      'shotCount':len(records),'matrixShots':len(records),'cameraShots':0,'interactionShots':0,'movementShots':0,
      'matrixPass':len(records)==270 and all(r['runtimeFacts']['depthMatch'] for r in records),'releasePass':False,
      'sampledFrame':{'animation':'idle','direction':'down','frame':0,'claim':'single deterministic audit sampling frame, not full animation evidence'},
      'frameAlphaBoundsChecks':frame_checks,'webpDecoder':webp_decoder_provenance(),
      'productionVisualStack':{
        'effectiveDrawOrder':'ascending melonJS z; equal z draws later-added world renderables before earlier fixed layers',
        'canvasRaster':{'productionAntiAlias':True,'scaledSpriteSampling':'premultiplied-RGBA bilinear at destination pixel centers','browserCanvasBitIdentityClaim':False,'difference':'browser Canvas2D backend-specific edge/color rounding is not claimed bit-identical; layer, blend, source/destination geometry, ordering, and alpha-mask semantics are reproduced deterministically'},
        'fixedDepths':{'base':0,'mid-occluders':2,'foreground-occluders':5,'lighting-overlay':8},
        'lighting':{'opacity':layers['lighting-overlay']['opacity'],'tintcolor':layers['lighting-overlay']['tintcolor'],'imageBlend':'screen','tintBlend':'multiply'},
        'midForegroundDuplicate':{'drawnTwice':True,'midSha256':sha(mid),'foregroundSha256':sha(foreground),'sameBytes':sha(mid)==sha(foreground)},
      },
      'notes':{
        'camera':'DEFERRED — requires live browser viewport/touch behavior; excluded from matrix pass and blocks releasePass',
        'interaction':'DEFERRED — requires live pointer/hotspot/DOM behavior; excluded from matrix pass and blocks releasePass',
        'movement':'DEFERRED — requires live movement/navmesh engine; excluded from matrix pass and blocks releasePass',
        'methodology':'Direct authoritative shot-plan matrix; production TMX source/destination rects; production sprite manifest idle/down/frame0; full fixed-depth/world event stream; alpha-mask overlap.',
      },'shots':records,
    }
    with open(os.path.join(output,'index.json'),'w',encoding='utf-8') as f: json.dump(index,f,ensure_ascii=False,indent=2); f.write('\n')
    if args.limit: return
    by_target={}
    for r in records: by_target.setdefault(r['targetStableId'],[]).append(r)
    personas=['songjiang','lujunyi','husanniang','likui','linchong','wuyong']; relations=['behind','boundary','front']
    for target in sorted(by_target):
        items=by_target[target]; lookup={(r['persona'],r['relation']):r for r in items}
        tw,th,pad,label_h=120,90,5,27; cw=6*(tw+pad)+pad; ch=3*(th+label_h+pad)+pad
        sheet=PixelBuffer(cw,ch); sheet.fill((24,24,30,255))
        for row,rel in enumerate(relations):
            for col,persona in enumerate(personas):
                r=lookup[(persona,rel)]; w,h,_,px=read_png(os.path.join(output,r['screenshotFile']))
                x=pad+col*(tw+pad); y=pad+row*(th+label_h+pad)
                sheet.blit_region(PixelBuffer(w,h,px),0,0,w,h,x,y,tw,th)
                draw_text(sheet,x,y+th+2,r['id'],scale=1)
                draw_text(sheet,x,y+th+11,persona,scale=1)
                draw_text(sheet,x,y+th+20,rel,scale=1)
        safe=target.replace('/','_').replace('.','_')
        write_png(os.path.join(contacts,f'cell-{items[0]["cell"]}-{safe}.png'),cw,ch,sheet.to_bytes())

if __name__=='__main__': main()

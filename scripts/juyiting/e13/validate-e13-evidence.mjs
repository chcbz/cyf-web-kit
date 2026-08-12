#!/usr/bin/env node
/** Deterministic machine gate: matrix can pass while final E13 release stays deferred. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here=dirname(fileURLToPath(import.meta.url)); const repo=resolve(here,'..','..','..')
const args=process.argv.slice(2); const arg=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null}
const evidence=resolve(arg('--evidence-dir')||join(repo,'tests/fixtures/juyiting/occlusion-e13'))
const results=[]; const check=(name,ok,detail='')=>results.push({check:name,ok:Boolean(ok),detail})
const read=p=>JSON.parse(readFileSync(p,'utf8')); const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const fields=['id','kind','cell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera']
function main(){
 const plan=read(join(repo,'tests/fixtures/juyiting/occlusion-e13/shot-plan.json')); const matrix=plan.shots.filter(s=>s.kind==='matrix')
 const index=read(join(evidence,'index.json')); const shots=index.shots||[]
 check('authoritative plan has 270 matrix shots',matrix.length===270,`got ${matrix.length}`)
 check('index status GENERATED_OFFLINE',index.status==='GENERATED_OFFLINE',String(index.status))
 check('index has 270 ordered matrix shots',shots.length===270&&index.matrixShots===270,`got ${shots.length}`)
 const drift=[]
 matrix.forEach((p,i)=>fields.forEach(f=>{if(JSON.stringify(shots[i]?.[f])!==JSON.stringify(p[f]))drift.push(`${p.id}:${f}`)}))
 check('every index id/target/persona/relation/world/expected field binds authoritative plan',drift.length===0,drift.slice(0,12).join('; '))
 const depthBad=shots.filter(s=>s.resolvedExpectedOrdering!==s.runtimeFacts?.resolvedExpectedOrdering||s.runtimeFacts?.ordering!==s.resolvedExpectedOrdering||s.runtimeFacts?.depthMatch!==true)
 check('270/270 resolved depth matches',depthBad.length===0,depthBad.slice(0,10).map(s=>s.id).join(','))
 const alphaBad=shots.filter(s=>s.runtimeFacts?.pixelOverlap?.method!=='source-alpha-mask-intersection'||!Number.isInteger(s.runtimeFacts?.pixelOverlap?.opaqueIntersectionPixels)||!Number.isInteger(s.runtimeFacts?.pixelOverlap?.visibleOcclusionPixels))
 check('270/270 real alpha overlap facts',alphaBad.length===0,alphaBad.slice(0,10).map(s=>s.id).join(','))
 const files=shots.filter(s=>typeof s.screenshotFile!=='string'||!existsSync(join(evidence,s.screenshotFile)))
 check('270 explicit screenshotFile PNGs exist',files.length===0,files.slice(0,10).map(s=>s.id).join(','))
 const diskShots=existsSync(join(evidence,'shots'))?readdirSync(join(evidence,'shots')).filter(f=>f.endsWith('.png')):[]
 check('shots directory has exactly 270 PNGs',diskShots.length===270,`got ${diskShots.length}`)
 const sheets=existsSync(join(evidence,'contact-sheets'))?readdirSync(join(evidence,'contact-sheets')).filter(f=>f.endsWith('.png')):[]
 check('15 labeled contact sheets exist',sheets.length===15,`got ${sheets.length}`)
 check('idle/down/frame0 is the declared audit sample',JSON.stringify(index.sampledFrame?.animation)==='"idle"'&&index.sampledFrame?.direction==='down'&&index.sampledFrame?.frame===0)
 check('idle-down frames 0..3 alpha bounds invariant checked for six personas',Object.keys(index.frameAlphaBoundsChecks||{}).length===6&&Object.values(index.frameAlphaBoundsChecks).every(v=>v.reviewInvariantPass===true))
 check('production fixed stack and lighting semantics recorded',JSON.stringify(index.productionVisualStack?.fixedDepths)===JSON.stringify({base:0,'mid-occluders':2,'foreground-occluders':5,'lighting-overlay':8})&&index.productionVisualStack?.lighting?.opacity===0.85&&index.productionVisualStack?.lighting?.tintcolor==='#ffd8a0')
 check('production antiAlias raster semantics and browser-bit caveat recorded',index.productionVisualStack?.canvasRaster?.productionAntiAlias===true&&index.productionVisualStack?.canvasRaster?.scaledSpriteSampling?.includes('bilinear')&&index.productionVisualStack?.canvasRaster?.browserCanvasBitIdentityClaim===false)
 check('mid/foreground byte-identical resource is drawn twice',index.productionVisualStack?.midForegroundDuplicate?.drawnTwice===true&&index.productionVisualStack?.midForegroundDuplicate?.sameBytes===true)
 check('WebP ABI/hash/API fail-closed provenance recorded',index.webpDecoder?.abi===7&&/^0x[0-9a-f]{6}$/.test(index.webpDecoder?.decoderVersionHex||'')&&/^[0-9a-f]{64}$/.test(index.webpDecoder?.sha256||'')&&index.webpDecoder?.api?.includes('WebPDecodeRGBA'))
 check('camera/interaction/movement independently DEFERRED', ['camera','interaction','movement'].every(k=>(index.notes?.[k]||'').includes('DEFERRED')))
 const oracle=read(join(evidence,'oracle-report.json')); check('direct production TypeScript oracle passes all 270',oracle.pass===true&&oracle.matrixShots===270&&oracle.productionImports?.includes('src/game/occlusion/worldOrder.ts'))
 const matrixPass=results.every(r=>r.ok); const releasePass=false
 const gate={$schema:'juyiting-occlusion-e13-machines-gate-v3',taskId:'E13',generatedBy:'validate-e13-evidence.mjs',pass:releasePass,matrixPass,releasePass,
   releaseBlockers:['camera DEFERRED','interaction DEFERRED','movement DEFERRED','GPT visual review not performed'],passedChecks:results.filter(r=>r.ok).length,totalChecks:results.length,
   failures:results.filter(r=>!r.ok).map(r=>({check:r.check,detail:r.detail})),checks:results,
   sourceHashes:{shotPlanSha256:hash(join(repo,'tests/fixtures/juyiting/occlusion-e13/shot-plan.json')),indexSha256:hash(join(evidence,'index.json')),oracleSha256:hash(join(evidence,'oracle-report.json'))}}
 writeFileSync(join(evidence,'machines-gate.json'),`${JSON.stringify(gate,null,2)}\n`)
 console.log(`E13 matrix gate: ${matrixPass?'PASS':'FAIL'} ${gate.passedChecks}/${gate.totalChecks}; final release: DEFERRED`)
 process.exit(matrixPass?0:1)
}
main()

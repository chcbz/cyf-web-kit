#!/usr/bin/env node
/** Deterministic mechanical gate for the reproducible 270-shot offline matrix only. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveNavValidation, loadSourceFacts } from './lib/world-model.mjs'
import { compareExactNames, exactDirectoryEntries, expectedMatrixContactSheets, inspectPngFiles, sha256File } from './lib/evidence-files.mjs'
const here=dirname(fileURLToPath(import.meta.url)); const repo=resolve(here,'..','..','..')
const args=process.argv.slice(2); const arg=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null}
const evidence=resolve(arg('--evidence-dir')||join(repo,'tests/fixtures/juyiting/occlusion-e13'))
const results=[]; const check=(name,ok,detail='')=>results.push({check:name,ok:Boolean(ok),detail})
const read=p=>JSON.parse(readFileSync(p,'utf8')); const hash=sha256File
const PIXEL_KEYS=['method','visibilityMethod','hasAlphaOverlap','agentOpaquePixelsInAabb','targetOpaquePixelsInAabb','opaqueIntersectionPixels','alphaWeightedIntersection','finalCompositeChangedByTargetPixels','finalCompositeChangedByAgentPixels','visibleOcclusionPixels','agentPixelsVisiblyOccludedByTarget','targetPixelsVisiblyOccludedByAgent','overlapBounds']
const LIVE_PY_CHECK='live Python offline validator re-derives all 270 pixel metrics from production assets and committed PNGs (exit 0 required)'
const pixelValueEqual=(a,b)=>a===b||(typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<1e-6)||(a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&JSON.stringify(a)===JSON.stringify(b))
const fields=['id','kind','cell','probeCell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera','evidenceContext','contextCompanionStableId','visualOmissions','probeKind','visualExerciseContract','visualOverlay','maxAgentOcclusionRatio','navValidation','probeRationale']
function runPythonValidator(evidenceDir){
 const result=spawnSync('python3',['-m','offline_pixel_renderer.validate','--repo-root',repo,'--evidence-dir',evidenceDir],{
  cwd:repo,encoding:'utf8',timeout:300000,env:{...process.env,PYTHONPATH:join(repo,'scripts/juyiting/e13')}
 })
 return result
}
function main(){
 const planPath=resolve(arg('--shot-plan')||join(evidence,'shot-plan.json'))
 const plan=read(planPath); const matrix=plan.shots.filter(s=>s.kind==='matrix')
 const facts=loadSourceFacts()
 const index=read(join(evidence,'index.json')); const shots=index.shots||[]
 check('authoritative plan has 270 matrix shots',matrix.length===270,`got ${matrix.length}`)
 check('index status GENERATED_OFFLINE',index.status==='GENERATED_OFFLINE',String(index.status))
 check('index has 270 ordered matrix shots',shots.length===270&&index.matrixShots===270,`got ${shots.length}`)
 const drift=[]
 matrix.forEach((p,i)=>fields.forEach(f=>{if(JSON.stringify(shots[i]?.[f])!==JSON.stringify(p[f]))drift.push(`${p.id}:${f}`)}))
 check('every index id/target/persona/relation/world/expected field binds authoritative plan',drift.length===0,drift.slice(0,12).join('; '))
 const depthBad=shots.filter(s=>s.resolvedExpectedOrdering!==s.runtimeFacts?.resolvedExpectedOrdering||s.runtimeFacts?.ordering!==s.resolvedExpectedOrdering||s.runtimeFacts?.depthMatch!==true)
 check('270/270 resolved depth matches',depthBad.length===0,depthBad.slice(0,10).map(s=>s.id).join(','))
 const renderDepthBad=shots.filter(s=>s.runtimeFacts?.actualRenderDepth!==100+s.runtimeFacts?.actualDepth||s.runtimeFacts?.targetRenderDepth!==100+s.runtimeFacts?.targetDepth||s.runtimeFacts?.actualRenderDepth<100||s.runtimeFacts?.targetRenderDepth<100||s.runtimeFacts?.actualRenderDepth>=300||s.runtimeFacts?.targetRenderDepth>=300)
 check('270/270 mapped world depths are above base and below lighting',renderDepthBad.length===0,renderDepthBad.slice(0,10).map(s=>s.id).join(','))
 const alphaBad=shots.filter(s=>s.runtimeFacts?.pixelOverlap?.method!=='source-alpha-intersection-plus-final-composite-difference'||!Number.isInteger(s.runtimeFacts?.pixelOverlap?.opaqueIntersectionPixels)||!Number.isInteger(s.runtimeFacts?.pixelOverlap?.visibleOcclusionPixels)||!Number.isInteger(s.runtimeFacts?.pixelOverlap?.finalCompositeChangedByTargetPixels)||!Number.isInteger(s.runtimeFacts?.pixelOverlap?.finalCompositeChangedByAgentPixels))
 check('270/270 alpha plus final-composite visibility facts',alphaBad.length===0,alphaBad.slice(0,10).map(s=>s.id).join(','))
 const targetViewports=new Map(); const viewportDrift=[]
 for(const shot of shots){const viewport=shot.runtimeFacts?.viewportWorld; const prior=targetViewports.get(shot.targetStableId); if(prior===undefined)targetViewports.set(shot.targetStableId,viewport); else if(JSON.stringify(prior)!==JSON.stringify(viewport))viewportDrift.push(`${shot.id}:${JSON.stringify(viewport)}!=${JSON.stringify(prior)}`)}
 check('all 18 shots per target reuse one fixed viewportWorld',viewportDrift.length===0,viewportDrift.slice(0,12).join(';'))
 const probeBad=shots.filter(s=>s.probeKind==='target-specific'&&(s.navValidation?.navigable!==true||s.navValidation?.reachability?.source!=='production-graph-pathfinder'||s.navValidation?.reachability?.colliderWidth!==42||s.navValidation?.reachability?.status!=='found'||((s.visualExerciseContract==='target-each-shot'||(['ownership-transition','composite-transition'].includes(s.visualExerciseContract)&&s.relation==='behind'))&&(s.runtimeFacts?.pixelOverlap?.opaqueIntersectionPixels<=0||s.runtimeFacts?.pixelOverlap?.visibleOcclusionPixels<=0))))
 check('target-specific probes are production reachable and satisfy their visual exercise contract',probeBad.length===0,probeBad.slice(0,12).map(s=>s.id).join(','))
 const compositeBad=shots.filter(s=>s.visualExerciseContract==='composite-transition'&&(s.evidenceContext!=='in-context'||(s.visualOmissions||[]).length!==0||(s.relation==='behind'&&(s.runtimeFacts?.pixelOverlap?.opaqueIntersectionPixels<=0||s.runtimeFacts?.pixelOverlap?.visibleOcclusionPixels<=0))))
 check('composite-transition probes use real context and visibly exercise behind',compositeBad.length===0,compositeBad.slice(0,12).map(s=>s.id).join(','))
 const ratioBad=shots.filter(s=>s.maxAgentOcclusionRatio!=null&&s.relation==='behind'&&s.runtimeFacts?.ordering==='agent_behind_target'&&((s.runtimeFacts?.pixelOverlap?.agentPixelsVisiblyOccludedByTarget||0)/Math.max(1,s.runtimeFacts?.pixelOverlap?.agentOpaquePixelsInAabb||0))>s.maxAgentOcclusionRatio)
 check('declared agent occlusion ratios stay within visual readability limits',ratioBad.length===0,ratioBad.slice(0,12).map(s=>`${s.id}:${((s.runtimeFacts.pixelOverlap.agentPixelsVisiblyOccludedByTarget||0)/Math.max(1,s.runtimeFacts.pixelOverlap.agentOpaquePixelsInAabb||0)).toFixed(3)}`).join(','))
 const navRecomputeBad=[]
 matrix.forEach((p,i)=>{const shot=shots[i]; if(!shot)return; const derived=deriveNavValidation(p.world,facts); if(JSON.stringify(shot.navValidation)!==JSON.stringify(derived)) navRecomputeBad.push(`${p.id}`)})
 check('every matrix probe navValidation is independently re-derived from the production TMX parser + graph pathfinder',navRecomputeBad.length===0,navRecomputeBad.slice(0,12).join('; '))
 const pixelReportPath=join(evidence,'pixel-recompute-report.json')
 const pixelReportBad=[]
 if(!existsSync(pixelReportPath)){ pixelReportBad.push('missing pixel-recompute-report.json') }
 else {
   const pixelReport=read(pixelReportPath)
   const indexSha256=hash(join(evidence,'index.json'))
   if(pixelReport.pass!==true) pixelReportBad.push('report.pass!==true')
   if(pixelReport.matrixShots!==shots.length) pixelReportBad.push(`report.matrixShots=${pixelReport.matrixShots}`)
   if(pixelReport.indexSha256!==indexSha256) pixelReportBad.push('report.indexSha256 does not bind the current index.json')
   if(!pixelReport.recomputed||typeof pixelReport.recomputed!=='object'){ pixelReportBad.push('report.recomputed missing') }
   else {
     const mismatches=[]
     for(const shot of shots){
       const rec=pixelReport.recomputed[shot.id]
       if(!rec){ mismatches.push(`${shot.id}:missing`); continue }
       const committed=shot.runtimeFacts?.pixelOverlap||{}
       for(const key of PIXEL_KEYS){ if(!pixelValueEqual(committed[key],rec[key])) mismatches.push(`${shot.id}:${key}`) }
     }
     if(mismatches.length) pixelReportBad.push(...mismatches.slice(0,12))
   }
 }
 check('270/270 committed pixelOverlap cross-check the independent pixel recompute report',pixelReportBad.length===0,pixelReportBad.slice(0,12).join('; '))
 const pyResult=runPythonValidator(evidence)
 const pyOutput=`${pyResult.stdout||''}${pyResult.stderr||''}`.trim()
 const pySummary=pyOutput.split('\n').filter(line=>line.startsWith('Python E13 validator:')||line.startsWith('  FAIL')).join(' | ').slice(0,2000)
 check(LIVE_PY_CHECK,pyResult.status===0,pySummary||`exit ${pyResult.status}`)
 const contextBad=shots.filter(s=>s.evidenceContext==='target-isolated'?(typeof s.contextCompanionStableId!=='string'||JSON.stringify(s.visualOmissions)!==JSON.stringify([s.contextCompanionStableId])||JSON.stringify(s.runtimeFacts?.visualOmissions)!==JSON.stringify(s.visualOmissions)):(s.evidenceContext!=='in-context'||(s.visualOmissions||[]).length!==0))
 check('isolated evidence omits only the declared independent companion',contextBad.length===0,contextBad.slice(0,12).map(s=>s.id).join(','))
 const expectedShotNames=matrix.map(s=>`${s.id}.png`).sort()
 const screenshotPathBad=shots.filter(s=>s.screenshotFile!==`shots/${s.id}.png`||!existsSync(join(evidence,s.screenshotFile||'')))
 check('270 screenshotFile paths are canonical and exist',screenshotPathBad.length===0,screenshotPathBad.slice(0,10).map(s=>s.id).join(','))
 const shotSet=compareExactNames(exactDirectoryEntries(join(evidence,'shots')),expectedShotNames)
 check('shots directory is the exact 270-file planned set',shotSet.ok,`missing=${shotSet.missing.slice(0,10).join(',')} extras=${shotSet.extras.slice(0,10).join(',')}`)
 const expectedSheets=expectedMatrixContactSheets(matrix)
 const sheetSet=compareExactNames(exactDirectoryEntries(join(evidence,'contact-sheets')),expectedSheets)
 check('contact-sheets directory is the exact deterministic 15-file set',sheetSet.ok,`missing=${sheetSet.missing.join(',')} extras=${sheetSet.extras.join(',')}`)
 const sheetPngBad=inspectPngFiles(join(evidence,'contact-sheets'),expectedSheets,{width:755,height:398})
 check('15 mechanical contact sheets have PNG signature and 755x398 dimensions',sheetPngBad.length===0,sheetPngBad.join('; '))
 check('idle/down/frame0 is the declared audit sample',JSON.stringify(index.sampledFrame?.animation)==='"idle"'&&index.sampledFrame?.direction==='down'&&index.sampledFrame?.frame===0)
 check('idle-down frames 0..3 alpha bounds invariant checked for six personas',Object.keys(index.frameAlphaBoundsChecks||{}).length===6&&Object.values(index.frameAlphaBoundsChecks).every(v=>v.reviewInvariantPass===true))
 check('repaired base/world/lighting stack and lighting semantics recorded',JSON.stringify(index.productionVisualStack?.fixedDepths)===JSON.stringify({base:0,'lighting-overlay':300})&&JSON.stringify(index.productionVisualStack?.depthBands)===JSON.stringify({BASE_MIN:0,BASE_MAX_EXCLUSIVE:100,V2_WORLD_START:100,V2_WORLD_STRIDE:1,ERROR_STATE_PROP_DEPTH:6,ERROR_STATE_AGENT_DEPTH:7,LIGHTING:300,WORLD_UI:400,SCREEN_UI:500})&&index.productionVisualStack?.lighting?.opacity===0.85&&index.productionVisualStack?.lighting?.tintcolor==='#ffd8a0')
 check('production antiAlias raster semantics and browser-bit caveat recorded',index.productionVisualStack?.canvasRaster?.productionAntiAlias===true&&index.productionVisualStack?.canvasRaster?.scaledSpriteSampling?.includes('bilinear')&&index.productionVisualStack?.canvasRaster?.browserCanvasBitIdentityClaim===false)
 check('legacy duplicate full-map occluders are detached in V2',index.productionVisualStack?.legacyMidForeground?.v2Attached===false&&index.productionVisualStack?.legacyMidForeground?.v1Restored===true&&index.productionVisualStack?.legacyMidForeground?.sameBytes===true)
 check('WebP ABI/hash/API fail-closed provenance recorded',index.webpDecoder?.abi===7&&/^0x[0-9a-f]{6}$/.test(index.webpDecoder?.decoderVersionHex||'')&&/^[0-9a-f]{64}$/.test(index.webpDecoder?.sha256||'')&&index.webpDecoder?.api?.includes('WebPDecodeRGBA'))
 check('offline matrix index keeps browser-only scopes explicitly separate', ['camera','interaction','movement'].every(k=>(index.notes?.[k]||'').includes('DEFERRED')))
 const oracle=read(join(evidence,'oracle-report.json')); check('direct production TypeScript oracle passes all 270',oracle.pass===true&&oracle.matrixShots===270&&oracle.productionImports?.includes('src/game/occlusion/worldOrder.ts')&&oracle.productionImports?.includes('src/game/occlusion/hallSceneDepthBands.js'))
 const matrixPass=results.every(r=>r.ok)
 const gate={$schema:'juyiting-occlusion-e13-matrix-gate-v1',taskId:'E13',generatedBy:'validate-e13-matrix-evidence.mjs',scope:'mechanical-matrix-only',pass:matrixPass,matrixPass,
   passedChecks:results.filter(r=>r.ok).length,totalChecks:results.length,
   failures:results.filter(r=>!r.ok).map(r=>({check:r.check,detail:r.detail})),checks:results,
   sourceHashes:{shotPlanSha256:hash(planPath),indexSha256:hash(join(evidence,'index.json')),oracleSha256:hash(join(evidence,'oracle-report.json')),pixelRecomputeReportSha256:existsSync(pixelReportPath)?hash(pixelReportPath):null,
     contactSheets:Object.fromEntries(expectedSheets.map(name=>[name,existsSync(join(evidence,'contact-sheets',name))?hash(join(evidence,'contact-sheets',name)):null]))}}
 writeFileSync(join(evidence,'matrix-gate.json'),`${JSON.stringify(gate,null,2)}
`)
 console.log(`E13 mechanical matrix gate: ${matrixPass?'PASS':'FAIL'} ${gate.passedChecks}/${gate.totalChecks}`)
 process.exit(matrixPass?0:1)
}
main()

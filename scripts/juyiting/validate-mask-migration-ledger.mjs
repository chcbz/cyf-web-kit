#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readGitBlobAtCommit } from './lib/baseline-provenance.mjs'
import {
  ZERO_GENERATION_ID, TMX_SHA256, E9A_GENERATION_ID, E9B_COMMIT, NAV_AREA,
  OWNER_BY_MASK, PROBE_FIXTURES, RECALIBRATIONS, stableJson, sha256,
  countOwnedPixelsInPolygon, pointInPolygonInclusive, pointStatus
} from './lib/mask-migration-evidence.mjs'

const __dirname=dirname(fileURLToPath(import.meta.url)),REPO_ROOT=join(__dirname,'..','..'),E10A_ACCEPTED_COMMIT='7404d361daba8f0af0dea98ab9db38cbbf01b286'
function exactObject(a,b){return stableJson(a)===stableJson(b)}
function allStrings(value){return typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(allStrings):value&&typeof value==='object'?Object.values(value).flatMap(allStrings):[]}

export async function validateMaskMigration({ ledger, contact, inputRoot=REPO_ROOT, ledgerText=stableJson(ledger) }={}) {
 inputRoot=resolve(inputRoot)
 const load=p=>JSON.parse(readFileSync(resolve(inputRoot,p),'utf8'))
 const errors=[],warnings=[],fail=m=>errors.push(m)
 const inventory=load('tests/fixtures/juyiting/occlusion-v0/inventory.json'),fragSpec=load('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'),propSpec=load('tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json'),e8bManifest=load('tests/fixtures/juyiting/occlusion-v1-props/prop-tmx-manifest.json')
 let e8aContact=''
 try { e8aContact=readFileSync(resolve(inputRoot,'tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg'),'utf8') }
 catch { fail('current role frame source missing') }
 const { buildInventory }=await import('./inventory-juyiting-map.mjs')
 const liveGeometry=buildInventory(readFileSync(resolve(inputRoot,'public/juyiting/hall.tmx'),'utf8'),{baselineCommit:inventory.baselineCommit})
 if(!exactObject(liveGeometry.collision,inventory.collision)||!exactObject(liveGeometry.navObstacles,inventory.navObstacles))fail('live TMX collision/nav geometry drifts from E1 fixture')
 const fragments=new Map(fragSpec.fragments.map(f=>[f.stableId,f]))
if(ledger.$schema!=='juyiting-occlusion-v2-mask-migration-ledger-v2'||ledger.schemaVersion!==2)fail('schema/version mismatch')
if(!/^[0-9a-f]{64}$/.test(ledger.generationId)||ledger.generationId===ZERO_GENERATION_ID)fail('generationId must be derived SHA-256')
if(ledger.provenance?.tmxSha256!==TMX_SHA256||ledger.provenance?.e9aGenerationId!==E9A_GENERATION_ID||ledger.provenance?.e9bCommit!==E9B_COMMIT)fail('frozen provenance mismatch')
if(ledger.provenance?.inputHashes?.tmx?.sha256!==TMX_SHA256)fail('input TMX hash drift')
if(e8bManifest.taskId!=='E8B'||e8bManifest.tmxProvenance?.currentAnchor?.sha256!==TMX_SHA256)fail('E8B provenance binding drift')
if(ledger.provenance?.inputHashes?.e8b?.tmxSha256!==TMX_SHA256)fail('ledger E8B TMX binding drift')
// E10A's TMX is historical provenance: later E10B/E12 migrations legitimately
// changed the live TMX, so the main-repository check reads the accepted E10A blob.
// All other top-level inputs below are current semantic regression inputs.
for(const [name,input] of Object.entries(ledger.provenance?.inputHashes||{})){
 if(!input||typeof input!=='object'||typeof input.path!=='string'||typeof input.sha256!=='string')continue
 let actual
 try {
  actual = inputRoot===REPO_ROOT && name==='tmx'
   ? sha256(readGitBlobAtCommit(E10A_ACCEPTED_COMMIT,input.path))
   : sha256(readFileSync(resolve(inputRoot,input.path)))
 } catch { fail(`input hash source missing: ${name}`); continue }
 if(actual!==input.sha256)fail(`input hash drift: ${name}`)
}
// Generator tooling is also historical provenance for the accepted fixture. The
// current validator/generator may evolve, while isolated roots must still supply
// and hash their own tooling bytes so mutation tests cannot inherit trusted Git.
for(const [name,input] of Object.entries(ledger.provenance?.inputHashes?.generatorTooling||{})){
 if(!input||typeof input.path!=='string'||typeof input.sha256!=='string'){fail(`generator tooling provenance missing: ${name}`);continue}
 let actual
 try { actual=inputRoot===REPO_ROOT?sha256(readGitBlobAtCommit(E10A_ACCEPTED_COMMIT,input.path)):sha256(readFileSync(resolve(inputRoot,input.path))) }
 catch{fail(`generator tooling source missing: ${name}`);continue}
 if(actual!==input.sha256)fail(`generator tooling hash drift: ${name}`)
}
// Role evidence is a current-runtime semantic gate, separate from historical E10A
// provenance. It binds the live E8A role metadata and the exact embedded frames.
for(const role of ['lujunyi','husanniang']){
 const expected=propSpec.visualEvidence?.roles?.[role],recorded=ledger.provenance?.inputHashes?.roles?.[role]
 if(!expected||!recorded){fail(`role evidence missing: ${role}`);continue}
 if(recorded.assetSha256!==expected.asset?.sha256||!exactObject(recorded.frame,expected.sourceFrameRect)||!exactObject(recorded.alphaAabb,expected.sourceFrameAlphaAabb))fail(`current role semantics drift: ${role}`)
 const marker=`data-role=\"${role}\"`,start=e8aContact.indexOf(marker),end=start<0?-1:e8aContact.indexOf('</g>',start),group=start<0||end<0?'':e8aContact.slice(start,end),width=String(expected.renderedFrameSize?.width)
 const match=group.match(new RegExp(`<image href=\"(data:image/png;base64,[^\"]+)\"[^>]*width=\"${width.replace('.', '\\.')}\"`))
 if(!match||sha256(Buffer.from(match[1].split(',')[1],'base64'))!==recorded.pngSha256)fail(`current role frame pixels drift: ${role}`)
}
const generationBasis={ledger:{...ledger,generationId:ZERO_GENERATION_ID,contentSha256:''},evidenceInputs:ledger.provenance.inputHashes}
const expectedGeneration=createHash('sha256').update(stableJson(generationBasis)).digest('hex')
if(ledger.generationId!==expectedGeneration)fail('generationId content derivation mismatch')
const expectedContent=createHash('sha256').update(stableJson({...ledger,contentSha256:''})).digest('hex')
if(ledger.contentSha256!==expectedContent)fail('contentSha256 mismatch')
if(!Array.isArray(ledger.entries)||ledger.entries.length!==37)fail(`expected 37 entries, got ${ledger.entries?.length}`)
const ids=ledger.entries.map(e=>e.legacyTmxId);if(new Set(ids).size!==37)fail('duplicate mask id');for(let id=48;id<=84;id++)if(!ids.includes(id))fail(`missing mask ${id}`)
const indexSet=new Set(ledger.entries.map(e=>e.legacyIndex));if(indexSet.size!==37)fail('duplicate legacy index');for(let i=1;i<=37;i++)if(!indexSet.has(i))fail(`missing legacy index ${i}`)
if(!exactObject(ledger.navArea,NAV_AREA))fail('nav area contract drift')

for(const e of ledger.entries){
 const id=e.legacyTmxId,mask=inventory.masks.find(m=>m.tmxId===id),expectedSid=OWNER_BY_MASK[id],f=fragments.get(expectedSid)
 if(!mask){fail(`mask ${id}: absent from E1`);continue} if(!f){fail(`mask ${id}: expected target absent`);continue}
 if(e.legacyIndex!==mask.index||e.legacyTmxName!==(mask.name||`mask-${id}`))fail(`mask ${id}: legacy identity drift`)
 if(!exactObject(e.polygon,mask.polygon)||!exactObject(e.worldVertices,mask.polygon)||!exactObject(e.aabb,mask.aabb))fail(`mask ${id}: polygon/AABB drift`)
 if(e.targetFragmentStableId!==expectedSid||!exactObject(e.targetFragmentStableIds,[expectedSid])||e.targetFragmentCount!==1)fail(`mask ${id}: target must be sole real owner ${expectedSid}`)
 if(e.oneToManyRationale!==null)fail(`mask ${id}: one-to-many rationale forbidden for single owner`)
 if(e.targetFragment?.ownedOpaquePixelCount!==f.ownedOpaquePixelCount)fail(`mask ${id}: target owned total drift`)
 const actualOwners=fragSpec.fragments.map(candidate=>({stableId:candidate.stableId,ownedPixelsInLegacyPolygon:countOwnedPixelsInPolygon(candidate.ownershipRuns,mask.polygon)})).filter(x=>x.ownedPixelsInLegacyPolygon>0).sort((a,b)=>b.ownedPixelsInLegacyPolygon-a.ownedPixelsInLegacyPolygon||a.stableId.localeCompare(b.stableId))
 const target=actualOwners.find(x=>x.stableId===expectedSid)
 if(!target||target.ownedPixelsInLegacyPolygon<=0)fail(`mask ${id}: target zero overlap`)
 if(actualOwners.length!==1||actualOwners[0]?.stableId!==expectedSid)fail(`mask ${id}: legacy polygon must have exactly one real E9A owner ${expectedSid}`)
 if(!exactObject(e.ownerOverlapEvidence?.actualOwners,actualOwners)||e.ownerOverlapEvidence?.ownedPixelsInLegacyPolygon!==target?.ownedPixelsInLegacyPolygon)fail(`mask ${id}: exact ownership overlap drift`)
 if(e.ownerOverlapEvidence?.method!=='boundary-inclusive pixel-center test against E9A alpha-rle ownershipRuns')fail(`mask ${id}: overlap method not exact ownershipRuns`)
 if(id===51&&target?.ownedPixelsInLegacyPolygon!==29316)fail('mask 51: expected 29316 owned pixels')
 if(id===58&&target?.ownedPixelsInLegacyPolygon!==30629)fail('mask 58: expected 30629 owned pixels')
 if(id===76&&target?.ownedPixelsInLegacyPolygon!==11150)fail('mask 76: expected 11150 owned pixels')
 if(e.constraintDecision?.decision!=='none'||e.constraintDecision.target!==null||e.constraintDecision.relation!==null||e.constraintDecision.priority!==null||e.constraintDecision.scope!==null)fail(`mask ${id}: constraints must be none/not-needed`)
 const banned=allStrings(e.constraintDecision).join(' ').toLowerCase();if(/always-behind|fragment-behind-agent-global/.test(banned))fail(`mask ${id}: forbidden constraint semantics`)
 if(e.renderBand!=='world'||e.elevation!==0||e.sortMode!=='fixed-point-y'||e.tieBias!==-1||e.fixedPointY!==Math.round(e.sortAnchor.y*256))fail(`mask ${id}: sort contract drift`)
 if(!Number.isFinite(e.sortAnchor?.x)||!Number.isFinite(e.sortAnchor?.y)||e.sortAnchor.x<0||e.sortAnchor.x>1664||e.sortAnchor.y<0||e.sortAnchor.y>928)fail(`mask ${id}: sortAnchor out of map bounds`)
 if(!exactObject(e.sortAnchor,PROBE_FIXTURES[id].anchor))fail(`mask ${id}: anchor drift`)
 for(const name of ['behind','boundary','front']){
   const p=e.probes?.[name],expected=PROBE_FIXTURES[id][name];if(!p){fail(`mask ${id}: missing ${name} probe`);continue}
   if(!exactObject(p.footPoint,expected))fail(`mask ${id}: ${name} coordinate drift`)
   if(p.fixedPointY!==Math.round(p.footPoint.y*256))fail(`mask ${id}: ${name} fixedPoint drift`)
   if(name==='behind'&&!(p.footPoint.y<e.sortAnchor.y))fail(`mask ${id}: behind anchor direction invalid`)
   if(name==='boundary'&&p.footPoint.y!==e.sortAnchor.y)fail(`mask ${id}: boundary must equal anchor Y`)
   if(name==='front'&&!(p.footPoint.y>e.sortAnchor.y))fail(`mask ${id}: front anchor direction invalid`)
   const status=pointStatus(p.footPoint,liveGeometry);if(!status.navigable)fail(`mask ${id}: ${name} probe outside nav or in obstacle/collision`)
   if(!exactObject(p.navValidation,{source:'live-tmx+e1-equality-checked',navAreaTmxId:NAV_AREA.tmxId,...status}))fail(`mask ${id}: ${name} nav evidence drift`)
   const inside=pointInPolygonInclusive(p.footPoint.x,p.footPoint.y,e.polygon);if(p.insideLegacyPolygon!==inside)fail(`mask ${id}: ${name} polygon flag drift`)
   if(!inside&&!(typeof p.outsideLegacyPolygonReason==='string'&&p.outsideLegacyPolygonReason.length>20))fail(`mask ${id}: ${name} outside polygon without reason`)
   if(inside&&p.outsideLegacyPolygonReason!==null)fail(`mask ${id}: ${name} unnecessary outside reason`)
   const expectedRelation=name==='behind'?'agent<fragment':'fragment<agent';if(p.expectedPainterRelation!==expectedRelation)fail(`mask ${id}: ${name} expected relation drift`)
 }
 const rec=RECALIBRATIONS[id];if(rec){if(e.recalibrationDecision?.action!=='recalibrate'||e.recalibrationDecision.nineGridRegion!==rec.nineGridRegion||e.recalibrationDecision.homeChunk!==rec.homeChunk)fail(`mask ${id}: recalibration drift`)}else if(e.recalibrationDecision!=='none')fail(`mask ${id}: unexpected recalibration`)
 if(id===80&&e.recalibrationDecision?.homeChunk!=='east-upper')fail('mask 80: recalibration homeChunk must be east-upper')
 if(!e.targetVisualStructure||/TBD|TODO/i.test(e.targetVisualStructure))fail(`mask ${id}: generic TBD visual structure`)
}

const m58=ledger.entries.find(e=>e.legacyTmxId===58),p92=propSpec.props.find(p=>p.tmxId===92),ev=m58?.mask58Evidence
if(!exactObject(ev?.legacyMaskAabb,{minX:1197,minY:342,maxX:1663,maxY:458,width:466,height:116}))fail('mask 58 AABB evidence drift')
if(ev?.wallOwnerPixelsInPolygon!==30629||ev?.prop92?.opaquePixelsOverlappingMaskPolygon!==0)fail('mask 58 wall/prop overlap facts drift')
if(!exactObject(ev?.prop92?.bounds,{x:1360,y:255,width:172,height:124,maxX:1532,maxY:379})||!exactObject(ev?.prop92?.sortAnchor,{x:1446,y:379})||ev?.prop92?.tieBias!==-4)fail('mask 58 prop92 bounds/anchor/tieBias drift')
if(!exactObject(p92.tmxRect,{x:1360,y:255,width:172,height:124,minX:1360,minY:255,maxX:1532,maxY:379}))fail('E8A prop92 fixture drift')
try{const png=PNG.sync.read(readFileSync(resolve(inputRoot,p92.asset.path)));let opaque=0,overlap=0;for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){if(png.data[(y*png.width+x)*4+3]===0)continue;opaque++;if(pointInPolygonInclusive(p92.tmxRect.x+x+.5,p92.tmxRect.y+y+.5,m58.polygon))overlap++}if(opaque!==13671||overlap!==0)fail(`mask 58 prop92 alpha evidence drift opaque=${opaque} overlap=${overlap}`)}catch(error){fail(`mask 58 prop92 alpha verification failed: ${error.message}`)}
const expectedDepth={behind:{x:1446,y:370},boundary:{x:1446,y:379},front:{x:1446,y:420}};for(const [name,foot] of Object.entries(expectedDepth)){const fixture=ev?.roleFixture?.positions?.[name];if(!exactObject(fixture?.footPoint,foot))fail(`mask 58 table ${name} foot drift`);if(fixture?.fixedPointY!==foot.y*256)fail(`mask 58 table ${name} fixedPoint drift`);const roles=fixture?.expectedByRole;if(!roles||roles.lujunyi!==roles.husanniang)fail(`mask 58 ${name}: role invariance drift`);const status=pointStatus(foot,liveGeometry);if(!exactObject(fixture?.navValidation,{source:'live-tmx+e1-equality-checked',navAreaTmxId:NAV_AREA.tmxId,...status}))fail(`mask 58 table ${name} nav evidence drift`)}
if(ev?.roleFixture?.positions?.behind?.navValidation?.navigable!==false||!exactObject(ev?.roleFixture?.positions?.behind?.navValidation?.collisionIds,[45])||!exactObject(ev?.roleFixture?.positions?.behind?.navValidation?.navObstacleIds,[156]))fail('mask 58 y370 must disclose table collision/nav obstacle evidence')
if(ev?.roleFixture?.positions?.boundary?.navValidation?.navigable!==true||ev?.roleFixture?.positions?.front?.navValidation?.navigable!==true)fail('mask 58 boundary/front navigation evidence drift')
if(/y\s*=?\s*573|573\+|desk area[^\n]*573/i.test(ledgerText))fail('mask 58 forbidden table y573 narrative')

if(!contact.includes(`data-generation-id="${ledger.generationId}"`))fail('contact sheet generationId drift')
for(const marker of ['data-evidence="canonical','target-owner','agent-frame','nav-status','data-mask58-special="true"','data-evidence="prop92-complete"'])if(!contact.includes(marker))fail(`contact sheet missing ${marker}`)
for(let id=48;id<=84;id++){const matches=contact.match(new RegExp(`data-mask-tmx-id="${id}"`,'g'))||[];if(matches.length<2)fail(`contact sheet missing overview/card number ${id}`)}
if((contact.match(/class="mask-card"/g)||[]).length!==37)fail('contact sheet must contain 37 mask cards')
if((contact.match(/data-evidence="agent-frame"/g)||[]).length<117)fail('contact sheet missing 37x3 plus mask58 role agent composites')
if((contact.match(/data-evidence="nav-status"/g)||[]).length<111)fail('contact sheet missing per-probe nav markers')
for(const role of ['lujunyi','husanniang'])for(const y of [370,379,420])if(!contact.includes(`data-role="${role}" data-table-y="${y}"`))fail(`contact sheet missing mask58 ${role} y${y}`)
if(/y\s*=?\s*573|573\+|always-behind/i.test(contact))fail('contact sheet contains rejected mask58/constraint narrative')
if(!contact.includes('never “depth halving inside mask”')||/uses [^<]{0,20}depth halving|depth halving determines/i.test(contact))fail('contact sheet mask-depth regression wording drift')

const s=ledger.summary;if(s?.totalMasks!==37||s.constraintCount!==0||s.oneToManyCount!==0||s.recalibrationCount!==Object.keys(RECALIBRATIONS).length||s.totalProbeCount!==111||s.probeWarnings!==0)fail('summary drift')
 return {ok:errors.length===0,errors,warnings,generationId:ledger.generationId,entryCount:ledger.entries?.length??0}
}

async function cli(){
 const args=process.argv.slice(2),arg=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null}
 const ledgerPath=resolve(REPO_ROOT,arg('--ledger')||'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')
 const contactPath=resolve(REPO_ROOT,arg('--contact')||'tests/fixtures/juyiting/occlusion-v2-masks/contact-sheet.svg')
 const inputRoot=resolve(REPO_ROOT,arg('--input-root')||'.')
 const ledgerText=readFileSync(ledgerPath,'utf8'),ledger=JSON.parse(ledgerText),contact=readFileSync(contactPath,'utf8')
 const result=await validateMaskMigration({ledger,contact,inputRoot,ledgerText})
 console.log('\n=== E10A Mask Migration Validation ===');console.log(`  Entries: ${result.entryCount}/37`);console.log(`  Errors: ${result.errors.length}`);console.log(`  Warnings: ${result.warnings.length}`)
 if(!result.ok){for(const error of result.errors)console.log(`    ❌ ${error}`);process.exitCode=1;return}
 console.log(`  generationId: ${result.generationId}`);console.log('  ✅ VALIDATION PASSED (0 warnings)')
}
if(process.argv[1]===fileURLToPath(import.meta.url))cli()

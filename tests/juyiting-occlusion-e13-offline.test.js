import { expect } from 'chai'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const ROOT=process.cwd(), DIR=join(ROOT,'tests/fixtures/juyiting/occlusion-e13')
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const BIND=['id','kind','cell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera']
describe('E13 authoritative offline pixel evidence',()=>{
 let index,matrix
 before(()=>{ index=read(join(DIR,'index.json')); matrix=read(join(DIR,'shot-plan.json')).shots.filter(s=>s.kind==='matrix') })
 it('is GENERATED_OFFLINE matrix evidence, not a final release pass',()=>{
  expect(index.status).eq('GENERATED_OFFLINE'); expect(index.matrixPass).eq(true); expect(index.releasePass).eq(false)
  expect(index.shots).length(270); expect(index.cameraShots).eq(0); expect(index.interactionShots).eq(0); expect(index.movementShots).eq(0)
  for(const key of ['camera','interaction','movement']) expect(index.notes[key]).include('DEFERRED')
 })
 it('binds every authoritative matrix entry field-for-field and in order',()=>{
  expect(matrix).length(270)
  matrix.forEach((plan,i)=>BIND.forEach(field=>expect(index.shots[i][field],`${plan.id}:${field}`).deep.eq(plan[field])))
 })
 it('preserves semantic boundary=tie while resolving production total order separately',()=>{
  const boundaries=index.shots.filter(s=>s.relation==='boundary'); expect(boundaries).length(90)
  boundaries.forEach(s=>{expect(s.expectedRelation).eq('tie'); expect(s.semanticRelation).eq('boundary'); expect(s.resolvedExpectedOrdering).oneOf(['agent_behind_target','agent_in_front','tie']); expect(s.runtimeFacts.depthMatch).eq(true)})
 })
 it('has 270 explicit screenshots and 15 labeled contact sheets',()=>{
  expect(readdirSync(join(DIR,'shots')).filter(f=>f.endsWith('.png'))).length(270)
  expect(readdirSync(join(DIR,'contact-sheets')).filter(f=>f.endsWith('.png'))).length(15)
  index.shots.forEach(s=>{expect(s.screenshotFile).match(/^shots\/E13-\d{3}\.png$/); expect(existsSync(join(DIR,s.screenshotFile))).eq(true)})
 })
 it('matches all resolved depths and reports real source-alpha intersections',()=>{
  index.shots.forEach(s=>{const f=s.runtimeFacts; expect(f.shotId).eq(s.id); expect(f.ordering).eq(s.resolvedExpectedOrdering); expect(f.resolvedExpectedOrdering).eq(s.resolvedExpectedOrdering); expect(f.depthMatch).eq(true); expect(f.actualDepth).a('number'); expect(f.targetDepth).a('number'); expect(f.pixelOverlap.method).eq('source-alpha-mask-intersection'); expect(f.pixelOverlap.opaqueIntersectionPixels).a('number'); expect(f.pixelOverlap.visibleOcclusionPixels).a('number')})
 })
 it('uses the current production fixed visual stack and draws duplicate mid/foreground twice',()=>{
  expect(index.productionVisualStack.fixedDepths).deep.eq({base:0,'mid-occluders':2,'foreground-occluders':5,'lighting-overlay':8})
  expect(index.productionVisualStack.lighting).deep.eq({opacity:0.85,tintcolor:'#ffd8a0',imageBlend:'screen',tintBlend:'multiply'})
  expect(index.productionVisualStack.canvasRaster.productionAntiAlias).eq(true); expect(index.productionVisualStack.canvasRaster.scaledSpriteSampling).include('bilinear'); expect(index.productionVisualStack.canvasRaster.browserCanvasBitIdentityClaim).eq(false)
  expect(index.productionVisualStack.midForegroundDuplicate.sameBytes).eq(true); expect(index.productionVisualStack.midForegroundDuplicate.drawnTwice).eq(true)
  const stack=index.shots[0].runtimeFacts.fixedLayerStack; expect(stack.map(x=>x.name)).deep.eq(['base','mid-occluders','foreground-occluders','lighting-overlay'])
 })
 it('declares idle/down/frame0 only and checks frames 0..3 alpha-bound invariant',()=>{
  expect(index.sampledFrame).include({animation:'idle',direction:'down',frame:0}); expect(index.sampledFrame.claim).include('not full animation')
  expect(Object.keys(index.frameAlphaBoundsChecks)).length(6)
  Object.values(index.frameAlphaBoundsChecks).forEach(v=>{expect(v.reviewInvariantPass).eq(true); expect(v.sameFrameGeometryAnchorScale).eq(true); expect(v.sameAlphaVerticalExtent).eq(true); expect(v.allAlphaBoundsEqual).a('boolean'); expect(v.frames.map(f=>f.frame)).deep.eq([0,1,2,3])})
 })
 it('records exact fail-closed WebP decoder provenance',()=>{
  expect(index.webpDecoder.soname).eq('libwebp.so.7'); expect(index.webpDecoder.abi).eq(7); expect(index.webpDecoder.decoderVersionHex).match(/^0x[0-9a-f]{6}$/); expect(index.webpDecoder.sha256).match(/^[0-9a-f]{64}$/); expect(index.webpDecoder.api).include('WebPDecodeRGBA'); expect(index.webpDecoder.crossHostPolicy).include('fail-closed')
 })
 for(const persona of ['lujunyi','husanniang']) it(`${persona} behind bounty board has prop-after-agent alpha occlusion`,()=>{
  const s=index.shots.find(x=>x.persona===persona&&x.relation==='behind'&&x.targetStableId==='jyt.prop.northeast.bounty-board.v1'); const f=s.runtimeFacts
  expect(f.ordering).eq('agent_behind_target'); expect(f.drawIndices.target).greaterThan(f.drawIndices.agent); expect(f.pixelOverlap.opaqueIntersectionPixels).greaterThan(0); expect(f.pixelOverlap.agentPixelsOccludedByTarget).greaterThan(0)
 })
 it('lujunyi front main seat has agent-after-prop alpha evidence',()=>{
  const s=index.shots.find(x=>x.persona==='lujunyi'&&x.relation==='front'&&x.targetStableId==='jyt.prop.center-north.main-seat.v1'); const f=s.runtimeFacts
  expect(f.ordering).eq('agent_in_front'); expect(f.drawIndices.agent).greaterThan(f.drawIndices.target); expect(f.pixelOverlap.targetPixelsOccludedByAgent).greaterThan(0)
 })
 it('oracle report proves direct production TS imports across all 270 shots',()=>{
  const oracle=read(join(DIR,'oracle-report.json')); expect(oracle.pass).eq(true); expect(oracle.matrixShots).eq(270); expect(oracle.productionImports).include('src/game/occlusion/worldOrder.ts'); expect(oracle.productionImports).include('src/game/occlusion/constraintResolver.ts'); expect(oracle.productionImports).include('src/game/occlusion/hallSceneAssembly.ts')
 })
})

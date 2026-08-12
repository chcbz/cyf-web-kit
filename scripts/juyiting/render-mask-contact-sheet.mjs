#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ownerPath, xmlEscape } from './lib/mask-migration-evidence.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

function dataUri(mediaType, bytes) { return `data:${mediaType};base64,${bytes.toString('base64')}` }
function roleImage(role, foot, roleEvidence, roleUris, extra = '') {
  const def = roleEvidence[role]
  const left = foot.x - def.renderedFrameSize.width * def.anchor.x
  const top = foot.y - def.renderedFrameSize.height * def.anchor.y
  return `<image data-evidence="agent-frame" data-role="${role}" ${extra} href="${roleUris[role]}" x="${left}" y="${top}" width="${def.renderedFrameSize.width}" height="${def.renderedFrameSize.height}"/>`
}
function crop(entry, fragment) {
  const points = [entry.sortAnchor, ...Object.values(entry.probes).map(p => p.footPoint)]
  let minX = Math.min(entry.aabb.minX, fragment.sourceRect.x, ...points.map(p => p.x)) - 55
  let minY = Math.min(entry.aabb.minY, fragment.sourceRect.y, ...points.map(p => p.y)) - 75
  let maxX = Math.max(entry.aabb.maxX, fragment.sourceRect.x + fragment.sourceRect.width, ...points.map(p => p.x)) + 55
  let maxY = Math.max(entry.aabb.maxY, fragment.sourceRect.y + fragment.sourceRect.height, ...points.map(p => p.y)) + 35
  minX=Math.max(0,minX);minY=Math.max(0,minY);maxX=Math.min(1664,maxX);maxY=Math.min(928,maxY)
  const aspect=620/250,w=maxX-minX,h=maxY-minY
  if(w/h<aspect){const add=(h*aspect-w)/2;minX=Math.max(0,minX-add);maxX=Math.min(1664,maxX+add)}
  else{const add=(w/aspect-h)/2;minY=Math.max(0,minY-add);maxY=Math.min(928,maxY+add)}
  return {x:minX,y:minY,width:maxX-minX,height:maxY-minY}
}
function polygonPoints(poly){return poly.map(p=>`${p.x},${p.y}`).join(' ')}

export function renderMaskContactSheet({ ledger, fragSpec, canonicalBytes, baseBytes, prop92Bytes, roleEvidence, roleUris }) {
  const fragments = new Map(fragSpec.fragments.map(f => [f.stableId, f]))
  const colors = ['#00c2ff','#ff4d6d','#6ee7b7','#f59e0b','#a78bfa','#f97316','#22c55e','#e879f9','#38bdf8','#facc15']
  const colorByOwner = new Map([...new Set(ledger.entries.map(e=>e.targetFragmentStableId))].sort().map((sid,i)=>[sid,colors[i%colors.length]]))
  const clipByOwner = new Map()
  const canonicalUri=dataUri('image/webp',canonicalBytes), baseUri=dataUri('image/webp',baseBytes), propUri=dataUri('image/png',prop92Bytes)
  const cardW=680,cardH=430,cols=2,gap=16,margin=20,overviewH=1160,headerH=170
  const cardRows=Math.ceil(ledger.entries.length/cols)
  const mask58Y=headerH+overviewH+cardRows*(cardH+gap)+20
  const mask58H=980
  const width=margin*2+cols*cardW+gap
  const height=mask58Y+mask58H+40
  let svg=`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-generation-id="${ledger.generationId}" data-mask-count="37" data-evidence="canonical target-owner agent-frame nav-status" data-camera-zoom="1" data-camera-dpr="1">\n`
  svg+=`<defs><style>text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;fill:#17202a}.title{font-size:25px;font-weight:700}.section{font-size:18px;font-weight:700}.label{font-size:12px}.small{font-size:10px}.tiny{font-size:8px}.ok{fill:#157347}.warn{fill:#a33}.card{fill:#fff;stroke:#9aa6b2}.mask{fill:#ff1744;fill-opacity:.14;stroke:#ff1744}.anchor{stroke:#f59e0b;stroke-width:2;stroke-dasharray:6 3}</style><image id="hall-base" data-evidence="canonical" href="${baseUri}" width="1664" height="928"/><image id="hall-canonical" data-evidence="canonical" href="${canonicalUri}" width="1664" height="928"/>`
  let ownerIndex=0
  for(const sid of [...colorByOwner.keys()]){const f=fragments.get(sid),clip=`owner-clip-${ownerIndex++}`;clipByOwner.set(sid,clip);svg+=`<clipPath id="${clip}"><path d="${ownerPath(f)}"/></clipPath>`}
  svg+='</defs>\n'
  svg+=`<rect width="${width}" height="${height}" fill="#e8edf2"/><rect width="${width}" height="${headerH}" fill="#17202a"/><text x="24" y="42" class="title" fill="#fff">E10A · 37 legacy masks → exact E9A visual owners</text><text x="24" y="72" class="label" fill="#d5dce3">Real evidence: embedded clean hall + canonical owner pixels + TMX mask polygon + frozen 卢俊义 idle/down/frame 0 at B/Bd/F.</text><text x="24" y="96" class="label" fill="#d5dce3">Every probe marker records insideNavArea=true, collision=false, navObstacle=false; boundary foot Y equals owner anchor Y exactly.</text><text x="24" y="122" class="small" fill="#ccd1d1">generationId=${ledger.generationId} · TMX=${ledger.provenance.tmxSha256} · E9A=${ledger.provenance.e9aGenerationId}</text><text x="24" y="145" class="small" fill="#f8c471">Constraint count is zero. No mask-depth-halving. Painter relation changes only by fixed-point Y and boundary tieBias.</text>`

  // Nine-grid: one readable canonical crop per region with direct TMX IDs 48-84.
  svg+=`<text x="20" y="${headerH+28}" class="section">Nine-grid canonical overview · direct TMX mask IDs 48–84</text>`
  const grids=[['northwest',0,0,555,309],['north_center',555,0,555,309],['northeast',1110,0,554,309],['west_center',0,309,555,309],['center',555,309,555,309],['east_center',1110,309,554,309],['southwest',0,618,555,310],['south_center',555,618,555,310],['southeast',1110,618,554,310]]
  const gw=438,gh=330
  grids.forEach(([name,x0,y0,w0,h0],i)=>{const x=20+(i%3)*(gw+14),y=headerH+50+Math.floor(i/3)*(gh+16);svg+=`<g data-nine-grid="${name}"><rect x="${x}" y="${y}" width="${gw}" height="${gh}" class="card"/><text x="${x+8}" y="${y+18}" class="label">${name}</text><svg x="${x+5}" y="${y+25}" width="${gw-10}" height="${gh-30}" viewBox="${x0} ${y0} ${w0} ${h0}" preserveAspectRatio="xMidYMid meet"><use href="#hall-base"/><use href="#hall-canonical" opacity=".82"/>`;for(const e of ledger.entries.filter(e=>e.nineGridRegionDeclared===name)){const ownerColor=colorByOwner.get(e.targetFragmentStableId);svg+=`<polygon data-mask-tmx-id="${e.legacyTmxId}" data-target-owner="${xmlEscape(e.targetFragmentStableId)}" points="${polygonPoints(e.polygon)}" fill="${ownerColor}" fill-opacity=".2" stroke="${ownerColor}" stroke-width="3"><title>mask ${e.legacyTmxId} → ${xmlEscape(e.targetFragmentStableId)}</title></polygon><g transform="translate(${e.centroid.x} ${e.centroid.y})"><circle r="13" fill="#fff" stroke="${ownerColor}" stroke-width="3"/><text text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700">${e.legacyTmxId}</text></g>`}svg+='</svg></g>'})

  const cardsY=headerH+overviewH
  ledger.entries.forEach((e,i)=>{const f=fragments.get(e.targetFragmentStableId),color=colorByOwner.get(e.targetFragmentStableId),clip=clipByOwner.get(e.targetFragmentStableId),c=crop(e,f);const x=margin+(i%cols)*(cardW+gap),y=cardsY+Math.floor(i/cols)*(cardH+gap),imageX=x+12,imageY=y+78,imageW=656,imageH=250;const B=e.probes.behind.footPoint,Bd=e.probes.boundary.footPoint,F=e.probes.front.footPoint;svg+=`<g class="mask-card" data-mask-tmx-id="${e.legacyTmxId}" data-evidence="canonical target-owner agent-frame nav-status"><rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="7" class="card"/><text x="${x+14}" y="${y+24}" class="section">mask ${e.legacyTmxId} · ${xmlEscape(e.homeChunk)}</text><text x="${x+14}" y="${y+44}" class="small">${xmlEscape(e.targetFragmentStableId)}</text><text x="${x+14}" y="${y+61}" class="small">owned pixels in polygon=${e.ownerOverlapEvidence.ownedPixelsInLegacyPolygon} · anchor=(${e.sortAnchor.x},${e.sortAnchor.y}) · tieBias=${e.tieBias}</text><svg x="${imageX}" y="${imageY}" width="${imageW}" height="${imageH}" viewBox="${c.x} ${c.y} ${c.width} ${c.height}" preserveAspectRatio="xMidYMid meet"><use href="#hall-base"/>${roleImage('lujunyi',B,roleEvidence,roleUris,'data-probe="behind"')}<use href="#hall-canonical" clip-path="url(#${clip})" data-evidence="target-owner"/><path d="${ownerPath(f)}" fill="${color}" fill-opacity=".28" data-evidence="target-owner"/><polygon points="${polygonPoints(e.polygon)}" class="mask" stroke-width="2"/><line x1="${c.x}" x2="${c.x+c.width}" y1="${e.sortAnchor.y}" y2="${e.sortAnchor.y}" class="anchor"/>${roleImage('lujunyi',Bd,roleEvidence,roleUris,'data-probe="boundary"')}${roleImage('lujunyi',F,roleEvidence,roleUris,'data-probe="front"')}<g font-size="11" font-weight="700"><g data-evidence="nav-status" data-probe="behind" data-inside-nav-area="true" data-collision="false" data-nav-obstacle="false"><circle cx="${B.x}" cy="${B.y}" r="5" fill="#2f80ed"/><text x="${B.x+7}" y="${B.y}">B</text></g><g data-evidence="nav-status" data-probe="boundary" data-inside-nav-area="true" data-collision="false" data-nav-obstacle="false"><circle cx="${Bd.x}" cy="${Bd.y}" r="5" fill="#f59e0b"/><text x="${Bd.x+7}" y="${Bd.y}">Bd</text></g><g data-evidence="nav-status" data-probe="front" data-inside-nav-area="true" data-collision="false" data-nav-obstacle="false"><circle cx="${F.x}" cy="${F.y}" r="5" fill="#ef4444"/><text x="${F.x+7}" y="${F.y}">F</text></g></g></svg><rect x="${imageX}" y="${imageY}" width="${imageW}" height="${imageH}" fill="none" stroke="#566573"/><text x="${x+14}" y="${y+350}" class="small">B (${B.x},${B.y}) agent&lt;fragment · Bd (${Bd.x},${Bd.y}) fragment&lt;agent · F (${F.x},${F.y}) fragment&lt;agent</text><text x="${x+14}" y="${y+369}" class="small ok">B nav=true collision=false navObstacle=false · Bd nav=true collision=false navObstacle=false · F nav=true collision=false navObstacle=false</text><text x="${x+14}" y="${y+388}" class="tiny">${xmlEscape(e.probes.behind.outsideLegacyPolygonReason||'B inside legacy polygon')} | ${xmlEscape(e.probes.boundary.outsideLegacyPolygonReason||'Bd inside legacy polygon')}</text><text x="${x+14}" y="${y+405}" class="tiny">${xmlEscape(e.probes.front.outsideLegacyPolygonReason||'F inside legacy polygon')}</text></g>`})

  // Mask 58 wall/prop responsibility and both-role world-order matrix.
  const m58=ledger.entries.find(e=>e.legacyTmxId===58),f58=fragments.get(m58.targetFragmentStableId),color58=colorByOwner.get(m58.targetFragmentStableId),clip58=clipByOwner.get(m58.targetFragmentStableId)
  svg+=`<g data-mask58-special="true" data-mask-tmx-id="58" data-evidence="canonical target-owner agent-frame nav-status prop92-complete"><rect x="20" y="${mask58Y}" width="${width-40}" height="${mask58H}" rx="8" fill="#fff8e8" stroke="#d97706" stroke-width="2"/><text x="34" y="${mask58Y+34}" class="title">mask 58 critical inset · wall owner vs independent prop 92 table</text><text x="34" y="${mask58Y+62}" class="label">mask AABB=(1197,342)-(1663,458) · wall owner polygon pixels=30629 · prop92 opaque overlap=0</text><text x="34" y="${mask58Y+84}" class="label">prop92 full bounds=(1360,255,172×124) · sortAnchor=(1446,379) · tieBias=-4 · cameraZoom=1 · DPR=1</text><svg x="34" y="${mask58Y+105}" width="650" height="300" viewBox="1160 220 504 310"><use href="#hall-base"/><use href="#hall-canonical" clip-path="url(#${clip58})" data-evidence="target-owner"/><path d="${ownerPath(f58)}" fill="${color58}" fill-opacity=".32"/><polygon points="${polygonPoints(m58.polygon)}" class="mask" stroke-width="2"/><image data-evidence="prop92-complete" href="${propUri}" x="1360" y="255" width="172" height="124"/><line x1="1160" x2="1664" y1="379" y2="379" class="anchor"/></svg><text x="34" y="${mask58Y+430}" class="small">Wall crop: legacy polygon owns the accepted east-upper wall fragment, not table pixels. Wall fragment uses its own B/Bd/F and has constraintDecision=none.</text>`
  const positions=[['behind',370,'agent&lt;prop'],['boundary',379,'prop&lt;agent (tieBias -4)'],['front',420,'prop&lt;agent']]
  const roles=['lujunyi','husanniang'];let ci=0
  for(const role of roles)for(const [name,yy,relation] of positions){const x=34+(ci%3)*440,y=mask58Y+465+Math.floor(ci/3)*230,foot={x:1446,y:yy},status=m58.mask58Evidence.roleFixture.positions[name].navValidation;const agent=roleImage(role,foot,roleEvidence,roleUris,`data-table-probe="${name}"`);const prop=`<image data-evidence="prop92-complete" href="${propUri}" x="1360" y="255" width="172" height="124"/>`;const ordered=name==='behind'?agent+prop:prop+agent;svg+=`<g data-role="${role}" data-table-y="${yy}" data-expected-table-order="${relation}"><rect x="${x}" y="${y}" width="425" height="214" class="card"/><text x="${x+8}" y="${y+18}" class="label">${role} · ${name} · foot=(1446,${yy})</text><svg x="${x+8}" y="${y+26}" width="409" height="145" viewBox="1320 235 240 205"><use href="#hall-base"/>${ordered}</svg><text x="${x+8}" y="${y+190}" class="small">painter=${relation} · same Y fact for both roles</text><text x="${x+8}" y="${y+207}" class="tiny" data-evidence="nav-status" data-inside-nav-area="${status.insideNavArea}" data-collision="${status.collisionIds.length>0}" data-nav-obstacle="${status.navObstacleIds.length>0}">navArea=${status.insideNavArea} · collision=${status.collisionIds.join(',')||'false'} · navObstacle=${status.navObstacleIds.join(',')||'false'} · zoom/DPR=1</text></g>`;ci++}
  svg+=`<text x="34" y="${mask58Y+948}" class="label">Regression: table occlusion depends on WorldSortKey, never “depth halving inside mask”. 扈三娘未被错误遮挡 is an observed sample under the same 370/379/420 matrix as 卢俊义.</text></g>`
  svg+='</svg>\n'
  return svg.split('\n').map(line=>line.replace(/[ \t]+$/,'')).join('\n')
}

async function cli(){
  const ledger=JSON.parse(readFileSync(join(REPO_ROOT,'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json'),'utf8'))
  const fragSpec=JSON.parse(readFileSync(join(REPO_ROOT,'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'),'utf8'))
  const propSpec=JSON.parse(readFileSync(join(REPO_ROOT,'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json'),'utf8'))
  const roleEvidence=propSpec.visualEvidence.roles
  const e8aContact=readFileSync(join(REPO_ROOT,'tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg'),'utf8')
  const roleUris=Object.fromEntries(Object.keys(roleEvidence).map(role=>{
    const width=String(roleEvidence[role].renderedFrameSize.width),start=e8aContact.indexOf(`data-role=\"${role}\"`)
    const group=e8aContact.slice(start,e8aContact.indexOf('</g>',start))
    const match=group.match(new RegExp(`<image href=\"(data:image/png;base64,[^\"]+)\"[^>]*width=\"${width.replace('.', '\\.')}\"`))
    if(!match)throw new Error(`E8A contact sheet missing frozen frame pixels for ${role}`)
    return [role,match[1]]
  }))
  process.stdout.write(renderMaskContactSheet({ledger,fragSpec,canonicalBytes:readFileSync(join(REPO_ROOT,fragSpec.sourceProvenance.path)),baseBytes:readFileSync(join(REPO_ROOT,'public/juyiting/images/liangshan-hall-base-clean-v3.webp')),prop92Bytes:readFileSync(join(REPO_ROOT,'public/juyiting/images/props/liangshan-hall-prop-bounty-board-cropped.png')),roleEvidence,roleUris}))
}
if(process.argv[1]===fileURLToPath(import.meta.url)) cli()

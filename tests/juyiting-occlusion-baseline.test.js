import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { parseTmxStructure, resolveWorldPolygon, polygonAabb } from '../scripts/juyiting/lib/tmx-structure.mjs'
import { assertBaselineProvenance, currentHead } from '../scripts/juyiting/lib/baseline-provenance.mjs'

const TMX_PATH = 'public/juyiting/hall.tmx'
const FIXTURE_DIR = 'tests/fixtures/juyiting/occlusion-v0'
const tmx = readFileSync(TMX_PATH, 'utf8')
const structure = parseTmxStructure(tmx)
const tmxSha256 = () => createHash('sha256').update(tmx).digest('hex')

const inventory = JSON.parse(readFileSync(`${FIXTURE_DIR}/inventory.json`, 'utf8'))
const sourceHashes = JSON.parse(readFileSync(`${FIXTURE_DIR}/source-hashes.json`, 'utf8'))
const assetReport = JSON.parse(readFileSync(`${FIXTURE_DIR}/asset-report.json`, 'utf8'))

// Authoritative region contract from docs/juyiting-occlusion-system-design.md §9.
const AUTHORITATIVE_REGIONS = {
  northwest: [48, 70],
  north_center: [54, 71],
  northeast: [57, 72, 73],
  west_center: [49, 52, 53, 69, 83, 84],
  center: [55],
  east_center: [56, 58, 59, 74, 76, 77, 78, 79, 80],
  southwest: [50, 51, 67, 68],
  south_center: [61, 62, 63, 64, 65, 66],
  southeast: [60, 75, 81, 82],
}

describe('Juyiting occlusion V2 E1 baseline', () => {
  it('machine inventory: 37 masks, 5 props, 3 image layers, collision/nav/hotspot/region/route counts', () => {
    expect(structure.groups.mask.length).to.equal(37)
    const propRects = structure.groups.hotspots.filter(object => object.gid !== undefined)
    expect(propRects.length).to.equal(5)
    expect(structure.layers.filter(layer => layer.kind === 'imagelayer').length).to.equal(3)
    expect(structure.groups.collision.length).to.equal(38)
    expect(structure.groups.nav_obstacles.length).to.equal(38)
    expect(structure.groups.hotspots.filter(object => object.gid === undefined).length).to.equal(5)
    expect(structure.groups.nav_area.length).to.equal(1)
    expect(structure.groups.regions.length).to.equal(8)
    expect(structure.groups.nav_nodes.length).to.equal(14)
    expect(structure.groups.nav_edges.length).to.equal(13)
    expect(structure.groups.patrol_routes.length).to.equal(6)
  })


  it('binds fixtures to a stable ancestor baseline and verifies key bytes at that commit', () => {
    expect(inventory.baselineCommit).to.equal('2424f51f375814f403ca70a9a6e9948728e595b1')
    expect(sourceHashes.baselineCommit).to.equal(inventory.baselineCommit)
    expect(assetReport.baselineCommit).to.equal(inventory.baselineCommit)
    const provenance = assertBaselineProvenance(
      inventory.baselineCommit,
      sourceHashes.entries.map(entry => ({ path: entry.path, sha256: entry.sha256 })),
    )
    expect(provenance.currentHead).to.equal(currentHead())
  })

  it('preserves hall-props objectalignment=topleft and TMX ellipse object shapes', () => {
    const hallProps = structure.tilesets.find(tileset => tileset.name === 'hall-props')
    expect(hallProps.objectAlignment).to.equal('topleft')
    expect(structure.groups.nav_nodes.filter(object => object.ellipse && object.shape === 'ellipse').length).to.equal(9)
    expect(structure.groups.parking_slots.filter(object => object.ellipse && object.shape === 'ellipse').length).to.equal(28)
    expect(structure.groups.queue_slots.filter(object => object.ellipse && object.shape === 'ellipse').length).to.equal(1)
    expect(structure.groups.home_slots.filter(object => object.ellipse && object.shape === 'ellipse').length).to.equal(6)
  })

  it('defines data-generation-id as provisional zero-id SVG sha256, not final SVG self-hash', () => {
    const svg = readFileSync(`${FIXTURE_DIR}/layers/occlusion-combined.svg`, 'utf8')
    const id = svg.match(/data-generation-id="([a-f0-9]{64})"/)?.[1]
    expect(id).to.match(/^[a-f0-9]{64}$/)
    expect(svg).to.include('data-generation-algorithm="sha256-provisional-svg-zero-id-v1"')
    const provisional = svg.replace(`data-generation-id="${id}"`, `data-generation-id="${'0'.repeat(64)}"`)
    expect(createHash('sha256').update(provisional).digest('hex')).to.equal(id)
    expect(createHash('sha256').update(svg).digest('hex')).to.not.equal(id)
  })

  it('committed inventory fixture matches a fresh parse (tmx sha256 + counts)', () => {
    expect(inventory.tmxSha256).to.equal(tmxSha256())
    expect(inventory.counts.masks).to.equal(37)
    expect(inventory.counts.props).to.equal(5)
    expect(inventory.counts.imageLayers).to.equal(3)
    expect(inventory.counts.collision).to.equal(38)
    expect(inventory.counts.navObstacles).to.equal(38)
    expect(inventory.counts.hotspots).to.equal(5)
    expect(inventory.counts.regions).to.equal(8)
    expect(inventory.counts.navNodes).to.equal(14)
    expect(inventory.counts.navEdges).to.equal(13)
    expect(inventory.counts.patrolRoutes).to.equal(6)
    expect(inventory.counts.ellipseNavNodes).to.equal(9)
    expect(inventory.counts.ellipseParkingSlots).to.equal(28)
    expect(inventory.counts.ellipseQueueSlots).to.equal(1)
    expect(inventory.counts.ellipseHomeSlots).to.equal(6)
  })

  it('every mask has >= 3 vertices and a positive-area AABB', () => {
    for (const object of structure.groups.mask) {
      const polygon = resolveWorldPolygon(object)
      expect(polygon, `mask tmx:${object.id}`).to.not.equal(null)
      expect(polygon.length, `mask tmx:${object.id}`).to.be.at.least(3)
      const aabb = polygonAabb(polygon)
      expect(aabb.width, `mask tmx:${object.id}`).to.be.greaterThan(0)
      expect(aabb.height, `mask tmx:${object.id}`).to.be.greaterThan(0)
    }
  })

  it('mask ledger covers all 37 masks and matches the committed inventory', () => {
    expect(inventory.masks.length).to.equal(37)
    const ledger = readFileSync(`${FIXTURE_DIR}/mask-ledger.md`, 'utf8')
    const seen = inventory.masks.map(mask => `| ${mask.index} | ${mask.tmxId} |`)
    for (const row of seen) {
      expect(ledger.includes(row), `ledger missing row ${row}`).to.equal(true)
    }
  })

  it('region distribution matches the frozen §9 design contract', () => {
    const actual = Object.fromEntries(Object.keys(AUTHORITATIVE_REGIONS).map(region => [region, []]))
    for (const mask of inventory.masks) {
      expect(actual[mask.region], `mask ${mask.tmxId} unknown region`).to.not.equal(undefined)
      actual[mask.region].push(mask.tmxId)
    }
    for (const [region, expectedIds] of Object.entries(AUTHORITATIVE_REGIONS)) {
      expect(actual[region].slice().sort((a, b) => a - b), region).to.deep.equal(expectedIds.slice().sort((a, b) => a - b))
    }
    expect(inventory.masks.filter(mask => !mask.regionMatch).map(mask => mask.tmxId).sort((a, b) => a - b))
      .to.deep.equal([49, 54, 57, 74, 76, 80, 83])
  })

  it('canonical source sha-256 matches the frozen contract and duplicate occluder pair is identical', () => {
    expect(sourceHashes.canonicalSource.assetRef).to.equal('jyt.occlusion-source.hall-v3')
    expect(sourceHashes.canonicalSource.path).to.equal('public/juyiting/images/liangshan-hall-mid-occluders-v3.webp')
    expect(sourceHashes.canonicalSource.actualSha256).to.equal('3e4f3f90b4d84411a844978237a7d3530bd481c37a62bcd73b9d694a7d2dd432')
    expect(sourceHashes.canonicalSource.matches).to.equal(true)
    const duplicates = sourceHashes.duplicates
    expect(duplicates.length).to.equal(1)
    expect(duplicates[0].paths).to.include('public/juyiting/images/liangshan-hall-mid-occluders-v3.webp')
    expect(duplicates[0].paths).to.include('public/juyiting/images/liangshan-hall-foreground-occluders-v3.webp')
  })

  it('five prop rects map to hall-props tiles and the bounty-board prop sha matches V0', () => {
    const hallProps = structure.tilesets.find(tileset => tileset.name === 'hall-props')
    expect(hallProps).to.not.equal(undefined)
    expect(hallProps.tiles.length).to.equal(5)
    const expected = {
      'main-seat-rect': 'images/props/liangshan-hall-prop-main-seat-cropped.png',
      'agent-roster-rect': 'images/props/liangshan-hall-prop-agent-roster-cropped.png',
      'bounty-board-rect': 'images/props/liangshan-hall-prop-bounty-board-cropped.png',
      'library-shelf-rect': 'images/props/liangshan-hall-prop-library-shelf-cropped.png',
      'roster-book-rect': 'images/props/liangshan-hall-prop-roster-book-cropped.png',
    }
    const props = structure.groups.hotspots.filter(object => object.gid !== undefined)
    for (const prop of props) {
      const tileIndex = prop.gid - hallProps.firstGid
      const tile = hallProps.tiles.find(candidate => candidate.id === tileIndex)
      expect(expected[prop.name], `prop ${prop.name}`).to.equal(tile.image)
    }
    const bounty = sourceHashes.entries.find(entry => entry.label === 'liangshan-hall-prop-bounty-board-cropped.png')
    expect(bounty.sha256).to.equal('2e4c3e749119392b01a7301aaa8f40986a09e5cc731ab61105ed600a755b6252')
    expect(inventory.props.find(prop => prop.name === 'bounty-board-rect').tmxId).to.equal(92)
  })

  it('derives runtimeCore from audited runtime references and excludes legacy hall tiles', () => {
    const network = assetReport.juyitingNetworkAssets
    const expectedRuntimePaths = [
      'public/juyiting/hall.tmx',
      'public/juyiting/images/liangshan-hall-base-clean-v3.webp',
      'public/juyiting/images/liangshan-hall-foreground-occluders-v3.webp',
      'public/juyiting/images/liangshan-hall-lighting-overlay-v3.webp',
      'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp',
      'public/juyiting/images/props/liangshan-hall-prop-agent-roster-cropped.png',
      'public/juyiting/images/props/liangshan-hall-prop-bounty-board-cropped.png',
      'public/juyiting/images/props/liangshan-hall-prop-library-shelf-cropped.png',
      'public/juyiting/images/props/liangshan-hall-prop-main-seat-cropped.png',
      'public/juyiting/images/props/liangshan-hall-prop-roster-book-cropped.png',
      'public/juyiting/sprites/persona-sheets-v1/husanniang-8-direction-v1.webp',
      'public/juyiting/sprites/persona-sheets-v1/likui-8-direction-v2.webp',
      'public/juyiting/sprites/persona-sheets-v1/linchong-8-direction-v1.webp',
      'public/juyiting/sprites/persona-sheets-v1/lujunyi-8-direction-v1.webp',
      'public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp',
      'public/juyiting/sprites/persona-sheets-v1/wuyong-8-direction-v1.webp',
    ]
    expect(network.runtimeCoreFiles.map(entry => entry.path)).to.deep.equal(expectedRuntimePaths)
    expect(network.runtimeCoreBytes).to.equal(network.runtimeCoreFiles.reduce((total, entry) => total + entry.sizeBytes, 0))
    expect(network.runtimeCoreBytes).to.equal(2415264)
    expect(network.runtimeReferenceAudit.missingReferences).to.deep.equal([])
    expect(Object.values(network.runtimeReferenceAudit.loaderContractChecks).every(Boolean)).to.equal(true)

    const legacyPaths = ['public/juyiting/tiles/hall-tileset.json', 'public/juyiting/tiles/hall-tileset.png']
    for (const path of legacyPaths) {
      const entry = network.files.find(candidate => candidate.path === path)
      expect(entry.category, path).to.equal('unreferenced-legacy')
      expect(entry.runtimeReferenced, path).to.equal(false)
      expect(network.runtimeCoreFiles.some(candidate => candidate.path === path), path).to.equal(false)
    }
  })

  it('counts each loaded texture path once and deduplicates content hashes separately', () => {
    const texture = assetReport.textureDecodeEstimate
    expect(new Set(texture.rows.map(row => row.path)).size).to.equal(texture.rows.length)
    expect(texture.rows.some(row => 'effectiveDecodedBytes' in row)).to.equal(false)
    expect(texture.loadedPathDecodedBytes).to.equal(texture.rows.reduce((total, row) => total + row.decodedBytes, 0))

    const firstByHash = new Map()
    for (const row of texture.rows) if (!firstByHash.has(row.sha256)) firstByHash.set(row.sha256, row.decodedBytes)
    expect(texture.uniqueContentDecodedBytes).to.equal([...firstByHash.values()].reduce((total, bytes) => total + bytes, 0))
    expect(texture.duplicateContentOverheadBytes).to.equal(texture.loadedPathDecodedBytes - texture.uniqueContentDecodedBytes)
    expect(texture.loadedPathDecodedBytes).to.equal(50269248)
    expect(texture.uniqueContentDecodedBytes).to.equal(44092480)
    expect(texture.duplicateContentOverheadBytes).to.equal(6176768)

    const occluderRows = texture.rows.filter(row => [
      'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp',
      'public/juyiting/images/liangshan-hall-foreground-occluders-v3.webp',
    ].includes(row.path))
    expect(occluderRows).to.have.length(2)
    expect(occluderRows.map(row => row.decodedBytes)).to.deep.equal([6176768, 6176768])
    expect(occluderRows.reduce((total, row) => total + row.decodedBytes, 0)).to.equal(2 * 6176768)
    expect(texture.duplicateContentGroups).to.have.length(1)
    expect(texture.duplicateContentGroups[0].paths).to.have.members(occluderRows.map(row => row.path))
    expect(texture.duplicateContentGroups[0].duplicateContentOverheadBytes).to.equal(6176768)
  })

  it('V0 evidence report records the four frozen regression entries', () => {
    const report = readFileSync(`${FIXTURE_DIR}/v0-evidence-report.md`, 'utf8')
    for (const id of ['REG-TABLE-LUJUNYI-HISTORICAL', 'REG-TABLE-HUSANNIANG-POSITIVE', 'REG-TABLE-ROLE-INVARIANCE', 'REG-TABLE-TARGET-RELATION']) {
      expect(report.includes(id), `${id} missing from v0-evidence-report.md`).to.equal(true)
    }
  })
})

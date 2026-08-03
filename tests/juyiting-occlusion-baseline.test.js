import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { parseTmxStructure, resolveWorldPolygon, polygonAabb } from '../scripts/juyiting/lib/tmx-structure.mjs'

const TMX_PATH = 'public/juyiting/hall.tmx'
const FIXTURE_DIR = 'tests/fixtures/juyiting/occlusion-v0'
const tmx = readFileSync(TMX_PATH, 'utf8')
const structure = parseTmxStructure(tmx)
const tmxSha256 = () => createHash('sha256').update(tmx).digest('hex')

const inventory = JSON.parse(readFileSync(`${FIXTURE_DIR}/inventory.json`, 'utf8'))
const sourceHashes = JSON.parse(readFileSync(`${FIXTURE_DIR}/source-hashes.json`, 'utf8'))

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

  it('V0 evidence report records the four frozen regression entries', () => {
    const report = readFileSync(`${FIXTURE_DIR}/v0-evidence-report.md`, 'utf8')
    for (const id of ['REG-TABLE-LUJUNYI-HISTORICAL', 'REG-TABLE-HUSANNIANG-POSITIVE', 'REG-TABLE-ROLE-INVARIANCE', 'REG-TABLE-TARGET-RELATION']) {
      expect(report.includes(id), `${id} missing from v0-evidence-report.md`).to.equal(true)
    }
  })
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'mocha'
import { applyTmxEditOps } from '../../../src/game/map/tmxEditOps.js'
import { validateMapRuntime } from '../../../src/game/map/mapValidation.js'
import { parseMovementTmx } from '../../../src/game/map/tmxMovementParser.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const hallPath = join(projectRoot, 'public/juyiting/hall.tmx')
const operationsPath = join(projectRoot, 'tests/fixtures/juyiting/hall-movement-ops.json')

function productionOperations(): Parameters<typeof applyTmxEditOps>[1] {
  return JSON.parse(readFileSync(operationsPath, 'utf8'))
}

describe('TMX edit operations', () => {
  it('is deterministic and byte-idempotent', () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n<map width="104" height="58" tilewidth="16" tileheight="16" nextlayerid="2" nextobjectid="2">\n <properties>\n  <property name="description" value="kept"/>\n </properties>\n <layer id="1" name="background"><data encoding="csv">1</data></layer>\n</map>\n`
    const operations = [
      { op: 'set-map-property', name: 'sceneId', value: 'juyiting-main' },
      { op: 'upsert-object-group', name: 'regions' },
      {
        op: 'upsert-object-by-stable-id', group: 'regions', object: {
          stableId: 'jyt-region-main-seat-v1', x: 10, y: 20, width: 100, height: 80,
          properties: { regionId: 'main-seat', label: 'Main seat', capacity: 6, protected: true, riskLevel: 'low' },
        },
      },
    ] as const

    const first = applyTmxEditOps(source, operations)

    assert.equal(applyTmxEditOps(source, operations), first)
    assert.equal(applyTmxEditOps(first, operations), first)
  })

  it('upserts by stable ID while keeping business IDs separate', () => {
    const source = '<map width="1" height="1" tilewidth="16" tileheight="16"><objectgroup name="regions"></objectgroup></map>\n'
    const operations = [
      {
        op: 'upsert-object-by-stable-id', group: 'regions', object: {
          stableId: 'jyt-region-main-seat-v1', x: 1, y: 2, width: 3, height: 4,
          properties: { regionId: 'main-seat', label: 'Old', capacity: 1, protected: false, riskLevel: 'low' },
        },
      },
      {
        op: 'upsert-object-by-stable-id', group: 'regions', object: {
          stableId: 'jyt-region-main-seat-v1', x: 10, y: 20, width: 30, height: 40,
          properties: { regionId: 'main-seat', label: 'Main seat', capacity: 6, protected: true, riskLevel: 'low' },
        },
      },
    ] as const

    const result = applyTmxEditOps(source, operations)

    assert.equal(result.match(/name="stableId" value="jyt-region-main-seat-v1"/g)?.length, 1)
    assert.equal(result.match(/name="regionId" value="main-seat"/g)?.length, 1)
    assert.match(result, /x="10" y="20" width="30" height="40"/)
    assert.match(result, /name="label" value="Main seat"/)
  })

  it('authors production movement content without changing dimensions or existing art and hotspots', () => {
    const source = readFileSync(hallPath, 'utf8')
    const artLayer = source.match(/ <layer id="1" name="background"[\s\S]*? <\/layer>/)?.[0]
    const hotspots = source.match(/ <objectgroup id="14" name="hotspots"[\s\S]*? <\/objectgroup>/)?.[0]
    assert.ok(artLayer)
    assert.ok(hotspots)

    const result = applyTmxEditOps(source, productionOperations())
    const runtime = parseMovementTmx(result)
    const validation = validateMapRuntime(runtime)

    assert.match(result, /<map[^>]*width="104" height="58" tilewidth="16" tileheight="16"/)
    assert.equal(runtime.width, 1664)
    assert.equal(runtime.height, 928)
    assert.equal(result.includes(artLayer), true)
    assert.equal(result.includes(hotspots), true)
    assert.deepEqual({
      movementSchemaVersion: runtime.movementSchemaVersion,
      navGraphVersion: runtime.navGraphVersion,
      spriteManifestVersion: runtime.spriteManifestVersion,
      sceneId: runtime.sceneId,
    }, {
      movementSchemaVersion: '1',
      navGraphVersion: 'juyiting-main-v1',
      spriteManifestVersion: 'persona-sheets-v1',
      sceneId: 'juyiting-main',
    })
    assert.deepEqual(runtime.regions.map(region => region.regionId).sort(), [
      'agent-roster', 'bounty-board', 'council-table', 'library-shelf', 'main-seat',
    ])
    assert.equal(runtime.slots.some(slot => slot.kind === 'home' && slot.personaCode === 'songjiang'), true)
    assert.deepEqual(validation, { valid: true, errors: [], warnings: [] })
    for (const group of [
      'nav_area', 'nav_obstacles', 'regions', 'nav_nodes', 'nav_edges',
      'parking_slots', 'queue_slots', 'home_slots', 'debug_labels',
    ]) assert.match(result, new RegExp(`<objectgroup[^>]*name="${group}"`), group)
  })

  it('CLI applies operation JSON and leaves a second run byte-identical', function () {
    this.timeout(15_000)
    const directory = mkdtempSync(join(tmpdir(), 'juyiting-map-ops-'))
    try {
      const target = join(directory, 'hall.tmx')
      writeFileSync(target, readFileSync(hallPath))
      const script = join(projectRoot, 'scripts/juyiting/apply-map-ops.mjs')
      execFileSync(process.execPath, [script, target, operationsPath], { cwd: projectRoot, stdio: 'pipe' })
      const first = readFileSync(target, 'utf8')
      execFileSync(process.execPath, [script, target, operationsPath], { cwd: projectRoot, stdio: 'pipe' })
      const second = readFileSync(target, 'utf8')

      assert.equal(second, first)
      assert.equal(validateMapRuntime(parseMovementTmx(second)).valid, true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

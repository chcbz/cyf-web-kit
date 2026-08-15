import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'mocha'
import { applyTmxEditOps } from '../../../src/game/map/tmxEditOps.js'
import { validateMapRuntime } from '../../../src/game/map/mapValidation.js'
import { parseMovementTmx } from '../../../src/game/map/tmxMovementParser.js'
import { spawnSyncCaptured } from '../helpers/spawnCapture.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const hallPath = join(projectRoot, 'public/juyiting/hall.tmx')
const operationsPath = join(projectRoot, 'tests/fixtures/juyiting/hall-movement-ops.json')

function productionOperations(): Parameters<typeof applyTmxEditOps>[1] {
  return JSON.parse(readFileSync(operationsPath, 'utf8'))
}

function objectGroupXml(xml: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const group = xml.match(new RegExp(` <objectgroup[^>]*name="${escaped}"[\\s\\S]*? <\\/objectgroup>`))?.[0]
  assert.ok(group, `missing ${name} object group`)
  return group
}

function withCollisionAsMovementObstacles(xml: string): string {
  return xml
    .replace('name="nav_obstacles"', 'name="nav_obstacles-authored"')
    .replace('name="collision"', 'name="nav_obstacles"')
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

  it('merges owned object fields while preserving unknown TMX content', () => {
    const source = `<map width="1" height="1" tilewidth="16" tileheight="16" nextobjectid="8">
 <objectgroup id="1" name="regions">
  <object id="7" name="legacy-name" type="legacy-type" class="custom-class" custom="keep" x="1" y="2" width="3" height="4" rotation="5">
   <properties>
    <property name="stableId" value="region-stable-v1"/>
    <property name="customProperty" value="keep-me"/>
    <property name="label" value="Old label"/>
   </properties>
   <text color="#ffffff">Keep text</text>
   <point/>
   <extension vendor="keep"><child value="yes"/></extension>
   <ellipse/>
  </object>
 </objectgroup>
</map>
`
    const result = applyTmxEditOps(source, [{
      op: 'upsert-object-by-stable-id', group: 'regions', object: {
        stableId: 'region-stable-v1', x: 10,
        properties: { label: 'New label' },
        shape: { type: 'polygon', points: [[0, 0], [20, 0], [20, 20]] },
      },
    }])

    assert.match(result, /<object id="7" name="legacy-name" type="legacy-type" class="custom-class" custom="keep" x="10" y="2" width="3" height="4" rotation="5">/)
    assert.match(result, /name="customProperty" value="keep-me"/)
    assert.match(result, /name="label" value="New label"/)
    assert.match(result, /<text color="#ffffff">Keep text<\/text>/)
    assert.match(result, /<point\/>/)
    assert.match(result, /<extension vendor="keep"><child value="yes"\/><\/extension>/)
    assert.doesNotMatch(result, /<ellipse\/>/)
    assert.match(result, /<polygon points="0,0 20,0 20,20"\/>/)
  })

  it('inserts JavaScript replacement tokens in attribute values literally', () => {
    const source = `<map><objectgroup name="regions"><object id="1"><properties>
      <property name="stableId" value="region-token-v1"/><property name="label" value="Old"/>
    </properties></object></objectgroup></map>`
    const literal = "literal $& $` $' end"
    const operations = [{
      op: 'upsert-object-by-stable-id', group: 'regions', object: {
        stableId: 'region-token-v1', properties: { label: literal },
      },
    }] as const

    const result = applyTmxEditOps(source, operations)

    assert.match(result, /name="label" value="literal \$&amp; \$` \$' end"/)
    assert.equal(applyTmxEditOps(result, operations), result)
  })

  it('matches and updates text-valued stable IDs without changing representation', () => {
    const source = `<map nextobjectid="2"><objectgroup name="regions"><object id="1"><properties>
      <property name="stableId">region-text-v1</property><property name="label">Old label</property>
      <property name="custom">keep</property>
    </properties><point/></object></objectgroup></map>`
    const operations = [{
      op: 'upsert-object-by-stable-id', group: 'regions', object: {
        stableId: 'region-text-v1', properties: { label: 'New label' },
      },
    }] as const

    const result = applyTmxEditOps(source, operations)

    assert.equal(result.match(/name="stableId"/g)?.length, 1)
    assert.match(result, /<property name="stableId">region-text-v1<\/property>/)
    assert.match(result, /<property name="label">New label<\/property>/)
    assert.match(result, /<property name="custom">keep<\/property>/)
    assert.equal(applyTmxEditOps(result, operations), result)
  })

  it('rejects duplicate object-group names before applying operations', () => {
    const source = '<map><objectgroup name="regions"/><objectgroup name="regions"/></map>'
    assert.throws(
      () => applyTmxEditOps(source, [{ op: 'set-map-property', name: 'sceneId', value: 'changed' }]),
      /Duplicate object group name: regions/,
    )
    assert.equal(source.includes('changed'), false)
  })

  it('rejects global stable-ID duplicates in source or introduced across groups', () => {
    const duplicateSource = `<map><objectgroup name="regions"><object><properties><property name="stableId" value="same"/></properties></object></objectgroup>
      <objectgroup name="nav_nodes"><object><properties><property name="stableId" value="same"/></properties></object></objectgroup></map>`
    assert.throws(() => applyTmxEditOps(duplicateSource, []), /Duplicate stable ID: same/)

    const uniqueSource = `<map><objectgroup name="regions"><object><properties><property name="stableId" value="same"/></properties></object></objectgroup>
      <objectgroup name="nav_nodes"></objectgroup></map>`
    assert.throws(() => applyTmxEditOps(uniqueSource, [{
      op: 'upsert-object-by-stable-id', group: 'nav_nodes', object: {
        stableId: 'same', x: 1, y: 1, properties: { kind: 'normal', channelWidth: 48 },
      },
    }]), /Stable ID same already belongs to object group regions/)
  })

  it('rejects stable-ID conflicts across value-attribute and text property forms', () => {
    const source = `<map><objectgroup name="regions"><object><properties><property name="stableId" value="same"/></properties></object></objectgroup>
      <objectgroup name="nav_nodes"><object><properties><property name="stableId">same</property></properties></object></objectgroup></map>`
    assert.throws(() => applyTmxEditOps(source, []), /Duplicate stable ID: same/)
  })

  it('normalizes decimal and hexadecimal stable-ID references across attribute forms', () => {
    const source = `<map><objectgroup name="regions"><object><properties><property name="stableId" value="same"/></properties></object></objectgroup>
      <objectgroup name="nav_nodes"><object><properties><property name="stableId" value="&#x73;ame"/></properties></object></objectgroup></map>`
    assert.throws(() => applyTmxEditOps(source, []), /Duplicate stable ID: same/)

    const decimalSource = source.replace('&#x73;ame', '&#115;ame')
    assert.throws(() => applyTmxEditOps(decimalSource, []), /Duplicate stable ID: same/)
  })

  it('matches numeric references in text-valued stable IDs', () => {
    for (const encoded of ['&#115;ame', '&#x73;ame']) {
      const source = `<map nextobjectid="2"><objectgroup name="regions"><object id="1"><properties>
        <property name="stableId">${encoded}</property><property name="label">Old</property>
      </properties></object></objectgroup></map>`
      const result = applyTmxEditOps(source, [{
        op: 'upsert-object-by-stable-id', group: 'regions', object: {
          stableId: 'same', properties: { label: 'New' },
        },
      }])

      assert.equal(result.match(/name="stableId"/g)?.length, 1, encoded)
      assert.match(result, /<property name="stableId">same<\/property>/, encoded)
      assert.match(result, /name="label" value="New"|<property name="label">New<\/property>/, encoded)
    }
  })

  it('rejects malformed or XML-invalid numeric references in stable IDs', () => {
    for (const encoded of ['&#xZZ;', '&#12x;', '&#0;', '&#xD800;', '&#x110000;']) {
      const attributeSource = `<map><objectgroup name="regions"><object><properties><property name="stableId" value="${encoded}"/></properties></object></objectgroup></map>`
      const textSource = `<map><objectgroup name="regions"><object><properties><property name="stableId">${encoded}</property></properties></object></objectgroup></map>`
      assert.throws(() => applyTmxEditOps(attributeSource, []), /Invalid XML numeric character reference/, `attribute ${encoded}`)
      assert.throws(() => applyTmxEditOps(textSource, []), /Invalid XML numeric character reference/, `text ${encoded}`)
    }
  })

  it('rejects duplicate map properties before mutation', () => {
    const source = `<map><properties><property name="sceneId" value="first"/><property name="sceneId" value="later"/></properties></map>`
    assert.throws(
      () => applyTmxEditOps(source, [{ op: 'set-map-property', name: 'sceneId', value: 'changed' }]),
      /Duplicate map property: sceneId/,
    )
    assert.equal(source, `<map><properties><property name="sceneId" value="first"/><property name="sceneId" value="later"/></properties></map>`)
  })

  it('authors production movement content without changing dimensions or existing art and hotspots', function () {
    this.timeout(60_000)
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
      navGraphVersion: 'juyiting-main-v2-candidate-final',
      spriteManifestVersion: 'persona-sheets-v1',
      sceneId: 'juyiting-main',
    })
    assert.deepEqual(runtime.regions.map(region => region.regionId).sort(), [
      'agent-roster', 'bounty-board', 'council-table', 'gate',
      'hall-patrol-northeast', 'hall-patrol-northwest', 'hall-patrol-southeast',
      'hall-patrol-southwest', 'library-shelf', 'main-seat', 'right-guard', 'roster-book',
    ])
    assert.equal(runtime.slots.some(slot => slot.kind === 'home' && slot.personaCode === 'songjiang'), true)
    assert.deepEqual(validation, { valid: true, errors: [], warnings: [] })
    for (const group of [
      'nav_area', 'nav_obstacles', 'regions', 'nav_nodes', 'nav_edges',
      'parking_slots', 'queue_slots', 'home_slots', 'debug_labels',
    ]) assert.match(result, new RegExp(`<objectgroup[^>]*name="${group}"`), group)
  })

  it('matches and safely navigates the existing production collision geometry', () => {
    const source = readFileSync(hallPath, 'utf8')
    const runtime = parseMovementTmx(source)
    const collisionRuntime = parseMovementTmx(withCollisionAsMovementObstacles(source))
    const collisionGroup = objectGroupXml(source, 'collision')
    const navObstacleGroup = objectGroupXml(source, 'nav_obstacles')
    const collisionObjectCount = collisionGroup.match(/<object\b/g)?.length ?? 0
    const obstacleObjectCount = navObstacleGroup.match(/<object\b/g)?.length ?? 0

    assert.ok(collisionObjectCount > 0)
    assert.equal(obstacleObjectCount, collisionObjectCount)
    assert.equal(navObstacleGroup.match(/name="stableId"/g)?.length, collisionObjectCount)
    assert.deepEqual(runtime.obstacles, collisionRuntime.obstacles)
    assert.deepEqual(
      validateMapRuntime({ ...runtime, obstacles: collisionRuntime.obstacles }),
      { valid: true, errors: [], warnings: [] },
    )
  })

  it('CLI applies operation JSON and leaves a second run byte-identical', function () {
    this.timeout(60_000)
    const directory = mkdtempSync(join(tmpdir(), 'juyiting-map-ops-'))
    try {
      const target = join(directory, 'hall.tmx')
      writeFileSync(target, readFileSync(hallPath))
      const script = join(projectRoot, 'scripts/juyiting/apply-map-ops.mjs')
      const firstRun = spawnSyncCaptured(process.execPath, [script, target, operationsPath], { cwd: projectRoot })
      assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.error?.message)
      const first = readFileSync(target, 'utf8')
      const secondRun = spawnSyncCaptured(process.execPath, [script, target, operationsPath], { cwd: projectRoot })
      assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.error?.message)
      const second = readFileSync(target, 'utf8')

      assert.equal(second, first)
      assert.equal(validateMapRuntime(parseMovementTmx(second)).valid, true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

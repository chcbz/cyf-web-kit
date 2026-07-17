import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
// @ts-expect-error jsdom is a runtime test dependency without bundled declarations
import { JSDOM } from 'jsdom'
// @ts-expect-error melonJS does not publish declarations for its internal TMX utility
import * as TMXUtils from 'melonjs/dist/melonjs.mjs/level/tiled/TMXUtils.js'

import { parseMovementTmx } from '../../../src/game/map/tmxMovementParser.js'

const dom = new JSDOM()

describe('movement TMX parser', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <map width="104" height="58" tilewidth="16" tileheight="16">
      <properties>
        <property name="movementSchemaVersion" value="1"/>
        <property name="navGraphVersion" value="juyiting-main-v1"/>
        <property name="spriteManifestVersion" value="persona-sheets-v1"/>
        <property name="sceneId" value="juyiting-main"/>
      </properties>
      <objectgroup name="regions">
        <object x="10" y="20" width="30" height="40"><properties>
          <property name="stableId" value="region-main-v1"/><property name="regionId" value="main-seat"/>
          <property name="label" value="Main seat"/><property name="capacity" type="int" value="6"/>
          <property name="protected" type="bool" value="true"/><property name="riskLevel" value="high"/>
        </properties></object>
        <object x="100" y="200"><properties>
          <property name="stableId" value="region-polygon-v1"/><property name="regionId" value="polygon-room"/>
          <property name="label" value="Polygon room"/><property name="capacity" type="int" value="2"/>
          <property name="protected" type="bool" value="false"/><property name="riskLevel" value="low"/>
        </properties><polygon points="0,0 20,0 10,15"/></object>
        <object x="300" y="400" width="20" height="10"><properties>
          <property name="stableId" value="region-ellipse-v1"/><property name="regionId" value="ellipse-room"/>
          <property name="label" value="Ellipse room"/><property name="capacity" type="int" value="3"/>
          <property name="protected" type="bool" value="false"/><property name="riskLevel" value="medium"/>
        </properties><ellipse/></object>
      </objectgroup>
      <objectgroup name="nav_obstacles"><object x="50" y="60"><polygon points="0,0 5,0 5,5"/></object></objectgroup>
      <objectgroup name="nav_nodes"><object x="200" y="100" width="20" height="10"><properties>
        <property name="stableId" value="node-main"/><property name="kind" value="junction"/>
        <property name="channelWidth" type="float" value="72.5"/>
      </properties><ellipse/></object></objectgroup>
      <objectgroup name="nav_edges"><object x="210" y="105"><properties>
        <property name="stableId" value="edge-main"/><property name="from" value="node-main"/>
        <property name="to" value="node-other"/><property name="bidirectional" type="bool" value="true"/>
        <property name="costMultiplier" type="float" value="1.25"/>
      </properties><polyline points="0,0 50,25"/></object></objectgroup>
      <objectgroup name="parking_slots"><object x="400" y="300" width="36" height="20"><properties>
        <property name="stableId" value="slot-parking-v1"/><property name="slotId" value="council-parking-1"/>
        <property name="regionId" value="main-seat"/>
      </properties><ellipse/></object></objectgroup>
      <objectgroup name="queue_slots"><object x="500" y="350" width="20" height="20"><properties>
        <property name="stableId" value="slot-queue-v1"/><property name="slotId" value="council-queue-1"/>
        <property name="regionId" value="main-seat"/>
      </properties><ellipse/></object></objectgroup>
      <objectgroup name="home_slots"><object x="600" y="450" width="20" height="10"><properties>
        <property name="stableId" value="home-songjiang-v1"/><property name="slotId" value="home-songjiang"/>
        <property name="regionId" value="main-seat"/><property name="personaCode" value="songjiang"/>
      </properties><ellipse/></object></objectgroup>
    </map>`

  it('declares the XML parser as a production dependency', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    assert.equal(packageJson.dependencies?.saxes, '^6.0.0')
    assert.equal(packageJson.devDependencies?.saxes, undefined)
  })

  it('returns the exact approved runtime contract in native pixel coordinates', () => {
    const result = parseMovementTmx(xml)
    assert.deepEqual(Object.keys(result).sort(), [
      'edges', 'height', 'movementSchemaVersion', 'navGraphVersion', 'nodes', 'obstacles',
      'regions', 'sceneId', 'slots', 'spriteManifestVersion', 'width',
    ])
    assert.deepEqual({
      sceneId: result.sceneId, movementSchemaVersion: result.movementSchemaVersion,
      navGraphVersion: result.navGraphVersion, spriteManifestVersion: result.spriteManifestVersion,
      width: result.width, height: result.height,
    }, {
      sceneId: 'juyiting-main', movementSchemaVersion: '1', navGraphVersion: 'juyiting-main-v1',
      spriteManifestVersion: 'persona-sheets-v1', width: 1664, height: 928,
    })
    assert.deepEqual(result.obstacles, [{ points: [{ x: 50, y: 60 }, { x: 55, y: 60 }, { x: 55, y: 65 }] }])
  })

  it('normalizes rectangle, polygon, and ellipse regions with all required fields', () => {
    const { regions } = parseMovementTmx(xml)
    assert.deepEqual(regions[0], {
      stableId: 'region-main-v1', regionId: 'main-seat', label: 'Main seat', capacity: 6,
      protected: true, riskLevel: 'high',
      polygon: { points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: 10, y: 60 }] },
    })
    assert.deepEqual(regions[1].polygon.points, [{ x: 100, y: 200 }, { x: 120, y: 200 }, { x: 110, y: 215 }])
    assert.equal(regions[2].polygon.points.length, 16)
    assert.deepEqual(regions[2].polygon.points[0], { x: 320, y: 405 })
  })

  it('normalizes node and slot ellipses to center world points using approved names', () => {
    const result = parseMovementTmx(xml)
    assert.deepEqual(result.nodes, [{ stableId: 'node-main', point: { x: 210, y: 105 }, kind: 'junction', channelWidth: 72.5 }])
    assert.deepEqual(result.slots, [
      { stableId: 'slot-parking-v1', slotId: 'council-parking-1', regionId: 'main-seat', point: { x: 418, y: 310 }, kind: 'parking' },
      { stableId: 'slot-queue-v1', slotId: 'council-queue-1', regionId: 'main-seat', point: { x: 510, y: 360 }, kind: 'queue' },
      { stableId: 'home-songjiang-v1', slotId: 'home-songjiang', regionId: 'main-seat', personaCode: 'songjiang', point: { x: 610, y: 455 }, kind: 'home' },
    ])
  })

  it('keeps stableId separate from business regionId and slotId', () => {
    const result = parseMovementTmx(xml)
    assert.deepEqual(result.regions[0], { ...result.regions[0], stableId: 'region-main-v1', regionId: 'main-seat' })
    assert.equal(result.slots[0].stableId, 'slot-parking-v1')
    assert.equal(result.slots[0].slotId, 'council-parking-1')
    assert.equal(result.slots[0].regionId, 'main-seat')
  })

  it('parses edges into the approved edges array', () => {
    assert.deepEqual(parseMovementTmx(xml).edges, [{
      stableId: 'edge-main', from: 'node-main', to: 'node-other', bidirectional: true,
      costMultiplier: 1.25, points: [{ x: 210, y: 105 }, { x: 260, y: 130 }],
    }])
  })

  it('accepts the actual object shape produced by the melonJS TMX parser', () => {
    const document = new dom.window.DOMParser().parseFromString(xml, 'application/xml')
    const melonMap = TMXUtils.parse(document).map
    assert.equal(typeof melonMap.width, 'string')
    const melonNode = melonMap.layers.find((layer: { name: string }) => layer.name === 'nav_nodes').objects[0]
    assert.equal(typeof melonNode.x, 'string')
    assert.equal(melonNode.ellipse.constructor, Object)

    assert.deepEqual(parseMovementTmx(melonMap), parseMovementTmx(xml))
  })

  it('parses raw XML in a plain Node process without a global DOMParser', () => {
    const parserUrl = new URL('../../../src/game/map/tmxMovementParser.ts', import.meta.url).href
    const encodedXml = Buffer.from(xml).toString('base64')
    const script = `
      delete globalThis.DOMParser;
      const { parseMovementTmx } = await import(${JSON.stringify(parserUrl)});
      const result = parseMovementTmx(Buffer.from(${JSON.stringify(encodedXml)}, 'base64').toString('utf8'));
      process.stdout.write(JSON.stringify({ sceneId: result.sceneId, nodes: result.nodes.length }));
    `
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: process.cwd(), encoding: 'utf8',
    })
    assert.deepEqual(JSON.parse(output), { sceneId: 'juyiting-main', nodes: 1 })
  })

  it('rejects malformed scalar properties with field context', () => {
    const replacements: Array<[string, string, RegExp]> = [
      ['capacity', 'many', /capacity/],
      ['protected', 'sometimes', /protected/],
      ['riskLevel', 'extreme', /riskLevel/],
      ['kind', 'crossroads', /kind/],
      ['channelWidth', 'wide', /channelWidth/],
      ['bidirectional', 'yes', /bidirectional/],
      ['costMultiplier', 'cheap', /costMultiplier/],
    ]
    for (const [field, invalid, expected] of replacements) {
      const malformed = xml.replace(new RegExp(`(<property name="${field}"[^>]*value=")[^"]*`), `$1${invalid}`)
      assert.throws(() => parseMovementTmx(malformed), expected, field)
    }
  })

  it('rejects malformed geometry scalars instead of coercing them to zero', () => {
    assert.throws(() => parseMovementTmx(xml.replace('x="10"', 'x="left"')), /regions.*x|x.*regions/)
    assert.throws(() => parseMovementTmx(xml.replace('width="30"', 'width="broad"')), /regions.*width|width.*regions/)
  })

  it('rejects malformed and truncated raw XML', () => {
    assert.throws(() => parseMovementTmx('<map><objectgroup name="regions">'), /Invalid TMX XML/)
    assert.throws(() => parseMovementTmx('<not-map/>'), /TMX map root/)
  })

  it('applies object-layer offsets and object rotations to all world geometry', () => {
    const transformedXml = `<map width="20" height="20" tilewidth="16" tileheight="16"><properties>
      <property name="movementSchemaVersion" value="1"/><property name="navGraphVersion" value="graph"/>
      <property name="spriteManifestVersion" value="sprites"/><property name="sceneId" value="scene"/>
    </properties>
    <objectgroup name="regions" offsetx="100" offsety="50"><object x="10" y="20" rotation="90"><properties>
      <property name="stableId" value="region"/><property name="regionId" value="region"/><property name="label" value="Region"/>
      <property name="capacity" type="int" value="1"/><property name="protected" type="bool" value="false"/><property name="riskLevel" value="low"/>
    </properties><polygon points="0,0 10,0 10,10"/></object></objectgroup>
    <objectgroup name="nav_obstacles" offsetx="100" offsety="50"><object x="20" y="30" width="10" height="20" rotation="90"/></objectgroup>
    <objectgroup name="nav_nodes" offsetx="100" offsety="50"><object x="30" y="40" width="20" height="10" rotation="90"><properties>
      <property name="stableId" value="node"/><property name="kind" value="normal"/><property name="channelWidth" type="int" value="10"/>
    </properties><ellipse/></object></objectgroup>
    <objectgroup name="parking_slots" offsetx="100" offsety="50"><object x="50" y="60" width="20" height="10" rotation="180"><properties>
      <property name="stableId" value="slot"/><property name="slotId" value="slot"/><property name="regionId" value="region"/>
    </properties><ellipse/></object></objectgroup>
    <objectgroup name="nav_edges" offsetx="100" offsety="50"><object x="70" y="80" rotation="90"><properties>
      <property name="stableId" value="edge"/><property name="from" value="node"/><property name="to" value="other"/>
    </properties><polyline points="0,0 10,0"/></object></objectgroup></map>`
    const result = parseMovementTmx(transformedXml)
    assert.deepEqual(result.regions[0].polygon.points, [{ x: 110, y: 70 }, { x: 110, y: 80 }, { x: 100, y: 80 }])
    assert.deepEqual(result.obstacles[0].points, [{ x: 120, y: 80 }, { x: 120, y: 90 }, { x: 100, y: 90 }, { x: 100, y: 80 }])
    assert.deepEqual(result.nodes[0].point, { x: 125, y: 100 })
    assert.deepEqual(result.slots[0].point, { x: 140, y: 105 })
    assert.deepEqual(result.edges[0].points, [{ x: 170, y: 130 }, { x: 170, y: 140 }])
  })

  it('produces equivalent transformed geometry from raw XML and melonJS parsed data', () => {
    const transformed = xml
      .replace('<objectgroup name="regions">', '<objectgroup name="regions" offsetx="17" offsety="23">')
      .replace('<object x="10" y="20" width="30" height="40">', '<object x="10" y="20" width="30" height="40" rotation="90">')
    const document = new dom.window.DOMParser().parseFromString(transformed, 'application/xml')
    assert.deepEqual(parseMovementTmx(TMXUtils.parse(document).map), parseMovementTmx(transformed))
  })

  it('ignores known visual aliases without confusing them with movement data', () => {
    const result = parseMovementTmx(`<map width="1" height="1" tilewidth="16" tileheight="16">
      <properties><property name="sceneId" value="scene"/><property name="movementSchemaVersion" value="1"/>
        <property name="navGraphVersion" value="graph"/><property name="spriteManifestVersion" value="sprites"/></properties>
      <objectgroup name="mid-occluders"><object x="1" y="1" width="1" height="1"/></objectgroup>
      <objectgroup name="foreground-occluders"><object x="2" y="2" width="1" height="1"/></objectgroup>
      <objectgroup name="lighting-overlay"><object x="3" y="3" width="1" height="1"/></objectgroup>
    </map>`)
    assert.deepEqual(result.regions, [])
    assert.deepEqual(result.nodes, [])
    assert.deepEqual(result.edges, [])
    assert.deepEqual(result.slots, [])
    assert.deepEqual(result.obstacles, [])
  })

  it('does not accept hyphenated movement groups or arbitrary legacy names as movement groups', () => {
    const parsed = {
      width: 1, height: 1, tilewidth: 16, tileheight: 16,
      properties: { sceneId: 'scene', movementSchemaVersion: '1', navGraphVersion: 'graph', spriteManifestVersion: 'sprites' },
      layers: ['nav-nodes', 'nav-edges', 'nav-obstacles', 'parking-slots', 'regions-old', 'made-up-legacy'].map(name => ({
        name, type: 'objectgroup', objects: [{ x: 0, y: 0, width: 10, height: 10, ellipse: {}, properties: {
          stableId: `${name}-object`, regionId: 'wrong', slotId: 'wrong', kind: 'normal', channelWidth: 1,
          from: 'a', to: 'b',
        } }],
      })),
    }
    const result = parseMovementTmx(parsed)
    assert.deepEqual(result.regions, [])
    assert.deepEqual(result.nodes, [])
    assert.deepEqual(result.edges, [])
    assert.deepEqual(result.slots, [])
    assert.deepEqual(result.obstacles, [])
  })
})

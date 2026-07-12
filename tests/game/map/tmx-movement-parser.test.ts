import assert from 'node:assert/strict'

import { parseMovementTmx } from '../../../src/game/map/tmxMovementParser.js'

describe('movement TMX parser', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <map width="104" height="58" tilewidth="16" tileheight="16">
      <properties>
        <property name="movementSchemaVersion" value="1"/>
        <property name="navGraphVersion" value="juyiting-main-v1"/>
        <property name="spriteManifestVersion" value="persona-sheets-v1"/>
        <property name="sceneId" value="juyiting-main"/>
      </properties>
      <objectgroup name="mid-occluders"/>
      <objectgroup name="regions">
        <object id="1" x="10" y="20" width="30" height="40">
          <properties>
            <property name="stableId" value="region-main-v1"/>
            <property name="regionId" value="main-seat"/>
            <property name="label" value="Main seat"/>
            <property name="capacity" type="int" value="6"/>
            <property name="protected" type="bool" value="true"/>
            <property name="riskLevel" value="high"/>
          </properties>
        </object>
        <object id="2" x="100" y="200">
          <properties>
            <property name="stableId" value="region-polygon-v1"/>
            <property name="regionId" value="polygon-room"/>
          </properties>
          <polygon points="0,0 20,0 10,15"/>
        </object>
        <object id="3" x="300" y="400" width="20" height="10">
          <properties>
            <property name="stableId" value="region-ellipse-v1"/>
            <property name="regionId" value="ellipse-room"/>
          </properties>
          <ellipse/>
        </object>
      </objectgroup>
      <objectgroup name="nav_area">
        <object id="4" x="0" y="0" width="1664" height="928"/>
      </objectgroup>
      <objectgroup name="nav_obstacles">
        <object id="5" x="50" y="60"><polygon points="0,0 5,0 5,5"/></object>
      </objectgroup>
      <objectgroup name="nav_nodes">
        <object id="6" x="200" y="100" width="20" height="10">
          <properties>
            <property name="stableId" value="node-main"/>
            <property name="kind" value="junction"/>
            <property name="channelWidth" type="float" value="72.5"/>
          </properties>
          <ellipse/>
        </object>
      </objectgroup>
      <objectgroup name="nav_edges">
        <object id="7" x="210" y="105">
          <properties>
            <property name="stableId" value="edge-main"/>
            <property name="from" value="node-main"/>
            <property name="to" value="node-other"/>
            <property name="bidirectional" type="bool" value="true"/>
            <property name="costMultiplier" type="float" value="1.25"/>
          </properties>
          <polyline points="0,0 50,25"/>
        </object>
      </objectgroup>
      <objectgroup name="parking_slots">
        <object id="8" x="400" y="300" width="36" height="20">
          <properties>
            <property name="stableId" value="slot-parking"/>
            <property name="regionId" value="main-seat"/>
            <property name="priority" type="int" value="1"/>
            <property name="capacity" type="int" value="1"/>
            <property name="facing" value="left"/>
            <property name="radiusX" type="int" value="18"/>
            <property name="radiusY" type="int" value="10"/>
          </properties><ellipse/>
        </object>
      </objectgroup>
      <objectgroup name="queue_slots">
        <object id="9" x="500" y="350" width="20" height="20">
          <properties><property name="stableId" value="slot-queue"/><property name="regionId" value="main-seat"/></properties><ellipse/>
        </object>
      </objectgroup>
      <objectgroup name="home_slots">
        <object id="10" x="600" y="450" width="20" height="10">
          <properties><property name="stableId" value="home-songjiang"/><property name="regionId" value="main-seat"/><property name="personaCode" value="songjiang"/></properties><ellipse/>
        </object>
      </objectgroup>
    </map>`

  it('parses map metadata and native-pixel movement geometry from raw XML', () => {
    const result = parseMovementTmx(xml)

    assert.deepEqual({
      sceneId: result.sceneId, movementSchemaVersion: result.movementSchemaVersion,
      navGraphVersion: result.navGraphVersion, spriteManifestVersion: result.spriteManifestVersion,
      width: result.width, height: result.height,
    }, {
      sceneId: 'juyiting-main', movementSchemaVersion: '1', navGraphVersion: 'juyiting-main-v1',
      spriteManifestVersion: 'persona-sheets-v1', width: 1664, height: 928,
    })
    assert.deepEqual(result.navArea, [{ points: [{ x: 0, y: 0 }, { x: 1664, y: 0 }, { x: 1664, y: 928 }, { x: 0, y: 928 }] }])
    assert.deepEqual(result.navObstacles, [{ points: [{ x: 50, y: 60 }, { x: 55, y: 60 }, { x: 55, y: 65 }] }])
  })

  it('normalizes rectangle, polygon, and ellipse regions to world polygons', () => {
    const { regions } = parseMovementTmx(xml)
    assert.deepEqual(regions[0], {
      stableId: 'region-main-v1', regionId: 'main-seat', label: 'Main seat', capacity: 6,
      protected: true, riskLevel: 'high', polygon: { points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: 10, y: 60 }] },
    })
    assert.deepEqual(regions[1].polygon.points, [{ x: 100, y: 200 }, { x: 120, y: 200 }, { x: 110, y: 215 }])
    assert.equal(regions[2].polygon.points.length, 16)
    assert.deepEqual(regions[2].polygon.points[0], { x: 320, y: 405 })
  })

  it('normalizes node and slot ellipses to center world points', () => {
    const result = parseMovementTmx(xml)
    assert.deepEqual(result.navNodes, [{ stableId: 'node-main', point: { x: 210, y: 105 }, kind: 'junction', channelWidth: 72.5 }])
    assert.deepEqual(result.slots.find(slot => slot.stableId === 'slot-parking'), { stableId: 'slot-parking', slotType: 'parking', regionId: 'main-seat', point: { x: 418, y: 310 }, priority: 1, capacity: 1, facing: 'left', radiusX: 18, radiusY: 10 })
    assert.deepEqual(result.slots.find(slot => slot.stableId === 'slot-queue'), { stableId: 'slot-queue', slotType: 'queue', regionId: 'main-seat', point: { x: 510, y: 360 } })
    assert.deepEqual(result.slots.find(slot => slot.stableId === 'home-songjiang'), { stableId: 'home-songjiang', slotType: 'home', regionId: 'main-seat', personaCode: 'songjiang', point: { x: 610, y: 455 } })
  })

  it('keeps stable object identity separate from business region identity', () => {
    const result = parseMovementTmx(xml)
    assert.equal(result.regions[0].stableId, 'region-main-v1')
    assert.equal(result.regions[0].regionId, 'main-seat')
    assert.equal(result.slots[0].stableId, 'slot-parking')
    assert.equal(result.slots[0].regionId, 'main-seat')
  })

  it('parses nav edge references and world-space polyline points', () => {
    assert.deepEqual(parseMovementTmx(xml).navEdges, [{
      stableId: 'edge-main', from: 'node-main', to: 'node-other', bidirectional: true,
      costMultiplier: 1.25, points: [{ x: 210, y: 105 }, { x: 260, y: 130 }],
    }])
  })

  it('accepts melonJS-style parsed map objects', () => {
    const result = parseMovementTmx({
      width: 104, height: 58, tilewidth: 16, tileheight: 16,
      properties: { movementSchemaVersion: '1', navGraphVersion: 'graph-v1', spriteManifestVersion: 'sprites-v1', sceneId: 'scene-v1' },
      layers: [{ name: 'nav_nodes', objects: [{ x: 8, y: 12, width: 4, height: 6, ellipse: true, properties: { stableId: 'node-a', kind: 'normal' } }] }],
    })
    assert.equal(result.width, 1664)
    assert.equal(result.height, 928)
    assert.deepEqual(result.navNodes, [{ stableId: 'node-a', point: { x: 10, y: 15 }, kind: 'normal' }])
  })

  it('does not treat legacy hyphenated names as movement groups', () => {
    const result = parseMovementTmx(`<map width="1" height="1" tilewidth="16" tileheight="16">
      <objectgroup name="nav-nodes"><object x="0" y="0" width="10" height="10"><properties><property name="stableId" value="legacy-node"/></properties><ellipse/></object></objectgroup>
      <objectgroup name="foreground-occluders"/>
    </map>`)
    assert.deepEqual(result.navNodes, [])
  })
})

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

import type { MapRuntimeData } from '../../../src/game/map/movementSchema.js'
import { renderMapPreview } from '../../../src/game/map/tmxPreviewRenderer.js'
import { createMapSnapshot, serializeMapSnapshot } from '../../../src/game/map/tmxSnapshot.js'
import { parseMovementTmx } from '../../../src/game/map/tmxMovementParser.js'

const fixtureUrl = new URL('../../fixtures/juyiting/hall-map.snapshot.json', import.meta.url)
const hallTmxUrl = new URL('../../../public/juyiting/hall.tmx', import.meta.url)

describe('Juyiting TMX snapshots and previews', () => {
  it('sorts stable-ID collections and rounds every coordinate to three decimals', () => {
    const runtime = sampleRuntime()
    const original = structuredClone(runtime)

    const snapshot = createMapSnapshot(runtime)

    assert.deepEqual(snapshot.regions.map(item => item.stableId), ['region-a', 'region-z'])
    assert.deepEqual(snapshot.nodes.map(item => item.stableId), ['node-a', 'node-z'])
    assert.deepEqual(snapshot.edges.map(item => item.stableId), ['edge-a', 'edge-z'])
    assert.deepEqual(snapshot.slots.map(item => item.stableId), ['slot-a', 'slot-z'])
    assert.deepEqual(snapshot.regions[0].polygon.points[0], { x: 1.235, y: 2.346 })
    assert.deepEqual(snapshot.nodes[0].point, { x: 5.556, y: 6.667 })
    assert.deepEqual(snapshot.counts, { regions: 2, nodes: 2, edges: 2, slots: 2, obstacles: 2 })
    assert.deepEqual(runtime, original)
  })

  it('produces a deterministic byte representation independent of input ordering', () => {
    const runtime = sampleRuntime()
    const reordered = structuredClone(runtime)
    reordered.regions.reverse()
    reordered.nodes.reverse()
    reordered.edges.reverse()
    reordered.slots.reverse()
    reordered.obstacles.reverse()

    assert.equal(
      serializeMapSnapshot(createMapSnapshot(runtime)),
      serializeMapSnapshot(createMapSnapshot(reordered)),
    )
  })

  it('matches the committed hall snapshot byte for byte', () => {
    const runtime = parseMovementTmx(readFileSync(hallTmxUrl, 'utf8'))
    const expected = readFileSync(fixtureUrl, 'utf8')

    assert.equal(serializeMapSnapshot(createMapSnapshot(runtime)), expected)
  })

  it('renders a native clean preview with map context and business labels only', () => {
    const runtime = sampleRuntime()
    const svg = renderMapPreview(runtime, { debug: false })

    assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg" width="1664" height="928" viewBox="0 0 1664 928"'))
    assert.ok(svg.includes('class="map-art"'))
    assert.ok(svg.includes('Region &amp; &lt;A&gt;'))
    assert.ok(!svg.includes('class="nav-edge"'))
    assert.ok(!svg.includes('node-a'))
  })

  it('renders deterministic escaped debug overlays for graph, obstacles, slots, IDs, and widths', () => {
    const runtime = sampleRuntime()
    const svg = renderMapPreview(runtime, { debug: true })

    assert.equal(renderMapPreview(runtime, { debug: true }), svg)
    assert.ok(svg.includes('class="nav-edge"'))
    assert.ok(svg.includes('marker-end="url(#nav-arrow)"'))
    assert.ok(svg.includes('class="nav-node"'))
    assert.ok(svg.includes('class="obstacle"'))
    assert.ok(svg.includes('class="slot slot-home"'))
    assert.ok(svg.includes('node-a · doorway · 48px'))
    assert.ok(svg.includes('slot-a · home'))
    assert.ok(!svg.includes('<script>'))
    assert.ok(svg.includes('&lt;script&gt;'))
  })
})

function sampleRuntime(): MapRuntimeData {
  return {
    sceneId: 'scene<&',
    movementSchemaVersion: '1',
    navGraphVersion: 'graph<&',
    spriteManifestVersion: 'sprites<&',
    width: 1664,
    height: 928,
    regions: [
      region('region-z', 'Region Z', 9.9999),
      region('region-a', 'Region & <A>', 1.23456),
    ],
    nodes: [
      { stableId: 'node-z', point: { x: 8.8888, y: 9.9999 }, kind: 'normal', channelWidth: 64 },
      { stableId: 'node-a', point: { x: 5.5555, y: 6.6666 }, kind: 'doorway', channelWidth: 48 },
    ],
    edges: [
      { stableId: 'edge-z', from: 'node-z', to: 'node-a', bidirectional: true, costMultiplier: 1, points: [{ x: 8.8888, y: 9.9999 }, { x: 5.5555, y: 6.6666 }] },
      { stableId: 'edge-a', from: 'node-a', to: 'node-z', bidirectional: false, costMultiplier: 1.25, points: [{ x: 5.5555, y: 6.6666 }, { x: 8.8888, y: 9.9999 }] },
    ],
    slots: [
      { stableId: 'slot-z', slotId: 'parking-z', regionId: 'z', point: { x: 20.4444, y: 21.5555 }, kind: 'parking' },
      { stableId: 'slot-a', slotId: '<script>', regionId: 'a', point: { x: 10.1111, y: 11.2222 }, kind: 'home', personaCode: '<script>' },
    ],
    obstacles: [
      { points: [{ x: 40.4444, y: 41.5555 }, { x: 42.6666, y: 43.7777 }, { x: 44.8888, y: 45.9999 }] },
      { points: [{ x: 30.4444, y: 31.5555 }, { x: 32.6666, y: 33.7777 }, { x: 34.8888, y: 35.9999 }] },
    ],
  }
}

function region(stableId: string, label: string, x: number): MapRuntimeData['regions'][number] {
  return {
    stableId,
    regionId: stableId,
    label,
    capacity: 2,
    protected: false,
    riskLevel: 'low',
    polygon: { points: [{ x, y: 2.34567 }, { x: x + 2, y: 2.34567 }, { x: x + 2, y: 4.34567 }] },
  }
}

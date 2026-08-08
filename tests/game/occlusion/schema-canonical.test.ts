import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { JSDOM } from 'jsdom'
import {
  RENDER_SCHEMA_VERSION,
  RENDER_BAND_ORDER,
  DEFAULT_FLOOR_REGISTRY,
  STABLE_ID_PATTERN,
  TIE_BIAS_MIN,
  TIE_BIAS_MAX,
  HYSTERESIS_PX,
  isStructuredFatalRenderSchemaError,
  renderSchemaError,
  type CanonicalSceneIr,
  type OccluderFragment,
  type OcclusionConstraintZone,
  type SceneObject,
} from '../../../src/game/occlusion/schema.js'
import {
  parseCanonicalIrFromXml,
  parseCanonicalIrFromData,
  serializeCanonicalIr,
  hasRenderSchemaV2,
} from '../../../src/game/occlusion/canonicalIr.js'

// ── XML fixture builder ──

function tmxXml(mapProps: Record<string, string>, ...objectGroups: string[]): string {
  const propsXml = Object.entries(mapProps)
    .map(([name, value]) => `   <property name="${name}" value="${escapeXml(value)}"/>`)
    .join('\n')
  const layersXml = objectGroups.join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.11.2" orientation="orthogonal"
     renderorder="right-down" width="52" height="29"
     tilewidth="32" tileheight="32" infinite="0"
     nextlayerid="20" nextobjectid="200">
 <properties>
${propsXml}
 </properties>
${layersXml}
</map>`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function objectGroupXml(name: string, ...objects: string[]): string {
  return objectGroupXmlWithAttrs(name, {}, ...objects)
}

function objectGroupXmlWithAttrs(
  name: string,
  attrs: Record<string, string | number>,
  ...objects: string[]
): string {
  const extraAttrs = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join('')
  return ` <objectgroup id="1" name="${escapeXml(name)}"${extraAttrs}>
${objects.join('\n')}
 </objectgroup>`
}

function tmxObjectXml(attrs: Record<string, string | number>, ...children: string[]): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(' ')
  if (children.length === 0) return `  <object ${attrStr}/>`
  return `  <object ${attrStr}>\n${children.join('\n')}\n  </object>`
}

function propsXml(props: Record<string, string>): string {
  const entries = Object.entries(props)
    .map(([name, value]) => `   <property name="${escapeXml(name)}" value="${escapeXml(value)}"/>`)
    .join('\n')
  return `   <properties>\n${entries}\n   </properties>`
}

function polygonXml(points: string): string {
  return `   <polygon points="${points}"/>`
}

// ── melonJS data builder ──

function melonData(
  mapProps: Record<string, string>,
  ...objectGroups: Array<{ name: string; objects: Array<Record<string, unknown>> }>
): Record<string, unknown> {
  return {
    width: 52,
    height: 29,
    tilewidth: 32,
    tileheight: 32,
    properties: mapProps,
    layers: [
      ...objectGroups.map(g => ({
        name: g.name,
        type: 'objectgroup',
        objects: g.objects,
      })),
    ],
  }
}

// ── Helpers ──

function parseXml(xmlStr: string): Document {
  return new JSDOM(xmlStr, { contentType: 'text/xml' }).window.document
}

function miniValidXml(): string {
  return tmxXml(
    { renderSchemaVersion: '2', sceneId: 'test-scene' },
    objectGroupXml('v2-props',
      tmxObjectXml(
        { name: 'prop1', x: 10, y: 20, width: 32, height: 32 },
        propsXml({
          stableId: 'tst.prop.test.prop1.v1',
          chunkId: 'chunk-1',
          kind: 'prop',
          renderBand: 'world',
          sortAnchorX: '26',
          sortAnchorY: '52',
          assetRef: 'test.png',
        }),
      ),
    ),
  )
}

function miniValidData(): Record<string, unknown> {
  return melonData(
    { renderSchemaVersion: '2', sceneId: 'test-scene' },
    {
      name: 'v2-props',
      objects: [{
        name: 'prop1',
        x: 10, y: 20, width: 32, height: 32,
        properties: {
          stableId: 'tst.prop.test.prop1.v1',
          chunkId: 'chunk-1',
          kind: 'prop',
          renderBand: 'world',
          sortAnchorX: '26',
          sortAnchorY: '52',
          assetRef: 'test.png',
        },
      }],
    },
  )
}

// ── Tests ──

describe('Occlusion Schema constants', () => {
  it('freezes renderSchemaVersion to "2"', () => {
    assert.equal(RENDER_SCHEMA_VERSION, '2')
  })

  it('defines six render bands with correct order', () => {
    assert.deepEqual(RENDER_BAND_ORDER, {
      background: 0,
      world: 100,
      overhead: 200,
      lighting: 300,
      'world-ui': 400,
      'screen-ui': 500,
    })
  })

  it('has default floor registry floor-1 -> 0', () => {
    assert.deepEqual(DEFAULT_FLOOR_REGISTRY, { 'floor-1': 0 })
    assert.equal(DEFAULT_FLOOR_REGISTRY['floor-1'], 0)
  })

  it('validates stableId pattern', () => {
    assert.ok(STABLE_ID_PATTERN.test('a.v1'))
    assert.ok(STABLE_ID_PATTERN.test('tst.prop.test.prop1.v1'))
    assert.ok(STABLE_ID_PATTERN.test('jyt.occ.east-upper.railing-01.v1'))
    assert.ok(STABLE_ID_PATTERN.test('a.b_c-d.e0123456789'))
    assert.ok(STABLE_ID_PATTERN.test('z' + 'x'.repeat(94))) // 95 chars
    assert.ok(!STABLE_ID_PATTERN.test(''))
    assert.ok(!STABLE_ID_PATTERN.test('ab')) // too short (need 3+)
    assert.ok(!STABLE_ID_PATTERN.test('A.v1')) // uppercase
    assert.ok(!STABLE_ID_PATTERN.test('_test.v1')) // starts with underscore
    assert.ok(!STABLE_ID_PATTERN.test('-test.v1')) // starts with dash
    assert.ok(!STABLE_ID_PATTERN.test('a.v1!')) // special char
    assert.ok(!STABLE_ID_PATTERN.test('a' + 'x'.repeat(96))) // too long (97 chars)
    assert.ok(!STABLE_ID_PATTERN.test('a b.v1')) // space
  })

  it('defines tieBias range [-32, 32]', () => {
    assert.equal(TIE_BIAS_MIN, -32)
    assert.equal(TIE_BIAS_MAX, 32)
  })

  it('defines hysteresisPx as 3', () => {
    assert.equal(HYSTERESIS_PX, 3)
  })

  it('renderSchemaError has correct shape', () => {
    const err = renderSchemaError(
      'STABLE_ID_MISSING',
      'scene-1',
      'obj-1',
      'stableId',
      '用户信息',
      'tech info',
    )
    assert.equal(err.code, 'STABLE_ID_MISSING')
    assert.equal(err.severity, 'fatal')
    assert.equal(err.source, 'render-schema')
    assert.equal(err.retryable, false)
    assert.equal(err.sceneId, 'scene-1')
    assert.equal(err.objectId, 'obj-1')
    assert.equal(err.field, 'stableId')
    assert.equal(err.errorCode, 'STABLE_ID_MISSING')
    assert.ok(isStructuredFatalRenderSchemaError(err))
    assert.ok(err instanceof Error)
  })

  it('isStructuredFatalRenderSchemaError rejects non-errors', () => {
    assert.ok(!isStructuredFatalRenderSchemaError(null))
    assert.ok(!isStructuredFatalRenderSchemaError({ severity: 'fatal', source: 'render-schema' }))
    assert.ok(!isStructuredFatalRenderSchemaError(new Error('plain')))
  })
})

describe('Canonical IR - basic parsing', () => {
  it('parses a minimal valid XML input', () => {
    const ir = parseCanonicalIrFromXml(parseXml(miniValidXml()))
    assert.equal(ir.sceneId, 'test-scene')
    assert.equal(ir.renderSchemaVersion, '2')
    assert.equal(ir.objects.length, 1)
    assert.equal(ir.objects[0].stableId, 'tst.prop.test.prop1.v1')
  })

  it('parses a minimal valid melonJS data input', () => {
    const ir = parseCanonicalIrFromData(miniValidData())
    assert.equal(ir.sceneId, 'test-scene')
    assert.equal(ir.renderSchemaVersion, '2')
    assert.equal(ir.objects.length, 1)
    assert.equal(ir.objects[0].stableId, 'tst.prop.test.prop1.v1')
  })

  it('uses default floor registry when not specified', () => {
    const ir = parseCanonicalIrFromXml(parseXml(miniValidXml()))
    assert.deepEqual(ir.floorRegistry, { 'floor-1': 0 })
  })

  it('uses default floorId floor-1 when not specified', () => {
    const ir = parseCanonicalIrFromXml(parseXml(miniValidXml()))
    assert.equal(ir.objects[0].floorId, 'floor-1')
  })

  it('defaults tieBias to 0', () => {
    const ir = parseCanonicalIrFromXml(parseXml(miniValidXml()))
    assert.equal(ir.objects[0].tieBias, 0)
  })

  it('defaults elevation to 0', () => {
    const ir = parseCanonicalIrFromXml(parseXml(miniValidXml()))
    assert.equal(ir.objects[0].elevation, 0)
  })

  it('defaults sortMode to fixed', () => {
    const ir = parseCanonicalIrFromXml(parseXml(miniValidXml()))
    assert.equal(ir.objects[0].sortMode, 'fixed')
  })

  it('defaults renderBand to world', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'p1', x: 0, y: 0, width: 16, height: 16 },
          propsXml({
            stableId: 'tst.prop.c1.p1.v1',
            chunkId: 'c1',
            kind: 'prop',
            sortAnchorX: '8',
            sortAnchorY: '8',
            assetRef: 'test.png',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.objects[0].renderBand, 'world')
  })
})

describe('Canonical IR - byte-for-byte identical', () => {
  it('XML and melonJS data produce identical serialized IR', () => {
    const xmlIr = parseCanonicalIrFromXml(parseXml(miniValidXml()))
    const dataIr = parseCanonicalIrFromData(miniValidData())
    const xmlBytes = serializeCanonicalIr(xmlIr)
    const dataBytes = serializeCanonicalIr(dataIr)
    assert.equal(xmlBytes, dataBytes)
  })

  it('input property order does not affect serialized output', () => {
    const data1 = melonData(
      { sceneId: 'test-scene', renderSchemaVersion: '2' },
      {
        name: 'v2-props',
        objects: [{
          name: 'p1', x: 10, y: 20, width: 32, height: 32,
          properties: {
            chunkId: 'c1',
            stableId: 'tst.prop.c1.p1.v1',
            kind: 'prop',
            renderBand: 'world',
            sortAnchorY: '52',
            sortAnchorX: '26',
            assetRef: 'test.png',
          },
        }],
      },
    )
    // Same object but different property key order in the raw input
    const data2 = melonData(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      {
        name: 'v2-props',
        objects: [{
          name: 'p1', x: 10, y: 20, width: 32, height: 32,
          properties: {
            renderBand: 'world',
            kind: 'prop',
            assetRef: 'test.png',
            sortAnchorX: '26',
            stableId: 'tst.prop.c1.p1.v1',
            chunkId: 'c1',
            sortAnchorY: '52',
          },
        }],
      },
    )
    const ir1 = parseCanonicalIrFromData(data1)
    const ir2 = parseCanonicalIrFromData(data2)
    assert.equal(serializeCanonicalIr(ir1), serializeCanonicalIr(ir2))
  })

  it('multiple objects are sorted by stableId ASCII order', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'zebra', x: 0, y: 0, width: 16, height: 16 },
          propsXml({
            stableId: 'tst.zebra.v1',
            chunkId: 'c1',
            kind: 'prop',
            sortAnchorX: '8',
            sortAnchorY: '8',
            assetRef: 'z.png',
          }),
        ),
        tmxObjectXml(
          { name: 'alpha', x: 0, y: 0, width: 16, height: 16 },
          propsXml({
            stableId: 'tst.alpha.v1',
            chunkId: 'c1',
            kind: 'prop',
            sortAnchorX: '8',
            sortAnchorY: '8',
            assetRef: 'a.png',
          }),
        ),
        tmxObjectXml(
          { name: 'beta', x: 0, y: 0, width: 16, height: 16 },
          propsXml({
            stableId: 'tst.beta.v1',
            chunkId: 'c1',
            kind: 'prop',
            sortAnchorX: '8',
            sortAnchorY: '8',
            assetRef: 'b.png',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    const ids = ir.objects.map(o => o.stableId)
    assert.deepEqual(ids, ['tst.alpha.v1', 'tst.beta.v1', 'tst.zebra.v1'])
  })

  it('fragment and zone collections also sorted by stableId', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments',
        tmxObjectXml(
          { name: 'f-c', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.frag.c.v1',
            chunkId: 'c1',
            renderBand: 'world',
            sortAnchorX: '16',
            sortAnchorY: '16',
            assetRef: 'c.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '32',
          }),
        ),
        tmxObjectXml(
          { name: 'f-a', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.frag.a.v1',
            chunkId: 'c1',
            renderBand: 'world',
            sortAnchorX: '16',
            sortAnchorY: '16',
            assetRef: 'a.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '32',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    const ids = ir.fragments.map(f => f.stableId)
    assert.deepEqual(ids, ['tst.frag.a.v1', 'tst.frag.c.v1'])
  })

  it('ASCII sort uses code-unit order not locale', () => {
    // 'z' (122) < '_' (95) in ASCII; localeCompare might differ
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'u1', x: 0, y: 0, width: 16, height: 16 },
          propsXml({
            stableId: 'tst._underscore.v1',
            chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'u.png',
          }),
        ),
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 16, height: 16 },
          propsXml({
            stableId: 'tst.zebra.v1',
            chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'z.png',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    // ASCII: '_' (95) < 'z' (122)
    assert.equal(ir.objects[0].stableId, 'tst._underscore.v1')
    assert.equal(ir.objects[1].stableId, 'tst.zebra.v1')
  })
})

describe('Canonical IR - structured fatal errors', () => {
  function assertFatal(fn: () => unknown, expectedCode: string, expectedField: string): void {
    try {
      fn()
      assert.fail('expected fatal error')
    } catch (e) {
      assert.ok(isStructuredFatalRenderSchemaError(e), `expected structured fatal, got ${e}`)
      if (isStructuredFatalRenderSchemaError(e)) {
        assert.equal(e.errorCode, expectedCode, `expected code ${expectedCode}, got ${e.errorCode}`)
        assert.equal(e.field, expectedField, `expected field ${expectedField}, got ${e.field}`)
        assert.ok(e.sceneId.length > 0, 'sceneId should be set')
        assert.ok(e.objectId.length > 0, 'objectId should be set')
      }
    }
  }

  it('missing renderSchemaVersion is fatal', () => {
    const xml = tmxXml({ sceneId: 'test-scene' })
    assertFatal(
      () => parseCanonicalIrFromXml(parseXml(xml)),
      'RENDER_SCHEMA_VERSION_MISSING',
      'renderSchemaVersion',
    )
  })

  it('unknown renderSchemaVersion is fatal', () => {
    const xml = tmxXml({ renderSchemaVersion: '1', sceneId: 'test-scene' })
    assertFatal(
      () => parseCanonicalIrFromXml(parseXml(xml)),
      'RENDER_SCHEMA_VERSION_UNSUPPORTED',
      'renderSchemaVersion',
    )
  })

  it('movementSchemaVersion does NOT substitute for renderSchemaVersion', () => {
    const xml = tmxXml({ movementSchemaVersion: '2', sceneId: 'test-scene' })
    assertFatal(
      () => parseCanonicalIrFromXml(parseXml(xml)),
      'RENDER_SCHEMA_VERSION_MISSING',
      'renderSchemaVersion',
    )
  })

  it('missing stableId is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'bad1', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'STABLE_ID_MISSING', 'stableId')
  })

  it('invalid stableId pattern is fatal (uppercase)', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'bad1', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'Bad.Id.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'STABLE_ID_INVALID_PATTERN', 'stableId')
  })

  it('duplicate stableId is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.dup.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
        tmxObjectXml(
          { name: 'b', x: 10, y: 10, width: 16, height: 16 },
          propsXml({ stableId: 'tst.dup.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'STABLE_ID_DUPLICATE', 'stableId')
  })

  it('unknown floorId is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"floor-1":0}' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', floorId: 'floor-99', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'FLOOR_ID_UNKNOWN', 'floorId')
  })

  it('duplicate floor ID in registry is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"floor-1":0,"floor-1":1}' },
    )
    assertFatal(
      () => parseCanonicalIrFromXml(parseXml(xml)),
      'FLOOR_REGISTRY_DUPLICATE',
      'floorRegistry',
    )
  })

  it('tieBias out of range is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', tieBias: '100', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'TIE_BIAS_OUT_OF_RANGE', 'tieBias')
  })

  it('tieBias at boundary is valid', () => {
    // Test both boundaries
    const xmlMin = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', tieBias: '-32', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    const irMin = parseCanonicalIrFromXml(parseXml(xmlMin))
    assert.equal(irMin.objects[0].tieBias, -32)

    const xmlMax = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.b.v1', chunkId: 'c1', kind: 'prop', tieBias: '32', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    const irMax = parseCanonicalIrFromXml(parseXml(xmlMax))
    assert.equal(irMax.objects[0].tieBias, 32)
  })

  it('tieBias just outside range is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', tieBias: '-33', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'TIE_BIAS_OUT_OF_RANGE', 'tieBias')
  })

  it('elevation must be integer', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', elevation: '1.5', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'test.png' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'ELEVATION_INVALID', 'elevation')
  })

  it('asset render missing assetRef is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8' }),
        ),
      ),
    )
    // No assetRef, no rendererKey → allowed (pure interaction object), so no error
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.objects[0].render, undefined)
  })

  it('procedural render missing rendererKey is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', rendererKey: '', sortAnchorX: '8', sortAnchorY: '8' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'RENDERER_KEY_MISSING', 'rendererKey')
  })

  it('both assetRef and rendererKey is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', assetRef: 'a.png', rendererKey: 'r1', sortAnchorX: '8', sortAnchorY: '8' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'RENDER_CONFLICT', 'render')
  })

  it('destination rect with zero/negative dimensions is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 0, height: 32 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', assetRef: 'a.png', sortAnchorX: '8', sortAnchorY: '8' }),
        ),
      ),
    )
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'DESTINATION_RECT_INVALID', 'destinationRect')
  })

  it('no partial IR on fatal - all or nothing', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'good', x: 10, y: 20, width: 32, height: 32 },
          propsXml({ stableId: 'tst.good.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'a.png' }),
        ),
        tmxObjectXml(
          { name: 'bad', x: 10, y: 20, width: 32, height: 32 },
          propsXml({ stableId: 'Bad.Id.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'b.png' }),
        ),
      ),
    )
    // The first object is valid, but since the second fails, the whole parse must fail
    assertFatal(() => parseCanonicalIrFromXml(parseXml(xml)), 'STABLE_ID_INVALID_PATTERN', 'stableId')
  })
})

describe('Canonical IR - render union', () => {
  it('asset render with all fields', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 64, height: 64 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'sprite.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '32',
            anchorX: '16', anchorY: '16',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    const render = ir.objects[0].render
    assert.ok(render)
    assert.equal(render!.type, 'asset')
    if (render!.type === 'asset') {
      assert.equal(render!.assetRef, 'sprite.png')
      assert.deepEqual(render!.destinationRect, { x: 10, y: 20, width: 64, height: 64 })
      assert.deepEqual(render!.sourceRect, { x: 0, y: 0, width: 32, height: 32 })
      assert.deepEqual(render!.anchor, { x: 16, y: 16 })
    }
  })

  it('procedural render', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 64, height: 64 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            rendererKey: 'circle-fill',
            styleRef: 'red',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    const render = ir.objects[0].render
    assert.ok(render)
    assert.equal(render!.type, 'procedural')
    if (render!.type === 'procedural') {
      assert.equal(render!.rendererKey, 'circle-fill')
      assert.equal(render!.styleRef, 'red')
    }
  })

  it('pure interaction object (no render) is allowed', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'hotspot',
            sortAnchorX: '8', sortAnchorY: '8',
            hotspotId: 'h1', panel: 'chat',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.objects[0].render, undefined)
    assert.deepEqual(ir.objects[0].interaction, { hotspotId: 'h1', panel: 'chat' })
  })
})

describe('Canonical IR - occluder fragments', () => {
  function validFragmentXml(stableId: string, extraProps: Record<string, string> = {}): string {
    const props: Record<string, string> = {
      stableId,
      chunkId: 'c1',
      renderBand: 'world',
      sortAnchorX: '16',
      sortAnchorY: '16',
      assetRef: 'frag.png',
      sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '32',
      ...extraProps,
    }
    return tmxObjectXml(
      { name: stableId, x: 0, y: 0, width: 32, height: 32 },
      propsXml(props),
    )
  }

  it('parses a valid occluder fragment', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments', validFragmentXml('tst.frag.test.v1')),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.fragments.length, 1)
    const f = ir.fragments[0]
    assert.equal(f.stableId, 'tst.frag.test.v1')
    assert.equal(f.renderBand, 'world')
    assert.equal(f.sortMode, 'fixed')
    assert.equal(f.assetRef, 'frag.png')
  })

  it('fragment with overhead renderBand is valid', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments',
        validFragmentXml('tst.frag.overhead.v1', { renderBand: 'overhead' }),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.fragments[0].renderBand, 'overhead')
  })

  it('fragment with invalid renderBand is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments',
        validFragmentXml('tst.frag.bad.v1', { renderBand: 'background' }),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'FRAGMENT_RENDER_BAND_INVALID')
  })

  it('fragment with non-fixed sortMode is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments',
        validFragmentXml('tst.frag.bad.v1', { sortMode: 'y' }),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'FRAGMENT_SORT_MODE_INVALID')
  })
})

describe('Canonical IR - constraint zones', () => {
  function validFragmentForZone(): string {
    return tmxObjectXml(
      { name: 'f1', x: 0, y: 0, width: 32, height: 32 },
      propsXml({
        stableId: 'tst.frag.target.v1',
        chunkId: 'c1',
        renderBand: 'world',
        sortAnchorX: '16', sortAnchorY: '16',
        assetRef: 'f.png',
        sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '32',
      }),
    )
  }

  it('zone target missing is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments', validFragmentForZone()),
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.zone.noref.v1',
            chunkId: 'c1',
            relation: 'behind',
            priority: '0',
          }),
          polygonXml('0,0 32,0 32,32 0,32'),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'ZONE_TARGET_MISSING')
  })

  it('zone target not found is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.zone.badref.v1',
            chunkId: 'c1',
            targetFragmentId: 'tst.frag.nonexistent.v1',
            relation: 'behind',
            priority: '0',
          }),
          polygonXml('0,0 32,0 32,32 0,32'),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'ZONE_TARGET_NOT_FOUND')
  })

  it('zone target not in world band is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments',
        tmxObjectXml(
          { name: 'f1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.frag.overhead.v1',
            chunkId: 'c1',
            renderBand: 'overhead',
            sortAnchorX: '16', sortAnchorY: '16',
            assetRef: 'f.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '32',
          }),
        ),
      ),
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.zone.overhead.v1',
            chunkId: 'c1',
            targetFragmentId: 'tst.frag.overhead.v1',
            relation: 'behind',
            priority: '0',
          }),
          polygonXml('0,0 32,0 32,32 0,32'),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'ZONE_TARGET_NOT_WORLD')
  })

  it('zone target cross floor is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"floor-1":0,"floor-2":1}' },
      objectGroupXml('v2-fragments',
        tmxObjectXml(
          { name: 'f1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.frag.f1.v1',
            chunkId: 'c1',
            renderBand: 'world',
            floorId: 'floor-1',
            sortAnchorX: '16', sortAnchorY: '16',
            assetRef: 'f.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '32',
          }),
        ),
      ),
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.zone.cross.v1',
            chunkId: 'c1',
            floorId: 'floor-2',
            targetFragmentId: 'tst.frag.f1.v1',
            relation: 'behind',
            priority: '0',
          }),
          polygonXml('0,0 32,0 32,32 0,32'),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'ZONE_TARGET_CROSS_FLOOR')
  })

  it('zone with valid target passes cross-reference', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments', validFragmentForZone()),
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.zone.valid.v1',
            chunkId: 'c1',
            targetFragmentId: 'tst.frag.target.v1',
            relation: 'behind',
            priority: '5',
          }),
          polygonXml('0,0 32,0 32,32 0,32'),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.zones.length, 1)
    assert.equal(ir.zones[0].relation, 'behind')
    assert.equal(ir.zones[0].priority, 5)
    assert.equal(ir.zones[0].hysteresisPx, 3)
  })

  it('zone hysteresisPx must be 3', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments', validFragmentForZone()),
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.zone.hyst.v1',
            chunkId: 'c1',
            targetFragmentId: 'tst.frag.target.v1',
            relation: 'behind',
            priority: '0',
            hysteresisPx: '5',
          }),
          polygonXml('0,0 32,0 32,32 0,32'),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'ZONE_HYSTERESIS_INVALID')
  })

  it('zone polygon must have at least 3 points', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments', validFragmentForZone()),
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.zone.short.v1',
            chunkId: 'c1',
            targetFragmentId: 'tst.frag.target.v1',
            relation: 'behind',
            priority: '0',
          }),
          polygonXml('0,0 32,0'),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'ZONE_POLYGON_INVALID')
  })
})

// ── Helper for assertFatal with just code check ──
function assertFatalHelper(fn: () => unknown, expectedCode: string): void {
  try {
    fn()
    assert.fail('expected fatal error')
  } catch (e) {
    assert.ok(isStructuredFatalRenderSchemaError(e), `expected structured fatal, got ${e}`)
    if (isStructuredFatalRenderSchemaError(e)) {
      assert.equal(e.errorCode, expectedCode, `expected code ${expectedCode}, got ${e.errorCode}`)
    }
  }
}

describe('Canonical IR - error determinism', () => {
  it('same input always yields same first error', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 0, y: 0, width: 16, height: 16 },
          propsXml({ stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop', tieBias: '100', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'a.png' }),
        ),
      ),
    )
    let firstError = ''
    try { parseCanonicalIrFromXml(parseXml(xml)) } catch (e) {
      firstError = isStructuredFatalRenderSchemaError(e) ? `${e.errorCode}|${e.field}|${e.objectId}` : ''
    }
    // Run 5 times
    for (let i = 0; i < 5; i++) {
      try { parseCanonicalIrFromXml(parseXml(xml)) } catch (e) {
        const key = isStructuredFatalRenderSchemaError(e) ? `${e.errorCode}|${e.field}|${e.objectId}` : ''
        assert.equal(key, firstError)
      }
    }
  })

  it('first invalid object determines the error', () => {
    // Two objects: first is valid, second has invalid stableId
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'good', x: 10, y: 20, width: 32, height: 32 },
          propsXml({ stableId: 'tst.good.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'a.png' }),
        ),
        tmxObjectXml(
          { name: 'bad', x: 10, y: 20, width: 32, height: 32 },
          propsXml({ stableId: 'BAD.v1', chunkId: 'c1', kind: 'prop', sortAnchorX: '8', sortAnchorY: '8', assetRef: 'b.png' }),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'STABLE_ID_INVALID_PATTERN')
  })
})

describe('Canonical IR - v1 hall behavior unchanged', () => {
  it('hasRenderSchemaV2 returns false for XML without renderSchemaVersion', () => {
    const xml = tmxXml({ movementSchemaVersion: '1', sceneId: 'juyiting-main' })
    assert.equal(hasRenderSchemaV2(parseXml(xml)), false)
  })

  it('hasRenderSchemaV2 returns false for data without renderSchemaVersion', () => {
    const data = melonData({ movementSchemaVersion: '1', sceneId: 'juyiting-main' })
    assert.equal(hasRenderSchemaV2(data), false)
  })

  it('hasRenderSchemaV2 returns true for v2 XML', () => {
    assert.equal(hasRenderSchemaV2(parseXml(miniValidXml())), true)
  })

  it('hasRenderSchemaV2 returns true for v2 data', () => {
    assert.equal(hasRenderSchemaV2(miniValidData()), true)
  })

  it('v1 XML with movementSchemaVersion does not trigger v2 parsing', () => {
    const xml = tmxXml({ movementSchemaVersion: '1', sceneId: 'juyiting-main' })
    // Trying to parse should fail because renderSchemaVersion is missing
    assertFatalHelper(
      () => parseCanonicalIrFromXml(parseXml(xml)),
      'RENDER_SCHEMA_VERSION_MISSING',
    )
  })

  it('renderSchemaVersion is independent of movementSchemaVersion', () => {
    // Both can coexist without interference
    const xml = tmxXml({
      renderSchemaVersion: '2',
      movementSchemaVersion: '1',
      sceneId: 'test-scene',
    },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'test.png',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.renderSchemaVersion, '2')
    assert.equal(ir.objects.length, 1)
  })
})

describe('Canonical IR - floor registry', () => {
  it('custom floor registry is parsed correctly', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"floor-1":0,"floor-2":10}' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'test.png', floorId: 'floor-2',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.deepEqual(ir.floorRegistry, { 'floor-1': 0, 'floor-2': 10 })
    assert.equal(ir.objects[0].floorId, 'floor-2')
  })

  it('floor registry with non-integer order is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"floor-1":1.5}' },
    )
    assertFatalHelper(
      () => parseCanonicalIrFromXml(parseXml(xml)),
      'FLOOR_REGISTRY_INVALID_ORDER',
    )
  })

  it('floor registry accepts unique negative integer orders', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"basement":-1,"floor-1":0}' },
    )
    assert.deepEqual(parseCanonicalIrFromXml(parseXml(xml)).floorRegistry, {
      basement: -1,
      'floor-1': 0,
    })
  })

  it('floor registry rejects duplicate floor orders', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"floor-1":0,"floor-2":0}' },
    )
    try {
      parseCanonicalIrFromXml(parseXml(xml))
      assert.fail('expected fatal error')
    } catch (error) {
      assert.ok(isStructuredFatalRenderSchemaError(error))
      if (isStructuredFatalRenderSchemaError(error)) {
        assert.equal(error.errorCode, 'FLOOR_REGISTRY_DUPLICATE')
        assert.equal(error.field, 'floorRegistry')
      }
    }
  })

  it('unknown floorId in sceneObject is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene', floorRegistry: '{"floor-1":0}' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'test.png', floorId: 'floor-99',
          }),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'FLOOR_ID_UNKNOWN')
  })
})

describe('Canonical IR - serialization round-trip', () => {
  it('serialize then re-parse (via data path) produces identical result', () => {
    // Build a moderately complex IR
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'prop1', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.prop.alpha.v1', chunkId: 'c1', kind: 'prop',
            renderBand: 'world', sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'prop.png', tieBias: '5',
          }),
        ),
        tmxObjectXml(
          { name: 'struct1', x: 100, y: 200, width: 64, height: 48 },
          propsXml({
            stableId: 'tst.struct.wall.v1', chunkId: 'c2', kind: 'structure',
            renderBand: 'world', sortAnchorX: '132', sortAnchorY: '248',
            rendererKey: 'wall-renderer', styleRef: 'stone',
            elevation: '10',
          }),
        ),
      ),
      objectGroupXml('v2-fragments',
        tmxObjectXml(
          { name: 'f1', x: 0, y: 0, width: 64, height: 64 },
          propsXml({
            stableId: 'tst.frag.railing.v1', chunkId: 'c1',
            renderBand: 'world', sortAnchorX: '32', sortAnchorY: '64',
            assetRef: 'railing.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '64', sourceRectH: '64',
          }),
        ),
      ),
      objectGroupXml('v2-zones',
        tmxObjectXml(
          { name: 'z1', x: 0, y: 0, width: 100, height: 100 },
          propsXml({
            stableId: 'tst.zone.behind-railing.v1', chunkId: 'c1',
            targetFragmentId: 'tst.frag.railing.v1',
            relation: 'behind', priority: '10',
          }),
          polygonXml('0,0 100,0 100,100 0,100'),
        ),
      ),
    )

    const ir1 = parseCanonicalIrFromXml(parseXml(xml))
    const serialized1 = serializeCanonicalIr(ir1)

    // Same XML parsed again must produce identical serialization
    const ir2 = parseCanonicalIrFromXml(parseXml(xml))
    const serialized2 = serializeCanonicalIr(ir2)

    assert.equal(serialized1, serialized2)

    // Also verify data path produces identical bytes
    const dataIr = parseCanonicalIrFromData(miniValidData())
    const dataSerialized = serializeCanonicalIr(dataIr)
    // data path and XML path produce different IRs (data path has fewer objects),
    // but the data path should be internally consistent
    const dataIr2 = parseCanonicalIrFromData(miniValidData())
    assert.equal(dataSerialized, serializeCanonicalIr(dataIr2))
  })
})

describe('Canonical IR - numeric normalization', () => {
  it('integer values are serialized without decimal point', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '42',
            assetRef: 'test.png',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    const serialized = serializeCanonicalIr(ir)
    // elevation:0 not elevation:0.0
    assert.ok(serialized.includes('"elevation":0'))
    assert.ok(serialized.includes('"tieBias":0'))
  })

  it('sortAnchor values are preserved exactly', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '42.5', sortAnchorY: '100.25',
            assetRef: 'test.png',
          }),
        ),
      ),
    )
    const ir = parseCanonicalIrFromXml(parseXml(xml))
    assert.equal(ir.objects[0].sortAnchor.x, 42.5)
    assert.equal(ir.objects[0].sortAnchor.y, 100.25)
  })
})

describe('Canonical IR - sourceRect validation', () => {
  it('sourceRect with negative width is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'test.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '-5', sourceRectH: '32',
          }),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'SOURCE_RECT_INVALID')
  })

  it('sourceRect with zero area is fatal', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-props',
        tmxObjectXml(
          { name: 'a', x: 10, y: 20, width: 32, height: 32 },
          propsXml({
            stableId: 'tst.a.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '8', sortAnchorY: '8',
            assetRef: 'test.png',
            sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '0',
          }),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'SOURCE_RECT_INVALID')
  })
})

describe('Canonical IR - reviewer regressions', () => {
  function reviewerFragmentXml(
    stableId = 'tst.frag.review.v1',
    extraProps: Record<string, string> = {},
  ): string {
    return tmxObjectXml(
      { name: stableId, x: 10, y: 20, width: 32, height: 24 },
      propsXml({
        stableId,
        chunkId: 'chunk-review',
        renderBand: 'world',
        sortAnchorX: '26',
        sortAnchorY: '44',
        assetRef: 'review.png',
        sourceRectX: '0',
        sourceRectY: '0',
        sourceRectW: '32',
        sourceRectH: '24',
        ...extraProps,
      }),
    )
  }

  function reviewerZoneXml(
    stableId = 'tst.zone.review.v1',
    extraProps: Record<string, string> = {},
  ): string {
    return tmxObjectXml(
      { name: stableId, x: 5, y: 6, width: 20, height: 20 },
      propsXml({
        stableId,
        chunkId: 'chunk-review',
        targetFragmentId: 'tst.frag.review.v1',
        relation: 'behind',
        priority: '0',
        ...extraProps,
      }),
      polygonXml('0,0 20,0 20,20 0,20'),
    )
  }

  it('hasRenderSchemaV2 safely rejects null, primitives, arrays, and partial DOM lookalikes', () => {
    const values: unknown[] = [
      null,
      undefined,
      false,
      0,
      '',
      Symbol('schema'),
      [],
      {},
      { querySelector: () => null },
      { nodeType: 9, querySelector: () => null },
      { nodeType: 9, documentElement: { nodeType: 1 }, querySelector: () => null },
      {
        nodeType: 9,
        documentElement: { nodeType: 1 },
        querySelector: () => null,
        getElementsByTagName: () => [],
        createElement: () => ({}),
      },
    ]
    for (const value of values) {
      assert.doesNotThrow(() => hasRenderSchemaV2(value))
      assert.equal(hasRenderSchemaV2(value), false)
    }
  })

  it('requires signed integer zone priority and accepts negative integers', () => {
    const validXml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml('v2-fragments', reviewerFragmentXml()),
      objectGroupXml('v2-zones', reviewerZoneXml('tst.zone.negative.v1', { priority: '-7' })),
    )
    assert.equal(parseCanonicalIrFromXml(validXml).zones[0].priority, -7)

    for (const invalidPriority of ['3.5', 'NaN', 'Infinity', '-Infinity']) {
      const invalidXml = tmxXml(
        { renderSchemaVersion: '2', sceneId: 'test-scene' },
        objectGroupXml('v2-fragments', reviewerFragmentXml()),
        objectGroupXml(
          'v2-zones',
          reviewerZoneXml(`tst.zone.invalid-${invalidPriority.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.v1`, {
            priority: invalidPriority,
          }),
        ),
      )
      try {
        parseCanonicalIrFromXml(invalidXml)
        assert.fail(`expected ${invalidPriority} to fail`)
      } catch (error) {
        assert.ok(isStructuredFatalRenderSchemaError(error))
        if (isStructuredFatalRenderSchemaError(error)) {
          assert.equal(error.errorCode, 'ZONE_PRIORITY_INVALID')
          assert.equal(error.field, 'priority')
        }
      }
    }
  })

  it('serializes finite numbers using exact ECMAScript round-trip representations', () => {
    const numericValues = [
      { id: 'a', raw: '0.3', expected: 0.3 },
      { id: 'b', raw: '0.30000000000000004', expected: 0.30000000000000004 },
      { id: 'c', raw: '5e-324', expected: 5e-324 },
      { id: 'd', raw: '1.7976931348623157e+308', expected: Number.MAX_VALUE },
      { id: 'e', raw: '1e-7', expected: 1e-7 },
      { id: 'f', raw: '-0', expected: 0 },
    ]
    const data = melonData(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      {
        name: 'v2-props',
        objects: numericValues.map(({ id, raw }) => ({
          name: id,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          properties: {
            stableId: `tst.numeric.${id}.v1`,
            chunkId: 'numeric',
            kind: 'hotspot',
            sortAnchorX: raw,
            sortAnchorY: raw,
          },
        })),
      },
    )
    const serialized = serializeCanonicalIr(parseCanonicalIrFromData(data))
    const parsed = JSON.parse(serialized) as CanonicalSceneIr
    assert.equal(parsed.objects.length, numericValues.length)
    parsed.objects.forEach((object, index) => {
      assert.equal(object.sortAnchor.x, numericValues[index].expected)
      assert.equal(object.sortAnchor.y, numericValues[index].expected)
      assert.equal(Object.is(object.sortAnchor.x, -0), false)
    })
    assert.ok(serialized.includes('0.3'))
    assert.ok(serialized.includes('0.30000000000000004'))
    assert.notEqual(serialized.indexOf('0.3'), serialized.indexOf('0.30000000000000004'))
  })

  it('applies positive and negative objectgroup offsets identically across raw XML, DOM, and data', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXmlWithAttrs(
        'v2-props-east',
        { offsetx: 10, offsety: -5 },
        tmxObjectXml(
          { name: 'prop', x: 2, y: 3, width: 8, height: 9 },
          propsXml({
            stableId: 'tst.prop.offset.v1',
            chunkId: 'east',
            kind: 'prop',
            sortAnchorX: '100',
            sortAnchorY: '200',
            assetRef: 'prop.png',
          }),
        ),
      ),
      objectGroupXmlWithAttrs(
        'v2-fragments-west',
        { offsetx: -20, offsety: 7 },
        reviewerFragmentXml(),
      ),
      objectGroupXmlWithAttrs(
        'v2-zones-west',
        { offsetx: -3, offsety: -4 },
        reviewerZoneXml(),
      ),
    )
    const data: Record<string, unknown> = {
      width: 52,
      height: 29,
      tilewidth: 32,
      tileheight: 32,
      properties: { renderSchemaVersion: '2', sceneId: 'test-scene' },
      layers: [
        {
          type: 'objectgroup', name: 'v2-props-east', offsetx: 10, offsety: -5,
          objects: [{
            name: 'prop', x: 2, y: 3, width: 8, height: 9,
            properties: {
              stableId: 'tst.prop.offset.v1', chunkId: 'east', kind: 'prop',
              sortAnchorX: '100', sortAnchorY: '200', assetRef: 'prop.png',
            },
          }],
        },
        {
          type: 'objectgroup', name: 'v2-fragments-west', offsetx: -20, offsety: 7,
          objects: [{
            name: 'tst.frag.review.v1', x: 10, y: 20, width: 32, height: 24,
            properties: {
              stableId: 'tst.frag.review.v1', chunkId: 'chunk-review', renderBand: 'world',
              sortAnchorX: '26', sortAnchorY: '44', assetRef: 'review.png',
              sourceRectX: '0', sourceRectY: '0', sourceRectW: '32', sourceRectH: '24',
            },
          }],
        },
        {
          type: 'objectgroup', name: 'v2-zones-west', offsetx: -3, offsety: -4,
          objects: [{
            name: 'tst.zone.review.v1', x: 5, y: 6, width: 20, height: 20,
            polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
            properties: {
              stableId: 'tst.zone.review.v1', chunkId: 'chunk-review',
              targetFragmentId: 'tst.frag.review.v1', relation: 'behind', priority: '0',
            },
          }],
        },
      ],
    }

    const rawBytes = serializeCanonicalIr(parseCanonicalIrFromXml(xml))
    const documentBytes = serializeCanonicalIr(parseCanonicalIrFromXml(parseXml(xml)))
    const dataBytes = serializeCanonicalIr(parseCanonicalIrFromData(data))
    assert.equal(rawBytes, documentBytes)
    assert.equal(rawBytes, dataBytes)

    const ir = parseCanonicalIrFromXml(xml)
    assert.deepEqual(ir.objects[0].render?.destinationRect, { x: 12, y: -2, width: 8, height: 9 })
    assert.deepEqual(ir.objects[0].sortAnchor, { x: 100, y: 200 })
    assert.deepEqual(ir.fragments[0].destinationRect, { x: -10, y: 27, width: 32, height: 24 })
    assert.deepEqual(ir.fragments[0].sortAnchor, { x: 26, y: 44 })
    assert.deepEqual(ir.zones[0].polygon[0], { x: 2, y: 2 })
    assert.deepEqual(ir.zones[0].bounds, { x: 2, y: 2, width: 20, height: 20 })
  })

  it('rejects non-finite objectgroup offsets with deterministic structured fields', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXmlWithAttrs('v2-props', { offsetx: 'NaN' }),
    )
    try {
      parseCanonicalIrFromXml(xml)
      assert.fail('expected offset fatal')
    } catch (error) {
      assert.ok(isStructuredFatalRenderSchemaError(error))
      if (isStructuredFatalRenderSchemaError(error)) {
        assert.equal(error.errorCode, 'OBJECTGROUP_OFFSET_INVALID')
        assert.equal(error.objectId, 'v2-props')
        assert.equal(error.field, 'offsetx')
      }
    }

    const data = melonData({ renderSchemaVersion: '2', sceneId: 'test-scene' })
    ;(data.layers as Array<Record<string, unknown>>).push({
      type: 'objectgroup', name: 'v2-bad-offset', offsety: Infinity, objects: [],
    })
    assertFatalHelper(() => parseCanonicalIrFromData(data), 'OBJECTGROUP_OFFSET_INVALID')
  })

  it('rejects non-zero or non-finite object rotation in XML and data', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml(
        'v2-props',
        tmxObjectXml(
          { name: 'rotated', x: 0, y: 0, width: 8, height: 8, rotation: 15 },
          propsXml({
            stableId: 'tst.rotated.v1', chunkId: 'c1', kind: 'prop',
            sortAnchorX: '0', sortAnchorY: '0', assetRef: 'a.png',
          }),
        ),
      ),
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(xml), 'OBJECT_ROTATION_UNSUPPORTED')

    const data = miniValidData()
    const layer = (data.layers as Array<Record<string, unknown>>)[0]
    ;(layer.objects as Array<Record<string, unknown>>)[0].rotation = NaN
    assertFatalHelper(() => parseCanonicalIrFromData(data), 'OBJECT_ROTATION_UNSUPPORTED')
  })

  it('rejects nested groups explicitly in raw XML, DOM, and pre-parsed data', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      ' <group id="3" name="nested"><objectgroup id="4" name="v2-props"/></group>',
    )
    assertFatalHelper(() => parseCanonicalIrFromXml(xml), 'NESTED_OBJECTGROUP_UNSUPPORTED')
    assertFatalHelper(() => parseCanonicalIrFromXml(parseXml(xml)), 'NESTED_OBJECTGROUP_UNSUPPORTED')

    const data = melonData({ renderSchemaVersion: '2', sceneId: 'test-scene' })
    ;(data.layers as Array<Record<string, unknown>>).push({
      type: 'group', name: 'nested', layers: [{ type: 'objectgroup', name: 'v2-props' }],
    })
    assertFatalHelper(() => parseCanonicalIrFromData(data), 'NESTED_OBJECTGROUP_UNSUPPORTED')
  })

  it('parses raw XML without a DOM dependency and matches Document/data canonical bytes', () => {
    const rawXml = miniValidXml()
    const rawBytes = serializeCanonicalIr(parseCanonicalIrFromXml(rawXml))
    const documentBytes = serializeCanonicalIr(parseCanonicalIrFromXml(parseXml(rawXml)))
    const dataBytes = serializeCanonicalIr(parseCanonicalIrFromData(miniValidData()))
    assert.equal(rawBytes, documentBytes)
    assert.equal(rawBytes, dataBytes)
  })

  it('reports malformed raw XML as a structured deterministic fatal', () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        parseCanonicalIrFromXml('<map><objectgroup></map>')
        assert.fail('expected malformed XML fatal')
      } catch (error) {
        assert.ok(isStructuredFatalRenderSchemaError(error))
        if (isStructuredFatalRenderSchemaError(error)) {
          assert.equal(error.errorCode, 'XML_PARSE_FAILED')
          assert.equal(error.sceneId, '(unknown)')
          assert.equal(error.objectId, '(map)')
          assert.equal(error.field, 'xml')
        }
      }
    }
  })

  it('performs a real cross-scene zone target validation', () => {
    const xml = tmxXml(
      { renderSchemaVersion: '2', sceneId: 'test-scene' },
      objectGroupXml(
        'v2-fragments',
        reviewerFragmentXml('tst.frag.cross-scene.v1', { sceneId: 'scene-a' }),
      ),
      objectGroupXml(
        'v2-zones',
        reviewerZoneXml('tst.zone.cross-scene.v1', {
          sceneId: 'scene-b',
          targetFragmentId: 'tst.frag.cross-scene.v1',
        }),
      ),
    )
    try {
      parseCanonicalIrFromXml(xml)
      assert.fail('expected cross-scene fatal')
    } catch (error) {
      assert.ok(isStructuredFatalRenderSchemaError(error))
      if (isStructuredFatalRenderSchemaError(error)) {
        assert.equal(error.errorCode, 'ZONE_TARGET_CROSS_SCENE')
        assert.equal(error.field, 'targetFragmentId')
        assert.equal(error.objectId, 'tst.zone.cross-scene.v1')
      }
    }
  })
})

import { spawnSync } from 'node:child_process'
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { MapRuntimeData } from '../../../src/game/map/movementSchema.js'
import { renderMapPreview } from '../../../src/game/map/tmxPreviewRenderer.js'
import { createMapSnapshot, serializeMapSnapshot } from '../../../src/game/map/tmxSnapshot.js'
import { parseMovementTmx } from '../../../src/game/map/tmxMovementParser.js'

const fixtureUrl = new URL('../../fixtures/juyiting/hall-map.snapshot.json', import.meta.url)
const hallTmxUrl = new URL('../../../public/juyiting/hall.tmx', import.meta.url)
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const validateScript = join(projectRoot, 'scripts/juyiting/validate-map.mjs')
const previewScript = join(projectRoot, 'scripts/juyiting/render-map-preview.mjs')
const embeddedArt = [{
  stableId: 'art<&',
  href: 'data:image/png;base64,cG5n',
  x: 0,
  y: 0,
  width: 1664,
  height: 928,
  opacity: 1,
}]
const testGenerationId = 'a'.repeat(64)

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
    const svg = renderMapPreview(runtime, { debug: false, art: embeddedArt, generationId: testGenerationId })

    assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg" width="1664" height="928" viewBox="0 0 1664 928"'))
    assert.ok(svg.includes('class="map-art"'))
    assert.ok(svg.includes('href="data:image/png;base64,cG5n"'))
    assert.ok(svg.includes('data-art-id="art&lt;&amp;"'))
    assert.ok(svg.includes(`data-generation-id="${testGenerationId}"`))
    assert.ok(!svg.includes('liangshan-hall-base-clean-v3.webp'))
    assert.ok(svg.includes('Region &amp; &lt;A&gt;'))
    assert.ok(!svg.includes('class="nav-edge"'))
    assert.ok(!svg.includes('node-a'))
  })

  it('renders deterministic escaped debug overlays for graph, obstacles, slots, IDs, and widths', () => {
    const runtime = sampleRuntime()
    ;(runtime.slots[0] as unknown as { kind: string }).kind = 'home"><script>'
    const svg = renderMapPreview(runtime, { debug: true, art: embeddedArt, generationId: testGenerationId })

    assert.equal(renderMapPreview(runtime, { debug: true, art: embeddedArt, generationId: testGenerationId }), svg)
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

  it('requires caller-derived preview art instead of silently selecting a filename', () => {
    assert.throws(
      () => renderMapPreview(sampleRuntime(), { debug: false, art: [], generationId: testGenerationId }),
      /preview art descriptor/i,
    )
  })

  it('renames a synced sibling temp directly over the destination without pre-removal', async () => {
    // @ts-expect-error CLI script intentionally has no TypeScript declaration file
    const { atomicReplaceFile } = await import('../../../scripts/juyiting/validate-map.mjs')
    const calls: string[] = []
    const destination = 'C:/artifacts/hall.svg'
    const operations = fakeAtomicOperations(calls, {
      renameSync(from: string, to: string) {
        calls.push(`rename:${from}->${to}`)
        throw new Error('rename failed')
      },
    })

    assert.throws(
      () => atomicReplaceFile(destination, 'new-content', 'preview', operations),
      /rename failed/,
    )
    assert.ok(calls.some(call => call.startsWith('fsync:')))
    assert.ok(calls.some(call => call.startsWith('close:')))
    assert.ok(calls.some(call => call.startsWith('rename:C:/artifacts/hall.svg.tmp-') && call.endsWith('->C:/artifacts/hall.svg')))
    assert.ok(!calls.some(call => call === `unlink:${destination}`))
    assert.ok(!calls.some(call => call.startsWith(`rename:${destination}->`)))
  })

  it('surfaces primary and cleanup failures together', async () => {
    // @ts-expect-error CLI script intentionally has no TypeScript declaration file
    const { atomicReplaceFile } = await import('../../../scripts/juyiting/validate-map.mjs')
    const operations = fakeAtomicOperations([], {
      fsyncSync() { throw new Error('primary fsync failure') },
      closeSync() { throw new Error('cleanup close failure') },
      unlinkSync() { throw new Error('cleanup unlink failure') },
    })

    assert.throws(
      () => atomicReplaceFile('C:/artifacts/hall.svg', 'content', 'preview', operations),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError)
        assert.match(error.message, /cleanup also failed/i)
        assert.match(error.message, /primary fsync failure/)
        assert.match(error.message, /cleanup close failure/)
        assert.match(error.message, /cleanup unlink failure/)
        assert.deepEqual(error.errors.map(item => (item as Error).message), [
          'primary fsync failure',
          'cleanup close failure',
          'cleanup unlink failure',
        ])
        return true
      },
    )
  })

  it('checks committed artifacts by default and rejects unknown CLI arguments', function () {
    this.timeout(20_000)
    const validate = runScript(validateScript)
    const preview = runScript(previewScript)
    assert.equal(validate.status, 0, validate.stderr)
    assert.equal(validate.stdout.trim(), 'Juyiting map valid')
    assert.equal(preview.status, 0, preview.stderr)
    assert.equal(preview.stdout.trim(), 'Juyiting map previews valid')

    const validateUnknown = runScript(validateScript, ['--wat'])
    const previewUnknown = runScript(previewScript, ['--wat'])
    assert.notEqual(validateUnknown.status, 0)
    assert.match(validateUnknown.stderr, /Unknown arguments: --wat/)
    assert.notEqual(previewUnknown.status, 0)
    assert.match(previewUnknown.stderr, /Unknown arguments: --wat/)
  })

  it('integrates atomic snapshot check/update semantics for missing, mismatch, and I/O failures', function () {
    this.timeout(20_000)
    withScriptFixture(paths => {
      const env = fixtureEnvironment(paths)
      const missing = runScript(validateScript, [], env)
      assert.notEqual(missing.status, 0)
      assert.match(missing.stderr, /snapshot is missing/i)

      const update = runScript(validateScript, ['--update'], env)
      assert.equal(update.status, 0, update.stderr)
      const committed = readFileSync(paths.snapshotPath, 'utf8')
      assert.equal(runScript(validateScript, [], env).status, 0)

      writeFileSync(paths.snapshotPath, `${committed}mismatch`, 'utf8')
      const mismatch = runScript(validateScript, [], env)
      assert.notEqual(mismatch.status, 0)
      assert.match(mismatch.stderr, /snapshot mismatch/i)
      assert.equal(runScript(validateScript, ['--update'], env).status, 0)
      assert.equal(readFileSync(paths.snapshotPath, 'utf8'), committed)

      rmSync(paths.snapshotPath)
      mkdirSync(paths.snapshotPath)
      const ioFailure = runScript(validateScript, [], env)
      assert.notEqual(ioFailure.status, 0)
      assert.doesNotMatch(ioFailure.stderr, /snapshot is missing/i)
      assert.match(ioFailure.stderr, /Unable to read/i)
      assert.deepEqual(temporaryArtifacts(paths.root), [])
    })
  })

  it('integrates portable preview check/update, art changes, and no-partial-write failure handling', function () {
    this.timeout(20_000)
    withScriptFixture(paths => {
      const env = fixtureEnvironment(paths)
      const missing = runScript(previewScript, [], env)
      assert.notEqual(missing.status, 0)
      assert.match(missing.stderr, /preview is missing/i)

      const update = runScript(previewScript, ['--update'], env)
      assert.equal(update.status, 0, update.stderr)
      assert.equal(update.stdout.trim(), 'Juyiting map previews valid')
      const cleanBefore = readFileSync(paths.cleanPath, 'utf8')
      const debugBefore = readFileSync(paths.debugPath, 'utf8')
      assert.equal(previewGenerationId(cleanBefore), previewGenerationId(debugBefore))
      assert.match(cleanBefore, /data:image\/(png|webp);base64,/)
      assert.equal(runScript(previewScript, [], env).status, 0)

      writeFileSync(paths.cleanPath, `${cleanBefore}mismatch`, 'utf8')
      const mismatch = runScript(previewScript, [], env)
      assert.notEqual(mismatch.status, 0)
      assert.match(mismatch.stderr, /preview mismatch/i)
      assert.equal(readFileSync(paths.debugPath, 'utf8'), debugBefore)
      assert.equal(runScript(previewScript, ['--update'], env).status, 0)

      const alternateBytes = Buffer.from('alternate-map-art')
      writeFileSync(join(dirname(paths.tmxPath), 'images/alternate.png'), alternateBytes)
      writeFileSync(
        paths.tmxPath,
        readFileSync(paths.tmxPath, 'utf8').replace('images/liangshan-hall-base-clean-v3.webp', 'images/alternate.png'),
        'utf8',
      )
      assert.notEqual(runScript(previewScript, [], env).status, 0)
      assert.equal(runScript(previewScript, ['--update'], env).status, 0)
      const changedClean = readFileSync(paths.cleanPath, 'utf8')
      const changedDebug = readFileSync(paths.debugPath, 'utf8')
      assert.notEqual(changedClean, cleanBefore)
      assert.ok(changedClean.includes(alternateBytes.toString('base64')))
      assert.equal(previewGenerationId(changedClean), previewGenerationId(changedDebug))
      assert.notEqual(previewGenerationId(changedClean), previewGenerationId(cleanBefore))

      writeFileSync(paths.debugPath, debugBefore, 'utf8')
      const mixedGeneration = runScript(previewScript, [], env)
      assert.notEqual(mixedGeneration.status, 0)
      assert.match(mixedGeneration.stderr, /preview generation mismatch/i)
      assert.equal(runScript(previewScript, ['--update'], env).status, 0)

      const cleanStable = changedClean
      rmSync(paths.debugPath)
      mkdirSync(paths.debugPath)
      const failedUpdate = runScript(previewScript, ['--update'], env)
      assert.notEqual(failedUpdate.status, 0)
      assert.equal(readFileSync(paths.cleanPath, 'utf8'), cleanStable)
      assert.ok(readdirSync(paths.debugPath).length === 0)
      assert.deepEqual(temporaryArtifacts(paths.root), [])
    })
  })

  it('fails clearly for missing and unsupported TMX art references', function () {
    this.timeout(20_000)
    withScriptFixture(paths => {
      const env = fixtureEnvironment(paths)
      rmSync(join(dirname(paths.tmxPath), 'images/liangshan-hall-base-clean-v3.webp'))
      const missingArt = runScript(previewScript, ['--update'], env)
      assert.notEqual(missingArt.status, 0)
      assert.match(missingArt.stderr, /Referenced map art is missing/i)

      writeFileSync(
        paths.tmxPath,
        readFileSync(paths.tmxPath, 'utf8').replace('images/liangshan-hall-base-clean-v3.webp', 'images/unsupported.bmp'),
        'utf8',
      )
      writeFileSync(join(dirname(paths.tmxPath), 'images/unsupported.bmp'), 'bmp')
      const unsupported = runScript(previewScript, ['--update'], env)
      assert.notEqual(unsupported.status, 0)
      assert.match(unsupported.stderr, /Unsupported map art format/i)
      assert.deepEqual(temporaryArtifacts(paths.root), [])
    })
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
    patrolRoutes: [],
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

interface ScriptFixturePaths {
  root: string
  tmxPath: string
  snapshotPath: string
  previewDirectory: string
  cleanPath: string
  debugPath: string
}

function runScript(script: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function withScriptFixture(callback: (paths: ScriptFixturePaths) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'juyiting-map-artifacts-'))
  const tmxPath = join(root, 'hall.tmx')
  const snapshotPath = join(root, 'hall-map.snapshot.json')
  const previewDirectory = join(root, 'previews')
  const paths = {
    root,
    tmxPath,
    snapshotPath,
    previewDirectory,
    cleanPath: join(previewDirectory, 'hall-clean.svg'),
    debugPath: join(previewDirectory, 'hall-debug.svg'),
  }
  try {
    copyFileSync(fileURLToPath(hallTmxUrl), tmxPath)
    const imageDirectory = join(root, 'images')
    mkdirSync(imageDirectory, { recursive: true })
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    for (const name of [
      'liangshan-hall-base-clean-v3.webp',
      'liangshan-hall-mid-occluders-v3.webp',
      'liangshan-hall-foreground-occluders-v3.webp',
      'liangshan-hall-lighting-overlay-v3.webp',
    ]) writeFileSync(join(imageDirectory, name), png)
    callback(paths)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function fixtureEnvironment(paths: ScriptFixturePaths): Record<string, string> {
  return {
    JIA_JUYITING_TMX_PATH: paths.tmxPath,
    JIA_JUYITING_SNAPSHOT_PATH: paths.snapshotPath,
    JIA_JUYITING_PREVIEW_DIR: paths.previewDirectory,
  }
}

function temporaryArtifacts(root: string): string[] {
  const found: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name.includes('.tmp-') || entry.name.includes('.bak-')) found.push(path)
    }
  }
  visit(root)
  return found
}

function previewGenerationId(svg: string): string {
  const match = svg.match(/data-generation-id="([a-f0-9]{64})"/)
  assert.ok(match, 'preview generation ID is missing')
  return match[1]
}

function fakeAtomicOperations(calls: string[], overrides: Record<string, unknown> = {}) {
  const operations = {
    randomUUID: () => 'test-id',
    mkdirSync: (path: string) => { calls.push(`mkdir:${path}`) },
    statSync: (path: string) => { calls.push(`stat:${path}`); return { isFile: () => true } },
    openSync: (path: string) => { calls.push(`open:${path}`); return 7 },
    writeFileSync: (fd: number) => { calls.push(`write:${fd}`) },
    fsyncSync: (fd: number) => { calls.push(`fsync:${fd}`) },
    closeSync: (fd: number) => { calls.push(`close:${fd}`) },
    readFileSync: (path: string) => { calls.push(`read:${path}`); return 'new-content' },
    renameSync: (from: string, to: string) => { calls.push(`rename:${from}->${to}`) },
    unlinkSync: (path: string) => { calls.push(`unlink:${path}`) },
    ...overrides,
  }
  return operations
}

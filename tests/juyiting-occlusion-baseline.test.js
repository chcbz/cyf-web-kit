import { expect } from 'chai'
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseTmxStructure, resolveWorldPolygon, polygonAabb } from '../scripts/juyiting/lib/tmx-structure.mjs'
import {
  E1_BASELINE_COMMIT,
  assertBaselineProvenance,
  assertBaselinePublicTree,
  currentHead,
} from '../scripts/juyiting/lib/baseline-provenance.mjs'
import { atomicWriteUtf8 } from '../scripts/juyiting/lib/atomic-write.mjs'
import {
  canonicalizeJuyitingRuntimeSource,
  canonicalizeJuyitingTmxSource,
  resolveJuyitingPublicFile,
} from '../scripts/juyiting/lib/juyiting-public-path.mjs'
import { buildRuntimeReferenceAudit } from '../scripts/juyiting/asset-report-juyiting.mjs'
import {
  HALL_BOOT_RESOURCES,
  buildHallMapResources,
  buildPersonaSpriteResource,
} from '../src/game/resources.js'
import { PERSONA_SPRITE_MANIFEST } from '../src/game/sprites/personaSpriteManifest.ts'

const TMX_PATH = 'public/juyiting/hall.tmx'
const FIXTURE_DIR = 'tests/fixtures/juyiting/occlusion-v0'
const tmx = readFileSync(TMX_PATH, 'utf8')
const structure = parseTmxStructure(tmx)
const tmxSha256 = () => createHash('sha256').update(tmx).digest('hex')

const inventory = JSON.parse(readFileSync(`${FIXTURE_DIR}/inventory.json`, 'utf8'))
const sourceHashes = JSON.parse(readFileSync(`${FIXTURE_DIR}/source-hashes.json`, 'utf8'))
const assetReport = JSON.parse(readFileSync(`${FIXTURE_DIR}/asset-report.json`, 'utf8'))

const emptyMapStructure = () => ({ tilesets: [], layers: [] })
const networkEntry = (path) => ({ path, sizeBytes: 1, sha256: '0'.repeat(64), category: 'test', role: 'test' })
const importSourceModule = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const runNpmScript = (script, environment, mode = 'update') => {
  const scriptArguments = mode === 'update' ? ['run', script, '--', '--update'] : ['run', script]
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...scriptArguments], {
      cwd: process.cwd(),
      env: environment,
      encoding: 'utf8',
    })
  }
  return spawnSync('npm', scriptArguments, {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
  })
}

const copyIsolatedBaseline = (prefix) => {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const publicRoot = join(root, 'public')
  const fixtureDir = join(root, 'fixtures')
  mkdirSync(publicRoot, { recursive: true })
  cpSync('public/juyiting', join(publicRoot, 'juyiting'), { recursive: true })
  cpSync(FIXTURE_DIR, fixtureDir, { recursive: true })
  return { root, publicRoot, fixtureDir }
}

const rewriteBaselineCommit = (path, baselineCommit) => {
  const fixture = JSON.parse(readFileSync(path, 'utf8'))
  fixture.baselineCommit = baselineCommit
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`)
}

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


  it('locks every fixture to the code-owned E1 baseline commit', () => {
    expect(E1_BASELINE_COMMIT).to.equal('2424f51f375814f403ca70a9a6e9948728e595b1')
    expect(currentHead()).to.not.equal(E1_BASELINE_COMMIT)
    for (const fixture of [inventory, sourceHashes, assetReport]) {
      expect(fixture.baselineCommit).to.equal(E1_BASELINE_COMMIT)
    }
  })

  it('audits the complete frozen public/juyiting blob tree, not only runtime references', () => {
    const audit = assertBaselinePublicTree('public', E1_BASELINE_COMMIT)
    expect(audit.fileCount).to.equal(27)
    expect(audit.files).to.have.length(27)
    expect(audit.files.map(entry => entry.path)).to.deep.equal(
      assetReport.juyitingNetworkAssets.files.map(entry => entry.path),
    )
    expect(audit.files.every(entry => /^100(?:644|755)$/.test(entry.gitMode))).to.equal(true)
    expect(audit.files.every(entry => /^[0-9a-f]{40}$/.test(entry.baselineBlob))).to.equal(true)
    expect(assetReport.juyitingNetworkAssets.baselinePublicTreeAudit).to.deep.include({
      baselineCommit: E1_BASELINE_COMMIT,
      pathPrefix: 'public/juyiting/',
      exactPathSet: true,
      currentBytesMatchBaseline: true,
      fileCount: 27,
    })
    expect(assetReport.juyitingNetworkAssets.totalPublicTreeBytes)
      .to.equal(assetReport.juyitingNetworkAssets.files.reduce((total, entry) => total + entry.sizeBytes, 0))
  })

  it('covers all six executable persona sprite exports with baseline git-show provenance', () => {
    const spriteEntries = sourceHashes.entries.filter(entry => entry.role === 'persona-sprite')
    expect(spriteEntries).to.have.length(6)
    expect(spriteEntries.map(entry => entry.path)).to.have.members(
      Object.values(PERSONA_SPRITE_MANIFEST.personas).map(definition => `public${definition.src}`),
    )

    const sprite = spriteEntries.find(entry => entry.label === 'songjiang')
    const baselineBytes = execFileSync('git', ['show', `${sourceHashes.baselineCommit}:${sprite.path}`])
    const changedSpriteSha = createHash('sha256')
      .update(Buffer.concat([baselineBytes, Buffer.from('simulated-byte-change')]))
      .digest('hex')
    expect(() => assertBaselineProvenance(sourceHashes.baselineCommit, [{ path: sprite.path, sha256: changedSpriteSha }]))
      .to.throw(`Baseline provenance mismatch for ${sprite.path}`)
  })

  it('canonicalizes only unambiguous Juyiting runtime and TMX public paths', () => {
    expect(canonicalizeJuyitingRuntimeSource(
      '/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp',
    )).to.equal('public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp')
    expect(canonicalizeJuyitingTmxSource(
      'images/props/liangshan-hall-prop-main-seat-cropped.png',
    )).to.equal('public/juyiting/images/props/liangshan-hall-prop-main-seat-cropped.png')
    expect(new URL(
      '/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp',
      'https://juyiting-audit.invalid/',
    ).pathname).to.equal('/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp')
    expect(new URL(
      'images/props/liangshan-hall-prop-main-seat-cropped.png',
      'https://juyiting-audit.invalid/juyiting/',
    ).pathname).to.equal('/juyiting/images/props/liangshan-hall-prop-main-seat-cropped.png')

    const runtimeAttacks = [
      '/juyiting/%2e%2e/secret.webp',
      '/juyiting/%2E%2E/secret.webp',
      '/juyiting/.%2e/secret.webp',
      '/juyiting/%2e./secret.webp',
      '/juyiting/.%2E/secret.webp',
      '/juyiting/%2E./secret.webp',
      '/juyiting/%2fsecret.webp',
      '/juyiting/%2Fsecret.webp',
      '/juyiting/%5csecret.webp',
      '/juyiting/%5Csecret.webp',
      '/juyiting/%252e%252e/secret.webp',
      '/juyiting/%00/secret.webp',
      '/juyiting/../secret.webp',
      '/juyiting/./secret.webp',
      '/juyiting/images//secret.webp',
      '/juyiting/images/',
      '/juyiting/images\\secret.webp',
      '/juyiting/images/secret.webp?cache=1',
      '/juyiting/images/secret.webp#fragment',
      '/juyiting/images/secret\u0000.webp',
      '/juyiting/images/%GG.webp',
      '/juyiting/images/%.webp',
      'https://example.invalid/juyiting/images/secret.webp',
      '//example.invalid/juyiting/images/secret.webp',
    ]
    for (const source of runtimeAttacks) {
      expect(() => canonicalizeJuyitingRuntimeSource(source), source).to.throw()
    }

    const tmxAttacks = [
      'images/%2e%2e/secret.webp',
      'images/%2E%2E/secret.webp',
      'images/.%2e/secret.webp',
      'images/%2e./secret.webp',
      'images/%2fsecret.webp',
      'images/%2Fsecret.webp',
      'images/%5csecret.webp',
      'images/%5Csecret.webp',
      'images/%00/secret.webp',
      'images/%GG.webp',
      'images/../secret.webp',
      './images/secret.webp',
      'images//secret.webp',
      'images/',
      'images\\secret.webp',
      'images/secret.webp?cache=1',
      'images/secret.webp#fragment',
      'https://example.invalid/juyiting/images/secret.webp',
      '//example.invalid/juyiting/images/secret.webp',
      '/juyiting/images/secret.webp',
    ]
    for (const source of tmxAttacks) {
      expect(() => canonicalizeJuyitingTmxSource(source), source).to.throw()
    }

    expect(() => buildRuntimeReferenceAudit({
      structure: emptyMapStructure(),
      network: [],
      bootResources: [{ name: 'hall', type: 'tmx', src: '/juyiting/%2e%2e/secret.tmx' }],
      buildMapResources: buildHallMapResources,
      personaManifest: { personas: { songjiang: { personaCode: 'songjiang', src: '/juyiting/sprites/a.webp' } } },
      buildSpriteResource: buildPersonaSpriteResource,
    })).to.throw('unsupported percent encoding')
    expect(() => buildRuntimeReferenceAudit({
      structure: {
        tilesets: [{ name: 'attack', image: 'images/.%2e/secret.webp', tiles: [] }],
        layers: [],
      },
      network: [networkEntry('public/juyiting/hall.tmx')],
      bootResources: HALL_BOOT_RESOURCES,
      buildMapResources: buildHallMapResources,
      personaManifest: { personas: { songjiang: { personaCode: 'songjiang', src: '/juyiting/sprites/a.webp' } } },
      buildSpriteResource: buildPersonaSpriteResource,
    })).to.throw('unsupported percent encoding')
  })

  it('keeps hash and asset --update fixtures byte-identical when an isolated sprite is tampered', function () {
    this.timeout(30000)
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-provenance-'))
    try {
      const publicRoot = join(root, 'public')
      const fixtureDir = join(root, 'fixtures')
      mkdirSync(publicRoot, { recursive: true })
      mkdirSync(fixtureDir, { recursive: true })
      cpSync('public/juyiting', join(publicRoot, 'juyiting'), { recursive: true })
      for (const fixtureName of ['source-hashes.json', 'asset-report.json']) {
        copyFileSync(`${FIXTURE_DIR}/${fixtureName}`, join(fixtureDir, fixtureName))
      }

      appendFileSync(
        join(publicRoot, 'juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp'),
        Buffer.from('isolated-provenance-tamper'),
      )
      const environment = {
        ...process.env,
        JIA_JUYITING_PUBLIC_ROOT: publicRoot,
        JIA_JUYITING_OCCLUSION_FIXTURE_DIR: fixtureDir,
      }

      for (const { script, fixtureName } of [
        { script: 'hash:juyiting-sources', fixtureName: 'source-hashes.json' },
        { script: 'asset:juyiting-report', fixtureName: 'asset-report.json' },
      ]) {
        const fixturePath = join(fixtureDir, fixtureName)
        const before = readFileSync(fixturePath)
        const result = runNpmScript(script, environment)
        expect(result.status, `${script}\n${result.stdout}\n${result.stderr}`).to.not.equal(0)
        expect(`${result.stdout}\n${result.stderr}`).to.include(
          'Baseline provenance mismatch for public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp',
        )
        expect(readFileSync(fixturePath).equals(before), script).to.equal(true)
      }
      expect(readdirSync(fixtureDir).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails asset --update before writing when any frozen non-runtime public file is deleted', function () {
    this.timeout(30000)
    const { root, publicRoot, fixtureDir } = copyIsolatedBaseline('juyiting-e1-public-tree-')
    try {
      const deletedPath = join(publicRoot, 'juyiting/images/modular/preview.html')
      rmSync(deletedPath)
      const fixturePath = join(fixtureDir, 'asset-report.json')
      const before = readFileSync(fixturePath)
      const result = runNpmScript('asset:juyiting-report', {
        ...process.env,
        JIA_JUYITING_PUBLIC_ROOT: publicRoot,
        JIA_JUYITING_TMX_PATH: join(publicRoot, 'juyiting/hall.tmx'),
        JIA_JUYITING_OCCLUSION_FIXTURE_DIR: fixtureDir,
      })
      expect(result.status, `${result.stdout}\n${result.stderr}`).to.not.equal(0)
      expect(`${result.stdout}\n${result.stderr}`).to.include('Juyiting public tree path mismatch')
      expect(`${result.stdout}\n${result.stderr}`).to.include('public/juyiting/images/modular/preview.html')
      expect(readFileSync(fixturePath).equals(before)).to.equal(true)
      expect(readdirSync(fixtureDir).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a fixture baselineCommit redirected to current HEAD in all four verifier/update paths', function () {
    this.timeout(60000)
    const cases = [
      { script: 'inventory:juyiting-map', fixture: 'inventory.json', outputs: ['inventory.json', 'mask-ledger.md'] },
      { script: 'hash:juyiting-sources', fixture: 'source-hashes.json', outputs: ['source-hashes.json'] },
      { script: 'preview:juyiting-occlusion-layers', fixture: 'inventory.json', outputs: [
        'layers/occlusion-mask-only.svg',
        'layers/occlusion-collision-nav-only.svg',
        'layers/occlusion-routes-nodes-only.svg',
        'layers/occlusion-combined.svg',
      ] },
      { script: 'asset:juyiting-report', fixture: 'asset-report.json', outputs: ['asset-report.json'] },
    ]
    for (const testCase of cases) {
      for (const mode of ['verify', 'update']) {
        const { root, publicRoot, fixtureDir } = copyIsolatedBaseline(`juyiting-e1-lock-${testCase.script.replaceAll(':', '-')}-`)
        try {
          rewriteBaselineCommit(join(fixtureDir, testCase.fixture), currentHead())
          const before = new Map(testCase.outputs.map(path => [path, readFileSync(join(fixtureDir, path))]))
          const environment = {
            ...process.env,
            JIA_JUYITING_PUBLIC_ROOT: publicRoot,
            JIA_JUYITING_IMAGES_DIR: join(publicRoot, 'juyiting/images'),
            JIA_JUYITING_TMX_PATH: join(publicRoot, 'juyiting/hall.tmx'),
            JIA_JUYITING_OCCLUSION_FIXTURE_DIR: fixtureDir,
            JIA_JUYITING_OCCLUSION_INVENTORY_PATH: join(fixtureDir, 'inventory.json'),
            JIA_JUYITING_LAYER_DIR: join(fixtureDir, 'layers'),
          }
          const result = runNpmScript(testCase.script, environment, mode)
          expect(result.status, `${testCase.script} ${mode}\n${result.stdout}\n${result.stderr}`).to.not.equal(0)
          expect(`${result.stdout}\n${result.stderr}`).to.include(`E1 baseline commit must equal locked commit ${E1_BASELINE_COMMIT}`)
          for (const [path, bytes] of before) {
            expect(readFileSync(join(fixtureDir, path)).equals(bytes), `${testCase.script} ${mode}: ${path}`).to.equal(true)
          }
          expect(readdirSync(fixtureDir).filter(name => name.includes('.tmp-'))).to.deep.equal([])
        } finally {
          rmSync(root, { recursive: true, force: true })
        }
      }
    }
  })

  it('resolves only existing real files inside the real public root', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-realpath-'))
    try {
      const publicRoot = join(root, 'public')
      const imageDirectory = join(publicRoot, 'juyiting/images')
      const outside = join(root, 'outside.webp')
      mkdirSync(imageDirectory, { recursive: true })
      writeFileSync(outside, 'outside')
      symlinkSync(outside, join(imageDirectory, 'escape.webp'))

      expect(() => resolveJuyitingPublicFile(publicRoot, 'public/juyiting/images/escape.webp'))
        .to.throw('Juyiting public file resolves outside public root')
      expect(() => resolveJuyitingPublicFile(publicRoot, 'public/juyiting/images/missing.webp'))
        .to.throw('Juyiting public file is missing: public/juyiting/images/missing.webp')
      const inside = join(imageDirectory, 'inside.webp')
      writeFileSync(inside, 'inside')
      expect(resolveJuyitingPublicFile(publicRoot, 'public/juyiting/images/inside.webp')).to.equal(inside)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves the primary atomic-write error when close and unlink cleanup both fail', () => {
    const primary = new Error('primary write failure')
    const close = new Error('close cleanup failure')
    const unlink = new Error('unlink cleanup failure')
    let thrown
    try {
      atomicWriteUtf8('/virtual/fixture.json', 'content', 'fault fixture', {
        randomUUID: () => 'fixed',
        mkdirSync: () => {},
        openSync: () => 7,
        writeFileSync: () => { throw primary },
        fsyncSync: () => {},
        closeSync: () => { throw close },
        readFileSync: () => 'content',
        renameSync: () => {},
        unlinkSync: () => { throw unlink },
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).to.be.instanceOf(AggregateError)
    expect(thrown.errors).to.deep.equal([primary, close, unlink])
    expect(thrown.message).to.include('primary write failure')
    expect(thrown.message).to.include('close cleanup failure')
    expect(thrown.message).to.include('unlink cleanup failure')
  })

  it('atomically replaces a normal fixture without leaving temporary files', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-'))
    try {
      const fixturePath = join(root, 'fixture.json')
      writeFileSync(fixturePath, 'old')
      atomicWriteUtf8(fixturePath, 'new', 'normal fixture')
      expect(readFileSync(fixturePath, 'utf8')).to.equal('new')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('discovers runtime resources from executable exports, so a fake source comment cannot override HALL_BOOT_RESOURCES', async () => {
    const resourcesSource = readFileSync('src/game/resources.js', 'utf8')
    const moduleWithFakeComment = await importSourceModule([
      "// HALL_MAP_RESOURCE = { name: 'fake', type: 'tmx', src: '/juyiting/fake-comment.tmx' }",
      resourcesSource,
    ].join('\n'))
    const spritePath = '/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp'
    const audit = buildRuntimeReferenceAudit({
      structure: emptyMapStructure(),
      network: [networkEntry('public/juyiting/hall.tmx'), networkEntry(`public${spritePath}`)],
      bootResources: moduleWithFakeComment.HALL_BOOT_RESOURCES,
      buildMapResources: moduleWithFakeComment.buildHallMapResources,
      personaManifest: { personas: { songjiang: { personaCode: 'songjiang', src: spritePath } } },
      buildSpriteResource: moduleWithFakeComment.buildPersonaSpriteResource,
    })

    expect(audit.files.map(entry => entry.path)).to.deep.equal([
      'public/juyiting/hall.tmx',
      `public${spritePath}`,
    ])
    expect(audit.files.some(entry => entry.path.includes('fake-comment'))).to.equal(false)
  })

  it('discovers a sprite path carried by an executable module constant', async () => {
    const constantManifestModule = await importSourceModule(`
      const SPRITE_SRC = '/juyiting/sprites/persona-sheets-v1/wuyong-8-direction-v1.webp'
      export const PERSONA_SPRITE_MANIFEST = {
        personas: { wuyong: { personaCode: 'wuyong', src: SPRITE_SRC } },
      }
    `)
    const audit = buildRuntimeReferenceAudit({
      structure: emptyMapStructure(),
      network: [
        networkEntry('public/juyiting/hall.tmx'),
        networkEntry('public/juyiting/sprites/persona-sheets-v1/wuyong-8-direction-v1.webp'),
      ],
      bootResources: HALL_BOOT_RESOURCES,
      buildMapResources: buildHallMapResources,
      personaManifest: constantManifestModule.PERSONA_SPRITE_MANIFEST,
      buildSpriteResource: buildPersonaSpriteResource,
    })

    expect(audit.files.map(entry => entry.path)).to.include(
      'public/juyiting/sprites/persona-sheets-v1/wuyong-8-direction-v1.webp',
    )
  })

  it('fails closed for unknown resource types and missing runtime paths', () => {
    const validSpriteManifest = {
      personas: {
        missing: { personaCode: 'missing', src: '/juyiting/sprites/persona-sheets-v1/missing.webp' },
      },
    }
    const base = {
      structure: emptyMapStructure(),
      network: [networkEntry('public/juyiting/hall.tmx')],
      buildMapResources: buildHallMapResources,
      personaManifest: validSpriteManifest,
      buildSpriteResource: buildPersonaSpriteResource,
    }

    expect(() => buildRuntimeReferenceAudit({
      ...base,
      bootResources: [{ name: 'hall', type: 'audio', src: '/juyiting/hall.tmx' }],
    })).to.throw('Unsupported runtime resource type')
    expect(() => buildRuntimeReferenceAudit({ ...base, bootResources: HALL_BOOT_RESOURCES }))
      .to.throw('Runtime asset references missing from public/juyiting: public/juyiting/sprites/persona-sheets-v1/missing.webp')
  })

  it('executes the live loader exports against parseTmxStructure output and covers every TMX loader branch', () => {
    const audit = buildRuntimeReferenceAudit({
      structure,
      network: assetReport.juyitingNetworkAssets.files,
      bootResources: HALL_BOOT_RESOURCES,
      buildMapResources: buildHallMapResources,
      personaManifest: PERSONA_SPRITE_MANIFEST,
      buildSpriteResource: buildPersonaSpriteResource,
    })
    expect(Object.values(audit.loaderContractChecks).every(Boolean)).to.equal(true)
    expect(audit.files.map(entry => entry.path)).to.deep.equal(
      assetReport.juyitingNetworkAssets.runtimeCoreFiles.map(entry => entry.path),
    )
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
    expect(network.runtimeReferenceAudit.pathCanonicalization).to.deep.equal({
      implementation: 'scripts/juyiting/lib/juyiting-public-path.mjs',
      outputPrefix: 'public/juyiting/',
      policy: 'WHATWG-checked ASCII unreserved segments only; percent encoding, dot/empty segments, backslash, controls, origin/host, query, and hash fail closed.',
    })

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

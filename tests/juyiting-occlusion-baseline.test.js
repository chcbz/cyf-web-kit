import { expect } from 'chai'
import { execFileSyncCaptured, spawnSyncCaptured } from '../scripts/juyiting/lib/spawn-capture.mjs'
import {
  appendFileSync,
  copyFileSync,
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  linkSync,
  lstatSync,
  openSync,
  renameSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseTmxStructure, resolveWorldPolygon, polygonAabb } from '../scripts/juyiting/lib/tmx-structure.mjs'
import {
  E1_BASELINE_COMMIT,
  E1_BASELINE_TMX_SHA256,
  E8B_LIVE_TMX_SHA256,
  CURRENT_LIVE_TMX_SHA256,
  E9B_OCCLUDER_OVERLAY_DIRECTORY,
  assertBaselineProvenance,
  assertBaselinePublicTree,
  assertCurrentPublicTreeVsE1,
  currentHead,
  materializeE1PublicTree,
  readGitBlobAtCommit,
} from '../scripts/juyiting/lib/baseline-provenance.mjs'
import { atomicWriteUtf8, atomicWriteUtf8Batch } from '../scripts/juyiting/lib/atomic-write.mjs'
import {
  canonicalizeJuyitingRuntimeSource,
  canonicalizeJuyitingTmxSource,
  readJuyitingPublicFile,
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
const liveTmx = readFileSync(TMX_PATH, 'utf8')
const structure = parseTmxStructure(liveTmx)
const liveTmxSha256 = () => createHash('sha256').update(liveTmx).digest('hex')
const historicalTmxBytes = readGitBlobAtCommit(E1_BASELINE_COMMIT, TMX_PATH)
const historicalStructure = parseTmxStructure(historicalTmxBytes.toString('utf8'))

const inventory = JSON.parse(readFileSync(`${FIXTURE_DIR}/inventory.json`, 'utf8'))
const sourceHashes = JSON.parse(readFileSync(`${FIXTURE_DIR}/source-hashes.json`, 'utf8'))
const assetReport = JSON.parse(readFileSync(`${FIXTURE_DIR}/asset-report.json`, 'utf8'))
const propTmxManifest = JSON.parse(readFileSync('tests/fixtures/juyiting/occlusion-v1-props/prop-tmx-manifest.json', 'utf8'))

const emptyMapStructure = () => ({ tilesets: [], layers: [] })
const networkEntry = (path) => ({ path, sizeBytes: 1, sha256: '0'.repeat(64), category: 'test', role: 'test' })
const importSourceModule = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const runNpmScript = (script, environment, mode = 'update') => {
  const scriptArguments = mode === 'update' ? ['run', script, '--', '--update'] : ['run', script]
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return spawnSyncCaptured(process.execPath, [npmExecPath, ...scriptArguments], {
      cwd: process.cwd(),
      env: environment,
      encoding: 'utf8',
    })
  }
  return spawnSyncCaptured('npm', scriptArguments, {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
  })
}

const copyIsolatedBaseline = (prefix) => {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const publicRoot = join(root, 'public')
  const fixtureDir = join(root, 'fixtures')
  materializeE1PublicTree(join(publicRoot, 'juyiting'), E1_BASELINE_COMMIT)
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
    expect(structure.groups.nav_edges.length).to.equal(15)
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

  it('audits the complete frozen public/juyiting blob tree, not only runtime references', function () {
    this.timeout(30000)
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-frozen-audit-'))
    try {
      const publicRoot = join(root, 'public')
      materializeE1PublicTree(join(publicRoot, 'juyiting'), E1_BASELINE_COMMIT)
      const audit = assertBaselinePublicTree(publicRoot, E1_BASELINE_COMMIT)
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
        gitReplaceObjectsDisabled: true,
        baselineObjectFormat: 'sha1',
        fileCount: 27,
      })
      expect(assetReport.juyitingNetworkAssets.totalPublicTreeBytes)
        .to.equal(assetReport.juyitingNetworkAssets.files.reduce((total, entry) => total + entry.sizeBytes, 0))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores Git replace refs and reads the fixed tree blob object IDs in an isolated clone', function () {
    this.timeout(60000)
    const { root, publicRoot, fixtureDir } = copyIsolatedBaseline('juyiting-e1-git-replace-')
    const cloneRoot = join(root, 'repo')
    const targetAuditPath = 'public/juyiting/images/modular/preview.html'
    const targetFile = join(publicRoot, 'juyiting/images/modular/preview.html')
    const gitEnvironment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    }
    delete gitEnvironment.GIT_NO_REPLACE_OBJECTS
    for (const key of Object.keys(gitEnvironment)) {
      if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete gitEnvironment[key]
    }
    let originalBlob
    try {
      execFileSyncCaptured('git', ['clone', '--shared', '--quiet', process.cwd(), cloneRoot], { env: gitEnvironment })
      const treeLine = execFileSyncCaptured(
        'git',
        ['-C', cloneRoot, 'ls-tree', E1_BASELINE_COMMIT, '--', targetAuditPath],
        { encoding: 'utf8', env: gitEnvironment },
      ).trim()
      originalBlob = treeLine.match(/^100644 blob ([0-9a-f]{40})	/)?.[1]
      expect(originalBlob).to.match(/^[0-9a-f]{40}$/)

      const replacementBytes = Buffer.from('replacement-ref-bytes-that-must-not-be-trusted\n')
      const replacementBlob = execFileSyncCaptured(
        'git',
        ['-C', cloneRoot, 'hash-object', '-w', '--stdin'],
        { input: replacementBytes, encoding: 'utf8', env: gitEnvironment },
      ).trim()
      execFileSyncCaptured('git', ['-C', cloneRoot, 'replace', originalBlob, replacementBlob], { env: gitEnvironment })
      expect(execFileSyncCaptured('git', ['-C', cloneRoot, 'replace', '-l'], { encoding: 'utf8', env: gitEnvironment }).trim())
        .to.equal(originalBlob)
      expect(execFileSyncCaptured('git', ['-C', cloneRoot, 'cat-file', 'blob', originalBlob], { env: gitEnvironment }).equals(replacementBytes))
        .to.equal(true)

      writeFileSync(targetFile, replacementBytes)
      const fixturePath = join(fixtureDir, 'asset-report.json')
      const before = readFileSync(fixturePath)
      const environment = {
        ...process.env,
        JIA_JUYITING_GIT_REPO_ROOT: cloneRoot,
        JIA_JUYITING_PUBLIC_ROOT: publicRoot,
        JIA_JUYITING_TMX_PATH: join(publicRoot, 'juyiting/hall.tmx'),
        JIA_JUYITING_OCCLUSION_FIXTURE_DIR: fixtureDir,
      }
      for (const mode of ['verify', 'update']) {
        const result = runNpmScript('asset:juyiting-report', environment, mode)
        expect(result.status, `${mode}\n${result.stdout}\n${result.stderr}`).to.not.equal(0)
        expect(`${result.stdout}\n${result.stderr}`).to.include(`Baseline provenance mismatch for ${targetAuditPath}`)
        expect(`${result.stdout}\n${result.stderr}`).to.not.include('Baseline blob object hash mismatch')
        expect(readFileSync(fixturePath).equals(before), mode).to.equal(true)
      }
    } finally {
      if (originalBlob) {
        try { execFileSyncCaptured('git', ['-C', cloneRoot, 'replace', '-d', originalBlob], { env: gitEnvironment }) } catch {}
      }
      if (originalBlob && existsSync(cloneRoot)) {
        expect(execFileSyncCaptured('git', ['-C', cloneRoot, 'replace', '-l'], { encoding: 'utf8', env: gitEnvironment }).trim())
          .to.equal('')
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('covers all six executable persona sprite exports with fixed blob-object provenance', () => {
    const spriteEntries = sourceHashes.entries.filter(entry => entry.role === 'persona-sprite')
    expect(spriteEntries).to.have.length(6)
    expect(spriteEntries.map(entry => entry.path)).to.have.members(
      Object.values(PERSONA_SPRITE_MANIFEST.personas).map(definition => `public${definition.src}`),
    )

    const sprite = spriteEntries.find(entry => entry.label === 'songjiang')
    const baselineBytes = execFileSyncCaptured('git', ['show', `${sourceHashes.baselineCommit}:${sprite.path}`])
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
      materializeE1PublicTree(join(publicRoot, 'juyiting'), E1_BASELINE_COMMIT)
      mkdirSync(fixtureDir, { recursive: true })
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
        JIA_JUYITING_TMX_PATH: join(publicRoot, 'juyiting/hall.tmx'),
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

  it('resolves only opened regular files inside the real public/juyiting root', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-realpath-'))
    try {
      const publicRoot = join(root, 'public')
      const juyitingRoot = join(publicRoot, 'juyiting')
      const imageDirectory = join(juyitingRoot, 'images')
      const outsideDirectory = join(root, 'outside')
      mkdirSync(imageDirectory, { recursive: true })
      mkdirSync(outsideDirectory, { recursive: true })
      writeFileSync(join(outsideDirectory, 'escape.webp'), 'outside')
      symlinkSync(outsideDirectory, join(juyitingRoot, 'escape-dir'))

      expect(() => readJuyitingPublicFile(publicRoot, 'public/juyiting/escape-dir/escape.webp'))
        .to.throw('Juyiting public file descriptor resolves outside real public/juyiting root')
      symlinkSync(join(outsideDirectory, 'escape.webp'), join(imageDirectory, 'final-link.webp'))
      expect(() => readJuyitingPublicFile(publicRoot, 'public/juyiting/images/final-link.webp'))
        .to.throw('Juyiting public file must not be a symlink')
      expect(() => readJuyitingPublicFile(publicRoot, 'public/juyiting/images/missing.webp'))
        .to.throw('Juyiting public file is missing: public/juyiting/images/missing.webp')
      const inside = join(imageDirectory, 'inside.webp')
      writeFileSync(inside, 'inside')
      const opened = readJuyitingPublicFile(publicRoot, 'public/juyiting/images/inside.webp')
      expect(opened.realPath).to.equal(inside)
      expect(opened.bytes.toString()).to.equal('inside')
      expect(resolveJuyitingPublicFile(publicRoot, 'public/juyiting/images/inside.webp')).to.equal(inside)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a deterministic final-component symlink swap before descriptor open', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-open-race-'))
    try {
      const publicRoot = join(root, 'public')
      const imageDirectory = join(publicRoot, 'juyiting/images')
      const candidate = join(imageDirectory, 'race.webp')
      const outside = join(root, 'outside.webp')
      mkdirSync(imageDirectory, { recursive: true })
      writeFileSync(candidate, 'trusted-before-open')
      writeFileSync(outside, 'outside')
      let swapped = false
      expect(() => readJuyitingPublicFile(
        publicRoot,
        'public/juyiting/images/race.webp',
        {
          openSync(path, flags) {
            expect(path).to.equal(candidate)
            rmSync(path)
            symlinkSync(outside, path)
            swapped = true
            return openSync(path, flags)
          },
        },
      )).to.throw('Juyiting public file must not be a symlink')
      expect(swapped).to.equal(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves a descriptor-read primary error when close also fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-read-close-fault-'))
    const primary = new Error('descriptor fstat failure')
    const close = new Error('descriptor close failure')
    try {
      const publicRoot = join(root, 'public')
      const imageDirectory = join(publicRoot, 'juyiting/images')
      mkdirSync(imageDirectory, { recursive: true })
      writeFileSync(join(imageDirectory, 'fault.webp'), 'bytes')
      let thrown
      try {
        readJuyitingPublicFile(publicRoot, 'public/juyiting/images/fault.webp', {
          fstatSync() { throw primary },
          closeSync(descriptor) {
            closeSync(descriptor)
            throw close
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(thrown.errors).to.deep.equal([primary, close])
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

  it('rolls back all prior targets when no-clobber installation fails at the second or third target', () => {
    for (const failureIndex of [1, 2]) {
      const root = mkdtempSync(join(tmpdir(), `juyiting-e1-atomic-batch-link-fail-${failureIndex}-`))
      try {
        const paths = ['first.json', 'second.md', 'third.svg'].map(name => join(root, name))
        paths.forEach((path, index) => writeFileSync(path, `old-${index}`))
        let installCount = 0
        expect(() => atomicWriteUtf8Batch(
          paths.map((path, index) => ({ path, content: `new-${index}`, label: `fixture ${index}` })),
          'three fixture transaction',
          {
            linkSync(source, destination) {
              if (source.includes('.tmp-')) {
                if (installCount === failureIndex) throw new Error(`target ${failureIndex + 1} link failure`)
                installCount += 1
              }
              return linkSync(source, destination)
            },
          },
        )).to.throw(`target ${failureIndex + 1} link failure`)
        paths.forEach((path, index) => expect(readFileSync(path, 'utf8')).to.equal(`old-${index}`))
        expect(readdirSync(root).filter(name => name.includes('.tmp-') || name.includes('.backup-'))).to.deep.equal([])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('preserves a concurrently rebuilt target and its old backup when no-clobber installation sees EEXIST', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-concurrent-rebuild-'))
    try {
      const first = join(root, 'first.json')
      const second = join(root, 'second.md')
      writeFileSync(first, 'first-old')
      writeFileSync(second, 'second-old')
      let rebuilt = false
      let thrown
      try {
        atomicWriteUtf8Batch([
          { path: first, content: 'first-new', label: 'first fixture' },
          { path: second, content: 'second-new', label: 'second fixture' },
        ], 'concurrent rebuild transaction', {
          linkSync(source, destination) {
            if (!rebuilt && source.includes('.tmp-') && destination === second) {
              writeFileSync(second, 'second-concurrent')
              rebuilt = true
            }
            return linkSync(source, destination)
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(rebuilt).to.equal(true)
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(readFileSync(first, 'utf8')).to.equal('first-old')
      expect(readFileSync(second, 'utf8')).to.equal('second-concurrent')
      const backups = readdirSync(root).filter(name => name.includes('.backup-'))
      expect(backups).to.have.length(1)
      const backupPath = join(root, backups[0])
      expect(backups[0]).to.match(/^second\.md\.backup-/)
      expect(readFileSync(backupPath, 'utf8')).to.equal('second-old')
      expect(thrown.message).to.include(second)
      expect(thrown.message).to.include(backupPath)
      expect(thrown.message).to.include('concurrent target was preserved')
      expect(thrown.message).to.include('intentional recovery artifact retained')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves a target replaced after installation and rolls back unaffected targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-post-install-replace-'))
    try {
      const first = join(root, 'first.json')
      const second = join(root, 'second.md')
      const third = join(root, 'third.svg')
      for (const [path, content] of [[first, 'first-old'], [second, 'second-old'], [third, 'third-old']]) {
        writeFileSync(path, content)
      }
      const concurrentSource = join(root, 'first-concurrent-source')
      writeFileSync(concurrentSource, 'first-concurrent')
      let replaced = false
      let thrown
      try {
        atomicWriteUtf8Batch([
          { path: first, content: 'first-new', label: 'first fixture' },
          { path: second, content: 'second-new', label: 'second fixture' },
          { path: third, content: 'third-new', label: 'third fixture' },
        ], 'post-install replacement transaction', {
          linkSync(source, destination) {
            if (!replaced && source.includes('.tmp-') && destination === third) {
              renameSync(concurrentSource, first)
              replaced = true
              throw new Error('third target link failure after concurrent replacement')
            }
            return linkSync(source, destination)
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(replaced).to.equal(true)
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(readFileSync(first, 'utf8')).to.equal('first-concurrent')
      expect(readFileSync(second, 'utf8')).to.equal('second-old')
      expect(readFileSync(third, 'utf8')).to.equal('third-old')
      const backups = readdirSync(root).filter(name => name.includes('.backup-'))
      expect(backups).to.have.length(1)
      const backupPath = join(root, backups[0])
      expect(backups[0]).to.match(/^first\.json\.backup-/)
      expect(readFileSync(backupPath, 'utf8')).to.equal('first-old')
      expect(thrown.message).to.include(first)
      expect(thrown.message).to.include(backupPath)
      expect(thrown.message).to.include('concurrent target was preserved')
      expect(thrown.message).to.include('intentional recovery artifact retained')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves a concurrent replacement injected after temp unlink and before descriptor-bound target validation', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-post-temp-unlink-replace-'))
    try {
      const target = join(root, 'fixture.json')
      const concurrentSource = join(root, 'concurrent-source.json')
      writeFileSync(target, 'ORIGINAL')
      writeFileSync(concurrentSource, 'CONCURRENT')
      let tempUnlinked = false
      let replacedInExactWindow = false
      let thrown
      try {
        atomicWriteUtf8Batch([
          { path: target, content: 'TRANSACTION', label: 'exact window fixture' },
        ], 'post-temp-unlink replacement transaction', {
          unlinkSync(path) {
            const result = unlinkSync(path)
            if (path.includes('.tmp-')) tempUnlinked = true
            return result
          },
          openSync(path, flags, mode) {
            if (tempUnlinked && !replacedInExactWindow && path === target) {
              renameSync(concurrentSource, target)
              replacedInExactWindow = true
            }
            return openSync(path, flags, mode)
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(tempUnlinked).to.equal(true)
      expect(replacedInExactWindow).to.equal(true)
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(readFileSync(target, 'utf8')).to.equal('CONCURRENT')
      const backups = readdirSync(root).filter(name => name.includes('.backup-'))
      expect(backups).to.have.length(1)
      const backupPath = join(root, backups[0])
      expect(backups[0]).to.match(/^fixture\.json\.backup-/)
      expect(readFileSync(backupPath, 'utf8')).to.equal('ORIGINAL')
      expect(thrown.message).to.include('trusted staged content')
      expect(thrown.message).to.include(target)
      expect(thrown.message).to.include(backupPath)
      expect(thrown.message).to.include('concurrent target was preserved')
      expect(thrown.message).to.include('intentional recovery artifact retained')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('detects an in-place same-inode target write after temp unlink and preserves concurrent bytes plus the original backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-post-temp-unlink-in-place-'))
    try {
      const target = join(root, 'fixture.json')
      writeFileSync(target, 'ORIGINAL')
      let tempUnlinked = false
      let mutatedInExactWindow = false
      let thrown
      try {
        atomicWriteUtf8Batch([
          { path: target, content: 'TRANSACTION', label: 'same-inode exact window fixture' },
        ], 'post-temp-unlink in-place transaction', {
          unlinkSync(path) {
            const result = unlinkSync(path)
            if (path.includes('.tmp-')) tempUnlinked = true
            return result
          },
          openSync(path, flags, mode) {
            if (tempUnlinked && !mutatedInExactWindow && path === target) {
              const before = lstatSync(target)
              writeFileSync(target, 'CONCURRENT-IN-PLACE')
              const after = lstatSync(target)
              expect(after.dev).to.equal(before.dev)
              expect(after.ino).to.equal(before.ino)
              mutatedInExactWindow = true
            }
            return openSync(path, flags, mode)
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(tempUnlinked).to.equal(true)
      expect(mutatedInExactWindow).to.equal(true)
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(readFileSync(target, 'utf8')).to.equal('CONCURRENT-IN-PLACE')
      const backups = readdirSync(root).filter(name => name.includes('.backup-'))
      expect(backups).to.have.length(1)
      const backupPath = join(root, backups[0])
      expect(readFileSync(backupPath, 'utf8')).to.equal('ORIGINAL')
      expect(thrown.message).to.include('sha256=')
      expect(thrown.message).to.include(target)
      expect(thrown.message).to.include(backupPath)
      expect(thrown.message).to.include('concurrent target was preserved')
      expect(thrown.message).to.include('intentional recovery artifact retained')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rebuilds the original recovery backup when an in-place write lands during committed backup cleanup', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-backup-cleanup-in-place-'))
    try {
      const target = join(root, 'fixture.json')
      writeFileSync(target, 'ORIGINAL')
      let mutatedDuringBackupCleanup = false
      let thrown
      try {
        atomicWriteUtf8Batch([
          { path: target, content: 'TRANSACTION', label: 'backup cleanup window fixture' },
        ], 'backup-cleanup in-place transaction', {
          unlinkSync(path) {
            if (!mutatedDuringBackupCleanup && path.includes('.backup-')) {
              const result = unlinkSync(path)
              const before = lstatSync(target)
              writeFileSync(target, 'CONCURRENT-DURING-BACKUP-CLEANUP')
              const after = lstatSync(target)
              expect(after.dev).to.equal(before.dev)
              expect(after.ino).to.equal(before.ino)
              mutatedDuringBackupCleanup = true
              return result
            }
            return unlinkSync(path)
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(mutatedDuringBackupCleanup).to.equal(true)
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(readFileSync(target, 'utf8')).to.equal('CONCURRENT-DURING-BACKUP-CLEANUP')
      const backups = readdirSync(root).filter(name => name.includes('.backup-'))
      expect(backups).to.have.length(1)
      const backupPath = join(root, backups[0])
      expect(readFileSync(backupPath, 'utf8')).to.equal('ORIGINAL')
      expect(thrown.message).to.include('success linearization verification')
      expect(thrown.message).to.include(target)
      expect(thrown.message).to.include(backupPath)
      expect(thrown.message).to.include('concurrent target was preserved')
      expect(thrown.message).to.include('intentional recovery artifact retained')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses the final descriptor verification after backup cleanup as the successful linearization boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-linearization-'))
    try {
      const target = join(root, 'fixture.json')
      writeFileSync(target, 'ORIGINAL')
      const events = []
      const descriptorPaths = new Map()
      const mutatingEvents = new Set(['write', 'fsync', 'link', 'rename', 'unlink'])
      atomicWriteUtf8Batch([
        { path: target, content: 'TRANSACTION', label: 'linearization fixture' },
      ], 'linearization transaction', {
        openSync(path, flags, mode) {
          const descriptor = openSync(path, flags, mode)
          descriptorPaths.set(descriptor, path)
          events.push(`open:${path}`)
          return descriptor
        },
        fstatSync(descriptor) {
          events.push(`fstat:${descriptorPaths.get(descriptor)}`)
          return fstatSync(descriptor)
        },
        readFileSync(pathOrDescriptor, options) {
          events.push(`read:${descriptorPaths.get(pathOrDescriptor) ?? pathOrDescriptor}`)
          return readFileSync(pathOrDescriptor, options)
        },
        closeSync(descriptor) {
          events.push(`close:${descriptorPaths.get(descriptor)}`)
          descriptorPaths.delete(descriptor)
          return closeSync(descriptor)
        },
        writeFileSync(pathOrDescriptor, data, options) {
          events.push(`write:${descriptorPaths.get(pathOrDescriptor) ?? pathOrDescriptor}`)
          return writeFileSync(pathOrDescriptor, data, options)
        },
        fsyncSync(descriptor) {
          events.push(`fsync:${descriptorPaths.get(descriptor)}`)
          return fsyncSync(descriptor)
        },
        linkSync(source, destination) {
          events.push(`link:${source}->${destination}`)
          return linkSync(source, destination)
        },
        renameSync(source, destination) {
          events.push(`rename:${source}->${destination}`)
          return renameSync(source, destination)
        },
        unlinkSync(path) {
          events.push(`unlink:${path}`)
          return unlinkSync(path)
        },
      })

      const finalSequence = events.slice(-5)
      expect(finalSequence).to.deep.equal([
        `open:${target}`,
        `fstat:${target}`,
        `read:${target}`,
        `fstat:${target}`,
        `close:${target}`,
      ])
      const finalOpenIndex = events.length - finalSequence.length
      expect(events.slice(finalOpenIndex).some(event => mutatingEvents.has(event.split(':', 1)[0]))).to.equal(false)
      expect(events.slice(0, finalOpenIndex).some(event => event.startsWith('unlink:') && event.includes('.backup-'))).to.equal(true)
      expect(readFileSync(target, 'utf8')).to.equal('TRANSACTION')

      writeFileSync(target, 'AFTER-RETURN')
      expect(readFileSync(target, 'utf8')).to.equal('AFTER-RETURN')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rolls back cleanly when unlinking an installed staged hard link fails once', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-install-unlink-fail-'))
    try {
      const target = join(root, 'fixture.json')
      writeFileSync(target, 'old')
      let failed = false
      expect(() => atomicWriteUtf8Batch([
        { path: target, content: 'new', label: 'unlink fixture' },
      ], 'install unlink transaction', {
        unlinkSync(path) {
          if (!failed && path.includes('.tmp-')) {
            failed = true
            throw new Error('installed temp unlink failure')
          }
          return unlinkSync(path)
        },
      })).to.throw('installed temp unlink failure')
      expect(failed).to.equal(true)
      expect(readFileSync(target, 'utf8')).to.equal('old')
      expect(readdirSync(root)).to.deep.equal(['fixture.json'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('retains the old backup when rollback cannot unlink the transaction-installed target', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-rollback-unlink-fail-'))
    try {
      const first = join(root, 'first.json')
      const second = join(root, 'second.md')
      writeFileSync(first, 'first-old')
      writeFileSync(second, 'second-old')
      let thrown
      try {
        atomicWriteUtf8Batch([
          { path: first, content: 'first-new', label: 'first fixture' },
          { path: second, content: 'second-new', label: 'second fixture' },
        ], 'rollback unlink transaction', {
          linkSync(source, destination) {
            if (source.includes('.tmp-') && destination === second) throw new Error('second target link failure')
            return linkSync(source, destination)
          },
          unlinkSync(path) {
            if (path === first) throw new Error('rollback installed target unlink failure')
            return unlinkSync(path)
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(readFileSync(first, 'utf8')).to.equal('first-new')
      expect(readFileSync(second, 'utf8')).to.equal('second-old')
      const backups = readdirSync(root).filter(name => name.includes('.backup-'))
      expect(backups).to.have.length(1)
      const backupPath = join(root, backups[0])
      expect(readFileSync(backupPath, 'utf8')).to.equal('first-old')
      expect(thrown.message).to.include('rollback installed target unlink failure')
      expect(thrown.message).to.include(backupPath)
      expect(thrown.message).to.include('intentional recovery artifact retained')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports rollback backup cleanup failure and retains the intentional recovery hard link', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-rollback-backup-cleanup-'))
    try {
      const first = join(root, 'first.json')
      const second = join(root, 'second.md')
      writeFileSync(first, 'first-old')
      writeFileSync(second, 'second-old')
      let backupCleanupFailed = false
      let thrown
      try {
        atomicWriteUtf8Batch([
          { path: first, content: 'first-new', label: 'first fixture' },
          { path: second, content: 'second-new', label: 'second fixture' },
        ], 'rollback cleanup transaction', {
          linkSync(source, destination) {
            if (source.includes('.tmp-') && destination === second) throw new Error('second target link failure')
            return linkSync(source, destination)
          },
          unlinkSync(path) {
            if (!backupCleanupFailed && path.includes('first.json.backup-')) {
              backupCleanupFailed = true
              throw new Error('rollback backup unlink failure')
            }
            return unlinkSync(path)
          },
        })
      } catch (error) {
        thrown = error
      }
      expect(backupCleanupFailed).to.equal(true)
      expect(thrown).to.be.instanceOf(AggregateError)
      expect(readFileSync(first, 'utf8')).to.equal('first-old')
      expect(readFileSync(second, 'utf8')).to.equal('second-old')
      const backups = readdirSync(root).filter(name => name.includes('.backup-'))
      expect(backups).to.have.length(1)
      const backupPath = join(root, backups[0])
      expect(readFileSync(backupPath, 'utf8')).to.equal('first-old')
      expect(thrown.message).to.include('rollback backup unlink failure')
      expect(thrown.message).to.include(backupPath)
      expect(thrown.message).to.include('intentional recovery artifact retained')
      expect(readdirSync(root).filter(name => name.includes('.tmp-'))).to.deep.equal([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('commits existing and originally missing targets without temporary or backup residue', () => {
    const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-atomic-batch-ok-'))
    try {
      const first = join(root, 'first.json')
      const second = join(root, 'second.md')
      writeFileSync(first, 'first-old')
      atomicWriteUtf8Batch([
        { path: first, content: 'first-new' },
        { path: second, content: 'second-new' },
      ], 'normal fixture transaction')
      expect(readFileSync(first, 'utf8')).to.equal('first-new')
      expect(readFileSync(second, 'utf8')).to.equal('second-new')
      expect(readdirSync(root).sort()).to.deep.equal(['first.json', 'second.md'])
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

  it('audits a SHA-versioned TMX URL as the underlying public file and rejects ambiguous cache keys', () => {
    const validSpriteManifest = {
      personas: { songjiang: { personaCode: 'songjiang', src: '/juyiting/sprites/a.webp' } },
    }
    const base = {
      structure: emptyMapStructure(),
      network: [networkEntry('public/juyiting/hall.tmx'), networkEntry('public/juyiting/sprites/a.webp')],
      buildMapResources: buildHallMapResources,
      personaManifest: validSpriteManifest,
      buildSpriteResource: buildPersonaSpriteResource,
    }
    const sha = 'a'.repeat(64)
    const audit = buildRuntimeReferenceAudit({
      ...base,
      bootResources: [{ name: 'hall', type: 'tmx', src: `/juyiting/hall.tmx?v=${sha}` }],
    })
    expect(audit.files.map(entry => entry.path)).to.include('public/juyiting/hall.tmx')

    for (const src of [
      '/juyiting/hall.tmx',
      '/juyiting/hall.tmx?v=short',
      `/juyiting/hall.tmx?v=${'A'.repeat(64)}`,
      `/juyiting/hall.tmx?v=${sha}&v=${sha}`,
      `/juyiting/hall.tmx?v=${sha}&extra=1`,
      `/juyiting/hall.tmx?v=${sha}#fragment`,
    ]) {
      expect(() => buildRuntimeReferenceAudit({
        ...base,
        bootResources: [{ name: 'hall', type: 'tmx', src }],
      }), src).to.throw()
    }
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
      assetReport.juyitingNetworkAssets.runtimeCoreFiles
        .map(entry => entry.path)
        .filter(path => path !== 'public/juyiting/images/liangshan-hall-foreground-occluders-v3.webp'),
    )
    expect(audit.files.some(entry => entry.path.endsWith('/liangshan-hall-foreground-occluders-v3.webp'))).to.equal(false)
  })

  it('preserves hall-props objectalignment=topleft and TMX ellipse object shapes', () => {
    const hallProps = structure.tilesets.find(tileset => tileset.name === 'hall-props')
    expect(hallProps.objectAlignment).to.equal('topleft')
    expect(structure.groups.nav_nodes.filter(object => object.ellipse && object.shape === 'ellipse').length).to.equal(9)
    expect(structure.groups.parking_slots.filter(object => object.ellipse && object.shape === 'ellipse').length).to.equal(25)
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

  it('separates E1/E8B historical anchors from the current live TMX anchor', () => {
    const historicalSha256 = createHash('sha256').update(historicalTmxBytes).digest('hex')
    expect(inventory.tmxSha256).to.equal(E1_BASELINE_TMX_SHA256)
    expect(historicalSha256).to.equal(E1_BASELINE_TMX_SHA256)
    expect(historicalStructure.groups.mask.length).to.equal(inventory.counts.masks)
    expect(historicalStructure.groups.hotspots.filter(object => object.gid !== undefined).length).to.equal(inventory.counts.props)
    expect(propTmxManifest.tmxProvenance.currentAnchor.sha256).to.equal(E8B_LIVE_TMX_SHA256)
    expect(liveTmxSha256()).to.equal(CURRENT_LIVE_TMX_SHA256)
    expect(liveTmxSha256()).to.not.equal(propTmxManifest.tmxProvenance.currentAnchor.sha256)
    expect(liveTmxSha256()).to.not.equal(inventory.tmxSha256)
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

  describe('E8B provenance overlay', () => {
    it('materializes the complete E1 public tree from the frozen commit, not from live worktree', function () {
      this.timeout(30000)
      const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-materialize-'))
      try {
        const result = materializeE1PublicTree(join(root, 'public/juyiting'), E1_BASELINE_COMMIT)
        expect(result.baselineCommit).to.equal(E1_BASELINE_COMMIT)
        expect(result.fileCount).to.equal(27)
        expect(result.files.every(entry => /^[0-9a-f]{64}$/.test(entry.sha256))).to.equal(true)

        // Verify the materialized hall.tmx matches the E1 baseline hash, not the live hash
        const tmxEntry = result.files.find(entry => entry.path === 'public/juyiting/hall.tmx')
        expect(tmxEntry).to.not.equal(undefined)
        expect(tmxEntry.sha256).to.equal(E1_BASELINE_TMX_SHA256)
        expect(tmxEntry.sha256).to.not.equal(E8B_LIVE_TMX_SHA256)

        // Verify each materialized file content matches
        for (const entry of result.files) {
          const bytes = readFileSync(entry.targetPath)
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          expect(sha256, entry.path).to.equal(entry.sha256)
        }

        // Confirm the materialized tree path count equals the baseline
        const materializedFiles = [...result.files.map(entry => entry.path)].sort()
        const baselineAudit = assertBaselinePublicTree(join(root, 'public'), E1_BASELINE_COMMIT)
        expect(baselineAudit.fileCount).to.equal(27)
        expect(materializedFiles).to.deep.equal(baselineAudit.files.map(entry => entry.path))
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('current public tree vs E1 baseline: only hall.tmx exact replacement plus the E9B occluder overlay', () => {
      const result = assertCurrentPublicTreeVsE1('public', E1_BASELINE_COMMIT, CURRENT_LIVE_TMX_SHA256, {
        additionalDirectories: [E9B_OCCLUDER_OVERLAY_DIRECTORY],
      })
      expect(result.baselineCommit).to.equal(E1_BASELINE_COMMIT)
      expect(result.hallTmxExactReplacementOnly).to.equal(true)
      expect(result.allowedDiffs).to.have.length(1)
      expect(result.allowedDiffs[0].path).to.equal('public/juyiting/hall.tmx')
      expect(result.allowedDiffs[0].baselineSha256).to.equal(E1_BASELINE_TMX_SHA256)
      expect(result.allowedDiffs[0].currentSha256).to.equal(CURRENT_LIVE_TMX_SHA256)
      expect(result.currentTmxSha256).to.equal(CURRENT_LIVE_TMX_SHA256)
      expect(result.baselineTmxSha256).to.equal(E1_BASELINE_TMX_SHA256)
      expect(result.currentTmxSha256).to.not.equal(result.baselineTmxSha256)
      expect(result.additionalDirectories).to.deep.equal([E9B_OCCLUDER_OVERLAY_DIRECTORY])
    })

    it('E9B occluder overlay: exactly six atlas PNGs matching the E9B manifest are the only additions', () => {
      const manifest = JSON.parse(readFileSync('tests/fixtures/juyiting/occlusion-v2-atlases/atlas-manifest.json', 'utf8'))
      const overlayFiles = readdirSync(`public/${E9B_OCCLUDER_OVERLAY_DIRECTORY.slice('public/'.length)}`).sort()
      expect(overlayFiles).to.deep.equal(manifest.atlases.map(atlas => atlas.file.split('/').pop()).sort())
      for (const atlas of manifest.atlases) {
        const bytes = readFileSync(atlas.file)
        expect(createHash('sha256').update(bytes).digest('hex'), atlas.file).to.equal(atlas.sha256)
        expect(bytes.length, atlas.file).to.equal(atlas.bytes)
      }
      const result = assertCurrentPublicTreeVsE1('public', E1_BASELINE_COMMIT, CURRENT_LIVE_TMX_SHA256, {
        additionalDirectories: [E9B_OCCLUDER_OVERLAY_DIRECTORY],
      })
      expect(result.additionalDirectories).to.deep.equal([E9B_OCCLUDER_OVERLAY_DIRECTORY])
    })

    it('rejects current public tree when a non-TMX file drifts', function () {
      this.timeout(30000)
      const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-drift-'))
      try {
        // Materialize E1 tree, then mutate a non-TMX file
        materializeE1PublicTree(join(root, 'public/juyiting'), E1_BASELINE_COMMIT)
        copyFileSync(TMX_PATH, join(root, 'public/juyiting/hall.tmx'))
        const driftedPath = join(root, 'public/juyiting/images/modular/preview.html')
        appendFileSync(driftedPath, '\n<!-- injected drift -->')
        expect(() => assertCurrentPublicTreeVsE1(join(root, 'public'), E1_BASELINE_COMMIT))
          .to.throw('Unauthorised public tree drift')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('rejects current public tree when a file is deleted', function () {
      this.timeout(30000)
      const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-deleted-'))
      try {
        materializeE1PublicTree(join(root, 'public/juyiting'), E1_BASELINE_COMMIT)
        rmSync(join(root, 'public/juyiting/images/modular/preview.html'))
        expect(() => assertCurrentPublicTreeVsE1(join(root, 'public'), E1_BASELINE_COMMIT))
          .to.throw('Juyiting public tree path mismatch')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('rejects current public tree when an extra file is added', function () {
      this.timeout(30000)
      const root = mkdtempSync(join(tmpdir(), 'juyiting-e1-extra-'))
      try {
        materializeE1PublicTree(join(root, 'public/juyiting'), E1_BASELINE_COMMIT)
        writeFileSync(join(root, 'public/juyiting/extra-secret.json'), '{}')
        expect(() => assertCurrentPublicTreeVsE1(join(root, 'public'), E1_BASELINE_COMMIT))
          .to.throw('Juyiting public tree path mismatch')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('rejects an unchanged E1 tree because E8B requires exactly one hall.tmx replacement', function () {
      this.timeout(30000)
      const root = mkdtempSync(join(tmpdir(), 'juyiting-e8b-no-diff-'))
      try {
        const publicRoot = join(root, 'public')
        materializeE1PublicTree(join(publicRoot, 'juyiting'), E1_BASELINE_COMMIT)
        expect(() => assertCurrentPublicTreeVsE1(
          publicRoot,
          E1_BASELINE_COMMIT,
          E1_BASELINE_TMX_SHA256,
        )).to.throw('must contain exactly one authorised difference')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('rejects tampered hall.tmx bytes even when it is the only public-tree difference', function () {
      this.timeout(30000)
      const root = mkdtempSync(join(tmpdir(), 'juyiting-e8b-tmx-tamper-'))
      try {
        const publicRoot = join(root, 'public')
        const tmxPath = join(publicRoot, 'juyiting/hall.tmx')
        materializeE1PublicTree(join(publicRoot, 'juyiting'), E1_BASELINE_COMMIT)
        writeFileSync(tmxPath, Buffer.concat([readFileSync(TMX_PATH), Buffer.from('tampered')]))
        expect(() => assertCurrentPublicTreeVsE1(publicRoot, E1_BASELINE_COMMIT))
          .to.throw('Current hall.tmx anchor mismatch')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('rejects truncated hall.tmx even when it is the only public-tree difference', function () {
      this.timeout(30000)
      const root = mkdtempSync(join(tmpdir(), 'juyiting-e8b-tmx-truncated-'))
      try {
        const publicRoot = join(root, 'public')
        const tmxPath = join(publicRoot, 'juyiting/hall.tmx')
        materializeE1PublicTree(join(publicRoot, 'juyiting'), E1_BASELINE_COMMIT)
        const liveBytes = readFileSync(TMX_PATH)
        writeFileSync(tmxPath, liveBytes.subarray(0, liveBytes.length - 64))
        expect(() => assertCurrentPublicTreeVsE1(publicRoot, E1_BASELINE_COMMIT))
          .to.throw('Current hall.tmx anchor mismatch')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('readGitBlobAtCommit returns verified blob bytes matching baseline', () => {
      const bytes = readGitBlobAtCommit(E1_BASELINE_COMMIT, 'public/juyiting/hall.tmx')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      expect(sha256).to.equal(E1_BASELINE_TMX_SHA256)
      expect(sha256).to.not.equal(E8B_LIVE_TMX_SHA256)
    })

    it('readGitBlobAtCommit fails closed for a non-existent path', () => {
      expect(() => readGitBlobAtCommit(E1_BASELINE_COMMIT, 'public/juyiting/nonexistent.file'))
        .to.throw()
    })
  })

})

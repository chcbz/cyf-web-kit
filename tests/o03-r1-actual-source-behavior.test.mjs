import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'

const cwd = realpathSync(process.cwd())
const sha256 = value => createHash('sha256').update(value).digest('hex')
const base = Object.freeze({ head: '699a575b8e2a30faf7052ddf84687a533d0f082d', tree: '7d568c1c12ded13c75b98cfdd94006ac6c26b648' })
const auditMode = process.argv.length === 3 && process.argv[2] === '--canonical-loader-self-audit'
const sourcePins = Object.freeze({
  'src/game/camera/cameraController.ts': Object.freeze({ sourceSha256: '7e1711bc367ef32d652114c10f2cdcc56117de8613339fc486904cafd64830fd', sourceBytes: 9464 }),
  'src/game/camera/cameraTransform.ts': Object.freeze({ sourceSha256: '71d6866a4163409159459bebeadac62bc7226b2b309f1ab88bc621dc3e8ebb6d', sourceBytes: 6354 }),
  'src/game/camera/viewPresets.ts': Object.freeze({ sourceSha256: '7e6b283726ff33a951ebf190a4d3c4711a70a9cc8618561ad106238d411c238e', sourceBytes: 1519 }),
  'src/game/camera/resizePolicy.ts': Object.freeze({ sourceSha256: 'ce90021240666f91b5321135ddb1fd9d22ff40f6507a0170af876b128a677651', sourceBytes: 2132 }),
  'src/game/occlusion/sourceIdentity.ts': Object.freeze({ sourceSha256: 'a7fbae52a861642d0d76838c9579aaa23f4d18591da33df2bdb6eae46f3f2a1e', sourceBytes: 493 }),
  'src/game/viewportTransform.js': Object.freeze({ sourceSha256: '8a62359fc4617c9e0dd5c6afc08a0211700fde829760aa6c34a647456fd66169', sourceBytes: 1735 }),
  'src/game/config.js': Object.freeze({ sourceSha256: '4fb93c9021af1c59683d27ba314d8540f8ad5b356085f6a30697b5c6484be1e3', sourceBytes: 738 }),
  'src/game/JuyitingGame.js': Object.freeze({ sourceSha256: '741b89dce8d6b29750d006f143c39105f14641d339726a5c8354043b5d3c9b99', sourceBytes: 44591 }),
  'src/game/scenes/HallScene.js': Object.freeze({ sourceSha256: 'f2fc50d683400c76832c30723bd37fe58a0e644637fd2836c95971920fb24817', sourceBytes: 122160 }),
  'src/components/juyiting/HallStage.vue': Object.freeze({ sourceSha256: '29771335ed11697209bdaa1f23cd5fa3491118bd49545b323b7fed9685446652', sourceBytes: 37058 }),
  'src/components/world/JuyiHall.vue': Object.freeze({ sourceSha256: '0304e0d575377b3481db7edea274f3dc629a973215a23377a708f5c9958743a6', sourceBytes: 64513 })
})
const canonicalManifest = Object.freeze([
  Object.freeze({ path: 'src/game/camera/cameraTransform.ts', kind: 'ts-exact-erasure', ...sourcePins['src/game/camera/cameraTransform.ts'], rules: Object.freeze([
      Object.freeze({ id: "CT01", oldBytesUtf8: "export type Point = { x: number; y: number }\nexport type Viewport = { width: number; height: number }\nexport type VisibleViewport = { x: number; y: number; width: number; height: number }\nexport type CameraTransform = { zoom: number; offsetX: number; offsetY: number }\n\nexport type CameraBounds = {\n  minZoom: number\n  maxZoom: number\n  roundingTolerance?: number\n}\n\n", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CT02", oldBytesUtf8: "(value: number, fallback: number): number", newBytesUtf8: "(value, fallback)", expectedCount: 2 }),
      Object.freeze({ id: "CT03", oldBytesUtf8: "(value: number): number", newBytesUtf8: "(value)", expectedCount: 2 }),
      Object.freeze({ id: "CT04", oldBytesUtf8: "(value: number, minimum: number, maximum: number): number", newBytesUtf8: "(value, minimum, maximum)", expectedCount: 1 }),
      Object.freeze({ id: "CT05", oldBytesUtf8: "(zoom: number, minZoom: number, maxZoom: number): number", newBytesUtf8: "(zoom, minZoom, maxZoom)", expectedCount: 1 }),
      Object.freeze({ id: "CT06", oldBytesUtf8: "(point: Point, transform: CameraTransform, viewport: Viewport): Point", newBytesUtf8: "(point, transform, viewport)", expectedCount: 1 }),
      Object.freeze({ id: "CT07", oldBytesUtf8: "  world: Point,\n  screen: Point,\n  zoom: number,\n  viewport: Viewport\n): CameraTransform", newBytesUtf8: "  world,\n  screen,\n  zoom,\n  viewport\n)", expectedCount: 1 }),
      Object.freeze({ id: "CT08", oldBytesUtf8: "  transform: CameraTransform,\n  screen: Point,\n  targetZoom: number,\n  viewport: Viewport,\n  bounds: CameraBounds\n): CameraTransform", newBytesUtf8: "  transform,\n  screen,\n  targetZoom,\n  viewport,\n  bounds\n)", expectedCount: 1 }),
      Object.freeze({ id: "CT09", oldBytesUtf8: "  transform: CameraTransform,\n  oldViewport: Viewport,\n  newViewport: Viewport\n): CameraTransform", newBytesUtf8: "  transform,\n  oldViewport,\n  newViewport\n)", expectedCount: 1 }),
      Object.freeze({ id: "CT10", oldBytesUtf8: "  offset: number,\n  viewportSize: number,\n  sceneSize: number,\n  zoom: number,\n  tolerance: number,\n  visibleStart = 0,\n  visibleSize = viewportSize\n): number => {", newBytesUtf8: "  offset,\n  viewportSize,\n  sceneSize,\n  zoom,\n  tolerance,\n  visibleStart = 0,\n  visibleSize = viewportSize\n) => {", expectedCount: 1 }),
      Object.freeze({ id: "CT11", oldBytesUtf8: "const visibleViewport = (viewport: Viewport, value?: VisibleViewport): VisibleViewport =>", newBytesUtf8: "const visibleViewport = (viewport, value) =>", expectedCount: 1 }),
      Object.freeze({ id: "CT12", oldBytesUtf8: "  transform: CameraTransform,\n  viewport: Viewport,\n  scene: Viewport,\n  bounds: CameraBounds,\n  visible?: VisibleViewport\n): CameraTransform", newBytesUtf8: "  transform,\n  viewport,\n  scene,\n  bounds,\n  visible\n)", expectedCount: 1 })
    ]) }),
  Object.freeze({ path: 'src/game/camera/cameraController.ts', kind: 'ts-exact-erasure', ...sourcePins['src/game/camera/cameraController.ts'], rules: Object.freeze([
      Object.freeze({ id: "CC01", oldBytesUtf8: ",\n  type CameraBounds", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CC02", oldBytesUtf8: ",\n  type CameraTransform", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CC03", oldBytesUtf8: ",\n  type Point", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CC04", oldBytesUtf8: ",\n  type VisibleViewport", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CC05", oldBytesUtf8: ",\n  type Viewport", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CC06", oldBytesUtf8: ",\n  type ViewPresetKey", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CC07", oldBytesUtf8: "export type CameraAdapter = {\n  viewport(): Viewport\n  presetViewport?(): Viewport\n  visibleViewport?(): VisibleViewport\n  sceneSize(): Viewport\n  apply(transform: CameraTransform): void\n  requestFrame(callback: (now: number) => void): number\n  cancelFrame(id: number): void\n  now(): number\n}\n\nexport type CameraSnapshot = {\n  transform: CameraTransform\n  presetKey: ViewPresetKey\n  presetId: typeof VIEW_PRESETS[ViewPresetKey]['id']\n  animation: null | { startedAt: number; durationMs: number }\n}\n\nexport type CameraController = {\n  panBy(dx: number, dy: number): CameraTransform\n  zoomAt(point: Point, factor: number): CameraTransform\n  resize(nextViewport: Viewport, kind: 'keyboard' | 'orientation' | 'layout'): CameraTransform\n  restore(snapshot: Partial<CameraSnapshot> | null | undefined, nextViewport: Viewport): CameraTransform\n  resetTo(presetKey: ViewPresetKey, durationMs?: number): void\n  beginUserGesture(): void\n  isAwayFromPreset(): boolean\n  snapshot(): CameraSnapshot\n  cleanup(): void\n}\n\n", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "CC08", oldBytesUtf8: "(value: number, fallback: number): number", newBytesUtf8: "(value, fallback)", expectedCount: 2 }),
      Object.freeze({ id: "CC09", oldBytesUtf8: "(viewport: Viewport): Viewport", newBytesUtf8: "(viewport)", expectedCount: 1 }),
      Object.freeze({ id: "CC10", oldBytesUtf8: "(durationMs: number): number", newBytesUtf8: "(durationMs)", expectedCount: 1 }),
      Object.freeze({ id: "CC11", oldBytesUtf8: "  adapter: CameraAdapter,\n  configuredBounds: CameraBounds,", newBytesUtf8: "  adapter,\n  configuredBounds,", expectedCount: 1 }),
      Object.freeze({ id: "CC12", oldBytesUtf8: "): CameraController => {", newBytesUtf8: ") => {", expectedCount: 1 }),
      Object.freeze({ id: "CC13", oldBytesUtf8: "(): Viewport", newBytesUtf8: "()", expectedCount: 1 }),
      Object.freeze({ id: "CC14", oldBytesUtf8: "let transform: CameraTransform =", newBytesUtf8: "let transform =", expectedCount: 1 }),
      Object.freeze({ id: "CC15", oldBytesUtf8: "let animation: CameraSnapshot['animation'] = null", newBytesUtf8: "let animation = null", expectedCount: 1 }),
      Object.freeze({ id: "CC16", oldBytesUtf8: "let frameId: number | null = null", newBytesUtf8: "let frameId = null", expectedCount: 1 }),
      Object.freeze({ id: "CC17", oldBytesUtf8: "let preservedMinimum: number | null = null", newBytesUtf8: "let preservedMinimum = null", expectedCount: 1 }),
      Object.freeze({ id: "CC18", oldBytesUtf8: "): CameraBounds =>", newBytesUtf8: ") =>", expectedCount: 2 }),
      Object.freeze({ id: "CC19", oldBytesUtf8: "    candidate: CameraTransform,", newBytesUtf8: "    candidate,", expectedCount: 1 }),
      Object.freeze({ id: "CC20", oldBytesUtf8: "  ): CameraTransform =>", newBytesUtf8: "  ) =>", expectedCount: 1 }),
      Object.freeze({ id: "CC21", oldBytesUtf8: "(key: ViewPresetKey): CameraTransform", newBytesUtf8: "(key)", expectedCount: 1 }),
      Object.freeze({ id: "CC22", oldBytesUtf8: "(): void =>", newBytesUtf8: "() =>", expectedCount: 1 }),
      Object.freeze({ id: "CC23", oldBytesUtf8: "(callback: (now: number) => void): void", newBytesUtf8: "(callback)", expectedCount: 1 }),
      Object.freeze({ id: "CC24", oldBytesUtf8: "const controller: CameraController =", newBytesUtf8: "const controller =", expectedCount: 1 }),
      Object.freeze({ id: "CC25", oldBytesUtf8: "(frameNow: number): void", newBytesUtf8: "(frameNow)", expectedCount: 1 })
    ]) }),
  Object.freeze({ path: 'src/game/camera/viewPresets.ts', kind: 'ts-exact-erasure', ...sourcePins['src/game/camera/viewPresets.ts'], rules: Object.freeze([
      Object.freeze({ id: "VP01", oldBytesUtf8: " as const", newBytesUtf8: "", expectedCount: 7 }),
      Object.freeze({ id: "VP02", oldBytesUtf8: "export type ViewPresetKey = keyof typeof VIEW_PRESETS\n\n", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "VP03", oldBytesUtf8: "type PresetViewport = { width: number; height: number }\n\n", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "VP04", oldBytesUtf8: "  viewport: PresetViewport,\n  coarsePointer: boolean\n): ViewPresetKey => {", newBytesUtf8: "  viewport,\n  coarsePointer\n) => {", expectedCount: 1 })
    ]) }),
  Object.freeze({ path: 'src/game/camera/resizePolicy.ts', kind: 'ts-exact-erasure', ...sourcePins['src/game/camera/resizePolicy.ts'], rules: Object.freeze([
      Object.freeze({ id: "RP01", oldBytesUtf8: "import type { Viewport } from './cameraTransform.js'\n\n", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "RP02", oldBytesUtf8: "export type ViewportResizeKind = 'keyboard' | 'orientation' | 'layout'\n\n", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "RP03", oldBytesUtf8: "export type ViewportResize = {\n  previous: Viewport\n  next: Viewport\n  previousVisualHeight: number\n  nextVisualHeight: number\n  editableFocused: boolean\n  orientationChanged?: boolean\n}\n\n", newBytesUtf8: "", expectedCount: 1 }),
      Object.freeze({ id: "RP04", oldBytesUtf8: "(value: number): number | null", newBytesUtf8: "(value)", expectedCount: 1 }),
      Object.freeze({ id: "RP05", oldBytesUtf8: "(viewport: Viewport): 'portrait' | 'landscape' | null", newBytesUtf8: "(viewport)", expectedCount: 1 }),
      Object.freeze({ id: "RP06", oldBytesUtf8: "(resize: ViewportResize): ViewportResizeKind", newBytesUtf8: "(resize)", expectedCount: 1 })
    ]) }),
  Object.freeze({ path: 'src/game/occlusion/sourceIdentity.ts', kind: 'ts-exact-erasure', ...sourcePins['src/game/occlusion/sourceIdentity.ts'], rules: Object.freeze([
      Object.freeze({ id: "SI01", oldBytesUtf8: "export function isValidSourceEntityId(value: unknown): value is string {", newBytesUtf8: "export function isValidSourceEntityId(value) {", expectedCount: 1 })
    ]) }),
  Object.freeze({ path: 'src/game/viewportTransform.js', kind: 'js-identity', ...sourcePins['src/game/viewportTransform.js'], rules: Object.freeze([]) })
])
const manifestByPath = new Map(canonicalManifest.map(spec => [spec.path, spec]))
const requireContained = candidate => {
  const canonical = realpathSync(candidate)
  const pathFromRoot = relative(cwd, canonical)
  assert.ok(pathFromRoot && !pathFromRoot.startsWith('..') && !pathFromRoot.includes('\\') && !pathFromRoot.startsWith('/'), `worktree path escape: ${candidate}`)
  return canonical
}
const rawSource = path => {
  const canonical = requireContained(resolve(cwd, path))
  const worktreePath = relative(cwd, canonical).replaceAll('\\', '/')
  assert.ok(Object.hasOwn(sourcePins, worktreePath), `unpinned source: ${worktreePath}`)
  const bytes = readFileSync(canonical)
  const pin = sourcePins[worktreePath]
  assert.equal(bytes.length, pin.sourceBytes, `pinned source byte drift: ${worktreePath}`)
  assert.equal(sha256(bytes), pin.sourceSha256, `pinned source SHA drift: ${worktreePath}`)
  return Object.freeze({ path: worktreePath, canonical, bytes })
}
const countBytes = (bytes, needle) => {
  assert.ok(needle.length > 0, 'empty replacement literal is forbidden')
  let count = 0; let offset = 0
  while ((offset = bytes.indexOf(needle, offset)) !== -1) { count += 1; offset += needle.length }
  return count
}
const replaceBytes = (bytes, oldBytes, newBytes) => Buffer.concat(bytes.toString('utf8').split(oldBytes.toString('utf8')).flatMap((part, index, parts) => index === parts.length - 1 ? [Buffer.from(part, 'utf8')] : [Buffer.from(part, 'utf8'), newBytes]))
const generateCanonicalModule = (spec, raw) => {
  assert.ok(Buffer.isBuffer(raw.bytes), `raw source must be a Buffer: ${spec.path}`)
  assert.equal(raw.bytes.length, spec.sourceBytes, `source bytes drift: ${spec.path}`)
  assert.equal(sha256(raw.bytes), spec.sourceSha256, `source SHA drift: ${spec.path}`)
  const decoded = raw.bytes.toString('utf8')
  assert.ok(Buffer.from(decoded, 'utf8').equals(raw.bytes), `non-UTF-8 source rejected: ${spec.path}`)
  assert.ok(!decoded.startsWith('\ufeff') && !decoded.includes('\r'), `BOM/CRLF source rejected: ${spec.path}`)
  let runtimeBytes = raw.bytes
  const trace = []
  if (spec.kind === 'js-identity') {
    assert.equal(spec.rules.length, 0, `identity rules forbidden: ${spec.path}`)
  } else {
    for (const rule of spec.rules) {
      const oldBytes = Buffer.from(rule.oldBytesUtf8, 'utf8'); const newBytes = Buffer.from(rule.newBytesUtf8, 'utf8')
      const observedCount = countBytes(runtimeBytes, oldBytes)
      assert.equal(observedCount, rule.expectedCount, `exact literal count changed: ${spec.path}:${rule.id}`)
      const inputBytes = runtimeBytes.length
      runtimeBytes = replaceBytes(runtimeBytes, oldBytes, newBytes)
      trace.push(Object.freeze({ id: rule.id, observedCount, inputBytes, outputBytes: runtimeBytes.length }))
    }
  }
  return Object.freeze({ path: spec.path, kind: spec.kind, sourceSha256: sha256(raw.bytes), sourceBytes: raw.bytes.length, runtimeBytes, runtimeByteLength: runtimeBytes.length, runtimeSha256: sha256(runtimeBytes), trace: Object.freeze(trace) })
}
const canonicalEntries = new Map()
const expectedCwd = '/home/isp/wsps/cyf/.worktrees/o01-juyiting-experience-mode'
assert.equal(cwd, expectedCwd, 'O03 must execute from its pinned worktree')
const donor = Object.freeze({
  root: '/home/isp/wsps/cyf/.worktrees/pwa-integration-web-rc',
  packageSha256: '9e19076731a6c649cee75e8368470c8d0ba21ca13ed41c3735598d3a7af0b8a1',
  lockSha256: '0b73dab31d80a337585c5b8cb6e1de0dbc9183fc717aef1b3b9de92de244927e',
  hiddenLockSha256: '6b8b3fff1e5238a8ca4f02c4819ec1b972c2945c04534a446de0cf3d02bdc68e',
  compilerPackageSha256: 'c510ab7f31f544b0247f082fde3c616e27e7d493b391e22cc5552d20be98be19',
  compilerBundleSha256: '1403634ad2e29389506b9b52e5d4ad7ba3c24be06d731a2fa13620836a1e3e90', compilerBundleBytes: 1668790,
  vuePackageSha256: '4860702ba0ca40f38fea0ceb765d497e638b90f720b60863b18698414ce558a5',
  vueBundleSha256: 'a674a5acecc3113ab07e244e73cbbf2ef719c5cfe4f6837359e4d1e7f8fe6364', vueBundleBytes: 367063,
  hallStageScriptSha256: '1dbfae919adffee942ab56482f0aa55236bbe9622412703ce3cc6aa8a6088c85', hallStageScriptBytes: 26484
})
const DYNAMIC_MELON_IMPORT_CONTRACT = Object.freeze({
  importer: resolve(cwd, 'src/game/JuyitingGame.js'),
  specifier: 'melonjs',
  maxHostTurns: 8
})
const facadeCounters = {
  vueTemplateCreateCalls: 0,
  vueFormatterPushCalls: 0,
  vueHmrRuntimeSets: 0,
  vueInstanceSetterPushes: 0,
  vueSsrSetterPushes: 0,
  vueRendererFlagSets: 0,
  forbiddenDomCalls: 0,
  forbiddenGlobalWrites: 0,
  insertStaticContentCalls: 0,
  dynamicMelonImports: 0,
  dynamicImportWaiters: 0,
  dynamicImportWatchdogs: 0
}
const frozenConsoleEvents = []
const facadeConsole = Object.freeze(Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => { frozenConsoleEvents.push(Object.freeze({ level, args: Object.freeze(args.map(String)) })) }])))
const createClosureRegistry = counter => {
  let value
  const registry = {}
  Object.defineProperties(registry, {
    0: { enumerable: true, get: () => value },
    length: { enumerable: true, get: () => value === undefined ? 0 : 1 }
  })
  Object.defineProperties(registry, {
    push: { value: item => {
      assert.equal(value, undefined, `${counter} duplicate registration`)
      assert.equal(typeof item, 'function', `${counter} requires a function`)
      value = item
      facadeCounters[counter] += 1
      return 1
    } },
    forEach: { value: callback => {
      assert.equal(typeof callback, 'function')
      if (value !== undefined) callback(value, 0, registry)
    } }
  })
  return Object.freeze(registry)
}
const createScheduler = () => {
  const allowedDelays = new Set([0, 16, 200, 1200, 1800, 2200, 3000, 3600, 5200, 15000])
  const records = new Map()
  let nextId = 1
  const schedule = (kind, callback, delay = 0) => {
    assert.equal(typeof callback, 'function', `${kind} callback must be a function`)
    const normalizedDelay = Number(delay) || 0
    assert.ok(allowedDelays.has(normalizedDelay), `unreviewed ${kind} delay: ${normalizedDelay}`)
    if (kind === 'interval') assert.equal(normalizedDelay, 5200, 'only the JuyiHall bubble interval is reviewed')
    const id = nextId++
    records.set(id, { id, kind, callback, delay: normalizedDelay, state: 'pending', fires: 0 })
    return id
  }
  const clear = (kind, id) => {
    const record = records.get(id)
    if (!record) return
    assert.equal(record.kind, kind, `${kind} clear kind mismatch`)
    if (record.state === 'pending') record.state = 'cancelled'
  }
  const setTimeoutFacade = Object.freeze((callback, delay) => schedule('timeout', callback, delay))
  const clearTimeoutFacade = Object.freeze(id => clear('timeout', id))
  const setIntervalFacade = Object.freeze((callback, delay) => schedule('interval', callback, delay))
  const clearIntervalFacade = Object.freeze(id => clear('interval', id))
  const pending = (kind, delay) => [...records.values()].filter(record => record.state === 'pending' && (!kind || record.kind === kind) && (delay === undefined || record.delay === delay))
  const fire = id => {
    const record = records.get(id)
    assert.ok(record, `unknown scheduler handle: ${id}`)
    assert.equal(record.state, 'pending', `scheduler handle is not pending: ${id}`)
    record.fires += 1
    if (record.kind === 'timeout') record.state = 'fired'
    record.callback()
  }
  const capture = id => {
    const record = records.get(id)
    assert.ok(record, `unknown scheduler capture: ${id}`)
    return Object.freeze({ id, callback: record.callback })
  }
  const control = Object.freeze({
    fire,
    fireCaptured: token => { assert.ok(Object.isFrozen(token)); token.callback() },
    capture,
    pendingIds: (kind, delay) => Object.freeze(pending(kind, delay).map(record => record.id)),
    latestPending: (kind, delay) => pending(kind, delay).at(-1)?.id ?? null,
    fireAll: (kind, delay, limit = 100) => {
      let count = 0
      while (pending(kind, delay).length) {
        assert.ok(count < limit, `scheduler fire limit exceeded for ${kind}:${delay}`)
        fire(pending(kind, delay)[0].id)
        count += 1
      }
      return count
    }
  })
  const audit = Object.freeze({
    get pendingTimers() { return pending().length },
    get records() { return Object.freeze([...records.values()].map(({ callback, ...record }) => Object.freeze({ ...record }))) }
  })
  return Object.freeze({ setTimeoutFacade, clearTimeoutFacade, setIntervalFacade, clearIntervalFacade, control, audit })
}
const scheduler = createScheduler()
const dynamicMelonImportGate = (() => {
  let observedCount = 0
  let nextWaiterId = 0
  const waiters = []
  const history = []
  const snapshot = waiter => Object.freeze({ id: waiter.id, label: waiter.label, expectedCount: waiter.expectedCount, observedCount: waiter.observedCount, state: waiter.state, hostTurns: waiter.hostTurns, importer: waiter.importer, specifier: waiter.specifier })
  const clearWatchdog = waiter => {
    if (waiter.watchdogHandle === null) return
    clearImmediate(waiter.watchdogHandle)
    waiter.watchdogHandle = null
    facadeCounters.dynamicImportWatchdogs -= 1
  }
  const armWatchdog = waiter => {
    facadeCounters.dynamicImportWatchdogs += 1
    waiter.watchdogHandle = setImmediate(() => {
      waiter.watchdogHandle = null
      facadeCounters.dynamicImportWatchdogs -= 1
      if (waiter.state !== 'WAITING') return
      waiter.hostTurns += 1
      if (waiter.hostTurns >= DYNAMIC_MELON_IMPORT_CONTRACT.maxHostTurns) {
        waiter.state = 'WATCHDOG_FAILED'
        facadeCounters.dynamicImportWaiters -= 1
        const error = new Error(`dynamic melon import watchdog failed: expected=${waiter.expectedCount} observed=${observedCount} importer=${DYNAMIC_MELON_IMPORT_CONTRACT.importer} specifier=${DYNAMIC_MELON_IMPORT_CONTRACT.specifier}`)
        waiter.reject(error)
        return
      }
      armWatchdog(waiter)
    })
  }
  const expectNext = label => {
    assert.equal(typeof label, 'string')
    assert.ok(!waiters.some(waiter => waiter.state === 'WAITING'), 'overlapping dynamic melon import waiters are forbidden')
    const expectedCount = observedCount + 1
    let resolveWaiter
    let rejectWaiter
    const promise = new Promise((resolvePromise, rejectPromise) => { resolveWaiter = resolvePromise; rejectWaiter = rejectPromise })
    promise.catch(() => {})
    const waiter = { id: ++nextWaiterId, label, expectedCount, observedCount, state: 'WAITING', hostTurns: 0, importer: DYNAMIC_MELON_IMPORT_CONTRACT.importer, specifier: DYNAMIC_MELON_IMPORT_CONTRACT.specifier, watchdogHandle: null, resolve: resolveWaiter, reject: rejectWaiter, promise }
    waiters.push(waiter)
    history.push(waiter)
    facadeCounters.dynamicImportWaiters += 1
    armWatchdog(waiter)
    const handle = {}
    Object.defineProperties(handle, {
      expectedCount: { enumerable: true, value: expectedCount },
      status: { enumerable: true, get: () => waiter.state },
      wait: { enumerable: true, value: async () => { await promise; return snapshot(waiter) } },
      snapshot: { enumerable: true, value: () => snapshot(waiter) }
    })
    return Object.freeze(handle)
  }
  const hookEntered = ({ importer, specifier, count }) => {
    assert.equal(importer, DYNAMIC_MELON_IMPORT_CONTRACT.importer, `dynamic importer gate rejected: ${importer}`)
    assert.equal(specifier, DYNAMIC_MELON_IMPORT_CONTRACT.specifier, `dynamic specifier gate rejected: ${specifier}`)
    assert.equal(count, observedCount + 1, 'dynamic melon import count must be monotonic')
    observedCount = count
    const matching = waiters.filter(waiter => waiter.state === 'WAITING' && waiter.expectedCount <= observedCount)
    assert.equal(matching.length, 1, `dynamic melon import entry has no exact waiter: ${count}`)
    for (const waiter of matching) {
      waiter.state = 'HOOK_ENTERED'
      waiter.observedCount = observedCount
      clearWatchdog(waiter)
      waiter.state = 'RELEASED'
      facadeCounters.dynamicImportWaiters -= 1
      waiter.resolve(snapshot(waiter))
    }
  }
  const audit = Object.freeze({
    get observedCount() { return observedCount },
    get pendingWaiters() { return facadeCounters.dynamicImportWaiters },
    get pendingWatchdogs() { return facadeCounters.dynamicImportWatchdogs },
    get history() { return Object.freeze(history.map(snapshot)) }
  })
  return Object.freeze({ expectNext, hookEntered, audit })
})()
const createListenerRegistry = (label, allowedTypes) => {
  const entries = []
  const add = Object.freeze((type, listener, options) => {
    assert.ok(allowedTypes.has(type), `unreviewed ${label} listener: ${type}`)
    assert.equal(typeof listener, 'function', `${label}:${type} listener must be a function`)
    assert.ok(!entries.some(entry => entry.state === 'registered' && entry.type === type && entry.listener === listener && entry.options === options), `duplicate ${label}:${type} listener`)
    entries.push({ type, listener, options, state: 'registered' })
  })
  const remove = Object.freeze((type, listener, options) => {
    const entry = entries.find(item => item.state === 'registered' && item.type === type && item.listener === listener && item.options === options)
    assert.ok(entry, `missing ${label}:${type} listener removal`)
    entry.state = 'removed'
  })
  const control = Object.freeze({
    dispatch: (type, event = Object.freeze({})) => {
      for (const entry of entries.filter(item => item.state === 'registered' && item.type === type).slice()) entry.listener(event)
    },
    capture: (type, index = 0) => {
      const matches = entries.filter(entry => entry.state === 'registered' && entry.type === type)
      assert.ok(matches[index], `missing ${label}:${type} capture`)
      return Object.freeze({ listener: matches[index].listener })
    },
    fireCaptured: (token, event = Object.freeze({})) => token.listener(event)
  })
  const audit = Object.freeze({ get active() { return entries.filter(entry => entry.state === 'registered').length }, get entries() { return Object.freeze(entries.map(({ listener, ...entry }) => Object.freeze({ ...entry }))) } })
  return Object.freeze({ add, remove, control, audit })
}
const windowListenerRegistry = createListenerRegistry('window', new Set(['resize']))
const visualViewportListenerRegistry = createListenerRegistry('visualViewport', new Set(['resize']))
const canvasListenerRegistry = createListenerRegistry('canvas', new Set(['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']))
const resizeObserverRecords = []
let resizeObserverOrdinal = 0
const resizeObserverSnapshot = record => Object.freeze({ ordinal: record.ordinal, target: record.target, state: record.state, triggers: record.triggers, disconnects: record.disconnects })
class ResizeObserverFacade {
  constructor(callback) {
    assert.equal(typeof callback, 'function', 'ResizeObserver callback must be a function')
    this._record = { ordinal: ++resizeObserverOrdinal, callback, target: null, state: 'new', triggers: 0, disconnects: 0 }
    resizeObserverRecords.push(this._record)
  }
  observe(target) {
    assert.equal(this._record.state, 'new', 'ResizeObserver may observe once')
    assert.ok(target, 'ResizeObserver target required')
    this._record.target = target
    this._record.state = 'observing'
  }
  disconnect() {
    if (this._record.state === 'disconnected') return
    this._record.state = 'disconnected'
    this._record.disconnects += 1
  }
}
Object.freeze(ResizeObserverFacade.prototype)
Object.freeze(ResizeObserverFacade)
const resizeObserverControl = Object.freeze({
  triggerLatest: target => {
    const record = resizeObserverRecords.filter(item => item.state === 'observing' && (!target || item.target === target)).at(-1)
    assert.ok(record, 'no active ResizeObserver to trigger')
    record.triggers += 1
    record.callback(Object.freeze([]), Object.freeze({}))
    return resizeObserverSnapshot(record)
  },
  triggerOrdinal: ordinal => {
    const records = resizeObserverRecords.filter(item => item.ordinal === ordinal)
    assert.equal(records.length, 1, `ResizeObserver ordinal cardinality: ${ordinal}`)
    const [record] = records
    assert.equal(record.state, 'observing', `ResizeObserver ordinal must be observing: ${ordinal}`)
    record.triggers += 1
    record.callback(Object.freeze([]), Object.freeze({}))
    return resizeObserverSnapshot(record)
  },
  triggerAll: target => {
    const records = resizeObserverRecords.filter(item => item.state === 'observing' && (!target || item.target === target))
    for (const record of records) { record.triggers += 1; record.callback(Object.freeze([]), Object.freeze({})) }
    return records.length
  },
  activeFor: target => resizeObserverRecords.filter(item => item.state === 'observing' && (!target || item.target === target)).length,
  snapshotsFor: target => Object.freeze(resizeObserverRecords.filter(item => !target || item.target === target).map(resizeObserverSnapshot)),
  snapshot: ordinal => { const record = resizeObserverRecords.find(item => item.ordinal === ordinal); assert.ok(record, `unknown ResizeObserver ordinal: ${ordinal}`); return resizeObserverSnapshot(record) },
  get latestOrdinal() { return resizeObserverOrdinal }
})
const documentStyleWrites = []
let activeElement = null
const documentStyle = Object.freeze({ setProperty(name, value) {
  assert.equal(name, '--hall-visual-height', 'unreviewed document CSS property')
  assert.match(value, /^\d+(?:\.\d+)?px$/, 'invalid hall visual height')
  documentStyleWrites.push(Object.freeze([name, value]))
} })
const templateSentinel = Object.freeze({ kind: 'vue-template-sentinel' })
const documentFacade = Object.freeze({
  get activeElement() { return activeElement },
  documentElement: Object.freeze({ style: documentStyle }),
  createElement(tag) {
    if (tag === 'template' && facadeCounters.vueTemplateCreateCalls === 0) {
      facadeCounters.vueTemplateCreateCalls += 1
      return templateSentinel
    }
    facadeCounters.forbiddenDomCalls += 1
    throw new Error(`UNTRACED_DOCUMENT_CREATE_ELEMENT:${tag}`)
  },
  querySelector(selector) {
    facadeCounters.forbiddenDomCalls += 1
    throw new Error(`UNTRACED_DOCUMENT_QUERY_SELECTOR:${selector}`)
  }
})
let viewportWidth = 390
let viewportHeight = 844
let visualViewportHeight = 844
const formatterValues = []
const formatterRegistry = {}
Object.defineProperties(formatterRegistry, {
  0: { enumerable: true, get: () => formatterValues[0] },
  length: { enumerable: true, get: () => formatterValues.length },
  push: { value: formatter => {
    assert.equal(formatterValues.length, 0, 'Vue formatter appended more than once')
    assert.equal(formatter?.__vue_custom_formatter, true)
    formatterValues.push(formatter)
    facadeCounters.vueFormatterPushCalls += 1
    return formatterValues.length
  } }
})
Object.freeze(formatterRegistry)
const browserFacade = {}
Object.defineProperties(browserFacade, {
  innerWidth: { enumerable: true, get: () => viewportWidth },
  innerHeight: { enumerable: true, get: () => viewportHeight },
  location: { enumerable: true, value: Object.freeze({ search: '' }) },
  visualViewport: { enumerable: true, value: Object.freeze({ get height() { return visualViewportHeight }, addEventListener: visualViewportListenerRegistry.add, removeEventListener: visualViewportListenerRegistry.remove }) },
  ResizeObserver: { enumerable: true, value: ResizeObserverFacade },
  setTimeout: { enumerable: true, value: scheduler.setTimeoutFacade },
  clearTimeout: { enumerable: true, value: scheduler.clearTimeoutFacade },
  setInterval: { enumerable: true, value: scheduler.setIntervalFacade },
  clearInterval: { enumerable: true, value: scheduler.clearIntervalFacade },
  addEventListener: { enumerable: true, value: windowListenerRegistry.add },
  removeEventListener: { enumerable: true, value: windowListenerRegistry.remove },
  requestAnimationFrame: { enumerable: true, value: undefined },
  cancelAnimationFrame: { enumerable: true, value: undefined },
  performance: { enumerable: true, value: undefined },
  HTMLElement: { enumerable: true, value: undefined },
  ShadowRoot: { enumerable: true, value: undefined },
  navigator: { enumerable: true, value: undefined },
  trustedTypes: { enumerable: true, value: undefined },
  __JYT_V2_ENABLED: { enumerable: true, value: false },
  __JYT_OCCLUSION_SHADOW_ENABLED: { enumerable: true, value: false },
  devtoolsFormatters: { enumerable: true, get: () => formatterRegistry }
})
Object.freeze(browserFacade)
class AbortControllerFacade {
  constructor() {
    let aborted = false
    this.signal = Object.freeze({ get aborted() { return aborted } })
    this.abort = Object.freeze(() => { aborted = true })
    Object.freeze(this)
  }
}
Object.freeze(AbortControllerFacade.prototype)
Object.freeze(AbortControllerFacade)
const cryptoFacade = Object.freeze({ subtle: Object.freeze({ async digest(algorithm, data) {
  assert.equal(algorithm, 'SHA-256')
  assert.ok(ArrayBuffer.isView(data), 'SHA input must be an ArrayBuffer view')
  const bytes = createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest()
  return Uint8Array.from(bytes).buffer
} }) })
const instanceSetters = createClosureRegistry('vueInstanceSetterPushes')
const ssrSetters = createClosureRegistry('vueSsrSetterPushes')
let hmrRuntime
let vueRendererFlag = false
const donorSeed = {
  console: facadeConsole,
  Error,
  URLSearchParams,
  TextEncoder,
  AbortController: AbortControllerFacade,
  crypto: cryptoFacade,
  queueMicrotask,
  setTimeout: scheduler.setTimeoutFacade,
  clearTimeout: scheduler.clearTimeoutFacade,
  setInterval: scheduler.setIntervalFacade,
  clearInterval: scheduler.clearIntervalFacade,
  ResizeObserver: ResizeObserverFacade,
  fetch: Object.freeze(async (...args) => { throw new Error(`UNREVIEWED_FETCH:${args.length}`) }),
  window: browserFacade,
  document: documentFacade,
  globalThis: null
}
Object.defineProperties(donorSeed, {
  __VUE_HMR_RUNTIME__: {
    enumerable: true,
    get: () => hmrRuntime,
    set: value => {
      if (hmrRuntime !== undefined) { facadeCounters.forbiddenGlobalWrites += 1; throw new Error('duplicate __VUE_HMR_RUNTIME__ set') }
      assert.deepEqual(Object.keys(value).sort(), ['createRecord', 'reload', 'rerender'])
      for (const key of Object.keys(value)) assert.equal(typeof value[key], 'function')
      hmrRuntime = value
      facadeCounters.vueHmrRuntimeSets += 1
    }
  },
  __VUE_INSTANCE_SETTERS__: { enumerable: true, value: instanceSetters },
  __VUE_SSR_SETTERS__: { enumerable: true, value: ssrSetters },
  __VUE__: {
    enumerable: true,
    get: () => vueRendererFlag,
    set: value => {
      if (value !== true || vueRendererFlag) { facadeCounters.forbiddenGlobalWrites += 1; throw new Error('invalid __VUE__ set') }
      vueRendererFlag = true
      facadeCounters.vueRendererFlagSets += 1
    }
  },
  __VUE_DEVTOOLS_GLOBAL_HOOK__: { enumerable: true, get: () => undefined }
})
donorSeed.globalThis = donorSeed
Object.freeze(donorSeed)
const donorContext = vm.createContext(donorSeed)
const context = donorContext
const facadeControl = Object.freeze({
  scheduler: scheduler.control,
  resizeObservers: resizeObserverControl,
  windowListeners: windowListenerRegistry.control,
  visualViewportListeners: visualViewportListenerRegistry.control,
  canvasListeners: canvasListenerRegistry.control,
  setViewport(width, height, visualHeight = height) {
    assert.ok(Number(width) > 0 && Number(height) > 0 && Number(visualHeight) > 0)
    viewportWidth = Number(width); viewportHeight = Number(height); visualViewportHeight = Number(visualHeight)
  },
  setActiveElement(value) { activeElement = value }
})
const facadeAudit = Object.freeze({
  get counters() { return Object.freeze({ ...facadeCounters }) },
  get pendingTimers() { return scheduler.audit.pendingTimers },
  get windowListeners() { return windowListenerRegistry.audit.active },
  get visualViewportListeners() { return visualViewportListenerRegistry.audit.active },
  get canvasListeners() { return canvasListenerRegistry.audit.active },
  get activeResizeObservers() { return resizeObserverRecords.filter(record => record.state === 'observing').length },
  get documentStyleWrites() { return Object.freeze(documentStyleWrites.slice()) },
  get consoleEvents() { return Object.freeze(frozenConsoleEvents.slice()) }
})
const checkedFile = (path, expectedSha256, expectedBytes) => {
  const canonical = realpathSync(path)
  assert.equal(canonical, path, `symlinked donor path rejected: ${path}`)
  const bytes = readFileSync(canonical)
  if (expectedBytes !== undefined) assert.equal(bytes.length, expectedBytes, `donor byte drift: ${path}`)
  assert.equal(sha256(bytes), expectedSha256, `donor SHA drift: ${path}`)
  return Object.freeze({ canonical, bytes })
}
const exactJson = (root, name, expected) => checkedFile(resolve(root, name), expected)
const nodeKinds = new WeakMap()
const nodeParents = new WeakMap()
const nodeChildren = new WeakMap()
const nodeText = new WeakMap()
const nodeProps = new WeakMap()
const nodeScopes = new WeakMap()
const nodeFixtureIds = new WeakMap()
const nodeCreateRecords = new WeakMap()
const rootConfigs = new WeakMap()
const allRoots = []
const HOST_FIXTURE_KINDS = Object.freeze({ HALL_STAGE: 'HALL_STAGE', SURFACE: 'SURFACE', JUYI_SCRIPT: 'JUYI_SCRIPT' })
const HOST_FIXTURE_STATES = Object.freeze({ OPEN: 'OPEN', MOUNTING: 'MOUNTING', MOUNTED: 'MOUNTED', UPDATING: 'UPDATING', UNMOUNTING: 'UNMOUNTING', CLOSED_AND_AUDITED: 'CLOSED_AND_AUDITED' })
const allowedHostTags = Object.freeze(['section', 'div', 'h1', 'button', 'span', 'strong', 'var-icon'])
const allowedHostProps = Object.freeze(['class', 'title', 'disabled', 'tabindex', 'aria-label', 'aria-hidden', 'role', 'type', 'name', 'onClick', 'onKeydown', 'onWheel', 'onPointerup', 'onPointercancel'])
const HALL_SCOPE_ID = 'data-v-o03-hall-stage'
const freezeSignature = signature => Object.freeze({
  ...signature,
  classAll: Object.freeze([...(signature.classAll || [])]),
  exact: Object.freeze({ ...(signature.exact || {}) }),
  oneOf: Object.freeze(Object.fromEntries(Object.entries(signature.oneOf || {}).map(([key, values]) => [key, Object.freeze([...values])]))),
  types: Object.freeze({ ...(signature.types || {}) })
})
const HALL_INITIAL_CREATE_SEQUENCE = Object.freeze([
  freezeSignature({ context: 'hall:section', type: 'section', classAll: ['hall-stage'] }),
  freezeSignature({ context: 'hall:stage-header', type: 'div', classAll: ['stage-header'] }),
  freezeSignature({ context: 'hall:stage-heading', type: 'div', classAll: ['stage-heading'] }),
  freezeSignature({ context: 'hall:eyebrow', type: 'div', classAll: ['eyebrow'], textTarget: true }),
  freezeSignature({ context: 'hall:title', type: 'h1', propsKind: 'null', textTarget: true }),
  freezeSignature({ context: 'hall:stage-tools', type: 'div', classAll: ['stage-tools'] }),
  freezeSignature({ context: 'hall:refresh-button', type: 'button', classAll: ['tool-action', 'refresh-action'], types: { disabled: 'boolean', onClick: 'function' } }),
  freezeSignature({ context: 'hall:refresh-icon', type: 'var-icon', exact: { name: 'refresh' } }),
  freezeSignature({ context: 'hall:refresh-label', type: 'span', classAll: ['tool-label'], textTarget: true }),
  freezeSignature({ context: 'hall:sound-button', type: 'button', classAll: ['tool-action', 'sound-toggle'], types: { onClick: 'function' } }),
  freezeSignature({ context: 'hall:sound-icon', type: 'var-icon', oneOf: { name: ['bell', 'bell-outline'] } }),
  freezeSignature({ context: 'hall:sound-label', type: 'span', classAll: ['tool-label'], textTarget: true }),
  freezeSignature({ context: 'hall:onboarding-replay', type: 'button', classAll: ['tool-action', 'onboarding-replay'], exact: { title: '重看新手引导' }, types: { disabled: 'boolean', onClick: 'function' } }),
  freezeSignature({ context: 'hall:onboarding-label', type: 'span', classAll: ['tool-label'], textTarget: true }),
  freezeSignature({ context: 'hall:orientation-button', type: 'button', classAll: ['tool-action', 'orientation-action'], types: { disabled: 'boolean', onClick: 'function' } }),
  freezeSignature({ context: 'hall:orientation-glyph', type: 'span', classAll: ['orientation-glyph'], exact: { 'aria-hidden': 'true' } }),
  freezeSignature({ context: 'hall:orientation-label', type: 'span', classAll: ['tool-label'], textTarget: true }),
  freezeSignature({ context: 'hall:board', type: 'div', classAll: ['hall-board'], exact: { tabindex: '0' }, types: { onKeydown: 'function', onWheel: 'function', onPointerup: 'function', onPointercancel: 'function' } }),
  freezeSignature({ context: 'hall:melon-layer', type: 'div', classAll: ['melon-layer'], exact: { 'aria-hidden': 'true' } })
])
const HALL_TAIL_CREATE_TOKENS = Object.freeze({
  LOADING: Object.freeze([
    freezeSignature({ context: 'hall:loading', type: 'div', classAll: ['scene-loading'], exact: { role: 'status' } }),
    freezeSignature({ context: 'hall:loading-spinner', type: 'span', classAll: ['scene-spinner'], exact: { 'aria-hidden': 'true' } }),
    freezeSignature({ context: 'hall:loading-text', type: 'span', propsKind: 'null', textTarget: true })
  ]),
  ERROR: Object.freeze([
    freezeSignature({ context: 'hall:error', type: 'div', classAll: ['scene-error'], exact: { role: 'status' } }),
    freezeSignature({ context: 'hall:error-title', type: 'strong', propsKind: 'null', textTarget: true }),
    freezeSignature({ context: 'hall:error-message', type: 'span', propsKind: 'null', textTarget: true }),
    freezeSignature({ context: 'hall:error-retry', type: 'button', exact: { type: 'button' }, types: { disabled: 'boolean', onClick: 'function' }, textTarget: true })
  ]),
  RETURN: Object.freeze([
    freezeSignature({ context: 'hall:return-button', type: 'button', classAll: ['return-main-hall'], exact: { type: 'button', 'aria-label': '回主厅', title: '回主厅' }, types: { onClick: 'function' } }),
    freezeSignature({ context: 'hall:return-icon', type: 'span', exact: { 'aria-hidden': 'true' }, textTarget: true })
  ]),
  ORIENTATION: Object.freeze([
    freezeSignature({ context: 'hall:orientation-hint', type: 'div', classAll: ['orientation-hint'], exact: { role: 'status' }, textTarget: true })
  ])
})
const SURFACE_CREATE_SIGNATURE = freezeSignature({ context: 'surface:melon-layer', type: 'div', classAll: ['melon-layer'], exact: { 'aria-hidden': 'true' } })
const HOST_CREATE_CONTRACT = Object.freeze({ hallInitial: HALL_INITIAL_CREATE_SEQUENCE, hallTail: HALL_TAIL_CREATE_TOKENS, surface: SURFACE_CREATE_SIGNATURE })
const SELECTOR_FIXTURE_DELTAS = Object.freeze(Object.fromEntries(Object.entries({
  'successful ready cancels the terminal timeout before async finalization': { HALL_STAGE: 1, SURFACE: 0, JUYI_SCRIPT: 0 },
  'portrait producer preserves exact latest cancel and once semantics with explicit task agent': { HALL_STAGE: 0, SURFACE: 0, JUYI_SCRIPT: 1 },
  'zero geometry cannot settle and positive observed geometry requires two stable fallback frames': { HALL_STAGE: 2, SURFACE: 0, JUYI_SCRIPT: 0 },
  'actual near-edge restore applies source backing display and visible truth before one target commit': { HALL_STAGE: 0, SURFACE: 1, JUYI_SCRIPT: 0 },
  'actual commitViewport rejects once and HallStage performs fatal cleanup': { HALL_STAGE: 1, SURFACE: 0, JUYI_SCRIPT: 0 },
  'destroy cancels actual pending commit waiter without rejection or leaked frame': { HALL_STAGE: 0, SURFACE: 1, JUYI_SCRIPT: 0 },
  'delayed optional persona availability rearms only the latest exhausted target for one ACK': { HALL_STAGE: 1, SURFACE: 0, JUYI_SCRIPT: 0 },
  'hotspot focus is immediate while stale target and lifecycle callbacks are fenced': { HALL_STAGE: 1, SURFACE: 0, JUYI_SCRIPT: 0 },
  'shared map generation is monotonic across two complete HallStage instances without weakening local fences': { HALL_STAGE: 2, SURFACE: 0, JUYI_SCRIPT: 0 }
}).map(([name, delta]) => [name, Object.freeze(delta)])))
const hostCounters = {
  hostContractViolations: 0,
  hostFixturesOpened: 0,
  hostFixturesClosed: 0,
  hostFixtureCounts: { HALL_STAGE: 0, SURFACE: 0, JUYI_SCRIPT: 0 },
  hostCreateElementCalls: 0,
  hostNamespaceUndefinedCalls: 0,
  hostNamespaceNullCalls: 0,
  hostNamespaceStringCalls: 0,
  hostNamespaceOtherCalls: 0,
  hostIsNullCalls: 0,
  hostIsUndefinedCalls: 0,
  hostIsOtherCalls: 0,
  hallInitialPrefixPasses: 0,
  surfaceSignaturePasses: 0,
  juyiZeroElementPasses: 0,
  detachedRemoveNoops: 0,
  unreachableSetTextCalls: 0,
  duplicateScopeIdCalls: 0,
  unknownNodeCalls: 0,
  invalidAnchorCalls: 0,
  propsUndefinedCreateCalls: 0,
  patchPropNextUndefinedCalls: 0
}
const completedHostFixtureCounts = { HALL_STAGE: 0, SURFACE: 0, JUYI_SCRIPT: 0 }
const completedHostFixtures = []
let activeHostFixture = null
let hostFixtureId = 0
let canvasAttachPermit = null
const hostViolation = message => { hostCounters.hostContractViolations += 1; assert.fail(message) }
const hostRequire = (condition, message) => { if (!condition) hostViolation(message) }
const hostStrictEqual = (actual, expected, message) => { if (actual !== expected) hostViolation(`${message}: ${String(actual)} !== ${String(expected)}`) }
const requireActiveHostFixture = () => { if (!activeHostFixture) hostViolation('host call outside active fixture'); return activeHostFixture }
const recordHostCall = (fixture, method, details = {}) => {
  hostStrictEqual(fixture, activeHostFixture, `${method} fixture context`)
  const record = Object.freeze({ fixtureId: fixture.id, kind: fixture.kind, ordinal: ++fixture.hostOrdinal, phase: fixture.state, method, ...details })
  fixture.hostCalls.push(record)
  return record
}
const requireKnownNode = (node, label = 'node') => {
  if (!nodeKinds.has(node)) { hostCounters.unknownNodeCalls += 1; hostViolation(`unknown host ${label}`) }
  return nodeKinds.get(node)
}
const requireFixtureNode = (node, fixture, label = 'node') => {
  requireKnownNode(node, label)
  hostStrictEqual(nodeFixtureIds.get(node), fixture.id, `${label} belongs to another fixture`)
}
const validateAttachedNode = node => {
  const parent = nodeParents.get(node)
  if (parent === null) return null
  requireKnownNode(parent, 'parent')
  const children = nodeChildren.get(parent)
  hostRequire(Array.isArray(children), 'attached parent has no child ledger')
  const occurrences = children.reduce((count, child) => count + Number(child === node), 0)
  hostStrictEqual(occurrences, 1, 'attached node must occur exactly once in parent')
  return parent
}
const detachNode = node => {
  requireKnownNode(node)
  const parent = validateAttachedNode(node)
  if (parent === null) return false
  const children = nodeChildren.get(parent)
  children.splice(children.indexOf(node), 1)
  nodeParents.set(node, null)
  return true
}
const rootFor = node => {
  requireKnownNode(node)
  const seen = new Set()
  let current = node
  while (nodeKinds.get(current) !== 'root') {
    hostRequire(!seen.has(current), 'host parent cycle')
    seen.add(current)
    current = nodeParents.get(current)
    if (current === null) return null
    requireKnownNode(current, 'ancestor')
  }
  return current
}
const configFor = node => { const root = rootFor(node); return root === null ? null : rootConfigs.get(root) || null }
const completeRect = value => {
  const left = Number(value?.left ?? value?.x ?? 0)
  const top = Number(value?.top ?? value?.y ?? 0)
  const width = Number(value?.width ?? 0)
  const height = Number(value?.height ?? 0)
  return Object.freeze({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height })
}
const createRootHandle = config => {
  const root = {}
  Object.defineProperties(root, {
    _vnode: { writable: true, configurable: true, value: null },
    __vue_app__: { writable: true, configurable: true, value: undefined }
  })
  nodeKinds.set(root, 'root'); nodeChildren.set(root, []); nodeParents.set(root, null); rootConfigs.set(root, config); allRoots.push(root)
  return root
}
const registerFixtureNode = (node, fixture, createRecord = null) => {
  hostRequire(!nodeFixtureIds.has(node), 'host node registered twice')
  nodeFixtureIds.set(node, fixture.id)
  if (createRecord) nodeCreateRecords.set(node, createRecord)
  fixture.nodes.push(node)
}
const createElementHandle = (type, createRecord) => {
  const fixture = requireActiveHostFixture()
  const element = {}
  Object.defineProperty(element, '__v_skip', { value: true })
  Object.defineProperties(element, {
    __vnode: { writable: true, configurable: true, value: null },
    __vueParentComponent: { writable: true, configurable: true, value: null },
    getBoundingClientRect: { value: () => {
      const props = nodeProps.get(element)
      if (!String(props?.class || '').split(/\s+/).includes('melon-layer')) return completeRect({})
      const config = configFor(element)
      assert.ok(config, 'melon-layer has no root config')
      return config.getContainerRect()
    } },
    querySelector: { value: selector => {
      assert.equal(selector, 'canvas', 'unreviewed melon-layer selector')
      return nodeChildren.get(element).find(child => nodeKinds.get(child) === 'canvas') || null
    } }
  })
  nodeKinds.set(element, 'element'); nodeParents.set(element, null); nodeChildren.set(element, []); nodeText.set(element, ''); nodeProps.set(element, Object.create(null)); nodeScopes.set(element, [])
  Object.defineProperty(element, 'type', { enumerable: false, value: type })
  registerFixtureNode(element, fixture, createRecord); fixture.elements.push(element)
  return element
}
const createLeafHandle = (kind, text) => {
  const fixture = requireActiveHostFixture()
  const leaf = {}
  Object.defineProperties(leaf, {
    __vnode: { writable: true, configurable: true, value: null },
    __vueParentComponent: { writable: true, configurable: true, value: null }
  })
  nodeKinds.set(leaf, kind); nodeParents.set(leaf, null); nodeText.set(leaf, text)
  registerFixtureNode(leaf, fixture)
  return leaf
}
const classTokens = props => new Set(String(props?.class || '').split(/\s+/).filter(Boolean))
const signatureMatches = (signature, type, props) => {
  if (signature.type !== type) return false
  if (signature.propsKind === 'null') return props === null
  if (!props || typeof props !== 'object') return false
  const tokens = classTokens(props)
  if (!signature.classAll.every(token => tokens.has(token))) return false
  for (const [key, expected] of Object.entries(signature.exact)) if (props[key] !== expected) return false
  for (const [key, values] of Object.entries(signature.oneOf)) if (!values.includes(props[key])) return false
  for (const [key, expectedType] of Object.entries(signature.types)) if (typeof props[key] !== expectedType) return false
  return true
}
const consumeCreateSignature = (fixture, type, props) => {
  if (fixture.kind === HOST_FIXTURE_KINDS.JUYI_SCRIPT) hostViolation('JuyiHall script fixture created an element')
  if (fixture.kind === HOST_FIXTURE_KINDS.SURFACE) {
    hostStrictEqual(fixture.createRecords.length, 0, 'surface fixture created more than one element')
    hostRequire(signatureMatches(SURFACE_CREATE_SIGNATURE, type, props), 'surface element signature drift')
    return SURFACE_CREATE_SIGNATURE
  }
  if (fixture.initialIndex < HALL_INITIAL_CREATE_SEQUENCE.length) {
    const signature = HALL_INITIAL_CREATE_SEQUENCE[fixture.initialIndex]
    hostRequire(signatureMatches(signature, type, props), `HallStage initial create drift at ordinal ${fixture.initialIndex + 1}`)
    fixture.initialIndex += 1
    if (fixture.initialIndex === HALL_INITIAL_CREATE_SEQUENCE.length) hostCounters.hallInitialPrefixPasses += 1
    return signature
  }
  let tokenName = fixture.tailToken
  let tokenIndex = fixture.tailIndex
  if (tokenName === null) {
    tokenName = Object.keys(HALL_TAIL_CREATE_TOKENS).find(name => signatureMatches(HALL_TAIL_CREATE_TOKENS[name][0], type, props)) || null
    hostRequire(tokenName !== null, `unreviewed HallStage tail element: ${type}`)
    tokenIndex = 0
  }
  const signature = HALL_TAIL_CREATE_TOKENS[tokenName][tokenIndex]
  hostRequire(signatureMatches(signature, type, props), `HallStage ${tokenName} token drift at index ${tokenIndex}`)
  tokenIndex += 1
  if (tokenIndex === HALL_TAIL_CREATE_TOKENS[tokenName].length) { fixture.tailToken = null; fixture.tailIndex = 0; fixture.tailCounts[tokenName] += 1 }
  else { fixture.tailToken = tokenName; fixture.tailIndex = tokenIndex }
  return signature
}
const snapshotHostCounters = () => Object.freeze({ ...hostCounters, hostFixtureCounts: Object.freeze({ ...hostCounters.hostFixtureCounts }) })
const snapshotCompletedHostCounts = () => Object.freeze({ ...completedHostFixtureCounts })
const hostAudit = Object.freeze({
  get counters() { return snapshotHostCounters() },
  get activeFixture() { return activeHostFixture ? Object.freeze({ id: activeHostFixture.id, kind: activeHostFixture.kind, state: activeHostFixture.state }) : null },
  get completedCounts() { return snapshotCompletedHostCounts() },
  get completedFixtures() { return Object.freeze(completedHostFixtures.slice()) },
  get contractFrozen() {
    return Object.isFrozen(HOST_FIXTURE_KINDS) && Object.isFrozen(HOST_FIXTURE_STATES) && Object.isFrozen(allowedHostTags) && Object.isFrozen(allowedHostProps) && Object.isFrozen(HOST_CREATE_CONTRACT) && Object.isFrozen(HALL_INITIAL_CREATE_SEQUENCE) && HALL_INITIAL_CREATE_SEQUENCE.every(Object.isFrozen) && Object.values(HALL_TAIL_CREATE_TOKENS).every(token => Object.isFrozen(token) && token.every(Object.isFrozen)) && Object.isFrozen(SELECTOR_FIXTURE_DELTAS) && Object.values(SELECTOR_FIXTURE_DELTAS).every(Object.isFrozen)
  }
})
const hostOps = Object.freeze({
  createElement(type, namespace, is, props) {
    hostStrictEqual(arguments.length, 4, 'createElement argument cardinality')
    const fixture = requireActiveHostFixture()
    hostCounters.hostCreateElementCalls += 1
    if (namespace === undefined) hostCounters.hostNamespaceUndefinedCalls += 1
    else if (namespace === null) hostCounters.hostNamespaceNullCalls += 1
    else if (typeof namespace === 'string') hostCounters.hostNamespaceStringCalls += 1
    else hostCounters.hostNamespaceOtherCalls += 1
    if (is === undefined) hostCounters.hostIsUndefinedCalls += 1
    else if (is === null) hostCounters.hostIsNullCalls += 1
    else hostCounters.hostIsOtherCalls += 1
    if (props === undefined) hostCounters.propsUndefinedCreateCalls += 1
    hostRequire(allowedHostTags.includes(type), `unreviewed host tag: ${type}`)
    hostStrictEqual(namespace, undefined, `namespace must be undefined for ${type}`)
    if (props === null) hostStrictEqual(is, null, `props-null ${type} must receive is=null`)
    else {
      hostRequire(props !== undefined && typeof props === 'object', `props-object contract rejected for ${type}`)
      hostRequire(!Object.hasOwn(props, 'is'), `customized built-in is prop rejected for ${type}`)
      hostStrictEqual(is, undefined, `props-object ${type} must receive is=undefined`)
    }
    const signature = consumeCreateSignature(fixture, type, props)
    const call = recordHostCall(fixture, 'createElement', { tag: type, context: signature.context, namespaceType: typeof namespace, isType: is === null ? 'null' : typeof is, propsNull: props === null })
    const record = Object.freeze({ fixtureId: fixture.id, kind: fixture.kind, ordinal: fixture.createRecords.length + 1, hostOrdinal: call.ordinal, phase: fixture.state, tag: type, context: signature.context, namespaceType: typeof namespace, namespace, isType: is === null ? 'null' : typeof is, is, propsNull: props === null, textTarget: signature.textTarget === true })
    fixture.createRecords.push(record)
    return createElementHandle(type, record)
  },
  createText(text) {
    hostStrictEqual(arguments.length, 1, 'createText argument cardinality')
    const fixture = requireActiveHostFixture()
    hostStrictEqual(fixture.kind, HOST_FIXTURE_KINDS.HALL_STAGE, 'createText fixture kind')
    hostStrictEqual(text, '', 'HallStage Fragment anchor text')
    const call = recordHostCall(fixture, 'createText', { textEmpty: true })
    fixture.textCalls.push(Object.freeze({ ordinal: call.ordinal, phase: fixture.state, text }))
    return createLeafHandle('text', text)
  },
  createComment(text) {
    hostStrictEqual(arguments.length, 1, 'createComment argument cardinality')
    const fixture = requireActiveHostFixture()
    hostStrictEqual(typeof text, 'string', 'createComment text type')
    if (fixture.kind === HOST_FIXTURE_KINDS.HALL_STAGE) hostStrictEqual(text, 'v-if', 'HallStage comment contract')
    else if (fixture.kind === HOST_FIXTURE_KINDS.JUYI_SCRIPT) hostStrictEqual(text, '', 'JuyiHall comment contract')
    else hostViolation('surface fixture created a comment')
    const call = recordHostCall(fixture, 'createComment', { textKind: text === '' ? 'empty' : 'v-if' })
    fixture.commentCalls.push(Object.freeze({ ordinal: call.ordinal, phase: fixture.state, text }))
    return createLeafHandle('comment', text)
  },
  insert(child, parent, anchor) {
    hostStrictEqual(arguments.length, 3, 'insert argument cardinality')
    const fixture = requireActiveHostFixture()
    const childKind = requireKnownNode(child, 'insert child')
    const parentKind = requireKnownNode(parent, 'insert parent')
    hostRequire(['element', 'text', 'comment', 'canvas'].includes(childKind), 'invalid host child')
    hostRequire(['root', 'element'].includes(parentKind), 'invalid host parent')
    requireFixtureNode(child, fixture, 'insert child'); requireFixtureNode(parent, fixture, 'insert parent')
    hostRequire(child !== parent, 'host node cannot parent itself')
    let ancestor = parent
    while (ancestor !== null) { requireKnownNode(ancestor, 'insert ancestor'); hostRequire(ancestor !== child, 'host insertion cycle'); const nextAncestor = nodeParents.get(ancestor); hostRequire(nextAncestor !== undefined, 'insert ancestor parent state'); ancestor = nextAncestor }
    if (anchor === undefined) { hostCounters.invalidAnchorCalls += 1; hostViolation('undefined host anchor rejected') }
    if (anchor !== null) {
      requireFixtureNode(anchor, fixture, 'insert anchor')
      hostRequire(anchor !== child, 'self anchor rejected')
      const anchorChildren = nodeChildren.get(parent)
      if (!Array.isArray(anchorChildren) || anchorChildren.indexOf(anchor) < 0) { hostCounters.invalidAnchorCalls += 1; hostViolation('host anchor is not a current child') }
    }
    const oldParent = validateAttachedNode(child)
    if (childKind === 'canvas') {
      hostRequire(canvasAttachPermit?.canvas === child && canvasAttachPermit?.container === parent, 'canvas insert bypassed hostControl.attachCanvas')
      hostStrictEqual(anchor, null, 'canvas anchor')
      hostStrictEqual(nodeCreateRecords.get(parent)?.context, fixture.kind === HOST_FIXTURE_KINDS.SURFACE ? 'surface:melon-layer' : 'hall:melon-layer', 'canvas parent context')
    }
    recordHostCall(fixture, 'insert', { childKind, parentKind, anchorNull: anchor === null, reparent: oldParent !== null })
    detachNode(child)
    const children = nodeChildren.get(parent)
    const index = anchor === null ? children.length : children.indexOf(anchor)
    hostRequire(index >= 0, 'validated anchor disappeared before insertion')
    children.splice(index, 0, child)
    nodeParents.set(child, parent)
  },
  remove(child) {
    hostStrictEqual(arguments.length, 1, 'remove argument cardinality')
    const fixture = requireActiveHostFixture()
    requireFixtureNode(child, fixture, 'remove child')
    hostRequire(nodeKinds.get(child) !== 'root', 'root removal rejected')
    const attached = validateAttachedNode(child) !== null
    recordHostCall(fixture, 'remove', { childKind: nodeKinds.get(child), attached })
    if (!detachNode(child)) hostCounters.detachedRemoveNoops += 1
  },
  parentNode(node) {
    hostStrictEqual(arguments.length, 1, 'parentNode argument cardinality')
    const fixture = requireActiveHostFixture(); requireFixtureNode(node, fixture, 'parentNode node')
    const parent = validateAttachedNode(node)
    recordHostCall(fixture, 'parentNode', { nodeKind: nodeKinds.get(node), detached: parent === null })
    return parent
  },
  nextSibling(node) {
    hostStrictEqual(arguments.length, 1, 'nextSibling argument cardinality')
    const fixture = requireActiveHostFixture(); requireFixtureNode(node, fixture, 'nextSibling node')
    const parent = validateAttachedNode(node)
    if (parent === null) { recordHostCall(fixture, 'nextSibling', { nodeKind: nodeKinds.get(node), detached: true, hasNext: false }); return null }
    const children = nodeChildren.get(parent); const index = children.indexOf(node); const next = children[index + 1] ?? null
    recordHostCall(fixture, 'nextSibling', { nodeKind: nodeKinds.get(node), detached: false, hasNext: next !== null })
    return next
  },
  setText(node, text) {
    hostStrictEqual(arguments.length, 2, 'setText argument cardinality')
    const fixture = requireActiveHostFixture(); requireFixtureNode(node, fixture, 'setText node')
    recordHostCall(fixture, 'setText', { nodeKind: nodeKinds.get(node), textType: typeof text })
    hostCounters.unreachableSetTextCalls += 1
    hostViolation(`UNREACHABLE_SET_TEXT:${typeof text}`)
  },
  setElementText(node, text) {
    hostStrictEqual(arguments.length, 2, 'setElementText argument cardinality')
    const fixture = requireActiveHostFixture(); requireFixtureNode(node, fixture, 'setElementText node')
    hostStrictEqual(nodeKinds.get(node), 'element', 'setElementText node kind')
    hostStrictEqual(typeof text, 'string', 'setElementText text type')
    const createRecord = nodeCreateRecords.get(node)
    hostRequire(createRecord?.textTarget === true, `unreviewed text target: ${node.type}`)
    const children = nodeChildren.get(node)
    for (const child of children) validateAttachedNode(child)
    const previous = nodeText.get(node); const clearedChildren = children.length > 0
    const call = recordHostCall(fixture, 'setElementText', { tag: node.type, context: createRecord.context, clearedChildren })
    for (const child of children.slice()) detachNode(child)
    fixture.elementTextCalls.push(Object.freeze({ ordinal: call.ordinal, tag: node.type, context: createRecord.context, previous, next: text, clearedChildren }))
    nodeText.set(node, text)
  },
  patchProp(node, key, previous, next, namespace, parentComponent) {
    hostRequire(arguments.length === 5 || arguments.length === 6, 'patchProp argument cardinality')
    const fixture = requireActiveHostFixture(); requireFixtureNode(node, fixture, 'patchProp node')
    hostStrictEqual(nodeKinds.get(node), 'element', 'patchProp node kind')
    hostRequire(allowedHostProps.includes(key), `unreviewed host prop: ${key}`)
    hostStrictEqual(namespace, undefined, `patchProp namespace for ${key}`)
    if (arguments.length === 5) hostStrictEqual(parentComponent, undefined, 'five-argument patchProp parentComponent')
    else hostRequire(parentComponent !== null && typeof parentComponent === 'object', 'six-argument patchProp component instance')
    if (next === undefined) { hostCounters.patchPropNextUndefinedCalls += 1; hostViolation(`patchProp next undefined rejected: ${key}`) }
    const props = nodeProps.get(node)
    const present = Object.hasOwn(props, key)
    if (!present) hostStrictEqual(previous, null, `mount/add previous for ${key}`)
    else if (!(key === 'class' && previous === null)) hostStrictEqual(previous, props[key], `stored previous for ${key}`)
    if (next === null) hostRequire(present, `removal of absent host prop: ${key}`)
    else if (key === 'class') hostRequire(typeof next === 'string' && next.length > 0, 'class value contract')
    else if (key === 'title') hostRequire(['点验厅中动静', '歇下声响', '开起声响', '请求横屏全景', '回主厅'].includes(next), `title value contract: ${next}`)
    else if (key === 'disabled') hostStrictEqual(typeof next, 'boolean', 'disabled value type')
    else if (key === 'tabindex') hostStrictEqual(next, '0', 'tabindex value')
    else if (key === 'aria-label') hostRequire(['聚义厅 melonJS 场景，可使用加减号缩放，0 复位', '回主厅'].includes(next), `aria-label value contract: ${next}`)
    else if (key === 'aria-hidden') hostStrictEqual(next, 'true', 'aria-hidden value')
    else if (key === 'role') hostStrictEqual(next, 'status', 'role value')
    else if (key === 'type') hostStrictEqual(next, 'button', 'type value')
    else if (key === 'name') {
      hostStrictEqual(node.type, 'var-icon', 'name is reviewed only for the compiled var-icon fallback')
      hostRequire(['refresh', 'bell', 'bell-outline'].includes(next), `unreviewed var-icon name: ${next}`)
    } else hostStrictEqual(typeof next, 'function', `${key} event value type`)
    recordHostCall(fixture, 'patchProp', { tag: node.type, context: nodeCreateRecords.get(node)?.context, key, operation: next === null ? 'remove' : present ? 'update' : 'mount-or-add', argumentCount: arguments.length })
    if (next === null) delete props[key]
    else props[key] = next
  },
  setScopeId(node, id) {
    hostStrictEqual(arguments.length, 2, 'setScopeId argument cardinality')
    const fixture = requireActiveHostFixture(); requireFixtureNode(node, fixture, 'setScopeId node')
    hostStrictEqual(fixture.kind, HOST_FIXTURE_KINDS.HALL_STAGE, 'setScopeId fixture kind')
    hostStrictEqual(nodeKinds.get(node), 'element', 'setScopeId node kind')
    hostStrictEqual(id, HALL_SCOPE_ID, 'unexpected HallStage scope id')
    const scopes = nodeScopes.get(node)
    if (scopes.includes(id)) { hostCounters.duplicateScopeIdCalls += 1; hostViolation(`duplicate HallStage scope id on ${node.type}`) }
    recordHostCall(fixture, 'setScopeId', { tag: node.type, context: nodeCreateRecords.get(node)?.context, id })
    scopes.push(id); fixture.scopeCalls += 1
  },
  insertStaticContent(content, parent, anchor, namespace, start, end) {
    const fixture = requireActiveHostFixture(); recordHostCall(fixture, 'insertStaticContent', { argumentCount: arguments.length })
    facadeCounters.insertStaticContentCalls += 1
    hostViolation(`UNREACHABLE_STATIC_CONTENT:${arguments.length}:${typeof content}:${typeof parent}:${typeof anchor}:${typeof namespace}:${typeof start}:${typeof end}`)
  }
})
const createCanvasHandle = config => {
  let displayRect = completeRect(config.getInitialCanvasRect())
  const styleValues = Object.create(null)
  const style = {}
  const exactStyle = {
    background: 'transparent', position: 'absolute', left: '50%', top: '50%', transformOrigin: 'center center', transform: 'translate(-50%, -50%)'
  }
  for (const key of Object.keys(exactStyle)) Object.defineProperty(style, key, {
    enumerable: true,
    get: () => styleValues[key] ?? '',
    set: value => { assert.equal(value, exactStyle[key], `unexpected canvas style ${key}`); styleValues[key] = value; config.trace.canvasWrites.push(Object.freeze([key, value])) }
  })
  Object.defineProperty(style, 'setProperty', { value: (name, value) => {
    assert.ok(['--juyiting-canvas-display-width', '--juyiting-canvas-display-height'].includes(name), `unreviewed canvas CSS property: ${name}`)
    assert.match(value, /^\d+(?:\.\d+)?px$/)
    const numeric = Number.parseFloat(value)
    const container = config.getContainerRect()
    const width = name === '--juyiting-canvas-display-width' ? numeric : displayRect.width
    const height = name === '--juyiting-canvas-display-height' ? numeric : displayRect.height
    const left = container.left + (container.width - width) / 2
    const top = container.top + (container.height - height) / 2
    displayRect = completeRect({ left, top, width, height })
    config.trace.canvasWrites.push(Object.freeze([name, value]))
  } })
  Object.freeze(style)
  const canvas = {}
  Object.defineProperties(canvas, {
    width: { enumerable: true, value: 1664 },
    height: { enumerable: true, value: 928 },
    style: { enumerable: true, value: style },
    parentElement: { enumerable: true, get: () => nodeParents.get(canvas) ?? null },
    getBoundingClientRect: { value: () => displayRect },
    closest: { value: selector => { assert.equal(selector, '.melon-layer'); return nodeParents.get(canvas) ?? null } },
    addEventListener: { value: canvasListenerRegistry.add },
    removeEventListener: { value: canvasListenerRegistry.remove },
    setPointerCapture: { value: id => { assert.ok(Number.isFinite(Number(id))); config.trace.pointerCaptures.push(Object.freeze(['set', Number(id)])) } },
    releasePointerCapture: { value: id => { assert.ok(Number.isFinite(Number(id))); config.trace.pointerCaptures.push(Object.freeze(['release', Number(id)])) } },
    remove: { value: () => { if (detachNode(canvas)) config.trace.canvasRemoves += 1 } }
  })
  nodeKinds.set(canvas, 'canvas'); nodeParents.set(canvas, null); nodeChildren.set(canvas, [])
  return canvas
}
const auditHostFixtureStructure = fixture => {
  for (const node of fixture.nodes) {
    requireFixtureNode(node, fixture, 'fixture audit node')
    const parent = nodeParents.get(node)
    if (parent !== null) {
      requireFixtureNode(parent, fixture, 'fixture audit parent')
      const siblings = nodeChildren.get(parent)
      hostRequire(Array.isArray(siblings), 'fixture audit parent has no children')
      hostStrictEqual(siblings.filter(child => child === node).length, 1, 'fixture audit child multiplicity')
    }
    if (nodeChildren.has(node)) {
      const children = nodeChildren.get(node)
      hostStrictEqual(new Set(children).size, children.length, 'fixture audit duplicate children')
      for (const child of children) {
        requireFixtureNode(child, fixture, 'fixture audit child')
        hostStrictEqual(nodeParents.get(child), node, 'fixture audit parent/child mismatch')
      }
    }
  }
}
const auditClosedHostFixture = fixture => {
  hostStrictEqual(nodeChildren.get(fixture.root).length, 0, 'closed fixture root must be empty')
  auditHostFixtureStructure(fixture)
  hostStrictEqual(fixture.hostCalls.length, fixture.hostOrdinal, 'host call ledger cardinality')
  fixture.hostCalls.forEach((call, index) => { hostStrictEqual(call.ordinal, index + 1, 'host call ordinal'); hostStrictEqual(call.fixtureId, fixture.id, 'host call fixture id'); hostStrictEqual(call.kind, fixture.kind, 'host call fixture kind') })
  if (fixture.kind === HOST_FIXTURE_KINDS.HALL_STAGE) {
    hostStrictEqual(fixture.initialIndex, HALL_INITIAL_CREATE_SEQUENCE.length, 'HallStage initial create prefix length')
    hostStrictEqual(fixture.tailToken, null, 'HallStage tail token must be complete')
    hostStrictEqual(fixture.tailIndex, 0, 'HallStage tail index must reset')
    hostStrictEqual(fixture.textCalls.length, 2, 'HallStage Fragment anchor count')
    hostRequire(fixture.textCalls.every(call => call.text === ''), 'HallStage Fragment anchor drift')
    hostRequire(fixture.commentCalls.every(call => call.text === 'v-if'), 'HallStage comment drift')
    hostStrictEqual(fixture.scopeCalls, fixture.createRecords.length, 'HallStage scope/create cardinality')
    hostStrictEqual(fixture.elements.length, fixture.createRecords.length, 'HallStage element/create cardinality')
    for (const element of fixture.elements) hostRequire(nodeScopes.get(element).length === 1 && nodeScopes.get(element)[0] === HALL_SCOPE_ID, `HallStage scope drift on ${element.type}`)
    hostRequire(fixture.createRecords.every(record => record.namespace === undefined && ((record.propsNull && record.is === null) || (!record.propsNull && record.is === undefined))), 'HallStage sentinel tuple drift')
  } else if (fixture.kind === HOST_FIXTURE_KINDS.SURFACE) {
    hostStrictEqual(fixture.createRecords.length, 1, 'surface createElement count')
    hostStrictEqual(fixture.createRecords[0].context, SURFACE_CREATE_SIGNATURE.context, 'surface createElement context')
    hostStrictEqual(fixture.textCalls.length, 0, 'surface text count')
    hostStrictEqual(fixture.commentCalls.length, 0, 'surface comment count')
    hostStrictEqual(fixture.scopeCalls, 0, 'surface scope count')
    hostCounters.surfaceSignaturePasses += 1
  } else {
    hostStrictEqual(fixture.createRecords.length, 0, 'JuyiHall createElement count')
    hostStrictEqual(fixture.textCalls.length, 0, 'JuyiHall text count')
    hostStrictEqual(fixture.commentCalls.length, 1, 'JuyiHall comment count')
    hostStrictEqual(fixture.commentCalls[0].text, '', 'JuyiHall comment text')
    hostStrictEqual(fixture.scopeCalls, 0, 'JuyiHall scope count')
    hostCounters.juyiZeroElementPasses += 1
  }
}
const hostControl = Object.freeze({
  createRoot: createRootHandle,
  openFixture(kind, root) {
    hostStrictEqual(arguments.length, 2, 'openFixture argument cardinality')
    hostRequire(activeHostFixture === null, 'nested host fixture rejected')
    hostRequire(Object.values(HOST_FIXTURE_KINDS).includes(kind), `unknown host fixture kind: ${kind}`)
    hostStrictEqual(requireKnownNode(root, 'fixture root'), 'root', 'fixture root kind')
    hostRequire(!nodeFixtureIds.has(root), 'fixture root reused')
    hostStrictEqual(nodeChildren.get(root).length, 0, 'fixture root must start empty')
    const fixture = {
      id: ++hostFixtureId, kind, root, state: HOST_FIXTURE_STATES.OPEN, initialIndex: 0, tailToken: null, tailIndex: 0,
      tailCounts: { LOADING: 0, ERROR: 0, RETURN: 0, ORIENTATION: 0 }, hostOrdinal: 0, hostCalls: [], createRecords: [], textCalls: [], commentCalls: [], elementTextCalls: [], nodes: [], elements: [], scopeCalls: 0
    }
    activeHostFixture = fixture
    registerFixtureNode(root, fixture)
    fixture.state = HOST_FIXTURE_STATES.MOUNTING
    hostCounters.hostFixturesOpened += 1; hostCounters.hostFixtureCounts[kind] += 1
  },
  markMounted(root) {
    hostStrictEqual(arguments.length, 1, 'markMounted argument cardinality')
    const fixture = requireActiveHostFixture(); hostStrictEqual(fixture.root, root, 'mounted root'); hostStrictEqual(fixture.state, HOST_FIXTURE_STATES.MOUNTING, 'mount lifecycle state')
    fixture.state = HOST_FIXTURE_STATES.MOUNTED
  },
  beginUpdate(root) {
    hostStrictEqual(arguments.length, 1, 'beginUpdate argument cardinality')
    const fixture = requireActiveHostFixture(); hostStrictEqual(fixture.root, root, 'update root'); hostStrictEqual(fixture.state, HOST_FIXTURE_STATES.MOUNTED, 'update lifecycle state')
    fixture.state = HOST_FIXTURE_STATES.UPDATING
  },
  endUpdate(root) {
    hostStrictEqual(arguments.length, 1, 'endUpdate argument cardinality')
    const fixture = requireActiveHostFixture(); hostStrictEqual(fixture.root, root, 'updated root'); hostStrictEqual(fixture.state, HOST_FIXTURE_STATES.UPDATING, 'updated lifecycle state')
    fixture.state = HOST_FIXTURE_STATES.MOUNTED
  },
  beginUnmount(root) {
    hostStrictEqual(arguments.length, 1, 'beginUnmount argument cardinality')
    const fixture = requireActiveHostFixture(); hostStrictEqual(fixture.root, root, 'unmount root'); hostStrictEqual(fixture.state, HOST_FIXTURE_STATES.MOUNTED, 'unmount lifecycle state')
    fixture.state = HOST_FIXTURE_STATES.UNMOUNTING
  },
  closeFixture(root) {
    hostStrictEqual(arguments.length, 1, 'closeFixture argument cardinality')
    const fixture = requireActiveHostFixture(); hostStrictEqual(fixture.root, root, 'closed root'); hostStrictEqual(fixture.state, HOST_FIXTURE_STATES.UNMOUNTING, 'close lifecycle state')
    auditClosedHostFixture(fixture)
    fixture.state = HOST_FIXTURE_STATES.CLOSED_AND_AUDITED
    const summary = Object.freeze({ id: fixture.id, kind: fixture.kind, hostCalls: fixture.hostCalls.length, createElementCalls: fixture.createRecords.length, textCalls: fixture.textCalls.length, commentCalls: fixture.commentCalls.length, scopeCalls: fixture.scopeCalls, tailCounts: Object.freeze({ ...fixture.tailCounts }) })
    completedHostFixtures.push(summary); completedHostFixtureCounts[fixture.kind] += 1; hostCounters.hostFixturesClosed += 1
    activeHostFixture = null
  },
  findMelon(root) {
    const fixture = requireActiveHostFixture(); requireFixtureNode(root, fixture, 'findMelon root')
    const queue = [...nodeChildren.get(root)]
    while (queue.length) {
      const node = queue.shift()
      if (nodeKinds.get(node) === 'element' && String(nodeProps.get(node)?.class || '').split(/\s+/).includes('melon-layer')) return node
      if (nodeChildren.has(node)) queue.push(...nodeChildren.get(node))
    }
    return null
  },
  attachCanvas(container, canvas) {
    hostStrictEqual(arguments.length, 2, 'attachCanvas argument cardinality')
    const fixture = requireActiveHostFixture(); requireFixtureNode(container, fixture, 'canvas container')
    hostStrictEqual(requireKnownNode(canvas, 'canvas'), 'canvas', 'canvas node kind')
    hostRequire(!nodeFixtureIds.has(canvas), 'canvas already belongs to a fixture')
    hostRequire(!nodeChildren.get(container).some(child => nodeKinds.get(child) === 'canvas'), 'duplicate fixture canvas')
    registerFixtureNode(canvas, fixture)
    hostRequire(canvasAttachPermit === null, 'nested canvas attach permit')
    canvasAttachPermit = Object.freeze({ container, canvas })
    try { hostOps.insert(canvas, container, null) } finally { canvasAttachPermit = null }
  },
  rootEmpty(root) { hostStrictEqual(requireKnownNode(root, 'rootEmpty root'), 'root', 'rootEmpty node kind'); return nodeChildren.get(root).length === 0 },
  rootChildren(root) { hostStrictEqual(requireKnownNode(root, 'rootChildren root'), 'root', 'rootChildren node kind'); return Object.freeze(nodeChildren.get(root).slice()) }
})
let activeRuntimeConfig = null
const meControl = Object.freeze({
  configure(config) { activeRuntimeConfig = config },
  current() { assert.ok(activeRuntimeConfig, 'runtime fixture not configured'); return activeRuntimeConfig }
})
class StageFacade { update() {} }
class RenderableFacade {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.pos = { x: Number(x) || 0, y: Number(y) || 0 }
    this.width = Number(width) || 0
    this.height = Number(height) || 0
    this.depth = 0
    this.anchorPoint = Object.freeze({ set: (xValue, yValue) => { this.anchorX = xValue; this.anchorY = yValue } })
  }
}
const meFacade = Object.freeze({
  Stage: StageFacade,
  Renderable: RenderableFacade,
  video: Object.freeze({
    CANVAS: Object.freeze({ kind: 'canvas-renderer-token' }),
    init(width, height, options) {
      assert.equal(width, 1664); assert.equal(height, 928)
      assert.equal(options?.parent, meControl.current().container)
      assert.equal(options?.scaleTarget, options.parent)
      assert.equal(options?.renderer, meFacade.video.CANVAS)
      assert.equal(options?.scaleMethod, 'fit')
      const canvas = createCanvasHandle(meControl.current())
      hostControl.attachCanvas(options.parent, canvas)
      meControl.current().control.setCurrentCanvas(canvas)
      meControl.current().trace.videoInit += 1
      return true
    },
    getCanvas: () => meControl.current().currentCanvas,
    renderer: Object.freeze({ getCanvas: () => meControl.current().currentCanvas }),
    destroy() { meControl.current().trace.videoDestroy += 1 }
  }),
  loader: Object.freeze({
    getTMX(name) { assert.equal(name, 'juyiting-main-map'); return '<map id="o03-minimal" />' },
    load(...args) { throw new Error(`UNREVIEWED_LOADER_LOAD:${args.length}`) },
    getImage(...args) { throw new Error(`UNREVIEWED_LOADER_GET_IMAGE:${args.length}`) }
  }),
  state: Object.freeze({
    USER: 100, PLAY: 100,
    set(id, scene) { assert.ok(Number.isFinite(id)); meControl.current().stateScenes.set(id, scene); meControl.current().trace.stateSets.push(id) },
    change(id, force) { assert.equal(force, true); const scene = meControl.current().stateScenes.get(id); assert.ok(scene, `missing scene state ${id}`); meControl.current().trace.stateChanges.push(id); scene.onResetEvent() },
    pause() { meControl.current().trace.statePauses += 1 }
  }),
  game: Object.freeze({
    viewport: Object.freeze({ width: 1664, height: 928 }),
    settings: Object.freeze({ scaleMethod: 'fit' }),
    world: Object.freeze({
      get currentTransform() { return meControl.current().matrix },
      addChild(child, depth) { if (Number.isFinite(depth)) child.depth = depth; meControl.current().worldChildren.add(child); return child },
      removeChild(child) { meControl.current().worldChildren.delete(child); return child },
      hasChild(child) { return meControl.current().worldChildren.has(child) },
      sort() { meControl.current().trace.worldSorts += 1 }
    })
  }),
  device: Object.freeze({})
})
let syntheticFailFastCalls = 0
const syntheticCache = new Map()
const synthetic = (identifier, exports) => {
  if (syntheticCache.has(identifier)) return syntheticCache.get(identifier)
  const names = Object.keys(exports)
  const module = new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, exports[name]) }, { context, identifier })
  syntheticCache.set(identifier, module)
  return module
}
const inert = (specifier, ...names) => Object.fromEntries(names.map(name => [name, (...args) => { syntheticFailFastCalls += 1; throw new Error(`UNREVIEWED_DEPENDENCY_CALLED:${specifier}:${name}:${args.length}`) }]))
const gameSelectorModule = new vm.SyntheticModule(['juyitingGame'], function () { this.setExport('juyitingGame', null) }, { context, identifier: 'o03:live-game-selector' })
const gameSelectorControl = Object.freeze({ set(game) { assert.ok(game); gameSelectorModule.setExport('juyitingGame', game) } })
const melonModule = synthetic('o03:reviewed-melonjs', { default: meFacade })
const mapData = Object.freeze({
  coordinateWidth: 1664,
  coordinateHeight: 928,
  imageLayers: Object.freeze({}),
  tileLayers: Object.freeze([]),
  tilesets: Object.freeze([]),
  hotspots: Object.freeze([Object.freeze({ id: 'hotspot-1', panel: 'tasks', type: 'hotspot', shape: 'rect', x: 50, y: 50, w: 10, h: 10 })]),
  mapProperties: Object.freeze({ minZoom: 0.1, maxZoom: 3.3 }),
  movementReady: false,
  movement: null
})
const createHallAgentFacade = () => class HallAgentFacade {
  static supports(data) { meControl.current().trace.agentSupports += 1; return meControl.current().materializeAgents && data?.agentId === 'agent-B' && String(data?.personaCode || '').toLowerCase() === 'persona-b' }
  static create(data) { return this.supports(data) ? new this(data) : null }
  constructor(data) {
    this._sourceData = data
    this.agentId = data.agentId
    this.personaCode = data.personaCode
    this.pos = { x: Number(data.x) || 760, y: Number(data.y) || 420 }
    this.width = 64; this.height = 96; this.depth = 0
  }
  syncState(data) { this._sourceData = data; if (Number.isFinite(data?.x)) this.pos.x = data.x; if (Number.isFinite(data?.y)) this.pos.y = data.y }
  syncSimulationSnapshot(data) { this.syncState(data) }
  getBounds() { const x = this.pos.x; const y = this.pos.y; const width = this.width; const height = this.height; return Object.freeze({ x, y, width, height, contains: (px, py) => px >= x && px <= x + width && py >= y && py <= y + height }) }
  containsPoint(x, y) { const bounds = this.getBounds(); return bounds.contains(x, y) }
  setSelected(value) { this.selected = Boolean(value) }
  setDestination() {}
  setAnimState() {}
  setBubble() {}
  setHighlighted() {}
  setFacing() {}
  drawWorldUi() {}
}
const createInteractionLockFacade = () => {
  const reasons = new Set()
  return Object.freeze({ lock: reason => reasons.add(reason), unlock: reason => reasons.delete(reason), isLocked: () => reasons.size > 0 })
}
const createInputControllerFacade = options => {
  assert.ok(options?.target && options?.camera && options?.interactionLock)
  for (const name of ['viewport', 'hitProvider', 'onAgentClick', 'onHotspotClick']) assert.equal(typeof options[name], 'function')
  let cleaned = false
  return Object.freeze({ cleanup: () => { cleaned = true }, cancelGesture: () => {}, snapshot: () => Object.freeze({ activeGesture: 'none', interactionLocked: options.interactionLock.isLocked(), cleaned }) })
}
const depthBands = Object.freeze({ BASE_MIN: 0, BASE_MAX_EXCLUSIVE: 100, V2_WORLD_START: 100, V2_WORLD_STRIDE: 1, ERROR_STATE_PROP_DEPTH: 6, ERROR_STATE_AGENT_DEPTH: 7, LIGHTING: 300, WORLD_UI: 400, SCREEN_UI: 500 })
const gameDependencyExports = Object.freeze({
  './resources.js': Object.freeze({
    HALL_BOOT_RESOURCES: Object.freeze([]),
    HALL_MAP_RESOURCE: Object.freeze({ name: 'juyiting-main-map', src: 'o03://juyiting-main-map.tmx', type: 'tmx' }),
    buildHallMapResources: candidate => { assert.equal(candidate, mapData); return Object.freeze([]) },
    ...inert('./resources.js', 'buildPersonaSpriteResource', 'personaSpriteResourceName')
  }),
  './tiledMap.js': Object.freeze({ parseJuyiHallTmx: (raw, options) => { assert.equal(raw, '<map id="o03-minimal" />'); assert.deepEqual(Object.keys(options).sort(), ['movementEnabled']); assert.equal(options.movementEnabled, false); return mapData } }),
  './entities/HallAgent.js': Object.freeze({ createHallAgentClass: me => { assert.equal(me, meFacade); return createHallAgentFacade() } }),
  './sprites/spriteLoader.js': Object.freeze({ loadPersonaSprites: async (loader, manifest, options) => {
    assert.equal(typeof loader, 'function'); assert.equal(options?.timeoutMs, 15000)
    const personas = manifest?.personas || {}
    if (personas['persona-required']) {
      assert.equal(personas['persona-required'].required, true); assert.equal(personas['persona-b'], undefined)
      return Object.freeze({ available: new Set(['persona-required']), assets: new Map(), degraded: false, requiredMissingCount: 0, optionalMissingCount: 0, placeholderCount: 0, errors: Object.freeze([]) })
    }
    assert.equal(personas['persona-b']?.required, false); assert.equal(personas['persona-required'], undefined)
    return Object.freeze({ available: new Set(['persona-b']), assets: new Map(), degraded: false, requiredMissingCount: 0, optionalMissingCount: 0, placeholderCount: 0, errors: Object.freeze([]) })
  } }),
  './sprites/personaSpriteManifest.js': Object.freeze({ PERSONA_SPRITE_MANIFEST: Object.freeze({ version: 1, personas: Object.freeze({
    'persona-required': Object.freeze({ personaCode: 'persona-required', required: true }),
    'persona-b': Object.freeze({ personaCode: 'persona-b', required: false })
  }) }) }),
  './simulation/movementEngine.js': Object.freeze(inert('./simulation/movementEngine.js', 'createMovementEngine')),
  './debug/sceneDebugAggregator.js': Object.freeze(inert('./debug/sceneDebugAggregator.js', 'aggregateSceneDebug'))
})
const sceneDependencyExports = Object.freeze({
  '../input/inputController.js': Object.freeze({ createInputController: createInputControllerFacade }),
  '../input/interactionLock.js': Object.freeze({ createInteractionLock: createInteractionLockFacade }),
  '../occlusion/shadowRenderer.js': Object.freeze({ ...inert('../occlusion/shadowRenderer.js', 'createShadowRenderer'), parseOcclusionDebugFlag: value => { assert.equal(value, ''); return false } }),
  '../occlusion/hallSceneAssembly.js': Object.freeze({ ...inert('../occlusion/hallSceneAssembly.js', 'hasV2ActivationEnvelope', 'assembleV2Scene', 'computeUnifiedWorldOrder', 'buildHitTestTargets', 'hitTestPoint', 'buildFrameProposal', 'registerAgentsInGrid', 'unregisterAgentFromGrid', 'createSceneActivationController', 'projectActivationEnvelope'), createEmptyMembershipState: () => Object.freeze({}) }),
  '../occlusion/runtimeAgentAdapter.js': Object.freeze(inert('../occlusion/runtimeAgentAdapter.js', 'createRuntimeAgentAdapter', 'defaultSpawnResolver', 'defaultChunkResolver')),
  '../occlusion/debugOverlay.js': Object.freeze(inert('../occlusion/debugOverlay.js', 'createDebugOverlay')),
  '../occlusion/hallSceneDepthBands.js': Object.freeze({ HALL_SCENE_DEPTH_BANDS: depthBands, HALL_SCENE_LEGACY_OCCLUDER_LAYERS: Object.freeze([]), hallV2WorldDepth: value => { assert.ok(Number.isSafeInteger(value) && value >= 0); return 100 + value } })
})
const donorModules = new Map()
const canonicalModuleCache = new Map()
const canonicalRejected = new Map()
const resolveImport = (specifier, parent) => {
  assert.ok(specifier.startsWith('.'), `bare package resolution forbidden: ${specifier}`)
  const requested = resolve(dirname(parent), specifier)
  if (existsSync(requested)) return requireContained(requested)
  assert.equal(extname(requested), '.js', `unknown relative import: ${specifier}`)
  const candidate = `${requested.slice(0, -3)}.ts`
  assert.ok(existsSync(candidate), `missing import: ${specifier}`)
  const canonical = requireContained(candidate)
  assert.ok(manifestByPath.has(relative(cwd, canonical).replaceAll('\\', '/')), `unlisted TS fallback: ${specifier}`)
  return canonical
}
const loadCanonicalModule = async canonicalPath => {
  if (canonicalRejected.has(canonicalPath)) throw canonicalRejected.get(canonicalPath)
  if (canonicalModuleCache.has(canonicalPath)) return canonicalModuleCache.get(canonicalPath)
  try {
    const relativePath = relative(cwd, canonicalPath).replaceAll('\\', '/')
    const raw = rawSource(relativePath)
    const entry = canonicalEntries.get(relativePath)
    const module = new vm.SourceTextModule((entry ? entry.runtimeBytes : raw.bytes).toString('utf8'), {
      context,
      identifier: canonicalPath,
      initializeImportMeta(meta) { Object.preventExtensions(meta) },
      importModuleDynamically: async (specifier, referencing) => {
        assert.equal(referencing.identifier, DYNAMIC_MELON_IMPORT_CONTRACT.importer, `dynamic importer rejected: ${referencing.identifier}`)
        assert.equal(specifier, DYNAMIC_MELON_IMPORT_CONTRACT.specifier, `dynamic specifier rejected: ${specifier}`)
        assert.equal(melonModule.status, 'evaluated', 'melon facade must be pre-evaluated')
        facadeCounters.dynamicMelonImports += 1
        dynamicMelonImportGate.hookEntered({ importer: referencing.identifier, specifier, count: facadeCounters.dynamicMelonImports })
        return melonModule
      }
    })
    canonicalModuleCache.set(canonicalPath, module)
    await module.link(async (specifier, referencing) => {
      assert.notEqual(specifier, 'melonjs', 'static melonjs import is forbidden')
      if (referencing.identifier.endsWith('/JuyitingGame.js') && !['./config.js', './scenes/HallScene.js'].includes(specifier)) {
        const exports = gameDependencyExports[specifier]
        assert.ok(exports, `unreviewed game dependency missing: ${specifier}`)
        return synthetic(`${referencing.identifier}:${specifier}`, exports)
      }
      if (referencing.identifier.endsWith('/scenes/HallScene.js') && !['../config.js', '../camera/cameraController.js', '../camera/resizePolicy.js', '../camera/cameraTransform.js', '../viewportTransform.js', '../occlusion/sourceIdentity.js'].includes(specifier)) {
        const exports = sceneDependencyExports[specifier]
        assert.ok(exports, `unreviewed scene dependency missing: ${specifier}`)
        return synthetic(`${referencing.identifier}:${specifier}`, exports)
      }
      return loadCanonicalModule(resolveImport(specifier, referencing.identifier))
    })
    await module.evaluate()
    return module
  } catch (error) {
    canonicalRejected.set(canonicalPath, error)
    throw error
  }
}
let activeJuyiFixture = null
const juyiControl = Object.freeze({ set(fixture) { activeJuyiFixture = fixture }, get() { assert.ok(activeJuyiFixture, 'JuyiHall fixture not configured'); return activeJuyiFixture } })
const componentToken = name => Object.freeze({ name: `Opaque${name}`, render: () => null })
const mutableJuyiModuleExports = {
  '@/stores/global': Object.freeze({ useGlobalStore: () => juyiControl.get().globalStore }),
  '@/stores/api': Object.freeze({ useApiStore: () => juyiControl.get().apiStore }),
  '@/composables/useHttp': Object.freeze({ agentApi: Object.freeze({ kind: 'agent-api-token' }), chatApi: Object.freeze({ kind: 'chat-api-token' }) }),
  '@/composables/juyiting/useHallChatContext': Object.freeze({ useHallChatContext: () => juyiControl.get().chatContext }),
  '@/composables/juyiting/useHallBackendSceneState': Object.freeze({ useHallBackendSceneState: () => juyiControl.get().backend }),
  '@/composables/juyiting/useHallCommandQueue': Object.freeze({ useHallCommandQueue: () => juyiControl.get().commandQueue }),
  '@/composables/juyiting/useHallConversation': Object.freeze({ useHallConversation: () => juyiControl.get().conversation }),
  '@/composables/juyiting/useHallData': Object.freeze({ useHallData: () => juyiControl.get().data }),
  '@/composables/juyiting/useHallLibrary': Object.freeze({ useHallLibrary: () => juyiControl.get().library }),
  '@/composables/juyiting/useHallExperienceMode': Object.freeze({ useHallExperienceMode: () => juyiControl.get().experience }),
  '@/composables/juyiting/useHallPanels': Object.freeze({ focusHallPanel: value => juyiControl.get().trace.panelCalls.push(['focus', value]), restorePanelFocus: value => juyiControl.get().trace.panelCalls.push(['restore', value]), trapPanelFocus: (...args) => juyiControl.get().trace.panelCalls.push(['trap', args.length]), useHallPanels: () => juyiControl.get().panels }),
  '@/composables/juyiting/useHallScene': Object.freeze({ useHallScene: () => juyiControl.get().scene }),
  '@/composables/juyiting/useHallSceneState': Object.freeze({ useHallSceneState: () => juyiControl.get().sceneState }),
  '@/composables/juyiting/useHallSceneDebugBridge': Object.freeze({ useHallSceneDebugBridge: () => juyiControl.get().debugBridge }),
  '@/composables/juyiting/useHallSound': Object.freeze({ useHallSound: () => juyiControl.get().sound }),
  '@/composables/juyiting/useHallTaskActions': Object.freeze({ useHallTaskActions: () => juyiControl.get().taskActions }),
  '@/composables/juyiting/useTaskWorkspace': Object.freeze({ useTaskWorkspace: (...args) => { syntheticFailFastCalls += 1; throw new Error(`UNREVIEWED_DEPENDENCY_CALLED:useTaskWorkspace:${args.length}`) } }),
  '@/composables/juyiting/taskWorkspaceFeature': Object.freeze({
    isTaskWorkspaceBuildEnabled: value => { assert.equal(value, 'false'); return false },
    createDisabledTaskWorkspaceBinding: selectedAgent => Object.freeze({
      selectExplicitActor(agent) { selectedAgent.value = agent || null; juyiControl.get().trace.explicitActors.push(agent?.agentId || null) },
      clearExplicitActor() { selectedAgent.value = null; juyiControl.get().trace.explicitActors.push(null) },
      dispose() { juyiControl.get().trace.disposals.push('taskWorkspaceBinding') }
    })
  }),
  '@/composables/juyiting/useTaskWorkspaceView': Object.freeze({ useTaskWorkspaceView: workspace => { assert.equal(workspace, null); return juyiControl.get().workspaceView } }),
  '@/composables/juyiting/useTaskWorkspaceBinding': Object.freeze({ useTaskWorkspaceBinding: (...args) => { syntheticFailFastCalls += 1; throw new Error(`UNREVIEWED_DEPENDENCY_CALLED:useTaskWorkspaceBinding:${args.length}`) } }),
  '@/composables/juyiting/useWaterMarginRoles': Object.freeze({ portraitName: agent => agent?.name || '', portraitRole: () => Object.freeze({ slug: 'default' }), portraitShortName: agent => agent?.name || agent?.agentId || '', portraitStyle: () => Object.freeze({}), roleClass: () => '' }),
  '@/constants/juyiting': Object.freeze({ roleDialogues: Object.freeze({ default: Object.freeze(['候命']) }), statusFilters: Object.freeze([]), taskStatusFilters: Object.freeze([]) }),
  '@/utils/logger': Object.freeze({ log: Object.freeze({ warn: (...args) => juyiControl.get().trace.logs.push(Object.freeze(args.map(String))) }) })
}
for (const componentPath of ['TaskWorkspacePanel', 'AgentPanel', 'BountyDiscussionPanel', 'BountyPanel', 'HallPortraitHome', 'LibraryPanel', 'PersonaCatalogPanel', 'PrivateDiscussionPanel', 'PublicDiscussionPanel', 'SelectedAgentCard']) {
  mutableJuyiModuleExports[`@/components/juyiting/${componentPath}.vue`] = Object.freeze({ default: componentToken(componentPath) })
}
const juyiModuleExports = Object.freeze(mutableJuyiModuleExports)
const compiledArtifacts = {}
const importRecords = (compiler, code) => {
  const ast = compiler.babelParse(code, { sourceType: 'module' })
  return Array.from(ast.program.body).filter(node => node.type === 'ImportDeclaration').map(node => Object.freeze({
    source: node.source.value,
    bindings: Object.freeze(Array.from(node.specifiers).map(item => Object.freeze({ kind: item.type, imported: item.imported?.name ?? (item.type === 'ImportDefaultSpecifier' ? 'default' : '*'), local: item.local.name })))
  }))
}
const expectedRecord = (source, bindings) => Object.freeze({ source, bindings: Object.freeze(bindings.map(([kind, imported, local = imported]) => Object.freeze({ kind, imported, local }))) })
const hallScriptImports = Object.freeze([
  expectedRecord('vue', [['ImportSpecifier', 'computed'], ['ImportSpecifier', 'onBeforeUnmount'], ['ImportSpecifier', 'onMounted'], ['ImportSpecifier', 'ref'], ['ImportSpecifier', 'watch']]),
  expectedRecord('@/game/index.js', [['ImportSpecifier', 'juyitingGame']]),
  expectedRecord('@/game/camera/resizePolicy.js', [['ImportSpecifier', 'classifyViewportResize']])
])
const hallTemplateImports = Object.freeze([
  expectedRecord('vue', [
    ['ImportSpecifier', 'createElementVNode', '_createElementVNode'], ['ImportSpecifier', 'resolveComponent', '_resolveComponent'], ['ImportSpecifier', 'createVNode', '_createVNode'], ['ImportSpecifier', 'toDisplayString', '_toDisplayString'], ['ImportSpecifier', 'normalizeClass', '_normalizeClass'], ['ImportSpecifier', 'openBlock', '_openBlock'], ['ImportSpecifier', 'createElementBlock', '_createElementBlock'], ['ImportSpecifier', 'createCommentVNode', '_createCommentVNode'], ['ImportSpecifier', 'renderSlot', '_renderSlot']
  ])
])
const juyiExpectedImports = Object.freeze([
  ['vue', ['computed', 'nextTick', 'onMounted', 'onUnmounted', 'ref', 'watch']],
  ['@/stores/global', ['useGlobalStore']], ['@/stores/api', ['useApiStore']], ['@/composables/useHttp', ['agentApi', 'chatApi']],
  ['@/composables/juyiting/useHallChatContext', ['useHallChatContext']], ['@/composables/juyiting/useHallBackendSceneState', ['useHallBackendSceneState']], ['@/composables/juyiting/useHallCommandQueue', ['useHallCommandQueue']], ['@/composables/juyiting/useHallConversation', ['useHallConversation']], ['@/composables/juyiting/useHallData', ['useHallData']], ['@/composables/juyiting/useHallLibrary', ['useHallLibrary']], ['@/composables/juyiting/useHallExperienceMode', ['useHallExperienceMode']],
  ['@/composables/juyiting/useHallPanels', ['focusHallPanel', 'restorePanelFocus', 'trapPanelFocus', 'useHallPanels']], ['@/composables/juyiting/useHallScene', ['useHallScene']], ['@/composables/juyiting/useHallSceneState', ['useHallSceneState']], ['@/composables/juyiting/useHallSceneDebugBridge', ['useHallSceneDebugBridge']], ['@/composables/juyiting/useHallSound', ['useHallSound']], ['@/composables/juyiting/useHallTaskActions', ['useHallTaskActions']], ['@/composables/juyiting/useTaskWorkspace', ['useTaskWorkspace']], ['@/composables/juyiting/taskWorkspaceFeature', ['createDisabledTaskWorkspaceBinding', 'isTaskWorkspaceBuildEnabled']], ['@/composables/juyiting/useTaskWorkspaceView', ['useTaskWorkspaceView']], ['@/composables/juyiting/useTaskWorkspaceBinding', ['useTaskWorkspaceBinding']],
  ['@/components/juyiting/TaskWorkspacePanel.vue', ['default']], ['@/composables/juyiting/useWaterMarginRoles', ['portraitName', 'portraitRole', 'portraitShortName', 'portraitStyle', 'roleClass']], ['@/components/juyiting/AgentPanel.vue', ['default']], ['@/components/juyiting/BountyDiscussionPanel.vue', ['default']], ['@/components/juyiting/BountyPanel.vue', ['default']], ['@/components/juyiting/HallPortraitHome.vue', ['default']], ['@/components/juyiting/HallStage.vue', ['default']], ['@/components/juyiting/LibraryPanel.vue', ['default']], ['@/components/juyiting/PersonaCatalogPanel.vue', ['default']], ['@/components/juyiting/PrivateDiscussionPanel.vue', ['default']], ['@/components/juyiting/PublicDiscussionPanel.vue', ['default']], ['@/components/juyiting/SelectedAgentCard.vue', ['default']],
  ['@/constants/juyiting', ['roleDialogues', 'statusFilters', 'taskStatusFilters']], ['@/utils/logger', ['log']], ['@/game/index.js', ['juyitingGame']]
])
const normalizeJuyiRecords = records => records.map(record => [record.source, record.bindings.map(binding => binding.imported)])
const assertExactKeys = (value, keys, label) => assert.deepEqual(Object.keys(value).sort(), keys.slice().sort(), `${label} return shape drift`)
function createJuyiFixture(vueNamespace) {
  const makeRef = value => vueNamespace.ref(value)
  const trace = { globalCalls: [], explicitActors: [], disposals: [], panelCalls: [], logs: [], sounds: [], requests: [], recommendationLoads: [], cleanup: [] }
  const agentB = Object.freeze({ agentId: 'agent-B', personaCode: 'persona-b', name: 'Agent B', abilities: Object.freeze(['focus']), boundToMe: true })
  const mapAgentB = Object.freeze({ agentId: 'agent-B', personaCode: 'persona-b', name: 'Map Agent B', abilities: Object.freeze(['focus']), boundToMe: true })
  const rosterOnly = Object.freeze({ agentId: 'roster-only', personaCode: 'persona-r', name: 'Roster Only' })
  const taskB = Object.freeze({ id: 'task-B', title: 'Task B', status: 'assigned', assignedAgentIds: Object.freeze(['agent-B']), assignees: Object.freeze([]), requiredAbilities: Object.freeze([]) })
  const noop = () => {}
  const asyncNoop = async () => true
  const data = {
    applySceneEvent: noop, applySceneSnapshot: noop,
    agentFilter: makeRef('all'), agents: makeRef([agentB, rosterOnly]), bindPersona: asyncNoop, canAssign: () => true,
    filteredAgents: makeRef([agentB, rosterOnly]), hiddenAgentCount: makeRef(0), loadAgents: asyncNoop, loadTasks: asyncNoop,
    loadTaskRecommendations: async task => { trace.recommendationLoads.push(task?.id); return true }, mapAgents: makeRef([mapAgentB]), personaCatalog: makeRef([]), recommendedAgents: makeRef([agentB]), setAgentFilter: noop, setTaskStatusFilter: noop,
    taskAbilityFilter: makeRef(''), taskAbilityOptions: makeRef([]), taskKeyword: makeRef(''), tasks: makeRef([taskB]), taskStatusCount: () => 0, taskStatusFilter: makeRef('all'), unbindPersona: asyncNoop, visibleAgents: makeRef([agentB])
  }
  const scene = {
    markAgentSpeaking: noop, markDiscussionStarted: noop, markLibraryCitation: noop, markLibrarySearching: noop, markRecommendedAgents: noop, markTaskArchived: noop, markTaskAssigned: noop, markTaskAutoAssigned: noop, markTaskCreated: noop, resetSceneFeedback: noop,
    sceneAgents: makeRef([mapAgentB]), sceneAgentStyle: () => Object.freeze({}), sceneHotspots: makeRef([Object.freeze({ id: 'hotspot-1' })]), syncAfterPersonaChanged: noop
  }
  const conversation = {
    chatConnectionStatus: makeRef('connected'), conversationId: makeRef('conversation-1'), draft: makeRef(''), eventStreamRecovering: makeRef(false), insertAgentMention: noop, isAwaitingReply: makeRef(false), isStreaming: makeRef(false), loadHallMessages: asyncNoop, mentionAgent: noop, messages: makeRef([]), newHallConversation: noop, pendingAgentName: makeRef(''), sendHallMessage: asyncNoop, senderText: makeRef(''),
    disposeHallConversation: () => trace.cleanup.push('conversation'), stopHallEventStream: () => trace.cleanup.push('event-stream'), stopHallReplyPolling: () => trace.cleanup.push('reply-polling'), stopHallReplyStreaming: () => trace.cleanup.push('reply-streaming')
  }
  const library = { citeLibraryItem: noop, libraryErrorMessage: makeRef(''), libraryHasSearched: makeRef(false), libraryKeyword: makeRef(''), libraryLoading: makeRef(false), libraryResults: makeRef([]), librarySourceType: makeRef('all'), searchLibrary: asyncNoop }
  const fixture = {
    trace, agentB, mapAgentB, rosterOnly, taskB,
    globalStore: Object.freeze({ setTitle: value => trace.globalCalls.push(['title', value]), setShowBack: value => trace.globalCalls.push(['back', value]), setShowAppBar: value => trace.globalCalls.push(['appbar', value]), setShowMore: value => trace.globalCalls.push(['more', value]) }),
    apiStore: Object.freeze({}),
    data, scene, conversation, library,
    chatContext: { chatContext: makeRef(Object.freeze({ participantAgentIds: Object.freeze([]), targetAgentIds: Object.freeze([]) })), chatMentionAgents: makeRef([agentB]), chatMode: makeRef('public'), chatTargetText: makeRef(''), enterBountyDiscussion: noop, enterPrivateConversation: noop, resetToPublic: noop, setMentionAgent: noop },
    backend: Object.freeze({ start: asyncNoop, stop: () => trace.cleanup.push('backend-stop'), dispose: () => trace.cleanup.push('backend-dispose'), reportPhase: noop }),
    commandQueue: Object.freeze({ ready: makeRef(false), setSimulation: value => trace.requests.push(['simulation', value]) }),
    experience: { experienceMode: makeRef('portrait-command'), isMobileCoarse: makeRef(true), orientationHint: makeRef(''), orientationRequestPending: makeRef(false), requestLandscape: () => { const token = Object.freeze({ kind: 'landscape-request', serial: trace.requests.length + 1 }); trace.requests.push(token); return token } },
    panels: { panelLayout: makeRef('sheet') },
    sceneState: Object.freeze({ setMapRuntime: noop, reset: () => trace.cleanup.push('scene-reset'), forwardPhaseEvents: asyncNoop }),
    debugBridge: Object.freeze({ republish: noop, stop: () => trace.cleanup.push('debug-stop') }),
    sound: Object.freeze({ playAgentSelect: () => trace.sounds.push('agent'), playError: noop, playPanelOpen: noop, playRefresh: noop, playSend: noop, playSuccess: noop, playTap: () => trace.sounds.push('tap'), setSoundEnabled: noop, soundEnabled: makeRef(true) }),
    taskActions: Object.freeze({ archiveTask: asyncNoop, autoAssignTask: asyncNoop, assignTask: asyncNoop, createTask: asyncNoop }),
    workspaceView: Object.freeze({ subject: makeRef(null), workspace: makeRef(null), connectionState: makeRef('disabled'), error: makeRef(null), retry: asyncNoop })
  }
  return Object.freeze(fixture)
}
const selfAudit = async () => {
  const evidence = []
  for (const spec of canonicalManifest) {
    const raw = rawSource(spec.path)
    const first = generateCanonicalModule(spec, raw); const second = generateCanonicalModule(spec, raw)
    assert.ok(first.runtimeBytes.equals(second.runtimeBytes), `non-deterministic generated bytes: ${spec.path}`)
    assert.deepEqual(first.trace, second.trace, `non-deterministic trace: ${spec.path}`)
    assert.equal(first.runtimeSha256, second.runtimeSha256, `non-deterministic generated SHA: ${spec.path}`)
    new vm.SourceTextModule(first.runtimeBytes.toString('utf8'), { context, identifier: raw.canonical })
    canonicalEntries.set(spec.path, first)
    evidence.push(Object.freeze({ path: spec.path, sourceSha256: first.sourceSha256, sourceBytes: first.sourceBytes, runtimeSha256: first.runtimeSha256, runtimeBytes: first.runtimeByteLength, rules: first.trace, parse: 'PASS', deterministic: 'PASS' }))
  }
  for (const path of Object.keys(sourcePins)) if (!manifestByPath.has(path)) rawSource(path)
  const root = realpathSync(donor.root); assert.equal(root, donor.root, 'donor root realpath drift')
  const donorNodeModules = resolve(root, 'node_modules')
  for (const lexical of [donorNodeModules, resolve(donorNodeModules, 'vue'), resolve(donorNodeModules, '@vue/compiler-sfc')]) {
    const canonical = realpathSync(lexical); assert.equal(canonical, lexical, `donor package root realpath drift: ${lexical}`)
    const fromModules = relative(donorNodeModules, canonical); assert.ok(fromModules !== '..' && !fromModules.startsWith('../') && !fromModules.startsWith('/'), `donor package root escaped node_modules: ${lexical}`)
  }
  const localPackage = exactJson(cwd, 'package.json', donor.packageSha256); const localLock = exactJson(cwd, 'package-lock.json', donor.lockSha256)
  const donorPackage = exactJson(root, 'package.json', donor.packageSha256); const donorLock = exactJson(root, 'package-lock.json', donor.lockSha256)
  assert.ok(localPackage.bytes.equals(donorPackage.bytes), 'O03/donor package bytes differ'); assert.ok(localLock.bytes.equals(donorLock.bytes), 'O03/donor lock bytes differ')
  const hiddenLock = checkedFile(resolve(root, 'node_modules/.package-lock.json'), donor.hiddenLockSha256)
  const compilerPackage = checkedFile(resolve(root, 'node_modules/@vue/compiler-sfc/package.json'), donor.compilerPackageSha256)
  const compilerBundle = checkedFile(resolve(root, 'node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'), donor.compilerBundleSha256, donor.compilerBundleBytes)
  const vuePackage = checkedFile(resolve(root, 'node_modules/vue/package.json'), donor.vuePackageSha256)
  const vueBundle = checkedFile(resolve(root, 'node_modules/vue/dist/vue.runtime.esm-browser.js'), donor.vueBundleSha256, donor.vueBundleBytes)
  for (const pkg of [compilerPackage, vuePackage]) assert.equal(JSON.parse(pkg.bytes).version, '3.5.16', 'locked package version drift')
  for (const lock of [localLock, donorLock, hiddenLock]) {
    const parsed = JSON.parse(lock.bytes)
    assert.equal(parsed.packages['node_modules/vue'].version, '3.5.16'); assert.equal(parsed.packages['node_modules/vue'].integrity, 'sha512-rjOV2ecxMd5SiAmof2xzh2WxntRcigkX/He4YFJ6WdRvVUrbt6DxC1Iujh10XLl8xCDRDtGKMeO3D+pRQ1PP9w==')
    assert.equal(parsed.packages['node_modules/@vue/compiler-sfc'].version, '3.5.16'); assert.equal(parsed.packages['node_modules/@vue/compiler-sfc'].integrity, 'sha512-rQR6VSFNpiinDy/DVUE0vHoIDUF++6p910cgcZoaAUm3POxgNOOdS/xgoll3rNdKYTYPnnbARDCZOyZ+QSe6Pw==')
  }
  const loadDonor = async entry => {
    const module = new vm.SourceTextModule(entry.bytes.toString('utf8'), { context, identifier: entry.canonical, importModuleDynamically: specifier => { throw new Error(`dynamic donor import rejected: ${specifier}`) } })
    await module.link(specifier => { throw new Error(`donor dependency rejected: ${specifier}`) })
    await module.evaluate()
    return module
  }
  const compilerModule = await loadDonor(compilerBundle)
  const vueModule = await loadDonor(vueBundle)
  donorModules.set('compiler', compilerModule); donorModules.set('vue', vueModule)
  const compiler = compilerModule.namespace; const vue = vueModule.namespace
  assert.equal(compiler.version, '3.5.16'); for (const name of ['parse', 'compileScript', 'compileTemplate', 'babelParse']) assert.equal(typeof compiler[name], 'function', `compiler export missing: ${name}`)
  assert.equal(vue.version, '3.5.16'); for (const name of ['computed', 'nextTick', 'onBeforeUnmount', 'onMounted', 'onUnmounted', 'ref', 'watch', 'createRenderer', 'createVNode', 'createElementVNode', 'resolveComponent', 'toDisplayString', 'normalizeClass', 'openBlock', 'createElementBlock', 'createCommentVNode', 'renderSlot']) assert.equal(typeof vue[name], 'function', `Vue export missing: ${name}`)
  assert.deepEqual(facadeCounters, { ...facadeCounters, vueTemplateCreateCalls: 1, vueFormatterPushCalls: 1, vueHmrRuntimeSets: 1, vueInstanceSetterPushes: 1, vueSsrSetterPushes: 1 })
  await gameSelectorModule.link(() => { throw new Error('game selector dependency rejected') }); await gameSelectorModule.evaluate()
  await melonModule.link(() => { throw new Error('melon facade dependency rejected') }); await melonModule.evaluate()
  const gameModule = await loadCanonicalModule(resolve(cwd, 'src/game/JuyitingGame.js'))
  const sceneModule = await loadCanonicalModule(resolve(cwd, 'src/game/scenes/HallScene.js'))
  const policyModule = await loadCanonicalModule(resolve(cwd, 'src/game/camera/resizePolicy.ts'))
  compiledArtifacts.gameModule = gameModule; compiledArtifacts.sceneModule = sceneModule; compiledArtifacts.policyModule = policyModule
  const hallSource = rawSource('src/components/juyiting/HallStage.vue')
  const hallParsed = compiler.parse(hallSource.bytes.toString('utf8'), { filename: hallSource.canonical })
  assert.equal(hallParsed.errors.length, 0, 'HallStage SFC parse errors')
  const hallSegments = [hallParsed.descriptor.template, hallParsed.descriptor.scriptSetup, hallParsed.descriptor.styles[0]]
  const hallPins = [[3744, 'b538b8424192914efcac1fef6159e338d62e7ed3c00d61fde668fb1a448f50ea'], [26710, '3edf42fb0cca716d0ce0ef1ff663d86d8f0f3dd5e5af877cabc98e82a7c7b588'], [6533, 'afcca9abfcea4e9efb81d87c6584c169bd66d96f3b5104f7ba1bb70e26155a73']]
  hallSegments.forEach((segment, index) => { const bytes = Buffer.from(segment.content, 'utf8'); assert.equal(bytes.length, hallPins[index][0]); assert.equal(sha256(bytes), hallPins[index][1]) })
  const hallScriptFirst = compiler.compileScript(hallParsed.descriptor, { id: 'o03-hall-stage', inlineTemplate: false })
  const hallScriptSecond = compiler.compileScript(hallParsed.descriptor, { id: 'o03-hall-stage', inlineTemplate: false })
  assert.equal(hallScriptFirst.content, hallScriptSecond.content); assert.deepEqual(hallScriptFirst.bindings, hallScriptSecond.bindings)
  const hallTemplateOptions = { source: hallParsed.descriptor.template.content, filename: hallSource.canonical, id: 'o03-hall-stage', scoped: true, transformAssetUrls: false, compilerOptions: { bindingMetadata: hallScriptFirst.bindings } }
  const hallTemplateFirst = compiler.compileTemplate(hallTemplateOptions); const hallTemplateSecond = compiler.compileTemplate(hallTemplateOptions)
  assert.equal(hallTemplateFirst.code, hallTemplateSecond.code); assert.equal(hallTemplateFirst.errors.length, 0); assert.equal(hallTemplateFirst.tips.length, 0)
  assert.deepEqual(importRecords(compiler, hallScriptFirst.content), hallScriptImports, 'HallStage script import ACL drift')
  assert.deepEqual(importRecords(compiler, hallTemplateFirst.code), hallTemplateImports, 'HallStage template import ACL drift')
  const hallScriptModule = new vm.SourceTextModule(hallScriptFirst.content, { context, identifier: `${hallSource.canonical}?o03-script`, importModuleDynamically: specifier => { throw new Error(`HallStage script dynamic import rejected: ${specifier}`) } })
  await hallScriptModule.link(specifier => {
    if (specifier === 'vue') return vueModule
    if (specifier === '@/game/index.js') return gameSelectorModule
    if (specifier === '@/game/camera/resizePolicy.js') return policyModule
    throw new Error(`HallStage script import rejected: ${specifier}`)
  })
  const hallTemplateModule = new vm.SourceTextModule(hallTemplateFirst.code, { context, identifier: `${hallSource.canonical}?o03-template`, importModuleDynamically: specifier => { throw new Error(`HallStage template dynamic import rejected: ${specifier}`) } })
  await hallTemplateModule.link(specifier => { if (specifier === 'vue') return vueModule; throw new Error(`HallStage template import rejected: ${specifier}`) })
  const hallBridge = new vm.SourceTextModule(`import script from ${JSON.stringify(hallScriptModule.identifier)}\nimport { render } from ${JSON.stringify(hallTemplateModule.identifier)}\nexport default Object.freeze({ ...script, render, __scopeId: ${JSON.stringify(HALL_SCOPE_ID)} })`, { context, identifier: `${hallSource.canonical}?o03-bridge` })
  await hallBridge.link(specifier => {
    if (specifier === hallScriptModule.identifier) return hallScriptModule
    if (specifier === hallTemplateModule.identifier) return hallTemplateModule
    throw new Error(`HallStage bridge import rejected: ${specifier}`)
  })
  await hallBridge.evaluate()
  assert.ok(Object.isFrozen(hallBridge.namespace.default)); assert.equal(typeof hallBridge.namespace.default.render, 'function'); assert.equal(hallBridge.namespace.default.__scopeId, HALL_SCOPE_ID)
  compiledArtifacts.hallStage = hallBridge.namespace.default
  const juyiSource = rawSource('src/components/world/JuyiHall.vue')
  const juyiParsed = compiler.parse(juyiSource.bytes.toString('utf8'), { filename: juyiSource.canonical })
  assert.equal(juyiParsed.errors.length, 0, 'JuyiHall SFC parse errors')
  const juyiPins = [[12404, '5bfe9338f24491eb372ae023fddaa31831e1fcb57dc3e860de57d73fc3b9d0af'], [32183, '307465ed0769b588a15762afe9ee6ecf24c869a2fc6c1319696e8d6d6a589844'], [19855, '46d0d655e23a9d193ff5c93baf4426a7b77a9e84b99596e12496b2006d8e0498']]
  ;[juyiParsed.descriptor.template, juyiParsed.descriptor.scriptSetup, juyiParsed.descriptor.styles[0]].forEach((segment, index) => { const bytes = Buffer.from(segment.content, 'utf8'); assert.equal(bytes.length, juyiPins[index][0]); assert.equal(sha256(bytes), juyiPins[index][1]) })
  const juyiFirst = compiler.compileScript(juyiParsed.descriptor, { id: 'o03-juyi-hall', inlineTemplate: false }); const juyiSecond = compiler.compileScript(juyiParsed.descriptor, { id: 'o03-juyi-hall', inlineTemplate: false })
  assert.equal(juyiFirst.content, juyiSecond.content); assert.deepEqual(juyiFirst.bindings, juyiSecond.bindings)
  assert.deepEqual(normalizeJuyiRecords(importRecords(compiler, juyiFirst.content)), juyiExpectedImports, 'JuyiHall import ACL drift')
  const hallStageTokenModule = synthetic('o03:compiled-hall-stage-token', { default: compiledArtifacts.hallStage })
  const juyiModule = new vm.SourceTextModule(juyiFirst.content, {
    context,
    identifier: `${juyiSource.canonical}?o03-script`,
    initializeImportMeta(meta) { Object.defineProperty(meta, 'env', { value: Object.freeze({ VITE_JUYITING_TASK_WORKSPACE_ENABLED: 'false', VITE_JUYITING_SIMULATION_ENABLED: 'false' }), enumerable: true }); Object.preventExtensions(meta) },
    importModuleDynamically: specifier => { throw new Error(`JuyiHall dynamic import rejected: ${specifier}`) }
  })
  await juyiModule.link(specifier => {
    if (specifier === 'vue') return vueModule
    if (specifier === '@/game/index.js') return gameSelectorModule
    if (specifier === '@/components/juyiting/HallStage.vue') return hallStageTokenModule
    const exports = juyiModuleExports[specifier]
    assert.ok(exports, `JuyiHall import rejected: ${specifier}`)
    return synthetic(`o03:juyi:${specifier}`, exports)
  })
  await juyiModule.evaluate()
  compiledArtifacts.juyiHall = juyiModule.namespace.default
  const auditFixture = createJuyiFixture(vue)
  assertExactKeys(auditFixture.data, ['applySceneEvent', 'applySceneSnapshot', 'agentFilter', 'agents', 'bindPersona', 'canAssign', 'filteredAgents', 'hiddenAgentCount', 'loadAgents', 'loadTasks', 'loadTaskRecommendations', 'mapAgents', 'personaCatalog', 'recommendedAgents', 'setAgentFilter', 'setTaskStatusFilter', 'taskAbilityFilter', 'taskAbilityOptions', 'taskKeyword', 'tasks', 'taskStatusCount', 'taskStatusFilter', 'unbindPersona', 'visibleAgents'], 'useHallData')
  assertExactKeys(auditFixture.scene, ['markAgentSpeaking', 'markDiscussionStarted', 'markLibraryCitation', 'markLibrarySearching', 'markRecommendedAgents', 'markTaskArchived', 'markTaskAssigned', 'markTaskAutoAssigned', 'markTaskCreated', 'resetSceneFeedback', 'sceneAgents', 'sceneAgentStyle', 'sceneHotspots', 'syncAfterPersonaChanged'], 'useHallScene')
  assertExactKeys(auditFixture.conversation, ['chatConnectionStatus', 'conversationId', 'draft', 'eventStreamRecovering', 'insertAgentMention', 'isAwaitingReply', 'isStreaming', 'loadHallMessages', 'mentionAgent', 'messages', 'newHallConversation', 'pendingAgentName', 'sendHallMessage', 'senderText', 'disposeHallConversation', 'stopHallEventStream', 'stopHallReplyPolling', 'stopHallReplyStreaming'], 'useHallConversation')
  compiledArtifacts.renderer = vue.createRenderer(hostOps)
  assert.equal(facadeCounters.vueRendererFlagSets, 1)
  assert.equal(hostAudit.contractFrozen, true); assert.equal(Object.isFrozen(HOST_CREATE_CONTRACT.surface), true); assert.equal(HOST_CREATE_CONTRACT.hallInitial.every(Object.isFrozen), true); assert.equal(Object.values(HOST_CREATE_CONTRACT.hallTail).flat().every(Object.isFrozen), true)
  assertExactKeys(hostOps, ['createElement', 'createText', 'createComment', 'insert', 'remove', 'parentNode', 'nextSibling', 'setText', 'setElementText', 'patchProp', 'setScopeId', 'insertStaticContent'], 'hostOps')
  assert.equal(hostOps.createElement.length, 4); assert.equal(hostOps.createText.length, 1); assert.equal(hostOps.createComment.length, 1); assert.equal(hostOps.insert.length, 3); assert.equal(hostOps.remove.length, 1); assert.equal(hostOps.parentNode.length, 1); assert.equal(hostOps.nextSibling.length, 1); assert.equal(hostOps.setText.length, 2); assert.equal(hostOps.setElementText.length, 2); assert.equal(hostOps.patchProp.length, 6); assert.equal(hostOps.setScopeId.length, 2); assert.equal(hostOps.insertStaticContent.length, 6)
  assert.equal(hostAudit.activeFixture, null); assert.deepEqual(hostAudit.completedCounts, { HALL_STAGE: 0, SURFACE: 0, JUYI_SCRIPT: 0 }); assert.equal(hostAudit.completedFixtures.length, 0)
  const initialHostCounters = hostAudit.counters
  assert.deepEqual(initialHostCounters.hostFixtureCounts, { HALL_STAGE: 0, SURFACE: 0, JUYI_SCRIPT: 0 })
  for (const [key, value] of Object.entries(initialHostCounters)) if (key !== 'hostFixtureCounts') assert.equal(value, 0, `non-zero host self-audit counter: ${key}`)
  assert.equal(facadeCounters.forbiddenDomCalls, 0); assert.equal(facadeCounters.forbiddenGlobalWrites, 0); assert.equal(facadeCounters.insertStaticContentCalls, 0)
  assert.equal(facadeAudit.pendingTimers, 0); assert.equal(facadeAudit.activeResizeObservers, 0); assert.equal(facadeAudit.windowListeners, 0); assert.equal(facadeAudit.visualViewportListeners, 0); assert.equal(facadeAudit.canvasListeners, 0)
  return Object.freeze(evidence)
}
const manifestEvidence = await selfAudit()
if (auditMode) {
  console.log(JSON.stringify({ cwd, node: process.version, base, selectorRegistrations: 0, canonicalManifest: manifestEvidence, donor: 'PASS', states: ['HALLSTAGE_SFC_LINKED', 'RENDERER_CONTRACT_FROZEN', 'JUYIHALL_SCRIPT_LINKED', 'DYNAMIC_MELON_ACL_FROZEN'], counters: facadeAudit.counters, hostCounters: hostAudit.counters }))
} else {
const vue = donorModules.get('vue').namespace
const Game = compiledArtifacts.gameModule.namespace.JuyitingGame
const sceneModule = compiledArtifacts.sceneModule

const plain = value => value == null ? value : JSON.parse(JSON.stringify(value))
const makeRuntimeFixture = ({ containerRect = completeRect({ left: 0, top: 0, width: 390, height: 844 }), initialCanvasRect = completeRect({ left: 0, top: 0, width: 390, height: 844 }), materializeAgents = true, failOnArmedIdentity = null } = {}) => {
  let currentContainerRect = completeRect(containerRect)
  let currentInitialCanvasRect = completeRect(initialCanvasRect)
  let materialize = Boolean(materializeAgents)
  let currentContainer = null
  let currentCanvas = null
  let armed = false
  let armedIdentities = 0
  const sentinel = new Error('matrix sentinel')
  const trace = { matrixCalls: [], canvasWrites: [], pointerCaptures: [], videoInit: 0, videoDestroy: 0, canvasRemoves: 0, stateSets: [], stateChanges: [], statePauses: 0, worldSorts: 0, agentSupports: 0, asyncOrder: [] }
  const matrix = {}
  for (const [name, body] of Object.entries({
    identity: () => {
      if (armed) { armedIdentities += 1; if (failOnArmedIdentity === armedIdentities) { trace.matrixCalls.push(Object.freeze(['identity', 'throw'])); throw sentinel } }
      trace.matrixCalls.push(Object.freeze(['identity']))
    },
    translate: (x, y) => trace.matrixCalls.push(Object.freeze(['translate', x, y])),
    scale: (x, y) => trace.matrixCalls.push(Object.freeze(['scale', x, y]))
  })) Object.defineProperty(matrix, name, { value: function (...args) { body(...args); return matrix } })
  Object.freeze(matrix)
  const config = {
    get materializeAgents() { return materialize },
    getContainerRect: () => currentContainerRect,
    getInitialCanvasRect: () => currentInitialCanvasRect,
    matrix, trace, sentinel,
    get container() { return currentContainer },
    get currentCanvas() { return currentCanvas },
    stateScenes: new Map(), worldChildren: new Set(),
    control: Object.freeze({
      setContainerRect(value) { currentContainerRect = completeRect(value) },
      setInitialCanvasRect(value) { currentInitialCanvasRect = completeRect(value) },
      setMaterializeAgents(value) { materialize = Boolean(value) },
      setContainer(value) { assert.ok(value); currentContainer = value },
      setCurrentCanvas(value) { assert.ok(value); currentCanvas = value },
      armMatrixFailure() { assert.notEqual(failOnArmedIdentity, null, 'fixture has no failure plan'); armed = true; armedIdentities = 0 },
      clearTrace() { trace.matrixCalls.length = 0; trace.canvasWrites.length = 0; trace.pointerCaptures.length = 0 },
      get armedIdentities() { return armedIdentities }
    })
  }
  return Object.freeze(config)
}
const defaultStageProps = overrides => Object.freeze({
  agentBubbles: Object.freeze({}), agentKey: agent => agent?.agentId || '', agentStyle: () => Object.freeze({}), hiddenAgentCount: 0,
  experienceMode: 'landscape-map', interactionLocked: false, isMobileCoarse: true, landscapeEntryTarget: null, mapResumeSnapshot: null, orientationHint: '', orientationRequestPending: false,
  portraitName: agent => agent?.name || '', portraitShortName: agent => agent?.name || '', portraitStyle: () => Object.freeze({}), refreshing: false, roleClass: () => '', simulationEnabled: false,
  sceneAgents: Object.freeze([]), sceneHotspots: Object.freeze([]), tasks: Object.freeze([]), selectedAgent: null, soundEnabled: true, statusClass: () => '', statusText: () => '', tasksTotal: 0, visibleAgents: Object.freeze([]),
  ...(overrides || {})
})
const eventProp = event => `on${event.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`
const SELECTOR_TRANSACTION_STATES = Object.freeze({ OPEN: 'OPEN', CLEANING: 'CLEANING', CLOSED: 'CLOSED' })
const CLEANUP_ITEM_STATES = Object.freeze({ PENDING: 'PENDING', RUNNING: 'RUNNING', DONE: 'DONE', FAILED: 'FAILED' })
const assertGameTerminal = (game, label = 'Game') => {
  assert.equal(game._viewportCommitFrame, null, `${label} viewport frame leak`)
  assert.equal(game._pendingViewportChange, null, `${label} viewport change leak`)
  assert.equal(game._pendingViewportRestore, null, `${label} viewport restore leak`)
  assert.equal(game._viewportCommitWaiters.length, 0, `${label} viewport waiter leak`)
  assert.equal(game._readyTimer, null, `${label} ready timer leak`)
  assert.equal(game._mountToken, null, `${label} mount token leak`)
  assert.equal(game._hallScene, null, `${label} HallScene leak`)
  assert.equal(game._me, null, `${label} melon facade leak`)
  assert.equal(game._container, null, `${label} container leak`)
  assert.equal(game._canvas, null, `${label} canvas leak`)
}
const secondaryFailure = (category, label, error) => new Error(`${category} ${label}: ${error?.message || String(error)}`, { cause: error })
const createSelectorTransaction = name => {
  let state = SELECTOR_TRANSACTION_STATES.OPEN
  const items = []
  const roots = new Set()
  const games = new Set()
  const scenes = new Set()
  const runItem = async item => {
    if (item.state === CLEANUP_ITEM_STATES.DONE) return
    if (item.state === CLEANUP_ITEM_STATES.FAILED) throw item.error
    assert.equal(item.state, CLEANUP_ITEM_STATES.PENDING, `${name}:${item.label} cleanup state`)
    item.state = CLEANUP_ITEM_STATES.RUNNING
    try {
      await item.cleanup()
      item.state = CLEANUP_ITEM_STATES.DONE
    } catch (error) {
      item.error = error
      item.state = CLEANUP_ITEM_STATES.FAILED
      throw error
    }
  }
  const register = (label, cleanup, ownership = {}) => {
    assert.equal(state, SELECTOR_TRANSACTION_STATES.OPEN, `${name} cleanup registration after close`)
    assert.equal(typeof cleanup, 'function', `${name}:${label} cleanup must be a function`)
    const item = { label, cleanup, state: CLEANUP_ITEM_STATES.PENDING, error: null }
    items.push(item)
    for (const root of ownership.roots || []) roots.add(root)
    for (const game of ownership.games || []) games.add(game)
    for (const scene of ownership.scenes || []) scenes.add(scene)
    const handle = {}
    Object.defineProperties(handle, {
      label: { enumerable: true, value: label },
      state: { enumerable: true, get: () => item.state },
      run: { enumerable: true, value: () => runItem(item) }
    })
    return Object.freeze(handle)
  }
  const audit = () => {
    assert.equal(hostAudit.activeFixture, null, `${name} active host fixture leak`)
    for (const root of roots) assert.equal(hostControl.rootEmpty(root), true, `${name} host root leak`)
    assert.equal(facadeAudit.pendingTimers, 0, `${name} pending timer leak`)
    assert.equal(facadeAudit.windowListeners, 0, `${name} window listener leak`)
    assert.equal(facadeAudit.visualViewportListeners, 0, `${name} visual viewport listener leak`)
    assert.equal(facadeAudit.canvasListeners, 0, `${name} canvas listener leak`)
    assert.equal(facadeAudit.activeResizeObservers, 0, `${name} ResizeObserver leak`)
    assert.equal(dynamicMelonImportGate.audit.pendingWaiters, 0, `${name} dynamic import waiter leak`)
    assert.equal(dynamicMelonImportGate.audit.pendingWatchdogs, 0, `${name} dynamic import watchdog leak`)
    for (const game of games) assertGameTerminal(game, `${name} Game`)
    for (const scene of scenes) assert.equal(scene._destroyed, true, `${name} standalone scene leak`)
    assert.equal(syntheticFailFastCalls, 0, `${name} synthetic dependency call`)
    assert.equal(facadeCounters.forbiddenDomCalls, 0, `${name} forbidden DOM call`)
    assert.equal(facadeCounters.forbiddenGlobalWrites, 0, `${name} forbidden global write`)
    assert.equal(facadeCounters.insertStaticContentCalls, 0, `${name} static content call`)
    assert.equal(hostAudit.counters.hostContractViolations, 0, `${name} host contract violation`)
  }
  const close = async primaryError => {
    assert.equal(state, SELECTOR_TRANSACTION_STATES.OPEN, `${name} transaction close state`)
    state = SELECTOR_TRANSACTION_STATES.CLEANING
    const secondary = []
    for (const item of items.slice().reverse()) {
      if (item.state === CLEANUP_ITEM_STATES.FAILED) {
        if (item.error !== primaryError) secondary.push(secondaryFailure('CLEANUP', item.label, item.error))
        continue
      }
      try { await runItem(item) } catch (error) { if (error !== primaryError) secondary.push(secondaryFailure('CLEANUP', item.label, error)) }
    }
    try { audit() } catch (error) { if (error !== primaryError) secondary.push(secondaryFailure('AUDIT', name, error)) }
    state = SELECTOR_TRANSACTION_STATES.CLOSED
    if (primaryError && secondary.length === 0) return primaryError
    if (primaryError) return new AggregateError([primaryError, ...secondary], `${primaryError.message}; ${secondary.map(error => error.message).join('; ')}`, { cause: primaryError })
    if (secondary.length === 0) return null
    return secondary.length === 1 ? secondary[0] : new AggregateError(secondary, secondary.map(error => error.message).join('; '))
  }
  const transaction = {}
  Object.defineProperties(transaction, {
    state: { enumerable: true, get: () => state },
    register: { enumerable: true, value: register },
    close: { enumerable: true, value: close },
    itemStates: { enumerable: true, value: () => Object.freeze(items.map(item => Object.freeze({ label: item.label, state: item.state }))) }
  })
  return Object.freeze(transaction)
}
const flushMicrotasks = async (count = 1) => { for (let index = 0; index < count; index += 1) await Promise.resolve() }
const microtaskWaitFor = async (predicate, label, limit = 120) => {
  for (let index = 0; index < limit; index += 1) { if (predicate()) return; await Promise.resolve() }
  assert.fail(`timed out waiting for ${label}`)
}
const createMountActivation = (config, label) => Object.freeze({
  label,
  importEntry: dynamicMelonImportGate.expectNext(label),
  timerStart: scheduler.audit.records.length,
  observerStart: resizeObserverControl.latestOrdinal,
  stateSetStart: config.trace.stateSets.length,
  stateChangeStart: config.trace.stateChanges.length
})
const awaitImportEntry = async (config, activation) => {
  const entry = await activation.importEntry.wait()
  assert.equal(entry.state, 'RELEASED', `${activation.label} import gate state`)
  assert.equal(entry.expectedCount, activation.importEntry.expectedCount, `${activation.label} import gate count`)
  assert.equal(entry.importer, DYNAMIC_MELON_IMPORT_CONTRACT.importer, `${activation.label} importer`)
  assert.equal(entry.specifier, DYNAMIC_MELON_IMPORT_CONTRACT.specifier, `${activation.label} specifier`)
  config.trace.asyncOrder.push(Object.freeze(['import-hook-entry', entry.observedCount]))
  return entry
}
const drainLateMount = async (game, activations) => {
  for (const activation of activations) if (activation.importEntry.status === 'WAITING') await awaitImportEntry(game._container ? meControl.current() : meControl.current(), activation)
  await flushMicrotasks(8)
  if (game._mountToken !== null || game._me !== null || game._hallScene !== null || game._container !== null || game._canvas !== null || game._viewportCommitFrame !== null || game._viewportCommitWaiters.length > 0) game.destroy()
  await flushMicrotasks(4)
}
const mountStage = (game, config, props = {}, transaction) => {
  assert.ok(transaction, 'HallStage selector transaction required')
  meControl.configure(config); gameSelectorControl.set(game); facadeControl.setViewport(config.getContainerRect().width || 390, config.getContainerRect().height || 844)
  const root = hostControl.createRoot(config)
  const propsRef = vue.ref(defaultStageProps(props))
  const events = []
  const listeners = {}
  const activations = []
  const initialActivation = createMountActivation(config, 'HallStage initial mount')
  activations.push(initialActivation)
  for (const event of ['landscape-target-consumed', 'map-snapshot', 'map-snapshot-clear', 'new-conversation', 'open-panel', 'request-landscape', 'request-portrait', 'refresh-hall', 'select-agent', 'simulation-phase-events', 'simulation-ready', 'simulation-reset', 'toggle-sound']) listeners[eventProp(event)] = (...args) => events.push(Object.freeze({ event, args: Object.freeze(args) }))
  const Parent = Object.freeze({ name: 'O03StageHarnessParent', setup() { return () => vue.createVNode(compiledArtifacts.hallStage, { ...propsRef.value, ...listeners }) } })
  const app = compiledArtifacts.renderer.createApp(Parent)
  hostControl.openFixture(HOST_FIXTURE_KINDS.HALL_STAGE, root)
  app.mount(root); hostControl.markMounted(root)
  const cleanupItem = transaction.register('HallStage app unmount/host close', async () => {
    hostControl.beginUnmount(root)
    app.unmount()
    await vue.nextTick()
    await drainLateMount(game, activations)
    const fixtureObservers = resizeObserverRecords.filter(record => record.ordinal > initialActivation.observerStart)
    for (const record of fixtureObservers) {
      const snapshot = resizeObserverSnapshot(record)
      assert.equal(snapshot.state, 'disconnected', `HallStage fixture observer ${snapshot.ordinal} cleanup state`)
      assert.equal(snapshot.disconnects, 1, `HallStage fixture observer ${snapshot.ordinal} cleanup count`)
    }
    hostControl.closeFixture(root)
  }, { roots: [root], games: [game] })
  const child = () => app._instance?.subTree?.component
  const state = () => child()?.setupState
  const container = hostControl.findMelon(root)
  assert.ok(container, 'compiled HallStage did not render melon-layer')
  assert.strictEqual(state()?.melonContainerRef, container, 'HallStage template ref must retain raw melon host identity')
  config.control.setContainer(container)
  assert.strictEqual(config.container, container, 'HallStage config container must retain raw melon host identity')
  const expectImportEntry = label => {
    const activation = createMountActivation(config, label)
    activations.push(activation)
    return activation
  }
  return Object.freeze({ game, config, root, app, child, state, container, events, propsRef, initialActivation, expectImportEntry, async updateProps(patch) { hostControl.beginUpdate(root); propsRef.value = defaultStageProps({ ...propsRef.value, ...patch }); await vue.nextTick(); hostControl.endUpdate(root) }, unmount: cleanupItem.run })
}
const mountSurface = (config, transaction) => {
  assert.ok(transaction, 'surface selector transaction required')
  meControl.configure(config)
  const root = hostControl.createRoot(config)
  const Surface = Object.freeze({ name: 'O03Surface', setup() { return () => vue.createVNode('div', { class: 'melon-layer', 'aria-hidden': 'true' }) } })
  const app = compiledArtifacts.renderer.createApp(Surface)
  hostControl.openFixture(HOST_FIXTURE_KINDS.SURFACE, root); app.mount(root); hostControl.markMounted(root)
  const cleanupItem = transaction.register('surface app unmount/host close', async () => { hostControl.beginUnmount(root); app.unmount(); await vue.nextTick(); hostControl.closeFixture(root) }, { roots: [root] })
  const container = hostControl.findMelon(root); assert.ok(container); config.control.setContainer(container)
  return Object.freeze({ root, app, container, unmount: cleanupItem.run })
}
const beginDirectGame = async (game, config, transaction) => {
  const surface = mountSurface(config, transaction); gameSelectorControl.set(game); meControl.configure(config)
  const activations = []
  const cleanupItem = transaction.register('direct Game destroy', async () => { game.destroy(); await drainLateMount(game, activations) }, { games: [game] })
  const generation = game.beginMapGeneration()
  let readyCalls = 0
  const activation = createMountActivation(config, 'direct Game mount')
  activations.push(activation)
  const mountPromise = game.mount(surface.container, { simulationEnabled: false, onReady: () => { readyCalls += 1 } })
  await awaitImportEntry(config, activation)
  await mountPromise
  game.start(); await flushMicrotasks(4)
  assert.equal(readyCalls, 1); assert.equal(game._hallScene?.sceneBuildState, 'ready')
  assert.deepEqual(config.trace.stateSets.slice(activation.stateSetStart), config.trace.stateChanges.slice(activation.stateChangeStart), 'direct Game state.set/state.change order')
  assert.equal(config.trace.stateSets.length - activation.stateSetStart, 1); assert.equal(config.trace.stateChanges.length - activation.stateChangeStart, 1)
  const attemptTimers = scheduler.audit.records.slice(activation.timerStart)
  const readyTimers = attemptTimers.filter(record => record.kind === 'timeout' && record.delay === 200)
  assert.equal(readyTimers.length, 1); assert.equal(readyTimers[0].state, 'cancelled', 'direct Game ready fallback must be cancelled')
  const observers = resizeObserverControl.snapshotsFor(surface.container).filter(record => record.ordinal > activation.observerStart && record.state === 'observing')
  assert.equal(observers.length, 1, 'direct Game owns exactly one active observer')
  return Object.freeze({ game, config, surface, generation, scene: game._hallScene, Scene: game._hallScene.constructor, activation, async cleanup() { await cleanupItem.run(); await surface.unmount() } })
}
const beginStageRetry = (mounted, label) => {
  const activation = mounted.expectImportEntry(label)
  const mountPromise = mounted.state().retryScene()
  return Object.freeze({ activation, mountPromise })
}
const attemptTimer = (activation, delay) => {
  const records = scheduler.audit.records.slice(activation.timerStart).filter(record => record.kind === 'timeout' && record.delay === delay)
  assert.equal(records.length, 1, `${activation.label} timeout:${delay} cardinality`)
  return records[0]
}
const currentAttemptObserverRecords = (activation, container) => Object.freeze(resizeObserverControl.snapshotsFor(container).filter(record => record.ordinal > activation.observerStart))
const currentAttemptActiveObserverRecords = (activation, container) => Object.freeze(currentAttemptObserverRecords(activation, container).filter(record => record.state === 'observing'))
const awaitStageReadyForFinalViewport = async (mounted, stageMount = Object.freeze({ activation: mounted.initialActivation, mountPromise: null })) => {
  const { activation, mountPromise } = stageMount
  await awaitImportEntry(mounted.config, activation)
  if (mountPromise) await mountPromise
  await microtaskWaitFor(() => mounted.game._hallScene?.sceneBuildState === 'ready' && currentAttemptActiveObserverRecords(activation, mounted.container).length === 2, `${activation.label} final viewport observer`)
  const stateSets = mounted.config.trace.stateSets.slice(activation.stateSetStart)
  const stateChanges = mounted.config.trace.stateChanges.slice(activation.stateChangeStart)
  assert.equal(stateSets.length, 1, `${activation.label} state.set count`)
  assert.equal(stateChanges.length, 1, `${activation.label} state.change count`)
  assert.equal(stateSets[0], stateChanges[0], `${activation.label} state.set must precede state.change for the registered id`)
  assert.equal(mounted.game._hallScene.sceneBuildState, 'ready', `${activation.label} onResetEvent scene readiness`)
  const terminalTimer = attemptTimer(activation, 15000)
  const readyTimer = attemptTimer(activation, 200)
  assert.equal(terminalTimer.state, 'cancelled', `${activation.label} terminal timeout must cancel before observer delivery`)
  assert.equal(readyTimer.state, 'cancelled', `${activation.label} ready fallback must cancel before observer delivery`)
  const attemptObservers = currentAttemptObserverRecords(activation, mounted.container)
  const active = currentAttemptActiveObserverRecords(activation, mounted.container)
  assert.equal(attemptObservers.length, 2, `${activation.label} current-attempt observer cardinality`)
  assert.equal(active.length, 2, `${activation.label} pre-final observer roles`)
  const roles = Object.freeze({ game: active[0], final: active[1] })
  assert.strictEqual(roles.game.target, mounted.container, `${activation.label} Game observer target`)
  assert.strictEqual(roles.final.target, mounted.container, `${activation.label} final observer target`)
  assert.strictEqual(mounted.game._container, mounted.container, `${activation.label} Game source container identity`)
  assert.ok(roles.game.ordinal < roles.final.ordinal, `${activation.label} Game observer must precede final observer`)
  assert.equal(roles.game.triggers, 0); assert.equal(roles.final.triggers, 0)
  mounted.config.trace.asyncOrder.push(Object.freeze(['state.set', stateSets[0]]), Object.freeze(['state.change', stateChanges[0]]), Object.freeze(['scene-ready', activation.importEntry.expectedCount]), Object.freeze(['timers-cancelled', terminalTimer.id, readyTimer.id]), Object.freeze(['observer-roles', roles.game.ordinal, roles.final.ordinal]))
  return Object.freeze({ activation, terminalTimer, readyTimer, roles })
}
const triggerFinalViewportObserver = (mounted, ready) => {
  const triggered = resizeObserverControl.triggerOrdinal(ready.roles.final.ordinal)
  assert.strictEqual(triggered.target, mounted.container, `${ready.activation.label} final observer target`)
  assert.equal(triggered.ordinal, ready.roles.final.ordinal, `${ready.activation.label} final observer trigger role`)
  assert.equal(triggered.triggers, 1, `${ready.activation.label} final observer trigger count`)
  mounted.config.trace.asyncOrder.push(Object.freeze(['final-observer', triggered.ordinal]))
}
const awaitFinalViewportWaiter = async (mounted, ready) => {
  triggerFinalViewportObserver(mounted, ready)
  await flushMicrotasks(1)
  assert.equal(mounted.game._viewportCommitWaiters.length, 0, `${ready.activation.label} first HallStage stable frame must not create waiter`)
  await flushMicrotasks(1)
  assert.equal(mounted.game._viewportCommitWaiters.length, 1, `${ready.activation.label} second HallStage stable frame must create one waiter`)
  const final = resizeObserverControl.snapshot(ready.roles.final.ordinal)
  assert.equal(final.state, 'disconnected', `${ready.activation.label} final observer must disconnect before commit`)
  assert.equal(final.disconnects, 1, `${ready.activation.label} final observer commit-gap disconnect count`)
  const active = currentAttemptActiveObserverRecords(ready.activation, mounted.container)
  assert.equal(active.length, 1, `${ready.activation.label} commit-gap current observer roles`)
  assert.equal(active[0].ordinal, ready.roles.game.ordinal, `${ready.activation.label} commit-gap Game observer role`)
  const predecessor = resizeObserverControl.snapshotsFor(mounted.container).filter(record => record.state === 'observing' && record.ordinal <= ready.activation.observerStart)
  for (const record of predecessor) assert.ok(record.ordinal <= ready.activation.observerStart, `${ready.activation.label} predecessor ordinal boundary`)
  const waiter = mounted.game._viewportCommitWaiters[0]
  assert.equal(waiter.status, 'pending')
  mounted.config.trace.asyncOrder.push(Object.freeze(['viewport-waiter-pending', ready.activation.importEntry.expectedCount]))
  return waiter
}
const settleViewportCommitFrames = async (game, waiter, label) => {
  const firstFrame = scheduler.control.pendingIds('timeout', 0)[0]
  assert.ok(firstFrame, `${label} first viewport frame`)
  scheduler.control.fire(firstFrame)
  assert.equal(waiter.status, 'pending', `${label} waiter settled before second stable Game frame`)
  assert.equal(game._viewportCommitWaiters.includes(waiter), true, `${label} waiter removed after first frame`)
  const secondFrame = scheduler.control.pendingIds('timeout', 0)[0]
  assert.ok(secondFrame, `${label} second viewport frame`)
  assert.notEqual(secondFrame, firstFrame, `${label} second viewport frame must be requeued`)
  scheduler.control.fire(secondFrame)
  assert.equal(waiter.status, 'resolved', `${label} waiter did not resolve on second stable Game frame`)
  assert.equal(game._viewportCommitWaiters.includes(waiter), false, `${label} resolved waiter retained`)
  assert.equal(scheduler.control.pendingIds('timeout', 0).length, 0, `${label} hidden timeout-0 advancement`)
}
const assertRunningObserverRoles = (mounted, ready) => {
  const records = currentAttemptObserverRecords(ready.activation, mounted.container)
  const final = records.find(record => record.ordinal === ready.roles.final.ordinal)
  assert.equal(final.state, 'disconnected', `${ready.activation.label} final observer must disconnect`)
  assert.equal(final.disconnects, 1, `${ready.activation.label} final observer disconnect count`)
  const active = currentAttemptActiveObserverRecords(ready.activation, mounted.container)
  assert.equal(active.length, 2, `${ready.activation.label} running observer roles`)
  assert.equal(active[0].ordinal, ready.roles.game.ordinal, `${ready.activation.label} Game observer replacement`)
  const stage = active[1]
  assert.ok(stage.ordinal > ready.roles.final.ordinal, `${ready.activation.label} persistent stage observer order`)
  assert.strictEqual(active[0].target, mounted.container, `${ready.activation.label} running Game observer target`)
  assert.strictEqual(stage.target, mounted.container, `${ready.activation.label} running stage observer target`)
  assert.equal(resizeObserverControl.activeFor(mounted.container), 2, `${ready.activation.label} running total observer roles`)
  return Object.freeze({ game: active[0], stage, final })
}
const completeStageMount = async (mounted, stageMount) => {
  const ready = await awaitStageReadyForFinalViewport(mounted, stageMount)
  const waiter = await awaitFinalViewportWaiter(mounted, ready)
  await settleViewportCommitFrames(mounted.game, waiter, ready.activation.label)
  await microtaskWaitFor(() => mounted.state()?.mapLifecycleState === 'running', `${ready.activation.label} running lifecycle`)
  await flushMicrotasks(4)
  assertRunningObserverRoles(mounted, ready)
  return mounted
}
const assertNoLeaks = root => {
  assert.equal(facadeAudit.pendingTimers, 0, 'pending timer leak')
  assert.equal(facadeAudit.windowListeners, 0, 'window listener leak')
  assert.equal(facadeAudit.visualViewportListeners, 0, 'visual viewport listener leak')
  assert.equal(facadeAudit.canvasListeners, 0, 'canvas listener leak')
  assert.equal(facadeAudit.activeResizeObservers, 0, 'ResizeObserver leak')
  assert.equal(dynamicMelonImportGate.audit.pendingWaiters, 0, 'dynamic import waiter leak')
  assert.equal(dynamicMelonImportGate.audit.pendingWatchdogs, 0, 'dynamic import watchdog leak')
  if (root) assert.equal(hostControl.rootEmpty(root), true, 'host root leak')
}
const assertSelectorTransactionContract = async () => {
  const lifo = []
  const exactOnce = createSelectorTransaction('transaction exact-once probe')
  const first = exactOnce.register('first', async () => { lifo.push('first') })
  exactOnce.register('second', async () => { lifo.push('second') })
  await first.run()
  assert.strictEqual(await exactOnce.close(null), null)
  assert.deepEqual(lifo, ['first', 'second'])
  assert.deepEqual(exactOnce.itemStates(), [{ label: 'first', state: 'DONE' }, { label: 'second', state: 'DONE' }])
  let primary
  try { assert.fail('induced selector timeout assertion') } catch (error) { primary = error }
  const preserving = createSelectorTransaction('transaction primary probe')
  preserving.register('clean', async () => {})
  assert.strictEqual(await preserving.close(primary), primary)
  const aggregating = createSelectorTransaction('transaction aggregate probe')
  aggregating.register('failing cleanup', async () => { throw new Error('induced cleanup failure') })
  const aggregate = await aggregating.close(primary)
  assert.ok(aggregate instanceof AggregateError)
  assert.strictEqual(aggregate.cause, primary)
  assert.strictEqual(aggregate.errors[0], primary)
  assert.match(aggregate.message, /^induced selector timeout assertion;/)
  assert.match(aggregate.errors[1].message, /^CLEANUP failing cleanup:/)
}
await assertSelectorTransactionContract()
const identityRecords = Scene => Object.freeze([
  [Game.prototype, 'commitViewport'], [Game.prototype, 'restoreResumeSnapshot'], [Game.prototype, '_commitViewportGeometry'], [Game.prototype, 'captureResumeSnapshot'], [Game.prototype, 'destroy'], [Game.prototype, 'beginMapGeneration'],
  [Scene.prototype, 'getCameraSnapshot'], [Scene.prototype, 'restoreCameraSnapshot'], [Scene.prototype, 'resizeViewport'], [Scene.prototype, 'syncAgents'], [Scene.prototype, 'syncAgentsAndFocusAgent'], [Scene.prototype, 'focusAgent'], [Scene.prototype, 'focusHotspot'], [Scene.prototype, '_fullSyncAgents'], [Scene.prototype, 'update'], [Scene.prototype, 'onDestroyEvent']
].map(([owner, key]) => Object.freeze({ owner, key, value: owner[key] })))
let selectorPasses = 0
let methodIdentityPasses = 0
const assertIdentities = records => { for (const record of records) { assert.strictEqual(record.owner[record.key], record.value, `${record.key} identity changed`); methodIdentityPasses += 1 } }
const selector = (name, body) => test(name, { concurrency: false }, async () => {
  const transaction = createSelectorTransaction(name)
  let primaryError = null
  try {
    const expectedFixtureDelta = SELECTOR_FIXTURE_DELTAS[name]; assert.ok(expectedFixtureDelta, `missing selector fixture contract: ${name}`)
    assert.equal(hostAudit.activeFixture, null); assert.equal(hostAudit.counters.hostContractViolations, 0)
    const beforeFixtures = hostAudit.completedCounts
    assert.equal(facadeAudit.pendingTimers, 0); assert.equal(facadeAudit.activeResizeObservers, 0); assert.equal(facadeAudit.windowListeners, 0); assert.equal(facadeAudit.visualViewportListeners, 0); assert.equal(facadeAudit.canvasListeners, 0)
    assert.equal(dynamicMelonImportGate.audit.pendingWaiters, 0); assert.equal(dynamicMelonImportGate.audit.pendingWatchdogs, 0)
    const result = await body(transaction)
    const afterFixtures = hostAudit.completedCounts
    const fixtureDelta = Object.fromEntries(Object.values(HOST_FIXTURE_KINDS).map(kind => [kind, afterFixtures[kind] - beforeFixtures[kind]]))
    assert.deepEqual(fixtureDelta, expectedFixtureDelta, `${name} host fixture delta`); assert.equal(hostAudit.activeFixture, null); assert.equal(hostAudit.counters.hostContractViolations, 0)
    assertIdentities(result.identities)
    assert.equal(syntheticFailFastCalls, 0); assert.equal(facadeCounters.forbiddenDomCalls, 0); assert.equal(facadeCounters.forbiddenGlobalWrites, 0)
    assertNoLeaks(result.root)
  } catch (error) {
    primaryError = error
  }
  const terminalError = await transaction.close(primaryError)
  if (terminalError) throw terminalError
  selectorPasses += 1
})
selector('successful ready cancels the terminal timeout before async finalization', async transaction => {
  const game = new Game(); const config = makeRuntimeFixture(); const mounted = mountStage(game, config, {}, transaction)
  const ready = await awaitStageReadyForFinalViewport(mounted)
  const Scene = game._hallScene.constructor; const identities = identityRecords(Scene)
  const terminalRecord = ready.terminalTimer
  assert.ok(terminalRecord); assert.equal(terminalRecord.state, 'cancelled', 'terminal timeout must cancel at handleSceneReady entry')
  const terminalToken = scheduler.control.capture(terminalRecord.id)
  assert.equal(mounted.state().mapLifecycleState, 'mounting'); assert.equal(mounted.state().melonReady, false)
  const waiter = await awaitFinalViewportWaiter(mounted, ready)
  await settleViewportCommitFrames(game, waiter, ready.activation.label)
  await microtaskWaitFor(() => mounted.state().mapLifecycleState === 'running', 'ready running')
  assertRunningObserverRoles(mounted, ready)
  assert.equal(mounted.state().melonReady, true); assert.equal(mounted.state().sceneError, ''); assert.deepEqual([...mounted.state().loadingUnlockedAttempts], [1])
  assert.equal(mounted.events.filter(item => item.event === 'simulation-reset').length, 0)
  assert.equal(resizeObserverControl.activeFor(mounted.container), 2, 'Game and stage observers must remain active')
  await mounted.unmount()
  const eventCount = mounted.events.length; scheduler.control.fireCaptured(terminalToken); await flushMicrotasks(2); assert.equal(mounted.events.length, eventCount)
  return { identities, root: mounted.root }
})
selector('portrait producer preserves exact latest cancel and once semantics with explicit task agent', async transaction => {
  const config = makeRuntimeFixture(); meControl.configure(config)
  const HallAgent = createHallAgentFacade(); const Scene = sceneModule.namespace.createHallSceneClass(meFacade, HallAgent); const standaloneScene = new Scene(); const identities = identityRecords(Scene)
  const game = new Game(); gameSelectorControl.set(game)
  const fixture = createJuyiFixture(vue); juyiControl.set(fixture)
  const root = hostControl.createRoot(config); const app = compiledArtifacts.renderer.createApp(compiledArtifacts.juyiHall); hostControl.openFixture(HOST_FIXTURE_KINDS.JUYI_SCRIPT, root); app.mount(root); hostControl.markMounted(root)
  const appCleanup = transaction.register('JuyiHall app unmount/host close', async () => { hostControl.beginUnmount(root); app.unmount(); await vue.nextTick(); hostControl.closeFixture(root) }, { roots: [root] })
  const sceneCleanup = transaction.register('standalone HallScene destroy', async () => { standaloneScene.onDestroyEvent() }, { scenes: [standaloneScene] })
  const gameCleanup = transaction.register('JuyiHall selector Game destroy', async () => { game.destroy() }, { games: [game] })
  await microtaskWaitFor(() => scheduler.control.pendingIds('interval', 5200).length === 1 && scheduler.control.pendingIds('timeout', 1800).length === 1, 'JuyiHall mount timers')
  const state = app._instance.setupState
  assert.notStrictEqual(state.mapAgents, state.agents); assert.notStrictEqual(state.mapAgents[0], state.agents[0]); assert.equal(state.mapAgents[0].agentId, 'agent-B')
  assert.equal(state.handlePortraitAgentSelect(fixture.agentB), true)
  const g1 = state.landscapeEntryTarget.generation; assert.deepEqual(plain(state.landscapeEntryTarget.target), { kind: 'agent', agentId: 'agent-B' })
  const g2 = state.setLandscapeEntryTarget({ kind: 'hotspot', hotspotId: 'hotspot-1' }); assert.ok(g2 > g1)
  state.handleLandscapeTargetConsumed(g1); assert.equal(state.landscapeEntryTarget.generation, g2)
  state.handleLandscapeTargetConsumed(g2); assert.equal(state.landscapeEntryTarget, null)
  state.handleLandscapeTargetConsumed(g2); assert.equal(state.landscapeEntryTarget, null)
  await state.handlePortraitTaskOpen(fixture.taskB)
  const taskEntry = state.landscapeEntryTarget; assert.deepEqual(plain(taskEntry.target), { kind: 'task', taskId: 'task-B', agentId: 'agent-B' })
  const requestToken = state.requestPortraitLandscape(); assert.equal(requestToken.kind, 'landscape-request')
  assert.deepEqual(plain(state.landscapeEntryTarget.target), { kind: 'task', taskId: 'task-B', agentId: 'agent-B' }); assert.ok(state.landscapeEntryTarget.generation > taskEntry.generation)
  const outsider = Object.freeze({ agentId: 'outsider', personaCode: 'persona-x', name: 'Outsider' })
  assert.equal(state.handlePortraitAgentSelect(outsider), false); await state.handlePortraitTaskOpen(fixture.taskB); state.requestPortraitLandscape()
  assert.ok(state.landscapeEntryTarget === null || state.landscapeEntryTarget.target.kind !== 'task' || state.landscapeEntryTarget.target.agentId === 'outsider')
  await gameCleanup.run(); await sceneCleanup.run(); await appCleanup.run()
  assert.ok(fixture.trace.disposals.includes('taskWorkspaceBinding')); assert.ok(fixture.trace.cleanup.includes('conversation')); assert.ok(fixture.trace.cleanup.includes('debug-stop'))
  return { identities, root }
})
selector('zero geometry cannot settle and positive observed geometry requires two stable fallback frames', async transaction => {
  const zero = completeRect({ left: 0, top: 0, width: 0, height: 0 }); const p1 = completeRect({ left: 0, top: 0, width: 390, height: 844 }); const p2 = completeRect({ left: 0, top: 0, width: 400, height: 844 })
  const game = new Game(); const config = makeRuntimeFixture({ containerRect: zero, initialCanvasRect: completeRect({ left: 0, top: 0, width: 8, height: 8 }) }); const mounted = mountStage(game, config, {}, transaction)
  const ready = await awaitStageReadyForFinalViewport(mounted)
  const identities = identityRecords(game._hallScene.constructor)
  triggerFinalViewportObserver(mounted, ready); await Promise.resolve(); assert.equal(game._viewportCommitWaiters.length, 0)
  config.control.setContainerRect(p1); await Promise.resolve(); assert.equal(game._viewportCommitWaiters.length, 0)
  config.control.setContainerRect(p2); await Promise.resolve(); assert.equal(game._viewportCommitWaiters.length, 0, 'changed positive signature must reset stability')
  await Promise.resolve(); await microtaskWaitFor(() => game._viewportCommitWaiters.length > 0, 'second stable positive frame')
  const waiter = game._viewportCommitWaiters[0]; assert.equal(waiter.status, 'pending')
  await settleViewportCommitFrames(game, waiter, ready.activation.label); await microtaskWaitFor(() => mounted.state().mapLifecycleState === 'running', 'zero geometry recovery running')
  assertRunningObserverRoles(mounted, ready)
  assert.equal(game._committedViewportGeometrySignature, '400:844:1664:928')
  await mounted.unmount()
  const cancelGame = new Game(); const cancelConfig = makeRuntimeFixture({ containerRect: zero }); const cancelled = mountStage(cancelGame, cancelConfig, {}, transaction)
  const cancelReady = await awaitStageReadyForFinalViewport(cancelled)
  triggerFinalViewportObserver(cancelled, cancelReady); await flushMicrotasks(1); await cancelled.unmount(); cancelConfig.control.setContainerRect(p1); await flushMicrotasks(4)
  const cancelledFinal = resizeObserverControl.snapshot(cancelReady.roles.final.ordinal)
  assert.equal(cancelledFinal.state, 'disconnected'); assert.equal(cancelledFinal.disconnects, 1)
  assert.equal(cancelGame._viewportCommitWaiters.length, 0); assert.equal(cancelGame._committedViewportGeometrySignature, '')
  return { identities, root: mounted.root }
})
selector('actual near-edge restore applies source backing display and visible truth before one target commit', async transaction => {
  const config = makeRuntimeFixture({ containerRect: completeRect({ left: 0, top: 0, width: 390, height: 844 }), initialCanvasRect: completeRect({ left: -40.346, top: 0, width: 470.692, height: 844 }) })
  const game = new Game(); const direct = await beginDirectGame(game, config, transaction); const identities = identityRecords(direct.Scene)
  const sourceViewport = { backing: { width: 1664, height: 928 }, display: { width: 390, height: 844 }, visible: { x: 142.6320056427558, y: 0, width: 1378.7359887144883, height: 928 } }
  const primed = direct.scene.restoreCameraSnapshot({ transform: { zoom: 1.2, offsetX: 10, offsetY: -5 }, presetKey: 'desktop' }, sourceViewport)
  assert.ok(primed); config.control.clearTrace()
  const snapshot = game.captureResumeSnapshot(); assert.ok(snapshot); assert.equal(snapshot.schemaVersion, 2); assert.equal(snapshot.mapGeneration, 1)
  assert.deepEqual(plain(snapshot.cameraSnapshot.transform), { zoom: 1.2, offsetX: 10, offsetY: -5 }); assert.deepEqual(plain(snapshot.sourceViewport.backing), { width: 1664, height: 928 }); assert.deepEqual(plain(snapshot.sourceViewport.display), { width: 390, height: 844 })
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(snapshot.sourceViewport.visible[key] - sourceViewport.visible[key]) <= 1e-9, `source visible ${key}`)
  const pending = game.restoreResumeSnapshot(snapshot, { width: 390, height: 844 }); assert.equal(game._viewportCommitWaiters.length, 1)
  const restoreWaiter = game._viewportCommitWaiters[0]; assert.equal(restoreWaiter.status, 'pending')
  await settleViewportCommitFrames(game, restoreWaiter, 'near-edge restore'); const restored = await pending; assert.ok(restored)
  assert.deepEqual(config.trace.canvasWrites.slice(0, 3), [['--juyiting-canvas-display-width', '1513.379px'], ['--juyiting-canvas-display-height', '844px'], ['transform', 'translate(-50%, -50%)']])
  assert.deepEqual(config.trace.matrixCalls.map(call => call[0]), ['identity', 'translate', 'scale', 'translate', 'identity', 'translate', 'scale', 'translate'])
  assert.deepEqual(plain(direct.scene._currentViewport), { width: 1664, height: 928 }); assert.deepEqual(plain(direct.scene._displayViewport), { width: 390, height: 844 })
  assert.ok(Math.abs(direct.scene._visibleViewport.x - 617.5923730935873) <= 1e-9); assert.ok(Math.abs(direct.scene._visibleViewport.width - 428.8152538128255) <= 1e-9)
  assert.deepEqual(plain(direct.scene.getCameraSnapshot().transform), { zoom: 1.2, offsetX: 10, offsetY: -5 })
  assert.equal(game._committedViewportGeometrySignature, '390:844:1664:928'); assert.equal(game._pendingViewportRestore, null); assert.equal(game._pendingViewportChange, null); assert.equal(game._viewportCommitCandidateSignature, ''); assert.equal(game._viewportCommitFrame, null); assert.equal(game._viewportCommitWaiters.length, 0)
  await direct.cleanup(); return { identities, root: direct.surface.root }
})
selector('actual commitViewport rejects once and HallStage performs fatal cleanup', async transaction => {
  const config = makeRuntimeFixture({ containerRect: completeRect({ left: 0, top: 0, width: 8, height: 8 }), initialCanvasRect: completeRect({ left: 0, top: 0, width: 8, height: 8 }), failOnArmedIdentity: 2 })
  const game = new Game(); const mounted = mountStage(game, config, {}, transaction); await completeStageMount(mounted)
  const Scene = game._hallScene.constructor; const retainedScene = game._hallScene; const identities = identityRecords(Scene)
  const snapshot = game.captureResumeSnapshot(); assert.ok(snapshot); await mounted.updateProps({ mapResumeSnapshot: snapshot })
  const resumeMount = beginStageRetry(mounted, 'HallStage resume retry'); await completeStageMount(mounted, resumeMount)
  config.control.clearTrace(); mounted.events.length = 0
  const finalRetry = beginStageRetry(mounted, 'HallStage fatal retry')
  const ready = await awaitStageReadyForFinalViewport(mounted, finalRetry)
  assert.equal(mounted.state().mapLifecycleState, 'resuming')
  assert.equal(mounted.state().sceneMountAttempt, 5)
  assert.equal(mounted.events.filter(item => item.event === 'simulation-reset').length, 1, 'retry teardown reset must occur once')
  mounted.events.length = 0
  config.control.clearTrace(); config.control.armMatrixFailure(); const waiter = await awaitFinalViewportWaiter(mounted, ready)
  assert.equal(waiter.status, 'pending')
  const firstFrame = scheduler.control.pendingIds('timeout', 0)[0]; scheduler.control.fire(firstFrame); assert.equal(waiter.status, 'pending')
  const secondFrame = scheduler.control.pendingIds('timeout', 0)[0]; scheduler.control.fire(secondFrame)
  assert.strictEqual(game._fatalError, config.sentinel); assert.equal(waiter.status, 'rejected'); assert.equal(game._viewportCommitWaiters.length, 0)
  await finalRetry.mountPromise; await microtaskWaitFor(() => mounted.state().mapLifecycleState === 'unmounted', 'fatal HallStage cleanup')
  assert.equal(mounted.state().sceneError, 'matrix sentinel'); assert.equal(mounted.state().sceneMountAttempt, 6); assert.equal(mounted.state().currentGameDestroyed, true); assert.deepEqual([...mounted.state().loadingUnlockedAttempts], [1, 3, 5])
  assert.equal(mounted.events.filter(item => item.event === 'simulation-reset').length, 1); assert.equal(mounted.events.filter(item => item.event === 'map-snapshot-clear').length, 0)
  assert.deepEqual(config.trace.canvasWrites.slice(0, 3), [['--juyiting-canvas-display-width', '14.345px'], ['--juyiting-canvas-display-height', '8px'], ['transform', 'translate(-50%, -50%)']])
  assert.deepEqual(config.trace.matrixCalls.map(call => call[0]), ['identity', 'translate', 'scale', 'translate', 'identity']); assert.equal(config.trace.matrixCalls.at(-1)[1], 'throw')
  assert.equal(game._viewportCommitFrame, null); assert.equal(game._pendingViewportChange, null); assert.equal(game._pendingViewportRestore, null); assert.equal(game._viewportCommitWaiters.length, 0); assert.equal(game._hallScene, null); assert.equal(game._me, null); assert.equal(retainedScene._destroyed, true)
  await mounted.unmount(); return { identities, root: mounted.root }
})
selector('destroy cancels actual pending commit waiter without rejection or leaked frame', async transaction => {
  const config = makeRuntimeFixture(); const game = new Game(); const direct = await beginDirectGame(game, config, transaction); const identities = identityRecords(direct.Scene)
  scheduler.control.fireAll('timeout', 0); await flushMicrotasks(3); config.control.clearTrace()
  const beforeGeneration = game._generation; const pending = game.commitViewport({ width: 390, height: 844, kind: 'layout' }); assert.equal(game._viewportCommitWaiters.length, 1)
  const frameId = scheduler.control.pendingIds('timeout', 0)[0]; const stale = scheduler.control.capture(frameId); const retainedScene = game._hallScene
  game.destroy(); assert.equal(game._generation, beforeGeneration + 1); assert.equal(await pending, undefined); assert.equal(game._viewportCommitWaiters.length, 0); assert.equal(game._viewportCommitFrame, null)
  const writes = config.trace.canvasWrites.length; scheduler.control.fireCaptured(stale); await flushMicrotasks(2); assert.equal(config.trace.canvasWrites.length, writes); assert.equal(retainedScene._destroyed, true)
  await direct.surface.unmount(); return { identities, root: direct.surface.root }
})
selector('delayed optional persona availability rearms only the latest exhausted target for one ACK', async transaction => {
  const agent = Object.freeze({ agentId: 'agent-B', personaCode: 'persona-b', name: 'Agent B' }); const task = Object.freeze({ id: 'task-B', assignedAgentIds: Object.freeze(['agent-B']), assignees: Object.freeze([]) })
  const config = makeRuntimeFixture(); const game = new Game(); const mounted = mountStage(game, config, { sceneAgents: Object.freeze([agent]), tasks: Object.freeze([task]) }, transaction); await completeStageMount(mounted)
  const identities = identityRecords(game._hallScene.constructor)
  assert.ok(game.getSpriteLoadSnapshot().available.has('persona-required')); assert.equal(game.getSpriteLoadSnapshot().available.has('persona-b'), false); assert.equal(game._hallScene.getAgent('agent-B'), undefined)
  const firstTarget = Object.freeze({ generation: 1, target: Object.freeze({ kind: 'task', taskId: 'task-B', agentId: 'agent-B' }) })
  await mounted.updateProps({ landscapeEntryTarget: firstTarget }); await flushMicrotasks(20)
  assert.equal(mounted.state().landscapeTargetWork.attempts, 8); assert.equal(mounted.state().landscapeTargetWork.state, 'exhausted'); assert.equal(mounted.events.filter(item => item.event === 'landscape-target-consumed').length, 0); assert.equal(config.trace.agentSupports, 0)
  const secondTarget = Object.freeze({ generation: 2, target: Object.freeze({ kind: 'task', taskId: 'task-B', agentId: 'agent-B' }) })
  await mounted.updateProps({ landscapeEntryTarget: secondTarget }); await flushMicrotasks(20)
  assert.equal(mounted.state().landscapeTargetWork.targetGeneration, 2); assert.equal(mounted.state().landscapeTargetWork.attempts, 8); assert.equal(mounted.state().landscapeTargetWork.state, 'exhausted'); assert.equal(mounted.events.filter(item => item.event === 'landscape-target-consumed').length, 0)
  const onPersonaAvailabilityChanged = game._callbacks.onPersonaAvailabilityChanged; assert.equal(typeof onPersonaAvailabilityChanged, 'function')
  const deferredTimers = scheduler.control.pendingIds('timeout', 1200); assert.equal(deferredTimers.length, 1); scheduler.control.fire(deferredTimers[0]); await flushMicrotasks(4)
  assert.ok(game.getSpriteLoadSnapshot().available.has('persona-b')); assert.ok(game._hallScene.getAgent('agent-B')); assert.equal(mounted.state().landscapeTargetWork.targetGeneration, 2); assert.equal(mounted.state().landscapeTargetWork.state, 'acknowledged'); assert.equal(mounted.state().landscapeTargetWork.attempts, 1)
  let acknowledgements = mounted.events.filter(item => item.event === 'landscape-target-consumed'); assert.equal(acknowledgements.length, 1); assert.equal(acknowledgements[0].args[0], 2); assert.equal(acknowledgements.some(item => item.args[0] === 1), false); assert.equal(config.trace.agentSupports, 2)
  onPersonaAvailabilityChanged(Object.freeze({ personaCodes: Object.freeze(['persona-b']) })); await flushMicrotasks(2)
  acknowledgements = mounted.events.filter(item => item.event === 'landscape-target-consumed'); assert.equal(acknowledgements.length, 1); assert.equal(mounted.state().landscapeTargetWork.attempts, 1); assert.equal(config.trace.agentSupports, 2); assert.equal(mounted.state().landscapeTargetWork.frame, null); assert.equal(scheduler.control.pendingIds('timeout', 0).length, 0)
  await mounted.updateProps({ experienceMode: 'portrait-command' }); await microtaskWaitFor(() => mounted.state().mapLifecycleState === 'suspended', 'persona availability suspension')
  const suspendedEvents = mounted.events.length; const suspendedSupports = config.trace.agentSupports; const suspendedFrames = scheduler.control.pendingIds('timeout', 0).length; const suspendedTimers = facadeAudit.pendingTimers
  onPersonaAvailabilityChanged(Object.freeze({ personaCodes: Object.freeze(['persona-b']) })); await flushMicrotasks(2)
  assert.equal(mounted.events.length, suspendedEvents); assert.equal(config.trace.agentSupports, suspendedSupports); assert.equal(scheduler.control.pendingIds('timeout', 0).length, suspendedFrames); assert.equal(facadeAudit.pendingTimers, suspendedTimers)
  await mounted.unmount()
  const unmountedEvents = mounted.events.length; const unmountedSupports = config.trace.agentSupports; const unmountedFrames = scheduler.control.pendingIds('timeout', 0).length; const unmountedTimers = facadeAudit.pendingTimers
  onPersonaAvailabilityChanged(Object.freeze({ personaCodes: Object.freeze(['persona-b']) })); await flushMicrotasks(2)
  assert.equal(mounted.events.length, unmountedEvents); assert.equal(config.trace.agentSupports, unmountedSupports); assert.equal(scheduler.control.pendingIds('timeout', 0).length, unmountedFrames); assert.equal(facadeAudit.pendingTimers, unmountedTimers)
  return { identities, root: mounted.root }
})
selector('hotspot focus is immediate while stale target and lifecycle callbacks are fenced', async transaction => {
  const config = makeRuntimeFixture(); const game = new Game(); const mounted = mountStage(game, config, { sceneHotspots: Object.freeze([Object.freeze({ id: 'hotspot-1' })]) }, transaction); await completeStageMount(mounted)
  const identities = identityRecords(game._hallScene.constructor); const oldTimeout = scheduler.audit.records.find(record => record.delay === 15000); const staleTimeout = scheduler.control.capture(oldTimeout.id)
  await mounted.updateProps({ landscapeEntryTarget: Object.freeze({ generation: 1, target: Object.freeze({ kind: 'hotspot', hotspotId: 'hotspot-1' }) }) }); await flushMicrotasks(3)
  let acknowledgements = mounted.events.filter(item => item.event === 'landscape-target-consumed'); assert.equal(acknowledgements.length, 1); assert.equal(acknowledgements[0].args[0], 1)
  await mounted.updateProps({ landscapeEntryTarget: Object.freeze({ generation: 2, target: Object.freeze({ kind: 'hotspot', hotspotId: 'missing-hotspot' }) }) }); await flushMicrotasks(2)
  const retry = beginStageRetry(mounted, 'HallStage hotspot retry'); await completeStageMount(mounted, retry); const before = mounted.events.length; scheduler.control.fireCaptured(staleTimeout); await flushMicrotasks(3); assert.equal(mounted.events.length, before)
  acknowledgements = mounted.events.filter(item => item.event === 'landscape-target-consumed'); assert.equal(acknowledgements.length, 1)
  await mounted.unmount(); return { identities, root: mounted.root }
})
selector('shared map generation is monotonic across two complete HallStage instances without weakening local fences', async transaction => {
  const config = makeRuntimeFixture(); const game = new Game(); const first = mountStage(game, config, {}, transaction); await completeStageMount(first)
  const identities = identityRecords(game._hallScene.constructor); const firstGeneration = game.getMapGeneration(); const firstTimeout = scheduler.audit.records.filter(record => record.delay === 15000).at(-1); const staleTimeout = scheduler.control.capture(firstTimeout.id); const staleResize = windowListenerRegistry.control.capture('resize', 0)
  await first.unmount(); assert.equal(game.getMapGeneration(), firstGeneration)
  const second = mountStage(game, config, {}, transaction); await completeStageMount(second); assert.equal(game.getMapGeneration(), firstGeneration + 1)
  const beforeEvents = second.events.length; const beforeSignature = game._committedViewportGeometrySignature; scheduler.control.fireCaptured(staleTimeout); windowListenerRegistry.control.fireCaptured(staleResize); await flushMicrotasks(4)
  assert.equal(second.events.length, beforeEvents); assert.equal(game._committedViewportGeometrySignature, beforeSignature); assert.equal(second.state().mapLifecycleState, 'running')
  await second.unmount(); assert.equal(game.getMapGeneration(), firstGeneration + 1); assert.equal(game._viewportCommitWaiters.length, 0); assert.equal(game._viewportCommitFrame, null); assert.equal(game._pendingViewportChange, null); assert.equal(game._pendingViewportRestore, null)
  return { identities, root: second.root }
})
test.after(() => {
  assert.equal(selectorPasses, 9); assert.equal(methodIdentityPasses, 144); assert.equal(syntheticFailFastCalls, 0); assert.equal(facadeCounters.forbiddenDomCalls, 0); assert.equal(facadeCounters.forbiddenGlobalWrites, 0); assert.equal(facadeCounters.insertStaticContentCalls, 0)
  assert.equal(facadeCounters.vueTemplateCreateCalls, 1); assert.equal(facadeCounters.vueFormatterPushCalls, 1); assert.equal(facadeCounters.vueHmrRuntimeSets, 1); assert.equal(facadeCounters.vueInstanceSetterPushes, 1); assert.equal(facadeCounters.vueSsrSetterPushes, 1); assert.equal(facadeCounters.vueRendererFlagSets, 1)
  assert.equal(facadeCounters.dynamicMelonImports, 13); assert.equal(dynamicMelonImportGate.audit.observedCount, 13); assert.equal(dynamicMelonImportGate.audit.history.length, 13); assert.ok(dynamicMelonImportGate.audit.history.every(entry => entry.state === 'RELEASED'))
  assert.equal(dynamicMelonImportGate.audit.pendingWaiters, 0); assert.equal(dynamicMelonImportGate.audit.pendingWatchdogs, 0)
  const finalHostCounters = hostAudit.counters
  assert.equal(hostAudit.activeFixture, null); assert.equal(finalHostCounters.hostContractViolations, 0); assert.equal(finalHostCounters.hostFixturesOpened, 11); assert.equal(finalHostCounters.hostFixturesClosed, 11)
  assert.deepEqual(finalHostCounters.hostFixtureCounts, { HALL_STAGE: 8, SURFACE: 2, JUYI_SCRIPT: 1 }); assert.deepEqual(hostAudit.completedCounts, { HALL_STAGE: 8, SURFACE: 2, JUYI_SCRIPT: 1 })
  assert.equal(finalHostCounters.hostCreateElementCalls, finalHostCounters.hostNamespaceUndefinedCalls); assert.equal(finalHostCounters.hostNamespaceNullCalls, 0); assert.equal(finalHostCounters.hostNamespaceStringCalls, 0); assert.equal(finalHostCounters.hostNamespaceOtherCalls, 0)
  assert.ok(finalHostCounters.hostIsNullCalls >= 8); assert.ok(finalHostCounters.hostIsUndefinedCalls > 0); assert.equal(finalHostCounters.hostIsOtherCalls, 0)
  assert.equal(finalHostCounters.hallInitialPrefixPasses, 8); assert.equal(finalHostCounters.surfaceSignaturePasses, 2); assert.equal(finalHostCounters.juyiZeroElementPasses, 1)
  assert.equal(finalHostCounters.detachedRemoveNoops, 0); assert.equal(finalHostCounters.unreachableSetTextCalls, 0); assert.equal(finalHostCounters.duplicateScopeIdCalls, 0); assert.equal(finalHostCounters.unknownNodeCalls, 0); assert.equal(finalHostCounters.invalidAnchorCalls, 0); assert.equal(finalHostCounters.propsUndefinedCreateCalls, 0); assert.equal(finalHostCounters.patchPropNextUndefinedCalls, 0)
  assertNoLeaks(); for (const root of allRoots) assert.equal(hostControl.rootEmpty(root), true, 'final host root leak')
  console.log(JSON.stringify({ cwd, node: process.version, base, selectorPasses, canonicalManifest: manifestEvidence, methodIdentityPasses, syntheticFailFastCalls, forbiddenDomCalls: facadeCounters.forbiddenDomCalls, counters: facadeAudit.counters, dynamicImportGate: { observedCount: dynamicMelonImportGate.audit.observedCount, pendingWaiters: dynamicMelonImportGate.audit.pendingWaiters, pendingWatchdogs: dynamicMelonImportGate.audit.pendingWatchdogs }, hostCounters: finalHostCounters, pendingTimers: facadeAudit.pendingTimers, windowListeners: facadeAudit.windowListeners, visualViewportListeners: facadeAudit.visualViewportListeners, canvasListeners: facadeAudit.canvasListeners, activeResizeObservers: facadeAudit.activeResizeObservers }))
})
}

// ── E7 Atomic Scene Activation ──
// Standalone staging/activation and frame-transaction coordinator.
// It deliberately does not connect to HallScene; E15 owns the active-path switch.

import type { ConstraintResolution } from './constraintResolver.js'
import {
  STABLE_ID_PATTERN,
  isStructuredFatalRenderSchemaError,
} from './schema.js'

export const ACTIVATION_PIPELINE = Object.freeze([
  'parsed',
  'canonicalized',
  'validated',
  'assetsReady',
  'instantiated',
  'constraint',
  'commit',
  'active',
] as const)

export type SceneMode = 'v1' | 'v2'
export type ActivationStage = (typeof ACTIVATION_PIPELINE)[number] | 'frame' | 'dispose'
export type TransactionKind = 'activation' | 'frame'
export type TransactionStatus = 'running' | 'committed' | 'failed' | 'aborted' | 'stale'
export type MaybePromise<T> = T | PromiseLike<T>

export interface SceneActivationNode<T = unknown> {
  readonly stableId: string
  readonly sceneId: string
  readonly mode: SceneMode
  readonly ownerTransactionId: string
  readonly value: T
}

export interface StagedScene<T = unknown> {
  readonly sceneId: string
  readonly mode: SceneMode
  readonly ownerTransactionId: string
  readonly children: readonly SceneActivationNode<T>[]
  readonly order: readonly string[]
  readonly depths: Readonly<Record<string, number>>
  dispose(): MaybePromise<void>
}

export interface ActiveScene<T = unknown> {
  readonly sceneId: string
  readonly mode: SceneMode
  readonly ownerTransactionId: string
  readonly children: readonly SceneActivationNode<T>[]
  readonly order: readonly string[]
  readonly depths: Readonly<Record<string, number>>
  readonly frameVersion: number
}

export interface ActivationRequest<Source> {
  readonly sceneId: string
  readonly mode: SceneMode
  readonly source: Source
  readonly signal?: AbortSignal
}

export interface StageOwnership {
  /** Register a staging-owned cleanup. Cleanups run once, in reverse registration order. */
  track(label: string, cleanup: () => MaybePromise<void>): void
  /** Register ownership and return the resource unchanged. */
  own<T>(label: string, resource: T, dispose: (resource: T) => MaybePromise<void>): T
}

export interface ActivationStageContext extends StageOwnership {
  readonly transactionId: string
  readonly sceneId: string
  readonly mode: SceneMode
  readonly stage: ActivationStage
  readonly signal: AbortSignal
}

export interface ResolvedConstraintOrder {
  readonly order: readonly string[]
}

export interface AtomicSwapContext<T = unknown> {
  readonly transactionId: string
  readonly sceneId: string
  readonly previous: ActiveScene<T> | null
  readonly next: ActiveScene<T>
  /**
   * Perform the single external visible swap. The rollback is registered before
   * apply runs, so an apply/callback throw restores the external old view.
   */
  swap(apply: () => void, rollback: () => void): void
}

export interface AtomicFrameSwapContext<T = unknown> {
  readonly transactionId: string
  readonly sceneId: string
  readonly previous: ActiveScene<T>
  readonly next: ActiveScene<T>
  swap(apply: () => void, rollback: () => void): void
}

export interface SceneActivationHooks<Source, Parsed, Canonical, Validated, Assets, NodeValue = unknown> {
  parse(source: Source, context: ActivationStageContext): MaybePromise<Parsed>
  canonicalize(parsed: Parsed, context: ActivationStageContext): MaybePromise<Canonical>
  validate(canonical: Canonical, context: ActivationStageContext): MaybePromise<Validated>
  loadAssets(validated: Validated, context: ActivationStageContext): MaybePromise<Assets>
  instantiate(
    input: Readonly<{ validated: Validated; assets: Assets }>,
    context: ActivationStageContext,
  ): MaybePromise<StagedScene<NodeValue>>
  validateConstraints(
    scene: StagedScene<NodeValue>,
    context: ActivationStageContext,
  ): MaybePromise<ResolvedConstraintOrder | ConstraintResolution>
  /** Synchronous atomic boundary. Async/thenable returns are rejected. */
  commit?(context: AtomicSwapContext<NodeValue>): void
  /** Synchronous frame boundary. Async/thenable returns are rejected. */
  commitFrame?(context: AtomicFrameSwapContext<NodeValue>): void
}

export interface SceneActivationError extends Error {
  readonly severity: 'fatal'
  readonly source: 'scene-activation'
  readonly retryable: false
  readonly code: string
  readonly errorCode: string
  readonly sceneId: string
  readonly transactionId: string
  readonly stage: ActivationStage
  readonly objectId: string
  readonly field: string
  readonly userMessage: string
  readonly technicalMessage: string
  readonly causeCode?: string
}

export interface ActivationErrorSnapshot {
  readonly severity: 'fatal'
  readonly source: 'scene-activation'
  readonly retryable: false
  readonly code: string
  readonly errorCode: string
  readonly sceneId: string
  readonly transactionId: string
  readonly stage: ActivationStage
  readonly objectId: string
  readonly field: string
  readonly userMessage: string
  readonly technicalMessage: string
  readonly causeCode?: string
}

export interface ActivationDiagnostic {
  readonly sceneId: string
  readonly transactionId: string
  readonly stage: 'dispose' | 'commit' | 'frame'
  readonly code: string
  readonly label: string
  readonly message: string
}

export interface ActiveSceneSnapshot {
  readonly sceneId: string
  readonly mode: SceneMode
  readonly ownerTransactionId: string
  readonly children: readonly Readonly<{
    stableId: string
    sceneId: string
    mode: SceneMode
    ownerTransactionId: string
  }>[]
  readonly order: readonly string[]
  readonly depths: Readonly<Record<string, number>>
  readonly frameVersion: number
}

export interface TransactionSnapshot {
  readonly transactionId: string
  readonly kind: TransactionKind
  readonly sceneId: string
  readonly mode: SceneMode | null
  readonly stage: ActivationStage
  readonly status: TransactionStatus
}

export interface SceneActivationSnapshot {
  readonly status: 'idle' | 'activating' | 'active' | 'error' | 'destroyed'
  readonly active: ActiveSceneSnapshot | null
  readonly transaction: TransactionSnapshot | null
  readonly error: ActivationErrorSnapshot | null
  readonly diagnostics: readonly ActivationDiagnostic[]
}

export type ActivationResult<T = unknown> =
  | Readonly<{
      ok: true
      transactionId: string
      active: ActiveScene<T>
      snapshot: SceneActivationSnapshot
    }>
  | Readonly<{
      ok: false
      transactionId: string
      error: SceneActivationError
      snapshot: SceneActivationSnapshot
    }>

export interface FailedFrameConstraintResult {
  readonly ok: false
  readonly code: string
  readonly message: string
}

export interface SuccessfulFrameConstraintResult extends ResolvedConstraintOrder {
  readonly ok?: true
}

export type FrameConstraintResult =
  | ConstraintResolution
  | SuccessfulFrameConstraintResult
  | FailedFrameConstraintResult

export interface FrameProposal {
  readonly sceneId: string
  readonly activationTransactionId: string
  readonly order: readonly string[]
  readonly depths: Readonly<Record<string, number>>
  readonly constraintResult: FrameConstraintResult
}

export type FrameCommitResult<T = unknown> =
  | Readonly<{
      ok: true
      transactionId: string
      active: ActiveScene<T>
      snapshot: SceneActivationSnapshot
    }>
  | Readonly<{
      ok: false
      transactionId: string
      error: SceneActivationError
      snapshot: SceneActivationSnapshot
    }>

interface CleanupFailure {
  label: string
  error: unknown
}

interface CleanupEntry {
  readonly label: string
  readonly cleanup: () => MaybePromise<void>
  started: boolean
}

class StagingOwnershipScope implements StageOwnership {
  readonly transactionId: string
  readonly sceneId: string
  private readonly _entries: CleanupEntry[] = []
  private readonly _failures: CleanupFailure[] = []
  private _destroyed = false
  private _cleanupChain: Promise<void> = Promise.resolve()

  constructor(transactionId: string, sceneId: string) {
    this.transactionId = transactionId
    this.sceneId = sceneId
  }

  track(label: string, cleanup: () => MaybePromise<void>): void {
    if (typeof cleanup !== 'function') {
      throw new TypeError('staging cleanup must be a function')
    }
    const entry: CleanupEntry = { label, cleanup, started: false }
    this._entries.push(entry)
    if (this._destroyed) this._schedule(entry)
  }

  own<T>(label: string, resource: T, dispose: (resource: T) => MaybePromise<void>): T {
    if (typeof dispose !== 'function') {
      throw new TypeError('staging disposer must be a function')
    }
    this.track(label, () => dispose(resource))
    return resource
  }

  async destroy(): Promise<void> {
    if (!this._destroyed) {
      this._destroyed = true
      for (let index = this._entries.length - 1; index >= 0; index--) {
        this._schedule(this._entries[index])
      }
    }

    // A stale async stage may register ownership after cancellation. Loop until
    // the cleanup chain remains unchanged so those late resources are included.
    while (true) {
      const observed = this._cleanupChain
      await observed
      if (observed === this._cleanupChain) return
    }
  }

  takeFailures(): CleanupFailure[] {
    return this._failures.splice(0, this._failures.length)
  }

  private _schedule(entry: CleanupEntry): void {
    if (entry.started) return
    entry.started = true
    this._cleanupChain = this._cleanupChain.then(async () => {
      try {
        await entry.cleanup()
      } catch (error) {
        this._failures.push({ label: entry.label, error })
      }
    })
  }
}

interface InternalActiveScene<T> {
  readonly scene: ActiveScene<T>
  readonly ownership: StagingOwnershipScope
}

interface InternalActivationTransaction {
  readonly transactionId: string
  readonly sceneId: string
  readonly mode: SceneMode
  readonly controller: AbortController
  readonly ownership: StagingOwnershipScope
  readonly done: Promise<void>
  readonly resolveDone: () => void
  externalAbortCleanup: (() => void) | null
  stage: ActivationStage
  superseded: boolean
}

const STAGE_FAILURE_CODE: Readonly<Record<ActivationStage, string>> = Object.freeze({
  parsed: 'ACTIVATION_PARSE_FAILED',
  canonicalized: 'ACTIVATION_CANONICALIZE_FAILED',
  validated: 'ACTIVATION_VALIDATE_FAILED',
  assetsReady: 'ACTIVATION_ASSET_FAILED',
  instantiated: 'ACTIVATION_INSTANTIATE_FAILED',
  constraint: 'ACTIVATION_CONSTRAINT_FAILED',
  commit: 'ACTIVATION_COMMIT_FAILED',
  active: 'ACTIVATION_ACTIVE_FAILED',
  frame: 'FRAME_TRANSACTION_FAILED',
  dispose: 'ACTIVATION_DISPOSE_FAILED',
})

function safeMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message || error.name
    return String(error)
  } catch {
    return '[unprintable error]'
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
  try {
    return typeof (value as { then?: unknown }).then === 'function'
  } catch {
    return true
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item)
    return Object.freeze(value)
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

function sceneActivationError(
  sceneId: string,
  transactionId: string,
  stage: ActivationStage,
  code: string,
  technicalMessage: string,
  cause?: unknown,
): SceneActivationError {
  const schemaCause = isStructuredFatalRenderSchemaError(cause) ? cause : null
  const finalCode = schemaCause?.errorCode || code
  const err = new Error(technicalMessage) as SceneActivationError
  Object.assign(err, {
    severity: 'fatal' as const,
    source: 'scene-activation' as const,
    retryable: false as const,
    code: finalCode,
    errorCode: finalCode,
    sceneId,
    transactionId,
    stage,
    objectId: schemaCause?.objectId || '(scene)',
    field: schemaCause?.field || stage,
    userMessage: schemaCause?.userMessage || '场景事务失败，未发布任何部分结果。',
    technicalMessage,
    ...(schemaCause ? { causeCode: schemaCause.errorCode } : {}),
  })
  if (Error.captureStackTrace) Error.captureStackTrace(err, sceneActivationError)
  return Object.freeze(err)
}

export function isSceneActivationError(value: unknown): value is SceneActivationError {
  return (
    value instanceof Error
    && (value as SceneActivationError).severity === 'fatal'
    && (value as SceneActivationError).source === 'scene-activation'
    && typeof (value as SceneActivationError).sceneId === 'string'
    && typeof (value as SceneActivationError).transactionId === 'string'
    && typeof (value as SceneActivationError).stage === 'string'
    && typeof (value as SceneActivationError).errorCode === 'string'
  )
}

function errorSnapshot(error: SceneActivationError): ActivationErrorSnapshot {
  return deepFreeze({
    severity: error.severity,
    source: error.source,
    retryable: error.retryable,
    code: error.code,
    errorCode: error.errorCode,
    sceneId: error.sceneId,
    transactionId: error.transactionId,
    stage: error.stage,
    objectId: error.objectId,
    field: error.field,
    userMessage: error.userMessage,
    technicalMessage: error.technicalMessage,
    ...(error.causeCode ? { causeCode: error.causeCode } : {}),
  })
}

function activeSnapshot<T>(active: ActiveScene<T> | null): ActiveSceneSnapshot | null {
  if (!active) return null
  return deepFreeze({
    sceneId: active.sceneId,
    mode: active.mode,
    ownerTransactionId: active.ownerTransactionId,
    children: active.children.map(child => ({
      stableId: child.stableId,
      sceneId: child.sceneId,
      mode: child.mode,
      ownerTransactionId: child.ownerTransactionId,
    })),
    order: [...active.order],
    depths: { ...active.depths },
    frameVersion: active.frameVersion,
  })
}

function freezeActiveScene<T>(input: {
  sceneId: string
  mode: SceneMode
  ownerTransactionId: string
  children: readonly SceneActivationNode<T>[]
  order: readonly string[]
  depths: Readonly<Record<string, number>>
  frameVersion: number
}): ActiveScene<T> {
  const children = input.children.map(child => Object.freeze({
    stableId: child.stableId,
    sceneId: child.sceneId,
    mode: child.mode,
    ownerTransactionId: child.ownerTransactionId,
    value: child.value,
  }))
  return Object.freeze({
    sceneId: input.sceneId,
    mode: input.mode,
    ownerTransactionId: input.ownerTransactionId,
    children: Object.freeze(children),
    order: Object.freeze([...input.order]),
    depths: Object.freeze({ ...input.depths }),
    frameVersion: input.frameVersion,
  })
}

function exactOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false
  }
  return true
}

export function createSceneActivationController<
  Source,
  Parsed,
  Canonical,
  Validated,
  Assets,
  NodeValue = unknown,
>(hooks: SceneActivationHooks<Source, Parsed, Canonical, Validated, Assets, NodeValue>) {
  return new SceneActivationController(hooks)
}

export class SceneActivationController<
  Source,
  Parsed,
  Canonical,
  Validated,
  Assets,
  NodeValue = unknown,
> {
  private readonly _hooks: SceneActivationHooks<Source, Parsed, Canonical, Validated, Assets, NodeValue>
  private _sequence = 0
  private _active: InternalActiveScene<NodeValue> | null = null
  private _current: InternalActivationTransaction | null = null
  private _destroyed = false
  private _destroyPromise: Promise<void> | null = null
  private _commitInProgress = false
  private readonly _diagnostics: ActivationDiagnostic[] = []
  private _snapshot: SceneActivationSnapshot = deepFreeze({
    status: 'idle',
    active: null,
    transaction: null,
    error: null,
    diagnostics: [],
  })

  constructor(hooks: SceneActivationHooks<Source, Parsed, Canonical, Validated, Assets, NodeValue>) {
    this._hooks = hooks
  }

  get active(): ActiveScene<NodeValue> | null {
    return this._active?.scene ?? null
  }

  get snapshot(): SceneActivationSnapshot {
    return this._snapshot
  }

  activate(request: ActivationRequest<Source>): Promise<ActivationResult<NodeValue>> {
    if (this._commitInProgress) {
      return Promise.resolve().then(() => this.activate(request))
    }
    return this._activate(request)
  }

  private async _activate(request: ActivationRequest<Source>): Promise<ActivationResult<NodeValue>> {
    const transactionId = this._nextId('activation')
    if (this._destroyed) {
      const error = sceneActivationError(
        request.sceneId,
        transactionId,
        'parsed',
        'ACTIVATION_CONTROLLER_DESTROYED',
        'scene activation controller has been destroyed',
      )
      return Object.freeze({ ok: false, transactionId, error, snapshot: this._snapshot })
    }

    const controller = new AbortController()
    const ownership = new StagingOwnershipScope(transactionId, request.sceneId)
    let resolveDone!: () => void
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const transaction: InternalActivationTransaction = {
      transactionId,
      sceneId: request.sceneId,
      mode: request.mode,
      controller,
      ownership,
      done,
      resolveDone,
      externalAbortCleanup: null,
      stage: 'parsed',
      superseded: false,
    }

    const previousTransaction = this._current
    this._current = transaction
    if (previousTransaction) {
      previousTransaction.superseded = true
      previousTransaction.controller.abort('superseded')
      void this._disposeScope(previousTransaction.ownership, 'STAGING_DISPOSE_FAILED')
    }

    if (request.signal) {
      const abort = () => controller.abort(request.signal?.reason)
      if (request.signal.aborted) abort()
      else {
        request.signal.addEventListener('abort', abort, { once: true })
        transaction.externalAbortCleanup = () => request.signal?.removeEventListener('abort', abort)
      }
    }

    this._publishTransaction(transaction, 'running', null)

    try {
      if (typeof request.sceneId !== 'string' || request.sceneId.trim() === '') {
        throw sceneActivationError(request.sceneId, transactionId, 'parsed',
          'ACTIVATION_SCENE_ID_INVALID', 'activation sceneId must be a non-empty string')
      }
      if (request.mode !== 'v1' && request.mode !== 'v2') {
        throw sceneActivationError(request.sceneId, transactionId, 'parsed',
          'ACTIVATION_MODE_INVALID', `activation mode must be v1 or v2, got ${String(request.mode)}`)
      }
      const parsed = await this._runStage(transaction, 'parsed', context =>
        this._hooks.parse(request.source, context))
      const canonical = await this._runStage(transaction, 'canonicalized', context =>
        this._hooks.canonicalize(parsed, context))
      const validated = await this._runStage(transaction, 'validated', context =>
        this._hooks.validate(canonical, context))
      const assets = await this._runStage(transaction, 'assetsReady', context =>
        this._hooks.loadAssets(validated, context))
      const prepared = await this._runStage(transaction, 'instantiated', async context => {
        const staged = await this._hooks.instantiate(Object.freeze({ validated, assets }), context)
        const disposer = Reflect.get(staged as object, 'dispose') as unknown
        if (typeof disposer !== 'function') {
          throw sceneActivationError(
            transaction.sceneId,
            transaction.transactionId,
            'instantiated',
            'ACTIVATION_STAGING_DISPOSER_MISSING',
            'instantiated staging scene must expose dispose()',
          )
        }
        ownership.track('staged-scene', () => disposer.call(staged))
        return this._prepareActiveScene(staged, transaction)
      })

      await this._runStage(transaction, 'constraint', async context => {
        const result = await this._hooks.validateConstraints(
          this._activeToStagedView(prepared),
          context,
        )
        if (!result || !Array.isArray(result.order)) {
          throw sceneActivationError(
            transaction.sceneId,
            transaction.transactionId,
            'constraint',
            'ACTIVATION_CONSTRAINT_RESULT_INVALID',
            'constraint validation must return a complete order',
          )
        }
        if (!exactOrder(result.order, prepared.order)) {
          throw sceneActivationError(
            transaction.sceneId,
            transaction.transactionId,
            'constraint',
            'ACTIVATION_CONSTRAINT_ORDER_MISMATCH',
            'constraint order does not match prepared staging order',
          )
        }
      })

      const committed = await this._commitActivation(transaction, prepared)
      return Object.freeze({
        ok: true,
        transactionId,
        active: committed,
        snapshot: this._snapshot,
      })
    } catch (cause) {
      const error = isSceneActivationError(cause)
        ? cause
        : this._wrapStageFailure(transaction, transaction.stage, cause)
      await this._disposeScope(ownership, 'STAGING_DISPOSE_FAILED')
      if (this._current === transaction) {
        this._current = null
        this._publishFailure(transaction, error)
      }
      return Object.freeze({ ok: false, transactionId, error, snapshot: this._snapshot })
    } finally {
      transaction.externalAbortCleanup?.()
      transaction.resolveDone()
    }
  }

  commitFrame(proposal: FrameProposal): FrameCommitResult<NodeValue> {
    const transactionId = this._nextId('frame')
    const active = this._active
    const sceneId = proposal.sceneId

    if (this._destroyed) {
      return this._frameFailure(sceneId, transactionId, sceneActivationError(
        sceneId, transactionId, 'frame', 'ACTIVATION_CONTROLLER_DESTROYED',
        'scene activation controller has been destroyed',
      ), false)
    }
    if (this._commitInProgress || this._current) {
      return this._frameFailure(sceneId, transactionId, sceneActivationError(
        sceneId, transactionId, 'frame', 'FRAME_TRANSACTION_BUSY',
        'cannot commit a frame while another scene transaction is in progress',
      ), false)
    }
    if (!active) {
      return this._frameFailure(sceneId, transactionId, sceneActivationError(
        sceneId, transactionId, 'frame', 'FRAME_ACTIVE_SCENE_MISSING',
        'cannot commit a frame without an active scene',
      ), true)
    }

    let nextScene: ActiveScene<NodeValue>
    try {
      nextScene = this._prepareFrame(proposal, active.scene, transactionId)
    } catch (cause) {
      const error = isSceneActivationError(cause)
        ? cause
        : sceneActivationError(sceneId, transactionId, 'frame', 'FRAME_TRANSACTION_FAILED',
          `frame preparation failed: ${safeMessage(cause)}`, cause)
      return this._frameFailure(sceneId, transactionId, error, true)
    }

    const previous = active
    const next: InternalActiveScene<NodeValue> = {
      scene: nextScene,
      ownership: previous.ownership,
    }
    const rollbacks: Array<() => void> = []
    let externalSwapUsed = false
    const context: AtomicFrameSwapContext<NodeValue> = Object.freeze({
      transactionId,
      sceneId,
      previous: previous.scene,
      next: next.scene,
      swap: (apply: () => void, rollback: () => void) => {
        if (externalSwapUsed) {
          throw sceneActivationError(sceneId, transactionId, 'frame',
            'FRAME_MULTIPLE_SWAPS', 'frame commit attempted more than one external swap')
        }
        if (typeof apply !== 'function' || typeof rollback !== 'function') {
          throw sceneActivationError(sceneId, transactionId, 'frame',
            'FRAME_SWAP_INVALID', 'frame swap requires synchronous apply and rollback functions')
        }
        externalSwapUsed = true
        rollbacks.push(rollback)
        const result = apply()
        if (isThenable(result)) {
          throw sceneActivationError(sceneId, transactionId, 'frame',
            'FRAME_ASYNC_COMMIT_UNSUPPORTED', 'frame swap apply must be synchronous')
        }
      },
    })

    this._commitInProgress = true
    this._active = next
    try {
      const result = this._hooks.commitFrame?.(context)
      if (isThenable(result)) {
        throw sceneActivationError(sceneId, transactionId, 'frame',
          'FRAME_ASYNC_COMMIT_UNSUPPORTED', 'frame commit callback must be synchronous')
      }
    } catch (cause) {
      this._active = previous
      this._runRollbacks(rollbacks, sceneId, transactionId, 'frame')
      this._commitInProgress = false
      const error = isSceneActivationError(cause)
        ? cause
        : sceneActivationError(sceneId, transactionId, 'frame', 'FRAME_COMMIT_FAILED',
          `frame commit callback failed: ${safeMessage(cause)}`, cause)
      return this._frameFailure(sceneId, transactionId, error, true)
    }
    this._commitInProgress = false

    this._publish({
      status: 'active',
      active: activeSnapshot(next.scene),
      transaction: {
        transactionId,
        kind: 'frame',
        sceneId,
        mode: next.scene.mode,
        stage: 'frame',
        status: 'committed',
      },
      error: null,
    })
    return Object.freeze({ ok: true, transactionId, active: next.scene, snapshot: this._snapshot })
  }

  destroy(): Promise<void> {
    if (this._destroyPromise) return this._destroyPromise
    if (this._commitInProgress) {
      this._destroyPromise = Promise.resolve().then(() => this._destroyInternal())
    } else {
      this._destroyPromise = this._destroyInternal()
    }
    return this._destroyPromise
  }

  private async _destroyInternal(): Promise<void> {
    if (this._destroyed) return
    this._destroyed = true
    const transaction = this._current
    const active = this._active
    this._current = null
    this._active = null
    if (transaction) transaction.controller.abort('controller-destroyed')
    this._publish({ status: 'destroyed', active: null, transaction: null, error: null })

    const work: Promise<unknown>[] = []
    if (transaction) {
      work.push(this._disposeScope(transaction.ownership, 'STAGING_DISPOSE_FAILED'))
      work.push(transaction.done)
    }
    if (active) work.push(this._disposeScope(active.ownership, 'ACTIVE_DISPOSE_FAILED'))
    await Promise.all(work)
  }

  private async _runStage<T>(
    transaction: InternalActivationTransaction,
    stage: ActivationStage,
    operation: (context: ActivationStageContext) => MaybePromise<T>,
  ): Promise<T> {
    transaction.stage = stage
    this._assertLive(transaction, stage)
    this._publishTransaction(transaction, 'running', null)
    const context = this._stageContext(transaction, stage)
    let value: T
    try {
      value = await operation(context)
    } catch (cause) {
      this._assertLive(transaction, stage)
      if (isSceneActivationError(cause)) throw cause
      throw this._wrapStageFailure(transaction, stage, cause)
    }
    this._assertLive(transaction, stage)
    return value
  }

  private async _commitActivation(
    transaction: InternalActivationTransaction,
    prepared: ActiveScene<NodeValue>,
  ): Promise<ActiveScene<NodeValue>> {
    transaction.stage = 'commit'
    this._assertLive(transaction, 'commit')
    this._publishTransaction(transaction, 'running', null)

    const previous = this._active
    const next: InternalActiveScene<NodeValue> = {
      scene: prepared,
      ownership: transaction.ownership,
    }
    const rollbacks: Array<() => void> = []
    let externalSwapUsed = false
    const context: AtomicSwapContext<NodeValue> = Object.freeze({
      transactionId: transaction.transactionId,
      sceneId: transaction.sceneId,
      previous: previous?.scene ?? null,
      next: next.scene,
      swap: (apply: () => void, rollback: () => void) => {
        if (externalSwapUsed) {
          throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'commit',
            'ACTIVATION_MULTIPLE_SWAPS', 'activation commit attempted more than one external swap')
        }
        if (typeof apply !== 'function' || typeof rollback !== 'function') {
          throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'commit',
            'ACTIVATION_SWAP_INVALID', 'activation swap requires synchronous apply and rollback functions')
        }
        externalSwapUsed = true
        rollbacks.push(rollback)
        const result = apply()
        if (isThenable(result)) {
          throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'commit',
            'ACTIVATION_ASYNC_COMMIT_UNSUPPORTED', 'activation swap apply must be synchronous')
        }
      },
    })

    this._commitInProgress = true
    this._active = next
    try {
      const result = this._hooks.commit?.(context)
      if (isThenable(result)) {
        throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'commit',
          'ACTIVATION_ASYNC_COMMIT_UNSUPPORTED', 'activation commit callback must be synchronous')
      }
      this._assertLive(transaction, 'commit')
    } catch (cause) {
      this._active = previous
      this._runRollbacks(rollbacks, transaction.sceneId, transaction.transactionId, 'commit')
      this._commitInProgress = false
      if (isSceneActivationError(cause)) throw cause
      throw sceneActivationError(
        transaction.sceneId,
        transaction.transactionId,
        'commit',
        'ACTIVATION_COMMIT_FAILED',
        `activation commit callback failed: ${safeMessage(cause)}`,
        cause,
      )
    }
    this._commitInProgress = false

    if (this._current === transaction) this._current = null
    transaction.stage = 'active'
    this._publish({
      status: 'active',
      active: activeSnapshot(next.scene),
      transaction: {
        transactionId: transaction.transactionId,
        kind: 'activation',
        sceneId: transaction.sceneId,
        mode: transaction.mode,
        stage: 'active',
        status: 'committed',
      },
      error: null,
    })

    if (previous) await this._disposeScope(previous.ownership, 'ACTIVE_DISPOSE_FAILED')
    return next.scene
  }

  private _prepareActiveScene(
    staged: StagedScene<NodeValue>,
    transaction: InternalActivationTransaction,
  ): ActiveScene<NodeValue> {
    if (!staged || typeof staged !== 'object') {
      throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
        'ACTIVATION_STAGING_INVALID', 'instantiate must return a staging scene object')
    }
    if (staged.sceneId !== transaction.sceneId) {
      throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
        'ACTIVATION_SCENE_MISMATCH',
        `staging sceneId ${String(staged.sceneId)} does not match request ${transaction.sceneId}`)
    }
    if (staged.mode !== transaction.mode) {
      throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
        'ACTIVATION_MODE_MISMATCH',
        `staging mode ${String(staged.mode)} does not match request ${transaction.mode}`)
    }
    if (staged.ownerTransactionId !== transaction.transactionId) {
      throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
        'ACTIVATION_OWNERSHIP_INVALID',
        `staging owner ${String(staged.ownerTransactionId)} does not match transaction ${transaction.transactionId}`)
    }
    if (!Array.isArray(staged.children)) {
      throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
        'ACTIVATION_CHILDREN_INVALID', 'staging children must be an array')
    }

    const children: SceneActivationNode<NodeValue>[] = []
    const nodeIds: string[] = []
    const seen = new Set<string>()
    for (const child of staged.children) {
      if (!child || typeof child !== 'object') {
        throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
          'ACTIVATION_CHILD_INVALID', 'every staging child must be an owned node')
      }
      if (typeof child.stableId !== 'string' || !STABLE_ID_PATTERN.test(child.stableId)) {
        throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
          'STABLE_ID_INVALID_PATTERN', `invalid child stableId ${String(child.stableId)}`)
      }
      if (seen.has(child.stableId)) {
        throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
          'STABLE_ID_DUPLICATE', `duplicate child stableId ${child.stableId}`)
      }
      if (child.sceneId !== transaction.sceneId) {
        throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
          'ACTIVATION_CHILD_SCENE_MISMATCH', `child ${child.stableId} belongs to ${String(child.sceneId)}`)
      }
      if (child.mode !== transaction.mode) {
        throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
          'ACTIVATION_MODE_MIXED', `child ${child.stableId} mode ${String(child.mode)} mixes with ${transaction.mode}`)
      }
      if (child.ownerTransactionId !== transaction.transactionId) {
        throw sceneActivationError(transaction.sceneId, transaction.transactionId, 'instantiated',
          'ACTIVATION_OWNERSHIP_INVALID',
          `child ${child.stableId} owner ${String(child.ownerTransactionId)} does not match ${transaction.transactionId}`)
      }
      seen.add(child.stableId)
      nodeIds.push(child.stableId)
      children.push(child)
    }

    const frame = this._validateCompleteFrame(
      nodeIds,
      staged.order,
      staged.depths,
      transaction.sceneId,
      transaction.transactionId,
      'instantiated',
    )
    return freezeActiveScene({
      sceneId: transaction.sceneId,
      mode: transaction.mode,
      ownerTransactionId: transaction.transactionId,
      children,
      order: frame.order,
      depths: frame.depths,
      frameVersion: 0,
    })
  }

  private _prepareFrame(
    proposal: FrameProposal,
    active: ActiveScene<NodeValue>,
    transactionId: string,
  ): ActiveScene<NodeValue> {
    if (proposal.sceneId !== active.sceneId) {
      throw sceneActivationError(proposal.sceneId, transactionId, 'frame',
        'FRAME_SCENE_MISMATCH', `frame targets ${proposal.sceneId}, active scene is ${active.sceneId}`)
    }
    if (proposal.activationTransactionId !== active.ownerTransactionId) {
      throw sceneActivationError(proposal.sceneId, transactionId, 'frame',
        'FRAME_STALE_ACTIVATION',
        `frame owner ${proposal.activationTransactionId} does not match active ${active.ownerTransactionId}`)
    }
    const constraint = proposal.constraintResult
    if (!constraint || typeof constraint !== 'object') {
      throw sceneActivationError(proposal.sceneId, transactionId, 'frame',
        'FRAME_CONSTRAINT_RESULT_INVALID', 'frame constraint result is missing')
    }
    if ('ok' in constraint && constraint.ok === false) {
      throw sceneActivationError(proposal.sceneId, transactionId, 'frame',
        constraint.code || 'CONSTRAINT_CYCLE_DETECTED',
        `frame constraint failed: ${constraint.message}`)
    }
    if (!Array.isArray(constraint.order)) {
      throw sceneActivationError(proposal.sceneId, transactionId, 'frame',
        'FRAME_CONSTRAINT_RESULT_INVALID', 'frame constraint result must contain a complete order')
    }
    if (!exactOrder(constraint.order, proposal.order)) {
      throw sceneActivationError(proposal.sceneId, transactionId, 'frame',
        'FRAME_CONSTRAINT_ORDER_MISMATCH', 'proposed frame order differs from constraint result')
    }

    const nodeIds = active.children.map(child => child.stableId)
    const frame = this._validateCompleteFrame(
      nodeIds,
      proposal.order,
      proposal.depths,
      proposal.sceneId,
      transactionId,
      'frame',
    )
    return freezeActiveScene({
      sceneId: active.sceneId,
      mode: active.mode,
      ownerTransactionId: active.ownerTransactionId,
      children: active.children,
      order: frame.order,
      depths: frame.depths,
      frameVersion: active.frameVersion + 1,
    })
  }

  private _validateCompleteFrame(
    nodeIds: readonly string[],
    proposedOrder: readonly string[],
    proposedDepths: Readonly<Record<string, number>>,
    sceneId: string,
    transactionId: string,
    stage: 'instantiated' | 'frame',
  ): { order: readonly string[]; depths: Readonly<Record<string, number>> } {
    if (!Array.isArray(proposedOrder)) {
      throw sceneActivationError(sceneId, transactionId, stage,
        'FRAME_ORDER_INVALID', 'complete order must be an array')
    }
    if (!proposedDepths || typeof proposedDepths !== 'object' || Array.isArray(proposedDepths)) {
      throw sceneActivationError(sceneId, transactionId, stage,
        'FRAME_DEPTHS_INVALID', 'complete depths must be an object')
    }
    if (proposedOrder.length > nodeIds.length) {
      throw sceneActivationError(sceneId, transactionId, stage,
        'FRAME_NODE_COUNT_MISMATCH',
        `order count ${proposedOrder.length} exceeds node count ${nodeIds.length}`)
    }

    const nodeSet = new Set(nodeIds)
    const orderSet = new Set<string>()
    for (const stableId of proposedOrder) {
      if (typeof stableId !== 'string') {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_ORDER_INVALID', 'frame order entries must be stableId strings')
      }
      if (orderSet.has(stableId)) {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_ORDER_DUPLICATE', `duplicate order stableId ${stableId}`)
      }
      if (!nodeSet.has(stableId)) {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_NODE_UNKNOWN', `order contains unknown node ${stableId}`)
      }
      orderSet.add(stableId)
    }
    for (const stableId of nodeIds) {
      if (!orderSet.has(stableId)) {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_NODE_MISSING', `order is missing node ${stableId}`)
      }
    }

    const depthKeys = Object.keys(proposedDepths)
    if (depthKeys.length > nodeIds.length) {
      throw sceneActivationError(sceneId, transactionId, stage,
        'FRAME_DEPTH_COUNT_MISMATCH',
        `depth count ${depthKeys.length} exceeds node count ${nodeIds.length}`)
    }
    for (const stableId of depthKeys) {
      if (!nodeSet.has(stableId)) {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_DEPTH_NODE_UNKNOWN', `depths contain unknown node ${stableId}`)
      }
    }

    const depths: Record<string, number> = {}
    let expectedDepth: number | null = null
    for (const stableId of proposedOrder) {
      if (!Object.prototype.hasOwnProperty.call(proposedDepths, stableId)) {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_DEPTH_NODE_MISSING', `depths are missing node ${stableId}`)
      }
      const depth = proposedDepths[stableId]
      if (!Number.isSafeInteger(depth)) {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_DEPTH_NOT_INTEGER', `depth for ${stableId} must be a safe integer`)
      }
      if (expectedDepth === null) expectedDepth = depth
      if (depth !== expectedDepth) {
        throw sceneActivationError(sceneId, transactionId, stage,
          'FRAME_DEPTH_NONCONTINUOUS',
          `depth for ${stableId} is ${depth}; expected contiguous depth ${expectedDepth}`)
      }
      depths[stableId] = depth
      expectedDepth++
    }

    return {
      order: Object.freeze([...proposedOrder]),
      depths: Object.freeze(depths),
    }
  }

  private _activeToStagedView(active: ActiveScene<NodeValue>): StagedScene<NodeValue> {
    return Object.freeze({
      sceneId: active.sceneId,
      mode: active.mode,
      ownerTransactionId: active.ownerTransactionId,
      children: active.children,
      order: active.order,
      depths: active.depths,
      // Constraint validation cannot own/dispose the prepared scene.
      dispose: () => undefined,
    })
  }

  private _stageContext(
    transaction: InternalActivationTransaction,
    stage: ActivationStage,
  ): ActivationStageContext {
    return Object.freeze({
      transactionId: transaction.transactionId,
      sceneId: transaction.sceneId,
      mode: transaction.mode,
      stage,
      signal: transaction.controller.signal,
      track: (label: string, cleanup: () => MaybePromise<void>) => transaction.ownership.track(label, cleanup),
      own: <T>(label: string, resource: T, dispose: (resource: T) => MaybePromise<void>) =>
        transaction.ownership.own(label, resource, dispose),
    })
  }

  private _assertLive(transaction: InternalActivationTransaction, stage: ActivationStage): void {
    if (transaction.superseded || (this._current !== transaction && !this._destroyed)) {
      throw sceneActivationError(transaction.sceneId, transaction.transactionId, stage,
        'ACTIVATION_STALE', 'stale activation transaction cannot advance or commit')
    }
    if (transaction.controller.signal.aborted || this._destroyed) {
      throw sceneActivationError(transaction.sceneId, transaction.transactionId, stage,
        'ACTIVATION_ABORTED', 'activation transaction was aborted')
    }
  }

  private _wrapStageFailure(
    transaction: InternalActivationTransaction,
    stage: ActivationStage,
    cause: unknown,
  ): SceneActivationError {
    return sceneActivationError(
      transaction.sceneId,
      transaction.transactionId,
      stage,
      STAGE_FAILURE_CODE[stage],
      `${stage} stage failed: ${safeMessage(cause)}`,
      cause,
    )
  }

  private async _disposeScope(scope: StagingOwnershipScope, code: string): Promise<void> {
    await scope.destroy()
    const failures = scope.takeFailures()
    if (failures.length === 0) return
    const diagnostics = failures.map(failure => deepFreeze({
      sceneId: scope.sceneId,
      transactionId: scope.transactionId,
      stage: 'dispose' as const,
      code,
      label: failure.label,
      message: safeMessage(failure.error),
    }))
    this._diagnostics.push(...diagnostics)
    this._republishDiagnostics()
  }

  private _runRollbacks(
    rollbacks: readonly (() => void)[],
    sceneId: string,
    transactionId: string,
    stage: 'commit' | 'frame',
  ): void {
    for (let index = rollbacks.length - 1; index >= 0; index--) {
      try {
        const result = rollbacks[index]()
        if (isThenable(result)) throw new Error('rollback must be synchronous')
      } catch (error) {
        this._diagnostics.push(deepFreeze({
          sceneId,
          transactionId,
          stage,
          code: stage === 'frame' ? 'FRAME_ROLLBACK_FAILED' : 'ACTIVATION_ROLLBACK_FAILED',
          label: 'external-swap',
          message: safeMessage(error),
        }))
      }
    }
    this._republishDiagnostics()
  }

  private _frameFailure(
    sceneId: string,
    transactionId: string,
    error: SceneActivationError,
    publish: boolean,
  ): FrameCommitResult<NodeValue> {
    if (publish) {
      this._publish({
        status: this._active ? 'active' : 'error',
        active: activeSnapshot(this._active?.scene ?? null),
        transaction: {
          transactionId,
          kind: 'frame',
          sceneId,
          mode: this._active?.scene.mode ?? null,
          stage: 'frame',
          status: 'failed',
        },
        error: errorSnapshot(error),
      })
    }
    return Object.freeze({ ok: false, transactionId, error, snapshot: this._snapshot })
  }

  private _publishTransaction(
    transaction: InternalActivationTransaction,
    status: TransactionStatus,
    error: SceneActivationError | null,
  ): void {
    if (this._current !== transaction) return
    this._publish({
      status: 'activating',
      active: activeSnapshot(this._active?.scene ?? null),
      transaction: {
        transactionId: transaction.transactionId,
        kind: 'activation',
        sceneId: transaction.sceneId,
        mode: transaction.mode,
        stage: transaction.stage,
        status,
      },
      error: error ? errorSnapshot(error) : null,
    })
  }

  private _publishFailure(
    transaction: InternalActivationTransaction,
    error: SceneActivationError,
  ): void {
    const status: TransactionStatus = error.errorCode === 'ACTIVATION_ABORTED'
      ? 'aborted'
      : error.errorCode === 'ACTIVATION_STALE'
        ? 'stale'
        : 'failed'
    this._publish({
      status: this._active ? 'active' : 'error',
      active: activeSnapshot(this._active?.scene ?? null),
      transaction: {
        transactionId: transaction.transactionId,
        kind: 'activation',
        sceneId: transaction.sceneId,
        mode: transaction.mode,
        stage: transaction.stage,
        status,
      },
      error: errorSnapshot(error),
    })
  }

  private _publish(input: Omit<SceneActivationSnapshot, 'diagnostics'>): void {
    this._snapshot = deepFreeze({
      ...input,
      diagnostics: this._diagnostics.map(diagnostic => ({ ...diagnostic })),
    })
  }

  private _republishDiagnostics(): void {
    this._snapshot = deepFreeze({
      status: this._snapshot.status,
      active: this._snapshot.active,
      transaction: this._snapshot.transaction,
      error: this._snapshot.error,
      diagnostics: this._diagnostics.map(diagnostic => ({ ...diagnostic })),
    })
  }

  private _nextId(kind: TransactionKind): string {
    this._sequence++
    return `${kind}-${this._sequence}`
  }
}

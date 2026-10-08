import { expect } from 'chai'
import { ref } from 'vue'
import { useHallTaskLinkedReferenceInputs } from '../src/composables/juyiting/hallTaskLinkedReferenceInputs.js'
import { useHallPointAndStart } from '../src/composables/juyiting/useHallPointAndStart.js'

const taskLink = (overrides = {}) => ({
  relationId: 'relation-1', taskId: 'task-1', fileId: 'image-b', version: 2,
  role: 'REFERENCE', state: 'ACTIVE', relationRevision: 1, createdAt: 1, ...overrides
})
const version = (fileId, number, contentMimeType = 'image/png') => ({
  fileId, version: number, originalFilename: `${fileId}-v${number}.png`, contentMimeType, byteLength: 12
})
const fileDetail = (fileId, versions = [version(fileId, 2)], overrides = {}) => {
  const { file: fileOverrides = {}, ...rootOverrides } = overrides
  return { ...rootOverrides,
    file: { fileId, displayName: fileId, originKind: 'USER_UPLOAD', state: 'ACTIVE', latestVersion: versions.at(-1).version, metadataRevision: 1,
      ...fileOverrides },
    latestVersion: versions.at(-1), versions, relations: [], derivation: [] }
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const apiHarness = ({ pages = [{ items: [], nextCursor: null }], details = {}, fail } = {}) => {
  const calls = []
  const api = { execute: async options => {
    calls.push(options)
    if (fail) return fail(options)
    if (options.url.includes('/file-links')) {
      const cursor = options.params?.cursor
      const index = cursor ? Number(cursor.replace('page-', '')) : 0
      return { data: pages[index] }
    }
    const fileId = decodeURIComponent(options.url.split('/').at(-1))
    const detail = details[fileId]
    if (detail instanceof Error) throw detail
    return { data: detail }
  } }
  return { api, calls }
}
const owned = []
const resolverHarness = options => {
  const identity = options.identity || ref('owner-a\u00001')
  const http = apiHarness(options)
  const resolver = useHallTaskLinkedReferenceInputs({ identityEpoch: identity, taskLinksApi: http.api, workspaceApi: http.api })
  owned.push(resolver)
  return { ...http, identity, resolver }
}

const memoryStorage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

const inputFact = input => ({ ...input, contentMimeType: 'image/png', byteLength: '12', contentHash: 'b'.repeat(64) })

describe('task-linked reference input resolver', () => {
  afterEach(() => { for (const value of owned.splice(0)) value.dispose() })

  it('drains every page, ignores non-active/non-reference links, preserves linked old versions, and reuses one exact file detail', async () => {
    const h = resolverHarness({
      pages: [
        { items: [
          taskLink({ relationId: 'rel-z', fileId: 'image-z', version: 2 }),
          taskLink({ relationId: 'rel-input', fileId: 'text-a', role: 'INPUT' }),
          taskLink({ relationId: 'rel-detached', fileId: 'image-old', state: 'DETACHED' })
        ], nextCursor: 'page-1' },
        { items: [
          taskLink({ relationId: 'rel-a2', fileId: 'image-a', version: 2 }),
          taskLink({ relationId: 'rel-a3', fileId: 'image-a', version: 3 })
        ], nextCursor: null }
      ],
      details: {
        'image-z': fileDetail('image-z', [version('image-z', 2), version('image-z', 3)]),
        'image-a': fileDetail('image-a', [version('image-a', 2, 'image/jpeg'), version('image-a', 3, 'image/png'), version('image-a', 4)])
      }
    })

    const result = await h.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'TASK_LINKED_REFERENCE' })

    expect(result).to.deep.equal({ state: 'READY', reason: null, inputRefs: [
      { fileId: 'image-a', version: 2, purpose: 'REFERENCE' },
      { fileId: 'image-a', version: 3, purpose: 'REFERENCE' },
      { fileId: 'image-z', version: 2, purpose: 'REFERENCE' }
    ] })
    expect(h.calls.filter(call => call.url.includes('/file-links')).map(call => call.params || null)).to.deep.equal([null, { cursor: 'page-1' }])
    expect(h.calls.filter(call => call.url.includes('/personal-workspace/files/')).map(call => call.url)).to.deep.equal([
      '/personal-workspace/files/image-z', '/personal-workspace/files/image-a'
    ])
  })

  it('distinguishes a complete empty catalog from EMPTY_ONLY references that must not be silently discarded', async () => {
    const empty = resolverHarness({ pages: [{ items: [taskLink({ role: 'OUTPUT' })], nextCursor: null }] })
    expect(await empty.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'EMPTY_ONLY' })).to.deep.equal({ state: 'READY', reason: null, inputRefs: [] })

    const nonempty = resolverHarness({ pages: [{ items: [taskLink()], nextCursor: null }], details: { 'image-b': fileDetail('image-b') } })
    expect(await nonempty.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'EMPTY_ONLY' })).to.deep.equal({
      state: 'BLOCKED', reason: 'REFERENCES_NOT_ALLOWED', inputRefs: []
    })
  })

  for (const [name, linkOverride, detail, reason] of [
    ['trashed file', {}, fileDetail('image-b', [version('image-b', 2)], { file: { state: 'TRASHED' } }), 'FILE_DETAIL_MISMATCH'],
    ['unsupported MIME', {}, fileDetail('image-b', [version('image-b', 2, 'application/pdf')]), 'UNSUPPORTED_REFERENCE_MIME'],
    ['missing linked version', {}, fileDetail('image-b', [version('image-b', 3)]), 'REFERENCE_VERSION_MISMATCH'],
    ['duplicate linked version rows', {}, fileDetail('image-b', [version('image-b', 2), version('image-b', 2)]), 'REFERENCE_VERSION_MISMATCH'],
    ['wrong version owner', {}, fileDetail('image-b', [version('foreign-file', 2)]), 'FILE_DETAIL_MISMATCH']
  ]) it(`fails closed for ${name}`, async () => {
    const h = resolverHarness({ pages: [{ items: [taskLink(linkOverride)], nextCursor: null }], details: { 'image-b': detail } })
    expect((await h.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'TASK_LINKED_REFERENCE' })).reason).to.equal(reason)
  })

  it('rejects duplicate exact references and the 33rd reference without truncation or detail reads', async () => {
    const duplicate = resolverHarness({ pages: [{ items: [taskLink(), taskLink({ relationId: 'relation-2' })], nextCursor: null }] })
    expect((await duplicate.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'TASK_LINKED_REFERENCE' })).reason).to.equal('DUPLICATE_REFERENCE')
    expect(duplicate.calls.filter(call => call.url.includes('/personal-workspace/files/'))).to.have.length(0)

    const manyLinks = Array.from({ length: 33 }, (_, index) => taskLink({ relationId: `relation-${index}`, fileId: `image-${index}`, version: 1 }))
    const many = resolverHarness({ pages: [{ items: manyLinks, nextCursor: null }] })
    expect((await many.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'TASK_LINKED_REFERENCE' })).reason).to.equal('TOO_MANY_REFERENCES')
    expect(many.calls.filter(call => call.url.includes('/personal-workspace/files/'))).to.have.length(0)
  })

  for (const status of [401, 403, 404, 503]) it(`does not reinterpret a catalog ${status} as an empty directory`, async () => {
    const h = resolverHarness({ fail: () => { throw Object.assign(new Error('unavailable'), { status }) } })
    expect(await h.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'TASK_LINKED_REFERENCE' })).to.deep.equal({
      state: 'BLOCKED', reason: 'CATALOG_UNAVAILABLE', inputRefs: []
    })
  })

  it('drops a late detail after identity/auth epoch changes and preserves no stale READY result', async () => {
    const wait = deferred()
    const identity = ref('owner-a\u00001')
    const h = resolverHarness({ identity, pages: [{ items: [taskLink()], nextCursor: null }], fail: options => {
      if (options.url.includes('/file-links')) return { data: { items: [taskLink()], nextCursor: null } }
      options.signal.addEventListener('abort', () => wait.resolve({ data: fileDetail('image-b') }), { once: true })
      return wait.promise
    } })
    const pending = h.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'TASK_LINKED_REFERENCE' })
    await Promise.resolve(); await Promise.resolve(); identity.value = 'owner-b\u00002'

    expect((await pending).state).to.equal('STALE')
    expect(h.resolver.state.value.state).to.equal('IDLE')
  })

  it('new point/start ignores old image-only selector arguments and uses the server-frozen task catalogue', async () => {
    const h = resolverHarness({ pages: [{ items: [taskLink()], nextCursor: null }], details: {
      'image-b': fileDetail('image-b', [version('image-b', 2), version('image-b', 3)])
    } })
    const resolved = await h.resolver.resolve({ taskId: 'task-1', inputRefsPolicy: 'TASK_LINKED_REFERENCE' })
    expect(resolved.state).to.equal('READY')

    const calls = []
    let assigned = false
    const facts = resolved.inputRefs.map(inputFact)
    const receipt = () => ({ schemaVersion: 1, taskId: 'task-1', targetAgentId: 'agent-1', requirementRevision: '3',
      assignmentRevision: '7', taskVersion: '7', grantId: 'grant-1', grantVersion: '1', grantState: 'ACTIVE',
      permittedOperations: ['DELIBERATE', 'INSPECT_INPUTS'], inputs: facts, bootstrapId: 'bootstrap-1', bootstrapState: 'PENDING',
      stateVersion: '0', initialOperation: 'DELIBERATE', conversationId: null, initialRequestId: null, currentAssignment: true })
    const pointApi = {
      get: async path => {
        calls.push({ method: 'GET', path })
        if (path.endsWith('/requirements/current')) return { data: { taskId: 'task-1', taskVersion: '6', requirementRevision: '3',
          title: '画一只鸟', description: null, contentSha256: 'a'.repeat(64), source: 'CREATE' } }
        if (path.endsWith('/point-and-deliberate/request')) return { data: receipt() }
        return { data: assigned
          ? { id: 'task-1', taskVersion: '7', status: 'assigned', assignedAgentId: 'agent-1' }
          : { id: 'task-1', taskVersion: '6', status: 'open' } }
      },
      create: async (path, body, options) => {
        calls.push({ method: 'POST', path, body, key: options.headers['Idempotency-Key'] })
        assigned = true
        return { data: receipt() }
      }
    }
    const flow = useHallPointAndStart({ agentApi: pointApi, actorScopeKey: ref('owner-a/client-a'), storage: memoryStorage(),
      isSupported: () => true, canAssign: task => task.status === 'open', createIdempotencyKey: () => 'original-key' })
    owned.push(flow)

    expect(await flow.start({ task: { id: 'task-1', taskVersion: '6', status: 'open' }, agent: { agentId: 'agent-1' },
      requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', inputRefs: resolved.inputRefs })).to.equal(true)
    const post = calls.find(call => call.method === 'POST')
    expect(post.path).to.equal('/tasks/task-1/point-and-deliberate')
    expect(post.body).to.deep.equal({ targetAgentId: 'agent-1', expectedTaskVersion: '6', requirementRevision: '3' })
    expect(calls.filter(call => call.method === 'POST')).to.have.length(1)
    expect(flow.state.value.projection.inputs).to.deep.equal(facts)
  })
})

import { expect } from 'chai'
import { ref } from 'vue'
import { safeFinalizationVersion, validFinalizationReceipt, useHallBountyFinalization } from '../src/composables/juyiting/useHallBountyFinalization.js'

const body = () => ({ expectedTaskVersion: 9, expectedAssignmentRevision: 3, conversationId: 'conversation-1',
  summary: '选定鸟图验收', selectedOutputs: [{ requestId: 'request-1', stepId: 'step-1', outputId: 'output_1',
    sha256: 'a'.repeat(64), title: '鸟', purpose: '最终成果' }] })
const intent = () => ({ taskId: 'task-1', body: body(), operationId: '' })
const receipt = (patch = {}, original = body()) => ({ operationId: 'finalization-1', taskId: 'task-1',
  conversationId: 'conversation-1', state: 'pending', stateVersion: '1', stage: 'PROMOTING',
  expectedTaskVersion: String(original.expectedTaskVersion), expectedAssignmentRevision: String(original.expectedAssignmentRevision),
  selectedOutputs: original.selectedOutputs, deliveryId: null, deliveryState: null, taskState: 'running', taskVersion: '9',
  errorCode: null, retryable: false, ...patch })
const completed = (patch = {}, original = body()) => receipt({ state: 'completed', stage: 'TASK_COMPLETED', stateVersion: '5',
  deliveryId: 'delivery-1', deliveryState: 'accepted', taskState: 'completed', taskVersion: '12', ...patch }, original)
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
const error = status => Object.assign(new Error('request failed'), { status })
const setup = (execute, options = {}) => {
  const calls = []; const storage = options.storage || memory()
  const api = { execute: async request => { calls.push(request); return execute(request, calls.length) } }
  const client = useHallBountyFinalization({ api, conversationId: ref('conversation-1'), identityKey: ref('owner-a'), storage,
    idempotencyKeyFactory: () => 'finalization-original-key-0001', ...options })
  return { client, storage, calls, api }
}
const send = client => client.submit({ taskId: 'task-1', body: body() })

describe('MMD finalization immutable owner acceptance', () => {
  it('rejects missing, unsafe, padded and noncanonical task versions without coercion', () => {
    for (const value of ['', null, undefined, '01', ' 9', '9 ', '-1', '1.5', 1.5, true, Number.MAX_SAFE_INTEGER + 1, '9223372036854775807']) expect(safeFinalizationVersion(value)).to.equal(null)
    for (const value of [0, '0', 9, '9', Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) expect(safeFinalizationVersion(value)).to.equal(Number(value))
  })
  it('requires exact frozen source set, scope, versions and actual accepted/completed facts', () => {
    expect(validFinalizationReceipt(completed(), intent())).to.equal(true)
    const variants = [
      { taskId: 'other-task' }, { conversationId: 'other-conversation' }, { expectedTaskVersion: '10' },
      { expectedAssignmentRevision: '4' }, { expectedTaskVersion: 9 }, { stateVersion: '0' }, { stateVersion: '01' },
      { taskVersion: '8' }, { taskVersion: 12 }, { taskVersion: '9223372036854775808' },
      { deliveryId: null }, { deliveryState: 'submitted' }, { taskState: 'reviewing' }, { state: 'pending' },
      { stage: 'SUBMITTED' }, { errorCode: 'FAILURE' }, { retryable: true },
      { selectedOutputs: [] }, { selectedOutputs: [{ ...body().selectedOutputs[0], sha256: 'b'.repeat(64) }] },
      { selectedOutputs: [{ ...body().selectedOutputs[0], title: 'changed' }] }, { producerId: 'forged' }
    ]
    for (const patch of variants) expect(validFinalizationReceipt(completed(patch), intent()), JSON.stringify(patch)).to.equal(false)
    const missing = completed(); delete missing.operationId
    expect(validFinalizationReceipt(missing, intent())).to.equal(false)
    expect(validFinalizationReceipt(completed(), { ...intent(), operationId: 'other-operation' })).to.equal(false)
  })
  it('persists and reads back the immutable intent before its first POST', async () => {
    const { client, calls, storage } = setup(request => {
      expect(storage.values.size).to.equal(1)
      const persisted = JSON.parse([...storage.values.values()][0])
      expect(request.headers['Idempotency-Key']).to.equal(persisted.idempotencyKey)
      expect(request.data).to.deep.equal(persisted.body)
      expect(Object.isFrozen(request.data.selectedOutputs[0])).to.equal(true)
      return { data: { data: completed() } }
    })
    try { expect((await send(client)).state).to.equal('completed'); expect(client.status.value.state).to.equal('completed'); expect(calls).to.have.length(1) } finally { client.dispose() }
  })
  it('does not infer completion from a bare stage/delivery label', async () => {
    const { client } = setup(() => ({ data: { stage: 'TASK_COMPLETED', deliveryId: 'delivery-1', deliveryState: 'accepted' } }))
    try { await send(client); expect(client.status.value.state).to.equal('unknown'); expect(client.status.value.intent).not.to.equal(null); expect(client.status.value.receipt).to.equal(null) } finally { client.dispose() }
  })
  it('does not submit concurrently on a second click', async () => {
    let finish
    const { client, calls } = setup(() => new Promise(resolve => { finish = resolve }))
    try { const pending = send(client); expect(await send(client)).to.equal(null); expect(calls).to.have.length(1); finish({ data: completed() }); await pending } finally { client.dispose() }
  })
  it('lost acknowledgement/remount keeps the original key/body; a status check never writes', async () => {
    const { client, storage, calls, api } = setup(() => { throw new TypeError('lost acknowledgement') })
    await send(client); client.dispose()
    const recovered = useHallBountyFinalization({ api, storage, conversationId: 'conversation-1', identityKey: 'owner-a',
      idempotencyKeyFactory: () => { throw new Error('must not create a new key') } })
    try {
      expect(calls).to.have.length(1); expect(recovered.status.value.state).to.equal('unknown')
      const original = recovered.status.value.intent
      api.execute = async request => { calls.push(request); expect(request.method).to.equal('GET'); return { data: completed() } }
      await recovered.check()
      expect(calls[1].url).to.equal('/tasks/task-1/finalizations/request')
      expect(calls[1].headers['Idempotency-Key']).to.equal(original.idempotencyKey)
      expect(recovered.status.value.state).to.equal('completed')
      await recovered.resume(); expect(calls.filter(c => c.method === 'POST')).to.have.length(1)
    } finally { recovered.dispose() }
  })
  it('only an explicit resume after 404 replays the original immutable POST', async () => {
    const { client, calls } = setup((request, count) => {
      if (count === 1) throw new TypeError('lost acknowledgement')
      if (request.method === 'GET') throw error(404)
      return { data: completed() }
    })
    try {
      await send(client); await client.check()
      expect(calls.map(c => c.method)).to.deep.equal(['POST', 'GET'])
      expect(client.status.value.state).to.equal('unknown')
      const changed = body(); changed.selectedOutputs[0].sha256 = 'b'.repeat(64)
      await client.submit({ taskId: 'different-task', body: changed })
      expect(calls.map(c => c.method)).to.deep.equal(['POST', 'GET', 'GET', 'POST'])
      expect(calls[3].data).to.deep.equal(calls[0].data)
      expect(calls[3].url).to.equal(calls[0].url)
      expect(calls[3].headers).to.deep.equal(calls[0].headers)
    } finally { client.dispose() }
  })
  it('known operation reads by ID and resumes pending only with the original write', async () => {
    const { client, calls } = setup(request => ({ data: request.method === 'POST' && calls.length > 1 ? completed() : receipt() }))
    try {
      await send(client); await client.check()
      expect(calls[1].url).to.equal('/tasks/task-1/finalizations/finalization-1')
      expect(calls).to.have.length(2)
      await client.resume()
      expect(calls.map(c => c.method)).to.deep.equal(['POST', 'GET', 'GET', 'POST'])
      expect(calls[3].headers).to.deep.equal(calls[0].headers)
    } finally { client.dispose() }
  })
  for (const status of [401, 403, 409, 500]) it(`does not replay a POST when status reconciliation fails with ${status}`, async () => {
    const { client, calls } = setup((request, count) => { if (count === 1) return { data: receipt() }; throw error(status) })
    try { await send(client); await client.resume(); expect(calls.map(c => c.method)).to.deep.equal(['POST', 'GET']); expect(client.status.value.state).not.to.equal('completed') } finally { client.dispose() }
  })
  it('nonretryable domain failure is not automatically submitted again', async () => {
    const { client, calls } = setup(() => ({ data: receipt({ state: 'failed', errorCode: 'ASSIGNMENT_CHANGED', retryable: false }) }))
    try { await send(client); await client.resume(); expect(calls.map(c => c.method)).to.deep.equal(['POST', 'GET']); expect(client.status.value.state).to.equal('failed') } finally { client.dispose() }
  })
  it('retryable phase failure can resume the original operation without generation', async () => {
    const { client, calls } = setup(request => ({ data: request.method === 'POST' && calls.length > 1 ? completed() : receipt({ state: 'failed', errorCode: 'PROMOTION_STORAGE', retryable: true }) }))
    try { await send(client); await client.resume(); expect(calls.map(c => c.method)).to.deep.equal(['POST', 'GET', 'POST']); expect(client.status.value.state).to.equal('completed') } finally { client.dispose() }
  })
  it('identity switching aborts and fences a late completion while preserving each owner recovery key', async () => {
    const owner = ref('owner-a'); let finish
    const { client, calls, storage } = setup(() => new Promise(resolve => { finish = resolve }), { identityKey: owner })
    try {
      const pending = send(client); owner.value = 'owner-b'
      expect(calls[0].signal.aborted).to.equal(true)
      finish({ data: completed() }); await pending
      expect(client.status.value.state).to.equal('idle'); expect(client.status.value.receipt).to.equal(null)
      expect(storage.values.size).to.equal(1)
      owner.value = 'owner-a'; expect(client.status.value.state).to.equal('unknown')
      expect(client.status.value.intent.idempotencyKey).to.equal(calls[0].headers['Idempotency-Key'])
    } finally { client.dispose() }
  })
  it('rejects receipt version rollback and conflicting same-version facts', async () => {
    const states = [receipt({ stateVersion: '4' }), receipt({ stateVersion: '3' }), receipt({ stateVersion: '4', stage: 'READY_TO_SUBMIT' })]
    const { client } = setup(() => ({ data: states.shift() }))
    try { await send(client); await client.check(); expect(client.status.value.receipt.stateVersion).to.equal('4'); await client.check(); expect(client.status.value.receipt.stage).to.equal('PROMOTING') } finally { client.dispose() }
  })
  it('rejects a higher-version receipt that regresses a confirmed domain stage or completion', async () => {
    const states = [completed(), receipt({ stateVersion: '6', taskVersion: '12' })]
    const { client } = setup(() => ({ data: states.shift() }))
    try { await send(client); await client.check(); expect(client.status.value.receipt.stage).to.equal('TASK_COMPLETED'); expect(client.status.value.receipt.deliveryId).to.equal('delivery-1') } finally { client.dispose() }
  })
  for (const label of ['unavailable', 'readback mismatch', 'corrupt recovered intent', 'recovery read error']) it(`never opens a new operation with ${label} storage`, async () => {
    let storage
    if (label === 'unavailable') storage = { getItem: () => null, setItem: () => { throw new Error('unavailable') } }
    else if (label === 'readback mismatch') storage = { getItem: () => null, setItem: () => {} }
    else if (label === 'corrupt recovered intent') storage = { getItem: () => '{invalid', setItem: () => {} }
    else storage = { getItem: () => { throw new Error('read error') }, setItem: () => {} }
    const { client, calls } = setup(() => { throw new Error('must not request') }, { storage })
    try { await send(client); await client.resume(); await client.check(); expect(calls).to.have.length(0); expect(['error', 'recovery_error']).to.include(client.status.value.state) } finally { client.dispose() }
  })
  it('confirmed server completion stays confirmed when later recovery persistence fails', async () => {
    const storage = memory(); let writes = 0
    const original = storage.setItem
    storage.setItem = (key, value) => { if (++writes > 1) throw new Error('storage changed'); original(key, value) }
    const { client } = setup(() => ({ data: completed() }), { storage })
    try { await send(client); expect(client.status.value.state).to.equal('completed'); expect(client.status.value.receipt.deliveryId).to.equal('delivery-1') } finally { client.dispose() }
  })
  it('does not accept hidden permission fields or duplicate source selections', async () => {
    const { client, calls } = setup(() => { throw new Error('must not request') })
    try {
      const forged = body(); forged.producerId = 'forged'; await client.submit({ taskId: 'task-1', body: forged })
      const duplicate = body(); duplicate.selectedOutputs.push({ ...duplicate.selectedOutputs[0] }); await client.submit({ taskId: 'task-1', body: duplicate })
      expect(calls).to.have.length(0)
    } finally { client.dispose() }
  })
})

const textSelection = () => ({ requestId: 'text-request-1', sha256: 'c'.repeat(64), title: '文字成果', purpose: '最终成果',
  messageSource: { turnId: 'text-turn-1', messageId: '9223372036854775807', snapshotId: 'snapshot-1', finalDigest: `sha256:${'d'.repeat(64)}` } })
const textBody = (mixed = false) => ({ ...body(), summary: '文字直接验收',
  selectedOutputs: mixed ? [body().selectedOutputs[0], textSelection()] : [textSelection()] })
const sendBody = (client, original) => client.submit({ taskId: 'task-1', body: original })

describe('MMD completed-message finalization wire and recovery', () => {
  for (const mixed of [false, true]) it(`submits ${mixed ? 'ordered mixed media/text' : 'text-only'} without invented output IDs and freezes nested refs`, async () => {
    const original = textBody(mixed)
    let finish
    const { client, calls, storage } = setup(() => new Promise(resolve => { finish = resolve }))
    try {
      const pending = sendBody(client, original)
      const selected = calls[0].data.selectedOutputs.at(-1)
      expect(Object.keys(selected).sort()).to.deep.equal(['requestId', 'sha256', 'title', 'purpose', 'messageSource'].sort())
      expect(selected.messageSource.messageId).to.equal('9223372036854775807')
      expect(Object.isFrozen(selected.messageSource)).to.equal(true)
      const frozen = JSON.parse([...storage.values.values()][0]).body
      original.selectedOutputs.at(-1).messageSource.snapshotId = 'later-snapshot'
      expect(selected.messageSource.snapshotId).to.equal('snapshot-1')
      finish({ data: completed({}, frozen) })
      expect((await pending).state).to.equal('completed')
      expect(client.status.value.receipt.selectedOutputs).to.deep.equal(frozen.selectedOutputs)
      expect(calls).to.have.length(1)
    } finally { client.dispose() }
  })
  it('compares every actual message ref and preserves order rather than accepting a newer text receipt', () => {
    const original = textBody(true); const command = { ...intent(), body: original }
    expect(validFinalizationReceipt(completed({}, original), command)).to.equal(true)
    for (const [field, value] of [['turnId', 'other-turn'], ['messageId', '101'], ['snapshotId', 'other-snapshot'], ['finalDigest', `sha256:${'e'.repeat(64)}`]]) {
      const changed = structuredClone(original); changed.selectedOutputs[1].messageSource[field] = value
      expect(validFinalizationReceipt(completed({}, changed), command), field).to.equal(false)
    }
    const reversed = structuredClone(original); reversed.selectedOutputs.reverse()
    expect(validFinalizationReceipt(completed({}, reversed), command)).to.equal(false)
    const media = structuredClone(original); media.selectedOutputs[1] = { ...body().selectedOutputs[0], requestId: 'text-request-1' }
    expect(validFinalizationReceipt(completed({}, media), command)).to.equal(false)
    const reordered = structuredClone(original)
    reordered.selectedOutputs[1].messageSource = Object.fromEntries(Object.entries(reordered.selectedOutputs[1].messageSource).reverse())
    expect(validFinalizationReceipt(completed({}, reordered), command)).to.equal(true)
  })
  it('rejects numeric/zero/padded/overflow message IDs and incomplete/hybrid source authority before requesting', async () => {
    const { client, calls } = setup(() => { throw new Error('must not request') })
    try {
      for (const id of [101, 9007199254740992, 0, '0', '01', ' 101', '101 ', '-1', '1.0', '9223372036854775808', null]) {
        const invalid = textBody(); invalid.selectedOutputs[0].messageSource.messageId = id
        expect(await sendBody(client, invalid), String(id)).to.equal(null)
      }
      for (const field of ['turnId', 'messageId', 'snapshotId', 'finalDigest']) {
        const invalid = textBody(); delete invalid.selectedOutputs[0].messageSource[field]
        expect(await sendBody(client, invalid), field).to.equal(null)
      }
      for (const patch of [{ stepId: 'fake-step' }, { outputId: 'fake-output' }, { executionId: 'fake-execution' },
        { runId: 'fake-run' }, { grantId: 'fake-grant' }, { sourceKind: 'COMPLETED_MESSAGE' }, { stepId: null, outputId: null }]) {
        const invalid = textBody(); Object.assign(invalid.selectedOutputs[0], patch)
        expect(await sendBody(client, invalid), JSON.stringify(patch)).to.equal(null)
      }
      for (const patch of [{ finalDigest: 'd'.repeat(64) }, { finalDigest: `sha256:${'D'.repeat(64)}` }, { turnId: '../other' },
        { snapshotId: '' }, { messageId: '101', grantId: 'fake-grant' }]) {
        const invalid = textBody(); Object.assign(invalid.selectedOutputs[0].messageSource, patch)
        expect(await sendBody(client, invalid), JSON.stringify(patch)).to.equal(null)
      }
      expect(calls).to.have.length(0)
      expect(client.status.value.intent).to.equal(null)
    } finally { client.dispose() }
  })
  it('rejects duplicate actual text message even with a changed snapshot, digest or title', async () => {
    const { client, calls } = setup(() => { throw new Error('must not request') })
    try {
      for (const field of ['snapshotId', 'finalDigest', 'title']) {
        const duplicate = textBody(); const second = textSelection()
        if (field === 'title') second.title = '另一标题'
        else second.messageSource[field] = field === 'snapshotId' ? 'snapshot-2' : `sha256:${'e'.repeat(64)}`
        duplicate.selectedOutputs.push(second)
        expect(await sendBody(client, duplicate)).to.equal(null)
      }
      expect(calls).to.have.length(0)
    } finally { client.dispose() }
  })
  it('text acknowledgement loss/remount reads only, then explicitly replays the original mixed key and nested refs', async () => {
    const original = textBody(true)
    const { client, calls, api, storage } = setup(() => { throw new TypeError('lost acknowledgement') })
    await sendBody(client, original); client.dispose()
    original.selectedOutputs[1].messageSource.snapshotId = 'later-snapshot'
    const frozen = calls[0].data
    const recovered = useHallBountyFinalization({ api, storage, conversationId: 'conversation-1', identityKey: 'owner-a',
      idempotencyKeyFactory: () => { throw new Error('must not replace original key') } })
    try {
      expect(recovered.status.value.intent.body).to.deep.equal(frozen)
      expect(Object.isFrozen(recovered.status.value.intent.body.selectedOutputs[1].messageSource)).to.equal(true)
      api.execute = async request => { calls.push(request); if (request.method === 'GET') throw error(404); return { data: completed({}, frozen) } }
      await recovered.check()
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET'])
      await sendBody(recovered, textBody())
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET', 'GET', 'POST'])
      expect(calls[3].data).to.deep.equal(frozen)
      expect(calls[3].headers).to.deep.equal(calls[0].headers)
      expect(recovered.status.value.state).to.equal('completed')
    } finally { recovered.dispose() }
  })
  it('changed nested message refs in a server receipt leave original text intent unresolved', async () => {
    const original = textBody(); const changed = textBody()
    changed.selectedOutputs[0].messageSource.snapshotId = 'different-snapshot'
    const { client, calls } = setup(() => ({ data: completed({}, changed) }))
    try {
      expect(await sendBody(client, original)).to.equal(null)
      expect(client.status.value.state).to.equal('unknown')
      expect(client.status.value.receipt).to.equal(null)
      expect(client.status.value.intent.body.selectedOutputs[0].messageSource.snapshotId).to.equal('snapshot-1')
      await client.check()
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET'])
    } finally { client.dispose() }
  })
  it('owner switching fences a late text receipt and restores only that owner original refs', async () => {
    const owner = ref('owner-a'); const original = textBody(); let finish
    const { client, calls } = setup(() => new Promise(resolve => { finish = resolve }), { identityKey: owner })
    try {
      const pending = sendBody(client, original); owner.value = 'owner-b'
      expect(calls[0].signal.aborted).to.equal(true)
      finish({ data: completed({}, original) }); await pending
      expect(client.status.value.state).to.equal('idle')
      expect(client.status.value.intent).to.equal(null)
      owner.value = 'owner-a'
      expect(client.status.value.state).to.equal('unknown')
      expect(client.status.value.intent.body).to.deep.equal(original)
      expect(Object.isFrozen(client.status.value.intent.body.selectedOutputs[0].messageSource)).to.equal(true)
    } finally { client.dispose() }
  })
  it('does not recover corrupted or fabricated stored message refs into a new operation', async () => {
    const storage = memory()
    const original = textBody(); original.selectedOutputs[0].messageSource.messageId = 9007199254740992
    storage.setItem('juyiting:finalization:v1:owner-a:conversation-1', JSON.stringify({ taskId: 'task-1',
      idempotencyKey: 'finalization-original-key-0001', operationId: '', body: original }))
    const { client, calls } = setup(() => { throw new Error('must not request') }, { storage })
    try {
      expect(client.status.value.state).to.equal('recovery_error')
      await sendBody(client, textBody()); await client.check(); await client.resume()
      expect(calls).to.have.length(0)
    } finally { client.dispose() }
  })
})


describe('real API text receipt nullable DTO source slots', () => {
  const dtoReceipt = original => completed({ selectedOutputs: original.selectedOutputs.map(item => item.messageSource
    ? { ...item, stepId: null, outputId: null } : item) }, original)
  it('recognizes completed pure text and mixed receipts without changing frozen request sources', async () => {
    for (const mixed of [false, true]) {
      const original = textBody(mixed)
      const { client, calls } = setup(() => ({ data: dtoReceipt(original) }))
      try {
        await client.submit({ taskId: 'task-1', body: original })
        expect(client.status.value.state).to.equal('completed')
        expect(client.status.value.receipt.selectedOutputs).to.deep.equal(original.selectedOutputs)
        expect(calls[0].data).to.deep.equal(original)
        expect(calls).to.have.length(1)
      } finally { client.dispose() }
    }
  })
  it('keeps original unknown intent and resolves completion via GET only', async () => {
    const original = textBody(true)
    const { client, calls } = setup((request, count) => {
      if (count === 1) throw new TypeError('lost acknowledgement')
      expect(request.method).to.equal('GET')
      return { data: dtoReceipt(original) }
    })
    try {
      await client.submit({ taskId: 'task-1', body: original })
      const key = client.status.value.intent.idempotencyKey
      await client.check()
      expect(client.status.value.state).to.equal('completed')
      expect(client.status.value.intent.idempotencyKey).to.equal(key)
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET'])
    } finally { client.dispose() }
  })
  it('rejects invented IDs, partial null slots, extra fields, changed digests and reordered selection', () => {
    const original = textBody(true); const command = { ...intent(), body: original }
    expect(validFinalizationReceipt(dtoReceipt(original), command)).to.equal(true)
    for (const patch of [{ stepId: 'invented' }, { outputId: 'invented' }, { unexpected: null }, { sha256: 'f'.repeat(64) }]) {
      const changed = dtoReceipt(original); changed.selectedOutputs[1] = { ...changed.selectedOutputs[1], ...patch }
      expect(validFinalizationReceipt(changed, command)).to.equal(false)
    }
    const partial = dtoReceipt(original); delete partial.selectedOutputs[1].outputId
    expect(validFinalizationReceipt(partial, command)).to.equal(false)
    const reordered = dtoReceipt(original); reordered.selectedOutputs.reverse()
    expect(validFinalizationReceipt(reordered, command)).to.equal(false)
  })
})

import { expect } from 'chai'
import { ref } from 'vue'

import { useOutputs } from '../src/composables/useOutputs.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const privateDeliverable = (overrides = {}) => ({
  outputId: 'output-1',
  executionId: 'execution-1',
  fileId: 'file-1',
  fileVersion: 2,
  contentHash: 'a'.repeat(64),
  contentMimeType: 'application/pdf',
  byteLength: 42,
  committedAt: 1234,
  state: 'AVAILABLE',
  publicationState: 'WORKSPACE_COMMITTED',
  formalDeliveryState: 'NOT_APPLICABLE',
  ...overrides
})

describe('1.13.2 Babao-box workspace entry', () => {
  it('renders only canonical private output references and never promotes them to formal acceptance', async () => {
    const source = ref({ type: 'conversation', id: 'conversation-1' })
    const identity = ref('owner-a')
    const outputs = useOutputs({
      source,
      identityFingerprint: identity,
      adapter: {
        list: async () => ({ state: 'AVAILABLE', publicationPending: false, nextCursor: null, items: [privateDeliverable()] })
      }
    })
    try {
      await tick()
      expect(outputs.state.value).to.equal('available')
      expect(outputs.items.value).to.have.length(1)
      expect(outputs.items.value[0]).to.deep.include({
        outputId: 'output-1',
        executionId: 'execution-1',
        publicationState: 'WORKSPACE_COMMITTED',
        formalDeliveryState: 'NOT_APPLICABLE'
      })
      expect(outputs.items.value[0].fileRef).to.deep.equal({ fileId: 'file-1', fileVersion: '2' })
      expect(outputs.items.value[0].canDownload).to.equal(true)
      expect(outputs.items.value[0]).not.to.have.any.keys('storageUri', 'leaseToken', 'runtimeCredential', 'content')
    } finally {
      outputs.dispose()
    }
  })


  it('accepts only a published task artifact with an authoritative formal state and preserves no secrets', async () => {
    const source = ref({ type: 'conversation', id: 'conversation-1' })
    const outputs = useOutputs({
      source,
      taskId: () => 'task-1',
      identityFingerprint: ref('owner-a'),
      adapter: {
        list: async () => ({
          state: 'AVAILABLE', publicationPending: false, nextCursor: null,
          items: [privateDeliverable({
            publicationState: 'PUBLISHED', taskId: 'task-1', formalDeliveryState: 'submitted',
            artifactId: 'artifact-1', artifactVersion: 3,
            formalDeliveryId: 'delivery-1', formalDeliveryRevision: 2,
            formalDecisionVersion: 0, formalReviewedAt: null
          })]
        }),
        async download () { return new Blob(['exact artifact']) },
        async preview () { return new Blob(['exact artifact']) }
      }
    })
    try {
      await tick()
      const item = outputs.items.value[0]
      expect(item).to.include({ artifactId: 'artifact-1', artifactVersion: '3', formalDeliveryState: 'submitted', formalDeliveryId: 'delivery-1', formalDecisionVersion: 0, canDownload: true })
      expect(item.artifactRef).to.deep.equal({ artifactId: 'artifact-1', artifactVersion: '3', taskId: 'task-1' })
      expect(item).not.to.have.any.keys('storageUri', 'leaseToken', 'runtimeCredential', 'content')
    } finally {
      outputs.dispose()
    }
  })
  it('uses the server taskId without a selected task and refuses a conflicting or missing published taskId', async () => {
    const published = privateDeliverable({
      publicationState: 'PUBLISHED', formalDeliveryState: 'changes_requested', taskId: 'task-1',
      artifactId: 'artifact-1', artifactVersion: 1, formalDeliveryId: 'delivery-1',
      formalDeliveryRevision: 1, formalDecisionVersion: 1, formalReviewedAt: 2
    })
    for (const [selectedTask, rowTask, expectedCount] of [[null, 'task-1', 1], ['task-1', 'other-task', 0], ['task-1', null, 0]]) {
      const outputs = useOutputs({ source: ref({ type: 'conversation', id: 'conversation-1' }), taskId: selectedTask,
        identityFingerprint: ref('owner-a'), adapter: { list: async () => ({ items: [{ ...published, taskId: rowTask }] }) } })
      try {
        await tick()
        expect(outputs.items.value).to.have.length(expectedCount)
        if (expectedCount) expect(outputs.items.value[0].artifactRef.taskId).to.equal('task-1')
      } finally { outputs.dispose() }
    }
  })
  it('shows TASK publication lag as syncing rather than a pseudo-delivery', async () => {
    const source = ref({ type: 'conversation', id: 'conversation-1' })
    const outputs = useOutputs({
      source,
      identityFingerprint: ref('owner-a'),
      adapter: { list: async () => ({ state: 'SYNCING', publicationPending: true, nextCursor: null, items: [] }) }
    })
    try {
      await tick()
      expect(outputs.state.value).to.equal('syncing')
      expect(outputs.items.value).to.deep.equal([])
      expect(outputs.message.value).to.equal('交付同步中，尚未提交待验收。')
    } finally {
      outputs.dispose()
    }
  })

  it('drops malformed or secret-bearing conversation items and clears a stale request after a conversation switch', async () => {
    const source = ref({ type: 'conversation', id: 'conversation-1' })
    const identity = ref('owner-a')
    let resolveFirst
    let calls = 0
    const outputs = useOutputs({
      source,
      identityFingerprint: identity,
      adapter: {
        list: () => {
          calls += 1
          if (calls === 1) return new Promise(resolve => { resolveFirst = resolve })
          return Promise.resolve({
            state: 'AVAILABLE', publicationPending: false, nextCursor: null,
            items: [privateDeliverable({ outputId: 'output-2', executionId: 'execution-2', fileId: 'file-2', storageUri: 'forbidden' })]
          })
        }
      }
    })
    try {
      await tick()
      source.value = { type: 'conversation', id: 'conversation-2' }
      resolveFirst({ state: 'AVAILABLE', publicationPending: false, nextCursor: null, items: [privateDeliverable()] })
      await tick()
      expect(outputs.items.value).to.deep.equal([])
      expect(outputs.state.value).to.equal('empty')
      expect(calls).to.equal(2)
    } finally {
      outputs.dispose()
    }
  })

  it('offers version-pinned workspace references inline while retaining the Babao entry', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(source).to.include('class="icon-button workspace-entry"')
    expect(source).to.include("$emit('open-workspace')")
    expect(source).to.not.include('usePersonalWorkspaceExecution')
    expect(source).to.include('usePersonalWorkspaceConversationLinks')
    expect(source).to.include('usePersonalWorkspaceTaskLinks')
    expect(source).to.include("role: 'REFERENCE'")
    expect(source).to.include('不会把资料内容或假摘要写入消息')
    expect(source).to.not.include('参看资料：')
    expect(source).to.not.include('<FormalDeliveryList')
    expect(source).to.not.match(/storageUri|leaseToken|runtimeCredential/)
    expect(hall).to.include('<PersonalWorkspace')
    expect(hall).to.include("renderedPanel === 'treasure'")
  })
})

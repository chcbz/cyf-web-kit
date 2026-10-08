import { expect } from 'chai'
import {
  bountyDeliberationPresentation,
  hasVerifiedConversationImage,
  isMultimediaDeliberationUiEnabled
} from '../src/composables/juyiting/hallMultimediaDeliberationUi.js'

const v2Capability = { v2: true }
const legacyChatRequest = () => ({ requestId: 'request-1', requestRevision: '1', state: 'RUNNING' })
const executePlanningRequest = () => ({ requestId: 'request-2', state: 'PLANNING', steps: [{ kind: 'EXECUTE' }] })
const receivedChatTurn = () => ({ route: 'CHAT', state: 'RECEIVED' })

const present = changes => bountyDeliberationPresentation({
  enabled: true,
  capability: v2Capability,
  request: legacyChatRequest(),
  turns: [receivedChatTurn()],
  messages: [],
  ...changes
})

describe('Juyi Hall multimedia deliberation v2 presentation', () => {
  it('is default-off and keeps legacy chat presentation when the v2 capability is absent', () => {
    expect(isMultimediaDeliberationUiEnabled()).to.equal(false)
    expect(isMultimediaDeliberationUiEnabled('false')).to.equal(false)
    expect(isMultimediaDeliberationUiEnabled('true')).to.equal(true)
    expect(present({ enabled: false })).to.equal(null)
    expect(present({ capability: { v2: false } })).to.equal(null)
  })

  it('keeps CHAT RUNNING on the existing chat surface without inferring a v2 banner', () => {
    expect(present()).to.equal(null)
    expect(present({ request: { requestId: 'claimed-schema', interactionSchemaVersion: '2', state: 'RUNNING' } })).to.equal(null)
  })

  it('shows action-proposal EXECUTE PLANNING from controlled server steps without inventing a CHAT route', () => {
    const presentation = present({ request: executePlanningRequest(), turns: [] })
    expect(presentation).to.include({ route: 'EXECUTE', routeLabel: '处理中', state: 'PLANNING' })
    expect(presentation.phase).to.equal('Agent 正在处理需求。')
    expect(JSON.stringify(presentation)).not.to.match(/画鸟|受控|办理|可领取|悬赏议事 v2/)
  })

  it('is replay-stable for a durable proposal and never infers v2 from a CHAT revision or route', () => {
    const changes = { request: executePlanningRequest(), turns: [] }
    const first = present(changes)
    const replay = present(changes)
    expect(replay).to.deep.equal(first)
    expect(present({ request: { requestId: 'legacy-request', requestRevision: '1', state: 'RUNNING' } })).to.equal(null)
    expect(present({ request: { requestId: 'inspect-only', state: 'PLANNING', steps: [{ kind: 'INSPECT' }] }, turns: [] })).to.equal(null)
    expect(present({ request: executePlanningRequest(), turns: [receivedChatTurn()] })).to.equal(null)
  })

  it('renders media availability only for a ready scoped image asset and leaves missing assets waiting', () => {
    const missingAsset = [{ parts: [{ kind: 'image', state: 'ready', assetId: '', mime: 'image/png' }] }]
    const actualAsset = [{ parts: [{ kind: 'image', state: 'ready', assetId: 'asset-1', mime: 'image/png' }] }]
    expect(hasVerifiedConversationImage(missingAsset)).to.equal(false)
    expect(present({ request: executePlanningRequest(), turns: [], messages: missingAsset }).mediaNotice).to.equal('结果会显示在会话中。')
    expect(hasVerifiedConversationImage(actualAsset)).to.equal(true)
    expect(present({ request: executePlanningRequest(), turns: [], messages: actualAsset }).mediaNotice).to.equal('收到的内容可在会话中预览、下载。')
  })

  it('uses the same concise availability message for audio and files without claiming completion', () => {
    for (const [kind, mime] of [['audio', 'audio/wav'], ['file', 'application/pdf']]) {
      const messages = [{ parts: [{ kind, mime, state: 'ready', assetId: 'asset-mixed' }] }]
      const presentation = present({ request: executePlanningRequest(), turns: [], messages })
      expect(presentation.mediaNotice).to.equal('收到的内容可在会话中预览、下载。')
      expect(presentation.state).to.equal('PLANNING')
      expect(presentation.mediaNotice).not.to.match(/图片|完成|验收/)
    }
  })

  it('shows no v2 request state after an identity switch has cleared its owner-scoped projection', () => {
    expect(present({ request: null, turns: [] })).to.equal(null)
  })
})

import { expect } from 'chai'
import {
  bountyDeliberationPresentation,
  hasVerifiedConversationImage,
  isMultimediaDeliberationUiEnabled
} from '../src/composables/juyiting/hallMultimediaDeliberationUi.js'

const planningRequest = () => ({ requestId: 'request-1', route: 'CHAT', state: 'PLANNING' })
const v2Capability = { v2: true }

const present = changes => bountyDeliberationPresentation({
  enabled: true,
  capability: v2Capability,
  request: planningRequest(),
  turns: [],
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

  it('shows only the server-projected CHAT/PLANNING state and never calls a bird prompt complete', () => {
    const presentation = present()
    expect(presentation).to.include({ route: 'CHAT', state: 'PLANNING', phase: '议事规划中' })
    expect(presentation.mediaNotice).to.include('尚未收到可领取的会话图片资产')
    expect(presentation.mediaNotice).to.include('不代表“画鸟”已完成')
  })

  it('is replay-stable and refuses an unrecognized state instead of inventing a reducer transition', () => {
    const first = present({ turns: [{ route: 'CHAT', state: 'PLANNING' }] })
    const replay = present({ turns: [{ route: 'CHAT', state: 'PLANNING' }] })
    expect(replay).to.deep.equal(first)
    expect(present({ request: { ...planningRequest(), state: 'RUNNING' } })).to.equal(null)
  })

  it('renders media availability only for a ready scoped image asset and leaves missing assets waiting', () => {
    const missingAsset = [{ parts: [{ kind: 'image', state: 'ready', assetId: '', mime: 'image/png' }] }]
    const actualAsset = [{ parts: [{ kind: 'image', state: 'ready', assetId: 'asset-1', mime: 'image/png' }] }]
    expect(hasVerifiedConversationImage(missingAsset)).to.equal(false)
    expect(present({ messages: missingAsset }).mediaNotice).to.include('尚未收到')
    expect(hasVerifiedConversationImage(actualAsset)).to.equal(true)
    expect(present({ messages: actualAsset }).mediaNotice).to.include('已收到可领取')
  })

  it('shows no v2 request state after an identity switch has cleared its owner-scoped projection', () => {
    expect(present({ request: null })).to.equal(null)
  })
})

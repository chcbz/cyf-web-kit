import { expect } from 'chai'

import {
  MINI_PROGRAM_ORIENTATION_ROUTES,
  ensureMiniProgramBridge,
  enterNativeLandscape,
  leaveNativeLandscape,
  nativeOrientationFromLocation
} from '../src/composables/juyiting/miniProgramOrientation.js'

describe('Juyi Hall Mini Program native orientation bridge', () => {
  it('accepts only the explicit native orientation marker', () => {
    expect(nativeOrientationFromLocation('https://kit.chaoyoufan.cn/juyiting?nativeOrientation=landscape')).to.equal('landscape')
    expect(nativeOrientationFromLocation('https://kit.chaoyoufan.cn/juyiting?nativeOrientation=portrait')).to.equal('portrait')
    expect(nativeOrientationFromLocation('https://kit.chaoyoufan.cn/juyiting?nativeOrientation=auto')).to.equal(null)
  })

  it('uses navigateTo/navigateBack and native-page fallbacks', async () => {
    const calls = []
    const host = {
      wx: {
        miniProgram: {
          navigateTo: options => { calls.push(['navigateTo', options]); options.fail() },
          navigateBack: options => { calls.push(['navigateBack', options]); options.fail() },
          redirectTo: options => calls.push(['redirectTo', options])
        }
      }
    }

    expect(await enterNativeLandscape({ host })).to.equal(true)
    expect(await leaveNativeLandscape({ host })).to.equal(true)
    expect(calls[0][0]).to.equal('navigateTo')
    expect(calls[0][1].url).to.equal(MINI_PROGRAM_ORIENTATION_ROUTES.landscape)
    expect(calls[1]).to.deep.equal(['redirectTo', { url: MINI_PROGRAM_ORIENTATION_ROUTES.landscapeFallback }])
    expect(calls[2][0]).to.equal('navigateBack')
    expect(calls[2][1].delta).to.equal(1)
    expect(calls[3]).to.deep.equal(['redirectTo', { url: MINI_PROGRAM_ORIENTATION_ROUTES.portraitFallback }])
  })

  it('loads the official bridge SDK once when wx.miniProgram is initially absent', async () => {
    const scripts = []
    const host = {
      setTimeout: callback => { host.wx = { miniProgram: { navigateTo() {} } }; callback() }
    }
    const document = {
      createElement: () => ({ addEventListener() {} }),
      getElementById: () => null,
      head: { appendChild: script => scripts.push(script) }
    }
    const bridge = await ensureMiniProgramBridge({ host, document, timeoutMs: 1 })
    expect(bridge).to.equal(host.wx.miniProgram)
    expect(scripts).to.have.length(1)
    expect(scripts[0].src).to.equal('https://res.wx.qq.com/open/js/jweixin-1.6.0.js')
  })

  it('deduplicates a pending SDK load only within the same host', async () => {
    const makeHost = () => {
      let timeout
      const scripts = []
      const host = { setTimeout: callback => { timeout = callback; return 1 } }
      const document = {
        getElementById: () => null,
        createElement: () => ({ addEventListener() {} }),
        head: { appendChild: script => scripts.push(script) }
      }
      return { host, document, scripts, complete(bridge) { host.wx = { miniProgram: bridge }; timeout() } }
    }
    const first = makeHost(), second = makeHost()
    const firstLoad = ensureMiniProgramBridge(first)
    const sameHostLoad = ensureMiniProgramBridge(first)
    const secondLoad = ensureMiniProgramBridge(second)
    expect(first.scripts).to.have.length(1)
    expect(second.scripts).to.have.length(1)
    const firstBridge = { navigateTo() {} }, secondBridge = { redirectTo() {} }
    first.complete(firstBridge); second.complete(secondBridge)
    expect(await firstLoad).to.equal(firstBridge)
    expect(await sameHostLoad).to.equal(firstBridge)
    expect(await secondLoad).to.equal(secondBridge)
  })

})

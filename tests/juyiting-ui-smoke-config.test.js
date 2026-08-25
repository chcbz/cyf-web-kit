import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe as nodeDescribe, it as nodeIt } from 'node:test'

const describe = globalThis.describe || nodeDescribe
const it = globalThis.it || nodeIt

describe('juyiting ui smoke config', () => {
  it('loads the declared CDP websocket client only inside the global guard', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

    assert.equal(/import\s+WebSocket\s+from\s+['"]ws['"]/.test(source), false)
    assert.ok(source.includes("options.loadWebSocketModuleImpl || (() => import('ws'))"))
    assert.ok(source.includes("'CDP WebSocket module load'"))
    assert.ok(Object.hasOwn(packageJson.devDependencies, 'ws'))
  })

  it('discovers the installed Linux headless browser wrapper', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')

    assert.ok(source.includes('/usr/local/bin/chromium-headless-smoke'))
    assert.ok(source.includes("'--window-size=1440,900'"))
  })

  it('waits for the canvas scene instead of canvas-rendered agent text', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')

    assert.equal(source.includes('waitForExpression(cdp, \'(document.body.innerText || "").includes("宋江")\')'), false)
    assert.ok(source.includes('.hall-board.is-melon-ready'))
  })

  it('runs the terminal CDP barrier after the final browser security state check', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')
    const finalStateIndex = source.indexOf('finalUrl = browserPolicy.assertFinalState(finalSecurityState).href')
    const terminalBarrierIndex = source.indexOf('await cdp.terminalBarrier()', finalStateIndex)
    const catchIndex = source.indexOf('} catch (error) {', finalStateIndex)

    assert.ok(finalStateIndex >= 0)
    assert.ok(terminalBarrierIndex > finalStateIndex)
    assert.ok(catchIndex > terminalBarrierIndex)
  })

  it('clicks canvas hotspots and asserts semantic panel containers', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')

    assert.ok(source.includes('clickSceneHotspot'))
    assert.ok(source.includes("await clickSceneHotspot(cdp, 'library')"))
    assert.ok(source.includes("await clickSceneHotspot(cdp, 'tasks')"))
    assert.ok(source.includes("await clickSceneHotspot(cdp, 'chat')"))
    assert.ok(source.includes('panel-library'))
    assert.ok(source.includes('panel-tasks'))
    assert.ok(source.includes('panel-chat'))
    assert.equal(source.includes("clickByText('案卷阁')"), false)
    assert.equal(source.includes("clickByText('悬赏榜')"), false)
    assert.equal(source.includes("clickByText('议事')"), false)
  })
})

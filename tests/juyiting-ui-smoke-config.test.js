import { expect } from 'chai'
import { readFileSync } from 'fs'

describe('juyiting ui smoke config', () => {
  it('declares and imports the websocket client used for CDP', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(source).to.match(/import WebSocket from ['"]ws['"]/) 
    expect(packageJson.devDependencies).to.have.property('ws')
  })

  it('discovers the installed Linux headless browser wrapper', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')

    expect(source).to.include('/usr/local/bin/chromium-headless-smoke')
    expect(source).to.include("'--window-size=1440,900'")
  })

  it('waits for the canvas scene instead of canvas-rendered agent text', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')

    expect(source).not.to.include('waitForExpression(cdp, \'(document.body.innerText || "").includes("宋江")\')')
    expect(source).to.include('.hall-board.is-melon-ready')
  })

  it('clicks canvas hotspots for current panels and opens the mention menu', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')

    expect(source).to.include('clickSceneHotspot')
    expect(source).to.include("await clickSceneHotspot(cdp, 'library')")
    expect(source).to.include("await clickSceneHotspot(cdp, 'tasks')")
    expect(source).to.include("await clickSceneHotspot(cdp, 'chat')")
    expect(source).to.include('藏书查卷')
    expect(source).to.include('composer-textarea')
    expect(source).not.to.include("clickByText('案卷阁')")
    expect(source).not.to.include("clickByText('悬赏榜')")
    expect(source).not.to.include("clickByText('议事')")
  })
})

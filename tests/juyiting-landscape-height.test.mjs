import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const sourceStyle = (path) => {
  const source = readFileSync(path, 'utf8')
  const match = source.match(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/)
  assert.ok(match, `${path} must provide component styles`)
  return match[1]
}

const renderHeightChain = () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'juyiting-landscape-height-'))
  const fixturePath = join(fixtureDir, 'height-chain.html')
  const profilePath = join(fixtureDir, 'chromium-profile')
  const styles = [
    sourceStyle('src/components/world/JuyiHallEntry.vue'),
    sourceStyle('src/components/world/JuyiHall.vue'),
    sourceStyle('src/components/juyiting/HallStage.vue'),
    sourceStyle('src/components/juyiting/HallPortraitHome.vue')
  ].join('\n')
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { width: 100%; height: 100%; margin: 0; }
.fixture { display: block; }
.landscape-fixture { width: 844px; height: 390px; }
.portrait-fixture { width: 390px; height: 844px; }
.app-container { display: flex; flex-direction: column; height: 100%; position: relative; }
.app-content { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
.probe-content { height: 1000px; }
${styles}
</style></head><body>
  <section class="fixture landscape-fixture" id="landscape-fixture">
    <div class="app-container"><main class="app-content"><div class="juyi-hall-entry"><div class="juyi-hall-background"><div class="juyi-page experience-landscape-map"><section class="hall-stage"><div class="hall-board is-scene-landscape"><div class="melon-layer"></div></div></section></div></div></div></main></div>
  </section>
  <section class="fixture portrait-fixture" id="portrait-fixture">
    <div class="app-container"><main class="app-content"><div class="juyi-hall-entry"><div class="juyi-hall-background"><div class="juyi-page experience-portrait-command"><section class="hall-portrait-home"><div class="probe-content"></div><button id="last-control" type="button">最后一个控件</button></section></div></div></div></main></div>
  </section>
  <pre id="result"></pre>
  <script>
    const dimensions = selector => {
      const element = document.querySelector(selector)
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }
    const portrait = document.querySelector('#portrait-fixture .hall-portrait-home')
    const lastControl = document.querySelector('#last-control')
    portrait.scrollTop = 0
    lastControl.scrollIntoView({ block: 'end' })
    const portraitRect = portrait.getBoundingClientRect()
    const lastControlRect = lastControl.getBoundingClientRect()
    const portraitStyle = getComputedStyle(portrait)
    document.querySelector('#result').textContent = JSON.stringify({
      landscape: ['.juyi-hall-entry', '.juyi-hall-background', '.juyi-page', '.hall-stage', '.hall-board']
        .map(selector => [selector, dimensions('#landscape-fixture ' + selector)]),
      portrait: {
        viewportHeight: document.querySelector('#portrait-fixture').getBoundingClientRect().height,
        height: portraitRect.height,
        clientHeight: portrait.clientHeight,
        scrollHeight: portrait.scrollHeight,
        scrollTop: portrait.scrollTop,
        paddingTop: portraitStyle.paddingTop,
        paddingBottom: portraitStyle.paddingBottom,
        boxSizing: portraitStyle.boxSizing,
        overflowY: portraitStyle.overflowY,
        lastControl: {
          top: lastControlRect.top,
          bottom: lastControlRect.bottom,
          visible: lastControlRect.top >= portraitRect.top && lastControlRect.bottom <= portraitRect.bottom
        }
      }
    })
  </script>
</body></html>`

  try {
    writeFileSync(fixturePath, html)
    const output = execFileSync(process.env.CHROME_PATH || '/usr/bin/chromium-browser', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=844,844', '--virtual-time-budget=1000',
      `--user-data-dir=${profilePath}`, '--dump-dom', `file://${fixturePath}`
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
    const result = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]
    assert.ok(result, 'headless browser must report fixture geometry')
    return JSON.parse(result)
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}

describe('Juyi Hall entry height chain', () => {
  const geometry = renderHeightChain()

  it('gives the landscape board a resolved non-zero height through the entry and background wrappers', () => {
    for (const [selector, rect] of geometry.landscape) {
      assert.equal(rect.width, 844, `${selector} width`)
      assert.equal(rect.height, 390, `${selector} height`)
    }
  })

  it('keeps the portrait shell within the viewport and scrolls its last control fully into view', () => {
    assert.equal(geometry.portrait.boxSizing, 'border-box')
    assert.equal(geometry.portrait.overflowY, 'auto')
    assert.ok(geometry.portrait.height <= geometry.portrait.viewportHeight)
    assert.ok(geometry.portrait.clientHeight <= geometry.portrait.viewportHeight)
    assert.ok(geometry.portrait.scrollHeight > geometry.portrait.clientHeight)
    assert.ok(geometry.portrait.scrollTop > 0)
    assert.equal(geometry.portrait.lastControl.visible, true)
  })
})

/** Offline interaction evidence only; not application/production acceptance. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchChrome, evaluate, waitForExpression, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'
const evidence = process.env.HISTORY_WINDOW_EVIDENCE
if (!evidence) throw new Error('HISTORY_WINDOW_EVIDENCE is required')
const b = await launchChrome({ debugPort: 19796 })
const errors = [], checks = []
try {
  const { cdp } = b
  cdp.on('Runtime.exceptionThrown', value => errors.push(value.exceptionDetails?.exception?.description || value.exceptionDetails?.text))
  await mkdir(evidence, { recursive: true })
  for (const width of [1440, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:18796/?scenario=revision-running&historyWindow=1#chat' })
    await waitForExpression(cdp, "!!document.querySelector('[data-window-older]')")
    const initial = await evaluate(cdp, "document.querySelectorAll('[data-window-row]').length")
    assert.equal(initial, 20)
    for (let i = 0; i < 12; i++) {
      await evaluate(cdp, "document.querySelector('.hall-messages').scrollTop=0")
      await new Promise(resolve => setTimeout(resolve, 40))
      await evaluate(cdp, "document.querySelector('[data-window-older]').click()")
    }
    await evaluate(cdp, "document.querySelector('.hall-messages').scrollTop=0")
    await new Promise(resolve => setTimeout(resolve, 100))
    const older = await evaluate(cdp, `({ rows:document.querySelectorAll('[data-window-row]').length,
      status:document.querySelector('[data-window-count]').textContent,
      first:document.querySelector('[data-window-row]').dataset.windowRow,
      overflow:document.documentElement.scrollWidth>innerWidth })`)
    assert.equal(older.first, '741')
    assert.ok(older.rows < 260, JSON.stringify(older))
    assert.equal(older.overflow, false)
    // An expanded text editor must survive scrolling away and back.
    await evaluate(cdp, `(()=>{const detail=document.querySelector('[data-window-row="741"] details');detail.open=true;detail.querySelector('textarea').value='保留编辑';const box=document.querySelector('.hall-messages');box.scrollTop=box.scrollHeight;})()`)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await evaluate(cdp, "document.querySelector('[data-window-row=\"741\"] textarea')?.value"), '保留编辑')
    assert.ok(await evaluate(cdp, "!!document.querySelector('[data-window-row=\"1000\"]')"))
    await evaluate(cdp, "document.querySelector('.hall-messages').scrollTop=0")
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await evaluate(cdp, "document.querySelector('[data-window-row=\"741\"] textarea')?.value"), '保留编辑')
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${evidence}/${width}.png`, Buffer.from(screenshot.data, 'base64'))
    checks.push({ width, initial, older })
  }
  assert.deepEqual(errors, [])
  await writeFile(`${evidence}/results.json`, JSON.stringify({ checks, errors, boundary: 'offline prototype only' }, null, 2))
  console.log(JSON.stringify(checks))
} catch (error) { console.error(JSON.stringify({ errors, page: await evaluate(b.cdp, '({url:location.href,title:document.title,text:document.body.innerText.slice(0,500)})') })); throw error } finally { b.cdp.close(); await stopChrome(b.chrome, b.userDataDir) }

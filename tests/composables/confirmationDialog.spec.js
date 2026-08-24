import { expect } from 'chai'
import { nextTick } from 'vue'
import { useConfirmationDialog } from '../../src/composables/useConfirmationDialog.js'

describe('account security confirmation dialog lifecycle', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('traps Tab, closes on Escape, restores trigger focus, and prevents duplicate opens', async () => {
    document.body.innerHTML = '<button id="trigger">open</button><div id="dialog"><button id="cancel">cancel</button><button id="confirm">confirm</button></div>'
    const trigger = document.querySelector('#trigger')
    const cancel = document.querySelector('#cancel')
    const confirm = document.querySelector('#confirm')
    const dialog = useConfirmationDialog()
    dialog.dialog.value = document.querySelector('#dialog')
    dialog.cancelButton.value = cancel

    expect(await dialog.open(trigger)).to.equal(true)
    expect(await dialog.open(trigger)).to.equal(false)
    expect(document.activeElement).to.equal(cancel)
    confirm.focus()
    const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    dialog.onKeydown(tab)
    expect(tab.defaultPrevented).to.equal(true)
    expect(document.activeElement).to.equal(cancel)

    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.onKeydown(escape)
    await nextTick()
    expect(dialog.confirming.value).to.equal(false)
    expect(document.activeElement).to.equal(trigger)
  })
})

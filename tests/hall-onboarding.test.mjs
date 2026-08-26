import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  HALL_ONBOARDING_VERSION,
  consumeGuestDemoTemplateQuery,
  createHallOnboarding,
  encodeHallOnboardingSubject,
  hallOnboardingStorageKey,
  hallOnboardingSubject,
  sha256Hex,
  validateGuestDemoTemplate
} from '../src/composables/juyiting/useHallOnboarding.js'

const templates = [
  { id: 'research' },
  { id: 'content' },
  { id: 'collaboration' }
]

const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    keys: () => [...values.keys()]
  }
}

const brokenStorage = {
  getItem () { throw new Error('storage unavailable') },
  setItem () { throw new Error('storage unavailable') }
}

test('first visit is visible and subject selection prioritizes jiacn without raw identifiers in keys', () => {
  const subject = hallOnboardingSubject({ getJiacn: 'jia-cn-77', getOpenid: 'openid-1', getUserId: 'user-1' })
  const state = createHallOnboarding({ subject, localStorage: memoryStorage(), sessionStorage: memoryStorage() })
  const key = hallOnboardingStorageKey(subject)

  assert.equal(subject, 'jia-cn-77')
  assert.equal(state.snapshot().visible, true)
  assert.equal(key.includes('jia-cn-77'), false)
  assert.equal(key.includes('openid-1'), false)
  assert.notEqual(hallOnboardingStorageKey('user-a'), hallOnboardingStorageKey('user-b'))
  assert.equal(encodeHallOnboardingSubject('jia-cn-77'), 'u60b3ac6c299b757433636b7cf3c424e9')
})

test('numeric getUserId is a persistent per-user subject and string and numeric inputs are type-tagged', () => {
  const localStorage = memoryStorage()
  const numericSubject = hallOnboardingSubject({ getUserId: 42 })
  const stringSubject = hallOnboardingSubject({ getUserId: '42' })

  assert.equal(numericSubject, 42)
  assert.equal(stringSubject, '42')
  assert.notEqual(encodeHallOnboardingSubject(numericSubject), 'anonymous')
  assert.notEqual(encodeHallOnboardingSubject(numericSubject), encodeHallOnboardingSubject(stringSubject))

  createHallOnboarding({ subject: numericSubject, localStorage, sessionStorage: memoryStorage() }).complete()
  assert.equal(createHallOnboarding({ subject: numericSubject, localStorage, sessionStorage: memoryStorage() }).snapshot().visible, false)
  assert.equal(createHallOnboarding({ localStorage, sessionStorage: memoryStorage() }).snapshot().visible, true)
})

test('identity subjects preserve exact strings and reject blank, control, and unpaired surrogate aliases', () => {
  assert.notEqual(encodeHallOnboardingSubject('42'), encodeHallOnboardingSubject(' 42 '))
  assert.notEqual(encodeHallOnboardingSubject('user'), encodeHallOnboardingSubject('user '))
  assert.equal(hallOnboardingSubject({ getJiacn: '   ', getOpenid: '\u0000bad', getUserId: '\ud800' }), null)
  assert.equal(encodeHallOnboardingSubject('   '), 'anonymous')
  assert.equal(encodeHallOnboardingSubject('bad\u0000id'), 'anonymous')
  assert.equal(encodeHallOnboardingSubject('bad\ud800'), 'anonymous')
  assert.equal(encodeHallOnboardingSubject(Number.MAX_SAFE_INTEGER + 1), 'anonymous')
  assert.equal(encodeHallOnboardingSubject(Infinity), 'anonymous')
})

test('SHA-256 uses standard JavaScript UTF-8 vectors, including replacement for lone surrogates', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex('\ud800'), '83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097')
  assert.equal(sha256Hex('\ud800'), sha256Hex('\ufffd'))
})

test('known 32-bit FNV collision subjects receive different SHA-256/128 storage keys and isolated dismissals', () => {
  // `costarring` and `liquid` collide under the prior 32-bit FNV-1a implementation.
  const localStorage = memoryStorage()
  const costarringKey = hallOnboardingStorageKey('costarring')
  const liquidKey = hallOnboardingStorageKey('liquid')

  assert.notEqual(encodeHallOnboardingSubject('costarring'), encodeHallOnboardingSubject('liquid'))
  assert.notEqual(costarringKey, liquidKey)
  assert.equal(encodeHallOnboardingSubject('costarring').length, 33)

  createHallOnboarding({ subject: 'costarring', localStorage, sessionStorage: memoryStorage() }).complete()
  assert.equal(createHallOnboarding({ subject: 'liquid', localStorage, sessionStorage: memoryStorage() }).snapshot().visible, true)
})

test('login creates a fresh per-user state without inheriting anonymous session persistence', () => {
  const localStorage = memoryStorage()
  const sessionStorage = memoryStorage()
  const anonymous = createHallOnboarding({ localStorage, sessionStorage })

  anonymous.complete()
  assert.equal(anonymous.snapshot().visible, false)

  const loggedIn = createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage })
  assert.equal(loggedIn.snapshot().visible, true)
  assert.notEqual(loggedIn.snapshot().subjectKey, anonymous.snapshot().subjectKey)
})

test('later snoozes only the current browser session and returns on a fresh session', () => {
  const localStorage = memoryStorage()
  const currentSession = memoryStorage()
  const first = createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage: currentSession })

  assert.equal(first.snooze().visible, false)
  assert.equal(createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage: currentSession }).snapshot().visible, false)
  assert.equal(createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage: memoryStorage() }).snapshot().visible, true)
})

test('skip is versioned and completion persists independently for each user', () => {
  const localStorage = memoryStorage()
  const sessionStorage = memoryStorage()
  const userA = createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage })

  assert.equal(userA.skip().status, 'skipped')
  assert.equal(createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage: memoryStorage() }).snapshot().visible, false)
  assert.equal(createHallOnboarding({ subject: 'user-a', version: 'v2', localStorage, sessionStorage: memoryStorage() }).snapshot().visible, true)

  const userB = createHallOnboarding({ subject: 'user-b', localStorage, sessionStorage: memoryStorage() })
  assert.equal(userB.snapshot().visible, true)
  assert.equal(userB.complete().status, 'completed')
  assert.equal(createHallOnboarding({ subject: 'user-b', localStorage, sessionStorage: memoryStorage() }).snapshot().visible, false)
})

test('reopen is visible without erasing a persisted dismissal', () => {
  const localStorage = memoryStorage()
  const onboarding = createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage: memoryStorage() })

  onboarding.skip()
  assert.deepEqual(onboarding.open(), {
    visible: true,
    status: 'skipped',
    snoozed: false,
    subjectKey: encodeHallOnboardingSubject('user-a'),
    version: HALL_ONBOARDING_VERSION
  })
  assert.equal(createHallOnboarding({ subject: 'user-a', localStorage, sessionStorage: memoryStorage() }).snapshot().visible, false)
})

test('anonymous fallback is session-only and storage failures remain non-fatal', () => {
  const sessionStorage = memoryStorage()
  const anonymous = createHallOnboarding({ localStorage: memoryStorage(), sessionStorage })

  anonymous.complete()
  assert.equal(createHallOnboarding({ localStorage: memoryStorage(), sessionStorage }).snapshot().visible, false)
  assert.equal(createHallOnboarding({ localStorage: memoryStorage(), sessionStorage: memoryStorage() }).snapshot().visible, true)

  const unavailable = createHallOnboarding({ subject: 'user-a', localStorage: brokenStorage, sessionStorage: brokenStorage })
  assert.doesNotThrow(() => unavailable.snooze())
  assert.doesNotThrow(() => unavailable.skip())
  assert.doesNotThrow(() => unavailable.complete())
  assert.equal(unavailable.snapshot().visible, false)
})

test('guest template handoff accepts only one bounded whitelisted template and consumes its query field', () => {
  const accepted = consumeGuestDemoTemplateQuery({ template: 'research', keep: 'yes', untouched: ['one', 'two'] }, templates)
  assert.deepEqual(accepted, { templateId: 'research', query: { keep: 'yes', untouched: ['one', 'two'] }, consumed: true })
  assert.equal(validateGuestDemoTemplate(['research'], templates), null)
  assert.equal(validateGuestDemoTemplate('unknown', templates), null)
  assert.equal(validateGuestDemoTemplate('research\n', templates), null)
  assert.equal(validateGuestDemoTemplate('research\u007f', templates), null)
  assert.equal(validateGuestDemoTemplate('x'.repeat(33), templates), null)
  assert.deepEqual(consumeGuestDemoTemplateQuery({ template: ['research'], keep: 'yes' }, templates), {
    templateId: null,
    query: { keep: 'yes' },
    consumed: true
  })
  assert.deepEqual(consumeGuestDemoTemplateQuery({ keep: 'yes' }, templates), {
    templateId: null,
    query: { keep: 'yes' },
    consumed: false
  })
})

test('the wrapper preserves PKCE return query/hash, syncs after a cleanup rejection, and GuestDemo restricts handoff ids', () => {
  const entry = readFileSync(new URL('../src/components/world/JuyiHallEntry.vue', import.meta.url), 'utf8')
  const guestDemo = readFileSync(new URL('../src/components/public/GuestDemo.vue', import.meta.url), 'utf8')

  assert.match(entry, /<JuyiHall\s*\/>/)
  assert.match(entry, /consumeGuestDemoTemplateQuery\(route\.query, guestDemoTemplates\)/)
  assert.match(entry, /try \{[\s\S]*await router\.replace\(\{ path: route\.path, query: handoff\.query, hash: route\.hash \}\)[\s\S]*\} catch \{[\s\S]*\} finally \{[\s\S]*syncOnboarding\(\)/)
  assert.ok(entry.indexOf('await router.replace') < entry.indexOf('finally {'))
  assert.ok(entry.indexOf('finally {') < entry.indexOf('syncOnboarding()', entry.indexOf('finally {')))
  assert.match(guestDemo, /new Set\(\['research', 'content', 'collaboration'\]\)/)
  assert.match(guestDemo, /allowedGuestDemoTemplateIds\.has\(id\)/)
})

class HarnessElement {
  constructor (document, name) {
    this.document = document
    this.name = name
    this.attributes = new Map()
    this.children = []
    this.parentElement = null
    this.throwOnFocus = false
    this.focusables = []
    this.focusCount = 0
    this.listeners = new Map()
  }

  get inert () {
    return this.hasAttribute('inert')
  }

  set inert (value) {
    if (value) this.setAttribute('inert', '')
    else this.removeAttribute('inert')
  }

  get isConnected () {
    return this === this.document.body || this === this.document.documentElement || Boolean(this.parentElement?.isConnected)
  }

  append (...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
  }

  setAttribute (name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute (name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute (name) {
    return this.attributes.has(name)
  }

  removeAttribute (name) {
    this.attributes.delete(name)
  }

  contains (target) {
    return target === this || this.children.some(child => child.contains(target))
  }

  querySelectorAll () {
    return this.focusables
  }

  getClientRects () {
    return [this]
  }

  addEventListener (type, listener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  dispatch (type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event)
  }

  listenerCount (type) {
    return this.listeners.get(type)?.size || 0
  }

  focus () {
    if (this.throwOnFocus) throw new Error(`focus failed: ${this.name}`)
    this.focusCount += 1
    this.document.setActiveElement(this, true)
  }
}

class HarnessDocument {
  constructor () {
    this.listeners = new Map()
    this.listenerAdds = new Map()
    this.listenerRemoves = new Map()
    this.documentElement = new HarnessElement(this, 'documentElement')
    this.body = new HarnessElement(this, 'body')
    this.documentElement.append(this.body)
    this.activeElement = this.body
  }

  addEventListener (type, listener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    this.listenerAdds.set(type, (this.listenerAdds.get(type) || 0) + 1)
  }

  removeEventListener (type, listener) {
    this.listeners.get(type)?.delete(listener)
    this.listenerRemoves.set(type, (this.listenerRemoves.get(type) || 0) + 1)
  }

  listenerCount (type) {
    return this.listeners.get(type)?.size || 0
  }

  setActiveElement (target, dispatch) {
    this.activeElement = target
    if (dispatch) this.dispatch('focusin', { target })
  }

  dispatch (type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event)
  }

  dispatchFromTarget (type, target, event) {
    this.dispatch(type, event)
    if (!event.propagationStopped) target.dispatch(type, event)
  }
}

const loadOnboardingLifecycle = ({ document, props }) => {
  const modal = readFileSync(new URL('../src/components/juyiting/HallOnboarding.vue', import.meta.url), 'utf8')
  const script = modal.match(/<script setup>\s*([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script, 'HallOnboarding script setup must exist')

  const mountedCallbacks = []
  const unmountCallbacks = []
  const watchers = []
  const emissions = []
  const executable = `${script.replace(/^import .*$/gm, '')}
return { dialogRef, overlayRef, openDialog, closeDialog, handleDocumentKeydown, handleDocumentFocusin }
`
  const setup = new Function(
    'computed', 'nextTick', 'onBeforeUnmount', 'onMounted', 'ref', 'watch', 'guestDemoTemplates',
    'document', 'HTMLElement', 'defineProps', 'defineEmits', executable
  )
  const lifecycle = setup(
    getter => ({ get value () { return getter() } }),
    () => Promise.resolve(),
    callback => unmountCallbacks.push(callback),
    callback => mountedCallbacks.push(callback),
    value => ({ value }),
    (source, callback, options) => watchers.push({ source, callback, options }),
    [],
    document,
    HarnessElement,
    () => props,
    () => (...args) => emissions.push(args)
  )
  const templateKeydownHandler = modal.match(/<section[\s\S]*?@keydown="([^"]+)"/)?.[1]
  lifecycle.bindTemplate = dialog => {
    if (templateKeydownHandler && typeof lifecycle[templateKeydownHandler] === 'function') {
      dialog.addEventListener('keydown', lifecycle[templateKeydownHandler])
    }
  }
  lifecycle.emissions = emissions
  lifecycle.mount = async () => { await Promise.all(mountedCallbacks.map(callback => callback())) }
  lifecycle.unmount = () => unmountCallbacks.forEach(callback => callback())
  return lifecycle
}

const keyEvent = (shiftKey = false) => ({
  key: 'Tab',
  shiftKey,
  prevented: false,
  propagationStopped: false,
  preventDefault () { this.prevented = true },
  stopPropagation () { this.propagationStopped = true }
})

const escapeEvent = () => ({
  key: 'Escape',
  shiftKey: false,
  prevented: false,
  propagationStopped: false,
  preventDefault () { this.prevented = true },
  stopPropagation () { this.propagationStopped = true }
})

const mountOnboardingHarness = ({
  initialActive = 'body',
  modelValue = true,
  throwOnInitialFocus = false,
  zeroFocusable = false
} = {}) => {
  const document = new HarnessDocument()
  const appRoot = new HarnessElement(document, 'appRoot')
  const externalControl = new HarnessElement(document, 'externalControl')
  const emptyInertControl = new HarnessElement(document, 'emptyInertControl')
  const overlay = new HarnessElement(document, 'overlay')
  const dialog = new HarnessElement(document, 'dialog')
  const first = new HarnessElement(document, 'first')
  const last = new HarnessElement(document, 'last')
  const reopen = new HarnessElement(document, 'reopen')
  const previous = new HarnessElement(document, 'previous')

  appRoot.setAttribute('inert', 'preserved-inert')
  appRoot.setAttribute('aria-hidden', 'false')
  externalControl.setAttribute('aria-hidden', 'preserved-external')
  emptyInertControl.setAttribute('inert', '')
  overlay.append(dialog)
  dialog.append(first, last)
  dialog.focusables = zeroFocusable ? [] : [first, last]
  first.throwOnFocus = throwOnInitialFocus
  appRoot.append(reopen, previous)
  document.body.append(appRoot, externalControl, emptyInertControl, overlay)

  if (initialActive === 'previous') document.setActiveElement(previous, false)
  const props = { modelValue, returnFocusTarget: reopen }
  const lifecycle = loadOnboardingLifecycle({ document, props })
  lifecycle.overlayRef.value = overlay
  lifecycle.dialogRef.value = dialog
  lifecycle.bindTemplate(dialog)
  return {
    document,
    lifecycle,
    props,
    appRoot,
    externalControl,
    emptyInertControl,
    overlay,
    dialog,
    first,
    last,
    reopen,
    previous
  }
}

test('the executable onboarding DOM harness preserves the focus trap and installs exactly one listener pair', async () => {
  const fixture = mountOnboardingHarness()
  const { document, lifecycle, appRoot, externalControl, overlay, dialog, first, last } = fixture

  await lifecycle.mount()
  await lifecycle.openDialog()
  assert.equal(document.activeElement, first, 'automatic open focuses the first dialog control, never body or the dialog root')
  assert.equal(document.listenerCount('keydown'), 1)
  assert.equal(document.listenerCount('focusin'), 1)
  assert.equal(document.listenerAdds.get('keydown'), 1)
  assert.equal(document.listenerAdds.get('focusin'), 1)
  assert.equal(appRoot.getAttribute('inert'), '')
  assert.equal(appRoot.inert, true)
  assert.equal(appRoot.getAttribute('aria-hidden'), 'true')
  assert.equal(externalControl.getAttribute('inert'), '')
  assert.equal(externalControl.inert, true)
  assert.equal(externalControl.getAttribute('aria-hidden'), 'true')
  assert.equal(overlay.hasAttribute('inert'), false, 'the teleported modal remains outside the isolated sibling set')

  const reverse = keyEvent(true)
  lifecycle.handleDocumentKeydown(reverse)
  assert.equal(reverse.prevented, true)
  assert.equal(document.activeElement, last, 'initial Shift+Tab cycles from first to last')

  const forward = keyEvent()
  lifecycle.handleDocumentKeydown(forward)
  assert.equal(forward.prevented, true)
  assert.equal(document.activeElement, first, 'Tab cycles from last to first')

  document.setActiveElement(dialog, false)
  const fromDialog = keyEvent(true)
  lifecycle.handleDocumentKeydown(fromDialog)
  assert.equal(fromDialog.prevented, true)
  assert.equal(document.activeElement, last, 'reverse Tab at dialog root stays contained')

  document.setActiveElement(overlay, false)
  const fromOverlay = keyEvent()
  lifecycle.handleDocumentKeydown(fromOverlay)
  assert.equal(fromOverlay.prevented, true)
  assert.equal(document.activeElement, first, 'forward Tab at modal root stays contained')

  externalControl.focus()
  assert.equal(document.activeElement, first, 'focusin outside the dialog is recaptured')
})

test('the reflected inert harness restores absent, empty, and nonempty content attributes byte-exactly', async () => {
  const fixture = mountOnboardingHarness()
  const { document, lifecycle, appRoot, externalControl, emptyInertControl, reopen } = fixture

  assert.equal(appRoot.inert, true, 'nonempty inert content is reflected as true')
  assert.equal(externalControl.inert, false, 'absent inert content is reflected as false')
  assert.equal(emptyInertControl.inert, true, 'empty inert content is reflected as true')

  await lifecycle.mount()
  lifecycle.closeDialog()
  assert.equal(document.activeElement, reopen, 'body is not captured as a return target')
  assert.equal(appRoot.getAttribute('inert'), 'preserved-inert')
  assert.equal(appRoot.inert, true)
  assert.equal(appRoot.getAttribute('aria-hidden'), 'false')
  assert.equal(externalControl.hasAttribute('inert'), false)
  assert.equal(externalControl.inert, false)
  assert.equal(externalControl.getAttribute('aria-hidden'), 'preserved-external')
  assert.equal(emptyInertControl.hasAttribute('inert'), true)
  assert.equal(emptyInertControl.getAttribute('inert'), '')
  assert.equal(emptyInertControl.inert, true)
  assert.equal(document.listenerCount('keydown'), 0)
  assert.equal(document.listenerCount('focusin'), 0)
  assert.equal(document.listenerRemoves.get('keydown'), 1)
  assert.equal(document.listenerRemoves.get('focusin'), 1)
})

test('zero-focusable onboarding keeps forward and reverse Tab on the dialog root', async () => {
  const fixture = mountOnboardingHarness({ zeroFocusable: true })
  const { document, lifecycle, dialog } = fixture

  await lifecycle.mount()
  assert.equal(document.activeElement, dialog)

  for (const shiftKey of [false, true]) {
    const event = keyEvent(shiftKey)
    lifecycle.handleDocumentKeydown(event)
    assert.equal(event.prevented, true)
    assert.equal(document.activeElement, dialog)
  }
})

test('never-open unmount performs cleanup without moving focus or touching listeners', async () => {
  const fixture = mountOnboardingHarness({ initialActive: 'previous', modelValue: false })
  const { document, lifecycle, appRoot, previous } = fixture

  await lifecycle.mount()
  lifecycle.unmount()
  assert.equal(document.activeElement, previous)
  assert.equal(previous.focusCount, 0, 'cleanup did not replay focus onto the already-active element')
  assert.equal(appRoot.getAttribute('inert'), 'preserved-inert')
  assert.equal(document.listenerCount('keydown'), 0)
  assert.equal(document.listenerCount('focusin'), 0)
  assert.equal(document.listenerAdds.get('keydown') || 0, 0)
  assert.equal(document.listenerRemoves.get('keydown') || 0, 0)
})

test('closed-then-unmount and double close clean up without restoring focus more than once', async () => {
  const fixture = mountOnboardingHarness()
  const { document, lifecycle, reopen, previous } = fixture

  await lifecycle.mount()
  lifecycle.closeDialog()
  assert.equal(document.activeElement, reopen)
  assert.equal(reopen.focusCount, 1)

  previous.focus()
  lifecycle.closeDialog()
  assert.equal(document.activeElement, previous, 'double close does not move focus')
  lifecycle.unmount()
  assert.equal(document.activeElement, previous, 'closed-then-unmount does not move focus')
  assert.equal(reopen.focusCount, 1, 'return focus was consumed exactly once')
  assert.equal(document.listenerRemoves.get('keydown'), 1)
  assert.equal(document.listenerRemoves.get('focusin'), 1)
})

test('document capture is the single Escape owner and emits later once before dialog bubble', async () => {
  const fixture = mountOnboardingHarness()
  const { document, lifecycle, dialog } = fixture

  await lifecycle.mount()
  const event = escapeEvent()
  document.dispatchFromTarget('keydown', dialog, event)
  assert.equal(event.prevented, true)
  assert.equal(dialog.listenerCount('keydown'), 0, 'the dialog has no duplicate bubble keydown owner')
  assert.deepEqual(lifecycle.emissions, [['later']])
})

test('the executable onboarding DOM harness cleans up isolation when opening focus throws', async () => {
  const fixture = mountOnboardingHarness({ throwOnInitialFocus: true })
  const { document, lifecycle, appRoot, externalControl, reopen } = fixture

  await lifecycle.mount()
  assert.equal(document.activeElement, reopen, 'open failure restores fallback focus')
  assert.equal(reopen.focusCount, 1)
  assert.equal(appRoot.getAttribute('inert'), 'preserved-inert')
  assert.equal(appRoot.getAttribute('aria-hidden'), 'false')
  assert.equal(externalControl.hasAttribute('inert'), false)
  assert.equal(externalControl.getAttribute('aria-hidden'), 'preserved-external')
  assert.equal(document.listenerCount('keydown'), 0)
  assert.equal(document.listenerCount('focusin'), 0)
})

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
  assert.equal(encodeHallOnboardingSubject('jia-cn-77'), 'u3bc495e536853d790e2b0747d00532d3')
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

test('the wrapper preserves PKCE return query/hash while consuming only template, and GuestDemo restricts handoff ids', () => {
  const entry = readFileSync(new URL('../src/components/world/JuyiHallEntry.vue', import.meta.url), 'utf8')
  const guestDemo = readFileSync(new URL('../src/components/public/GuestDemo.vue', import.meta.url), 'utf8')

  assert.match(entry, /<JuyiHall\s*\/>/)
  assert.match(entry, /consumeGuestDemoTemplateQuery\(route\.query, guestDemoTemplates\)/)
  assert.match(entry, /router\.replace\(\{ path: route\.path, query: handoff\.query, hash: route\.hash \}\)/)
  assert.match(guestDemo, /new Set\(\['research', 'content', 'collaboration'\]\)/)
  assert.match(guestDemo, /allowedGuestDemoTemplateIds\.has\(id\)/)
})

import { expect } from 'chai'
import { webcrypto } from 'node:crypto'
import {
  consumeOAuthTransaction,
  createCodeChallenge,
  createOAuthTransaction,
  OAUTH_RETURN_PATH_MAX_DECODE_PASSES,
  OAUTH_RETURN_PATH_MAX_UTF8_BYTES,
  OAUTH_TRANSACTION_STORAGE_KEY,
  OAUTH_TRANSACTION_TTL_MS,
  safeAppRelativePath
} from '../../src/utils/oauthTransaction.js'

const runtimeConfig = Object.freeze({
  clientId: 'public-web',
  redirectUri: 'https://app.example/oauth2/callback',
  authorizationServer: 'https://auth.example'
})

function memoryStorage () {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }
}

function deterministicCrypto () {
  let next = 0
  return {
    getRandomValues (bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = next++ % 256
      return bytes
    },
    subtle: webcrypto.subtle
  }
}

async function storedTransaction ({ storage = memoryStorage(), now = 100 } = {}) {
  const transaction = await createOAuthTransaction({
    returnTo: '/juyiting?panel=tasks#agent-songjiang',
    storage,
    cryptoImpl: deterministicCrypto(),
    now,
    ...runtimeConfig
  })
  return { storage, transaction }
}

function nestedPercentEncodePath (decodedPath, depth) {
  let payload = decodedPath.slice(1)
  for (let index = 0; index < depth; index += 1) payload = encodeURIComponent(payload)
  return `/${payload}`
}

describe('OAuth transaction utility', () => {
  it('stores the exact versioned configuration-bound transaction shape for ten minutes', async () => {
    const { storage, transaction } = await storedTransaction({ now: 1234 })
    const persisted = JSON.parse(storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY))

    expect(Object.keys(persisted)).to.deep.equal([
      'version',
      'state',
      'codeVerifier',
      'returnTo',
      'createdAt',
      'expiresAt',
      'clientId',
      'redirectUri',
      'authorizationServer'
    ])
    expect(transaction.state).to.match(/^[A-Za-z0-9_-]{43}$/)
    expect(transaction.codeVerifier).to.match(/^[A-Za-z0-9_-]{86}$/)
    expect(transaction.returnTo).to.equal('/juyiting?panel=tasks#agent-songjiang')
    expect(transaction.expiresAt - transaction.createdAt).to.equal(OAUTH_TRANSACTION_TTL_MS)
    expect(persisted).to.deep.equal(transaction)
    expect(await createCodeChallenge(transaction.codeVerifier, deterministicCrypto())).to.match(/^[A-Za-z0-9_-]{43}$/)
  })

  it('consumes a valid transaction once and rejects replay', async () => {
    const { storage, transaction } = await storedTransaction()

    expect(consumeOAuthTransaction(transaction.state, { storage, now: 200, ...runtimeConfig })).to.deep.equal({
      codeVerifier: transaction.codeVerifier,
      returnTo: transaction.returnTo,
      ...runtimeConfig
    })
    expect(() => consumeOAuthTransaction(transaction.state, { storage, now: 200, ...runtimeConfig }))
      .to.throw().with.property('code', 'missing_transaction')
  })

  it('removes and rejects mismatched state or any byte-different runtime configuration', async () => {
    const mismatchedState = await storedTransaction()
    expect(() => consumeOAuthTransaction('x'.repeat(43), {
      storage: mismatchedState.storage,
      now: 200,
      ...runtimeConfig
    })).to.throw().with.property('code', 'state_mismatch')
    expect(mismatchedState.storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY)).to.equal(null)

    for (const [field, value] of [
      ['clientId', 'public-web '],
      ['redirectUri', 'https://app.example/oauth2/callback/'],
      ['authorizationServer', 'https://auth.example/']
    ]) {
      const { storage, transaction } = await storedTransaction()
      expect(() => consumeOAuthTransaction(transaction.state, {
        storage,
        now: 200,
        ...runtimeConfig,
        [field]: value
      })).to.throw().with.property('code', 'configuration_mismatch')
      expect(storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY)).to.equal(null)
    }
  })

  it('enforces the stored expiresAt boundary and exact lifetime', async () => {
    const boundary = await storedTransaction({ now: 100 })
    expect(() => consumeOAuthTransaction(boundary.transaction.state, {
      storage: boundary.storage,
      now: boundary.transaction.expiresAt,
      ...runtimeConfig
    })).to.throw().with.property('code', 'expired_transaction')

    for (const mutate of [
      transaction => { transaction.expiresAt += 1 },
      transaction => { delete transaction.expiresAt },
      transaction => { transaction.createdAt += 0.5 },
      transaction => { transaction.unexpected = true }
    ]) {
      const { storage, transaction } = await storedTransaction()
      const malformed = JSON.parse(storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY))
      mutate(malformed)
      storage.setItem(OAUTH_TRANSACTION_STORAGE_KEY, JSON.stringify(malformed))
      expect(() => consumeOAuthTransaction(transaction.state, { storage, now: 200, ...runtimeConfig }))
        .to.throw().with.property('code', 'invalid_transaction')
      expect(storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY)).to.equal(null)
    }
  })

  it('preserves safe app query/hash paths and rejects unsafe redirect forms', () => {
    expect(safeAppRelativePath('/juyiting?panel=tasks#agent-1')).to.equal('/juyiting?panel=tasks#agent-1')
    expect(safeAppRelativePath('/task/../juyiting?q=1#map')).to.equal('/juyiting?q=1#map')
    for (const unsafe of [
      'https://evil.example/path',
      '//evil.example/path',
      '/\\evil.example/path',
      'javascript:alert(1)',
      '/safe\nLocation: https://evil.example',
      '/%5cevil.example/path',
      '/safe%0d%0aLocation%3A%20https%3A%2F%2Fevil.example',
      '/safe%00path',
      '/%255cevil.example/path',
      nestedPercentEncodePath('/\\evil.example/path', 4),
      nestedPercentEncodePath('/safe\ncontrol', 8),
      '/oauth2/callback',
      '/oauth2/callback?code=loop#again',
      '/%6fauth2/callback?code=loop',
      nestedPercentEncodePath('/oauth2/callback?code=loop', 12)
    ]) {
      expect(safeAppRelativePath(unsafe)).to.equal('/')
    }
  })
  it('enforces the 2048-byte UTF-8 limit on the original and decoded safety-check values', () => {
    const exactAsciiLimit = `/${'a'.repeat(OAUTH_RETURN_PATH_MAX_UTF8_BYTES - 1)}`
    const safeMultibyte = `/${'界'.repeat(682)}`
    const oversizedMultibyte = `/${'界'.repeat(683)}`

    expect(new TextEncoder().encode(exactAsciiLimit).byteLength).to.equal(OAUTH_RETURN_PATH_MAX_UTF8_BYTES)
    expect(safeAppRelativePath(exactAsciiLimit)).to.equal(exactAsciiLimit)
    expect(new TextEncoder().encode(safeMultibyte).byteLength).to.be.at.most(OAUTH_RETURN_PATH_MAX_UTF8_BYTES)
    expect(safeAppRelativePath(safeMultibyte)).not.to.equal('/')
    expect(new TextEncoder().encode(oversizedMultibyte).byteLength).to.be.greaterThan(OAUTH_RETURN_PATH_MAX_UTF8_BYTES)
    expect(safeAppRelativePath(oversizedMultibyte)).to.equal('/')
  })

  it('uses a fixed decode budget and rejects oversized or excessively nested paths', () => {
    const normalNestedSafePath = nestedPercentEncodePath('/safe?view=map#agent-1', 8)
    const reviewerProbe = nestedPercentEncodePath('/safe?view=map', 1100)
    const overBudgetNestedAttack = nestedPercentEncodePath(
      '/oauth2/callback?code=loop',
      OAUTH_RETURN_PATH_MAX_DECODE_PASSES + 1
    )

    expect(safeAppRelativePath(normalNestedSafePath)).to.equal(normalNestedSafePath)
    expect(new TextEncoder().encode(reviewerProbe).byteLength)
      .to.be.greaterThan(OAUTH_RETURN_PATH_MAX_UTF8_BYTES)
    expect(safeAppRelativePath(reviewerProbe)).to.equal('/')
    expect(new TextEncoder().encode(overBudgetNestedAttack).byteLength)
      .to.be.at.most(OAUTH_RETURN_PATH_MAX_UTF8_BYTES)
    expect(safeAppRelativePath(overBudgetNestedAttack)).to.equal('/')
  })

})

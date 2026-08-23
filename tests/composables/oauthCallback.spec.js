import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import {
  OAuthCallbackError,
  oauthCallbackMessage,
  processOAuthCallback
} from '../../src/utils/oauthCallback.js'
import { OAuthTransactionError } from '../../src/utils/oauthTransaction.js'

const transactionConfig = Object.freeze({
  clientId: 'public-web',
  redirectUri: 'https://app.example/oauth2/callback',
  authorizationServer: 'https://auth.example'
})
const validTransaction = Object.freeze({
  codeVerifier: 'v'.repeat(86),
  returnTo: '/juyiting?panel=tasks#map',
  ...transactionConfig
})

describe('OAuth callback flow', () => {
  it('scrubs callback parameters, consumes with current config, and replaces only the stored return path', async () => {
    const calls = []
    await processOAuthCallback({
      query: { code: 'secret-code', state: 'state', returnTo: 'https://evil.example', error_description: 'raw secret' },
      scrubQuery: async () => calls.push('scrub'),
      transactionConfig,
      consumeTransaction: (state, config) => {
        calls.push(['consume', state, config])
        return validTransaction
      },
      exchangeCodeForToken: async (code, transaction) => calls.push(['exchange', code, transaction]),
      loadUserInfo: async () => calls.push('profile'),
      replace: async path => calls.push(`replace:${path}`)
    })

    expect(calls[0]).to.equal('scrub')
    expect(calls[1]).to.deep.equal(['consume', 'state', transactionConfig])
    expect(calls.at(-1)).to.equal('replace:/juyiting?panel=tasks#map')
    expect(calls).not.to.include('replace:https://evil.example')
  })

  it('consumes state but shows a fixed message for provider errors without redirecting', async () => {
    const calls = []
    let failure
    try {
      await processOAuthCallback({
        query: { error: 'access_denied', error_description: 'account token-secret detail', state: 'state' },
        scrubQuery: async () => calls.push('scrub'),
        transactionConfig,
        consumeTransaction: () => validTransaction,
        exchangeCodeForToken: async () => calls.push('exchange'),
        loadUserInfo: async () => calls.push('profile'),
        replace: async path => calls.push(`replace:${path}`)
      })
    } catch (error) {
      failure = error
    }

    expect(failure).to.be.instanceOf(OAuthCallbackError)
    expect(failure.code).to.equal('authorization_denied')
    expect(oauthCallbackMessage(failure)).to.equal('授权未完成，请重新尝试。')
    expect(oauthCallbackMessage(failure)).not.to.include('token-secret')
    expect(calls).to.deep.equal(['scrub'])
  })

  it('rejects duplicate or malformed callback parameters after one transaction consume and before exchange', async () => {
    for (const query of [
      { state: ['state', 'other'], code: 'code' },
      { state: '', code: 'code' },
      { state: 'state', code: ['one', 'two'] },
      { state: 'state', error: ['access_denied', 'server_error'] },
      { state: 'state', code: 'code', error: 'access_denied' },
      { state: 'state', code: '' },
      { state: 'state', error: '' },
      { state: 'state' }
    ]) {
      let consumeCount = 0
      let exchangeCount = 0
      let failure
      try {
        await processOAuthCallback({
          query,
          scrubQuery: async () => {},
          transactionConfig,
          consumeTransaction: () => {
            consumeCount += 1
            return validTransaction
          },
          exchangeCodeForToken: async () => { exchangeCount += 1 },
          loadUserInfo: async () => {},
          replace: async () => {}
        })
      } catch (error) {
        failure = error
      }
      expect(failure?.code).to.equal('invalid_callback')
      expect(consumeCount).to.equal(1)
      expect(exchangeCount).to.equal(0)
    }
  })


  it('does not exchange when the consumed transaction rejects current runtime configuration', async () => {
    let exchangeCount = 0
    let failure
    try {
      await processOAuthCallback({
        query: { state: 'state', code: 'code' },
        scrubQuery: async () => {},
        transactionConfig,
        consumeTransaction: () => {
          throw new OAuthTransactionError('configuration_mismatch', 'configuration mismatch')
        },
        exchangeCodeForToken: async () => { exchangeCount += 1 },
        loadUserInfo: async () => {},
        replace: async () => {}
      })
    } catch (error) {
      failure = error
    }

    expect(failure?.code).to.equal('configuration_mismatch')
    expect(exchangeCount).to.equal(0)
  })

  it('maps state, config, expiry, missing-code, and exchange failures to safe local errors', async () => {
    for (const code of ['state_mismatch', 'configuration_mismatch', 'expired_transaction', 'invalid_callback', 'missing_code']) {
      expect(oauthCallbackMessage({ code })).to.equal('登录请求无效或已失效，请重新登录。')
    }
    expect(oauthCallbackMessage({ code: 'exchange_failed', message: 'raw upstream error' }))
      .to.equal('登录未完成，请稍后重试。')

    const component = readFileSync('src/components/OAuthCallback.vue', 'utf8')
    expect(component).to.include('正在安全验证授权结果')
    expect(component).to.include('transactionConfig: apiStore.oauthRuntimeConfig()')
    expect(component).not.to.include('error_description')
    expect(component).not.to.match(/console\.|log\./)
  })
})

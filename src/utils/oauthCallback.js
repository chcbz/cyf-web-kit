import { consumeOAuthTransaction, OAuthTransactionError } from './oauthTransaction.js'

export class OAuthCallbackError extends Error {
  constructor (code, cause) {
    super(code)
    this.name = 'OAuthCallbackError'
    this.code = code
    this.cause = cause
  }
}

const singleNonemptyQueryValue = value => typeof value === 'string' && value.trim() !== '' ? value : null

export async function processOAuthCallback ({
  query,
  scrubQuery,
  exchangeCodeForToken,
  loadUserInfo,
  replace,
  transactionConfig,
  consumeTransaction = consumeOAuthTransaction
}) {
  await scrubQuery()

  const state = singleNonemptyQueryValue(query?.state)
  const code = singleNonemptyQueryValue(query?.code)
  const providerError = singleNonemptyQueryValue(query?.error)
  const hasCode = query?.code != null
  const hasProviderError = query?.error != null
  const validCallbackShape = state !== null &&
    hasCode !== hasProviderError &&
    (!hasCode || code !== null) &&
    (!hasProviderError || providerError !== null)

  let transaction
  let transactionError
  try {
    transaction = consumeTransaction(state, transactionConfig)
  } catch (error) {
    transactionError = error
  }

  if (!validCallbackShape) {
    throw new OAuthCallbackError('invalid_callback', transactionError)
  }
  if (transactionError) {
    throw new OAuthCallbackError(
      transactionError instanceof OAuthTransactionError ? transactionError.code : 'invalid_transaction',
      transactionError
    )
  }
  if (providerError) throw new OAuthCallbackError('authorization_denied')
  if (!code) throw new OAuthCallbackError('missing_code')

  try {
    await exchangeCodeForToken(code, transaction)
    await loadUserInfo()
  } catch (error) {
    throw new OAuthCallbackError('exchange_failed', error)
  }

  await replace(transaction.returnTo)
}

export function oauthCallbackMessage (error) {
  if (error?.code === 'authorization_denied') return '授权未完成，请重新尝试。'
  if (['missing_transaction', 'invalid_transaction', 'expired_transaction', 'state_mismatch', 'configuration_mismatch', 'invalid_callback', 'missing_code'].includes(error?.code)) {
    return '登录请求无效或已失效，请重新登录。'
  }
  return '登录未完成，请稍后重试。'
}

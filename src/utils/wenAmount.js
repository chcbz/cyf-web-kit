/** Integer-wen wire/display boundary. No legacy silver scaling or floating-point conversion. */
export const isCanonicalDecimalString = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
export const isCanonicalWenAmount = isCanonicalDecimalString

export const wenAmountToBigInt = value => {
  if (!isCanonicalWenAmount(value)) throw new TypeError('WEN amount must be a canonical non-negative decimal string')
  return BigInt(value)
}
export const formatWenAmount = value => wenAmountToBigInt(value).toString()
export const formatWen = value => `${formatWenAmount(value)}文`
export const isEconomyPreviewBuildEnabled = value => value === 'true'

/** The server's Money DTO; harmless extra fields do not change amount semantics. */
export const isWenMoney = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  value.currency === 'WEN' && isCanonicalWenAmount(value.amountMinor) && BigInt(value.amountMinor) <= 9223372036854775807n
export const formatWenMoney = value => {
  if (!isWenMoney(value)) throw new TypeError('Invalid WEN Money DTO')
  return formatWen(value.amountMinor)
}

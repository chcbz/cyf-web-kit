export const MICRO_SILVER_PER_SILVER = 1000000n

/**
 * HTTP money values are canonical non-negative base-10 integer strings.
 * Keep this boundary separate from all display-only formatting so no floating
 * point representation can enter an economy request or response.
 */
export const isCanonicalDecimalString = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
export const isCanonicalMicroAmount = isCanonicalDecimalString

export const microAmountToBigInt = (value) => {
  if (!isCanonicalMicroAmount(value)) throw new TypeError('SILVER amount must be a canonical non-negative decimal string')
  return BigInt(value)
}

export const formatSilverAmount = (value, { maximumFractionDigits = 6, minimumFractionDigits = 0 } = {}) => {
  const amount = microAmountToBigInt(value)
  const whole = amount / MICRO_SILVER_PER_SILVER
  const fraction = (amount % MICRO_SILVER_PER_SILVER).toString().padStart(6, '0')
  const cappedDigits = Math.max(0, Math.min(6, maximumFractionDigits))
  const minimumDigits = Math.max(0, Math.min(cappedDigits, minimumFractionDigits))
  const visible = fraction.slice(0, cappedDigits).replace(/0+$/, '')
  const decimals = visible.padEnd(minimumDigits, '0')
  return decimals ? `${whole}.${decimals}` : whole.toString()
}

export const formatSilverMicro = value => `${formatSilverAmount(value)} SILVER`

export const isEconomyPreviewBuildEnabled = value => value === 'true'

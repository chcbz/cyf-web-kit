import { expect } from 'chai'
import { formatSilverAmount, formatSilverMicro, isCanonicalMicroAmount, microAmountToBigInt } from '../src/utils/silverAmount.js'

describe('SILVER micro amount boundary', () => {
  it('accepts only canonical non-negative decimal strings', () => {
    for (const value of ['0', '1', '1000000', '900719925474099300000000']) expect(isCanonicalMicroAmount(value)).to.equal(true)
    for (const value of ['', '00', '01', '-1', '+1', '1.0', ' 1', 1, null]) expect(isCanonicalMicroAmount(value)).to.equal(false)
  })

  it('formats through BigInt without float conversion', () => {
    expect(microAmountToBigInt('900719925474099300000000')).to.equal(900719925474099300000000n)
    expect(formatSilverAmount('1000000')).to.equal('1')
    expect(formatSilverAmount('1234567')).to.equal('1.234567')
    expect(formatSilverAmount('1234567', { maximumFractionDigits: 2 })).to.equal('1.23')
    expect(formatSilverMicro('900719925474099300000000')).to.equal('900719925474099300 SILVER')
  })

  it('rejects non-canonical amounts at the conversion boundary', () => {
    expect(() => microAmountToBigInt('01')).to.throw(TypeError)
  })
})

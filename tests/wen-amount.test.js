import { expect } from 'chai'
import { formatWenAmount, formatWen, isCanonicalWenAmount, wenAmountToBigInt } from '../src/utils/wenAmount.js'

describe('integer-wen amount boundary', () => {
  it('accepts only canonical non-negative decimal strings', () => {
    for (const value of ['0', '1', '1000000', '900719925474099300000000']) expect(isCanonicalWenAmount(value)).to.equal(true)
    for (const value of ['', '00', '01', '-1', '+1', '1.0', ' 1', 1, null]) expect(isCanonicalWenAmount(value)).to.equal(false)
  })

  it('formats through BigInt without float conversion', () => {
    expect(wenAmountToBigInt('900719925474099300000000')).to.equal(900719925474099300000000n)
    expect(formatWenAmount('1000000')).to.equal('1000000')
    expect(formatWenAmount('1234567')).to.equal('1234567')
    expect(formatWenAmount('1234567', { maximumFractionDigits: 2 })).to.equal('1234567')
    expect(formatWen('900719925474099300000000')).to.equal('900719925474099300000000文')
  })

  it('rejects non-canonical amounts at the conversion boundary', () => {
    expect(() => wenAmountToBigInt('01')).to.throw(TypeError)
  })
})

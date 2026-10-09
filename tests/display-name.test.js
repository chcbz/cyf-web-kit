import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { isOwnMessage, normalizeDisplayName, resolveAccountDisplayName, resolveDisplayName } from '../src/utils/displayName.js'

describe('displayName compatibility policy', () => {
  it('decodes only high-confidence percent UTF-8 and raw Latin-1 mojibake before stripping controls', () => {
    expect(normalizeDisplayName('%E9%99%88%E6%83%A0%E8%B6%85')).to.equal('陈惠超')
    expect(normalizeDisplayName('é\u0099\u0088æ\u0083\u00A0è¶\u0085')).to.equal('陈惠超')
    expect(normalizeDisplayName('\u0000 陈惠超 \u007F')).to.equal('陈惠超')
  })

  it('preserves valid Unicode and safely leaves malformed or irreversible legacy input unrepaired', () => {
    expect(normalizeDisplayName('José')).to.equal('José')
    expect(normalizeDisplayName('Zoë')).to.equal('Zoë')
    expect(normalizeDisplayName('François')).to.equal('François')
    expect(normalizeDisplayName('😀 陈惠超')).to.equal('😀 陈惠超')
    expect(normalizeDisplayName('%E9%99%88%ZZ')).to.equal('%E9%99%88%ZZ')
    expect(normalizeDisplayName('éæ\u00A0è¶')).to.equal('éæ\u00A0è¶')
    expect(resolveDisplayName('éæ\u00A0è¶', 'hero-account')).to.equal('hero-account')
    expect(resolveAccountDisplayName({ nickname: 'éæ\u00A0è¶', username: 'hero-account' }, '用户')).to.equal('hero-account')
  })

  it('keeps ordinary chat stream requests free of client sender authority fields', () => {
    const source = readFileSync(new URL('../src/components/chat/Chat.vue', import.meta.url), 'utf8')
    const requestStart = source.indexOf("await chatApi.create('/stream', {")
    const request = source.slice(requestStart, source.indexOf('    }, {', requestStart))

    expect(request).to.include('conversationType: conversationType.value')
    expect(request).to.not.include('senderName')
    expect(request).to.not.include('senderType')
  })

  it('uses only exact jiacn or owner identity for historical ownership', () => {
    expect(isOwnMessage({ jiacn: 'hero' }, 'hero')).to.equal(true)
    expect(isOwnMessage({ ownerJiacn: 'hero' }, { jiacn: 'hero' })).to.equal(true)
    expect(isOwnMessage({ jiacn: 'hero' }, 'other')).to.equal(false)
    expect(isOwnMessage({ senderName: 'hero' }, 'hero')).to.equal(false)
  })
})

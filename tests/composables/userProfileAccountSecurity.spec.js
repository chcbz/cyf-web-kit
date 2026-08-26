import { expect } from 'chai'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/components/UserProfile.vue', 'utf8')

describe('UserProfile account security controls', () => {
  it('offers distinct local and global logout controls with an explicit impact confirmation', () => {
    expect(source).to.include('退出当前设备')
    expect(source).to.include('退出所有设备')
    expect(source).to.include('不会停用 Agent/API Key，也不是注销账号')
    expect(source).to.include('确认退出所有设备')
    expect(source).to.include('role="dialog"')
  })

  it('keeps controls disabled while busy and announces status and errors accessibly', () => {
    expect(source).to.include(':disabled="busy"')
    expect(source).to.include('aria-live="polite"')
    expect(source).to.include('aria-live="assertive"')
    expect(source).to.include('useConfirmationDialog')
    expect(source).to.include('@keydown="onKeydown"')
    expect(source).to.include('tabindex="-1"')
  })

  it('delegates session semantics to the tested account-security composable', () => {
    expect(source).to.include('useAccountSecuritySession({ router })')
    expect(source).to.include('signOutCurrentDevice')
    expect(source).to.include('signOutAllDevices')
  })
})

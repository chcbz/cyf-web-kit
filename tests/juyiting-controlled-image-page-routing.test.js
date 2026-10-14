import { expect } from 'chai'
import { readFileSync } from 'node:fs'
describe('current JuyiHall never installs retired image/consent writer', () => {
  const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
  it('uses generic point-and-deliberate and no controlled writer or consent event', () => {
    expect(source).not.to.include('useHallPointAndStartControlledBridge')
    expect(source).not.to.include('@confirm-controlled-image-consent')
    expect(source).not.to.include('resumeControlledBridgeOriginal')
    expect(source).to.include('useHallPointAndStart')
  })
  it('retired recovery lanes do not convert historical keys into a new write', () => {
    expect(source).to.include('checkPointAndStart(task.id)')
    expect(source).to.include('pointAndStartRecoveryLane')
    expect(source).not.to.include('controlledBridgeBusy')
  })
})

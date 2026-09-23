import { expect } from 'chai'
import { existsSync, readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { confirmHallLeave, hasMeaningfulHallLeaveWork } from '../src/composables/juyiting/hallAccountNavigation.js'

const entryUrl = new URL('../src/components/juyiting/HallAccountEntry.vue', import.meta.url)
const portraitUrl = new URL('../src/components/juyiting/HallPortraitHome.vue', import.meta.url)
const stageUrl = new URL('../src/components/juyiting/HallStage.vue', import.meta.url)
const hallUrl = new URL('../src/components/world/JuyiHall.vue', import.meta.url)
const entrySource = readFileSync(entryUrl, 'utf8')
const portraitSource = readFileSync(portraitUrl, 'utf8')
const stageSource = readFileSync(stageUrl, 'utf8')
const hallSource = readFileSync(hallUrl, 'utf8')

global.Element = global.window?.Element
global.SVGElement = global.window?.SVGElement
global.Node = global.window?.Node

const vueImportToVar = (_line, imports) => {
  const bindings = imports.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}

const loadAccountEntry = () => {
  const { descriptor } = parse(entrySource, { filename: entryUrl.pathname })
  const body = compileScript(descriptor, { id: 'hall-account-entry', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace('export default', 'return')
  return new Function('Vue', body)(Vue)
}

describe('V1-8 hall account navigation', () => {
  it('renders a current-user account entry with an avatar fallback and stops scene pointer propagation', async () => {
    expect(existsSync(entryUrl)).to.equal(true)
    const wrapper = mount(loadAccountEntry(), { props: { avatar: '', displayName: '一二三四五六七八九十十一十二' } })
    const button = wrapper.get('button[aria-label="个人中心"]')
    expect(button.find('.hall-account-fallback').text()).to.equal('我')
    expect(button.find('.hall-account-name').text()).to.include('一二三四')
    await wrapper.setProps({ compact: true })
    expect(button.find('.hall-account-label').text()).to.equal('我的')
    expect(entrySource).to.include('.hall-account-name { display: none; }')
    await wrapper.setProps({ avatarOnly: true })
    expect(button.find('.hall-account-copy').exists()).to.equal(false)
    expect(entrySource).to.include('v-if="!avatarOnly"')
    expect(entrySource).to.include('@pointerdown.stop')
    expect(entrySource).to.include('@pointerup.stop')
    expect(entrySource).to.include('@keydown.stop')
    await button.trigger('click')
    expect(wrapper.emitted('open-profile')).to.deep.equal([[]])
    await wrapper.setProps({ avatar: 'https://example.test/broken-avatar.png' })
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('.hall-account-fallback').text()).to.equal('我')
    wrapper.unmount()
  })

  it('uses the global current user only and wires visible portrait and true-landscape entry points through JuyiHall', () => {
    expect(hallSource).to.include("import { onBeforeRouteLeave, useRouter } from 'vue-router'")
    expect(hallSource).to.include('globalStore.user?.avatar')
    expect(hallSource).to.include('user.nickname || user.username || globalStore.getUserId')
    expect(hallSource).to.include(':account-avatar="accountAvatar"')
    expect(hallSource).to.include('@open-profile="openProfile"')
    expect(hallSource).to.include("router.push({ name: 'UserProfile' })")
    const accountBinding = hallSource.match(/const accountAvatar = computed\(\(\) =>([\s\S]*?)const selectedAgent = ref/)?.[1] || ''
    expect(accountBinding).not.to.include('selectedAgent')
    expect(accountBinding).not.to.include('portraitStyle')
    expect(portraitSource).to.include('<HallAccountEntry')
    expect(portraitSource).to.include("@open-profile=\"emit('open-profile')\"")
    expect(stageSource).to.include('class="stage-landscape-account"')
    expect(stageSource).to.include('avatar-only')
    const landscapeRootStyles = stageSource.match(/\.hall-stage:has\(\.hall-board\.is-scene-landscape\) \.stage-landscape-account\s*\{([\s\S]*?)\n\}/g)?.at(-1) || ''
    expect(landscapeRootStyles).to.include('width: 30px;')
    expect(landscapeRootStyles).to.include('border: 0;')
    expect(stageSource).to.include('background: transparent;')
    expect(stageSource).to.include('.hall-stage:has(.hall-board.is-scene-landscape) .stage-landscape-account')
    expect(stageSource).to.match(/<div data-tour="landscape-tools" class="stage-tools">[\s\S]*?<HallAccountEntry[\s\S]*?class="stage-landscape-account"/)
    const landscapeAccountStyles = stageSource.match(/\.hall-stage:has\(\.hall-board\.is-scene-landscape\) \.stage-landscape-account\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    expect(landscapeAccountStyles).to.include('display: inline-flex')
    expect(landscapeAccountStyles).not.to.include('position: absolute')
    expect(landscapeAccountStyles).not.to.include('right:')
    expect(stageSource).to.include("emitStageAction('open-profile')")
  })

  it('requires an explicit leave decision only for draft, reply, or voice activity', () => {
    expect(hasMeaningfulHallLeaveWork()).to.equal(false)
    expect(hasMeaningfulHallLeaveWork({ draft: '  ' })).to.equal(false)
    expect(hasMeaningfulHallLeaveWork({ draft: '未发草稿' })).to.equal(true)
    expect(hasMeaningfulHallLeaveWork({ isStreaming: true })).to.equal(true)
    expect(hasMeaningfulHallLeaveWork({ isAwaitingReply: true })).to.equal(true)
    expect(hasMeaningfulHallLeaveWork({ voiceInteractionLocked: true })).to.equal(true)
    expect(hasMeaningfulHallLeaveWork({ voiceTurnActive: true, voiceInteractionLocked: false })).to.equal(true)
    expect(confirmHallLeave({ hasMeaningfulWork: false, confirm: () => { throw new Error('must not ask') } })).to.equal(true)
    expect(confirmHallLeave({ hasMeaningfulWork: true, confirm: () => false })).to.equal(false)
    expect(confirmHallLeave({ hasMeaningfulWork: true, confirm: () => true })).to.equal(true)
    expect(hallSource).to.include('onBeforeRouteLeave(() => {')
    expect(hallSource).to.include('if (!editor) return approvedHallLeave || confirmLeavingHall()')
    expect(hallSource).to.include('editor.saveBeforeLeave()')
    expect(hallSource).to.include('voiceTurnActive: Boolean(hallVoice?.voiceTurnActive)')
  })
})

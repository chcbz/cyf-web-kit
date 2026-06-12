import { readFileSync } from 'fs'
import { expect } from 'chai'

const cardSource = readFileSync(
  new URL('../src/components/juyiting/SelectedAgentCard.vue', import.meta.url),
  'utf8'
)
const hallSource = readFileSync(
  new URL('../src/components/world/JuyiHall.vue', import.meta.url),
  'utf8'
)
const hallStageSource = readFileSync(
  new URL('../src/components/juyiting/HallStage.vue', import.meta.url),
  'utf8'
)
const bountySource = readFileSync(
  new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url),
  'utf8'
)

const cssRule = (source, selector) => {
  const matches = [...source.matchAll(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]+\\}`, 'g'))]
  return matches.map(match => match[0]).join('\n')
}

describe('SelectedAgentCard interaction contract', () => {
  it('only renders after an agent is selected', () => {
    expect(cardSource).to.include('v-if="agent"')
  })

  it('offers explicit actions for details and conversation', () => {
    expect(cardSource).to.include("defineEmits(['open-agents', 'start-chat', 'close-card'])")
    expect(cardSource).to.include("$emit('start-chat')")
    expect(cardSource).to.include("$emit('open-agents')")
  })

  it('renders inside the quick bar instead of as a map overlay', () => {
    const quickBarStart = hallSource.indexOf('<div v-if="selectedAgent" class="quick-bar">')
    const quickBarEnd = hallSource.indexOf('</div>\n    </section>', quickBarStart)
    const quickBarSource = hallSource.slice(quickBarStart, quickBarEnd)
    const cardRule = cssRule(cardSource, '.selected-agent-card')
    expect(quickBarSource).to.include('<SelectedAgentCard')
    expect(cardRule).not.to.include('position: absolute')
    expect(cardRule).not.to.include('bottom: calc')
  })

  it('keeps the selected agent card without rendering the duplicate bottom dock', () => {
    const quickBarStart = hallSource.indexOf('<div v-if="selectedAgent" class="quick-bar">')
    const quickBarEnd = hallSource.indexOf('</div>\n    </section>', quickBarStart)
    const quickBarSource = hallSource.slice(quickBarStart, quickBarEnd)
    expect(quickBarSource).to.include('<SelectedAgentCard')
    expect(quickBarSource).not.to.include('<BottomDock')
    expect(hallSource).not.to.include("import BottomDock")
    expect(quickBarSource).not.to.include('<span class="dock-focus"')
    expect(hallSource).not.to.include('.dock-focus')
  })

  it('uses drag gestures instead of visible map direction controls', () => {
    expect(hallSource).not.to.include('class="map-controls"')
    expect(hallSource).not.to.include('class="map-control"')
    expect(hallSource).not.to.include('.map-controls')
    expect(hallSource).not.to.include('.map-control')
    expect(hallStageSource).to.include('@pointerdown="startMapDrag"')
    expect(hallStageSource).to.include('@pointermove="moveMapDrag"')
    expect(hallStageSource).to.include('@pointerup="endMapDrag"')
    expect(hallStageSource).to.include('@pointercancel="endMapDrag"')
  })

  it('does not auto-select the first loaded agent', () => {
    expect(hallSource).not.to.include('selectedAgent.value = agents.value[0]')
  })

  it('does not depend on the mobile direction controls footprint', () => {
    expect(cardSource).not.to.include('--map-controls-footprint')
    expect(hallSource).not.to.include('--map-controls-footprint')
  })

  it('keeps cards and task panels inside the small-screen viewport', () => {
    const cardRule = cssRule(cardSource, '.selected-agent-card')
    const quickBarRule = cssRule(hallSource, '.quick-bar')
    const panelOverlayRule = cssRule(hallSource, '.panel-overlay')
    const floatingPanelRule = cssRule(hallSource, '.floating-panel')
    const panelCloseRule = cssRule(hallSource, '.panel-close')
    const taskCardRule = cssRule(bountySource, '.task-card')
    const taskDetailRule = cssRule(bountySource, '.task-detail-card')

    expect(cardRule).to.include('box-sizing: border-box')
    expect(cardRule).to.include('max-width: 100%')
    expect(quickBarRule).to.include('box-sizing: border-box')
    expect(panelOverlayRule).to.include('box-sizing: border-box')
    expect(floatingPanelRule).to.include('box-sizing: border-box')
    expect(floatingPanelRule).to.include('max-width: 100%')
    expect(floatingPanelRule).to.include('width: calc(100% - 16px)')
    expect(panelCloseRule).to.include('flex: 0 0 36px')
    expect(taskCardRule).to.include('box-sizing: border-box')
    expect(taskDetailRule).to.include('box-sizing: border-box')
    expect(taskDetailRule).to.include('max-width: 100%')
  })

  it('does not resize the map when the selected agent card appears', () => {
    const quickBarRule = cssRule(hallSource, '.quick-bar')

    expect(quickBarRule).to.include('position: absolute')
    expect(quickBarRule).to.include('left: 0')
    expect(quickBarRule).to.include('right: 0')
    expect(quickBarRule).to.include('bottom: 0')
    expect(quickBarRule).not.to.include('flex: 0 0 auto')
  })

  it('selects an agent without showing a toast', () => {
    const selectAgentStart = hallSource.indexOf('const selectAgent = (agent) => {')
    const selectAgentEnd = hallSource.indexOf('const openPanel', selectAgentStart)
    const selectAgentSource = hallSource.slice(selectAgentStart, selectAgentEnd)

    expect(selectAgentSource).to.include('selectedAgent.value = agent')
    expect(selectAgentSource).not.to.include('showToast')
    expect(hallSource).not.to.include('已选中')
    expect(hallSource).not.to.include('\\u5df2\\u9009\\u4e2d')
  })
})

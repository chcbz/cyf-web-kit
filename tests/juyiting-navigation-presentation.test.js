import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { resolveHallNavigationPresentation } from '../src/composables/juyiting/useHallPanels.js'

const portrait = overrides => resolveHallNavigationPresentation({
  isMobileCoarse: true,
  experienceMode: 'portrait-command',
  isOverviewHome: true,
  ...overrides
})

describe('Juyi Hall navigation presentation', () => {
  it('keeps the dock only for each primary root and removes it for keyboard or nested state', () => {
    for (const renderedPanel of ['', 'tasks', 'treasure', 'mine']) {
      expect(portrait({ renderedPanel }).showWorkbenchDock, renderedPanel || 'overview').to.equal(true)
    }
    expect(portrait({ renderedPanel: 'tasks', bountyCanGoBack: true }).showWorkbenchDock).to.equal(false)
    expect(portrait({ renderedPanel: 'tasks', isKeyboardActive: true }).showWorkbenchDock).to.equal(false)
    expect(portrait({ renderedPanel: 'messages' }).showWorkbenchDock).to.equal(false)
  })

  it('assigns existing self-owned returns before Hall-owned returns', () => {
    expect(portrait({ renderedPanel: 'tasks', bountyCanGoBack: true }).returnOwner).to.equal('self')
    expect(portrait({ renderedPanel: 'draft', draftCanGoBack: true }).returnOwner).to.equal('self')
    expect(portrait({ renderedPanel: 'library', libraryCanGoBack: true }).returnOwner).to.equal('self')
    expect(portrait({ portraitTaskDetailOpen: true }).returnOwner).to.equal('self')
    expect(portrait({ renderedPanel: 'tasks', formalTaskRef: { id: 'formal-1' } }).returnOwner).to.equal('hall')
    expect(portrait({ renderedPanel: 'treasure', treasureCanGoBack: true }).returnOwner).to.equal('hall')
    expect(portrait({ renderedPanel: 'workspace' }).returnOwner).to.equal('hall')
    expect(portrait({ renderedPanel: 'messages', panelReturnPanel: 'tasks' }).returnOwner).to.equal('hall')
  })

  it('wires resolver-owned dock and Hall chrome without bypassing existing navigation actions', () => {
    const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(source).to.include('resolveHallNavigationPresentation')
    expect(source).to.include('v-show="showWorkbenchDock && (Boolean(activePanel) || !renderedPanel)"')
    expect(source).to.include("'has-workbench-dock': showWorkbenchDock && (Boolean(activePanel) || !renderedPanel)")
    expect(source).to.include('v-if="navigationPresentation.showHallReturn"')
    expect(source).to.include('v-if="navigationPresentation.showHallClose"')
    expect(source).to.include('@click="returnPanel"')
    expect(source).to.include('@click="closePanel"')
  })

  it('makes mobile return and close mutually exclusive while retaining desktop nested close', () => {
    const mobileChild = portrait({ renderedPanel: 'treasure', treasureCanGoBack: true })
    expect(mobileChild.showHallReturn).to.equal(true)
    expect(mobileChild.showHallClose).to.equal(false)
    expect(portrait({ renderedPanel: 'messages' }).showHallClose).to.equal(true)

    const desktopChild = resolveHallNavigationPresentation({
      isMobileCoarse: false,
      experienceMode: 'landscape-map',
      renderedPanel: 'treasure',
      treasureCanGoBack: true
    })
    expect(desktopChild.showHallReturn).to.equal(true)
    expect(desktopChild.showHallClose).to.equal(true)
  })
})

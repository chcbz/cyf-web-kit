import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { resolveHallNavigationPresentation } from '../src/composables/juyiting/useHallPanels.js'

const portrait = overrides => resolveHallNavigationPresentation({
  isMobileCoarse: true,
  experienceMode: 'portrait-command',
  isOverviewHome: true,
  ...overrides
})

const desktop = overrides => resolveHallNavigationPresentation({
  isMobileCoarse: false,
  experienceMode: 'landscape-map',
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

  it('assigns self-owned returns while giving formal delivery explicit Hall precedence', () => {
    expect(portrait({ renderedPanel: 'tasks', bountyCanGoBack: true }).returnOwner).to.equal('self')
    expect(portrait({ renderedPanel: 'draft', draftCanGoBack: true }).returnOwner).to.equal('self')
    expect(portrait({ renderedPanel: 'library', libraryCanGoBack: true }).returnOwner).to.equal('self')
    expect(portrait({ portraitTaskDetailOpen: true }).returnOwner).to.equal('self')
    const formalOverlap = portrait({ renderedPanel: 'tasks', formalTaskRef: { id: 'formal-1' }, bountyCanGoBack: true })
    expect(formalOverlap.returnOwner).to.equal('hall')
    expect(formalOverlap.showHallReturn).to.equal(true)
    expect(formalOverlap.showPrimaryChildHeader).to.equal(true)
    expect(formalOverlap.showHallClose).to.equal(false)
    expect(portrait({ renderedPanel: 'treasure', treasureCanGoBack: true }).returnOwner).to.equal('hall')
    expect(portrait({ renderedPanel: 'workspace' }).returnOwner).to.equal('hall')
    expect(portrait({ renderedPanel: 'messages', panelReturnPanel: 'tasks' }).returnOwner).to.equal('hall')
  })


  it('closes agents/catalog and other non-primary roots while leaving primary roots chrome-free', () => {
    for (const present of [portrait, desktop]) {
      for (const renderedPanel of ['agents', 'catalog', 'messages', 'chat', 'draft']) {
        const root = present({ renderedPanel })
        expect(root.returnOwner, renderedPanel).to.equal('none')
        expect(root.showHallReturn, renderedPanel).to.equal(false)
        expect(root.showHallClose, renderedPanel).to.equal(true)
        expect(root.showWorkbenchDock, renderedPanel).to.equal(false)
      }
      for (const renderedPanel of ['', 'tasks', 'treasure', 'mine']) {
        const root = present({ renderedPanel })
        expect(root.showHallReturn, renderedPanel || 'overview').to.equal(false)
        expect(root.showHallClose, renderedPanel || 'overview').to.equal(false)
        expect(root.showPrimaryChildHeader, renderedPanel || 'overview').to.equal(false)
      }
    }
  })

  it('covers self-owned detail variants and Hall-owned workspace navigation', () => {
    for (const renderedPanel of ['draft', 'item', 'formalDraft']) {
      const mobileDraft = portrait({ renderedPanel, draftCanGoBack: true })
      expect(mobileDraft.returnOwner, renderedPanel).to.equal('self')
      expect(mobileDraft.showHallReturn, renderedPanel).to.equal(false)
      expect(mobileDraft.showHallClose, renderedPanel).to.equal(false)
      expect(desktop({ renderedPanel, draftCanGoBack: true }).showHallClose, renderedPanel).to.equal(true)
    }

    const library = portrait({ renderedPanel: 'library', libraryCanGoBack: true })
    expect(library.returnOwner).to.equal('self')
    expect(library.showHallClose).to.equal(false)
    expect(desktop({ renderedPanel: 'library', libraryCanGoBack: true }).showHallClose).to.equal(true)

    const portraitDetail = portrait({ portraitTaskDetailOpen: true })
    expect(portraitDetail.returnOwner).to.equal('self')
    expect(portraitDetail.showHallClose).to.equal(false)

    const workspace = portrait({ renderedPanel: 'workspace', panelReturnPanel: 'tasks' })
    expect(workspace.returnOwner).to.equal('hall')
    expect(workspace.showHallReturn).to.equal(true)
    expect(workspace.showHallClose).to.equal(false)
    expect(desktop({ renderedPanel: 'workspace', panelReturnPanel: 'tasks' }).showHallClose).to.equal(true)
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


  it('keeps semantic workbench tokens scoped to overview rather than map mode', () => {
    const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    const overviewTheme = source.match(/\.juyi-page\.home-overview \{([\s\S]*?)\n\}/)?.[1] || ''
    expect(overviewTheme).to.include('--hall-canvas: #f5f4f0')
    expect(overviewTheme).to.include('--hall-control-height: 44px')
    expect(source).not.to.include('theme-workbench')
    expect(source).not.to.match(/\.home-map[^\{]*\{[^}]*--hall-canvas/)
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

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const workspace = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')
const profile = readFileSync(new URL('../src/components/UserProfile.vue', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const sideMenu = readFileSync(new URL('../src/components/SideMenu.vue', import.meta.url), 'utf8')
const taskMaterialLinks = readFileSync(new URL('../src/components/personal-workspace/TaskMaterialLinks.vue', import.meta.url), 'utf8')
const overview = readFileSync(new URL('../src/components/juyiting/HallOverview.vue', import.meta.url), 'utf8')
const catalog = readFileSync(new URL('../src/components/juyiting/PersonaCatalogPanel.vue', import.meta.url), 'utf8')
const library = readFileSync(new URL('../src/components/juyiting/LibraryPanel.vue', import.meta.url), 'utf8')
const archiveReader = readFileSync(new URL('../src/components/juyiting/archive/ArchiveReader.vue', import.meta.url), 'utf8')

describe('1.13.6 Babao-box modal-stack hall presentation', () => {
  it('uses the embedded Juyi Hall treasure style instead of the former blue-white workspace shell', () => {
    assert.match(workspace, /'is-hall-treasure': embedded/)
    assert.match(workspace, /'is-progress-view': activeModal === 'delivery' && showDeliveryProgress/)
    assert.match(workspace, /--treasure-wood: #6d3f1f/)
    assert.match(workspace, /--treasure-paper: #fff8e8/)
    assert.match(workspace, /--treasure-line: #d7c3a2/)
    assert.match(workspace, /聚义厅 · 内堂收纳/)
    assert.match(workspace, /百宝箱/)
    assert.match(workspace, /class="modal-stage"/)
    assert.match(workspace, /class="babao-modal box-modal"/)
    assert.match(workspace, /class="babao-modal child-modal library-modal"/)
    assert.match(workspace, /class="babao-modal detail-modal"/)
    assert.match(workspace, /const activeModal = ref\(embedded \? 'library' : 'home'\)/)
    assert.match(workspace, /第一层 · 箱面/)
    assert.match(workspace, /第二层 · 资料柜/)
    assert.match(workspace, /第三层 · 文件详情/)
    assert.doesNotMatch(workspace, /回聚义厅|workspace-card|workbench-layout|workbench-deck/)
    assert.doesNotMatch(workspace, /#4f46e5|#eef2ff|#f7f8fc/)
  })

  it('locks the embedded material-search input and submit button to one 44px control row', () => {
    assert.match(workspace, /\.treasure-search \{ display:flex; align-items:stretch; gap:12px; min-height:44px;/)
    assert.match(workspace, /\.treasure-search label \{ display:flex; flex:0 1 min\(360px,100%\); width:min\(360px,100%\); min-width:0; margin:0; \}/)
    assert.match(workspace, /\.treasure-search input,\.treasure-search>button \{ box-sizing:border-box; height:44px; min-height:44px; margin:0; \}/)
  })

  it('uses one workbench selector language for new matters and linked material detail', () => {
    for (const source of [overview, taskMaterialLinks]) {
      assert.match(source, /--material-ground:#f3f3ed;--material-paper:#fffefa;--material-ink:#242e2b;--material-muted:#68716b;--material-line:#d8d8ce;--material-brand:#923f30/)
      assert.match(source, /min-height:64px/)
      assert.match(source, /padding:16px max\(16px,env\(safe-area-inset-right\)\)/)
    }
  })

  it('keeps a gutter above recruitment cards and applies the workbench archive-search shell', () => {
    assert.match(catalog, /\.catalog-grid \{[\s\S]*?padding: 12px 12px 12px;/)
    assert.match(library, /--library-ground: var\(--work-ground, #f3f3ed\)/)
    assert.match(library, /\.library-search \{ display:grid; grid-template-columns:minmax\(180px,1fr\) 132px auto; gap:10px; padding:12px; border:1px solid var\(--library-line\); border-radius:10px; background:var\(--library-paper\); \}/)
  })

  it('keeps archive citation text readable and makes the nested return action match workbench navigation', () => {
    assert.match(archiveReader, /class="reader-cite-action"/)
    assert.match(archiveReader, /\.reader-actions \.reader-cite-action \{[\s\S]*?grid-column: span 2;[\s\S]*?white-space: normal;/)
    assert.match(archiveReader, /← 返回/)
    assert.match(archiveReader, /\.reader-header-button\.reader-exit \{[\s\S]*?background: transparent;[\s\S]*?color: var\(--archive-brand\);/)
  })

  it('aligns the fixed-version selector and download action on one control row', () => {
    assert.match(workspace, /class="treasure-version-label">版本/)
    assert.match(workspace, /\.treasure-version-tools\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;grid-template-rows:auto auto/)
    assert.match(workspace, /\.treasure-version-tools select\{grid-column:1;grid-row:2/)
    assert.match(workspace, /\.treasure-version-tools>button\{grid-column:2;grid-row:2;align-self:stretch/)
    assert.match(workspace, /\.treasure-file-heading h2:focus \{ outline:none; \}/)
  })

  it('keeps the workspace reachable only through the Juyi Hall Babao entry', () => {
    assert.doesNotMatch(profile, /workspace-discovery|PersonalWorkspace/)
    assert.doesNotMatch(router, /path: '\/workspace'|name: 'PersonalWorkspace'/)
    assert.doesNotMatch(sideMenu, /PersonalWorkspace/)
  })
})

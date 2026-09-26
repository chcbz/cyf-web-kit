import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const workspace = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')
const profile = readFileSync(new URL('../src/components/UserProfile.vue', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const sideMenu = readFileSync(new URL('../src/components/SideMenu.vue', import.meta.url), 'utf8')

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

  it('aligns the embedded material-search input and submit button on the same 44px control row', () => {
    assert.match(workspace, /\.treasure-search input,\.treasure-search>button \{ box-sizing:border-box; height:44px; min-height:44px; \}/)
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

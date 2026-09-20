import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const workspace = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')
const profile = readFileSync(new URL('../src/components/UserProfile.vue', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const sideMenu = readFileSync(new URL('../src/components/SideMenu.vue', import.meta.url), 'utf8')

describe('1.13.6 Babao-box modal-stack hall presentation', () => {
  it('uses the embedded Juyi Hall treasure style instead of the former blue-white workspace shell', () => {
    assert.match(workspace, /:class="\{ 'is-hall-treasure': embedded \}"/)
    assert.match(workspace, /--treasure-wood: #6d3f1f/)
    assert.match(workspace, /--treasure-paper: #fff8e8/)
    assert.match(workspace, /--treasure-line: #d7c3a2/)
    assert.match(workspace, /聚义厅 · 内堂收纳/)
    assert.match(workspace, /百宝箱/)
    assert.match(workspace, /class="modal-stage"/)
    assert.match(workspace, /class="babao-modal box-modal"/)
    assert.match(workspace, /class="babao-modal child-modal library-modal"/)
    assert.match(workspace, /class="babao-modal detail-modal"/)
    assert.match(workspace, /const activeModal = ref\('home'\)/)
    assert.match(workspace, /第一层 · 箱面/)
    assert.match(workspace, /第二层 · 资料柜/)
    assert.match(workspace, /第三层 · 文件详情/)
    assert.doesNotMatch(workspace, /回聚义厅|workspace-card|workbench-layout|workbench-deck/)
    assert.doesNotMatch(workspace, /#4f46e5|#eef2ff|#f7f8fc/)
  })

  it('keeps the workspace reachable only through the Juyi Hall Babao entry', () => {
    assert.doesNotMatch(profile, /workspace-discovery|PersonalWorkspace/)
    assert.doesNotMatch(router, /path: '\/workspace'|name: 'PersonalWorkspace'/)
    assert.doesNotMatch(sideMenu, /PersonalWorkspace/)
  })
})

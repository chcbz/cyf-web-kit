import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const workspace = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')
const profile = readFileSync(new URL('../src/components/UserProfile.vue', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const sideMenu = readFileSync(new URL('../src/components/SideMenu.vue', import.meta.url), 'utf8')

describe('1.13.5 Babao-box layered hall presentation', () => {
  it('uses the embedded Juyi Hall treasure style instead of the former blue-white workspace shell', () => {
    assert.match(workspace, /:class="\{ 'is-hall-treasure': embedded \}"/)
    assert.match(workspace, /--treasure-wood: #6d3f1f/)
    assert.match(workspace, /--treasure-paper: #fff8e8/)
    assert.match(workspace, /--treasure-line: #d7c3a2/)
    assert.match(workspace, /聚义厅 · 内堂收纳/)
    assert.match(workspace, /百宝箱/)
    assert.match(workspace, /class="treasure-workbench"/)
    assert.match(workspace, /class="workbench-toolbar"/)
    assert.match(workspace, /class="workbench-deck"/)
    assert.match(workspace, /class="treasure-overview"/)
    assert.match(workspace, /class="workbench-drawer"/)
    assert.match(workspace, /const activeLayer = ref\('overview'\)/)
    assert.match(workspace, /一层<\/span>箱面/)
    assert.match(workspace, /二层<\/span>资料柜/)
    assert.match(workspace, /三层 · 资料详情与办事笺/)
    assert.doesNotMatch(workspace, /回聚义厅|workspace-card|workbench-layout/)
    assert.doesNotMatch(workspace, /#4f46e5|#eef2ff|#f7f8fc/)
  })

  it('keeps the workspace reachable only through the Juyi Hall Babao entry', () => {
    assert.doesNotMatch(profile, /workspace-discovery|PersonalWorkspace/)
    assert.doesNotMatch(router, /path: '\/workspace'|name: 'PersonalWorkspace'/)
    assert.doesNotMatch(sideMenu, /PersonalWorkspace/)
  })
})

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')

describe('Juyi Hall conversation material references', () => {
  it('shows task-scoped fixed versions from the real task directory without turning them into chat text', () => {
    assert.match(source, /class="icon-button workspace-entry"/)
    assert.match(source, /\$emit\('open-workspace'\)/)
    assert.match(source, /usePersonalWorkspaceConversationLinks/)
    assert.match(source, /usePersonalWorkspaceTaskLinks/)
    assert.match(source, /当前事项固定资料/)
    assert.match(source, /\['INPUT', 'REFERENCE'\]/)
    assert.match(source, /资料标识、固定版本和用途/)
    assert.match(source, /正式执行 input manifest/)
    assert.doesNotMatch(source, /参看资料：/)
    assert.doesNotMatch(source, /execution-directory/)
    assert.doesNotMatch(source, /deliverable-directory/)
  })

  it('keeps legacy execution support but limits the embedded entrance to file browsing', () => {
    assert.match(workspaceSource, /usePersonalWorkspace/)
    assert.match(workspaceSource, /usePersonalWorkspaceExecution/)
    assert.match(workspaceSource, /const \{ embedded, detailAllowed, compact \} = defineProps/)
    assert.match(workspaceSource, /百宝箱/)
    assert.match(workspaceSource, /v-if="!embedded && activeModal === 'delivery'"/)
    assert.match(workspaceSource, /if \(!embedded\) \{/)
  })
})

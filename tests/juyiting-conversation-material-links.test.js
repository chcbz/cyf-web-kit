import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')

describe('Juyi Hall conversation material references', () => {
  it('keeps the compact Babao entry and allows version-pinned references in the conversation', () => {
    assert.match(source, /class="icon-button workspace-entry"/)
    assert.match(source, /\$emit\('open-workspace'\)/)
    assert.match(source, /usePersonalWorkspaceConversationLinks/)
    assert.match(source, /引用资料/)
    assert.match(source, /role: 'REFERENCE'/)
    assert.match(source, /参看资料：/)
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

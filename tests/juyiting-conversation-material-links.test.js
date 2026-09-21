import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')

describe('Juyi Hall Babao-box workspace entry', () => {
  it('keeps conversation detail focused on messages and exposes only the compact workspace entry', () => {
    assert.match(source, /class="icon-button workspace-entry"/)
    assert.match(source, /\$emit\('open-workspace'\)/)
    assert.doesNotMatch(source, /usePersonalWorkspaceConversationLinks/)
    assert.doesNotMatch(source, /execution-directory/)
    assert.doesNotMatch(source, /deliverable-directory/)
  })

  it('keeps legacy execution support but limits the embedded entrance to file browsing', () => {
    assert.match(workspaceSource, /usePersonalWorkspace/)
    assert.match(workspaceSource, /usePersonalWorkspaceExecution/)
    assert.match(workspaceSource, /const \{ embedded, detailAllowed \} = defineProps/)
    assert.match(workspaceSource, /百宝箱/)
    assert.match(workspaceSource, /v-if="!embedded && activeModal === 'delivery'"/)
    assert.match(workspaceSource, /if \(!embedded\) \{/)
  })
})

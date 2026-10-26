import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')

describe('Juyi Hall conversation material references', () => {
  // Composer events and picker placement are exercised in the mounted component suites.
  it('shows task-scoped fixed versions from the real task directory without turning them into chat text', () => {
    assert.match(source, /usePersonalWorkspaceConversationLinks/)
    assert.match(source, /usePersonalWorkspaceTaskLinks/)
    assert.match(source, /本任务资料与使用范围/)
    assert.match(source, /\['INPUT', 'REFERENCE'\]/)
    assert.match(source, /option value="TASK_DEFAULT">本任务资料/)
    assert.match(source, /class="material-use-list"/)
    assert.match(source, /sourceSelectors: typedSourceSelectors/)
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

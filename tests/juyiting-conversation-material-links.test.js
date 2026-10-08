import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../src/components/juyiting/HallChatComposer.vue', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')

describe('Juyi Hall conversation material references', () => {
  it('shows task-scoped fixed versions from the real task directory without turning them into chat text', () => {
    assert.match(source, /@open-workspace="\$emit\('open-workspace'\)"/)
    assert.match(composerSource, /class="composer-add-materials"[\s\S]*?aria-label="添加资料"[\s\S]*?@click="openMaterials"[\s\S]*?<svg[\s\S]*?<\/button>/)
    assert.doesNotMatch(composerSource, /@click="openWorkspace">工作空间<\/button>/)
    assert.match(source, /@click="\$emit\('open-workspace'\)">去百宝箱添加<\/button>/)
    assert.match(composerSource, /const openMaterials = \(\) => \{ emit\('open-materials'\) \}/)
    assert.match(source, /\$emit\('open-workspace'\)/)
    assert.match(source, /usePersonalWorkspaceConversationLinks/)
    assert.match(source, /usePersonalWorkspaceTaskLinks/)
    assert.match(source, /本次需求的资料/)
    assert.match(source, /\['INPUT', 'REFERENCE'\]/)
    assert.match(source, /图片、文档、音频等都可以作为资料/)
    assert.match(source, /class="typed-source-selector"/)
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

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')

describe('Juyi Hall conversation material persistence', () => {
  it('pins local draft inputs to the current authorized conversation before the one execution request', () => {
    assert.match(source, /usePersonalWorkspaceConversationLinks/)
    assert.match(source, /conversationId: \(\) => props\.conversationId/)
    assert.match(source, /const ensureConversationInputs = async \(\) =>/)
    assert.match(source, /conversationLinks\.attach\(\{ fileId: material\.fileId, version: Number\(material\.version\), role: 'INPUT' \}\)/)
    assert.match(source, /if \(!await ensureConversationInputs\(\)\) return/)
    assert.match(source, /conversationLinks\.dispose\(\)/)
  })

  it('keeps attachment removal explicit and does not claim it revokes an already-started execution snapshot', () => {
    assert.match(source, /解除关联不会撤销已开始执行的输入快照/)
    assert.match(source, /detachConversationInput = link => \{ void conversationLinks\.detach\(link\) \}/)
  })
})

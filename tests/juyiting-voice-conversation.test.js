import { expect } from 'chai'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Juyi Hall voice conversation V1 contract', () => {
  it('keeps one Hall-owned voice state machine and explicit stream send context', () => {
    const hall = source('../src/components/world/JuyiHall.vue')
    const conversation = source('../src/composables/juyiting/useHallConversation.js')
    expect(hall).to.include('useHallVoiceConversation')
    expect(hall).to.include("sendHallMessage({ content, contextSnapshot, source: 'voice', turnId })")
    expect(conversation).to.include('const sendContext = contextSnapshot || currentChatContext.value')
    expect(conversation).to.include('replyEventSequence')
  })

  it('fences recorder lifecycle, imposes V1 limits, and bounds synthesis playback', () => {
    const voice = source('../src/composables/juyiting/useHallVoiceConversation.js')
    expect(voice).to.include('const MAX_DURATION_MS = 45_000')
    expect(voice).to.include('const MAX_AUDIO_BYTES = 5 * 1024 * 1024')
    expect(voice).to.include('const MAX_TTS_BYTES = 8 * 1024 * 1024')
    expect(voice).to.include('if (current !== generation)')
    expect(voice).to.include('stream?.getTracks?.().forEach(track => track.stop?.())')
    expect(voice).to.include("'/speech/transcriptions'")
    expect(voice).to.include('/chat/speech/synthesis')
  })

  it('uses HallStage effective scene mode rather than physical orientation for HUD visibility', () => {
    const stage = source('../src/components/juyiting/HallStage.vue')
    const hall = source('../src/components/world/JuyiHall.vue')
    expect(stage).to.include("'scene-mode-change'")
    expect(stage).to.include("watch(sceneMode, mode => emit('scene-mode-change', mode), { immediate: true })")
    expect(hall).to.include("effectiveSceneMode === 'landscape' && !activePanel")
    expect(hall).to.include('isPanelSessionActive || voiceInteractionLocked')
  })
})

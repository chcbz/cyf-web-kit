import { ref } from 'vue'
import { useStorage } from '@vueuse/core'

const soundProfiles = {
  tap: [
    { frequency: 420, duration: 0.06, gain: 0.024, type: 'triangle' }
  ],
  panel: [
    { frequency: 392, duration: 0.06, gain: 0.022, type: 'triangle' },
    { frequency: 523.25, duration: 0.08, gain: 0.02, type: 'triangle', delay: 0.055 }
  ],
  select: [
    { frequency: 330, duration: 0.06, gain: 0.022, type: 'sine' },
    { frequency: 440, duration: 0.09, gain: 0.02, type: 'triangle', delay: 0.05 }
  ],
  refresh: [
    { frequency: 420, duration: 0.05, gain: 0.018, type: 'triangle' },
    { frequency: 560, duration: 0.05, gain: 0.016, type: 'triangle', delay: 0.045 },
    { frequency: 740, duration: 0.08, gain: 0.015, type: 'triangle', delay: 0.09 }
  ],
  send: [
    { frequency: 392, duration: 0.05, gain: 0.02, type: 'triangle' },
    { frequency: 349.23, duration: 0.05, gain: 0.018, type: 'triangle', delay: 0.04 },
    { frequency: 523.25, duration: 0.09, gain: 0.019, type: 'triangle', delay: 0.085 }
  ],
  success: [
    { frequency: 523.25, duration: 0.06, gain: 0.02, type: 'triangle' },
    { frequency: 659.25, duration: 0.1, gain: 0.018, type: 'triangle', delay: 0.06 }
  ],
  error: [
    { frequency: 290, duration: 0.08, gain: 0.02, type: 'sawtooth' },
    { frequency: 220, duration: 0.12, gain: 0.018, type: 'sawtooth', delay: 0.06 }
  ]
}

export const useHallSound = () => {
  const soundEnabled = useStorage('juyiting-sound-enabled', true)
  let audioContext = null
  const soundSuppressed = ref(false)

  const getAudioContext = async () => {
    if (typeof window === 'undefined') return null
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext
      if (!AudioCtor) return null
      audioContext = new AudioCtor()
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    return audioContext
  }

  const playProfile = async (name) => {
    if (!soundEnabled.value || soundSuppressed.value) return
    const profile = soundProfiles[name]
    if (!profile?.length) return

    try {
      const context = await getAudioContext()
      if (!context) return
      const baseTime = context.currentTime + 0.01

      profile.forEach(step => {
        const oscillator = context.createOscillator()
        const gainNode = context.createGain()
        const startTime = baseTime + (step.delay || 0)
        const endTime = startTime + step.duration

        oscillator.type = step.type || 'triangle'
        oscillator.frequency.setValueAtTime(step.frequency, startTime)
        gainNode.gain.setValueAtTime(0.0001, startTime)
        gainNode.gain.exponentialRampToValueAtTime(step.gain || 0.02, startTime + 0.012)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime)

        oscillator.connect(gainNode)
        gainNode.connect(context.destination)
        oscillator.start(startTime)
        oscillator.stop(endTime + 0.02)
      })
    } catch (error) {
      console.warn('hall sound unavailable:', error)
    }
  }

  return {
    playAgentSelect: () => playProfile('select'),
    playError: () => playProfile('error'),
    playPanelOpen: () => playProfile('panel'),
    playRefresh: () => playProfile('refresh'),
    playSend: () => playProfile('send'),
    playSuccess: () => playProfile('success'),
    playTap: () => playProfile('tap'),
    setSoundSuppressed: nextValue => {
      soundSuppressed.value = Boolean(nextValue)
    },
    setSoundEnabled: (nextValue) => {
      soundEnabled.value = Boolean(nextValue)
    },
    soundEnabled,
    soundSuppressed
  }
}

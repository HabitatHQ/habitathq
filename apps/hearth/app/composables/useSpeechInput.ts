import { Capacitor } from '@capacitor/core'
import { onUnmounted, ref } from 'vue'

interface SpeechInputReturn {
  isSupported: Ref<boolean>
  isListening: Ref<boolean>
  transcript: Ref<string>
  error: Ref<string | null>
  start: () => Promise<void>
  stop: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: any = null

function getSpeechRecognitionClass(): (new () => any) | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function useSpeechInput(): SpeechInputReturn {
  const isSupported = ref(false)
  const isListening = ref(false)
  const transcript = ref('')
  const error = ref<string | null>(null)

  if (import.meta.client) {
    if (Capacitor.isNativePlatform()) {
      isSupported.value = true
    } else {
      isSupported.value = !!getSpeechRecognitionClass()
    }
  }

  async function start() {
    error.value = null
    transcript.value = ''

    if (Capacitor.isNativePlatform()) {
      await startNative()
    } else {
      startWeb()
    }
  }

  function startWeb() {
    const SR = getSpeechRecognitionClass()
    if (!SR) {
      error.value = 'Speech recognition not supported in this browser'
      return
    }

    recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      isListening.value = true
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      let finalTranscript = ''
      let interimTranscript = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) finalTranscript += result[0].transcript
        else interimTranscript += result[0].transcript
      }
      transcript.value = finalTranscript || interimTranscript
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      error.value =
        e.error === 'not-allowed'
          ? 'Microphone permission denied'
          : e.error === 'no-speech'
            ? 'No speech detected'
            : `Speech error: ${e.error}`
      isListening.value = false
    }
    recognition.onend = () => {
      isListening.value = false
    }
    recognition.start()
  }

  async function startNative() {
    try {
      // Dynamic import — only loaded on native platforms
      const mod = await import('@capacitor-community/speech-recognition')
      const SR = mod.SpeechRecognition
      const { available } = await SR.available()
      if (!available) {
        error.value = 'Speech recognition not available'
        isSupported.value = false
        return
      }

      const perm = await SR.requestPermissions()
      if (perm.speechRecognition !== 'granted') {
        error.value = 'Microphone permission denied'
        return
      }

      isListening.value = true
      SR.addListener('partialResults', (data: { matches: string[] }) => {
        if (data.matches.length) transcript.value = data.matches[0]!
      })

      await SR.start({
        language: 'en-US',
        partialResults: true,
        popup: false,
      })
    } catch (e) {
      error.value = `Speech error: ${e instanceof Error ? e.message : String(e)}`
      isListening.value = false
    }
  }

  function stop() {
    if (Capacitor.isNativePlatform()) {
      import('@capacitor-community/speech-recognition').then((mod) => {
        mod.SpeechRecognition.stop()
      })
    } else {
      recognition?.stop()
    }
    isListening.value = false
  }

  onUnmounted(() => {
    stop()
  })

  return { isSupported, isListening, transcript, error, start, stop }
}

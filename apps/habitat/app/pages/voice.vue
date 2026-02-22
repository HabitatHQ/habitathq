<script setup lang="ts">
interface VoiceNote {
  id: string
  blob: Blob
  mimeType: string
  duration: number   // seconds at stop time
  created_at: string
  url?: string       // revocable object URL, created on load
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const IDB_NAME = 'habitat'
const IDB_STORE = 'voice_notes'
let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => { _db = req.result; resolve(req.result) }
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAll(): Promise<Omit<VoiceNote, 'url'>[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(note: Omit<VoiceNote, 'url'>): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(note)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ─── Speech Recognition ───────────────────────────────────────────────────────

// SpeechRecognition types are not in all TypeScript DOM lib versions
interface SpeechRecognitionResult { readonly isFinal: boolean; readonly 0: { transcript: string } }
interface SpeechRecognitionResultList { readonly length: number; [i: number]: SpeechRecognitionResult | undefined }
interface SpeechRecognitionResultEvent extends Event { readonly resultIndex: number; readonly results: SpeechRecognitionResultList }
interface SpeechRecognitionErrorEvt extends Event { readonly error: string }
interface SpeechRecognizer extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: SpeechRecognitionErrorEvt) => void) | null
  start(): void
  stop(): void
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognizer
    webkitSpeechRecognition: new () => SpeechRecognizer
  }
}

const SpeechRecognitionAPI: (() => SpeechRecognizer) | null = import.meta.client
  ? (window.SpeechRecognition ? () => new window.SpeechRecognition() : window.webkitSpeechRecognition ? () => new window.webkitSpeechRecognition() : null)
  : null
const speechSupported = SpeechRecognitionAPI !== null

let recognition: SpeechRecognizer | null = null
const interimTranscript = ref('')
const finalTranscript = ref('')

function buildRecognition(onDone?: () => void): SpeechRecognizer {
  if (!SpeechRecognitionAPI) throw new Error('SpeechRecognition not supported')
  const r = SpeechRecognitionAPI()
  r.continuous = true
  r.interimResults = true
  r.lang = navigator.language || 'en-US'

  r.onresult = (event: SpeechRecognitionResultEvent) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (!result) continue
      if (result.isFinal) {
        finalTranscript.value += result[0].transcript
      } else {
        interim += result[0].transcript
      }
    }
    interimTranscript.value = interim
  }

  // Chrome stops recognition on silence — restart if still active
  r.onend = () => {
    interimTranscript.value = ''
    if (recognition === r) {
      if (recording.value) {
        try { r.start() } catch { /* already started */ }
      } else {
        recognition = null
        onDone?.()
      }
    }
  }

  r.onerror = (event: SpeechRecognitionErrorEvt) => {
    // 'no-speech' and 'aborted' are benign
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      errorMsg.value = `Speech recognition error: ${event.error}`
    }
  }

  return r
}

function startRecognition(onDone?: () => void): void {
  if (!SpeechRecognitionAPI) return
  finalTranscript.value = ''
  interimTranscript.value = ''
  recognition = buildRecognition(onDone)
  try { recognition.start() } catch { recognition = null }
}

function stopRecognitionCapture(): void {
  if (!recognition) return
  const r = recognition
  recognition = null   // cleared first so onend doesn't restart
  try { r.stop() } catch { /* ignore */ }
}

// ─── Transcript modal ─────────────────────────────────────────────────────────

const db = useDatabase()
const { settings: appSettings } = useAppSettings()

const showTranscriptModal = ref(false)
const transcriptTitle = ref('')
const transcriptText = ref('')
const savingTranscript = ref(false)
// When transcribing an existing note, track it for optional deletion
const transcribingNoteId = ref<string | null>(null)
const deleteAfterTranscribe = ref(false)

function openTranscriptModal(noteId: string | null = null) {
  transcriptTitle.value = `Voice note ${new Date().toISOString().slice(0, 10)}`
  transcriptText.value = finalTranscript.value
  transcribingNoteId.value = noteId
  deleteAfterTranscribe.value = false
  showTranscriptModal.value = true
}

function closeTranscriptModal() {
  showTranscriptModal.value = false
  finalTranscript.value = ''
  interimTranscript.value = ''
  transcribingNoteId.value = null
}

async function saveToScribbles() {
  if (!db.isAvailable) return
  savingTranscript.value = true
  try {
    await db.createScribble({
      title: transcriptTitle.value.trim() || 'Voice note',
      content: transcriptText.value,
      tags: ['habitat-transcribed'],
      annotations: {},
    })
    if (transcribingNoteId.value && deleteAfterTranscribe.value) {
      const note = notes.value.find(n => n.id === transcribingNoteId.value)
      if (note) await deleteNote(note)
    }
    closeTranscriptModal()
  } finally {
    savingTranscript.value = false
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

const notes = ref<VoiceNote[]>([])
const recording = ref(false)
const recordingSeconds = ref(0)
const errorMsg = ref<string | null>(null)
const currentlyPlaying = ref<string | null>(null)

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let recordingTimer: ReturnType<typeof setInterval> | null = null
const audioMap = new Map<string, HTMLAudioElement>()

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  const stored = await idbGetAll()
  stored.sort((a, b) => b.created_at.localeCompare(a.created_at))
  notes.value = stored.map(n => ({ ...n, url: URL.createObjectURL(n.blob) }))
})

onUnmounted(() => {
  stopRecording()
  stopRecognitionCapture()
  notes.value.forEach(n => { if (n.url) URL.revokeObjectURL(n.url) })
  audioMap.forEach(a => a.pause())
})

// ─── Format helpers ───────────────────────────────────────────────────────────

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay(d, today)) return `Today, ${time}`
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + `, ${time}`
}

// ─── Recording ────────────────────────────────────────────────────────────────

async function startRecording() {
  errorMsg.value = null
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    errorMsg.value = 'Microphone access denied. Please allow access in your browser settings.'
    return
  }

  chunks = []
  const mimeType = pickMimeType()
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop())
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
    const note: Omit<VoiceNote, 'url'> = {
      id: crypto.randomUUID(),
      blob,
      mimeType: mimeType || 'audio/webm',
      duration: recordingSeconds.value,
      created_at: new Date().toISOString(),
    }
    await idbPut(note)
    notes.value.unshift({ ...note, url: URL.createObjectURL(blob) })
    recordingSeconds.value = 0

    // Show transcript modal if we captured speech and setting allows it
    if (appSettings.value.saveTranscribedNotes && finalTranscript.value.trim()) {
      openTranscriptModal(note.id)
    } else {
      finalTranscript.value = ''
    }
  }
  mediaRecorder.start(100)
  recording.value = true
  recordingTimer = setInterval(() => { recordingSeconds.value++ }, 1000)

  // Start speech recognition alongside recording
  if (speechSupported) startRecognition()
}

function stopRecording() {
  stopRecognitionCapture()
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  recording.value = false
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null }
}

function toggleRecording() {
  recording.value ? stopRecording() : startRecording()
}

// ─── Playback ─────────────────────────────────────────────────────────────────

function togglePlay(note: VoiceNote) {
  if (!note.url) return
  if (currentlyPlaying.value && currentlyPlaying.value !== note.id) {
    audioMap.get(currentlyPlaying.value)?.pause()
    currentlyPlaying.value = null
  }
  let audio = audioMap.get(note.id)
  if (!audio) {
    audio = new Audio(note.url)
    audio.onended = () => { currentlyPlaying.value = null }
    audioMap.set(note.id, audio)
  }
  if (currentlyPlaying.value === note.id) {
    audio.pause()
    currentlyPlaying.value = null
  } else {
    audio.play()
    currentlyPlaying.value = note.id
  }
}

// ─── Transcribe existing note ─────────────────────────────────────────────────

const transcribingExistingId = ref<string | null>(null)

async function transcribeNote(note: VoiceNote) {
  if (!speechSupported || !note.url) return
  if (transcribingExistingId.value) return  // already transcribing one

  // Stop any current playback
  if (currentlyPlaying.value) {
    audioMap.get(currentlyPlaying.value)?.pause()
    currentlyPlaying.value = null
  }

  transcribingExistingId.value = note.id
  errorMsg.value = null

  finalTranscript.value = ''
  interimTranscript.value = ''

  const audio = new Audio(note.url)
  audioMap.set(note.id, audio)

  // When audio finishes, stop recognition and show modal
  audio.onended = () => {
    stopRecognitionCapture()
    currentlyPlaying.value = null
    transcribingExistingId.value = null
    if (appSettings.value.saveTranscribedNotes && finalTranscript.value.trim()) {
      openTranscriptModal(note.id)
    } else if (finalTranscript.value.trim()) {
      // setting is off but we still show for this note since user explicitly asked
      openTranscriptModal(note.id)
    } else {
      errorMsg.value = 'No speech detected in this recording.'
      finalTranscript.value = ''
    }
  }

  // Start recognition then play
  startRecognition()
  audio.play()
  currentlyPlaying.value = note.id
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteNote(note: VoiceNote) {
  const audio = audioMap.get(note.id)
  if (audio) { audio.pause(); audioMap.delete(note.id) }
  if (currentlyPlaying.value === note.id) currentlyPlaying.value = null
  if (transcribingExistingId.value === note.id) {
    stopRecognitionCapture()
    transcribingExistingId.value = null
  }
  if (note.url) URL.revokeObjectURL(note.url)
  await idbDelete(note.id)
  notes.value = notes.value.filter(n => n.id !== note.id)
}
</script>

<template>
  <div class="space-y-5">
    <header>
      <p class="text-sm text-slate-500">Voice Notes</p>
      <h2 class="text-2xl font-bold">Record</h2>
    </header>

    <!-- Error -->
    <UAlert
      v-if="errorMsg"
      :title="errorMsg"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-circle"
      :close-button="{ icon: 'i-heroicons-x-mark', color: 'error', variant: 'ghost', size: 'sm' }"
      @close="errorMsg = null"
    />

    <!-- Record button -->
    <div class="flex flex-col items-center gap-3 py-8">
      <button
        class="w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        :class="recording
          ? 'bg-red-500 shadow-xl shadow-red-500/30 scale-105'
          : 'bg-slate-800 hover:bg-slate-700'"
        :aria-label="recording ? 'Stop recording' : 'Start recording'"
        @click="toggleRecording"
      >
        <UIcon
          :name="recording ? 'i-heroicons-stop' : 'i-heroicons-microphone'"
          class="w-10 h-10"
          :class="recording ? 'text-white' : 'text-slate-300'"
        />
      </button>

      <p v-if="recording" class="text-red-400 text-sm font-mono tabular-nums animate-pulse">
        ● {{ fmtDuration(recordingSeconds) }}
      </p>
      <p v-else class="text-xs text-slate-500">Tap to record</p>

      <!-- Live transcript preview during recording -->
      <div
        v-if="recording && speechSupported && (finalTranscript || interimTranscript)"
        class="w-full max-w-sm bg-slate-800/60 rounded-2xl px-4 py-3 text-sm text-slate-300 min-h-[3rem]"
      >
        <span>{{ finalTranscript }}</span>
        <span class="text-slate-500 italic">{{ interimTranscript }}</span>
      </div>
    </div>

    <!-- Empty state -->
    <section v-if="notes.length === 0 && !recording" class="flex flex-col items-center gap-2 py-6 text-center">
      <UIcon name="i-heroicons-microphone" class="w-8 h-8 text-slate-700" />
      <p class="text-sm text-slate-500">No recordings yet. Tap the button above to start.</p>
    </section>

    <!-- Notes list -->
    <div v-else-if="notes.length > 0" class="space-y-2">
      <UCard
        v-for="note in notes"
        :key="note.id"
        :ui="{ root: 'rounded-2xl', body: 'px-4 py-3 sm:px-4 sm:py-3' }"
      >
        <div class="flex items-center gap-3">
          <!-- Play / pause -->
          <UButton
            :icon="currentlyPlaying === note.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
            :color="currentlyPlaying === note.id ? 'primary' : 'neutral'"
            :variant="currentlyPlaying === note.id ? 'soft' : 'outline'"
            size="sm"
            :ui="{ base: 'rounded-full' }"
            :disabled="transcribingExistingId === note.id"
            @click="transcribingExistingId === note.id ? undefined : togglePlay(note)"
          />

          <!-- Meta -->
          <div class="flex-1 min-w-0">
            <p class="text-sm text-slate-300 truncate">{{ fmtDate(note.created_at) }}</p>
            <p class="text-xs tabular-nums" :class="transcribingExistingId === note.id ? 'text-primary-400 animate-pulse' : 'text-slate-500'">
              {{ transcribingExistingId === note.id ? 'Transcribing…' : fmtDuration(note.duration) }}
            </p>
          </div>

          <!-- Transcribe -->
          <UButton
            v-if="speechSupported"
            icon="i-heroicons-language"
            color="neutral"
            variant="ghost"
            size="sm"
            class="text-slate-600 hover:text-primary-400"
            :loading="transcribingExistingId === note.id"
            :disabled="!!transcribingExistingId && transcribingExistingId !== note.id"
            @click="transcribeNote(note)"
          />

          <!-- Delete -->
          <UButton
            icon="i-heroicons-trash"
            color="neutral"
            variant="ghost"
            size="sm"
            class="text-slate-600 hover:text-red-400"
            :disabled="transcribingExistingId === note.id"
            @click="deleteNote(note)"
          />
        </div>
      </UCard>
    </div>

    <!-- ── Transcript modal ────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showTranscriptModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeTranscriptModal" />
        <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">

          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">Save transcription</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="closeTranscriptModal" />
          </div>

          <!-- Title -->
          <div class="space-y-1">
            <label class="text-xs text-slate-500 font-medium">Title</label>
            <input
              v-model="transcriptTitle"
              type="text"
              class="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <!-- Transcript -->
          <div class="space-y-1">
            <label class="text-xs text-slate-500 font-medium">Transcript</label>
            <textarea
              v-model="transcriptText"
              rows="5"
              class="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
            />
          </div>

          <!-- Delete voice note option (only for existing notes) -->
          <label v-if="transcribingNoteId" class="flex items-center gap-2 cursor-pointer">
            <input v-model="deleteAfterTranscribe" type="checkbox" class="rounded border-slate-600 bg-slate-800 text-primary-500 focus:ring-primary-500" />
            <span class="text-sm text-slate-400">Delete voice recording after saving</span>
          </label>

          <div class="flex gap-2">
            <UButton
              class="flex-1"
              color="primary"
              :loading="savingTranscript"
              @click="saveToScribbles"
            >
              Save to Scribbles
            </UButton>
            <UButton
              variant="outline"
              color="neutral"
              @click="closeTranscriptModal"
            >
              Discard
            </UButton>
          </div>

        </div>
      </div>
    </Teleport>
  </div>
</template>

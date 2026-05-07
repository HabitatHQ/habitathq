import { ref } from 'vue'
import { type ParsedReceipt, parseReceipt } from '~/lib/ocr/receipt-parser'

export function useOcr() {
  const isProcessing = ref(false)
  const progress = ref(0)
  const result = ref<ParsedReceipt | null>(null)
  const error = ref<string | null>(null)

  async function recognize(imageBase64: string): Promise<ParsedReceipt | null> {
    isProcessing.value = true
    progress.value = 0
    error.value = null
    result.value = null

    try {
      const Tesseract = await import('tesseract.js')
      const baseURL = useRuntimeConfig().app.baseURL
      const worker = await Tesseract.createWorker('eng', undefined, {
        // Load language data from the bundled file in /public/tessdata so OCR
        // works offline (PWA + native). Fetched at build time by
        // scripts/fetch-offline-assets.mjs.
        langPath: `${baseURL}tessdata`,
        logger: (m: { progress?: number }) => {
          if (m.progress != null) {
            progress.value = Math.round(m.progress * 100)
          }
        },
      })

      const { data } = await worker.recognize(`data:image/jpeg;base64,${imageBase64}`)
      await worker.terminate()

      const parsed = parseReceipt(data.text)
      result.value = parsed
      return parsed
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'OCR failed'
      return null
    } finally {
      isProcessing.value = false
    }
  }

  return { recognize, isProcessing, progress, result, error }
}

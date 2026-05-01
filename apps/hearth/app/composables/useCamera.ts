import { Capacitor } from '@capacitor/core'
import { ref } from 'vue'

export function useCamera() {
  const isNative = Capacitor.isNativePlatform()
  const imageData = ref<string | null>(null) // base64
  const error = ref<string | null>(null)

  async function capturePhoto(): Promise<string | null> {
    error.value = null
    imageData.value = null

    if (isNative) {
      return captureNative()
    }
    return captureWeb()
  }

  async function captureNative(): Promise<string | null> {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await Camera.getPhoto({
        quality: 80,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        correctOrientation: true,
      })
      imageData.value = photo.base64String ?? null
      return imageData.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Camera error'
      return null
    }
  }

  function captureWeb(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.capture = 'environment'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // Strip data URL prefix to get base64
          const base64 = result.includes(',') ? result.split(',')[1]! : result
          imageData.value = base64
          resolve(base64)
        }
        reader.onerror = () => {
          error.value = 'Failed to read image'
          resolve(null)
        }
        reader.readAsDataURL(file)
      }
      input.click()
    })
  }

  return { capturePhoto, imageData, error, isNative }
}

import { Capacitor } from '@capacitor/core'
import { getBlobAdapter } from '~/composables/useJotsStore'
import type { Scribble } from '~/types/database'
import { getShareTag, isShareTag } from '~/utils/share-helpers'

export interface SharedItem {
  type: 'url' | 'text' | 'image'
  url?: string | undefined
  text?: string | undefined
  title?: string | undefined
  path?: string | undefined
  filename?: string | undefined
}

export type ShareSource = 'native-ios' | 'native-android' | 'pwa'

export function useShareIngest() {
  const db = useDatabase()
  const { settings, set } = useAppSettings()
  const { isNative } = usePlatform()
  const { notification: hapticNotification } = useHaptics()

  function ensureJotsEnabled() {
    if (!settings.value.enableJournalling) {
      set('enableJournalling', true)
    }
  }

  async function ingestItem(item: SharedItem): Promise<Scribble | null> {
    ensureJotsEnabled()

    if (item.type === 'url') {
      return ingestUrl(item)
    }
    if (item.type === 'text') {
      return ingestText(item)
    }
    if (item.type === 'image') {
      await ingestImage(item)
      return null
    }
    return null
  }

  async function ingestUrl(item: SharedItem): Promise<Scribble> {
    const title = item.title || item.url || 'Shared URL'
    const content = item.url || ''
    return db.createScribble({
      title,
      content,
      tags: [getShareTag('url')],
      annotations: { source_url: item.url || '' },
    })
  }

  async function ingestText(item: SharedItem): Promise<Scribble> {
    return db.createScribble({
      title: item.title ?? '',
      content: item.text ?? '',
      tags: [getShareTag('text')],
      annotations: {},
    })
  }

  async function ingestImage(item: SharedItem): Promise<void> {
    if (!item.path) return
    const id = crypto.randomUUID()
    const filename = item.filename || `shared-image-${id}.png`

    try {
      const response = await fetch(
        item.path.startsWith('file://') ? item.path : `file://${item.path}`,
      )
      const blob = await response.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      await getBlobAdapter().put(id, bytes)
      await db.createImageNote({
        id,
        mime_type: blob.type || 'image/png',
        filename,
        created_at: new Date().toISOString(),
      })
    } catch {
      // If file:// fetch fails (common in web context), try as a data URL
      // Native platforms should work fine with file paths
    }
  }

  async function ingestAll(items: SharedItem[]): Promise<void> {
    for (const item of items) {
      await ingestItem(item)
    }
    await hapticNotification('success')
  }

  async function checkPendingShares(): Promise<void> {
    if (!import.meta.client) return

    // PWA shares land at /_share via the manifest share_target — nothing to poll.
    // Android shares are routed by MainActivity directly to /_share — nothing to poll.
    // iOS share-extension drops items in the App Group UserDefaults, mirrored to
    // Capacitor Preferences under "share-target-data" — drain that here.
    if (!isNative.value) return
    if (!Capacitor.isNativePlatform()) return

    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: 'share-target-data' })
    if (!value) return

    const parsed = JSON.parse(value) as Array<Record<string, string | undefined>>
    const items: SharedItem[] = parsed.map((i) => ({
      type: (i['type'] as SharedItem['type']) || 'text',
      url: i['url'],
      text: i['text'],
      title: i['title'],
      path: i['path'],
      filename: i['filename'],
    }))
    if (items.length > 0) {
      await ingestAll(items)
      await Preferences.remove({ key: 'share-target-data' })
    }
  }

  async function ingestFromPwaParams(params: {
    title?: string
    text?: string
    url?: string
  }): Promise<void> {
    const items: SharedItem[] = []

    if (params.url) {
      items.push({
        type: 'url',
        url: params.url,
        title: params.title || '',
      })
    } else if (params.text) {
      // Check if text contains a URL
      const urlMatch = params.text.match(/https?:\/\/[^\s]+/)
      if (urlMatch) {
        items.push({
          type: 'url',
          url: urlMatch[0],
          title: params.title || params.text.replace(urlMatch[0], '').trim() || '',
        })
      } else {
        items.push({
          type: 'text',
          text: params.text,
          title: params.title || '',
        })
      }
    }

    if (items.length > 0) {
      await ingestAll(items)
    }
  }

  return {
    ingestItem,
    ingestAll,
    ingestFromPwaParams,
    checkPendingShares,
    ensureJotsEnabled,
    getShareTag,
    isShareTag,
  }
}

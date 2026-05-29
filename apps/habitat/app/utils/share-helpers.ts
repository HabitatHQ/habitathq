const SHARE_TAG_PREFIX = 'shared'

export function getShareTag(type: 'url' | 'text' | 'image'): string {
  const map = {
    url: `${SHARE_TAG_PREFIX}/url`,
    text: `${SHARE_TAG_PREFIX}/clipping`,
    image: `${SHARE_TAG_PREFIX}/image`,
  }
  return map[type]
}

export function isShareTag(tag: string): boolean {
  return tag.startsWith(`${SHARE_TAG_PREFIX}/`)
}

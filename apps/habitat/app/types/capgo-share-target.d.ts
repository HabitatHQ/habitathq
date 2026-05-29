declare module '@capgo/capacitor-share-target' {
  interface ShareTargetItem {
    type?: string
    url?: string
    text?: string
    title?: string
    uri?: string
    path?: string
    name?: string
    filename?: string
  }

  interface ShareTargetData {
    items: ShareTargetItem[]
  }

  interface CapacitorShareTargetPlugin {
    getShareData(): Promise<ShareTargetData | null>
    clearShareData(): Promise<void>
  }

  export const CapacitorShareTarget: CapacitorShareTargetPlugin
}

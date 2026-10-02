const NATIVE_UNAVAILABLE = 'Native database operations are unavailable; Hephaestus is PWA-only.'

export async function initNativeDb(): Promise<never> {
  throw new Error(NATIVE_UNAVAILABLE)
}

export async function dispatchNative(_request: unknown): Promise<never> {
  throw new Error(NATIVE_UNAVAILABLE)
}

const VAULT_KEY = 'halcyon-active-vault'

const _activeVaultId = ref<string | null>(null)

export function useVault() {
  // Load from localStorage on first use
  if (_activeVaultId.value === null && typeof window !== 'undefined') {
    _activeVaultId.value = localStorage.getItem(VAULT_KEY)
  }

  function setActiveVaultId(id: string) {
    _activeVaultId.value = id
    if (typeof window !== 'undefined') {
      localStorage.setItem(VAULT_KEY, id)
    }
  }

  return {
    activeVaultId: readonly(_activeVaultId),
    setActiveVaultId,
  }
}

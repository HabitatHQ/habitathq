const KEY = 'habitat-easter-eggs'

export function useEasterEggs() {
  const found = useState<string[]>('easter-eggs', () =>
    import.meta.client ? JSON.parse(localStorage.getItem(KEY) ?? '[]') : [],
  )

  function isFound(id: string) {
    return found.value.includes(id)
  }

  function discover(id: string) {
    if (isFound(id)) return
    found.value = [...found.value, id]
    if (import.meta.client) localStorage.setItem(KEY, JSON.stringify(found.value))
  }

  return { isFound, discover }
}

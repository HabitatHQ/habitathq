/** The canonical key used to compare habit and check-in names. */
export function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Returns a trimmed name, suffixing duplicates as "Name (2)", "Name (3)", and so on. */
export function nextAvailableName(name: string, usedNames: Set<string>): string {
  const baseName = name.trim()
  let candidate = baseName
  let suffix = 2

  while (usedNames.has(normalizeNameKey(candidate))) {
    candidate = `${baseName} (${suffix})`
    suffix += 1
  }

  usedNames.add(normalizeNameKey(candidate))
  return candidate
}

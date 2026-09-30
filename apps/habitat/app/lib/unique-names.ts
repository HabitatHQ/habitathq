function normalizedName(name: string): string {
  return name.trim().toLowerCase()
}

/** Returns a trimmed name, suffixing duplicates as "Name (2)", "Name (3)", and so on. */
export function nextAvailableName(name: string, usedNames: Set<string>): string {
  const baseName = name.trim()
  let candidate = baseName
  let suffix = 2

  while (usedNames.has(normalizedName(candidate))) {
    candidate = `${baseName} (${suffix})`
    suffix += 1
  }

  usedNames.add(normalizedName(candidate))
  return candidate
}

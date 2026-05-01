import type { Contact, OccupationWithCompany } from '~/types/database'

export function occupationLabel(occ: OccupationWithCompany): string {
  const title = occ.title?.trim()
  const company = occ.company?.name?.trim()
  if (title && company) return `${title} at ${company}`
  if (title) return title
  if (company) return company
  return 'Unknown role'
}

export function formatOccupation(occ: OccupationWithCompany): string {
  const parts: string[] = [occupationLabel(occ)]
  if (occ.department) parts.push(occ.department)
  const start = occ.started_at?.slice(0, 4)
  const end = occ.ended_at?.slice(0, 4)
  if (start && end && !occ.is_current) parts.push(`${start} – ${end}`)
  else if (start && occ.is_current) parts.push(`${start} – present`)
  else if (start) parts.push(start)
  return parts.join(' · ')
}

export function normalizeWebsite(url: string): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `https://${url}`
}

export function companyEmployeeCount(contacts: Contact[]): number {
  return contacts.length
}

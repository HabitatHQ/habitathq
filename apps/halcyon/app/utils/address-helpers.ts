import type { Address } from '~/types/database'

const COUNTRY_CODES: Record<string, string> = {
  US: 'United States',
  USA: 'United States',
  UK: 'United Kingdom',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  JP: 'Japan',
  CN: 'China',
  IN: 'India',
  BR: 'Brazil',
  MX: 'Mexico',
  NZ: 'New Zealand',
}

export function isAddressEmpty(address: Address): boolean {
  return (
    !address.street &&
    !address.city &&
    !address.province &&
    !address.postal_code &&
    !address.country
  )
}

export function formatAddress(address: Address): string {
  const parts = [
    address.street,
    [address.city, address.province].filter(Boolean).join(', '),
    address.postal_code,
    address.country,
  ].filter(Boolean)
  return parts.join('\n')
}

export function addressOneLiner(address: Address): string {
  if (isAddressEmpty(address)) return ''
  if (address.city && address.country) return `${address.city}, ${address.country}`
  if (address.city) return address.city
  if (address.country && address.street) return `${address.street}, ${address.country}`
  if (address.country) return address.country
  if (address.street) return address.street
  return ''
}

export function normalizeCountry(country: string): string {
  if (!country) return ''
  return COUNTRY_CODES[country.toUpperCase()] ?? country
}

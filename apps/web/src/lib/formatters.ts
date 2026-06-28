// Auto-formatters applied onBlur to normalize user input consistently.
// Never apply to: passwords, notes/descriptions, search boxes, dropdowns.

const MALAY_CONNECTORS = new Set(['bin', 'binti', 'bt', 'bte', 'al', 'ap', 'a/l', 'a/p'])

export function formatName(value: string): string {
  if (!value) return value
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, i) => {
      const clean = word.replace(/[^a-z0-9'/@]/gi, w => w) // keep special chars
      if (i > 0 && MALAY_CONNECTORS.has(clean.toLowerCase())) return clean.toLowerCase()
      return clean.charAt(0).toUpperCase() + clean.slice(1)
    })
    .join(' ')
}

export function formatTitleCase(value: string): string {
  if (!value) return value
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function formatPlate(value: string): string {
  if (!value) return value
  // Remove all spaces, uppercase everything, then re-insert space before digits
  const raw = value.trim().toUpperCase().replace(/\s+/g, '')
  // Malaysian plate: letters + digits e.g. WXB1234, B1234C, WA1234B
  const match = raw.match(/^([A-Z]+)(\d+)([A-Z]*)$/)
  if (match) return `${match[1]} ${match[2]}${match[3]}`.trim()
  return raw
}

export function formatIC(value: string): string {
  if (!value) return value
  // Strip non-digits, format as YYMMDD-PP-NNNN
  const digits = value.replace(/\D/g, '')
  if (digits.length === 12) {
    return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`
  }
  return value.trim()
}

export function formatEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function formatSKU(value: string): string {
  // Part codes / SKUs: uppercase, preserve hyphens and slashes
  return value.trim().toUpperCase().replace(/\s+/g, '-')
}

export function formatPhone(value: string): string {
  // Normalize Malaysian phone: strip spaces/dashes, keep leading +
  if (!value) return value
  const stripped = value.trim().replace(/[\s\-().]/g, '')
  return stripped
}

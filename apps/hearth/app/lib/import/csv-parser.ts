/** Detect the delimiter used in a CSV string by counting occurrences in first 5 lines */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const lines = text.split(/\r?\n/).slice(0, 5)
  const sample = lines.join('\n')
  const counts = {
    ',': (sample.match(/,/g) ?? []).length,
    ';': (sample.match(/;/g) ?? []).length,
    '\t': (sample.match(/\t/g) ?? []).length,
  }
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t'
  if (counts[';'] > counts[',']) return ';'
  return ','
}

/** Parse CSV text into headers + rows. Handles quoted fields, escaped quotes, BOM, CRLF. */
export function parseCSV(
  text: string,
  delimiter?: ',' | ';' | '\t',
): { headers: string[]; rows: string[][] } {
  // Strip BOM
  let input = text.startsWith('\uFEFF') ? text.slice(1) : text
  // Normalize line endings
  input = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const delim = delimiter ?? detectDelimiter(input)
  const lines = parseLine(input, delim)

  if (lines.length === 0) return { headers: [], rows: [] }

  return {
    headers: lines[0]!,
    rows: lines.slice(1).filter((row) => row.some((cell) => cell.length > 0)),
  }
}

/** Parse all lines respecting quoted fields */
function parseLine(text: string, delim: string): string[][] {
  const result: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      result.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }

  // Push last field and row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    result.push(row)
  }

  return result
}

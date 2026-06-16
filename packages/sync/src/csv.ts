// Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). Returns
// header row + object rows keyed by header. No dependency.

export type CsvParsed = { headers: string[]; rows: Record<string, string>[] }

export function parseCsv(text: string, delimiter = ','): CsvParsed {
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    records.push(row)
    row = []
  }
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      pushField()
    } else if (c === '\n') {
      pushRow()
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) pushRow()

  const nonEmpty = records.filter(
    (r) => r.length > 1 || (r.length === 1 && (r[0] ?? '').trim() !== ''),
  )
  const headerRow = nonEmpty[0]
  if (!headerRow) return { headers: [], rows: [] }
  const headers = headerRow.map((h) => h.trim())
  const rows = nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim()
    })
    return obj
  })
  return { headers, rows }
}

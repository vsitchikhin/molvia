// A bank's CSV export as text and records (MOL-430): the reading every parser of a CSV statement shares —
// T-Bank's now, Ameria's next (MOL-432). It knows nothing of a bank: the columns are the parser's.

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const CP1251 = new TextDecoder('windows-1251')

/**
 * The file's text: UTF-8 where it is valid UTF-8, its byte order mark dropped — T-Bank's export since 2026 —
 * else Windows-1251, the export before it (b-russia.md, 1.2). Every byte is a letter of 1251, so a binary
 * file decodes to nonsense, and the parser refuses it by its header.
 */
export function decodeStatementText(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    return CP1251.decode(bytes)
  }
}

/**
 * The records of a CSV text by RFC 4180, with the bank's separator: a field in quotes may hold the
 * separator, a line break and a quote doubled; a quote inside a field not opened by one is a letter.
 * A record of one empty field — a blank line — is no record. `null` where a quote is never closed: the
 * rest of the file would be one field, and nothing read from it could be trusted.
 */
export function readCsvRecords(text: string, separator: string): string[][] | null {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let at = 0
  const endRecord = () => {
    record.push(field)
    if (record.length > 1 || record[0] !== '') records.push(record)
    record = []
    field = ''
  }
  while (at < text.length) {
    const char = text.charAt(at)
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          field += '"'
          at += 2
          continue
        }
        quoted = false
      } else field += char
      at += 1
      continue
    }
    if (char === '"' && field === '') quoted = true
    else if (char === separator) {
      record.push(field)
      field = ''
    } else if (char === '\r' && text[at + 1] === '\n') {
      endRecord()
      at += 1
    } else if (char === '\n' || char === '\r') endRecord()
    else field += char
    at += 1
  }
  if (quoted) return null
  if (field !== '' || record.length > 0) endRecord()
  return records
}

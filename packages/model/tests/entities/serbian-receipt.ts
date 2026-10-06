// Serbian receipts made up for tests (MOL-232): the repository is public, so no link of a real
// purchase and no journal of a real person goes into it — a link is built here, its MD5 counted, and
// a journal's item rows sit under a head that names nobody.
import { md5Hex } from '#model/support/md5'

export interface MadeUpLink {
  /** The signed total in dinars' hundredths. */
  readonly totalHundredths: number
  /** The total as `vl` keeps it, in ten-thousandths, where a test needs what hundredths cannot say. */
  readonly totalTenThousandths?: bigint
  /** The size of `vl` decoded, its MD5 included: 572 is a receipt's least. */
  readonly bytes?: number
  readonly at: Date
  readonly requestedBy?: string
  readonly signedBy?: string
  readonly counter?: number
  /** 0 normal, 1 pro forma, 2 copy, 3 training, 4 advance. */
  readonly invoiceType?: number
  /** 0 sale, 1 refund. */
  readonly transactionType?: number
  /** A buyer's tax id, as a receipt made out to a firm carries it. */
  readonly buyer?: string
}

/** A link of the tax office's check, its `vl` laid out as TAP's and signed by its MD5. */
export function madeUpSerbianLink(receipt: MadeUpLink): string {
  const data = new Uint8Array((receipt.bytes ?? 572) - 16)
  const view = new DataView(data.buffer)
  data[0] = 3
  data.set(ascii(receipt.requestedBy ?? 'TESTAAAA'), 1)
  data.set(ascii(receipt.signedBy ?? 'TESTBBBB'), 9)
  view.setUint32(17, receipt.counter ?? 1, true)
  view.setUint32(21, receipt.counter ?? 1, true)
  view.setBigUint64(25, receipt.totalTenThousandths ?? BigInt(receipt.totalHundredths) * 100n, true)
  view.setBigUint64(33, BigInt(receipt.at.getTime()), false)
  data[41] = receipt.invoiceType ?? 0
  data[42] = receipt.transactionType ?? 0
  const buyer = ascii(receipt.buyer ?? '')
  data[43] = buyer.length
  data.set(buyer, 44)
  for (let i = 44 + buyer.length; i < data.length; i++) data[i] = (i * 31) & 255
  const digest = md5Hex(data)
  const bytes = new Uint8Array(data.length + 16)
  bytes.set(data)
  for (let i = 0; i < 16; i++) bytes[data.length + i] = parseInt(digest.slice(i * 2, i * 2 + 2), 16)
  const vl = btoa(String.fromCharCode(...bytes))
  return `https://suf.purs.gov.rs/v/?vl=${encodeURIComponent(vl)}`
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

export interface MadeUpLine {
  /** The name as the till sends it, with its tax label: «SECER KRISTAL 1KG SUNOKO KOM (Е)». */
  readonly name: string
  readonly price: string
  readonly quantity: string
  readonly sum: string
}

/**
 * A journal as the tax office renders one — forty columns, the name wrapped where it runs past them —
 * under a made-up head: «Тест продавац», a cashier and a buyer nobody is.
 */
export function madeUpJournal(lines: readonly MadeUpLine[], total: string): string {
  const width = 40
  const right = (left: string, value: string): string =>
    left + value.padStart(Math.max(1, width - left.length))
  const rows = [
    '============ ФИСКАЛНИ РАЧУН ============',
    '               100000009                ',
    '           Тест продавац доо            ',
    '        1000001-ТЕСТ ПРОДАВНИЦА 1       ',
    '            ТЕСТНА УЛИЦА 1              ',
    '             Београд-Земун              ',
    right('Касир:', 'Тест Тестовић'),
    right('ИД купца:', '10:100000009'),
    '-------------ПРОМЕТ ПРОДАЈА-------------',
    'Артикли',
    '========================================',
    'Назив   Цена         Кол.         Укупно',
  ]
  for (const line of lines) {
    for (let at = 0; at < line.name.length; at += width) rows.push(line.name.slice(at, at + width))
    rows.push(`${line.price.padStart(13)}${line.quantity.padStart(11)}${line.sum.padStart(16)}`)
  }
  rows.push('----------------------------------------', right('Укупан износ:', total))
  rows.push(right('Готовина:', total), '========================================')
  rows.push('ПФР време:           18.07.2025. 8:56:53')
  rows.push('======== КРАЈ ФИСКАЛНОГ РАЧУНА =========')
  return rows.join('\r\n')
}

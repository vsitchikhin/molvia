import { z } from 'zod'
import { md5Hex } from '#model/support/md5'
import { MINOR_EXPONENT } from '#model/values/money'
import type { Money } from '#model/values/money'

// MOL-232 — a Serbian fiscal receipt by the link of its QR code. The link is the tax office's check
// of the receipt, `https://suf.purs.gov.rs/v/?vl=…`, and `vl` is the receipt's own signed summary:
// its total, its moment and its number are read here with no network; the seller and the lines
// come from the tax office (MOL-223). Its layout is TAP's «Create Verification URL», as the open
// parsers read it (turanjanin/serbian-fiscal-receipts-parser); it also carries the buyer's tax id
// when a receipt is made out to a firm — never returned from here.

/** The one host a Serbian receipt's link may point at: the tax office's check. */
export const SERBIAN_RECEIPT_HOST = 'suf.purs.gov.rs'

/** What `vl` may weigh, decoded: its fields, the buyer's id (up to 20 bytes) and the signature. */
const VL_BYTES_MIN = 572
const VL_BYTES_MAX = 848

/**
 * Why a text is no receipt to record: `not_link` — no link of the tax office in it; `damaged` — the
 * link is cut or changed, its MD5 does not hold; `not_sale` — a pro forma, a copy, a training or an
 * advance receipt, none of them a purchase (a copy is the same purchase twice); `refund` — a refund,
 * which there is nothing to record as.
 */
export const receiptLinkRefusalSchema = z.enum(['not_link', 'damaged', 'not_sale', 'refund'])
export type ReceiptLinkRefusal = z.infer<typeof receiptLinkRefusalSchema>

export interface SerbianReceiptLink {
  /** The link as the tax office takes it: https, its host and path, `vl` as it came. */
  readonly link: string
  /** The total the receipt was signed with, in dinars' minor units. */
  readonly total: Money
  /** The moment the tax office's signing unit stamped it. */
  readonly at: Date
  /** The receipt's number as the tax office prints it, «X89FX3FD-C38FDVO0-32340». */
  readonly number: string
}

export type SerbianReceiptLinkResult =
  | ({ readonly ok: true } & SerbianReceiptLink)
  | { readonly ok: false; readonly reason: ReceiptLinkRefusal }

// a link anywhere in what was pasted: people copy the address bar with a word or a line around it
const LINK = /https?:\/\/suf\.purs\.gov\.rs\/v\/?\?(?:[^\s#]*&)?vl=([A-Za-z0-9+/=%_-]+)/iu

const INVOICE_NORMAL = 0
const TRANSACTION_SALE = 0
const TRANSACTION_REFUND = 1

/** A Serbian receipt's link read from `text`, or why it is none (MOL-232). Pure, no network. */
export function serbianReceiptLink(text: string): SerbianReceiptLinkResult {
  const found = LINK.exec(text)
  if (found === null) return { ok: false, reason: 'not_link' }
  let raw: string
  try {
    raw = decodeURIComponent(found[1] ?? '')
  } catch {
    return { ok: false, reason: 'damaged' }
  }
  const bytes = base64Bytes(raw)
  if (bytes === null || bytes.length < VL_BYTES_MIN || bytes.length > VL_BYTES_MAX) {
    return { ok: false, reason: 'damaged' }
  }
  const signed = bytes.subarray(0, bytes.length - 16)
  const digest = Array.from(bytes.subarray(bytes.length - 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (md5Hex(signed) !== digest) return { ok: false, reason: 'damaged' }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint8(42) === TRANSACTION_REFUND) return { ok: false, reason: 'refund' }
  if (view.getUint8(41) !== INVOICE_NORMAL || view.getUint8(42) !== TRANSACTION_SALE) {
    return { ok: false, reason: 'not_sale' }
  }
  const at = new Date(Number(view.getBigUint64(33, false)))
  const total = dinarsOfTenThousandths(view.getBigUint64(25, true))
  const requestedBy = latin(bytes.subarray(1, 9))
  const signedBy = latin(bytes.subarray(9, 17))
  if (Number.isNaN(at.getTime()) || requestedBy === null || signedBy === null) {
    return { ok: false, reason: 'damaged' }
  }
  return {
    ok: true,
    // re-encoded, so the link sent on is the one checked, whatever escaping the paste carried
    link: `https://${SERBIAN_RECEIPT_HOST}/v/?vl=${encodeURIComponent(raw)}`,
    total,
    at,
    number: `${requestedBy}-${signedBy}-${String(view.getUint32(17, true))}`,
  }
}

/** The signed total, kept in ten-thousandths of a dinar, in the currency's minor units, half up. */
function dinarsOfTenThousandths(amount: bigint): Money {
  const scale = 10n ** BigInt(4 - MINOR_EXPONENT.RSD)
  return { minor: (amount + scale / 2n) / scale, currency: 'RSD' }
}

/** The ids of the requesting and the signing unit: eight letters and digits. */
function latin(bytes: Uint8Array): string | null {
  const text = String.fromCharCode(...bytes)
  return /^[A-Z0-9]{8}$/u.test(text) ? text : null
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64 with its padding, or null for anything else. */
function base64Bytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(text)) return null
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (sextet(text, i) << 18) |
      (sextet(text, i + 1) << 12) |
      (sextet(text, i + 2) << 6) |
      sextet(text, i + 3)
    for (const shift of [16, 8, 0]) if (o < out.length) out[o++] = (n >> shift) & 255
  }
  return out
}

// the padding counts as zero bits: they fall in the bytes the padding says are not there
const sextet = (text: string, at: number): number => Math.max(0, BASE64.indexOf(text.charAt(at)))

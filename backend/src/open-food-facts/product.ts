import {
  ITEM_NAME_MAX,
  LOCALES,
  itemSchema,
  pastedLine,
  quantitySchema,
  scaledFromDecimal,
  toSearchKey,
} from '@molvia/model'
import type { AppLocale, BaseUnit, Quantity } from '@molvia/model'

/** What Open Food Facts gave for a code, as much of it as a hint uses (MOL-162). */
export interface OffProduct {
  /** A name for each language of the interface, picked and cleaned (`namesOf`). */
  readonly names: Readonly<Record<AppLocale, string>>
  /** The size of the package as a weight or a volume; `null` for pieces, ounces or nothing. */
  readonly quantity: Quantity | null
}

/** `found: false` — the base does not know the code, or knows it with no name worth showing. */
export type OffAnswer =
  { readonly found: true; readonly product: OffProduct } | { readonly found: false }

/** The fields asked for, and nothing else: no photo, no ingredients, fewer bytes at the shelf. */
export const OFF_FIELDS = [
  'product_name',
  ...LOCALES.map((locale) => `product_name_${locale}`),
  'lang',
  'brands',
  'product_quantity',
  'product_quantity_unit',
] as const

export class OffError extends Error {
  constructor(reason: string) {
    super(`open food facts: ${reason}`)
    this.name = 'OffError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

/** The entities the base was seen to carry (`&quot;`), decoded once — a name, not markup. */
function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z]+);/giu, (whole, body: string) => {
    if (!body.startsWith('#')) return NAMED[body.toLowerCase()] ?? whole
    const point =
      body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
    const valid = point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff)
    return valid ? String.fromCodePoint(point) : whole
  })
}

const UNDRAWN = /[\p{Co}\p{Cs}]/gu

/**
 * A name as a proposal could send it, or `null`. The base holds what anyone typed: HTML entities,
 * line breaks, a code where a name should be. A name with no letter, or of one character, is no
 * hint; one longer than an item's name is cut at a character, not refused — the start of a long
 * name is still the name. What is wrong in other ways (`test2`) is the person's to correct.
 */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const line = pastedLine(decodeEntities(raw))
    // A private-use glyph — Apple's logo from its keyboard, an icon font copied along — or a lone
    // surrogate draws nothing a shelf prints: dropped, not a reason to lose the whole name and keep
    // the code as unknown for a week (adversarial Ж).
    .replace(UNDRAWN, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const cut = Array.from(line).slice(0, ITEM_NAME_MAX).join('').trim()
  if (Array.from(cut).length < 2 || !/\p{L}/u.test(cut)) return null
  const name = itemSchema.shape.name.safeParse(cut)
  return name.success ? name.data : null
}

/**
 * The brand goes after the name unless the name carries it already (Р-3). Carrying it is having
 * the first two words of the first brand that are three letters or longer — one, when it has one —
 * among the name's words, by the search key: «Nutella» with «Nutella, Ferrero» stays «Nutella»,
 * «Coca Cola» with «COCA-COLA SERVICES SA/NV» stays as it is, «Молоко 3,2%» with «Простоквашино»
 * becomes «Молоко 3,2% Простоквашино». One word was too little: an article or a sort counted as the
 * brand — «La Laitière» was lost on «Yaourt à la vanille», «Российский сыродел» on «Сыр Российский»
 * (adversarial В). A name the brand would take past the limit stays without it.
 */
function withBrand(name: string, brands: unknown): string {
  if (typeof brands !== 'string') return name
  const brand = cleanName(brands.split(',')[0])
  if (brand === null) return name
  const words = toSearchKey(brand)
    .split(' ')
    .filter((word) => word !== '')
  const long = words.filter((word) => Array.from(word).length >= 3)
  const probe = (long.length > 0 ? long : words).slice(0, 2)
  const named = new Set(toSearchKey(name).split(' '))
  if (probe.length === 0 || probe.every((word) => named.has(word))) return name
  return cleanName(`${name} ${brand}`) === `${name} ${brand}` ? `${name} ${brand}` : name
}

/**
 * A name in each language of the interface (Р-2): its own field first, then the base's main name
 * when the product is in that language, then English, then the main name in whatever language it
 * is, and last the other interface language's — the first that survives `cleanName`. `null` when
 * none does.
 */
function namesOf(product: Record<string, unknown>): Record<AppLocale, string> | null {
  const names = {} as Record<AppLocale, string>
  for (const locale of LOCALES) {
    const order = [
      `product_name_${locale}`,
      ...(product.lang === locale ? ['product_name'] : []),
      'product_name_en',
      'product_name',
      ...LOCALES.filter((other) => other !== locale).map((other) => `product_name_${other}`),
    ]
    const name = order.map((field) => cleanName(product[field])).find((found) => found !== null)
    if (name === undefined) return null
    names[locale] = withBrand(name, product.brands)
  }
  return names
}

/** Thousandths of the base unit in one of each unit the base writes a size in (Р-4). */
const MILLI_PER: Readonly<Record<string, { readonly milli: bigint; readonly unit: BaseUnit }>> = {
  g: { milli: 1n, unit: 'kg' },
  kg: { milli: 1000n, unit: 'kg' },
  ml: { milli: 1n, unit: 'l' },
  cl: { milli: 10n, unit: 'l' },
  dl: { milli: 100n, unit: 'l' },
  l: { milli: 1000n, unit: 'l' },
}

/**
 * Past this a size is the base's mistake, not a package: a «400000 g» jar of spread would open
 * every purchase of it at four hundred kilograms.
 */
const PACKAGE_MAX_MILLI = 50_000n

/**
 * The size of the package as the purchase sheet's quantity (Р-4): a weight or a volume, in the unit
 * the item is counted in — 400 g is 0.4 kg. Pieces, ounces and anything unreadable give none: the
 * base's `quantity` text («400 g e», «6 x 1,5 l») is not parsed — its number is.
 */
function quantityOf(product: Record<string, unknown>): Quantity | null {
  const value = product.product_quantity
  const per =
    typeof product.product_quantity_unit === 'string'
      ? MILLI_PER[product.product_quantity_unit.trim().toLowerCase()]
      : undefined
  if (per === undefined) return null
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string') return null
  const thousandths = scaledFromDecimal(text, 3)
  if (thousandths === null || (thousandths * per.milli) % 1000n !== 0n) return null
  const milli = (thousandths * per.milli) / 1000n
  if (milli <= 0n || milli > PACKAGE_MAX_MILLI) return null
  const quantity = quantitySchema.safeParse({ milli, unit: per.unit })
  return quantity.success ? quantity.data : null
}

/**
 * An answer of `GET /api/v2/product/{code}`, read (MOL-162). Found is `status: 1` with a product,
 * and only that; not found is `status: 0` — which the base answers with a `404` for a code it does
 * not know and a `200` for one it calls invalid (measured 01.10.2026). Anything else — HTML from a
 * page «temporarily unavailable», JSON of another shape — is the base being out of reach, thrown.
 */
export function parseProduct(text: string): OffAnswer {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new OffError('not json')
  }
  if (!isRecord(body)) throw new OffError('not an object')
  if (body.status === 0) return { found: false }
  if (body.status !== 1 || !isRecord(body.product)) throw new OffError('unknown status')

  const names = namesOf(body.product)
  return names === null
    ? { found: false }
    : { found: true, product: { names, quantity: quantityOf(body.product) } }
}

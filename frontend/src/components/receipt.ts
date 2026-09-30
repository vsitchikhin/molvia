import { decimalFromMinor, parseMoney } from '@molvia/model'
import type { Currency, Money } from '@molvia/model'
import { shown } from '@/composables/useItemDetails'

/**
 * «Сумма по чеку» as typed (MOL-78): money above zero in its currency, or null — empty, not a
 * number, zero. The sheet and the question of «Закончить» read what was typed by this one rule.
 */
export function typedReceipt(text: string, currency: Currency): Money | null {
  if (!text.trim()) return null
  try {
    const money = parseMoney(text, currency)
    return money.minor > 0n ? money : null
  } catch {
    return null
  }
}

/** A sum put back into the field as a person types it: «12400», «12 400,50» without the spaces. */
export function receiptText(money: Money, locale: string): string {
  return shown(decimalFromMinor(money), locale === 'ru' ? ',' : '.')
}

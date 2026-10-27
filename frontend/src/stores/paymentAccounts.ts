import { z } from 'zod'
import type { Currency, MoneyAccountView, ReceiptPaidBy } from '@molvia/model'
import { defaultAccount, pageOrder } from '@/components/accounts'
import { read, write } from '@/stores/storage'

/**
 * Where an account was last chosen for a purchase (MOL-312, owner's В-1 «б», В-2 «б»): a receipt paid in cash
 * or by card, a receipt that does not say, a record typed by hand — each its own, so cash at the market does not
 * move the default of a receipt paid by card at the shop (Р-4).
 */
export type PaymentSlot = ReceiptPaidBy | 'receipt' | 'hand'

/** Per owner, per currency of the purchase: the account each slot was last recorded with. */
type Memory = Readonly<Record<string, Readonly<Partial<Record<PaymentSlot, string>>>>>

/** `molvia.payment-accounts.<owner>`: the device's alone, gone with «Выйти» as the owner's other drawers. */
const KEY = 'molvia.payment-accounts'

const memoryCodec = z.record(
  z.string(),
  z.partialRecord(z.enum(['cash', 'card', 'receipt', 'hand']), z.uuid()),
)

function recall(owner: string): Memory {
  const raw = read(`${KEY}.${owner}`)
  if (!raw) return {}
  try {
    const parsed = memoryCodec.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/** The slots a receipt's default is looked for in, first to last: its way of payment, then any receipt's. */
export function receiptSlots(paidBy: ReceiptPaidBy | null | undefined): PaymentSlot[] {
  return paidBy ? [paidBy, 'receipt'] : ['receipt']
}

/**
 * The account a purchase starts on (MOL-312): the live one last recorded in the first slot that names one, else
 * the first live account of its currency in the order of «Счета» (`defaultAccount`, a spending's). A slot's
 * account removed or gone since is passed over; the screen puts the default in, the server never guesses.
 */
export function rememberedAccount(
  accounts: readonly MoneyAccountView[],
  currency: Currency,
  slots: readonly PaymentSlot[],
  owner: string | null,
): MoneyAccountView | null {
  const memory = owner ? (recall(owner)[currency] ?? {}) : {}
  const live = pageOrder(accounts)
  for (const slot of slots) {
    const found = live.find((account) => account.id === memory[slot])
    if (found) return found
  }
  return defaultAccount(accounts, currency)
}

/**
 * A purchase recorded on an account: every slot it was looked for in now names it. «Без счёта» is never
 * remembered — a default of none would send every later receipt past the balances unseen (В-1 «б»).
 */
export function rememberPaymentAccount(
  owner: string | null,
  currency: Currency,
  slots: readonly PaymentSlot[],
  accountId: string | null,
): void {
  if (!owner || accountId === null) return
  const all = recall(owner)
  const slotsOf = { ...all[currency] }
  for (const slot of slots) slotsOf[slot] = accountId
  write(`${KEY}.${owner}`, JSON.stringify({ ...all, [currency]: slotsOf }))
}

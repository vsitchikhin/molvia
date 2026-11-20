import { DomainError, MINOR_EXPONENT, formatMoney, parseMoney, refundSum } from '@molvia/model'
import type { PaymentsRepository } from '@/db/payments-repository'
import { refundPayment } from '@/usecases/payments'
import type { PaymentChannelAdapter } from '@/usecases/payments'

export interface RefundDeps {
  readonly payments: PaymentsRepository
  /** Ameriabank's, by the bank's configuration; none — the command says what is missing and does nothing. */
  readonly channel: PaymentChannelAdapter | null
  readonly now: () => Date
}

const USAGE =
  'usage: refund --order <number> [--amount <drams>] [--yes] — a dry run without --yes; without --amount, all that is left'

/**
 * The owner gives money back (MOL-277, Р-9): `make refund ORDER= [AMOUNT=]`, on production
 * `exec backend node dist/refund.js`. No screen — a refund is the owner's act, one at a time. A dry run unless
 * `--yes`: the payment, what is left of it and what would be given back. The bank first, the journal after
 * (`refundPayment`); a whole refund takes back the payment's days not lived (MOL-283, В-2 «а»). Names nobody: the
 * order's number finds the payment, and nothing of the person is printed. Returns the exit code.
 */
export async function refund(
  args: readonly string[],
  deps: RefundDeps,
  say: (line: string) => void,
): Promise<number> {
  let order: string | undefined
  let amount: string | undefined
  let yes = false
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]
    if (arg === '--order') order = args[(at += 1)]
    else if (arg === '--amount') amount = args[(at += 1)]
    else if (arg === '--yes') yes = true
    else {
      say(USAGE)
      return 2
    }
  }
  if (order === undefined || !/^\d{1,19}$/.test(order)) {
    say(USAGE)
    return 2
  }
  const [payment] = await deps.payments.byOrders('ameriabank', [BigInt(order)])
  if (payment === undefined) {
    say(`no payment №${order}`)
    return 1
  }
  let minor: bigint | undefined
  if (amount !== undefined && amount !== '') {
    try {
      minor = parseMoney(amount, payment.amount.currency).minor
    } catch {
      say(`--amount ${amount} is no sum in ${payment.amount.currency}`)
      return 2
    }
  }
  const money = (value: bigint) => formatMoney({ minor: value, currency: payment.amount.currency })
  say(
    `payment №${order}: ${payment.tariff}, ${payment.state}, ${money(payment.amount.minor)}, refunded ${money(payment.refundedMinor)}`,
  )
  let sum: bigint
  try {
    sum = refundSum({ ...payment, amountMinor: payment.amount.minor }, minor)
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    say(`refused: ${payment.state === 'paid' ? 'past what is left' : 'not paid'}`)
    return 1
  }
  const whole = payment.refundedMinor + sum === payment.amount.minor
  const exponent = MINOR_EXPONENT[payment.amount.currency]
  say(
    `${yes ? 'refunding' : 'would refund'} ${money(sum)} (${String(Number(sum) / 10 ** exponent)})${whole ? ' — whole: the days not lived go back' : ' — a part: money only'}`,
  )
  if (!yes) {
    say('a dry run: nothing asked of the bank; --yes (make refund … YES=1) to refund')
    return 0
  }
  if (deps.channel === null) {
    say(
      'no bank: VPOS_STAND, VPOS_CLIENT_ID, VPOS_USERNAME, VPOS_PASSWORD and APP_BASE_URL are needed',
    )
    return 1
  }
  const settled = await refundPayment(
    { payments: deps.payments, channel: deps.channel },
    payment.id,
    sum,
    deps.now(),
  )
  say(`done: ${settled.state}`)
  return 0
}

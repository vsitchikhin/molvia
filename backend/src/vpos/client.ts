import { z } from 'zod'
import type { PaymentLang } from '@molvia/model'
import { boundedText } from '@/bounded-body'

/**
 * Ameriabank's vPOS 3.1 (MOL-277, research MOL-281): five REST methods and the SOAP list of operations. The host
 * is the code's by the stand, never a request's (SSRF); the merchant's three values go in the body of every call
 * and nowhere else — no log, no error, no failure carries them.
 */
export type VposStand = 'test' | 'live' | 'local'

/** Where each stand answers (MOL-281 §1): the API, the page a person pays on, the list of operations. */
export const VPOS_HOSTS: Readonly<
  Record<Exclude<VposStand, 'local'>, { api: string; page: string; list: string }>
> = {
  test: {
    api: 'https://servicestest.ameriabank.am/VPOS/api/VPOS',
    page: 'https://servicestest.ameriabank.am/VPOS/Payments/Pay',
    list: 'https://testpayments.ameriabank.am/Admin/webservice/TransactionsInformationService.svc',
  },
  live: {
    api: 'https://services.ameriabank.am/VPOS/api/VPOS',
    page: 'https://services.ameriabank.am/VPOS/Payments/Pay',
    list: 'https://payments.ameriabank.am/Admin/webservice/TransactionsInformationService.svc',
  },
}

/** The hosts of the fake bank of end-to-end, on the copy's own port (Р-7). */
export function localHosts(base: string): { api: string; page: string; list: string } {
  return { api: `${base}/VPOS/api/VPOS`, page: `${base}/VPOS/Payments/Pay`, list: `${base}/list` }
}

/**
 * A call waits this long: a person waits on `InitPayment` before the bank's page, and the WordPress plugin gives
 * the bank 30 s (MOL-281 §7) — a page that takes longer is no page to send anybody to.
 */
export const VPOS_TIMEOUT_MS = 15_000

/** The list of a day of a few dozen payments is kilobytes; anything past this is no answer (MOL-368). */
export const VPOS_MAX_BYTES = 4 * 1024 * 1024

/** A page of the bank lives at most 1200 s (`Timeout`, MOL-281 §1); asked for all of it. */
export const VPOS_PAGE_SECONDS = 1200

export interface VposCredentials {
  readonly clientId: string
  readonly username: string
  readonly password: string
}

/**
 * Why a call to the bank came to nothing: `unreachable` — no answer in time or no connection; `unreadable` — an
 * answer the client cannot read; `refused` — the bank's code of refusal, `bankCode` its own. The message names the
 * method and the bank's code alone, never the body: the credentials are in it.
 */
export class VposError extends Error {
  override readonly name = 'VposError'
  readonly code: string
  constructor(
    readonly kind: 'unreachable' | 'unreadable' | 'refused',
    readonly method: string,
    readonly bankCode?: string,
  ) {
    super(bankCode === undefined ? `${method}: ${kind}` : `${method}: ${kind} ${bankCode}`)
    this.code = `VPOS_${kind.toUpperCase()}`
  }
}

/** The bank's code may come as a number or a string (MOL-281 §1, observed): one spelling for both. */
const code = z.union([z.string(), z.number()]).transform(String)

const initAnswer = z.object({
  PaymentID: z.string().nullish(),
  ResponseCode: code,
})

/**
 * What `GetPaymentDetails` says that we read — the state, the sum approved, the currency, our order and the bank's
 * numbers — and nothing else: the holder's name, email, card, its term and issuer come too and are never read (MOL-281
 * §8), nor a field nobody reads, whose type the bank may change under us (review №10).
 */
const detailsAnswer = z.object({
  ResponseCode: code,
  OrderStatus: code.nullish(),
  OrderID: code.nullish(),
  Currency: z.string().nullish(),
  ApprovedAmount: z.number().nullish(),
  ApprovalCode: z.string().nullish(),
  rrn: z.string().nullish(),
})

export interface VposDetails {
  readonly responseCode: string
  readonly orderStatus: string | null
  /** Our order's number, the bank's less the stand's offset; `null` where it is none of ours. */
  readonly orderId: string | null
  readonly currency: string | null
  readonly approvedAmount: number | null
  readonly approvalCode: string | null
  readonly rrn: string | null
}

const idAnswer = z.object({
  PaymentId: z.string().nullish(),
  ResponseCode: code.nullish(),
})

/**
 * `GetPaymentId` of an order the bank has not got: its help names `ResponseCode` and no table says which; `06` is
 * «unknown OrderID» in the manual's table 1, and a nil uuid is what other merchants' drivers saw. Any other code with
 * no id is a refusal — a wrong password is a 200 with `20` (review №11). The price, named: an answer of another shape
 * the stand gives for «none» reads as a refusal, and the payment waits for the day's list.
 */
const NO_SUCH_ORDER = new Set(['06'])
const NIL_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/

const moneyAnswer = z.object({ ResponseCode: code })

/** One operation of the bank's list, as the reconciliation reads it: our order and the bank's state — nothing else. */
export interface VposOperation {
  readonly orderId: string
  readonly state: string
}

export interface InitRequest {
  readonly orderId: bigint
  /** In whole drams: the bank takes the major unit, and a fraction was refused on its stand (MOL-281 §1). */
  readonly amount: bigint
  readonly description: string
  readonly backUrl: string
}

export interface VposClient {
  /** The bank's id of the order registered: the same body again gives the same id (MOL-281 §4). */
  initPayment(request: InitRequest): Promise<string>
  /** `null` — the bank's 500 on a fresh order, «not paid yet», never a failure (MOL-281 §1). */
  paymentDetails(paymentId: string): Promise<VposDetails | null>
  /** The bank's id of our order, `null` where it has none — the answer of a lost `InitPayment`. */
  paymentId(orderId: bigint): Promise<string | null>
  refund(paymentId: string, amount: bigint): Promise<void>
  cancel(paymentId: string): Promise<void>
  /** Every operation of the period, by the SOAP service of the administration page. */
  operations(from: Date, to: Date): Promise<readonly VposOperation[]>
  /** The page a person pays on, in their language. */
  pageUrl(paymentId: string, lang: PaymentLang): string
}

export interface VposClientOptions {
  readonly hosts: { api: string; page: string; list: string }
  readonly credentials: VposCredentials
  /**
   * Added to our order's number on its way to the bank and taken off on its way back (adversarial А2): the test stand
   * takes orders only of the range the bank gives with the access (MOL-281 §4), and two databases on one stand must
   * not share numbers. 0 on the live stand.
   */
  readonly orderOffset?: bigint
  readonly timeoutMs?: number
}

/** The bank's period, `yyyy/MM/dd HH:mm`, by Yerevan's clock — the bank's own (AMT in its list). */
export function vposMoment(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yerevan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function unescapeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

const LIST_ACTION =
  'http://payments.ameriabank.am/ITransactionsInformationService/ITransactionsInformationService/GetTransactionList'

/**
 * The order and state of every `PaymentFields` of the list's answer, whatever prefix the namespace is given. The answer
 * is flat — no field holds another — so a pattern reads it, and no XML library comes in for one call a day.
 */
export function operationsOf(xml: string): readonly VposOperation[] {
  const rows: VposOperation[] = []
  for (const [, body = ''] of xml.matchAll(
    /<(?:[\w.-]+:)?PaymentFields\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?PaymentFields>/g,
  )) {
    const field = (name: string): string => {
      const found = new RegExp(
        `<(?:[\\w.-]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`,
      ).exec(body)
      return unescapeXml(found?.[1] ?? '').trim()
    }
    rows.push({ orderId: field('OrderID'), state: field('PaymentState') })
  }
  return rows
}

export function vposClient(options: VposClientOptions): VposClient {
  const { hosts, credentials } = options
  const timeoutMs = options.timeoutMs ?? VPOS_TIMEOUT_MS
  const offset = options.orderOffset ?? 0n

  /** Our order's number as the bank names it. */
  const toBank = (orderId: bigint): number => Number(orderId + offset)
  /** The bank's order as ours, or none: a number below the offset, or no number, is no order of ours. */
  function fromBank(order: string): string | null {
    if (!/^\d{1,19}$/.test(order)) return null
    const ours = BigInt(order) - offset
    return ours > 0n ? String(ours) : null
  }

  /** One request to the bank: a connection that failed keeps no cause — the request held the password. */
  async function call(method: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw new VposError('unreachable', method)
    }
  }

  async function textOf(method: string, response: Response): Promise<string> {
    try {
      return await boundedText(response, VPOS_MAX_BYTES, () => new VposError('unreadable', method))
    } catch (error) {
      if (error instanceof VposError) throw error
      throw new VposError('unreachable', method)
    }
  }

  async function post(method: string, body: Record<string, unknown>): Promise<Response> {
    return call(method, `${hosts.api}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function read<T>(method: string, response: Response, schema: z.ZodType<T>): Promise<T> {
    const text = await textOf(method, response)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new VposError('unreadable', method)
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new VposError('unreadable', method)
    return parsed.data
  }

  const merchant = () => ({
    ClientID: credentials.clientId,
    Username: credentials.username,
    Password: credentials.password,
  })
  const user = () => ({ Username: credentials.username, Password: credentials.password })

  return {
    async initPayment(request) {
      const response = await post('InitPayment', {
        ...merchant(),
        // the bank's integer: a bigint of the journal, far below 2^53
        OrderID: toBank(request.orderId),
        Amount: Number(request.amount),
        Currency: '051',
        Description: request.description,
        BackURL: request.backUrl,
        Opaque: '',
        Timeout: VPOS_PAGE_SECONDS,
      })
      const answer = await read('InitPayment', response, initAnswer)
      // success is the integer 1, «OK» (MOL-281 §1); a refusal's id is ""
      if (answer.ResponseCode !== '1' || !answer.PaymentID) {
        throw new VposError('refused', 'InitPayment', answer.ResponseCode)
      }
      return answer.PaymentID
    },

    async paymentDetails(paymentId) {
      const response = await post('GetPaymentDetails', { PaymentID: paymentId, ...user() })
      if (response.status >= 500) {
        await response.body?.cancel()
        return null
      }
      const answer = await read('GetPaymentDetails', response, detailsAnswer)
      return {
        responseCode: answer.ResponseCode,
        orderStatus: answer.OrderStatus ?? null,
        orderId: answer.OrderID == null ? null : fromBank(answer.OrderID),
        currency: answer.Currency ?? null,
        approvedAmount: answer.ApprovedAmount ?? null,
        approvalCode: answer.ApprovalCode ?? null,
        rrn: answer.rrn ?? null,
      }
    },

    async paymentId(orderId) {
      const response = await post('GetPaymentId', { ...merchant(), OrderID: toBank(orderId) })
      if (response.status >= 500) {
        await response.body?.cancel()
        return null
      }
      const answer = await read('GetPaymentId', response, idAnswer)
      const id = answer.PaymentId ?? ''
      if (id !== '' && !NIL_ID.test(id)) return id
      const said = answer.ResponseCode ?? null
      if (said === null || NO_SUCH_ORDER.has(said) || NIL_ID.test(id)) return null
      throw new VposError('refused', 'GetPaymentId', said)
    },

    async refund(paymentId, amount) {
      const response = await post('RefundPayment', {
        PaymentID: paymentId,
        ...user(),
        Amount: Number(amount),
      })
      const answer = await read('RefundPayment', response, moneyAnswer)
      if (answer.ResponseCode !== '00') {
        throw new VposError('refused', 'RefundPayment', answer.ResponseCode)
      }
    },

    async cancel(paymentId) {
      const response = await post('CancelPayment', { PaymentID: paymentId, ...user() })
      const answer = await read('CancelPayment', response, moneyAnswer)
      if (answer.ResponseCode !== '00') {
        throw new VposError('refused', 'CancelPayment', answer.ResponseCode)
      }
    },

    async operations(from, to) {
      const method = 'GetTransactionList'
      const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header><Action s:mustUnderstand="1" xmlns="http://schemas.microsoft.com/ws/2005/05/addressing/none">${LIST_ACTION}</Action></s:Header><s:Body><GetTransactionList xmlns="http://payments.ameriabank.am/ITransactionsInformationService"><transclient xmlns:d4p1="payments.ameriabank.am/TransactionClient" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><d4p1:ClientID>${escapeXml(credentials.clientId)}</d4p1:ClientID><d4p1:EndDate>${vposMoment(to)}</d4p1:EndDate><d4p1:Password>${escapeXml(credentials.password)}</d4p1:Password><d4p1:StartDate>${vposMoment(from)}</d4p1:StartDate><d4p1:Username>${escapeXml(credentials.username)}</d4p1:Username></transclient></GetTransactionList></s:Body></s:Envelope>`
      const response = await call(method, hosts.list, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: LIST_ACTION },
        body: envelope,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new VposError('refused', method, String(response.status))
      }
      const xml = await textOf(method, response)
      if (!xml.includes('GetTransactionListResult')) throw new VposError('unreadable', method)
      // the bank's numbers taken back to ours; one that is none of ours is marked so, never read as one of ours
      return operationsOf(xml).map((operation) => ({
        ...operation,
        orderId: fromBank(operation.orderId) ?? `none-of-ours:${operation.orderId}`,
      }))
    },

    pageUrl(paymentId, lang) {
      return `${hosts.page}?id=${encodeURIComponent(paymentId)}&lang=${lang}`
    },
  }
}

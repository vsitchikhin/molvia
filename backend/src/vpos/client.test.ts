import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VPOS_HOSTS,
  VPOS_MAX_BYTES,
  VPOS_PAGE_SECONDS,
  VPOS_TIMEOUT_MS,
  VposError,
  operationsOf,
  vposClient,
  vposMoment,
} from './client'

const SECRET = 'pa<ss>&word-never-logged'
const credentials = { clientId: 'client-1', username: 'user-1', password: SECRET }
const client = () => vposClient({ hosts: VPOS_HOSTS.test, credentials })

let fetch: ReturnType<typeof vi.fn>

function answering(body: string, status = 200): void {
  fetch = vi.fn(() => Promise.resolve(new Response(body, { status })))
  vi.stubGlobal('fetch', fetch)
}

function sent(): { url: string; body: Record<string, unknown> } {
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const request = {
  orderId: 2350301n,
  amount: 770n,
  description: 'Molvia, 30 days, receipts',
  backUrl: 'https://molvia.net/pay/done/p1',
}

describe('InitPayment — the order registered at the bank (MOL-277)', () => {
  it('posts the order to the stand’s host, in drams of «051», with no opaque and the page’s whole 1200 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    answering('{"PaymentID":"A1B2-C3","ResponseCode":1,"ResponseMessage":"OK"}')

    expect(await client().initPayment(request)).toBe('A1B2-C3')
    expect(sent()).toEqual({
      url: 'https://servicestest.ameriabank.am/VPOS/api/VPOS/InitPayment',
      body: {
        ClientID: 'client-1',
        Username: 'user-1',
        Password: SECRET,
        OrderID: 2350301,
        Amount: 770,
        Currency: '051',
        Description: 'Molvia, 30 days, receipts',
        BackURL: 'https://molvia.net/pay/done/p1',
        Opaque: '',
        Timeout: VPOS_PAGE_SECONDS,
      },
    })
    expect(timeout).toHaveBeenCalledWith(VPOS_TIMEOUT_MS)
  })

  it('refuses a wrong password, which comes as HTTP 200 and code 20, by the bank’s code alone', async () => {
    answering('{"PaymentID":"","ResponseCode":20,"ResponseMessage":"Invalid Username or Password"}')

    const refused = await client()
      .initPayment(request)
      .catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(VposError)
    expect(refused).toMatchObject({ kind: 'refused', bankCode: '20', code: 'VPOS_REFUSED' })
    expect(JSON.stringify(refused)).not.toContain(SECRET)
    expect(String(refused)).not.toContain(SECRET)
  })

  it('refuses code 1 that names no payment', async () => {
    answering('{"PaymentID":"","ResponseCode":1}')
    await expect(client().initPayment(request)).rejects.toMatchObject({ kind: 'refused' })
  })

  it('a connection that failed is «unreachable», and keeps no cause — the request held the password', async () => {
    fetch = vi.fn(() => Promise.reject(new TypeError(`fetch failed ${SECRET}`)))
    vi.stubGlobal('fetch', fetch)

    const refused = await client()
      .initPayment(request)
      .catch((error: unknown) => error)

    expect(refused).toMatchObject({ kind: 'unreachable', method: 'InitPayment' })
    expect((refused as Error).cause).toBeUndefined()
    expect(String(refused)).not.toContain(SECRET)
  })

  it('an answer that is no JSON, or past the ceiling, is «unreadable»', async () => {
    answering('<html>Service Unavailable</html>')
    await expect(client().initPayment(request)).rejects.toMatchObject({ kind: 'unreadable' })
    answering('x'.repeat(VPOS_MAX_BYTES + 1))
    await expect(client().initPayment(request)).rejects.toMatchObject({ kind: 'unreadable' })
  })
})

describe('GetPaymentDetails — the bank’s word of a payment', () => {
  it('reads the state, sums, currency, order and numbers — «2» as a string or a number alike', async () => {
    for (const status of ['"2"', '2']) {
      answering(
        `{"ResponseCode":"00","OrderStatus":${status},"OrderID":"2350301","Currency":"051","Amount":770.0,` +
          '"ApprovedAmount":770.0,"ApprovalCode":"123456","rrn":"626301234567","ClientName":"ANNA",' +
          '"CardNumber":"4083****3143","BankInfo":{"BankName":"X"}}',
      )
      expect(await client().paymentDetails('A1B2-C3')).toEqual({
        responseCode: '00',
        orderStatus: '2',
        orderId: '2350301',
        currency: '051',
        approvedAmount: 770,
        approvalCode: '123456',
        rrn: '626301234567',
      })
    }
    expect(sent()).toEqual({
      url: 'https://servicestest.ameriabank.am/VPOS/api/VPOS/GetPaymentDetails',
      body: { PaymentID: 'A1B2-C3', Username: 'user-1', Password: SECRET },
    })
  })

  it('HTTP 500 of a fresh order is «not paid yet», no failure (MOL-281 §1)', async () => {
    answering('{"Message":"An error has occurred."}', 500)
    expect(await client().paymentDetails('A1B2-C3')).toBeNull()
  })
})

describe('GetPaymentId, RefundPayment, CancelPayment', () => {
  it('names the bank’s id of our order, none where it has none', async () => {
    answering('{"PaymentId":"A1B2-C3","ResponseMessage":"OK"}')
    expect(await client().paymentId(2350301n)).toBe('A1B2-C3')
    expect(sent().body).toMatchObject({ ClientID: 'client-1', OrderID: 2350301 })
    answering('{"PaymentId":"","ResponseMessage":"Not found"}')
    expect(await client().paymentId(2350301n)).toBeNull()
  })

  it('gives money back on «00» and refuses on any other code — «07» of a sum past what is left', async () => {
    answering('{"ResponseCode":"00","ResponseMessage":"OK"}')
    await client().refund('A1B2-C3', 300n)
    expect(sent().body).toEqual({
      PaymentID: 'A1B2-C3',
      Username: 'user-1',
      Password: SECRET,
      Amount: 300,
    })
    answering('{"ResponseCode":"07","ResponseMessage":"System error"}')
    await expect(client().refund('A1B2-C3', 300n)).rejects.toMatchObject({ bankCode: '07' })
    answering('{"ResponseCode":"00"}')
    await client().cancel('A1B2-C3')
    expect(sent().url).toBe('https://servicestest.ameriabank.am/VPOS/api/VPOS/CancelPayment')
    answering('{"ResponseCode":"07"}')
    await expect(client().cancel('A1B2-C3')).rejects.toMatchObject({ kind: 'refused' })
  })

  it('opens the bank’s page by the payment and the language', () => {
    expect(client().pageUrl('A1B2-C3', 'ru')).toBe(
      'https://servicestest.ameriabank.am/VPOS/Payments/Pay?id=A1B2-C3&lang=ru',
    )
  })
})

/** The manual's own sample of the list (vPOS 3.1, «GetTransactionList»), one operation. */
const LIST = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header /><s:Body>
<GetTransactionListResponse xmlns="http://payments.ameriabank.am/ITransactionsInformationService">
<GetTransactionListResult xmlns:a="payments.ameriabank.am/TransactionFields" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
<a:PaymentFields><a:Amount>5.00</a:Amount><a:ApproveAmount>5.00</a:ApproveAmount><a:AuthCode>422841</a:AuthCode>
<a:CardNumber>408306**3143</a:CardNumber><a:ClientName>orange.com</a:ClientName><a:Currency>051</a:Currency>
<a:Descr i:nil="true" /><a:OrderID>58554654</a:OrderID><a:PaymentID>b3201a82-dc65-430c-9c46-d1bf294c5770</a:PaymentID>
<a:PaymentState>4</a:PaymentState><a:RespCode>00 : Payment Successfully Completed</a:RespCode></a:PaymentFields>
</GetTransactionListResult></GetTransactionListResponse></s:Body></s:Envelope>`

describe('GetTransactionList — the day’s operations, by SOAP', () => {
  it('reads each operation’s order and state — nothing it does not read, never the card or the holder', () => {
    expect(operationsOf(LIST)).toEqual([{ orderId: '58554654', state: '4' }])
    expect(operationsOf(LIST.replace('>4<', '>payment_refunded<'))).toEqual([
      { orderId: '58554654', state: 'payment_refunded' },
    ])
    expect(operationsOf(LIST.replaceAll('a:', 'b:').replace('xmlns:a', 'xmlns:b'))).toHaveLength(1)
    expect(operationsOf('<GetTransactionListResult />')).toEqual([])
  })

  it('posts the envelope with the credentials escaped and the period by Yerevan’s clock', async () => {
    answering(LIST)

    const rows = await client().operations(
      new Date('2026-12-01T20:00:00Z'),
      new Date('2026-12-02T19:59:00Z'),
    )

    expect(rows).toHaveLength(1)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(VPOS_HOSTS.test.list)
    const body = init.body as string
    expect(body).toContain('<d4p1:Password>pa&lt;ss&gt;&amp;word-never-logged</d4p1:Password>')
    expect(body).toContain('<d4p1:StartDate>2026/12/02 00:00</d4p1:StartDate>')
    expect(body).toContain('<d4p1:EndDate>2026/12/02 23:59</d4p1:EndDate>')
  })

  it('an answer that is no list, or a fault, is no list', async () => {
    answering('<html>maintenance</html>')
    await expect(client().operations(new Date(), new Date())).rejects.toMatchObject({
      kind: 'unreadable',
    })
    answering('<s:Fault />', 500)
    await expect(client().operations(new Date(), new Date())).rejects.toMatchObject({
      kind: 'refused',
      bankCode: '500',
    })
  })

  it('names a moment as the bank does', () => {
    expect(vposMoment(new Date('2026-01-01T20:05:00Z'))).toBe('2026/01/02 00:05')
  })
})

describe('the stand’s range of order numbers (adversarial А2)', () => {
  const ranged = () => vposClient({ hosts: VPOS_HOSTS.test, credentials, orderOffset: 2350300n })

  it('adds the offset on the way to the bank and takes it off on the way back', async () => {
    answering('{"PaymentID":"A1","ResponseCode":1}')
    await ranged().initPayment({ ...request, orderId: 7n })
    expect(sent().body).toMatchObject({ OrderID: 2350307 })

    answering('{"ResponseCode":"00","OrderStatus":"2","OrderID":"2350307","Currency":"051"}')
    expect((await ranged().paymentDetails('A1'))?.orderId).toBe('7')
    answering('{"ResponseCode":"00","OrderStatus":"2","OrderID":"12","Currency":"051"}')
    expect((await ranged().paymentDetails('A1'))?.orderId).toBeNull()

    answering(LIST.replace('58554654', '2350307'))
    expect(await ranged().operations(new Date(), new Date())).toEqual([
      { orderId: '7', state: '4' },
    ])
    // 58554654 less the offset is ours too: 56204354
    answering(LIST)
    expect(await ranged().operations(new Date(), new Date())).toEqual([
      { orderId: '56204354', state: '4' },
    ])
  })

  it('marks a listed order below the offset as none of ours', async () => {
    answering(LIST.replace('58554654', '12'))
    expect(await ranged().operations(new Date(), new Date())).toEqual([
      { orderId: 'none-of-ours:12', state: '4' },
    ])
  })
})

describe('GetPaymentId judges the bank’s code (review №11)', () => {
  it('none for an order the bank has not got — no id with «06», no code, or a nil id', async () => {
    for (const body of [
      '{"PaymentId":"","ResponseCode":"06"}',
      '{"PaymentId":null}',
      '{"PaymentId":"00000000-0000-0000-0000-000000000000","ResponseCode":"00"}',
    ]) {
      answering(body)
      expect(await client().paymentId(1n)).toBeNull()
    }
  })

  it('a refusal for any other code with no id — a wrong password among them', async () => {
    answering('{"PaymentId":"","ResponseCode":"20"}')
    await expect(client().paymentId(1n)).rejects.toMatchObject({ kind: 'refused', bankCode: '20' })
  })
})

// A stand-in for Ameriabank's vPOS in end-to-end runs (MOL-277): the API's channel asks it what it would ask the
// bank's stand (`VPOS_STAND=local`), and no run reaches the bank.
//
// The five methods answer as the bank's stand does: `InitPayment` registers an order and names it `E2E-<order>`,
// `GetPaymentDetails` answers the bank's 500 of an order nobody paid, `GetPaymentId` names an order registered,
// `RefundPayment` and `CancelPayment` say «00», and the list of operations is empty. The page a person pays on is no
// screen of the run: end-to-end has no rate of the CBA (`RATES_REFRESH=off`), so no price, and no payment starts.
//
//   VPOS_PORT=3346 node bin/fake-vpos.mjs

import { createServer } from 'node:http'
import process from 'node:process'

const port = Number(process.env.VPOS_PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('VPOS_PORT is not set')
  process.exit(1)
}

const registered = new Set()

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function bodyOf(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

const EMPTY_LIST =
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header /><s:Body>' +
  '<GetTransactionListResponse xmlns="http://payments.ameriabank.am/ITransactionsInformationService">' +
  '<GetTransactionListResult xmlns:a="payments.ameriabank.am/TransactionFields" />' +
  '</GetTransactionListResponse></s:Body></s:Envelope>'

createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://fake').pathname
  if (path === '/health') return json(response, 200, { ok: true })
  if (path === '/list') {
    response.writeHead(200, { 'content-type': 'text/xml' })
    return response.end(EMPTY_LIST)
  }
  const body = await bodyOf(request)
  switch (path) {
    case '/VPOS/api/VPOS/InitPayment':
      registered.add(String(body.OrderID))
      return json(response, 200, {
        PaymentID: `E2E-${String(body.OrderID)}`,
        ResponseCode: 1,
        ResponseMessage: 'OK',
      })
    case '/VPOS/api/VPOS/GetPaymentDetails':
      return json(response, 500, { Message: 'An error has occurred.' })
    case '/VPOS/api/VPOS/GetPaymentId':
      return json(response, 200, {
        PaymentId: registered.has(String(body.OrderID)) ? `E2E-${String(body.OrderID)}` : '',
      })
    case '/VPOS/api/VPOS/RefundPayment':
    case '/VPOS/api/VPOS/CancelPayment':
      return json(response, 200, { ResponseCode: '00', ResponseMessage: 'OK' })
    default:
      return json(response, 404, { Message: 'No such method' })
  }
}).listen(port, '127.0.0.1')

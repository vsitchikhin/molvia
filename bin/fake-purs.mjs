// A stand-in for the Serbian tax office's check of a receipt in end-to-end runs (MOL-232): the API
// asks it what it would ask `suf.purs.gov.rs`, and no run reaches the real one.
//
// It reads the receipt's link as the tax office does — `vl` decoded, its total and number — and
// answers with a journal of two lines under a head that names nobody. The receipt's requesting
// unit picks what happens, so a spec makes the case it needs with a link of its own:
//   FRESHAAA — not shown for the first two asks (404), as a receipt just printed;
//   MISSINGA — never shown;
//   INVALIDA — shown and held not valid;
//   anything else — shown at once.
// A request without our User-Agent is refused.
//
//   PURS_PORT=3305 node bin/fake-purs.mjs

import { createServer } from 'node:http'
import process from 'node:process'

const port = Number(process.env.PURS_PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('PURS_PORT is not set')
  process.exit(1)
}

const asks = new Map()

const JOURNAL = [
  '============ ФИСКАЛНИ РАЧУН ============',
  '               100000009                ',
  '           Тест продавац доо            ',
  '     1000001-ТЕСТ ПРОДАВНИЦА 1          ',
  '             Београд-Земун              ',
  'Касир:                    Тест Тестовић',
  '-------------ПРОМЕТ ПРОДАЈА-------------',
  'Артикли',
  '========================================',
  'Назив   Цена         Кол.         Укупно',
  'SECER KRISTAL 1KG SUNOKO KOM (Е)        ',
  '        94,99          2          189,98',
  'BANANA KG (Е)                           ',
  '       199,99      1,482          296,39',
  '----------------------------------------',
  'Укупан износ:                     486,37',
  '========================================',
  '======== КРАЈ ФИСКАЛНОГ РАЧУНА =========',
].join('\r\n')

function answer(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(body === undefined ? '' : JSON.stringify(body))
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`)
  if (url.pathname === '/health') {
    answer(response, 200, { ok: true })
    return
  }
  if (request.method !== 'GET' || url.pathname !== '/v/') {
    answer(response, 404)
    return
  }
  if (!/^Molvia\/\S+ \(.+\)$/.test(request.headers['user-agent'] ?? '')) {
    answer(response, 403)
    return
  }
  const vl = url.searchParams.get('vl') ?? ''
  const bytes = Buffer.from(vl, 'base64')
  if (bytes.length < 572) {
    answer(response, 400)
    return
  }
  const requestedBy = bytes.subarray(1, 9).toString('latin1')
  const signedBy = bytes.subarray(9, 17).toString('latin1')
  const number = `${requestedBy}-${signedBy}-${String(bytes.readUInt32LE(17))}`
  const asked = (asks.get(vl) ?? 0) + 1
  asks.set(vl, asked)
  if (requestedBy === 'MISSINGA' || (requestedBy === 'FRESHAAA' && asked <= 2)) {
    answer(response, 404)
    return
  }
  answer(response, 200, {
    invoiceRequest: {
      taxId: '100000009',
      businessName: 'Тест продавац доо',
      locationName: '1000001-ТЕСТ ПРОДАВНИЦА 1',
      address: 'ТЕСТНА УЛИЦА 1',
      city: 'БЕОГРАД (ЗЕМУН)',
      administrativeUnit: 'Београд-Земун',
      buyer: null,
      cashier: 'Тест Тестовић',
      requestedBy,
      invoiceType: 0,
      transactionType: 0,
      payments: [{ paymentType: 1, amount: 500 }],
    },
    invoiceResult: {
      totalAmount: Number(bytes.readBigUInt64LE(25)) / 10_000,
      invoiceNumber: number,
      signedBy,
      sdcTime: new Date(Number(bytes.readBigUInt64BE(33))).toISOString(),
    },
    journal: JOURNAL,
    isValid: requestedBy !== 'INVALIDA',
  })
}).listen(port, '127.0.0.1')

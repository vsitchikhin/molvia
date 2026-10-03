// A stand-in for the receipt reader in end-to-end runs (MOL-127, Р-7): the API asks it what it would
// ask Tesseract, and a receipt taken in the browser goes the whole way — queued, read, parsed, bound,
// reviewed, recorded — with no Tesseract on the machine.
//
// Whatever photo comes, the answer is the bench's reading of am-05 (MOL-114): the item rows under a
// made-up header, the fixture the model's and the API's tests already read
// (`packages/model/tests/entities/receipt-text.am-05.json`) — no person's receipt, the repository is
// public. Page mode 4 and 6 answer the two readings the bench took; every row has a box, so the item
// lines can be cut out, and a cut-out is a few bytes of nothing.
//
//   READER_PORT=3324 node bin/fake-receipt-reader.mjs

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'

const port = Number(process.env.READER_PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('READER_PORT is not set')
  process.exit(1)
}

const bench = JSON.parse(
  readFileSync(
    new URL('../packages/model/tests/entities/receipt-text.am-05.json', import.meta.url),
    'utf8',
  ),
)
const READINGS = { 4: bench.readings[0], 6: bench.readings[1] }
/** A PNG's signature: enough for a strip nobody looks at. */
const STRIP = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')

function answer(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`)
  if (url.pathname === '/health') {
    answer(response, 200, { ok: true, tesseract: 'fake' })
    return
  }
  // The photo is read off the wire whole before the answer, as the real reader does.
  request.on('data', () => undefined)
  request.on('end', () => {
    if (request.method === 'POST' && url.pathname === '/read') {
      const text = READINGS[Number(url.searchParams.get('psm'))] ?? ''
      answer(response, 200, {
        text,
        rows: text
          .split('\n')
          .map((row, index) => ({ text: row, box: row.trim() ? [0, index * 40, 600, 30] : null })),
        version: 'tesseract fake · e2e',
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/strips') {
      const boxes = (url.searchParams.get('boxes') ?? '').split(';').filter(Boolean)
      answer(response, 200, { strips: boxes.map(() => STRIP) })
      return
    }
    answer(response, 404, { error: 'no such page' })
  })
}).listen(port, '127.0.0.1')

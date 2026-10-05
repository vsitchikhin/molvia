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
// A square photo — no receipt is one — is answered with a sole trader's receipt with no items (MOL-227):
// the section «Բաժին 1» and its sum under a made-up head, as the bench's am-15…am-24 print it.
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
const SECTION = [
  'ԽԱՆՈՒԹ ԱՁ',
  'ԳՅՈՒՄՐԻ Աբովյան 10',
  'ՀՎՀՀ: 12345678 Գ/Հ: 87654321',
  'ԿՀ: 00000049',
  '04-10-26 16:30:59 ԳԱՆՁԱՊԱՀ: 3',
  'Բաժին 1 - Բաժին 1',
  '/ Շրջանառության հարկ/ 1700.00',
  'Ընդամենը՝ 1700.00',
  'Առձեռն 1700.00',
].join('\n')

/** The sides of a JPEG, from its frame header (SOF0…SOF2); null for anything else. */
function sidesOf(bytes) {
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    const length = bytes.readUInt16BE(at + 2)
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
    }
    at += 2 + length
  }
  return null
}
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
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    if (request.method === 'POST' && url.pathname === '/read') {
      const sides = sidesOf(Buffer.concat(chunks))
      const square = sides !== null && Math.abs(sides.height - sides.width) <= sides.width * 0.1
      const text = square ? SECTION : (READINGS[Number(url.searchParams.get('psm'))] ?? '')
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

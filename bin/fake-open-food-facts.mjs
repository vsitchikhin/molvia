// A stand-in for Open Food Facts in end-to-end runs (MOL-162): the API asks it what the real base
// would be asked, and no test run ever reaches the real one — fifteen runs a minute from one machine
// would get that machine banned.
//
// It knows every code led by `46` — a Russian import on an Armenian shelf — as a can of stew named by
// the code's last six digits, so a spec makes its own product with a fresh code and a retry never
// meets the item a failed try wrote. Every other code is one it does not know, answered as the base
// answers it: a `404` with `status: 0` inside. A request without our User-Agent is refused, as the
// base may refuse it.
//
//   OFF_PORT=3302 node bin/fake-open-food-facts.mjs

import { createServer } from 'node:http'
import process from 'node:process'

const port = Number(process.env.OFF_PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('OFF_PORT is not set')
  process.exit(1)
}

function answer(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`)
  if (url.pathname === '/health') {
    answer(response, 200, { ok: true })
    return
  }

  const product = /^\/api\/v2\/product\/(\d+)$/.exec(url.pathname)
  if (request.method !== 'GET' || product === null) {
    answer(response, 404, { status: 0, status_verbose: 'no such page' })
    return
  }
  if (!/^Molvia\/\S+ \(.+\)$/.test(request.headers['user-agent'] ?? '')) {
    answer(response, 403, { status: 0, status_verbose: 'name yourself' })
    return
  }

  const code = product[1]
  if (!code.startsWith('46')) {
    answer(response, 404, { code, status: 0, status_verbose: 'product not found' })
    return
  }
  answer(response, 200, {
    code,
    product: {
      brands: 'Главпродукт',
      lang: 'ru',
      product_name: `Тушёнка ${code.slice(-6)}`,
      product_quantity: 325,
      product_quantity_unit: 'g',
    },
    status: 1,
    status_verbose: 'product found',
  })
}).listen(port, '127.0.0.1')

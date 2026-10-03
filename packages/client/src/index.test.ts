import { describe, expect, it, vi } from 'vitest'
import { ERROR, ISSUE, TODAY_HEADER, VERSION_HEADER, ZONE_HEADER } from '@molvia/model'
import { ApiError, createClient } from '#client/index'

function clientAnswering(status: number, body: unknown) {
  const fetch = (): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  return createClient({ baseUrl: 'http://api', fetch })
}

/** Raw bytes rather than `JSON.stringify` — what a proxy, a gateway or a cut-off reply sends. */
function clientServing(body: BodyInit | null, init: ResponseInit = {}) {
  return createClient({
    baseUrl: 'http://api',
    fetch: () => Promise.resolve(new Response(body, init)),
  })
}

/** Keeps what the client actually sent, which is the half a mocked reply cannot show. */
function clientRecording(options: { credentials?: 'omit' | 'same-origin' | 'include' } = {}) {
  const calls: {
    url: string
    method: string
    headers: Headers
    credentials: string | undefined
  }[] = []
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
    })
    return Promise.resolve(
      new Response(JSON.stringify(actorWire), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return { client: createClient({ baseUrl: 'http://api', fetch, ...options }), calls }
}

const actorWire = {
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: '2026-09-16T10:00:00.123Z',
  updatedAt: '2026-09-16T10:00:00.456Z',
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error.code
    return `не ApiError: ${(error as Error).name}`
  }
  return 'не бросил'
}

describe('everything the client throws is an ApiError', () => {
  it('including a reply that does not match its own schema', async () => {
    // A 200 whose body is wrong used to escape as a bare ZodError, so the obvious
    // `catch (e) { e instanceof ApiError }` missed it.
    const client = clientAnswering(200, { status: 'ok', database: 'up' })
    expect(await codeOf(client.health())).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('including the contradiction the health schema was given a refine for', async () => {
    const client = clientAnswering(200, { status: 'ok', version: '1', database: 'down' })
    expect(await codeOf(client.health())).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('carrying the code the API sent when it sent one', async () => {
    const client = clientAnswering(400, { code: ISSUE.BODY_INVALID, details: 'tripId' })
    expect(await codeOf(client.health())).toBe(ISSUE.BODY_INVALID)
  })

  it('including a body that is not JSON at all: a proxy page, empty, or cut off', async () => {
    // The earlier test for this corner passed a string through `JSON.stringify`, so what
    // reached the client was valid JSON. Real bytes are not, `.json()` throws, and every
    // line below it — including the one that tells a dead identity from a broken server —
    // was skipped entirely.
    const proxy = clientServing('<html>\n<head><title>401</title></head>\n</html>', {
      status: 401,
      headers: { 'content-type': 'text/html' },
    })
    expect(await codeOf(proxy.me())).toBe(ISSUE.RESPONSE_INVALID)

    const empty = clientServing(null, { status: 401 })
    expect(await codeOf(empty.me())).toBe(ISSUE.RESPONSE_INVALID)

    const truncated = clientServing('', { status: 200, headers: { 'content-type': 'text/plain' } })
    expect(await codeOf(truncated.me())).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('calls a 5xx what it is — the server down, not an answer off-contract', async () => {
    // Caddy's 502 during a deploy carries an HTML page. Reporting it as a malformed reply
    // sends whoever reads the code looking at the contract instead of at the server.
    const gateway = clientServing('<html>502 Bad Gateway</html>', { status: 502 })
    expect(await codeOf(gateway.health())).toBe(ERROR.INTERNAL)

    const unavailable = clientServing(null, { status: 503 })
    expect(await codeOf(unavailable.me())).toBe(ERROR.INTERNAL)
  })

  it('gives up on a request that hangs, instead of waiting for a network that is gone', async () => {
    // A captive portal or a half-dead mobile network holds a call open indefinitely. The
    // PWA would sit on «loading» — no message, no retry — while the identity lock it holds
    // keeps every other tab waiting with it.
    //
    // Ten milliseconds rather than the real fifteen seconds: the limit is an option
    // precisely so that a suite proving it does not have to wait for it (М-24).
    const client = createClient({
      baseUrl: 'http://api',
      timeoutMs: 10,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          })
        }),
    })

    expect(await codeOf(client.me())).toBe(ERROR.INTERNAL)
  })

  it('does not put a deadline on the first visit, where an abort would orphan a row', async () => {
    // An abort on this side says nothing about whether the INSERT landed, so a retry after
    // one creates a **second** identity — and rows in `actors` are the denominator of the
    // 0.2 gate. A cold VPS answering slowly is the ordinary case, not the failure.
    let aborted = false
    const client = createClient({
      baseUrl: 'http://api',
      timeoutMs: 10,
      fetch: (_input, init) =>
        new Promise((resolve) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true
          })
          setTimeout(() => {
            resolve(new Response(JSON.stringify(actorWire), { status: 201 }))
          }, 40)
        }),
    })

    const actor = await client.devLogin()

    expect(aborted).toBe(false)
    expect(actor.id).toBe(actorWire.id)
  })

  it('and a dropped connection, which is fetch’s own TypeError', async () => {
    const client = createClient({
      baseUrl: 'http://api',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    expect(await codeOf(client.me())).toBe(ERROR.INTERNAL)
  })

  it('and tells a reply with no body of ours from no reply at all, by its status (MOL-147)', async () => {
    // Both are `error.internal`; only the first is the server's word on why the screen broke.
    const reply = await clientServing('<html>502 Bad Gateway</html>', { status: 502 })
      .health()
      .catch((error: unknown) => error)
    const dropped = await createClient({
      baseUrl: 'http://api',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    })
      .me()
      .catch((error: unknown) => error)

    expect(reply).toMatchObject({ code: ERROR.INTERNAL, answered: false, status: 502 })
    expect(dropped).toMatchObject({ code: ERROR.INTERNAL, answered: false, status: undefined })
  })

  it('and telling «not found» apart from the rest without reading a message', async () => {
    const client = clientServing('<html>nginx</html>', { status: 404 })
    expect(await codeOf(client.me())).toBe(ERROR.NOT_FOUND)
  })

  it('and says whether the code is the API’s own word or guessed from a bare status', async () => {
    // A captive portal's 404 page is `not_found` too; a caller for whom a refusal is final must
    // tell it from the API's (MOL-24, adversarial A3).
    const failure = async (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => (error instanceof ApiError ? error.answered : null),
      )
    expect(await failure(clientServing('<html>nginx</html>', { status: 404 }).me())).toBe(false)
    expect(await failure(clientAnswering(404, { code: ERROR.NOT_FOUND }).me())).toBe(true)
    expect(await failure(clientAnswering(400, { code: ISSUE.BODY_INVALID }).health())).toBe(true)
    const dropped = createClient({
      baseUrl: 'http://api',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    expect(await failure(dropped.me())).toBe(false)
  })

  it('and passes a good answer through', async () => {
    const client = clientAnswering(200, { status: 'ok', version: '1.0.0', database: 'up' })
    await expect(client.health()).resolves.toEqual({
      status: 'ok',
      version: '1.0.0',
      database: 'up',
    })
  })
})

describe('the build an answer names (MOL-132)', () => {
  function clientHearing(body: BodyInit | null, init: ResponseInit) {
    const heard: string[] = []
    const client = createClient({
      baseUrl: 'http://api',
      fetch: () => Promise.resolve(new Response(body, init)),
      onVersion: (version) => heard.push(version),
    })
    return { client, heard }
  }

  const json = { 'content-type': 'application/json', [VERSION_HEADER]: 'v0.1.4-2-g9f00000' }

  it('is heard on an answer that reads', async () => {
    const { client, heard } = clientHearing(JSON.stringify(actorWire), {
      status: 200,
      headers: json,
    })
    await client.me()
    expect(heard).toEqual(['v0.1.4-2-g9f00000'])
  })

  it('is heard on an answer this code can no longer read, before it is refused', async () => {
    // The whole point: a server rolled out under an open page answers in a shape the old code
    // refuses, and that very answer is what tells the page to look for its new version.
    const { client, heard } = clientHearing(JSON.stringify({ ...actorWire, id: 7 }), {
      status: 200,
      headers: json,
    })
    expect(await codeOf(client.me())).toBe(ISSUE.RESPONSE_INVALID)
    expect(heard).toEqual(['v0.1.4-2-g9f00000'])
  })

  it('is heard on a refusal in the API’s own words', async () => {
    const { client, heard } = clientHearing(JSON.stringify({ code: ERROR.NOT_FOUND }), {
      status: 404,
      headers: json,
    })
    expect(await codeOf(client.me())).toBe(ERROR.NOT_FOUND)
    expect(heard).toEqual(['v0.1.4-2-g9f00000'])
  })

  it('says nothing for an answer that names no build — a proxy’s 502 during a rollout', async () => {
    const { client, heard } = clientHearing('<html>502 Bad Gateway</html>', { status: 502 })
    expect(await codeOf(client.health())).toBe(ERROR.INTERNAL)
    expect(heard).toEqual([])
  })
})

describe('the phone’s today on every request (MOL-121)', () => {
  function clientWith(today?: () => string) {
    const sent: { headers: Headers; body: unknown }[] = []
    const client = createClient({
      baseUrl: 'http://api',
      fetch: (_url, init) => {
        sent.push({
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        })
        return Promise.resolve(new Response(null, { status: 204 }))
      },
      ...(today ? { today } : {}),
    })
    return { client, sent }
  }

  it('names the day it is asked at, each request anew', async () => {
    let day = '2026-09-28'
    const { client, sent } = clientWith(() => day)
    await client.finishTrip('0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d')
    day = '2026-09-29'
    await client.finishTrip('0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d')
    expect(sent.map(({ headers }) => headers.get(TODAY_HEADER))).toEqual([
      '2026-09-28',
      '2026-09-29',
    ])
  })

  it('names the phone’s zone beside its day, where one was given', async () => {
    const sent: Headers[] = []
    const client = createClient({
      baseUrl: 'http://api',
      fetch: (_url, init) => {
        sent.push(new Headers(init?.headers))
        return Promise.resolve(new Response(null, { status: 204 }))
      },
      today: () => '2026-09-28',
      zone: () => 'Europe/Moscow',
    })
    await client.finishTrip('0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d')
    expect(sent[0]?.get(ZONE_HEADER)).toBe('Europe/Moscow')
  })

  it('names none where no day was given — the bot', async () => {
    const { client, sent } = clientWith()
    await client.finishTrip('0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d')
    expect(sent[0]?.headers.has(TODAY_HEADER)).toBe(false)
    expect(sent[0]?.headers.has(ZONE_HEADER)).toBe(false)
  })

  it('a finish carries the day of its tap beside the moment', async () => {
    const { client, sent } = clientWith()
    const at = new Date('2026-09-28T20:30:00Z')
    await client.finishTrip('0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d', at, '2026-09-28')
    expect(sent[0]?.body).toEqual({
      finishedOnDeviceAt: at.toISOString(),
      finishedOn: '2026-09-28',
    })
  })
})

describe('a 401 only means «this identity is gone» when the API says so', () => {
  it('reads NO_ACTOR from the body, which is the one thing that can say it', async () => {
    const client = clientAnswering(401, { code: ERROR.NO_ACTOR })
    expect(await codeOf(client.me())).toBe(ERROR.NO_ACTOR)
  })

  it('refuses to infer it from a 401 nobody in this project sent', async () => {
    // Basic auth on Caddy, an API gateway, a captive portal on shop wifi: none of them know
    // what an actor is. The PWA acts on NO_ACTOR by replacing the identity, so inferring it
    // from a status alone hands a stranger's 401 the power to end someone's data.
    const proxy = clientAnswering(401, { error: 'unauthorized' })
    expect(await codeOf(proxy.me())).toBe(ISSUE.RESPONSE_INVALID)

    const bare = clientServing(null, { status: 401 })
    expect(await codeOf(bare.me())).toBe(ISSUE.RESPONSE_INVALID)
  })
})

describe('what the client knows about identity', () => {
  it('is nothing at all: there is no way to name an owner', async () => {
    // MOL-53 took the header away with the thing it carried — the owner's own uuid, which was
    // a name and a password in one value. What proves a request now is a cookie the browser
    // attaches and this code cannot read, so there is no option, no getter and no argument
    // here that could speak as anybody.
    const { client, calls } = clientRecording()

    await client.me()

    expect([...(calls[0]?.headers.keys() ?? [])]).not.toContain('x-molvia-actor')
    expect(client).not.toHaveProperty('as')
  })

  it('lets the browser attach its cookies, and says so out loud', async () => {
    // `same-origin` is every browser's default, and it is passed explicitly because since
    // MOL-53 it is the whole of how a request proves who it is: a silent `omit` would log
    // everybody out and nothing here would have noticed.
    const { client, calls } = clientRecording()

    await client.me()

    expect(calls[0]?.credentials).toBe('same-origin')
  })

  it('can be told otherwise, which is what a client outside a browser is', async () => {
    const { client, calls } = clientRecording({ credentials: 'omit' })

    await client.me()

    expect(calls[0]?.credentials).toBe('omit')
  })
})

describe('the first visit', () => {
  it('posts to the development seam, with no body at all', async () => {
    const { client, calls } = clientRecording()

    await client.devLogin()

    expect(calls[0]?.method).toBe('POST')
    // Not `/actors`: the invite door and the handle behind it went together (MOL-52), and
    // what is left exists only outside production. Against a production server this is a 404,
    // and that is the point — the real door is the Telegram login of MOL-54.
    expect(calls[0]?.url).toBe('http://api/dev/login')
  })

  it('hands back the domain entity, with dates rather than the strings on the wire', async () => {
    const { client } = clientRecording()

    const actor = await client.devLogin()

    expect(actor.createdAt).toBeInstanceOf(Date)
    expect(actor.createdAt.toISOString()).toBe(actorWire.createdAt)
    expect(actor.spendCurrency).toBe('AMD')
  })

  it('refuses an answer whose shape is not the contract', async () => {
    const client = clientAnswering(200, { ...actorWire, createdAt: '16.09.2026' })
    expect(await codeOf(client.me())).toBe(ISSUE.RESPONSE_INVALID)
  })
})

describe('the catalogue', () => {
  const entryWire = {
    id: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
    kind: 'product',
    name: 'Молоко «Ашхар»',
    note: 'пастеризованное',
    defaultUnit: 'l',
    typicalQuantity: { value: '0.900', unit: 'l' },
  }

  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; headers: Headers; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    const client = createClient({ baseUrl: 'http://api', fetch })
    return { client, calls }
  }

  it('sends the query exactly as typed, whatever it holds', async () => {
    for (const text of ['молоко', 'Հաց', 'M&M’s', 'соль #2', 'a+b', '100%', '  с пробелами ']) {
      const { client, calls } = clientReplying(200, { items: [], near: false })
      await client.searchCatalogue(text)

      expect(new URL(calls[0]?.url ?? '').searchParams.get('q'), text).toBe(text)
      expect(new URL(calls[0]?.url ?? '').pathname).toBe('/catalogue/search')
    }
  })

  it('hands back entries with the quantity decoded', async () => {
    const { client } = clientReplying(200, { items: [entryWire], near: true })

    const { items, near } = await client.searchCatalogue('молоко')

    expect(items[0]?.typicalQuantity).toEqual({ milli: 900n, unit: 'l' })
    expect(near).toBe(true)
  })

  it('reads an answer that does not say how near it is as near — an API before MOL-46', async () => {
    const { client } = clientReplying(200, { items: [entryWire] })

    expect((await client.searchCatalogue('молоко')).near).toBe(true)
  })

  it('refuses an answer that carries more than the contract — a leak must not pass unread', async () => {
    const leaking = { ...entryWire, createdBy: actorWire.id }
    const { client } = clientReplying(200, { items: [leaking], near: true })

    expect(await codeOf(client.searchCatalogue('молоко'))).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('reads a dead identity from the body, as every other call does', async () => {
    const { client } = clientReplying(401, { code: ERROR.NO_ACTOR })

    expect(await codeOf(client.searchCatalogue('молоко'))).toBe(ERROR.NO_ACTOR)
  })

  it('asks for a code in the query, never in the path (MOL-99)', async () => {
    const { client, calls } = clientReplying(200, { item: entryWire })

    const entry = await client.catalogueByBarcode('4850000000007')

    const url = new URL(calls[0]?.url ?? '')
    expect(url.pathname).toBe('/catalogue/barcode')
    expect(url.searchParams.get('code')).toBe('4850000000007')
    expect(entry?.id).toBe(entryWire.id)
    expect(entry?.typicalQuantity).toEqual({ milli: 900n, unit: 'l' })
  })

  it('hands back null for a code nobody holds', async () => {
    const { client } = clientReplying(200, { item: null })

    expect(await client.catalogueByBarcode('4850000000007')).toBeNull()
  })

  it('refuses a lookup answer that carries more than the contract', async () => {
    const { client } = clientReplying(200, { item: { ...entryWire, barcodes: ['4850000000007'] } })

    expect(await codeOf(client.catalogueByBarcode('4850000000007'))).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('asks for a hint by the code and the language, both in the query (MOL-162)', async () => {
    const { client, calls } = clientReplying(200, {
      hint: {
        name: 'Nutella',
        quantity: { value: '0.400', unit: 'kg' },
        url: 'https://world.openfoodfacts.org/product/3017620422003',
      },
    })

    const hint = await client.catalogueBarcodeHint('3017620422003', 'en')

    const url = new URL(calls[0]?.url ?? '')
    expect(url.pathname).toBe('/catalogue/barcode/hint')
    expect(url.searchParams.get('code')).toBe('3017620422003')
    expect(url.searchParams.get('lang')).toBe('en')
    expect(hint).toEqual({
      name: 'Nutella',
      quantity: { milli: 400n, unit: 'kg' },
      url: 'https://world.openfoodfacts.org/product/3017620422003',
    })
  })

  it('hands back null for no hint, and refuses a hint linking elsewhere', async () => {
    expect(await clientReplying(200, { hint: null }).client.catalogueBarcodeHint('1', 'ru')).toBe(
      null,
    )
    const { client } = clientReplying(200, {
      hint: { name: 'Nutella', quantity: null, url: 'https://evil.example/product/1' },
    })
    expect(await codeOf(client.catalogueBarcodeHint('1', 'ru'))).toBe(ISSUE.RESPONSE_INVALID)
  })

  describe('cancelled by the caller, which the screen does on every keystroke', () => {
    /** A server that answers only when told to, and gives up the way `fetch` does on an abort. */
    function clientHanging(options: { timeoutMs?: number } = {}) {
      const seen: { signal: AbortSignal | undefined }[] = []
      let answer: (() => void) | undefined
      const fetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((resolve, reject) => {
          seen.push({ signal: init?.signal ?? undefined })
          const abort = (): void => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          }
          if (init?.signal?.aborted) abort()
          init?.signal?.addEventListener('abort', abort)
          answer = () => {
            resolve(
              new Response(JSON.stringify({ items: [entryWire], near: true }), { status: 200 }),
            )
          }
        })
      const client = createClient({ baseUrl: 'http://api', fetch, ...options })
      return { client, seen, answer: () => answer?.() }
    }

    it('rejects as an ApiError, not a bare AbortError', async () => {
      const { client } = clientHanging()
      const controller = new AbortController()

      const search = client.searchCatalogue('молоко', { signal: controller.signal })
      controller.abort()

      expect(await codeOf(search)).toBe(ERROR.INTERNAL)
    })

    it('does not wait for the server when the signal was aborted before the call', async () => {
      const { client, seen } = clientHanging()
      const controller = new AbortController()
      controller.abort()

      expect(await codeOf(client.searchCatalogue('молоко', { signal: controller.signal }))).toBe(
        ERROR.INTERNAL,
      )
      expect(seen[0]?.signal?.aborted).toBe(true)
    })

    it('changes nothing once the answer is in', async () => {
      const { client, answer } = clientHanging()
      const controller = new AbortController()

      const search = client.searchCatalogue('молоко', { signal: controller.signal })
      answer()
      const { items: entries } = await search
      controller.abort()

      expect(entries.map((entry) => entry.name)).toEqual([entryWire.name])
    })

    it('keeps the timeout for a caller that passed a signal of its own', async () => {
      const { client } = clientHanging({ timeoutMs: 10 })
      const controller = new AbortController()

      expect(await codeOf(client.searchCatalogue('молоко', { signal: controller.signal }))).toBe(
        ERROR.INTERNAL,
      )
      expect(controller.signal.aborted).toBe(false)
    })

    /** Headers, the start of the body, and then silence — the body errors once its signal is aborted. */
    function clientStallingAfterHeaders(options: { timeoutMs?: number } = {}) {
      const seen: AbortSignal[] = []
      const fetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const signal = init?.signal ?? new AbortController().signal
        seen.push(signal)
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"items":['))
            signal.addEventListener('abort', () => {
              stream.error(new DOMException('aborted', 'AbortError'))
            })
          },
        })
        return Promise.resolve(new Response(body, { status: 200 }))
      }
      const client = createClient({ baseUrl: 'http://api', fetch, ...options })
      return { client, seen }
    }

    it('reaches a body still arriving: the caller cancels after the headers', async () => {
      const { client, seen } = clientStallingAfterHeaders({ timeoutMs: 10_000 })
      const controller = new AbortController()

      const search = client.searchCatalogue('молоко', { signal: controller.signal })
      await new Promise((resolve) => setTimeout(resolve, 10))
      controller.abort()

      expect(await codeOf(search)).toBe(ERROR.INTERNAL)
      expect(seen[0]?.aborted).toBe(true)
    })

    it('keeps the deadline for a body that never ends — a quiet server is not an answer', async () => {
      const { client, seen } = clientStallingAfterHeaders({ timeoutMs: 20 })

      expect(await codeOf(client.searchCatalogue('молоко'))).toBe(ERROR.INTERNAL)
      expect(seen[0]?.aborted).toBe(true)
    })

    it('lets go of the caller’s signal when the call is over', async () => {
      const { client, answer } = clientHanging()
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')

      const search = client.searchCatalogue('молоко', { signal: controller.signal })
      answer()
      await search

      expect(remove.mock.calls.map(([type]) => type)).toEqual(['abort'])
    })
  })

  it('proposes an item as JSON, with the quantity on the wire as a decimal string', async () => {
    const { client, calls } = clientReplying(201, entryWire)

    const result = await client.proposeItem({
      kind: 'product',
      name: 'Молоко «Ашхар»',
      barcodes: ['4850001234567'],
      defaultUnit: 'l',
      typicalQuantity: { milli: 900n, unit: 'l' },
    })

    expect(calls[0]?.method).toBe('POST')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/catalogue/items')
    expect(calls[0]?.headers.get('content-type')).toBe('application/json')
    expect(calls[0]?.body).toEqual({
      kind: 'product',
      name: 'Молоко «Ашхар»',
      barcodes: ['4850001234567'],
      defaultUnit: 'l',
      typicalQuantity: { value: '0.900', unit: 'l' },
    })
    expect(result).toEqual({
      entry: { ...entryWire, typicalQuantity: { milli: 900n, unit: 'l' } },
      created: true,
    })
  })

  it('tells an item already there from a new one by the status', async () => {
    const { client } = clientReplying(200, entryWire)

    const result = await client.proposeItem({
      kind: 'product',
      name: 'молоко «ашхар»',
      barcodes: [],
      defaultUnit: 'l',
    })

    expect(result).toMatchObject({ created: false })
  })

  it('reads «этот код у …» with its 409 as an answer naming the holder (MOL-100)', async () => {
    const { client } = clientReplying(409, { taken: entryWire })

    const result = await client.proposeItem({
      kind: 'product',
      name: 'Сметана',
      barcodes: ['4850001234567'],
      defaultUnit: 'kg',
    })

    expect(result).toEqual({ taken: { ...entryWire, typicalQuantity: { milli: 900n, unit: 'l' } } })
  })

  it('keeps a 409 of the registry a failure — only the holder is an answer', async () => {
    const { client } = clientReplying(409, { code: 'error.conflict' })

    await expect(client.attachBarcode(entryWire.id, '4850001234567')).rejects.toMatchObject({
      code: 'error.conflict',
    })
  })

  it('reads each status by its own schema: «taken» only with 409, the entry only with 2xx (review И)', async () => {
    const takenUnder200 = clientReplying(200, { taken: entryWire })
    const entryUnder409 = clientReplying(409, entryWire)

    await expect(
      takenUnder200.client.attachBarcode(entryWire.id, '4850001234562'),
    ).rejects.toMatchObject({ code: ISSUE.RESPONSE_INVALID })
    await expect(
      entryUnder409.client.attachBarcode(entryWire.id, '4850001234562'),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('writes a code to an item with the code in the body, never the path (MOL-100)', async () => {
    const { client, calls } = clientReplying(201, entryWire)

    const result = await client.attachBarcode(entryWire.id.toUpperCase(), '4850001234567')

    expect(calls[0]?.method).toBe('POST')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/catalogue/items/${entryWire.id}/barcodes`)
    expect(calls[0]?.body).toEqual({ code: '4850001234567' })
    expect(result).toMatchObject({ created: true })
  })

  it('lets a code go with the code in the query, and wants a 204', async () => {
    const { client, calls } = clientReplying(204, undefined)

    await client.detachBarcode(entryWire.id, '4850001234567')

    expect(calls[0]?.method).toBe('DELETE')
    const url = new URL(calls[0]?.url ?? '')
    expect(url.pathname).toBe(`/catalogue/items/${entryWire.id}/barcodes`)
    expect(url.searchParams.get('code')).toBe('4850001234567')
  })

  it('refuses a dish before sending it: the catalogue takes products only until 0.3', async () => {
    const { client, calls } = clientReplying(201, entryWire)

    expect(
      await codeOf(
        client.proposeItem({ kind: 'dish', name: 'Карбонара', defaultUnit: 'piece' } as never),
      ),
    ).toBe(ISSUE.BODY_INVALID)
    expect(calls).toHaveLength(0)
  })
})

describe('the verdict', () => {
  const MILK = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'
  const cardWire = {
    itemId: MILK,
    score: 2,
    review: 'Пахнет крахмалом.\nМясом — нет',
    ratedAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-19T08:30:00.000Z',
  }

  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; headers: Headers; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        body === undefined
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
      )
    }
    const client = createClient({ baseUrl: 'http://api', fetch })
    return { client, calls }
  }

  it('rates by PUT to the item, and tells a first verdict from one replaced', async () => {
    const { client, calls } = clientReplying(201, cardWire)

    const { verdict, created } = await client.rateItem(MILK, {
      score: 2,
      review: 'Пахнет крахмалом.\nМясом — нет',
    })

    expect(calls[0]?.method).toBe('PUT')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/verdicts/${MILK}`)
    expect(calls[0]?.body).toEqual({ score: 2, review: 'Пахнет крахмалом.\nМясом — нет' })
    expect(verdict.ratedAt).toEqual(new Date(cardWire.ratedAt))
    expect(created).toBe(true)

    const again = clientReplying(200, cardWire)
    expect((await again.client.rateItem(MILK, { score: 2 })).created).toBe(false)
  })

  it('erases the text by PATCH with review null — the null goes on the wire', async () => {
    const { client, calls } = clientReplying(200, { ...cardWire, review: null })

    const verdict = await client.amendVerdict(MILK, { review: null })

    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.body).toEqual({ review: null })
    expect(verdict.review).toBeNull()
  })

  it('reads what waits for a verdict, with the day as a Date', async () => {
    const card = {
      itemId: MILK,
      name: 'Молоко Ашхар',
      placeName: 'SAS',
      boughtAt: cardWire.ratedAt,
    }
    const { client, calls } = clientReplying(200, { items: [card], total: 4 })

    const pending = await client.pendingVerdicts()

    expect(calls[0]?.method).toBe('GET')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/verdicts/pending')
    expect(pending).toEqual({ items: [{ ...card, boughtAt: new Date(card.boughtAt) }], total: 4 })
  })

  it('refuses a pending card that grew a price', async () => {
    const card = { itemId: MILK, name: 'Молоко', placeName: 'SAS', boughtAt: cardWire.ratedAt }
    const { client } = clientReplying(200, { items: [{ ...card, amount: '520' }], total: 1 })

    await expect(client.pendingVerdicts()).rejects.toThrow()
  })

  it('withdraws by DELETE and takes the empty 204 as done', async () => {
    const { client, calls } = clientReplying(204, undefined)

    await expect(client.withdrawVerdict(MILK)).resolves.toBeUndefined()
    expect(calls[0]?.method).toBe('DELETE')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/verdicts/${MILK}`)
  })

  it('reports a repeated withdrawal as «not found», for the queue to count as done', async () => {
    const { client } = clientReplying(404, { code: ERROR.NOT_FOUND })

    expect(await codeOf(client.withdrawVerdict(MILK))).toBe(ERROR.NOT_FOUND)
  })

  it('refuses a reply that carries the owner — a leak must not pass unread', async () => {
    const { client } = clientReplying(200, { ...cardWire, actorId: actorWire.id })

    expect(await codeOf(client.rateItem(MILK, { score: 2 }))).toBe(ISSUE.RESPONSE_INVALID)
    expect(await codeOf(client.amendVerdict(MILK, { score: 3 }))).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('sends nothing for an item that is not an identifier, or one that would change the address', async () => {
    const { client, calls } = clientReplying(201, cardWire)

    for (const itemId of ['молоко', '../actors/me', `${MILK}?x=1`, '']) {
      expect(await codeOf(client.rateItem(itemId, { score: 2 })), itemId).toBe(ERROR.NOT_FOUND)
      expect(await codeOf(client.withdrawVerdict(itemId)), itemId).toBe(ERROR.NOT_FOUND)
    }
    expect(calls).toHaveLength(0)
  })

  it('names an extra field the way the server does — by the key, not by an empty path', async () => {
    const { client, calls } = clientReplying(201, cardWire)

    const refusal = client.rateItem(MILK, { score: 2, placeId: MILK } as never)

    await expect(refusal).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    await expect(refusal).rejects.toThrow(`${ISSUE.BODY_INVALID}: placeId`)
    expect(calls).toHaveLength(0)
  })

  it('sends nothing the schema refuses, and names it with the code the server would', async () => {
    const { client, calls } = clientReplying(201, cardWire)

    expect(await codeOf(client.rateItem(MILK, { score: 6 }))).toBe(ISSUE.BODY_INVALID)
    expect(await codeOf(client.amendVerdict(MILK, {}))).toBe(ISSUE.PATCH_EMPTY)
    expect(await codeOf(client.amendVerdict(MILK, { review: 'а\u0007б' }))).toBe(
      ISSUE.TEXT_NOT_VISIBLE,
    )
    expect(await codeOf(client.rateItem(MILK, { score: 3, review: 'раз\n\n\nдва' }))).toBe(
      ISSUE.TEXT_NOT_VISIBLE,
    )
    expect(calls).toHaveLength(0)
  })
})

describe('the trip', () => {
  const TRIP = 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b'
  const EXPENSE = 'aa11bb22-cc33-4d44-8e55-ff6677889900'

  const tripWire = {
    id: TRIP,
    startedAt: '2026-09-19T10:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: { id: 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b', kind: 'store', name: 'Ереван Сити' },
    expenses: [
      {
        id: EXPENSE,
        createdAt: '2026-09-19T10:05:00.000Z',
        item: {
          id: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d',
          kind: 'product',
          name: 'Молоко «Марианна»',
          note: null,
          defaultUnit: 'l',
          typicalQuantity: null,
        },
        quantity: { value: '0.900', unit: 'l' },
        amount: { amount: '520.00', currency: 'AMD' },
        unitPrice: { amount: '577.77777778', currency: 'AMD', unit: 'l' },
      },
    ],
    total: [{ amount: '520.00', currency: 'AMD' }],
    converted: null,
  }

  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
      )
    }
    const client = createClient({ baseUrl: 'http://api', fetch })
    return { client, calls }
  }

  it('starts a trip by the device’s own identifier and tells a new one from a repeat', async () => {
    const body = { id: TRIP, place: { kind: 'store' as const, name: 'Ереван Сити' } }

    const fresh = clientReplying(201, tripWire)
    const repeat = clientReplying(200, tripWire)

    expect((await fresh.client.startTrip(body)).created).toBe(true)
    expect((await repeat.client.startTrip(body)).created).toBe(false)
    expect(fresh.calls[0]).toMatchObject({ method: 'POST', body })
    expect(new URL(fresh.calls[0]?.url ?? '').pathname).toBe('/trips')
  })

  it('reads another open trip as its own code, for the screen to ask', async () => {
    const { client } = clientReplying(409, { code: ERROR.TRIP_OPEN })

    expect(
      await codeOf(client.startTrip({ id: TRIP, place: { kind: 'store', name: 'SAS' } })),
    ).toBe(ERROR.TRIP_OPEN)
  })

  it('hands back the trip decoded: money, quantity and unit price out of their strings', async () => {
    const { client } = clientReplying(200, { trip: tripWire })

    const trip = await client.currentTrip()

    expect(trip?.startedAt).toEqual(new Date('2026-09-19T10:00:00.000Z'))
    expect(trip?.expenses[0]?.unitPrice).toEqual({
      scaledMinor: 57_777_777_778n,
      currency: 'AMD',
      unit: 'l',
    })
    expect(trip?.total).toEqual([{ minor: 52_000n, currency: 'AMD' }])
  })

  it('«no trip» comes back as null', async () => {
    const { client } = clientReplying(200, { trip: null })
    expect(await client.currentTrip()).toBeNull()
  })

  it('refuses a trip that carries more than the contract', async () => {
    const { client } = clientReplying(200, { trip: { ...tripWire, actorId: actorWire.id } })
    expect(await codeOf(client.currentTrip())).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('adds an expense with money and quantity on the wire as decimal strings', async () => {
    const { client, calls } = clientReplying(201, tripWire)

    const { created } = await client.addExpense(TRIP, {
      id: EXPENSE,
      itemId: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d',
      quantity: { milli: 900n, unit: 'l' },
      amount: { minor: 52_000n, currency: 'AMD' },
      query: 'мол',
    })

    expect(created).toBe(true)
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/trips/${TRIP}/expenses`)
    expect(calls[0]?.body).toEqual({
      id: EXPENSE,
      itemId: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d',
      quantity: { value: '0.900', unit: 'l' },
      amount: { amount: '520.00', currency: 'AMD' },
      query: 'мол',
    })
  })

  it('refuses a negative price before sending it', async () => {
    const { client, calls } = clientReplying(201, tripWire)

    expect(
      await codeOf(
        client.addExpense(TRIP, {
          id: EXPENSE,
          itemId: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d',
          amount: { minor: -1n, currency: 'AMD' },
        }),
      ),
      // The code the server would answer for the same body (MOL-27's `encode`).
    ).toBe(ERROR.INVALID_AMOUNT)
    expect(calls).toHaveLength(0)
  })

  it('clears a field with null, and sends nothing for an empty patch', async () => {
    const { client, calls } = clientReplying(200, tripWire)

    await client.updateExpense(TRIP, EXPENSE, { amount: null })
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { amount: null } })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/trips/${TRIP}/expenses/${EXPENSE}`)

    expect(await codeOf(client.updateExpense(TRIP, EXPENSE, {}))).toBe(ISSUE.PATCH_EMPTY)
    expect(calls).toHaveLength(1)
  })

  it('removes an expense and finishes a trip', async () => {
    const removing = clientReplying(200, tripWire)
    await removing.client.removeExpense(TRIP, EXPENSE)
    expect(removing.calls[0]?.method).toBe('DELETE')

    const finishing = clientReplying(204, undefined)
    await expect(finishing.client.finishTrip(TRIP)).resolves.toBeUndefined()
    expect(new URL(finishing.calls[0]?.url ?? '').pathname).toBe(`/trips/${TRIP}/finish`)
  })

  it('removes a trip and brings it back inside its own path segment (MOL-76)', async () => {
    const removal = clientReplying(204, null)
    await removal.client.removeTrip('../actors/me')
    expect(removal.calls[0]?.method).toBe('DELETE')
    expect(new URL(removal.calls[0]?.url ?? '').pathname).toBe('/trips/..%2Factors%2Fme')

    const back = clientReplying(200, tripWire)
    expect((await back.client.restoreTrip(TRIP)).id).toBe(TRIP)
    expect(back.calls[0]?.method).toBe('POST')
    expect(new URL(back.calls[0]?.url ?? '').pathname).toBe(`/trips/${TRIP}/restore`)

    const finishing = clientReplying(200, tripWire)
    await finishing.client.restoreTrip(TRIP, {
      finishedOnDeviceAt: new Date('2026-09-27T10:00:00.000Z'),
    })
    expect(finishing.calls[0]?.body).toEqual({
      finish: { finishedOnDeviceAt: '2026-09-27T10:00:00.000Z' },
    })

    // A portal's page answering the DELETE is not the removal.
    const portal = clientServing('<html>Wi-Fi</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    expect(await codeOf(portal.removeTrip(TRIP))).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('chooses which rate a trip counts by after a jump, and refuses a choice that is not one', async () => {
    const { client, calls } = clientReplying(200, tripWire)

    await client.chooseTripRate(TRIP, { choice: 'previous' })
    await client.chooseTripRate(TRIP, { choice: 'manual', rate: '4.31' })
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { choice: 'previous' } })
    expect(calls[1]?.body).toEqual({ choice: 'manual', rate: '4.31' })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/trips/${TRIP}/rate-choice`)

    // @ts-expect-error — an own rate without the rate is refused before it is sent
    expect(await codeOf(client.chooseTripRate(TRIP, { choice: 'manual' }))).toBe(ISSUE.BODY_INVALID)
    expect(calls).toHaveLength(2)
  })

  it('кладёт сумму по чеку целиком и снимает её null; ноль не уходит (MOL-78)', async () => {
    const { client, calls } = clientReplying(200, tripWire)

    await client.setTripReceipt(TRIP, { receipt: { minor: 1_240_000n, currency: 'AMD' } })
    await client.setTripReceipt(TRIP, { receipt: null })
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      body: { receipt: { amount: '12400.00', currency: 'AMD' } },
    })
    expect(calls[1]?.body).toEqual({ receipt: null })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/trips/${TRIP}/receipt`)

    expect(
      await codeOf(client.setTripReceipt(TRIP, { receipt: { minor: 0n, currency: 'AMD' } })),
    ).toBe(ERROR.INVALID_AMOUNT)
    expect(calls).toHaveLength(2)
  })

  it('keeps an identifier inside its own path segment', async () => {
    const { client, calls } = clientReplying(404, { code: ERROR.NOT_FOUND })

    await codeOf(client.finishTrip('../actors/me?x='))
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/trips/..%2Factors%2Fme%3Fx%3D/finish')
  })

  it('refuses an upper-case identifier before sending it — the reply would name it otherwise', async () => {
    const { client, calls } = clientReplying(201, tripWire)

    expect(
      await codeOf(
        client.startTrip({ id: TRIP.toUpperCase(), place: { kind: 'store', name: 'SAS' } }),
      ),
    ).toBe(ISSUE.BODY_INVALID)
    expect(calls).toHaveLength(0)
  })

  it('lists recent places', async () => {
    const { client } = clientReplying(200, { places: [tripWire.place] })
    expect(await client.recentPlaces()).toEqual([tripWire.place])
  })

  describe('«Что брать»', () => {
    const BEEF = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'
    const MARKET = 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b'

    const beef = {
      level: 'take',
      itemId: BEEF,
      name: 'Говядина, вырезка',
      rating: '4.3',
      ratingsCount: 3,
      review: null,
      isMine: true,
      places: [
        {
          placeId: MARKET,
          name: 'Рынок в Гюмри',
          unitPrice: { amount: '4790.00000000', currency: 'AMD', unit: 'kg' },
          observations: 2,
        },
      ],
    }

    it('reads the three groups and says whose figures they are', async () => {
      const { client, calls } = clientReplying(200, {
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'shared',
        rows: [beef],
        total: 1,
      })

      const answer = await client.advice()

      expect(calls[0]?.method).toBe('GET')
      expect(new URL(calls[0]?.url ?? '').pathname).toBe('/advice')
      expect(answer.scope).toBe('shared')
      expect(answer.total).toBe(1)
      expect(
        answer.rows[0]?.level === 'take' && answer.rows[0].places[0]?.unitPrice.scaledMinor,
      ).toBe(479_000_000_000n)
    })

    it('refuses a «не брать нигде» that arrived with a price', async () => {
      const never = { ...beef, level: 'never', places: undefined }
      const { client } = clientReplying(200, {
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        rows: [{ ...never, places: beef.places }],
      })

      await expect(client.advice()).rejects.toThrow()
    })

    it('searches with the query encoded, and reads a found item without a verdict as null', async () => {
      const { client, calls } = clientReplying(200, {
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        near: true,
        items: [
          { itemId: BEEF, name: beef.name, advice: beef },
          { itemId: MARKET, name: 'Сыр косичка', advice: null },
        ],
      })

      const answer = await client.adviceSearch('сыр & хлеб')

      const url = new URL(calls[0]?.url ?? '')
      expect(url.pathname).toBe('/advice/search')
      expect(url.searchParams.get('q')).toBe('сыр & хлеб')
      expect(answer.items.map((found) => found.advice?.level ?? null)).toEqual(['take', null])
    })

    it('refuses a found item whose row is about another item', async () => {
      const { client } = clientReplying(200, {
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'own',
        near: true,
        items: [{ itemId: MARKET, name: 'Сыр косичка', advice: beef }],
      })

      await expect(client.adviceSearch('сыр')).rejects.toThrow()
    })

    it('asks «Тут дешевле» by the record, or by the city of one still queued (MOL-92)', async () => {
      const zovuni = {
        placeId: MARKET,
        name: 'Зовуни',
        unitPrice: { amount: '540.00000000', currency: 'AMD', unit: 'l' },
        quantity: { value: '1.000', unit: 'l' },
        day: '2026-09-12',
        observations: 1,
      }
      const { client, calls } = clientReplying(200, {
        where: { country: 'AM', city: 'Ереван' },
        prices: { itemId: BEEF, level: 'unrated', places: [zovuni], alternatives: [] },
      })

      const answer = await client.ownPrices({ item: BEEF, trip: MARKET })
      await client.ownPrices({ item: BEEF, country: 'AM', city: 'Ереван', except: MARKET })

      const first = new URL(calls[0]?.url ?? '')
      expect(first.pathname).toBe('/advice/prices')
      expect(Object.fromEntries(first.searchParams)).toEqual({ item: BEEF, trip: MARKET })
      expect(Object.fromEntries(new URL(calls[1]?.url ?? '').searchParams)).toEqual({
        item: BEEF,
        country: 'AM',
        city: 'Ереван',
        except: MARKET,
      })
      expect(answer.where?.city).toBe('Ереван')
      expect(
        answer.prices.level !== 'never' && answer.prices.places[0]?.unitPrice.scaledMinor,
      ).toBe(54_000_000_000n)
    })

    it('asks one’s own «не брать нигде» of the verdicts (MOL-92, Б′)', async () => {
      const { client, calls } = clientReplying(200, { itemIds: [BEEF] })

      expect(await client.ownNever()).toEqual({ itemIds: [BEEF] })
      expect(new URL(calls[0]?.url ?? '').pathname).toBe('/verdicts/never')
    })

    it('refuses a «не брать нигде» that arrived with a price in «Тут дешевле»', async () => {
      const { client } = clientReplying(200, {
        where: null,
        prices: { itemId: BEEF, level: 'never', places: [] },
      })

      await expect(client.ownPrices({ item: BEEF, trip: MARKET })).rejects.toThrow()
    })
  })
})

describe('the exchanges', () => {
  const EXCHANGE = '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d'
  const overviewWire = {
    preference: 'personal',
    pair: { base: 'RUB', quote: 'AMD' },
    wallet: {
      rate: {
        base: 'RUB',
        quote: 'AMD',
        rate: '4.791667',
        source: 'personal',
        asOf: '2026-09-14T20:00:00.000Z',
      },
      basis: 'weighted',
      estimated: false,
    },
    costs: [],
    heldEstimates: [
      { held: { amount: '85000.00', currency: 'AMD' }, whole: true, from: 'exchange' },
    ],
    baseSince: null,
    walletUnknown: null,
    exchanges: [],
    receipts: [],
  }

  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    const client = createClient({ baseUrl: 'http://api', fetch })
    return { client, calls }
  }

  it('reads the screen whole, with the wallet decoded to a rate', async () => {
    const { client, calls } = clientReplying(200, overviewWire)
    const overview = await client.exchanges()
    expect(overview.wallet?.rate.scaled).toBe(4_791_667n)
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/exchanges')
  })

  it('records an exchange and tells a new one from a repeat', async () => {
    const body = {
      id: EXCHANGE,
      given: { minor: 2_000_000n, currency: 'RUB' as const },
      received: { minor: 9_500_000n, currency: 'AMD' as const },
      exchangedOn: '2026-09-15',
    }
    const fresh = clientReplying(201, overviewWire)
    expect((await fresh.client.recordExchange(body)).created).toBe(true)
    expect(fresh.calls[0]).toMatchObject({
      method: 'POST',
      body: {
        id: EXCHANGE,
        given: { amount: '20000.00', currency: 'RUB' },
        received: { amount: '95000.00', currency: 'AMD' },
        exchangedOn: '2026-09-15',
      },
    })

    const repeat = clientReplying(200, overviewWire)
    expect((await repeat.client.recordExchange(body)).created).toBe(false)
  })

  it('amends an exchange inside its own path segment, over the version it was opened on', async () => {
    const { client, calls } = clientReplying(200, overviewWire)
    await client.amendExchange(EXCHANGE, {
      revision: 2,
      given: { minor: 2_000_000n, currency: 'RUB' },
      received: { minor: 9_500_000n, currency: 'AMD' },
      exchangedOn: '2026-09-15',
      note: 'ВТБ',
    })
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      body: {
        revision: 2,
        given: { amount: '20000.00', currency: 'RUB' },
        received: { amount: '95000.00', currency: 'AMD' },
        note: 'ВТБ',
      },
    })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/exchanges/${EXCHANGE}`)
  })

  it('refuses an exchange of one currency before sending it', async () => {
    const { client, calls } = clientReplying(201, overviewWire)
    const same = {
      id: EXCHANGE,
      given: { minor: 100n, currency: 'AMD' as const },
      received: { minor: 100n, currency: 'AMD' as const },
      exchangedOn: '2026-09-15',
    }
    expect(await codeOf(client.recordExchange(same))).toBe(ISSUE.EXCHANGE_SAME_CURRENCY)
    expect(calls).toHaveLength(0)
  })

  it('removes an exchange inside its own path segment, and switches the preference', async () => {
    const { client, calls } = clientReplying(200, overviewWire)
    await client.removeExchange('../actors/me')
    await client.chooseRatePreference('official')
    expect(calls[0]?.method).toBe('DELETE')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/exchanges/..%2Factors%2Fme')
    expect(calls[1]).toMatchObject({ method: 'PUT', body: { preference: 'official' } })
    expect(new URL(calls[1]?.url ?? '').pathname).toBe('/actors/me/rate-preference')
    await client.restoreExchange(EXCHANGE)
    expect(calls[2]?.method).toBe('POST')
    expect(new URL(calls[2]?.url ?? '').pathname).toBe(`/exchanges/${EXCHANGE}/restore`)
  })
})

describe('the incomes (MOL-66)', () => {
  const INCOME = '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d'
  const overviewWire = {
    base: 'RUB',
    baseSince: null,
    months: [
      {
        month: '2026-09',
        sums: [{ amount: '99615.00', currency: 'RUB' }],
        incomes: [
          {
            id: INCOME,
            receivedOn: '2026-09-15',
            amount: { amount: '99615.00', currency: 'RUB' },
            heldBefore: null,
            source: 'salary',
            note: null,
            revision: 1,
            amendedAt: null,
            history: [],
          },
        ],
      },
    ],
    receipts: [{ id: INCOME, currency: 'RUB', on: '2026-09-15', priced: false }],
    heldEstimates: [],
  }

  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return { client: createClient({ baseUrl: 'http://api', fetch }), calls }
  }

  const body = {
    id: INCOME,
    amount: { minor: 9_961_500n, currency: 'RUB' as const },
    receivedOn: '2026-09-15',
    source: 'salary' as const,
  }

  it('reads the screen whole, with the sums decoded to money', async () => {
    const { client, calls } = clientReplying(200, overviewWire)
    const overview = await client.incomes()
    expect(overview.months[0]?.sums).toEqual([{ minor: 9_961_500n, currency: 'RUB' }])
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/incomes')
  })

  it('records an income and tells a new one from a repeat', async () => {
    const fresh = clientReplying(201, overviewWire)
    expect((await fresh.client.recordIncome(body)).created).toBe(true)
    expect(fresh.calls[0]).toMatchObject({
      method: 'POST',
      body: {
        id: INCOME,
        amount: { amount: '99615.00', currency: 'RUB' },
        receivedOn: '2026-09-15',
        source: 'salary',
      },
    })
    const repeat = clientReplying(200, overviewWire)
    expect((await repeat.client.recordIncome(body)).created).toBe(false)
  })

  it('refuses a remainder in another currency before sending it', async () => {
    const { client, calls } = clientReplying(201, overviewWire)
    const held = { ...body, heldBefore: { minor: 100n, currency: 'AMD' as const } }
    expect(await codeOf(client.recordIncome(held))).toBe(ISSUE.INCOME_HELD_NOT_RECEIVED)
    expect(calls).toHaveLength(0)
  })

  it('amends, removes and brings back inside its own path segment', async () => {
    const { client, calls } = clientReplying(200, overviewWire)
    const { amount, receivedOn, source } = body
    await client.amendIncome(INCOME, { amount, receivedOn, source, revision: 1, note: 'Викаса' })
    await client.removeIncome('../actors/me')
    await client.restoreIncome(INCOME)
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { revision: 1, note: 'Викаса' } })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/incomes/${INCOME}`)
    expect(calls[1]?.method).toBe('DELETE')
    expect(new URL(calls[1]?.url ?? '').pathname).toBe('/incomes/..%2Factors%2Fme')
    expect(calls[2]?.method).toBe('POST')
    expect(new URL(calls[2]?.url ?? '').pathname).toBe(`/incomes/${INCOME}/restore`)
  })
})

describe('«Деньги» (MOL-82)', () => {
  const SPENDING = '4b0e7a1c-2d3f-4a5b-9c6d-7e8f9a0b1c2d'
  const CATEGORY = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  const amount = { amount: '5000.00', currency: 'AMD' }
  const spendingWire = {
    id: SPENDING,
    spentOn: '2026-09-20',
    amount,
    categoryId: CATEGORY,
    note: 'Барбер',
    place: null,
    rate: null,
    revision: 1,
    amendedAt: null,
  }
  const categoriesWire = {
    categories: [{ id: CATEGORY, preset: 'beauty', name: null, colour: null, archived: false }],
  }
  const monthWire = {
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: amount,
    uncounted: [],
    foreign: [],
    spentIncome: null,
    income: { amount: '0.00', currency: 'RUB' },
    incomeUncounted: [],
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    rate: null,
    rateKind: 'live',
    previousSpent: null,
    byCategory: [{ categoryId: CATEGORY, amount }],
    categories: categoriesWire.categories,
    days: [
      {
        day: '2026-09-20',
        total: amount,
        estimated: false,
        entries: [{ kind: 'manual', spending: spendingWire, counted: amount }],
      },
    ],
    cursor: `2026-09-20~1758355200000~${SPENDING}`,
    remaining: 3,
    remainingFrom: '2026-09-02',
    remainingTo: '2026-09-17',
  }

  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
      )
    }
    return { client: createClient({ baseUrl: 'http://api', fetch }), calls }
  }

  const body = {
    id: SPENDING,
    spentOn: '2026-09-20',
    amount: { minor: 500_000n, currency: 'AMD' as const },
    categoryId: CATEGORY,
    note: 'Барбер',
  }

  it('reads a month and the next page by the key of the last row', async () => {
    const { client, calls } = clientReplying(200, monthWire)
    const month = await client.moneyMonth('2026-09')
    expect(month.spent).toEqual({ minor: 500_000n, currency: 'AMD' })
    expect(month.cursor).toEqual({ day: '2026-09-20', moment: 1758355200000, id: SPENDING })
    await client.moneyMonth('2026-09', month.cursor ?? undefined)
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/money/months/2026-09')
    expect(new URL(calls[1]?.url ?? '').searchParams.get('cursor')).toBe(monthWire.cursor)
  })

  it('reads «Графики → Год» (MOL-160) by the year in the path, and asks nothing for no year', async () => {
    const { client, calls } = clientReplying(200, {})
    await expect(client.moneyChartYear('2026')).rejects.toThrow()
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/money/years/2026/charts')

    const { client: none, calls: asked } = clientReplying(200, {})
    await expect(none.moneyChartYear('26')).rejects.toMatchObject({ code: 'error.not_found' })
    expect(asked).toHaveLength(0)
  })

  it('reads «Бюджет» (MOL-117) of a month, and asks nothing for a month that is none', async () => {
    const { client, calls } = clientReplying(200, {})
    await expect(client.moneyBudget('2026-09')).rejects.toThrow()
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/money/months/2026-09/budget')

    const { client: none, calls: asked } = clientReplying(200, {})
    await expect(none.moneyBudget('../actors')).rejects.toMatchObject({ code: 'error.not_found' })
    expect(asked).toHaveLength(0)
  })

  it('sends a plan as the wire says it — a sum as a decimal string, a percent whole', async () => {
    const { client, calls } = clientReplying(200, {})
    await expect(
      client.setBudgetPlan({
        categoryId: CATEGORY,
        from: '2026-10',
        plan: { kind: 'amount', amount: { minor: 25_000_000n, currency: 'AMD' } },
      }),
    ).rejects.toThrow()
    await expect(
      client.setBudgetPlan({
        categoryId: null,
        from: '2026-10',
        plan: { kind: 'share', percent: 25 },
      }),
    ).rejects.toThrow()
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      body: {
        categoryId: CATEGORY,
        from: '2026-10',
        plan: { kind: 'amount', amount: { amount: '250000.00', currency: 'AMD' } },
      },
    })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/budget/plans')
    expect(calls[1]?.body).toEqual({
      categoryId: null,
      from: '2026-10',
      plan: { kind: 'share', percent: 25 },
    })
  })

  it('reads and saves «зарплата с … числа» (MOL-134) at its own address, off as null', async () => {
    const { client, calls } = clientReplying(200, { day: 25 })
    expect(await client.salaryShift()).toEqual({ day: 25 })
    expect(await client.chooseSalaryShift(25)).toEqual({ day: 25 })
    expect(calls[0]?.method).toBe('GET')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/actors/me/salary-shift')
    expect(calls[1]).toMatchObject({ method: 'PUT', body: { day: 25 } })
    expect(new URL(calls[1]?.url ?? '').pathname).toBe('/actors/me/salary-shift')
  })

  it('refuses an answer outside the days of a month, as off the contract', async () => {
    const { client } = clientReplying(200, { day: 32 })
    await expect(client.salaryShift()).rejects.toThrow()
  })

  it('never sends a month that is not one', async () => {
    const { client, calls } = clientReplying(200, monthWire)
    for (const month of ['2026-13', '../actors', '2026-9', ''])
      expect(await codeOf(client.moneyMonth(month))).toBe(ERROR.NOT_FOUND)
    expect(calls).toHaveLength(0)
  })

  it('records a spending and tells a new one from a repeat', async () => {
    const fresh = clientReplying(201, spendingWire)
    expect((await fresh.client.recordSpending(body)).created).toBe(true)
    expect(fresh.calls[0]).toMatchObject({
      method: 'POST',
      body: { id: SPENDING, amount, spentOn: '2026-09-20', categoryId: CATEGORY },
    })
    const repeat = clientReplying(200, spendingWire)
    expect((await repeat.client.recordSpending(body)).created).toBe(false)
  })

  it('amends, removes and brings back inside its own path segment', async () => {
    const { client, calls } = clientReplying(200, spendingWire)
    const { spentOn, categoryId } = body
    await client.amendSpending(SPENDING, { revision: 1, spentOn, categoryId, amount: body.amount })
    await client.restoreSpending(SPENDING)
    await client.spending(SPENDING)
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { revision: 1 } })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/spendings/${SPENDING}`)
    expect(new URL(calls[1]?.url ?? '').pathname).toBe(`/spendings/${SPENDING}/restore`)
    expect(calls[2]?.method).toBe('GET')
    expect(new URL(calls[2]?.url ?? '').pathname).toBe(`/spendings/${SPENDING}`)

    const removal = clientReplying(204, null)
    await removal.client.removeSpending('../actors/me')
    expect(removal.calls[0]?.method).toBe('DELETE')
    expect(new URL(removal.calls[0]?.url ?? '').pathname).toBe('/spendings/..%2Factors%2Fme')
  })

  it('takes a removal for done on 204 only — a portal page is not the API', async () => {
    for (const client of [
      clientServing('<html>Wi-Fi</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
      clientServing(null, { status: 200 }),
    ])
      expect(await codeOf(client.removeSpending(SPENDING))).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('lists, adds, removes and brings back a category', async () => {
    const { client, calls } = clientReplying(200, categoriesWire)
    expect((await client.spendingCategories()).categories[0]?.preset).toBe('beauty')
    expect((await client.addSpendingCategory({ id: CATEGORY, name: 'Такси' })).created).toBe(false)
    await client.archiveSpendingCategory(CATEGORY)
    await client.restoreSpendingCategory(CATEGORY)
    expect(calls.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      'GET /spending-categories',
      'POST /spending-categories',
      `DELETE /spending-categories/${CATEGORY}`,
      `POST /spending-categories/${CATEGORY}/restore`,
    ])
  })
})

describe('«Счета» (MOL-123)', () => {
  const ACCOUNT = '5c1f8b2d-3e4a-4b6c-8d7e-9f0a1b2c3d4e'
  const TRIP = '6d2a9c3e-4f5b-4c7d-9e8f-0a1b2c3d4e5f'
  const cash = { amount: '190132.00', currency: 'AMD' }
  const accountWire = {
    id: ACCOUNT,
    name: 'Наличные ֏',
    currency: 'AMD',
    savings: false,
    start: { amount: '241530.00', currency: 'AMD' },
    startOn: '2026-09-16',
    balance: cash,
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: true,
    archivedAt: null,
    revision: 1,
  }
  const overviewWire = {
    spendCurrency: 'AMD',
    accounts: [accountWire],
    totals: {
      total: cash,
      spendable: cash,
      savings: { amount: '0.00', currency: 'AMD' },
      uncounted: 0,
    },
    unassigned: 2,
    countedAt: '2026-09-27T10:05:00.000Z',
  }
  const rowWire = {
    kind: 'spending',
    id: '7e3b0d4f-5a6c-4d8e-8f9a-1b2c3d4e5f6a',
    side: null,
    day: '2026-09-21',
    at: '2026-09-21T09:00:00.000Z',
    accountId: ACCOUNT,
    amounts: [{ amount: '-3932.00', currency: 'AMD' }],
    moved: { amount: '-3932.00', currency: 'AMD' },
    approximate: false,
    debited: null,
    inBalance: true,
    unpriced: 0,
    revision: 2,
    items: null,
    categoryId: null,
    note: 'Кофе',
    place: null,
    source: null,
    counterpart: null,
  }

  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return { client: createClient({ baseUrl: 'http://api', fetch }), calls }
  }

  const body = {
    name: 'Наличные ֏',
    currency: 'AMD' as const,
    savings: false,
    start: { minor: 24_153_000n, currency: 'AMD' as const },
    startOn: '2026-09-16',
  }

  it('reads the page and tells a new account from a repeat', async () => {
    const read = clientReplying(200, overviewWire)
    const page = await read.client.moneyAccounts()
    expect(page.accounts[0]?.balance).toEqual({ minor: 19_013_200n, currency: 'AMD' })
    expect(page.countedAt).toEqual(new Date('2026-09-27T10:05:00.000Z'))

    const fresh = clientReplying(201, overviewWire)
    expect((await fresh.client.addMoneyAccount({ id: ACCOUNT, ...body })).created).toBe(true)
    expect(fresh.calls[0]).toMatchObject({
      method: 'POST',
      body: { id: ACCOUNT, start: { amount: '241530.00', currency: 'AMD' } },
    })
    const repeat = clientReplying(200, overviewWire)
    expect((await repeat.client.addMoneyAccount({ id: ACCOUNT, ...body })).created).toBe(false)
  })

  it('amends, removes and brings back inside its own path segment', async () => {
    const { client, calls } = clientReplying(200, overviewWire)
    await client.amendMoneyAccount(ACCOUNT, { revision: 1, ...body })
    await client.removeMoneyAccount('../actors/me')
    await client.restoreMoneyAccount(ACCOUNT)
    expect(calls.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      `PUT /money/accounts/${ACCOUNT}`,
      'DELETE /money/accounts/..%2Factors%2Fme',
      `POST /money/accounts/${ACCOUNT}/restore`,
    ])
    expect(calls[0]?.body).toMatchObject({ revision: 1 })
  })

  it('reads a journal by the key of the last row, and «не попали»', async () => {
    const journal = clientReplying(200, { account: accountWire, rows: [rowWire], cursor: null })
    const page = await journal.client.accountJournal(ACCOUNT, {
      day: '2026-09-21',
      moment: 1758445200000,
      id: rowWire.id,
    })
    expect(page.rows[0]?.revision).toBe(2)
    const url = new URL(journal.calls[0]?.url ?? '')
    expect(url.pathname).toBe(`/money/accounts/${ACCOUNT}/journal`)
    expect(url.searchParams.get('cursor')).toBe(`2026-09-21~1758445200000~${rowWire.id}`)

    const unassigned = clientReplying(200, { rows: [{ ...rowWire, accountId: null, moved: null }] })
    expect((await unassigned.client.unassignedOperations()).rows).toHaveLength(1)
    expect(new URL(unassigned.calls[0]?.url ?? '').pathname).toBe('/money/accounts/unassigned')
  })

  it('sends a check and the hint of what was held', async () => {
    const check = clientReplying(200, {
      id: ACCOUNT,
      checkedOn: '2026-09-26',
      fact: { amount: '185000.00', currency: 'AMD' },
      counted: cash,
      difference: { amount: '-5132.00', currency: 'AMD' },
      approximate: false,
      since: '2026-09-16',
      reasons: [{ kind: 'unassigned', operation: { ...rowWire, accountId: null } }],
    })
    const result = await check.client.checkAccount(ACCOUNT, {
      id: ACCOUNT,
      fact: { minor: 18_500_000n, currency: 'AMD' },
    })
    expect(result.difference.minor).toBe(-513_200n)
    expect(check.calls[0]).toMatchObject({
      method: 'POST',
      body: { fact: { amount: '185000.00', currency: 'AMD' } },
    })

    const held = clientReplying(200, { held: null, approximate: false })
    await held.client.accountsHeld({ currency: 'RUB', day: '2026-09-25', except: ACCOUNT })
    const url = new URL(held.calls[0]?.url ?? '')
    expect(url.pathname).toBe('/money/accounts/held')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      currency: 'RUB',
      day: '2026-09-25',
      except: ACCOUNT,
    })
  })

  it('puts the account of a trip whole', async () => {
    const { client, calls } = clientReplying(200, {})
    expect(
      await codeOf(
        client.payTrip(TRIP, {
          accountId: ACCOUNT,
          debited: { minor: 214_091n, currency: 'RUB' },
        }),
      ),
    ).toBe(ISSUE.RESPONSE_INVALID)
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      body: { accountId: ACCOUNT, debited: { amount: '2140.91', currency: 'RUB' } },
    })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/trips/${TRIP}/payment`)
  })
})

describe('«Скачать мои данные» (MOL-93)', () => {
  const file = {
    format: 'molvia-export',
    version: 1,
    exportedAt: '2026-10-12T08:14:03.000Z',
    account: { id: actorWire.id, telegramUserId: 510_000_001 },
    spendings: [{ amount: { amount: '5000.00', currency: 'AMD' }, fieldOfTomorrow: true }],
  }

  it('hands over the file whole, a field this build does not know included', async () => {
    const { text, exportedAt } = await clientAnswering(200, file).exportMine()

    expect(JSON.parse(text)).toEqual(file)
    expect(text).toContain('\n  "format": "molvia-export"')
    expect(exportedAt).toEqual(new Date('2026-10-12T08:14:03.000Z'))
  })

  it('refuses a page that is not the file — a portal answering 200 is not a copy', async () => {
    expect(await codeOf(clientServing('<html>Wi-Fi</html>', { status: 200 }).exportMine())).toBe(
      ISSUE.RESPONSE_INVALID,
    )
    expect(await codeOf(clientAnswering(200, { ...file, format: 'other' }).exportMine())).toBe(
      ISSUE.RESPONSE_INVALID,
    )
  })

  it('asks by the path alone — no owner is named', async () => {
    const { client, calls } = clientRecording()

    await client.exportMine().catch(() => undefined)

    expect(calls.map((call) => call.url)).toEqual(['http://api/actors/me/export'])
  })
})

describe('«Написать разработчику» (MOL-147)', () => {
  function clientReplying(status: number, body: unknown) {
    const calls: { url: string; method: string; body: unknown }[] = []
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return { client: createClient({ baseUrl: 'http://api', fetch }), calls }
  }

  const message = {
    kind: 'bug' as const,
    text: 'Не открывается «Деньги»',
    locale: 'ru' as const,
    pageBuild: null,
    route: 'money',
    platform: 'ios 18 app',
    fromError: true,
    errorCode: 'error.internal',
    clientKey: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  }

  it('sends the message as the sheet shows it, and tells a new one from a repeat', async () => {
    const fresh = clientReplying(201, { number: 42 })
    expect(await fresh.client.sendFeedback(message)).toEqual({
      sent: { number: 42 },
      created: true,
    })
    expect(fresh.calls[0]).toEqual({ url: 'http://api/feedback', method: 'POST', body: message })

    const repeat = clientReplying(200, { number: 42 })
    expect((await repeat.client.sendFeedback(message)).created).toBe(false)
  })

  it('rejects past the day’s limit with its own code', async () => {
    const { client } = clientReplying(429, { code: ERROR.FEEDBACK_RATE_LIMITED })
    expect(await codeOf(client.sendFeedback(message))).toBe(ERROR.FEEDBACK_RATE_LIMITED)
  })

  it('sends nothing the schema refuses — an empty text', async () => {
    const { client, calls } = clientReplying(201, { number: 1 })
    expect(await codeOf(client.sendFeedback({ ...message, text: '  ' }))).toBe(
      ISSUE.TEXT_NOT_VISIBLE,
    )
    expect(calls).toHaveLength(0)
  })
})

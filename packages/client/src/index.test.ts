import { describe, expect, it } from 'vitest'
import { ACTOR_HEADER, ERROR, INVITE_HEADER, ISSUE } from '@molvia/model'
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
function clientRecording(options: { actorId?: () => string | null } = {}) {
  const calls: { url: string; method: string; headers: Headers }[] = []
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
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

    const actor = await client.createActor('let-me-in')

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

  it('and telling «not found» apart from the rest without reading a message', async () => {
    const client = clientServing('<html>nginx</html>', { status: 404 })
    expect(await codeOf(client.me())).toBe(ERROR.NOT_FOUND)
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

describe('the identity the client speaks for', () => {
  it('is read at call time, not captured when the client is built', async () => {
    // The PWA builds the client before it has an identity; a value captured here would be
    // null for the rest of the session.
    let id: string | null = null
    const { client, calls } = clientRecording({ actorId: () => id })

    id = actorWire.id
    await client.me()

    expect(calls[0]?.headers.get(ACTOR_HEADER)).toBe(actorWire.id)
  })

  it('is left off entirely when there is none, rather than sent as «null»', async () => {
    const { client, calls } = clientRecording({ actorId: () => null })

    await client.me()

    expect(calls[0]?.headers.has(ACTOR_HEADER)).toBe(false)
  })

  it('is never stored here: without a getter there is no header at all', async () => {
    const { client, calls } = clientRecording()

    await client.me()

    expect(calls[0]?.headers.has(ACTOR_HEADER)).toBe(false)
  })

  it('can be asked about one identifier without adopting it', async () => {
    // "Is this old key still alive?" has to be answerable without touching what the client
    // currently speaks for — otherwise checking and committing are the same act, and a
    // check that fails has already thrown away the identity in use (Р-1).
    const { client, calls } = clientRecording({
      actorId: () => 'b1b1b1b1-1111-4111-8111-111111111111',
    })

    await client.me(actorWire.id)

    expect(calls[0]?.headers.get(ACTOR_HEADER)).toBe(actorWire.id)
  })

  it('is refused rather than crashing the call when it cannot become a header', async () => {
    // `localStorage` is a string bucket anyone can write to. A value with a line break used
    // to take the whole call down as a TypeError from `Headers.set`, which the store reads
    // as «the server did not answer» — a value that cannot be sent names no subject.
    const client = createClient({
      baseUrl: 'http://api',
      fetch: () => Promise.resolve(new Response(JSON.stringify(actorWire), { status: 200 })),
      actorId: () => 'abc\r\nX-Molvia-Actor: 9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
    })

    expect(await codeOf(client.me())).toBe(ERROR.NO_ACTOR)
  })
})

describe('the first visit', () => {
  it('posts with the invite code and no body at all', async () => {
    const { client, calls } = clientRecording()

    await client.createActor('let-me-in')

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('http://api/actors')
    expect(calls[0]?.headers.get(INVITE_HEADER)).toBe('let-me-in')
  })

  it('hands back the domain entity, with dates rather than the strings on the wire', async () => {
    const { client } = clientRecording()

    const actor = await client.createActor('let-me-in')

    expect(actor.createdAt).toBeInstanceOf(Date)
    expect(actor.createdAt.toISOString()).toBe(actorWire.createdAt)
    expect(actor.spendCurrency).toBe('AMD')
  })

  it('refuses a code that cannot be sent, instead of throwing a TypeError', async () => {
    // molvia.com/?c=код — a code that came out of a keyboard rather than out of
    // `openssl rand -hex`. The door would refuse it anyway; what matters is that the person
    // is told it is the link, not the server.
    const { client } = clientRecording()

    expect(await codeOf(client.createActor('приглашение'))).toBe(ERROR.NO_ACTOR)
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
    const client = createClient({ baseUrl: 'http://api', fetch, actorId: () => actorWire.id })
    return { client, calls }
  }

  it('sends the query exactly as typed, whatever it holds', async () => {
    for (const text of ['молоко', 'Հաց', 'M&M’s', 'соль #2', 'a+b', '100%', '  с пробелами ']) {
      const { client, calls } = clientReplying(200, { items: [] })
      await client.searchCatalogue(text)

      expect(new URL(calls[0]?.url ?? '').searchParams.get('q'), text).toBe(text)
      expect(new URL(calls[0]?.url ?? '').pathname).toBe('/catalogue/search')
    }
  })

  it('hands back entries with the quantity decoded', async () => {
    const { client } = clientReplying(200, { items: [entryWire] })

    const [entry] = await client.searchCatalogue('молоко')

    expect(entry?.typicalQuantity).toEqual({ milli: 900n, unit: 'l' })
  })

  it('refuses an answer that carries more than the contract — a leak must not pass unread', async () => {
    const leaking = { ...entryWire, createdBy: actorWire.id }
    const { client } = clientReplying(200, { items: [leaking] })

    expect(await codeOf(client.searchCatalogue('молоко'))).toBe(ISSUE.RESPONSE_INVALID)
  })

  it('reads a dead identity from the body, as every other call does', async () => {
    const { client } = clientReplying(401, { code: ERROR.NO_ACTOR })

    expect(await codeOf(client.searchCatalogue('молоко'))).toBe(ERROR.NO_ACTOR)
  })

  it('proposes an item as JSON, with the quantity on the wire as a decimal string', async () => {
    const { client, calls } = clientReplying(201, entryWire)

    const result = await client.proposeItem({
      kind: 'product',
      name: 'Молоко «Ашхар»',
      defaultUnit: 'l',
      typicalQuantity: { milli: 900n, unit: 'l' },
    })

    expect(calls[0]?.method).toBe('POST')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/catalogue/items')
    expect(calls[0]?.headers.get('content-type')).toBe('application/json')
    expect(calls[0]?.headers.get(ACTOR_HEADER)).toBe(actorWire.id)
    expect(calls[0]?.body).toEqual({
      kind: 'product',
      name: 'Молоко «Ашхар»',
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
      defaultUnit: 'l',
    })

    expect(result.created).toBe(false)
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

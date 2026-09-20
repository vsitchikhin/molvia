import { describe, expect, it, vi } from 'vitest'
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
  sharedUntil: null,
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
            resolve(new Response(JSON.stringify({ items: [entryWire] }), { status: 200 }))
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
      const entries = await search
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
    const client = createClient({ baseUrl: 'http://api', fetch, actorId: () => actorWire.id })
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
    expect(calls[0]?.headers.get(ACTOR_HEADER)).toBe(actorWire.id)
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

    for (const itemId of ['молоко', '../actors/me', `${MILK}?x=1`, '', MILK.toUpperCase()]) {
      expect(await codeOf(client.rateItem(itemId, { score: 2 })), itemId).toBe(ISSUE.PATH_INVALID)
      expect(await codeOf(client.withdrawVerdict(itemId)), itemId).toBe(ISSUE.PATH_INVALID)
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
    const client = createClient({ baseUrl: 'http://api', fetch, actorId: () => actorWire.id })
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
      const { client, calls } = clientReplying(200, { scope: 'shared', rows: [beef] })

      const answer = await client.advice()

      expect(calls[0]?.method).toBe('GET')
      expect(new URL(calls[0]?.url ?? '').pathname).toBe('/advice')
      expect(answer.scope).toBe('shared')
      expect(
        answer.rows[0]?.level === 'take' && answer.rows[0].places[0]?.unitPrice.scaledMinor,
      ).toBe(479_000_000_000n)
    })

    it('refuses a «не брать нигде» that arrived with a price', async () => {
      const never = { ...beef, level: 'never', places: undefined }
      const { client } = clientReplying(200, {
        scope: 'own',
        rows: [{ ...never, places: beef.places }],
      })

      await expect(client.advice()).rejects.toThrow()
    })
  })
})

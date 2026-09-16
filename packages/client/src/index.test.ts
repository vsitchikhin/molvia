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

/** Keeps what the client actually sent, which is the half a mocked reply cannot show. */
function clientRecording(options: { actorId?: () => string | null } = {}) {
  const calls: { url: string; method: string; headers: Headers }[] = []
  // The client always calls with a string url; `Request` would stringify to «[object
  // Object]» and quietly compare against nothing, so it is narrowed rather than coerced.
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

  it('and telling «not found» apart from «the server broke» without reading a message', async () => {
    const client = clientAnswering(404, '<html>nginx</html>')
    expect(await codeOf(client.health())).toBe(ERROR.NOT_FOUND)
    const broken = clientAnswering(500, '<html>nginx</html>')
    expect(await codeOf(broken.health())).toBe(ERROR.INTERNAL)
  })

  it('and reading a bodyless 401 as «no actor», which is what the PWA acts on', async () => {
    // The identity is gone — cleared storage, a recreated database — and the PWA decides to
    // start a new one from exactly this code. A bare 500 would send it down the wrong path.
    const client = clientAnswering(401, '<html>nginx</html>')
    expect(await codeOf(client.me())).toBe(ERROR.NO_ACTOR)
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

  it('refuses an answer whose shape is not the contract', async () => {
    const client = clientAnswering(200, { ...actorWire, createdAt: '16.09.2026' })
    expect(await codeOf(client.me())).toBe(ISSUE.RESPONSE_INVALID)
  })
})

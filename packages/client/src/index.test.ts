import { describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '@molvia/model'
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

  it('and passes a good answer through', async () => {
    const client = clientAnswering(200, { status: 'ok', version: '1.0.0', database: 'up' })
    await expect(client.health()).resolves.toEqual({
      status: 'ok',
      version: '1.0.0',
      database: 'up',
    })
  })
})

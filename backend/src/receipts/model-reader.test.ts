import { describe, expect, it } from 'vitest'
import type { ModelReceipt } from '@molvia/model'
import { ModelRejected, ModelUnavailable, receiptModel } from './model-reader'

// The reader against a fake of the Messages API: what goes out, and each way an answer comes back.

function jpeg(width: number, height: number): Buffer {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff]
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
  return Buffer.from([
    ...[0xff, 0xd8],
    ...sof,
    ...Array.from({ length: 10 }, () => 0),
    ...sos,
    ...Array.from({ length: 16 }, () => 0x55),
    ...[0xff, 0xd9],
  ])
}

const ANSWER: ModelReceipt = {
  shop: 'Խանութ «Օրինակ»',
  address: 'Գորկու 1, Գյումրի',
  tin: '01234567',
  receipt_no: '1',
  date: '2026-10-08',
  time: '19:57',
  lines: [
    {
      printed: 'Կաթ',
      code: '0401',
      article: '1163909',
      quantity: '2',
      unit: 'pcs',
      unit_price: '370',
      discount: null,
      sum: '740',
    },
  ],
  totals: [{ label: 'Ընդամենը', amount: '740.00' }],
}

interface Sent {
  readonly headers: Headers
  readonly body: Record<string, unknown>
}

function api(answer: (sent: Sent) => Response): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  const fake = ((_input: unknown, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '{}'
    const one = {
      headers: new Headers(init?.headers),
      body: JSON.parse(body) as Record<string, unknown>,
    }
    sent.push(one)
    return Promise.resolve(answer(one))
  }) as typeof fetch
  return { fetch: fake, sent }
}

const message = (over: Record<string, unknown> = {}): Response =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: JSON.stringify(ANSWER) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 5_321, output_tokens: 2_242 },
    ...over,
  })

const failing = (status: number): Response =>
  Response.json({ type: 'error', error: { type: 'x', message: 'nope' } }, { status })

const model = (fake: typeof fetch, workspaceId?: string) =>
  receiptModel({ apiKey: 'sk-ant-test', workspaceId, fetch: fake, maxRetries: 0 })

describe('the model that reads receipts (MOL-272)', () => {
  it('sends every part in one message, by the schema, at medium effort, with the workspace named', async () => {
    const { fetch, sent } = api(() => message())
    const got = await model(fetch, 'wrkspc_1').read([jpeg(1_000, 3_000), jpeg(1_000, 2_000)])
    expect(got).toEqual({ kind: 'read', answer: ANSWER, costMicroUsd: 1_654 })
    const [one] = sent
    expect(one?.headers.get('anthropic-workspace-id')).toBe('wrkspc_1')
    expect(one?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 16_000,
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    })
    const content = (one?.body.messages as { content: { type: string }[] }[])[0]?.content
    expect(content?.map((block) => block.type)).toEqual(['image', 'image', 'text'])
  })

  it('names no workspace for a key made inside one', async () => {
    const { fetch, sent } = api(() => message())
    await model(fetch).read([jpeg(10, 10)])
    expect(sent[0]?.headers.has('anthropic-workspace-id')).toBe(false)
  })

  it('asks the schema without the lengths structured outputs do not hold', async () => {
    const { fetch, sent } = api(() => message())
    await model(fetch).read([jpeg(10, 10)])
    const text = JSON.stringify(sent[0]?.body.output_config)
    expect(text).not.toMatch(/maxLength|maxItems|\$schema/)
    expect(text).toContain('"additionalProperties":false')
  })

  it('counts a refusal, an answer cut by its length and one of no schema — each paid', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ stop_reason: 'refusal' }, 'refused'],
      [{ stop_reason: 'max_tokens' }, 'cut'],
      [{ content: [{ type: 'text', text: '{"shop":' }] }, 'invalid'],
      [{ content: [{ type: 'text', text: JSON.stringify({ ...ANSWER, buyer: 'x' }) }] }, 'invalid'],
      [{ content: [] }, 'invalid'],
    ]
    for (const [over, kind] of cases) {
      const { fetch } = api(() => message(over))
      expect(await model(fetch).read([jpeg(10, 10)])).toEqual({ kind, costMicroUsd: 1_654 })
    }
  })

  it('is unavailable at a 429, a 5xx, an overload and no connection — nothing paid', async () => {
    for (const status of [429, 500, 503, 529]) {
      const { fetch } = api(() => failing(status))
      const got = model(fetch).read([jpeg(10, 10)])
      await expect(got).rejects.toBeInstanceOf(ModelUnavailable)
      await expect(got).rejects.toMatchObject({ costMicroUsd: 0 })
    }
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch
    await expect(model(down).read([jpeg(10, 10)])).rejects.toMatchObject({
      reason: 'unreachable',
      costMicroUsd: 0,
    })
  })

  it('is unavailable at its time out, at a price not known: the worst reserved stays', async () => {
    const hung = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch
    const reader = receiptModel({ apiKey: 'k', fetch: hung, maxRetries: 0, timeoutMs: 20 })
    await expect(reader.read([jpeg(10, 10)])).rejects.toMatchObject({
      reason: 'timeout',
      costMicroUsd: null,
    })
  })

  it('is rejected at what asking again repeats: a bad request, a key refused, a model gone', async () => {
    for (const status of [400, 401, 403, 404, 413]) {
      const { fetch } = api(() => failing(status))
      await expect(model(fetch).read([jpeg(10, 10)])).rejects.toEqual(new ModelRejected(status))
    }
  })

  it('bounds the input by the parts’ pixels and the prompt, and measures no part that is no JPEG', () => {
    const { fetch } = api(() => message())
    const reader = model(fetch)
    const one = reader.inputTokensMax([jpeg(750, 1)])
    expect(reader.inputTokensMax([jpeg(750, 1), jpeg(750, 2)])).toBe((one ?? 0) + 2)
    expect(reader.inputTokensMax([jpeg(10, 10), Buffer.from('no photo')])).toBeNull()
    expect(reader.version).toBe('claude-haiku-5-5@v3')
  })
})

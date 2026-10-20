import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk'
import {
  RECEIPT_MODEL,
  RECEIPT_MODEL_OUTPUT_MAX,
  modelCallMicroUsd,
  modelInputTokensMax,
  modelReceiptSchema,
} from '@molvia/model'
import type { ModelReceipt } from '@molvia/model'
import { z } from 'zod'
import { jpegSize } from '@/receipts/jpeg'
import {
  RECEIPT_INSTRUCTIONS,
  RECEIPT_PROMPT_VERSION,
  RECEIPT_SYSTEM,
} from '@/receipts/model-prompt'

/**
 * A call the model may take: the bench's longest was 45 s (MOL-272). Past it the answer is lost, not the
 * receipt — it waits in the queue as for Tesseract away.
 */
export const MODEL_TIMEOUT_MS = 120_000

/**
 * What the model made of a receipt, and what that cost. `read` is an answer of the schema; `refused` is the
 * model's own refusal, `cut` an answer stopped by its length, `invalid` one that is no answer of the schema —
 * each paid all the same (Т-3), and each read by Tesseract instead (В-1 «а»).
 */
export type ModelReading =
  | { readonly kind: 'read'; readonly answer: ModelReceipt; readonly costMicroUsd: number }
  | { readonly kind: 'refused' | 'cut' | 'invalid'; readonly costMicroUsd: number }

/**
 * The model could not be asked now — no connection, its time out, a 429, its own 5xx or overload: the
 * receipt is not at fault and waits in the queue (Р-9). `costMicroUsd` is what the call cost where that is
 * known — nothing for an answer that was a refusal to serve; `null` where it is not, a time out after the
 * request went, and then the worst reserved stays counted.
 */
export class ModelUnavailable extends Error {
  constructor(
    readonly reason: string,
    readonly costMicroUsd: number | null,
  ) {
    super(`receipt model unavailable: ${reason}`)
  }
}

/**
 * The API refused the request for what it is — a 400, a key revoked or of no workspace, a model gone: a
 * fault of ours, which asking again repeats. The receipt is read by Tesseract and the owner hears of it as
 * a failure.
 */
export class ModelRejected extends Error {
  constructor(readonly status: number) {
    super(`receipt model rejected the request: ${String(status)}`)
  }
}

export interface ReceiptModel {
  /** The reader's version for `receipts.reader_version` (Р-7): the model and the prompt. */
  readonly version: string
  /** The input of a call at most, or null where a part is no JPEG this side can measure. */
  inputTokensMax(parts: readonly Buffer[]): number | null
  read(parts: readonly Buffer[]): Promise<ModelReading>
}

// The answer's schema as the API takes it: JSON Schema of the very zod the answer is read back by. The
// lengths are read back by zod, never asked of the model: structured outputs do not hold them.
function outputSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(modelReceiptSchema, { target: 'draft-7' }) as Record<
    string,
    unknown
  >
  return JSON.parse(
    JSON.stringify(schema, (key, value: unknown) =>
      key === '$schema' || key === 'maxLength' || key === 'maxItems' ? undefined : value,
    ),
  ) as Record<string, unknown>
}

const TEXT_BYTES = Buffer.byteLength(RECEIPT_SYSTEM) + Buffer.byteLength(RECEIPT_INSTRUCTIONS)

/**
 * The client of the model that reads receipts (MOL-272): every part in one message, the answer by the
 * schema. It holds nothing, and logs nothing — what it read goes back to the queue alone (Т-8). A key of a
 * person rather than a workspace is named with its workspace (`CLAUDE_WORKSPACE_ID`).
 */
export function receiptModel(options: {
  apiKey: string
  workspaceId?: string | undefined
  /** The tests' fake of the API. */
  fetch?: typeof fetch
  maxRetries?: number
  timeoutMs?: number
}): ReceiptModel {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.workspaceId === undefined
      ? {}
      : { defaultHeaders: { 'anthropic-workspace-id': options.workspaceId } }),
    maxRetries: options.maxRetries ?? 1,
    timeout: options.timeoutMs ?? MODEL_TIMEOUT_MS,
  })
  const schema = outputSchema()

  return {
    version: `${RECEIPT_MODEL}@${RECEIPT_PROMPT_VERSION}`,

    inputTokensMax(parts) {
      const sizes = parts.map((part) => jpegSize(part))
      if (sizes.some((size) => size === null)) return null
      return modelInputTokensMax(
        sizes.filter((size) => size !== null),
        TEXT_BYTES,
      )
    },

    async read(parts) {
      let message: Anthropic.Message
      try {
        message = await client.messages.create({
          model: RECEIPT_MODEL,
          max_tokens: RECEIPT_MODEL_OUTPUT_MAX,
          system: RECEIPT_SYSTEM,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
          messages: [
            {
              role: 'user',
              content: [
                ...parts.map((part) => ({
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: 'image/jpeg' as const,
                    data: part.toString('base64'),
                  },
                })),
                { type: 'text' as const, text: RECEIPT_INSTRUCTIONS },
              ],
            },
          ],
        })
      } catch (error) {
        // the request may have reached the model before the time ran out: its price is not known
        if (error instanceof APIConnectionTimeoutError) throw new ModelUnavailable('timeout', null)
        if (error instanceof APIConnectionError) throw new ModelUnavailable('unreachable', 0)
        if (error instanceof RateLimitError) throw new ModelUnavailable('status 429', 0)
        // 5xx and 529, the model overloaded
        if (error instanceof InternalServerError) {
          throw new ModelUnavailable(`status ${String(error.status)}`, 0)
        }
        if (error instanceof APIError) {
          const status: unknown = error.status
          if (typeof status === 'number') throw new ModelRejected(status)
        }
        throw error
      }
      const costMicroUsd = modelCallMicroUsd(message.usage)
      if (message.stop_reason === 'refusal') return { kind: 'refused', costMicroUsd }
      if (message.stop_reason !== 'end_turn') return { kind: 'cut', costMicroUsd }
      const text = message.content.find((block) => block.type === 'text')?.text
      let json: unknown
      try {
        json = text === undefined ? undefined : JSON.parse(text)
      } catch {
        return { kind: 'invalid', costMicroUsd }
      }
      const answer = modelReceiptSchema.safeParse(json)
      return answer.success
        ? { kind: 'read', answer: answer.data, costMicroUsd }
        : { kind: 'invalid', costMicroUsd }
    },
  }
}

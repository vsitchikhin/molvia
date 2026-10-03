import { GrammyError, HttpError } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import {
  FAILURE_FRAMES,
  FAILURE_FRAME_MAX,
  FAILURE_NAME_MAX,
  ISSUE,
  describeFailure,
} from '@molvia/model'
import type { BotFailure } from '@molvia/model'

/**
 * The commands and the prefixes of buttons the bot has: what a handler may be named by. Anything
 * else is `other` — a word a person typed after `/`, or a forged button, is anybody's text, and as a
 * place it would land in the table and in the owner's message, a new fingerprint for every word
 * (adversarial review 1).
 */
const COMMANDS = new Set(['start', 'delete'])
const BUTTONS = new Set(['login', 'erase', 'rate', 'remind'])

/**
 * Where in the bot a failure happened (MOL-143, Р-5): the kind of update and the bot's own name of
 * its button or command — `callback:rate`, `command:delete`, `message`, `my_chat_member` — and never
 * the button's data whole, the text, or who sent it.
 */
export function handlerOf(ctx: Context): string {
  const data = ctx.callbackQuery?.data
  if (data !== undefined) return `callback:${known(BUTTONS, data.split(':', 1)[0] ?? '')}`
  const text = ctx.message?.text
  if (text !== undefined) {
    const command = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s|$)/.exec(text)?.[1]
    return command === undefined ? 'message' : `command:${known(COMMANDS, command.toLowerCase())}`
  }
  if (ctx.myChatMember !== undefined) return 'my_chat_member'
  return 'update'
}

function known(names: ReadonlySet<string>, name: string): string {
  return names.has(name) ? name : 'other'
}

/**
 * Whether a failure is a defect of the bot rather than the weather (Р-5). The network and Telegram
 * being down, Telegram asking to wait, a person who blocked the bot — those are availability, and
 * MOL-142 watches it. The API answering with a refusal or not at all is the API's: it records its
 * own 500s. What is left is ours — a throw in a handler, a message Telegram refuses as malformed, an
 * answer of the API the contract does not read.
 */
export function isDefect(error: unknown): boolean {
  if (error instanceof HttpError) return false
  if (error instanceof GrammyError) {
    return error.error_code !== 403 && error.error_code !== 429 && error.error_code < 500
  }
  if (error instanceof ApiError) return error.code === ISSUE.RESPONSE_INVALID
  return true
}

/** The bot's word about a failure: its kind, Telegram's code where Telegram refused, the handler. */
export function botFailureOf(error: unknown, handler: string): BotFailure {
  const { errorName, code, frames } = describeFailure(error)
  const telegram = error instanceof GrammyError ? `TELEGRAM_${String(error.error_code)}` : undefined
  const name = errorName.replace(/[^\w$.-]/g, '_').slice(0, FAILURE_NAME_MAX)
  return {
    errorName: name === '' ? 'unknown' : name,
    ...((code ?? telegram) === undefined ? {} : { code: code ?? telegram }),
    ...(frames === undefined
      ? {}
      : {
          frames: frames.slice(0, FAILURE_FRAMES).map((frame) => frame.slice(0, FAILURE_FRAME_MAX)),
        }),
    handler,
  }
}

/**
 * A defect reported to the API's table of failures (MOL-143) — anything else is left to the log.
 * The report is not waited for and its own failure is one line of the log: the bot keeps nothing to
 * retry with.
 */
export function reportDefect(api: MolviaBotClient, error: unknown, handler: string): void {
  if (!isDefect(error)) return
  api.reportFailure(botFailureOf(error, handler)).catch((refused: unknown) => {
    console.error(
      `[molvia] failure not reported: ${refused instanceof ApiError ? refused.code : 'unexpected'}`,
    )
  })
}

/**
 * A failure of a handler, logged by its kind — never its message, which carries what Telegram or
 * the API said, and for a network error the bot's token in the address (MOL-142) — and reported
 * when it is a defect.
 */
export function reportFailure(api: MolviaBotClient, error: unknown, handler: string): void {
  const { errorName, code } = botFailureOf(error, handler)
  console.error(`[molvia] ${handler} failed: ${errorName}${code ? ` ${code}` : ''}`)
  reportDefect(api, error, handler)
}

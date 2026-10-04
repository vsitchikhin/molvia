import { GrammyError } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { reportDefect } from './failure'

/**
 * Sending what the API handed out (MOL-101, MOL-129): a rating reminder or «чек разобран». The API
 * has marked it as sent already, so nothing here is claimed again — what fails is lost, never doubled.
 */

/**
 * The longest a 429 is waited out (review Т-4). Telegram names the wait in `retry_after`; a wait
 * longer than this is flood control over the whole bot, and a retry before it ends is refused for
 * certain — so the run stops there instead (adversarial З). A stop on deploy has thirty seconds
 * (`stop_grace_period`), and the rest of the run's messages are still to go.
 */
export const RETRY_AFTER_CAP_SECONDS = 10

/** Waits `ms`; `false` when a stop cut the wait short. */
export type Wait = (ms: number) => Promise<boolean>

/** Telegram asked for longer than we wait: every message after this one would be refused too. */
export class Flooded extends Error {}

/** What became of one message: sent, the person blocked the bot, or given up and logged. */
export type Delivered = 'sent' | 'blocked' | 'failed'

/**
 * One message. **Too Many Requests (429) is waited out once**, as Telegram asks, since at 19:00
 * everybody in Armenia is one batch — unless it asks for longer than `RETRY_AFTER_CAP_SECONDS`, which
 * ends the run (`Flooded`), or a stop cuts the wait short, which gives that message up. Anything else
 * is given up and logged by its code under `label` — no chat, no name (the privacy page). **Blocked
 * (403) turns the person's reminders off** (MOL-103, Р-5): without it the API handed them out again,
 * to fail the same way — and «blocked» is where every message of the bot looks before it goes.
 */
export async function deliver(
  api: MolviaBotClient,
  telegramUserId: number,
  message: () => Promise<unknown>,
  wait: Wait,
  label: string,
): Promise<Delivered> {
  try {
    try {
      await message()
    } catch (error) {
      if (!(error instanceof GrammyError) || error.error_code !== 429) throw error
      const seconds = error.parameters.retry_after ?? 1
      if (seconds > RETRY_AFTER_CAP_SECONDS) throw new Flooded()
      if (!(await wait(seconds * 1000))) throw error
      await message()
    }
    return 'sent'
  } catch (error) {
    if (error instanceof Flooded) throw error
    const code = error instanceof GrammyError ? String(error.error_code) : 'unexpected failure'
    console.error(`[molvia] ${label}: ${code}`)
    reportDefect(api, error, `${label}:send`)
    if (error instanceof GrammyError && error.error_code === 403) {
      await blocked(api, telegramUserId)
      return 'blocked'
    }
    return 'failed'
  }
}

/**
 * The bot was blocked: the person's reminders go off (MOL-103). Telegram's `my_chat_member` usually
 * says so first; this is for a block the bot did not hear about, while it was down. A failure is
 * the log's, by its code — the next message's 403 asks again.
 */
async function blocked(api: MolviaBotClient, telegramUserId: number): Promise<void> {
  try {
    await api.switchReminders(telegramUserId, 'blocked')
  } catch (error) {
    console.error(
      `[molvia] remind blocked: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
  }
}

/** Waits `ms`, or less if `signal` aborts first: `true` for the whole wait, `false` for a cut. */
export async function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cut)
      resolve(true)
    }, ms)
    const cut = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', cut, { once: true })
  })
}

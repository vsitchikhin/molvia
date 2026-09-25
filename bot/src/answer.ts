import { GrammyError } from 'grammy'
import type { Context } from 'grammy'
import { t } from './i18n'
import type { MessageKey } from './i18n'

/*
 * How the bot answers a press, shared by the login (MOL-55) and by erasure (MOL-58): the rules
 * below were each paid for by an adversarial round, and a second copy would be a second place
 * for them to drift.
 */

/**
 * The answer replaces the question, so the buttons go with it (Q6).
 *
 * **Only an outcome may be written here** — confirmed, declined, erased, cancelled. A refusal is
 * shown over the message instead of in it, for the reason spelled out on `refuse`.
 */
export async function settle(ctx: Context, key: MessageKey): Promise<void> {
  const text = t(ctx.from?.language_code, key)
  try {
    // No `reply_markup`: Telegram drops the keyboard when an edit does not carry one.
    await ctx.editMessageText(text)
  } catch (error) {
    // «message is not modified» is not a failure to answer — it means this very answer is
    // already on screen, which is what a second press of an idempotent confirmation produces.
    // Read as «the message is gone», it put a duplicate reply into the chat every double tap
    // (adversarial Б2) — exactly the clutter Q6 removed by editing in place. Erasure leans on
    // the same: its outcome is one sentence whether the press erased someone or found no one.
    if (error instanceof GrammyError && error.description.includes('message is not modified')) {
      return
    }
    // Too old to edit, or the message is gone — the answer still has to arrive.
    await ctx.reply(text)
  }
}

/**
 * A refusal, shown **over** the message and written nowhere at all.
 *
 * This is О-1's rule, and it is absolute: the chat holds outcomes, and a refusal is a thing
 * that appears, is read and goes. Two rounds of trying to make an exception for it are the
 * argument for that (В1 → Г1 → Д1): a refusal put **under** the message stayed there for
 * good, and the successful retry it asked for rewrote the question above it, so the last word
 * in the chat was a refusal over a login that had happened. A refusal put **into** the message
 * did worse — «API did not answer» was supposed to mean no press of this message could have
 * succeeded, and that is simply false: the API can answer one press and time out on the next,
 * which is the very case О-2 exists for. It erased «Вход подтверждён» and handed the buttons
 * back, and «Это не я» among them would then put out the person's own confirmed login.
 *
 * So when Telegram will not take the alert — a query aged out while the API was thinking —
 * nothing is said. The buttons are still there, and the next press carries a **fresh** query
 * that can be answered; the way that press is made cheap is the client's timeout below, not a
 * second channel here. For a dead link the caller drops the buttons, and that is the signal.
 */
export async function refuse(ctx: Context, key: MessageKey): Promise<void> {
  try {
    // Over the message rather than under the top edge of the screen: this is the one thing
    // the person has to read, and a toast at a shelf is easy to miss.
    await ctx.answerCallbackQuery({
      text: t(ctx.from?.language_code, key),
      show_alert: true,
    })
  } catch {
    // Nothing to fall back on, deliberately — see above.
  }
}

/**
 * The spinner under the finger, stopped — and its failure swallowed.
 *
 * Telegram refuses to answer an aged-out query, and on the success path that answer stands in
 * a `finally` after the outcome has been written. Letting it out put «update failed» in the
 * log for a login that had just succeeded (Г2) — the very thing З-4 removed from the other
 * path: a line naming the wrong thing as broken. The spinner is cosmetic; the outcome is not.
 */
export async function stopSpinner(ctx: Context): Promise<void> {
  try {
    await ctx.answerCallbackQuery()
  } catch {
    // Nothing to do and nothing to say: the answer is already on screen.
  }
}

/** Buttons that can no longer do anything, taken away without touching what was written. */
export async function dropKeyboard(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup()
  } catch {
    // Already gone, or the message is: neither changes what the person is looking at.
  }
}

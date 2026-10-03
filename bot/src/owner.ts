import { GrammyError, InputFile } from 'grammy'
import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { FeedbackContinuedNotice, FeedbackNotice, OwnerNotice } from '@molvia/model'
import { t } from './i18n'
import { telegramFailure } from './assemble'
import { sleep } from './remind'
import { reportDefect } from './failure'

/**
 * The words of one notice to the owner (MOL-143). Always Russian: the owner's language is not
 * something we keep, and the message goes without an update to read one from. Plain text, no
 * markup — a frame, a route or a person's text is shown as it is, and nothing in it can break a parse.
 */
export function ownerText(notice: OwnerNotice): string {
  if (notice.kind === 'feedback') return feedbackText(notice)
  if (notice.kind === 'feedback_continued') return continuedText(notice)
  if (notice.kind === 'failure_muted') {
    // Said only what is so (review №10, adversarial Г2): no «скрыто: 0», and `make failures` only for
    // the held ones — the unwritten are in no table.
    const held = notice.count > 0
    return [
      ...(held ? [t(undefined, 'owner.failure.muted', { count: notice.count })] : []),
      ...(notice.unwritten === undefined
        ? []
        : [t(undefined, 'owner.failure.unwritten', { unwritten: notice.unwritten })]),
      ...(held ? [t(undefined, 'owner.failure.more')] : []),
    ].join('\n')
  }
  const kind = notice.code === undefined ? notice.errorName : `${notice.errorName} ${notice.code}`
  const what = t(undefined, 'owner.failure.what', {
    kind,
    place: notice.route ?? t(undefined, 'owner.failure.nowhere'),
  })
  // The phone's (MOL-144): which system it broke on is the first thing to know of a phone's failure.
  const platform = [
    ...(notice.platform === undefined
      ? []
      : [t(undefined, 'owner.failure.platform', { platform: notice.platform })]),
  ]
  if (notice.kind === 'failure_count') {
    return [
      t(undefined, 'owner.failure.again', { count: notice.count, source: notice.source }),
      what,
      ...platform,
      t(undefined, 'owner.failure.build', { build: notice.build }),
    ].join('\n')
  }
  return [
    t(undefined, 'owner.failure.new', { source: notice.source }),
    what,
    ...(notice.frame === undefined ? [] : [notice.frame]),
    ...platform,
    t(undefined, 'owner.failure.buildPrint', {
      build: notice.build,
      fingerprint: notice.fingerprint,
    }),
    t(undefined, 'owner.failure.more'),
  ].join('\n')
}

/**
 * The thread a notice is about, read back from the end of its first line — `#fb42` (MOL-148, Р-3).
 * Only there: the frame of a reply quotes the owner's text, which may carry a tag of its own, and the
 * first line of every notice is the bot's alone. `null` where there is none.
 */
export function threadTagOf(text: string): number | null {
  // A picture's caption carries the tag as a notice does (MOL-167): `text ?? caption` is the caller's.
  const first = text.split('\n', 1)[0] ?? ''
  const tag = /#fb([1-9]\d{0,15})$/.exec(first)
  if (!tag?.[1]) return null
  const thread = Number(tag[1])
  return Number.isSafeInteger(thread) ? thread : null
}

/** When, as the owner reads it: Yerevan's day and minute — the owner lives there (MOL-148). */
const OWNER_MOMENT = new Intl.DateTimeFormat('ru', {
  timeZone: 'Asia/Yerevan',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * A message from the app (MOL-148, Р-9 of MOL-150): the kind and the tag first — the tag ends the
 * first line, where the bot reads it back from the owner's reply — then the text, and what went with
 * it as it was sent. Nothing of the person: the notice has nothing of them to print.
 */
function feedbackText(notice: FeedbackNotice): string {
  const page = notice.pageBuild ?? t(undefined, 'owner.feedback.noBuild')
  const code =
    notice.errorCode !== null
      ? [t(undefined, 'owner.feedback.code', { code: notice.errorCode })]
      : notice.fromError
        ? [t(undefined, 'owner.feedback.noCode')]
        : []
  return [
    t(undefined, `owner.feedback.${notice.feedbackKind}`, { thread: notice.thread }),
    notice.text === '' ? t(undefined, 'owner.feedback.noText') : notice.text,
    '',
    t(undefined, 'owner.feedback.where', {
      route: notice.route ?? t(undefined, 'owner.feedback.noBuild'),
      platform: notice.platform ?? t(undefined, 'owner.feedback.noBuild'),
      locale: notice.locale,
    }),
    ...code,
    ...picturesLine(notice.pictures),
    t(undefined, 'owner.feedback.builds', { page, api: notice.apiBuild }),
    OWNER_MOMENT.format(new Date(notice.at)),
  ].join('\n')
}

/** «Снимков: 2» — the pictures that follow as replies to the notice (MOL-167, Р-5). */
function picturesLine(pictures: number | undefined): string[] {
  return pictures === undefined
    ? []
    : [t(undefined, 'owner.feedback.pictures', { count: pictures })]
}

/** A person's answer to the owner's reply (MOL-148, В-1 of MOL-150): the tag, the reply quoted. */
function continuedText(notice: FeedbackContinuedNotice): string {
  return [
    t(undefined, 'owner.feedback.continued', { thread: notice.thread }),
    t(undefined, 'owner.feedback.quote', { quote: notice.quote }),
    notice.text === '' ? t(undefined, 'owner.feedback.noText') : notice.text,
    ...picturesLine(notice.pictures),
    '',
    OWNER_MOMENT.format(new Date(notice.at)),
  ].join('\n')
}

/** Between two messages to one chat: Telegram's limit is about one a second. */
const OWNER_PAUSE_MS = 1_100

type Wait = (ms: number) => Promise<boolean>

/**
 * One minute's notices (MOL-143): claimed from the API, which has already marked them handed, and
 * sent one by one. At most once, as the reminders are: a notice whose message failed is the log's,
 * by its kind, and `make failures` still has the count. A 429 ends the run — the rest would be
 * refused the same way — and the log says how many went with it.
 */
export async function tellOwner(
  api: MolviaBotClient,
  telegram: Api,
  wait: Wait = async (ms) => sleep(ms),
  pauseMs = OWNER_PAUSE_MS,
  deadline?: AbortSignal,
): Promise<void> {
  let claimed
  try {
    claimed = await api.claimOwnerNotices(deadline)
  } catch (error) {
    // Cut by the stop's deadline (review №16): what the API marked meanwhile is lost with the
    // process either way, and the log says so rather than a bare `aborted`.
    if (deadline?.aborted) {
      console.error('[molvia] owner: stopping, the claim under way given up')
      return
    }
    console.error(`[molvia] owner claim: ${error instanceof ApiError ? error.code : 'unexpected'}`)
    reportDefect(api, error, 'owner:claim')
    return
  }
  const { to, notices } = claimed
  if (to === null) return
  for (const [index, notice] of notices.entries()) {
    // The rest is marked handed already, and a rollout — every stop — is when there is a batch
    // (adversarial А4): a stop keeps Telegram's pace while its time lasts, and says what it left.
    if (index > 0 && !(await wait(pauseMs))) {
      const left = notices.length - index
      console.error(`[molvia] owner: stopping, ${String(left)} notices given up`)
      return
    }
    let sent: { message_id: number }
    try {
      // grammY types its signal by the `abort-controller` package; the platform's is the same thing.
      // Raced against the end of the stop's time as well: a transport that does not hear its
      // signal must not hold the stop either (adversarial В1).
      sent = await cutAt(
        telegram.sendMessage(
          to,
          ownerText(notice),
          undefined,
          deadline as Parameters<Api['sendMessage']>[3],
        ),
        deadline,
      )
    } catch (error) {
      // A notice about a message is handed again until it is said to have gone (MOL-148, adversarial
      // В1); one about a failure goes with the failure's count still in the table.
      // A send cut by the end of the stop's time: it and the rest are given up, and said so — a
      // hung socket held the stop past compose's thirty seconds, and the kill said nothing
      // (adversarial В1).
      if (deadline?.aborted) {
        const left = notices.length - index
        console.error(`[molvia] owner: stopping, ${String(left)} notices given up`)
        return
      }
      console.error(`[molvia] owner notice: ${telegramFailure(error)}`)
      // A notice Telegram refuses for what it is — a 400, not the weather — is a failure of ours,
      // and the one way the owner hears that a message's notice keeps not going (round 2, Г2).
      reportDefect(api, error, 'owner:send')
      if (error instanceof GrammyError && error.error_code === 429) {
        const left = notices.length - index - 1
        if (left > 0) console.error(`[molvia] owner: 429 flood, ${String(left)} notices given up`)
        return
      }
      continue
    }
    if (notice.kind === 'feedback' || notice.kind === 'feedback_continued') {
      let missed: number[] = []
      if ((notice.pictures ?? 0) > 0) {
        const went = await sendPictures(api, telegram, to, notice, sent.message_id, {
          wait,
          pauseMs,
          deadline,
        })
        // Cut off: the notice goes again whole — the text twice, the price of a lost mark (Р-5).
        if (went.outcome === 'cut') {
          if (deadline?.aborted) {
            console.error(
              `[molvia] owner: stopping, ${String(notices.length - index)} notices given up`,
            )
            return
          }
          continue
        }
        // A flood ends the run as it does on a text (review 4): the rest would meet the same 429.
        if (went.outcome === 'flood') {
          const left = notices.length - index - 1
          if (left > 0) console.error(`[molvia] owner: 429 flood, ${String(left)} notices given up`)
          return
        }
        missed = went.missed
      }
      await saySent(api, notice.number, missed, deadline)
    }
  }
}

/** Telegram's own word for a caption: the tag ends its first line, as a notice's does. */
function pictureCaption(position: number, count: number, thread: number): string {
  return t(undefined, 'owner.feedback.pictureCaption', { position, count, thread })
}

/**
 * The pictures of a message, each a photo replying to its notice, captioned with the thread's tag —
 * so the owner's reply to a picture finds the thread as a reply to the notice does (MOL-167, Р-5).
 * The phone's JPEG goes as a file, a person's Telegram photo by its id: not forwarded, no sender
 * shown. A picture Telegram refuses, or one no longer there, is the log's and the rest go on: a
 * notice that could never go whole would be handed for good — but it is `missed`, and the API does not
 * mark it sent (adversarial А4). `cut` — the connection broke or the stop ran out of time, and
 * nothing is said to have gone; `flood` — Telegram's 429, which ends the run.
 */
async function sendPictures(
  api: MolviaBotClient,
  telegram: Api,
  to: number,
  notice: FeedbackNotice | FeedbackContinuedNotice,
  replyTo: number,
  { wait, pauseMs, deadline }: { wait: Wait; pauseMs: number; deadline?: AbortSignal | undefined },
): Promise<
  | { readonly outcome: 'sent'; readonly missed: number[] }
  | { readonly outcome: 'cut' }
  | { readonly outcome: 'flood' }
> {
  const count = notice.pictures ?? 0
  const missed: number[] = []
  for (let position = 1; position <= count; position++) {
    if (!(await wait(pauseMs))) return { outcome: 'cut' }
    let picture
    try {
      picture = await api.feedbackPicture(notice.number, position, deadline)
    } catch (error) {
      console.error(
        `[molvia] owner picture: ${error instanceof ApiError ? error.code : 'unexpected'}`,
      )
      reportDefect(api, error, 'owner:picture')
      return { outcome: 'cut' }
    }
    if (picture === null) {
      console.error('[molvia] owner picture: gone before it was sent')
      missed.push(position)
      continue
    }
    const photo =
      picture.source === 'phone'
        ? new InputFile(
            Buffer.from(picture.jpeg, 'base64'),
            `fb${String(notice.number)}-${String(position)}.jpg`,
          )
        : picture.fileId
    try {
      await cutAt(
        telegram.sendPhoto(
          to,
          photo,
          {
            caption: pictureCaption(position, count, notice.thread),
            reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
          },
          deadline as Parameters<Api['sendPhoto']>[3],
        ),
        deadline,
      )
    } catch (error) {
      console.error(`[molvia] owner picture: ${telegramFailure(error)}`)
      reportDefect(api, error, 'owner:picture')
      if (deadline?.aborted) return { outcome: 'cut' }
      if (error instanceof GrammyError && error.error_code === 429) return { outcome: 'flood' }
      if (error instanceof GrammyError) {
        missed.push(position)
        continue
      }
      return { outcome: 'cut' }
    }
  }
  return { outcome: 'sent', missed }
}

/**
 * The bot's word that a notice about a message went (MOL-148, adversarial В1). Lost, the API hands
 * the notice again ten minutes on and the owner reads it twice — a named price, the other way being a
 * message nobody reads.
 */
async function saySent(
  api: MolviaBotClient,
  message: number,
  missed: readonly number[],
  deadline?: AbortSignal,
): Promise<void> {
  try {
    await api.ownerNoticesSent(
      [message],
      deadline,
      missed.map((position) => ({ message, position })),
    )
  } catch (error) {
    console.error(
      `[molvia] owner notice sent: ${error instanceof ApiError ? error.code : 'unexpected'}`,
    )
    reportDefect(api, error, 'owner:sent')
  }
}

/**
 * `work`, or a refusal when `signal` fires first. The listener goes with the race: one left on the
 * signal after its send went through would reject later, when the stop's time ran out, with nobody
 * to hear it.
 */
async function cutAt<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  return new Promise<T>((resolve, reject) => {
    const cut = (): void => {
      reject(new Error('the stop ran out of time'))
    }
    if (signal.aborted) {
      cut()
      return
    }
    signal.addEventListener('abort', cut, { once: true })
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', cut)
    })
  })
}

/** How often the bot asks: a new failure reaches the owner within a minute. */
export const OWNER_EVERY_MS = 60_000

/**
 * How long a stop goes on sending the notices already handed, at Telegram's pace: a third of the
 * bot's thirty seconds of `stop_grace_period` is left to the reminders and the runner beside it.
 * Sent without the pauses, nineteen messages in a hundred milliseconds met a 429 (adversarial Б3).
 */
export const OWNER_STOP_BUDGET_MS = 20_000

/**
 * The owner's timer, the twin of the reminders' (MOL-101): every minute the API is asked, a run
 * still going is not doubled, the timer keeps no process alive, and a stop waits for the rest —
 * sent at the same pace while `OWNER_STOP_BUDGET_MS` lasts, then given up and said so; a send hung
 * when the time runs out is cut, so the stop ends inside compose's grace period.
 */
export function startOwnerNotices(
  api: MolviaBotClient,
  telegram: Api,
  everyMs = OWNER_EVERY_MS,
  pauseMs = OWNER_PAUSE_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const stopping = new AbortController()
  let stoppedAt: number | undefined
  // Fires when the stop's time is out: a send under way is cut, not only the next pause.
  const deadline = new AbortController()
  const wait: Wait = async (ms) => {
    if (stoppedAt === undefined && (await sleep(ms, stopping.signal))) return true
    // The stop came during the pause, or before it: the time left decides.
    const since = performance.now() - (stoppedAt ?? performance.now())
    if (since + ms > OWNER_STOP_BUDGET_MS) return false
    await sleep(ms)
    return true
  }
  const tick = (): void => {
    if (running) return
    running = tellOwner(api, telegram, wait, pauseMs, deadline.signal).finally(() => {
      running = undefined
    })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    stoppedAt = performance.now()
    stopping.abort()
    const out = setTimeout(() => {
      deadline.abort()
    }, OWNER_STOP_BUDGET_MS)
    await running
    clearTimeout(out)
  }
}

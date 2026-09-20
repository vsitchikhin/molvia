import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'
import { visibleLine } from '#model/support/text'

/**
 * The longest device name — for a caller that shortens one rather than failing past it.
 * `User-Agent` strings are far longer, so whoever derives a name has to cut it somewhere, and
 * this is the number to cut it to (MOL-53).
 */
export const DEVICE_NAME_MAX = 80

/**
 * «iPhone · Safari», not the browser string it was derived from. Nullable because a request
 * without a `User-Agent` is an ordinary request, and inventing a name for it would be worse
 * than the screen saying «unknown device».
 *
 * A name is decoration: it tells a person which of their devices a row is, and nothing depends
 * on it. That is why an unusable one becomes `null` instead of refusing the write — a login
 * must not fail over the cosmetics of a header (MOL-52, adversarial А1/А4).
 */
export const deviceNameSchema = visibleLine(DEVICE_NAME_MAX)

/** A cut that would leave the high half of a character behind, with no low half to follow. */
const HALF_A_CHARACTER = /[\uD800-\uDBFF]$/u

/**
 * A device name made into what the column and `deviceNameSchema` both accept — `tidyText`'s
 * job, for a name instead of a review.
 *
 * Two outcomes, and the difference between them is the point (adversarial Р5). A name that is
 * merely **too long** is cut and kept: «iPhone · Safari …» shortened still tells a person which
 * device they are looking at, and losing it would leave «unknown device» beside a login they
 * made ten seconds ago. A name that **draws nothing** — braille blanks, a zero-width space, an
 * empty `User-Agent` — becomes `null`, because there is nothing there to shorten.
 *
 * Here rather than in whoever derives the name, for the reason `tidyText` is here: what counts
 * as blank belongs to `visibleLine`, and a second copy of it in MOL-53 would drift the way
 * `INVISIBLE` did twice.
 */
export function deviceNameOrNull(value: string | null): string | null {
  if (value === null) return null

  const trimmed = value.trim()
  // Cut by UTF-16 units, which is what `visibleLine` counts; the column counts code points and
  // is therefore never the stricter of the two. Half a character is not a shorter name, it is
  // a broken one, so a cut that would leave one takes a unit less.
  const cut =
    trimmed.length <= DEVICE_NAME_MAX
      ? trimmed
      : trimmed.slice(0, DEVICE_NAME_MAX).replace(HALF_A_CHARACTER, '')

  // Trimmed again: a cut lands wherever it lands, and a name left ending in a space is not what
  // the schema calls a line.
  return deviceNameSchema.safeParse(cut.trim()).data ?? null
}

/**
 * A live way into an account: how a device says who it is, once MOL-53 stops reading the
 * identifier off a header.
 *
 * The token itself is not here and never is — what is written down is a `sha256` of it, and
 * the repository is the only thing that ever sees the other side (Р-5, Р-6). A session carries
 * no state beyond its own lifetime, because revoking one is deleting the row: an owner's list
 * of devices is what is left of the table (Р-4).
 */
export const sessionSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  deviceName: deviceNameSchema.nullable(),
  createdAt: z.date(),
  lastSeenAt: z.date(),
  expiresAt: z.date(),
})
export type Session = z.infer<typeof sessionSchema>

/**
 * What a caller has to bring to open a session, judged **before** a row exists.
 *
 * The shape is here rather than in the repository for the reason `newActorSchema` is: a rule
 * that lives beside the `INSERT` is a rule the next `INSERT` can skip. Without it the domain
 * judged the row it had just written, and an unusable device name left a session nobody could
 * reach — written, unreadable, and holding its token's unique index forever (А1).
 *
 * `expiresAt` in the past is refused here too, and refused as **this server's mistake**. The
 * database says the same through `sessions_lifetime_forward`, but as `23514`; either way nobody
 * outside is to blame, because no client can name this date — MOL-53 computes it from a
 * constant. So there is deliberately no registry code for it: a code in the registry means
 * «somebody will be shown this», and an unreachable one is worse than none. A ZodError out of a
 * repository is a 500 with a log line, which is the honest reply (adversarial Р1).
 */
export const newSessionSchema = z.strictObject({
  id: z.uuid(),
  actorId: z.uuid(),
  deviceName: deviceNameSchema.nullable(),
  expiresAt: z.date().refine((at) => at.getTime() > Date.now(), {
    error: 'a session cannot expire before it starts',
  }),
})
export type NewSession = z.infer<typeof newSessionSchema>

/**
 * The limit on Telegram's own `start` parameter, which the login link rides in
 * (`t.me/<bot>?start=<code>`). It is their number, not ours — hence the name of the rule
 * rather than a bare 64 somewhere in a regex.
 */
export const LOGIN_CODE_MAX = 64

/**
 * What the link carries, in the alphabet Telegram accepts. Formally not a secret — the session
 * is handed to whoever holds the request's cookie secret, and only after a button in the bot —
 * but it is long anyway, because a guessable code opens the door backwards: a stranger
 * confirming somebody else's pending request with **their own** Telegram account would log
 * that person's browser into the stranger's account, and the purchases entered afterwards
 * would go there (MOL-52, Р-7).
 */
export const loginCodeSchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_-]{1,${String(LOGIN_CODE_MAX)}}$`))

/**
 * A login being waited for. Four states, and no column names them (Р-9):
 *
 * | `telegramUserId` | `consumedAt` |                                                   |
 * | ---------------- | ------------ | ------------------------------------------------- |
 * | `null`           | `null`       | waiting for the person to press the button        |
 * | set              | `null`       | confirmed; the browser has not collected it yet   |
 * | set              | set          | spent — either the session was issued, or the     |
 * |                  |              | person said «this was not me» after confirming    |
 * | `null`           | set          | «this was not me», said before confirming         |
 *
 * The third row carries two histories on purpose, and it is worth knowing which: after a
 * confirmation, a refusal puts the request out without clearing the account it named — there is
 * nothing left to hand over, so nothing needs clearing (adversarial А7). For every reader the
 * answer is one and the same, «there is no such request», which is exactly why there is no
 * `declinedAt` to tell them apart.
 *
 * `expiresAt` puts out either of the first two by itself.
 *
 * The browser's secret is absent here for the same reason the session token is: only its hash
 * is written down.
 */
export const loginRequestSchema = z.object({
  id: z.uuid(),
  code: loginCodeSchema,
  deviceName: deviceNameSchema.nullable(),
  /** Set when the person confirms in the bot. No foreign key behind it: on a first login the
   * owner does not exist yet, and a key would make the first login impossible (Р-10). */
  telegramUserId: telegramUserIdSchema.nullable(),
  createdAt: z.date(),
  expiresAt: z.date(),
  consumedAt: z.date().nullable(),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/**
 * What opens a login request, judged before the row exists — as `newSessionSchema` is (А1), and
 * refused the same way and for the same reason: the code and the date are both this server's to
 * mint, so a bad one is a defect here rather than something to answer a caller with.
 */
export const newLoginRequestSchema = z.strictObject({
  id: z.uuid(),
  code: loginCodeSchema,
  deviceName: deviceNameSchema.nullable(),
  expiresAt: z.date().refine((at) => at.getTime() > Date.now(), {
    error: 'a login request cannot expire before it starts',
  }),
})
export type NewLoginRequest = z.infer<typeof newLoginRequestSchema>

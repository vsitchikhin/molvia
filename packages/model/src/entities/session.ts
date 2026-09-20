import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'
import { visibleLine } from '#model/support/text'

/**
 * How a device says who it is, once MOL-53 stops reading the identifier off a header.
 *
 * The token itself is not here and never is: what is written down is `sha256` of it, and the
 * repository is the only thing that ever sees the other side (MOL-52, Р-5, Р-6). A session
 * carries no state beyond its own lifetime because revoking one is deleting the row — an
 * owner's list of devices is what is left of the table (Р-4).
 */
export const DEVICE_NAME_MAX = 80

/**
 * “iPhone · Safari”, not the browser string it was derived from. It is nullable because a
 * request without a `User-Agent` is an ordinary request, and guessing a name for it would be
 * worse than the screen saying «unknown device».
 */
export const deviceNameSchema = visibleLine(DEVICE_NAME_MAX)

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
 * | `telegramUserId` | `consumedAt` |                                                  |
 * | ---------------- | ------------ | ------------------------------------------------ |
 * | `null`           | `null`       | waiting for the person to press the button       |
 * | set              | `null`       | confirmed; the browser has not collected it yet  |
 * | set              | set          | the session was issued, exactly once             |
 * | `null`           | set          | «this was not me» — put out without a confirmation |
 *
 * `expiresAt` puts out either of the first two by itself. There is no `declinedAt` because a
 * refusal and a spent login have one reader and one answer — «there is no such request».
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

import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'
import { pastedLine, trimInvisibleEdges, visibleLine } from '#model/support/text'

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

/**
 * As many whole characters as fit into `max` UTF-16 units.
 *
 * `for…of` walks code points, so a pair is taken or left but never split — that is the whole
 * reason the cut is not a `slice`. Units, because that is what `visibleLine` counts; the column
 * counts code points and is therefore never the stricter of the two.
 */
function cutToUnits(line: string, max: number): string {
  let taken = ''
  let units = 0
  for (const character of line) {
    if (units + character.length > max) break
    taken += character
    units += character.length
  }
  return taken
}

/**
 * A device name made into what the column and `deviceNameSchema` both accept — `pastedLine`'s
 * job, for a name derived from a header instead of one pasted into a field.
 *
 * **Three outcomes, and all three are the point** (MOL-52, adversarial Р5, С3, С4):
 *
 * 1. Too long → **cut and kept**. «iPhone · Safari …» shortened still tells a person which
 *    device they are looking at, and losing it would leave «unknown device» beside a login they
 *    made ten seconds ago.
 * 2. Draws nothing — braille blanks, a zero-width space, an empty `User-Agent` → **`null`**,
 *    because there is nothing there to shorten.
 * 3. Carries a character no one can be shown — a lone surrogate, a private-use glyph → **`null`
 *    as well**, and this is the outcome the first version had without saying so. It is the line
 *    `pastedLine` itself draws: breaks and direction marks it repairs, those two it deliberately
 *    leaves «for the form to explain». Here there is no form and no person typing — the name is
 *    derived — so there is nobody to explain it to, and a name is dropped rather than shown as
 *    mojibake beside a real device.
 *
 * What a cut may leave behind is `trimInvisibleEdges`'s to decide, not this function's: it
 * already knows that a selector after an emoji draws it, that a run of tags is a flag only when
 * it spells one, and that a joiner left dangling draws nothing (MOL-21, adversarial round 4).
 * A second, poorer rule here — the first version knew only a lone high surrogate — is exactly
 * the drift `INVISIBLE` went through twice (MOL-12, MOL-27).
 *
 * **One edge is known and left as it is:** a combining mark whose base letter is the last thing
 * that fits is dropped with everything after it, so «…Молокó» ends «…Молоко». The cut walks code
 * points, not grapheme clusters, and taking the base letter out too would trade a plainer name
 * for a shorter one — no better for a decoration, and the only way to do it properly is
 * `Intl.Segmenter`, which this package would then carry into every browser that loads the domain
 * for the sake of one device name's last character (adversarial С4).
 */
export function deviceNameOrNull(value: string | null): string | null {
  if (value === null) return null

  // A tab between «iPhone» and «Safari» is a legal header value, and it used to take the whole
  // name down with it: `visibleLine` refuses a break, and `?? null` turned that into «unknown
  // device» (С3). Repaired here rather than refused, because a name is decoration.
  //
  // Trimmed **before** the cut as well as after, and the first one is not tidiness: a hundred
  // braille blanks in front of «iPhone» used to fill the whole budget, so the cut kept the
  // padding and threw away the only part that draws.
  const line = trimInvisibleEdges(pastedLine(value))
  const cut = line.length <= DEVICE_NAME_MAX ? line : cutToUnits(line, DEVICE_NAME_MAX)

  return deviceNameSchema.safeParse(trimInvisibleEdges(cut)).data ?? null
}

/**
 * How long a session lives from the last time it was used, and how stale «last used» has to get
 * before that is written down (MOL-53, owner's decision 22.09.2026 — «ориентир полгода» from the
 * task, confirmed as 180 days).
 *
 * **The term slides**, so the only person it ever throws out is one who did not open the app for
 * half a year; every visit pushes the date forward. And the two numbers belong together: the
 * same write moves `last_seen_at` and `expires_at`, because a term extended without moving
 * `last_seen_at` would put a date in MOL-57's device list that means nothing.
 *
 * Here rather than in the backend because they are facts about the domain's own entity — how
 * long a way in is good for — and because the cookie's `Max-Age` and the database's interval
 * have to be the same number or the browser drops a session the server still holds.
 */
export const SESSION_LIFETIME_DAYS = 180
export const SESSION_TOUCH_AFTER_HOURS = 24

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
export const newLoginRequestSchema = z
  .strictObject({
    id: z.uuid(),
    code: loginCodeSchema,
    deviceName: deviceNameSchema.nullable(),
    /**
     * The database's clock when the caller read one. The term is then judged against it and
     * not against the process's clock: two clocks in one request put every start out the
     * moment the API ran six minutes ahead of Postgres (adversarial А5).
     */
    createdAt: z.date().optional(),
    expiresAt: z.date(),
  })
  .refine(({ createdAt, expiresAt }) => expiresAt > (createdAt ?? new Date()), {
    path: ['expiresAt'],
    error: 'a login request cannot expire before it starts',
  })
export type NewLoginRequest = z.infer<typeof newLoginRequestSchema>

import {
  BROADCAST_TEXT_MAX,
  broadcastTextSchema,
  countrySchema,
  describeFailure,
} from '@molvia/model'
import type { TelegramUserId } from '@molvia/model'
import type {
  AudienceCount,
  BroadcastAudience,
  BroadcastRepository,
  BroadcastStatus,
} from '@/db/broadcasts-repository'

export const NOTIFY_USAGE =
  'usage: notify [--yes] [--country=AM,GE | --owner] < message.txt   |   notify --status   |   notify --cancel'

/** 0 — done or shown, 1 — refused or the database failed, nothing changed, 2 — the command was wrong. */
export type NotifyExit = 0 | 1 | 2

/**
 * The message to people about a leak (MOL-237), by hand on production — `dist/notify.js` in the
 * API's image, `make notify` in a copy, as `forget` (MOL-58). The text comes on standard input, so it
 * never has to be put on the server: `ssh molvia '… exec -T backend node dist/notify.js' < notice.txt`.
 *
 * A dry run unless `--yes`: the message as it will go and, by country, how many get it and how many
 * have the bot blocked. `--yes` queues it and the bot sends it within a minute; `--status` says how
 * far it got, `--cancel` stops it. What it prints is the owner's text and counts — never anyone.
 */
export async function notify(
  argv: readonly string[],
  broadcasts: BroadcastRepository,
  input: () => Promise<Uint8Array | null>,
  owner: TelegramUserId | null,
  write: (line: string) => void,
): Promise<NotifyExit> {
  const command = parse(argv)
  if (command === null) {
    write(NOTIFY_USAGE)
    return 2
  }
  try {
    if (command.kind === 'status') {
      for (const line of statusLines(await broadcasts.status(owner))) write(line)
      return 0
    }
    if (command.kind === 'cancel') {
      const stopped = await broadcasts.cancel()
      write(stopped > 0 ? 'cancelled: nothing more goes out.' : 'no broadcast is going.')
      return 0
    }

    let audience: BroadcastAudience
    if (command.audience === 'owner') {
      if (owner === null) {
        write('no OWNER_TELEGRAM_ID in this environment: there is nobody to try it on.')
        return 2
      }
      audience = { to: 'owner', owner }
    } else audience = command.audience

    const bytes = await input()
    if (bytes === null || bytes.length === 0) {
      write('the message comes on standard input: make notify FILE=notice.txt')
      write(NOTIFY_USAGE)
      return 2
    }
    const text = readText(bytes)
    if (typeof text !== 'string') {
      write(`message refused, nothing queued: ${text.refused}`)
      return 2
    }

    for (const line of messageLines(text)) write(line)
    for (const line of audienceLines(audience, await broadcasts.count(audience))) write(line)
    if (!command.yes) {
      write('dry run: nothing queued. Run again with --yes to send.')
      return 0
    }

    const queued = await broadcasts.queue(text, audience)
    if (queued === 'going') {
      write(
        'refused, nothing queued: a broadcast is still going. --status shows it, --cancel stops it.',
      )
      return 1
    }
    if (queued === 'nobody') {
      write('nobody to write to: nothing queued.')
      return 1
    }
    write(
      `queued #${String(queued.id)} for ${String(queued.total)}. ` +
        'The bot starts within a minute; --status shows how far it got.',
    )
    return 0
  } catch (error) {
    // The kind of failure and never its message, as `forget` says of its own.
    const failure = describeFailure(error)
    write(`notify failed, nothing changed: ${failure.code ?? failure.errorName}`)
    return 1
  }
}

type Command =
  | { readonly kind: 'status' }
  | { readonly kind: 'cancel' }
  | {
      readonly kind: 'send'
      readonly yes: boolean
      readonly audience: Exclude<BroadcastAudience, { to: 'owner' }> | 'owner'
    }

function parse(argv: readonly string[]): Command | null {
  const known = new Set(['--yes', '--owner', '--status', '--cancel'])
  let countries: string[] | null = null
  const flags = new Set<string>()
  for (const argument of argv) {
    if (argument.startsWith('--country=')) {
      if (countries !== null) return null
      countries = argument.slice('--country='.length).split(',')
    } else if (known.has(argument) && !flags.has(argument)) flags.add(argument)
    else return null
  }
  if (flags.has('--status') || flags.has('--cancel')) {
    if (flags.size !== 1 || countries !== null) return null
    return { kind: flags.has('--status') ? 'status' : 'cancel' }
  }
  const yes = flags.has('--yes')
  if (flags.has('--owner')) {
    return countries === null ? { kind: 'send', yes, audience: 'owner' } : null
  }
  if (countries === null) return { kind: 'send', yes, audience: { to: 'everybody' } }
  const codes = countries.map((country) => country.trim().toUpperCase())
  if (!codes.every((code) => countrySchema.safeParse(code).success)) return null
  return {
    kind: 'send',
    yes,
    audience: { to: 'countries', countries: [...new Set(codes)].sort() },
  }
}

/** The file's text as it will go, or why it cannot. */
function readText(bytes: Uint8Array): string | { readonly refused: string } {
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { refused: 'not UTF-8' }
  }
  const text = broadcastTextSchema.safeParse(raw)
  if (text.success) return text.data
  const length = raw.trim().length
  if (length > BROADCAST_TEXT_MAX) {
    return {
      refused: `${String(length)} characters of ${String(BROADCAST_TEXT_MAX)} Telegram takes`,
    }
  }
  return {
    refused:
      'nothing visible, a control character or a direction mark, or two empty lines in a row',
  }
}

function messageLines(text: string): string[] {
  return [
    `--- the message, ${String(text.length)} of ${String(BROADCAST_TEXT_MAX)} characters ---`,
    ...text.split('\n'),
    '--- end of the message ---',
  ]
}

function audienceName(countries: readonly string[] | null, ownerOnly: boolean): string {
  if (ownerOnly) return 'the owner alone'
  return countries === null ? 'everybody' : countries.join(', ')
}

function audienceLines(audience: BroadcastAudience, counts: readonly AudienceCount[]): string[] {
  const countries = audience.to === 'countries' ? audience.countries : null
  const total = counts.reduce((sum, row) => sum + row.recipients, 0)
  const blocked = counts.reduce((sum, row) => sum + row.blocked, 0)
  return [
    `to ${audienceName(countries, audience.to === 'owner')}:`,
    ...counts.map(
      (row) =>
        `  ${row.country}   gets it ${String(row.recipients).padStart(5)}   bot blocked ${String(row.blocked).padStart(5)}`,
    ),
    `  in all: ${String(total)} get it, ${String(blocked)} skipped — the bot is blocked`,
  ]
}

function statusLines(status: BroadcastStatus | null): string[] {
  if (status === null) return ['no broadcast yet.']
  const state =
    status.cancelledAt !== null
      ? `cancelled ${status.cancelledAt.toISOString()}`
      : status.finishedAt !== null
        ? `finished ${status.finishedAt.toISOString()}`
        : 'going'
  const lines = [
    `broadcast #${String(status.id)} to ${audienceName(status.countries, status.ownerOnly)}, ` +
      `queued ${status.createdAt.toISOString()}: ${state}`,
    `  queued for ${String(status.total)}, the bot blocked by ${String(status.blockedAtStart)} then`,
    `  sent ${String(status.sent)}   blocked since ${String(status.blocked)}   failed ${String(status.failed)}   ` +
      `${status.cancelledAt === null ? 'left' : 'not sent'} ${String(status.left)}`,
  ]
  // Erased, or the bot blocked, before their turn: nobody was skipped by mistake.
  const gone = status.total - status.sent - status.blocked - status.failed - status.left
  if (gone > 0)
    lines.push(`  dropped out before their turn ${String(gone)} — erased, or blocked the bot`)
  return lines
}

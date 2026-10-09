import { describe, expect, it, vi } from 'vitest'
import type {
  AudienceCount,
  BroadcastRepository,
  BroadcastStatus,
  QueuedBroadcast,
} from '@/db/broadcasts-repository'
import { NOTIFY_USAGE, notify } from '@/notify'

const OWNER = 184467331
const TEXT = 'Molvia: 12 октября …\n\nMolvia: on October 12 …'
const COUNTS: readonly AudienceCount[] = [
  { country: 'AM', recipients: 41, blocked: 3 },
  { country: 'GE', recipients: 6, blocked: 0 },
]

function repository(
  queued: QueuedBroadcast | 'going' | 'nobody' = { id: 2, total: 47, blockedAtStart: 3 },
  status: readonly BroadcastStatus[] = [],
) {
  const mocks = {
    count: vi.fn<BroadcastRepository['count']>(() => Promise.resolve(COUNTS)),
    queue: vi.fn<BroadcastRepository['queue']>(() => Promise.resolve(queued)),
    claim: vi.fn<BroadcastRepository['claim']>(() => Promise.resolve(null)),
    done: vi.fn<BroadcastRepository['done']>(() => Promise.resolve()),
    status: vi.fn<BroadcastRepository['status']>(() => Promise.resolve(status)),
    cancel: vi.fn<BroadcastRepository['cancel']>(() => Promise.resolve(1)),
  }
  return mocks
}

async function run(
  argv: string[],
  {
    text = TEXT,
    repo = repository(),
    owner = OWNER,
  }: {
    readonly text?: string | Uint8Array | null
    readonly repo?: ReturnType<typeof repository>
    readonly owner?: number | null
  } = {},
) {
  const lines: string[] = []
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text
  const exit = await notify(
    argv,
    repo,
    () => Promise.resolve(bytes),
    owner,
    (line) => lines.push(line),
  )
  return { exit, lines, repo }
}

describe('notify — сухой прогон (MOL-237)', () => {
  it('печатает текст как уйдёт и сколько получат по странам, ничего не ставит', async () => {
    const { exit, lines, repo } = await run([])
    expect(exit).toBe(0)
    expect(lines).toContain('Molvia: on October 12 …')
    expect(lines.some((line) => line.includes(`${String(TEXT.length)} of 4096`))).toBe(true)
    expect(lines).toContain('to everybody:')
    expect(lines.some((line) => /AM\s+gets it\s+41\s+bot blocked\s+3/.test(line))).toBe(true)
    expect(lines).toContain('  in all: 47 get it, 3 skipped — the bot is blocked')
    expect(lines.at(-1)).toMatch(/dry run: nothing queued/)
    expect(repo.queue).not.toHaveBeenCalled()
  })

  it('страны — заглавными, без повторов, по алфавиту', async () => {
    const { repo } = await run(['--country=ge,AM,GE'])
    expect(repo.count).toHaveBeenCalledWith({ to: 'countries', countries: ['AM', 'GE'] })
  })

  it('пробная — владельцу из окружения', async () => {
    const { repo } = await run(['--owner'])
    expect(repo.count).toHaveBeenCalledWith({ to: 'owner', owner: OWNER })
  })

  it('пробная без OWNER_TELEGRAM_ID — отказ до базы', async () => {
    const { exit, lines, repo } = await run(['--owner', '--yes'], { owner: null })
    expect(exit).toBe(2)
    expect(lines[0]).toMatch(/no OWNER_TELEGRAM_ID/)
    expect(repo.count).not.toHaveBeenCalled()
  })
})

describe('notify — --yes', () => {
  it('ставит в очередь тот же текст тем же людям', async () => {
    const { exit, lines, repo } = await run(['--yes', '--country=AM'])
    expect(exit).toBe(0)
    expect(repo.queue).toHaveBeenCalledWith(TEXT, { to: 'countries', countries: ['AM'] })
    expect(lines.at(-1)).toMatch(/^queued #2 for 47\./)
  })

  it('идёт другая — отказ, код 1', async () => {
    const { exit, lines } = await run(['--yes'], { repo: repository('going') })
    expect(exit).toBe(1)
    expect(lines.at(-1)).toMatch(/a broadcast is still going/)
  })

  it('некому — ничего не поставлено, код 1', async () => {
    const { exit, lines } = await run(['--yes'], { repo: repository('nobody') })
    expect(exit).toBe(1)
    expect(lines.at(-1)).toBe('nobody to write to: nothing queued.')
  })

  it('отказ базы — по коду, без сообщения драйвера', async () => {
    const repo = repository()
    repo.queue.mockRejectedValue(
      Object.assign(new Error('insert into broadcasts … 184467331'), { code: '57P01' }),
    )
    const { exit, lines } = await run(['--yes'], { repo })
    expect(exit).toBe(1)
    expect(lines.at(-1)).toBe('notify failed, nothing changed: 57P01')
    expect(lines.join('\n')).not.toContain('184467331')
  })
})

describe('notify — текст', () => {
  it.each([
    ['пусто', ''],
    ['нет входа', null],
  ])('%s — подсказка, как подать файл', async (_, text) => {
    const { exit, lines, repo } = await run([], { text })
    expect(exit).toBe(2)
    expect(lines).toContain(NOTIFY_USAGE)
    expect(repo.count).not.toHaveBeenCalled()
  })

  it('не UTF-8 — отказ', async () => {
    const { exit, lines } = await run([], { text: new Uint8Array([0xd0, 0x28]) })
    expect(exit).toBe(2)
    expect(lines[0]).toBe('message refused, nothing queued: not UTF-8')
  })

  it('длиннее 4096 — отказ с длиной', async () => {
    const { exit, lines } = await run([], { text: 'я'.repeat(4097) })
    expect(exit).toBe(2)
    expect(lines[0]).toBe('message refused, nothing queued: 4097 characters of 4096 Telegram takes')
  })

  it('две пустые строки подряд — отказ с причиной', async () => {
    const { exit, lines } = await run([], { text: 'ru\n\n\nen' })
    expect(exit).toBe(2)
    expect(lines[0]).toMatch(/two empty lines in a row/)
  })
})

describe('notify — аргументы', () => {
  it.each([
    [['--force']],
    [['--yes', '--yes']],
    [['--owner', '--country=AM']],
    [['--country=AM', '--country=GE']],
    [['--country=ARM']],
    [['--country=']],
    [['--status', '--yes']],
    [['--status', '--cancel']],
    [['--cancel', '--country=AM']],
    [['message.txt']],
  ])('%j — usage, код 2', async (argv) => {
    const { exit, lines, repo } = await run(argv)
    expect(exit).toBe(2)
    expect(lines).toEqual([NOTIFY_USAGE])
    expect(repo.queue).not.toHaveBeenCalled()
    expect(repo.cancel).not.toHaveBeenCalled()
  })
})

describe('notify — ход и отмена', () => {
  const status: BroadcastStatus = {
    id: 3,
    ownerOnly: false,
    countries: null,
    createdAt: new Date('2026-10-09T19:41:00.000Z'),
    total: 49,
    blockedAtStart: 4,
    sent: 36,
    blocked: 1,
    failed: 0,
    left: 11,
    finishedAt: null,
    cancelledAt: null,
  }

  it('--status: счётчики последней, без чтения входа', async () => {
    const input = vi.fn(() => Promise.resolve(null))
    const lines: string[] = []
    const exit = await notify(['--status'], repository(undefined, [status]), input, OWNER, (line) =>
      lines.push(line),
    )
    expect(exit).toBe(0)
    expect(input).not.toHaveBeenCalled()
    expect(lines).toEqual([
      'broadcast #3 to everybody, queued 2026-10-09T19:41:00.000Z: going',
      '  queued for 49, the bot blocked by 4 then',
      '  sent 36   blocked since 1   failed 0   left 11',
      '  dropped out before their turn 1 — erased, or blocked the bot',
    ])
  })

  it('--status: отменённая — «not sent»; рассылок не было — так и сказано', async () => {
    const cancelled = { ...status, cancelledAt: new Date('2026-10-09T19:45:00.000Z'), left: 12 }
    const { lines } = await run(['--status'], { repo: repository(undefined, [cancelled]) })
    expect(lines[0]).toMatch(/: cancelled 2026-10-09T19:45:00.000Z$/)
    expect(lines[2]).toMatch(/not sent 12$/)
    expect((await run(['--status'])).lines).toEqual(['no broadcast yet.'])
  })

  it('--status: рассылка людям и пробная после неё — обе, по очереди', async () => {
    const tried = {
      ...status,
      id: 4,
      ownerOnly: true,
      total: 1,
      blockedAtStart: 0,
      sent: 1,
      blocked: 0,
      left: 0,
      finishedAt: new Date('2026-10-09T19:43:00.000Z'),
    }
    const { lines } = await run(['--status'], { repo: repository(undefined, [status, tried]) })
    expect(lines.filter((line) => line.startsWith('broadcast #'))).toEqual([
      'broadcast #3 to everybody, queued 2026-10-09T19:41:00.000Z: going',
      'broadcast #4 to the owner alone, queued 2026-10-09T19:41:00.000Z: finished 2026-10-09T19:43:00.000Z',
    ])
  })

  it('--cancel останавливает', async () => {
    const { exit, lines, repo } = await run(['--cancel'])
    expect(exit).toBe(0)
    expect(repo.cancel).toHaveBeenCalled()
    expect(lines).toEqual(['cancelled: nothing more goes out.'])
  })
})

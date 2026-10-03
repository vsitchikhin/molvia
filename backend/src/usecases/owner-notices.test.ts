import { describe, expect, it, vi } from 'vitest'
import { describeFailure } from '@molvia/model'
import type { OwnerNotice } from '@molvia/model'
import type { OwnerNoticeRepository } from '@/db/owner-notices-repository'
import { claimOwnerNotices } from './owner-notices'

const AT = new Date('2026-10-03T10:00:00.000Z')
const NOTICE: OwnerNotice = {
  kind: 'failure',
  source: 'api',
  errorName: 'TypeError',
  build: 'v0.2.0',
  fingerprint: 'abcdef',
}

function repository(payloads: unknown[]) {
  const claim = vi.fn<OwnerNoticeRepository['claim']>(() => Promise.resolve(payloads))
  const notices: Pick<OwnerNoticeRepository, 'claim'> = { claim }
  return { notices, claim }
}

describe('claimOwnerNotices (MOL-143)', () => {
  it('без владельца — пусто и очередь не трогается', async () => {
    const { notices, claim } = repository([NOTICE])
    expect(await claimOwnerNotices(notices, null, AT, vi.fn())).toEqual({ to: null, notices: [] })
    expect(claim).not.toHaveBeenCalled()
  })

  it('с владельцем — кому и что', async () => {
    const { notices, claim } = repository([NOTICE])
    expect(await claimOwnerNotices(notices, 4242, AT, vi.fn())).toEqual({
      to: 4242,
      notices: [NOTICE],
    })
    expect(claim).toHaveBeenCalledWith(20, AT)
  })

  it('нечитаемое не выдаётся, а называется один раз', async () => {
    const unreadable = vi.fn()
    const { notices } = repository([{ kind: 'failure', errorName: 'x' }, NOTICE])
    expect((await claimOwnerNotices(notices, 4242, AT, unreadable)).notices).toEqual([NOTICE])
    expect(unreadable).toHaveBeenCalledTimes(1)
    const [failure] = unreadable.mock.calls[0] as [unknown]
    expect(describeFailure(failure)).toMatchObject({
      errorName: 'OwnerNoticeUnreadable',
      code: 'OWNER_NOTICE_UNREADABLE',
    })
    expect(describeFailure(failure).frames?.length).toBeGreaterThan(0)
  })
})

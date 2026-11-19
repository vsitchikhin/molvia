import { expectWithin } from '@molvia/model/testing/clock'
import { describe, expect, it } from 'vitest'
import { statementLineKeys, statementLinkOf } from '#model/entities/statement-line'
import type {
  Statement,
  StatementForm,
  StatementLine,
  StatementLink,
} from '#model/entities/statement-line'
import {
  exchangeCandidate,
  matchStatement,
  spendingCandidate,
  transferCandidate,
  tripCandidate,
} from '#model/entities/statement-match'
import type {
  StatementCandidate,
  StatementDoubt,
  StatementLineDecision,
} from '#model/entities/statement-match'
import type { Currency, Money } from '#model/values/money'

// The bench's rounds of MOL-409 (`research/MOL-409/bench/match.test.mjs`, А1…Н1), each as the
// behaviour of the domain's rule, then what MOL-428 and the owner's В-1, В-2 added.

const PERSON = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const AMERIA = 'a1a1a1a1-0000-4000-8000-000000000001'
const TBANK = 'b2b2b2b2-0000-4000-8000-000000000002'
const ARDSHIN = 'c3c3c3c3-0000-4000-8000-000000000003'

let seq = 0
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

/** «5398.00» → hundredths; every currency here prints two digits. */
const cash = (amount: string, currency: Currency): Money => ({
  minor: BigInt(amount.replace('.', '')),
  currency,
})

interface RecordOptions {
  place?: string
  account?: string
  debited?: [string, Currency]
  removed?: boolean
  link?: StatementLink
}

const spending = (day: string, amount: string, currency: Currency, o: RecordOptions = {}) =>
  spendingCandidate(
    {
      id: nextId(),
      spentOn: day,
      amount: cash(amount, currency),
      debited: o.debited ? cash(...o.debited) : null,
      accountId: o.account ?? null,
      place: o.place ?? null,
      note: null,
    },
    { removed: o.removed ?? false, link: o.link ?? null },
  )

const trip = (
  day: string,
  receipt: string,
  currency: Currency,
  o: RecordOptions & { at?: string } = {},
) => {
  const c = tripCandidate(
    {
      id: nextId(),
      startedAt: new Date(o.at ?? `${day}T08:00:00.000Z`),
      startedOn: o.at ? null : day,
      finishedAt: new Date(o.at ?? `${day}T09:00:00.000Z`),
      finishedOn: o.at ? null : day,
      accountId: o.account ?? null,
      debited: o.debited ? cash(...o.debited) : null,
      receipt: cash(receipt, currency),
      expenses: [],
      placeName: o.place ?? 'Ереван Сити',
    },
    { removed: false, link: o.link ?? null },
  )
  if (c === null) throw new Error('a finished trip with money is a candidate')
  return c
}

/** A transfer from an account; where it went the rule never reads (review №2). */
const transfer = (day: string, amount: string, from: string, link: StatementLink | null = null) =>
  transferCandidate(
    {
      id: nextId(),
      fromAccountId: from,
      amount: cash(amount, 'AMD'),
      transferredOn: day,
      note: null,
    },
    { removed: false, link },
  )

const line = (
  day: string,
  amount: string,
  currency: Currency,
  payee: string,
  o: Partial<StatementLine> = {},
): StatementLine => ({
  day,
  postedOn: null,
  time: null,
  amount: cash(amount, currency),
  debited: null,
  sign: '-',
  payee,
  mcc: null,
  bankCategory: null,
  status: 'posted',
  kind: 'unknown',
  ...o,
})

interface StatementOptions {
  account?: string | null
  form?: StatementForm
  period?: Statement['period']
}

const statementOf = (lines: StatementLine[], o: StatementOptions = {}): Statement => ({
  form: o.form ?? 'ameria-csv',
  accountId: o.account ?? null,
  period: o.period ?? null,
  lines,
})

const match = (
  candidates: StatementCandidate[],
  lines: StatementLine[],
  o: StatementOptions = {},
) => matchStatement(PERSON, statementOf(lines, o), candidates)

const decide = (
  candidates: StatementCandidate[],
  lines: StatementLine[],
  o: StatementOptions = {},
) => match(candidates, lines, o).lines.map((l) => l.decision)

/** The key a line of this statement gets, for a record linked to it. */
const keyOf = (l: StatementLine, account: string | null = null) =>
  statementLineKeys(PERSON, { accountId: account, lines: [l] })[0] ?? ''

const linkTo = (
  o: Partial<StatementLink> & Pick<StatementLink, 'day' | 'form'>,
): StatementLink => ({
  key: nextId(),
  accountId: null,
  postedOn: null,
  pending: false,
  amount: cash('1.00', 'AMD'),
  payee: '',
  time: null,
  ...o,
})

const recorded = (c: StatementCandidate, doubt: StatementDoubt | null = null) => ({
  group: 'recorded',
  record: { id: c.id, what: c.what },
  doubt,
})
const NEW = { group: 'new', ticked: true, note: null, categoryHint: null }
const group = (d: StatementLineDecision | undefined) => d?.group

describe('matchStatement — the bench, round 1 (А)', () => {
  it('А1: a line in the account’s currency finds a record in another by its «списано»', () => {
    const s = spending('2026-11-14', '96.00', 'GEL', {
      place: 'LONDA',
      debited: ['14160.00', 'AMD'],
      account: AMERIA,
    })
    const t = trip('2026-11-14', '48.00', 'GEL', {
      place: 'LONDA',
      debited: ['7080.00', 'AMD'],
      account: AMERIA,
    })
    expect(
      decide(
        [s, t],
        [
          line('2026-11-14', '14160.00', 'AMD', 'Ք: LONDA TBILISI GE'),
          line('2026-11-14', '7080.00', 'AMD', 'Ք: LONDA TBILISI GE'),
        ],
      ),
    ).toEqual([recorded(s), recorded(t)])
  })

  it('А2: a tip up to a fifth over the bill is a doubt; more is a new spending', () => {
    const t = trip('2026-11-14', '96.00', 'GEL', { place: 'LONDA' })
    expect(decide([t], [line('2026-11-14', '105.60', 'GEL', 'LONDA')])).toEqual([
      recorded(t, 'tip'),
    ])
    expect(decide([t], [line('2026-11-14', '120.00', 'GEL', 'LONDA')])).toEqual([NEW])
  })

  it('А3: one record, one line; the second like it is new', () => {
    const s = spending('2026-11-14', '1200.00', 'AMD', { place: 'Yandex Go' })
    expect(
      decide(
        [s],
        [
          line('2026-11-14', '1200.00', 'AMD', 'YANDEX.GO'),
          line('2026-11-14', '1200.00', 'AMD', 'YANDEX.GO'),
        ],
      ),
    ).toEqual([recorded(s), NEW])
  })

  it('А4: the name decides between two records of one sum, across scripts, in either order', () => {
    const t = trip('2026-11-14', '1200.00', 'AMD')
    const s = spending('2026-11-14', '1200.00', 'AMD', { place: 'Yandex Go' })
    const taxi = line('2026-11-14', '1200.00', 'AMD', 'YANDEX.GO YEREVAN')
    const yc = line('2026-11-14', '1200.00', 'AMD', 'Ք: YEREVAN CITY AVAN YEREVAN AM 19')
    expect(decide([s, t], [taxi, yc])).toEqual([recorded(s), recorded(t)])
    expect(decide([t, s], [yc, taxi])).toEqual([recorded(t), recorded(s)])
  })

  it('А5: a removed spending met is a doubt', () => {
    const s = spending('2026-11-14', '3500.00', 'AMD', { place: 'Аптека', removed: true })
    expect(decide([s], [line('2026-11-14', '3500.00', 'AMD', 'PHARMACY')])).toEqual([
      recorded(s, 'removed'),
    ])
  })

  it('А6, В-1 «а»: a record on another account is a doubt; one with no account may be it', () => {
    const other = spending('2026-11-14', '2500.00', 'AMD', { place: 'Zovq Bar', account: TBANK })
    const none = spending('2026-11-14', '2500.00', 'AMD', { place: 'Zovq Bar' })
    const zovq = [line('2026-11-14', '2500.00', 'AMD', 'ZOVQ BAR')]
    expect(decide([other], zovq, { account: ARDSHIN })).toEqual([recorded(other, 'other_account')])
    expect(decide([none], zovq, { account: ARDSHIN })).toEqual([recorded(none)])
  })

  it('А7: a trip with no phone’s day is dated by its moment in Yerevan', () => {
    const t = trip('2026-11-14', '5398.00', 'AMD', { at: '2026-11-13T21:30:00.000Z' })
    expect(t.days).toEqual(['2026-11-14'])
  })

  it('А8: a recorded transfer between one’s own accounts makes the line no spending', () => {
    const tr = transfer('2026-11-14', '50000.00', ARDSHIN)
    expect(
      decide([tr], [line('2026-11-14', '50000.00', 'AMD', 'Amount transfer from card to card')], {
        account: ARDSHIN,
      }),
    ).toEqual([
      { group: 'not_spending', reason: 'own_transfer', record: { id: tr.id, what: 'transfer' } },
    ])
  })

  it('А9: a line with no sign is no spending and settles nothing', () => {
    const s = spending('2026-11-14', '1200.00', 'AMD', { place: 'Yandex Go' })
    const unsigned = { group: 'not_spending', reason: 'unsigned', record: null }
    expect(
      decide(
        [s],
        [
          line('2026-11-14', '500000.00', 'AMD', 'Եկամուտ', { sign: null }),
          line('2026-11-15', '1200.00', 'AMD', 'YANDEX.GO', { sign: null }),
        ],
      ),
    ).toEqual([unsigned, unsigned])
  })
})

describe('matchStatement — round 2 (Б)', () => {
  it('Б1а: a transfer onto the card settles no purchase from it — only a line of the source account', () => {
    const into = transfer('2026-11-14', '50000.00', AMERIA)
    expect(
      decide([into], [line('2026-11-15', '50000.00', 'AMD', 'ZOVQ BAR')], { account: ARDSHIN }),
    ).toEqual([NEW])
    const out = transfer('2026-11-14', '50000.00', ARDSHIN)
    expect(
      group(
        decide([out], [line('2026-11-14', '50000.00', 'AMD', 'card to card')], {
          account: ARDSHIN,
        })[0],
      ),
    ).toBe('not_spending')
  })

  it('Б1б: a tip on a transfer and a transfer with no statement account are doubts', () => {
    const out = transfer('2026-11-14', '50000.00', ARDSHIN)
    expect(
      decide([out], [line('2026-11-16', '57500.00', 'AMD', 'VEGA')], { account: ARDSHIN }),
    ).toEqual([recorded(out, 'tip')])
    expect(decide([out], [line('2026-11-14', '50000.00', 'AMD', 'card to card')])).toEqual([
      recorded(out, 'transfer'),
    ])
  })

  it('Б2: one to one by the greatest number of pairs — both rides find their records', () => {
    const a = spending('2026-11-14', '1200.00', 'AMD', { place: 'Yandex Go' })
    const b = spending('2026-11-15', '1200.00', 'AMD', { place: 'Yandex Go' })
    const out = decide(
      [a, b],
      [
        line('2026-11-13', '1200.00', 'AMD', 'YANDEX.GO'),
        line('2026-11-14', '1200.00', 'AMD', 'YANDEX.GO'),
      ],
    )
    expect(out.map(group)).toEqual(['recorded', 'recorded'])
  })

  it('Б3: a place written in Armenian or Georgian meets the bank’s Latin', () => {
    const taxi = spending('2026-11-14', '1200.00', 'AMD', { place: 'Yandex Go' })
    const bolt = spending('2026-11-14', '48.00', 'GEL', { place: 'Bolt' })
    const am = trip('2026-11-14', '1200.00', 'AMD', { place: 'Երևան Սիթի' })
    const ge = trip('2026-11-14', '48.00', 'GEL', { place: 'თავისუფლება' })
    expect(
      decide(
        [taxi, bolt, am, ge],
        [
          line('2026-11-14', '1200.00', 'AMD', 'Ք: YEREVAN CITY AVAN YEREVAN AM 19'),
          line('2026-11-14', '48.00', 'GEL', 'TAVISUPLEBA TBILISI GE'),
        ],
      ),
    ).toEqual([recorded(am), recorded(ge)])
  })

  it('Б4: a record whose name meets the payee in no word is a doubt; one with no name is met', () => {
    const named = spending('2026-11-14', '1200.00', 'AMD', { place: 'Такси наличными' })
    const bare = spending('2026-11-14', '1200.00', 'AMD')
    const farm = [line('2026-11-14', '1200.00', 'AMD', 'NATALI FARM')]
    expect(decide([named], farm, { account: ARDSHIN })).toEqual([recorded(named, 'other_name')])
    expect(decide([bare], farm, { account: ARDSHIN })).toEqual([recorded(bare)])
  })
})

describe('matchStatement — round 3 (В)', () => {
  it('В1: a line the bank declined is no spending and settles nothing; the payment again finds the record', () => {
    const s = spending('2026-11-12', '2990.00', 'RUB', { place: 'Ozon' })
    const declined = { group: 'not_spending', reason: 'declined', record: null }
    expect(
      decide(
        [s],
        [
          line('2026-11-12', '2990.00', 'RUB', 'OZON', { status: 'declined' }),
          line('2026-11-12', '2990.00', 'RUB', 'OZON'),
          line('2026-11-12', '15400.00', 'RUB', 'AEROFLOT', { status: 'declined' }),
        ],
      ),
    ).toEqual([declined, recorded(s), declined])
  })

  it('В2а: a record settled by a line of another upload settles no other line; its own, yes', () => {
    const oct31 = line('2026-10-31', '1200.00', 'AMD', 'YANDEX.GO')
    const s = spending('2026-10-31', '1200.00', 'AMD', {
      place: 'Yandex Go',
      link: linkTo({ key: keyOf(oct31), day: '2026-10-31', form: 'ameria-csv' }),
    })
    expect(decide([s], [line('2026-11-02', '1200.00', 'AMD', 'YANDEX.GO')])).toEqual([NEW])
    expect(decide([s], [oct31])).toEqual([recorded(s)])
  })

  it('В2б: a transfer settles only a line calling itself a transfer; a purchase of its sum is a doubt', () => {
    const out = transfer('2026-10-31', '50000.00', ARDSHIN)
    expect(
      decide([out], [line('2026-11-02', '50000.00', 'AMD', 'AM\\YEREVAN\\VEGA')], {
        account: ARDSHIN,
      }),
    ).toEqual([recorded(out, 'transfer')])
  })

  it('В3: a purchase and its whole refund in one file — the purchase new and not ticked, the refund none', () => {
    expect(
      decide(
        [],
        [
          line('2026-11-12', '2990.00', 'RUB', 'OZON'),
          line('2026-11-13', '2990.00', 'RUB', 'OZON', { sign: '+' }),
          line('2026-11-12', '2990.00', 'RUB', 'WILDBERRIES'),
        ],
      ),
    ).toEqual([
      { group: 'new', ticked: false, note: 'refunded', categoryHint: null },
      { group: 'not_spending', reason: 'refund', record: null },
      NEW,
    ])
  })

  it('В4: a posting under its hold by the same name is a doubt; another name or under half is new', () => {
    const hold = spending('2026-11-12', '15000.00', 'AMD', {
      place: 'GAZPROM ARMENIA',
      account: ARDSHIN,
    })
    const one = (payee: string, amount: string) =>
      decide([hold], [line('2026-11-14', amount, 'AMD', payee)], { account: ARDSHIN })[0]
    expect(one('AM\\YEREVAN\\GAZPROM ARMENIA', '11800.00')).toEqual(recorded(hold, 'hold'))
    expect(one('AM\\YEREVAN\\ZOVQ BAR', '11800.00')).toEqual(NEW)
    expect(one('AM\\YEREVAN\\GAZPROM ARMENIA', '7000.00')).toEqual(NEW)
  })
})

describe('matchStatement — round 4 (Г)', () => {
  const card = 'Amount transfer from card to card'

  it('Г1: a transfer settled by its line settles no next one; on another day it is a doubt, never missed', () => {
    const own = line('2026-10-31', '50000.00', 'AMD', card)
    const linked = transfer(
      '2026-10-31',
      '50000.00',
      ARDSHIN,
      linkTo({
        key: keyOf(own, ARDSHIN),
        accountId: ARDSHIN,
        day: '2026-10-31',
        form: 'ardshin-xlsx',
      }),
    )
    const rent = [line('2026-11-02', '50000.00', 'AMD', card)]
    const o = { account: ARDSHIN, form: 'ardshin-xlsx' } as const
    expect(decide([linked], rent, o)).toEqual([NEW])
    const out = transfer('2026-10-31', '50000.00', ARDSHIN)
    expect(decide([out], rent, o)).toEqual([recorded(out, 'transfer')])
    expect(group(decide([out], [own], o)[0])).toBe('not_spending')
  })

  it('Г2: a link lets in the same operation in another form, and a hold’s posting; another ride — no', () => {
    const taxi = spending('2026-11-14', '1200.00', 'AMD', {
      place: 'Yandex Go',
      account: AMERIA,
      link: linkTo({ day: '2026-11-14', form: 'screenshot' }),
    })
    expect(
      decide([taxi], [line('2026-11-14', '1200.00', 'AMD', 'Ք: YANDEX.GO YEREVAN AM')], {
        account: AMERIA,
      }),
    ).toEqual([recorded(taxi)])
    const fuel = (pending: boolean) =>
      spending('2026-11-12', '15000.00', 'AMD', {
        place: 'Gazprom Armenia',
        account: ARDSHIN,
        link: linkTo({ day: '2026-11-12', form: 'screenshot', pending }),
      })
    // A file dates the posting by the operation, the hold's day (Д2); a line of it days later is another.
    const gas = 'AM\\YEREVAN\\GAZPROM ARMENIA'
    const post = [line('2026-11-12', '15000.00', 'AMD', gas, { postedOn: '2026-11-14' })]
    const o = { account: ARDSHIN, form: 'ardshin-xlsx' } as const
    expect(group(decide([fuel(true)], post, o)[0])).toBe('recorded')
    expect(decide([fuel(true)], [line('2026-11-14', '15000.00', 'AMD', gas)], o)).toEqual([NEW])
    const fromLine = spending('2026-10-31', '1200.00', 'AMD', {
      place: 'YANDEX.GO',
      account: ARDSHIN,
      link: linkTo({ day: '2026-10-31', form: 'ardshin-xlsx' }),
    })
    expect(decide([fromLine], [line('2026-11-02', '1200.00', 'AMD', 'YANDEX.GO')], o)).toEqual([
      NEW,
    ])
  })

  it('Г3: a purchase in the same chain cheaper than a record with no account is new, not its hold', () => {
    const noAccount = spending('2026-11-12', '8000.00', 'AMD', { place: 'Yerevan City' })
    expect(
      decide(
        [noAccount],
        [line('2026-11-13', '5000.00', 'AMD', 'Ք: YEREVAN CITY AVAN YEREVAN AM 19')],
        { account: AMERIA },
      ),
    ).toEqual([NEW])
  })

  it('Г4: a refund of a recorded spending is no spending, said with it; from another payee — without', () => {
    const ozon = spending('2026-11-12', '2990.00', 'RUB', { place: 'Ozon', account: TBANK })
    const out = decide(
      [ozon],
      [
        line('2026-11-12', '2990.00', 'RUB', 'OZON'),
        line('2026-11-13', '2990.00', 'RUB', 'OZON', { sign: '+' }),
        line('2026-11-13', '2990.00', 'RUB', 'Кэшбэк', { sign: '+' }),
      ],
      { account: TBANK },
    )
    expect(out).toEqual([
      recorded(ozon),
      { group: 'not_spending', reason: 'refund', record: { id: ozon.id, what: 'spending' } },
      { group: 'not_spending', reason: 'income', record: null },
    ])
  })
})

describe('matchStatement — rounds 5–6 (Д, Е)', () => {
  it('Д1: a line nearer the record than its link’s line is a doubt «пересвязать»; further — new', () => {
    const taxi = spending('2026-10-31', '1200.00', 'AMD', {
      place: 'Yandex Go',
      account: ARDSHIN,
      link: linkTo({ day: '2026-11-02', form: 'screenshot' }),
    })
    const one = (day: string) =>
      decide([taxi], [line(day, '1200.00', 'AMD', 'AM\\YEREVAN\\YANDEX.GO')], {
        account: ARDSHIN,
        form: 'ardshin-xlsx',
      })[0]
    expect(one('2026-10-31')).toEqual(recorded(taxi, 'relink'))
    expect(one('2026-10-29')).toEqual(NEW)
  })

  it('Д2: a line of another form is the operation on the link’s day ± 1; of the same form, only by its key', () => {
    const ozon = (form: StatementForm) =>
      spending('2026-11-15', '2990.00', 'RUB', {
        place: 'Ozon',
        account: TBANK,
        link: linkTo({ day: '2026-11-15', form }),
      })
    const csv = [line('2026-11-14', '2990.00', 'RUB', 'OZON')]
    const o = { account: TBANK, form: 'tbank-csv' } as const
    expect(group(decide([ozon('screenshot')], csv, o)[0])).toBe('recorded')
    expect(decide([ozon('tbank-csv')], csv, o)).toEqual([NEW])
  })

  it('Д3: a hold the statement after it shows no posting of — «убрать трату?»; one posted — no', () => {
    const deposit = spending('2026-11-12', '40000.00', 'AMD', {
      place: 'Tufenkian Hotel',
      account: ARDSHIN,
      link: linkTo({ day: '2026-11-12', form: 'screenshot', pending: true }),
    })
    const o = {
      account: ARDSHIN,
      form: 'ardshin-xlsx',
      period: { from: '2026-11-01', to: '2026-11-30' },
    } as const
    const taxi = line('2026-11-30', '1200.00', 'AMD', 'YANDEX.GO')
    expect(match([deposit], [taxi], o).unposted).toEqual([
      { record: { id: deposit.id, what: 'spending' }, settled: true, ticked: true },
    ])
    const posted = match(
      [deposit],
      [taxi, line('2026-11-12', '40000.00', 'AMD', 'TUFENKIAN HOTEL', { postedOn: '2026-11-14' })],
      o,
    )
    expect(posted.lines[1]?.decision).toEqual(recorded(deposit))
    expect(posted.unposted).toEqual([])
  })

  it('Е1: the same line on a second screenshot, read otherwise, is a doubt; a second file of one form — new', () => {
    const ride = (form: StatementForm) =>
      spending('2026-11-14', '1200.00', 'AMD', {
        place: 'Yandex.Go',
        account: AMERIA,
        link: linkTo({ day: '2026-11-14', form }),
      })
    const again = [line('2026-11-14', '1200.00', 'AMD', 'Yandex Go')]
    const s = ride('screenshot')
    expect(decide([s], again, { account: AMERIA, form: 'screenshot' })).toEqual([
      recorded(s, 'same_screenshot'),
    ])
    expect(decide([ride('ameria-csv')], again, { account: AMERIA, form: 'ameria-csv' })).toEqual([
      NEW,
    ])
  })

  it('Е2: another form on the next day is the operation only for a form whose day moves', () => {
    const taxi = (form: StatementForm) =>
      spending('2026-10-31', '1200.00', 'AMD', {
        place: 'Yandex Go',
        account: ARDSHIN,
        link: linkTo({ day: '2026-10-31', form }),
      })
    const today = [line('2026-11-01', '1200.00', 'AMD', 'Yandex Go')]
    const o = { account: ARDSHIN, form: 'screenshot' } as const
    expect(decide([taxi('ardshin-xlsx')], today, o)).toEqual([NEW])
    expect(group(decide([taxi('tbank-csv')], today, o)[0])).toBe('recorded')
  })

  it('Е3: a hold posted later than a week by its name is a doubt «проводка холда?» on a screenshot; a file says it outright', () => {
    const hotel = spending('2026-11-20', '40000.00', 'AMD', {
      place: 'Tufenkian Hotel',
      account: ARDSHIN,
      link: linkTo({ day: '2026-11-20', form: 'screenshot', pending: true }),
    })
    const shot = { account: ARDSHIN, form: 'screenshot' } as const
    const late = match([hotel], [line('2026-11-29', '40000.00', 'AMD', 'Tufenkian Hotel')], shot)
    expect(late.lines[0]?.decision).toEqual(recorded(hotel, 'late_post'))
    expect(late.unposted).toEqual([])
    expect(decide([hotel], [line('2026-11-29', '40000.00', 'AMD', 'Vega')], shot)).toEqual([NEW])
    // A file prints the hold's own day and its late posting beside it: the operation, no doubt (Д2).
    const o = {
      account: ARDSHIN,
      form: 'ardshin-xlsx',
      period: { from: '2026-11-01', to: '2026-11-30' },
    } as const
    const posted = line('2026-11-20', '40000.00', 'AMD', 'AM\\DILIJAN\\TUFENKIAN HOTEL', {
      postedOn: '2026-11-29',
    })
    const file = match([hotel], [posted], o)
    expect(file.lines[0]?.decision).toEqual(recorded(hotel))
    expect(file.unposted).toEqual([])
  })

  it('Е4: a file begun later than the day after the hold asks nothing of it', () => {
    const fuel = spending('2026-11-12', '15000.00', 'AMD', {
      place: 'Gazprom Armenia',
      account: ARDSHIN,
      link: linkTo({ day: '2026-11-12', form: 'screenshot', pending: true }),
    })
    expect(
      match([fuel], [line('2026-11-25', '6400.00', 'AMD', 'SAS Supermarket')], {
        account: ARDSHIN,
        form: 'screenshot',
      }).unposted,
    ).toEqual([])
  })
})

describe('matchStatement — rounds 7–13 (Ж…Н)', () => {
  it('Ж1: «убрать трату?» is ticked only for a bank’s file with a period; by a screenshot — not', () => {
    const fuel = spending('2026-11-12', '15000.00', 'RUB', {
      place: 'Лукойл',
      account: TBANK,
      link: linkTo({ day: '2026-11-12', form: 'screenshot', pending: true }),
    })
    const taxis = [
      line('2026-11-11', '640.00', 'RUB', 'Яндекс Go'),
      line('2026-11-26', '580.00', 'RUB', 'Яндекс Go'),
    ]
    const ref = { id: fuel.id, what: 'spending' }
    expect(match([fuel], taxis, { account: TBANK, form: 'screenshot' }).unposted).toEqual([
      { record: ref, settled: true, ticked: false },
    ])
    expect(
      match([fuel], taxis, {
        account: TBANK,
        form: 'tbank-csv',
        period: { from: '2026-11-01', to: '2026-11-30' },
      }).unposted,
    ).toEqual([{ record: ref, settled: true, ticked: true }])
  })

  const shot = (time: string) =>
    spending('2026-11-14', '1200.00', 'AMD', {
      place: 'Yandex Go',
      account: AMERIA,
      link: linkTo({ day: '2026-11-14', form: 'screenshot', time }),
    })
  const second = (record: StatementCandidate, time: string) =>
    decide([record], [line('2026-11-14', '1200.00', 'AMD', 'Yandex Go', { time })], {
      account: AMERIA,
      form: 'screenshot',
    })[0]
  const said = (a: string, b: string) => {
    const record = shot(a)
    const d = second(record, b)
    return d?.group === 'recorded' ? (d.doubt ?? 'match') : d?.group
  }

  it('Ж2: a screenshot against a screenshot on one day — another time is new, the same is met', () => {
    expect(said('09:12', '19:40')).toBe('new')
    expect(said('09:12', '09:12')).toBe('match')
  })

  it('З1: times less than an hour apart are a doubt, not another operation', () => {
    expect(said('14:35', '14:36')).toBe('same_screenshot')
    expect(said('14:35', '15:35')).toBe('new')
  })

  it('И1–И2: an hour one confused digit apart is a doubt; AM and PM are read', () => {
    expect(said('15:35', '16:35')).toBe('same_screenshot')
    expect(said('15:35', '17:35')).toBe('new')
    expect(said('9:10 AM', '9:40 PM')).toBe('new')
    expect(said('9:10 PM', '21:10')).toBe('match')
    expect(said('12:05 AM', '00:05')).toBe('match')
  })

  it('К1–К2: two swaps of 5↔6, and a swap in the printed 12-hour form, are a doubt; an impossible time is none', () => {
    expect(said('15:35', '16:36')).toBe('same_screenshot')
    expect(said('5:35 PM', '6:35 PM')).toBe('same_screenshot')
    expect(said('15:55', '16:66')).toBe('same_screenshot')
    expect(said('13:10 PM', '01:10')).toBe('same_screenshot')
  })

  const buy = line('2026-11-12', '5000.00', 'AMD', '21016919\\AM\\YEREVAN\\SAS SUPERMARKET')
  const back = (payee: string) => line('2026-11-20', '5000.00', 'AMD', payee, { sign: '+' })

  it('М1: a refund in the same file — one seller, the place’s words aside: a bar of the same city leaves the purchase', () => {
    expect(decide([], [buy, back('21016919\\AM\\YEREVAN\\ZOVQ BAR')])[0]).toEqual(NEW)
    expect(decide([], [buy, back('21016919\\AM\\YEREVAN\\SAS SUPERMARKET')])[0]).toMatchObject({
      note: 'refunded',
    })
  })

  it('Н1: one seller is every word of one name in the other; a common word of the kind is not', () => {
    expect(decide([], [buy, back('21016919\\AM\\YEREVAN\\NOR ZOVQ SUPERMARKET')])[0]).toEqual(NEW)
    expect(decide([], [buy, back('SAS SUPERMARKET RETURN')])[0]).toMatchObject({ note: 'refunded' })
    expect(
      decide(
        [],
        [line('2026-11-12', '5000.00', 'AMD', 'AM\\SEVAN\\SAS'), back('AM\\SEVAN\\ZOVQ')],
      )[0],
    ).toEqual(NEW)
  })

  it('a city of the settings in another script is a place word: «MOSCOW» is «Москва»', () => {
    const moscow = line('2026-11-12', '900.00', 'RUB', 'MOSCOW KOFEMANIA')
    expect(
      decide(
        [],
        [moscow, line('2026-11-13', '900.00', 'RUB', 'MOSCOW VKUSVILL', { sign: '+' })],
      )[0],
    ).toEqual(NEW)
    expect(
      decide(
        [],
        [moscow, line('2026-11-13', '900.00', 'RUB', 'Кофемания Москва', { sign: '+' })],
      )[0],
    ).toMatchObject({ note: 'refunded' })
  })
})

describe('matchStatement — an exchange is a candidate (MOL-428, Р-6)', () => {
  const exchange = (day: string, account: string | null) =>
    exchangeCandidate(
      {
        id: nextId(),
        given: cash('300.00', 'USD'),
        exchangedOn: day,
        givenAccountId: account,
        note: null,
      },
      { removed: false, link: null },
    )
  const own = line('2026-11-15', '300.00', 'USD', 'Transfer of own funds')

  it('settles the line of its given account, on its day, that calls itself a transfer or an exchange', () => {
    const e = exchange('2026-11-15', AMERIA)
    expect(decide([e], [own], { account: AMERIA })).toEqual([
      { group: 'not_spending', reason: 'exchange', record: { id: e.id, what: 'exchange' } },
    ])
    expect(
      group(
        decide([e], [line('2026-11-15', '300.00', 'USD', 'Купля валюты')], { account: AMERIA })[0],
      ),
    ).toBe('not_spending')
  })

  it('is a doubt on another day, with no account, or for a line that says neither', () => {
    const e = exchange('2026-11-15', AMERIA)
    expect(decide([e], [{ ...own, day: '2026-11-16' }], { account: AMERIA })).toEqual([
      recorded(e, 'exchange'),
    ])
    const loose = exchange('2026-11-15', null)
    expect(decide([loose], [own], { account: AMERIA })).toEqual([recorded(loose, 'exchange')])
    expect(
      decide([e], [line('2026-11-15', '300.00', 'USD', 'APPLE.COM')], { account: AMERIA }),
    ).toEqual([recorded(e, 'exchange')])
  })

  it('never settles a line of another account', () => {
    expect(decide([exchange('2026-11-15', TBANK)], [own], { account: AMERIA })).toEqual([NEW])
  })
})

describe('matchStatement — the reader’s kind (Р-5) and the owner’s В-2', () => {
  it('takes own transfers, cash and exchanges the reader named out without a record', () => {
    const reasons = decide(
      [],
      [
        line('2026-11-14', '100.00', 'USD', 'x', { kind: 'own_transfer' }),
        line('2026-11-14', '100.00', 'USD', 'x', { kind: 'cash' }),
        line('2026-11-14', '100.00', 'USD', 'x', { kind: 'exchange' }),
        line('2026-11-14', '100.00', 'USD', 'ATM', { mcc: '6011' }),
        line('2026-11-14', '100.00', 'USD', 'ATM', { mcc: '6011', kind: 'purchase' }),
      ],
    ).map((d) => (d.group === 'not_spending' ? d.reason : d.group))
    expect(reasons).toEqual(['own_transfer', 'cash', 'exchange', 'cash', 'new'])
  })

  it('makes a bank’s fee a spending, ticked, with the hint «Прочее»', () => {
    expect(decide([], [line('2026-11-16', '44.80', 'AMD', 'commission', { kind: 'fee' })])).toEqual(
      [{ group: 'new', ticked: true, note: null, categoryHint: 'other' }],
    )
  })

  it('В-2 «б»: a transfer to somebody with nothing recorded is new, not ticked, asked whether it is a spending', () => {
    expect(
      decide(
        [],
        [line('2026-11-03', '50000.00', 'RUB', 'Перевод по номеру телефона', { kind: 'transfer' })],
      ),
    ).toEqual([{ group: 'new', ticked: false, note: 'transfer', categoryHint: null }])
  })

  it('a transfer met by a recorded transfer of its account is no spending', () => {
    const tr = transfer('2026-11-03', '50000.00', ARDSHIN)
    expect(
      group(
        decide([tr], [line('2026-11-03', '50000.00', 'AMD', 'Перевод', { kind: 'transfer' })], {
          account: ARDSHIN,
        })[0],
      ),
    ).toBe('not_spending')
  })

  it('takes a hold the bank still processes for a spending', () => {
    expect(
      decide([], [line('2026-11-14', '1200.00', 'AMD', 'YANDEX.GO', { status: 'pending' })]),
    ).toEqual([NEW])
  })
})

describe('matchStatement — the boundaries', () => {
  const taxi = (day = '2026-11-14') => spending(day, '1200.00', 'AMD', { place: 'Yandex Go' })
  const at = (day: string, form: StatementForm = 'ameria-csv') =>
    group(decide([taxi()], [line(day, '1200.00', 'AMD', 'YANDEX.GO')], { form })[0])

  it('a file meets a record two days either side, not three', () => {
    expect([at('2026-11-12'), at('2026-11-16'), at('2026-11-11'), at('2026-11-17')]).toEqual([
      'recorded',
      'recorded',
      'new',
      'new',
    ])
  })

  it('a screenshot meets from two days before the record to four after', () => {
    const shot = (day: string) => at(day, 'screenshot')
    expect([
      shot('2026-11-12'),
      shot('2026-11-18'),
      shot('2026-11-11'),
      shot('2026-11-19'),
    ]).toEqual(['recorded', 'recorded', 'new', 'new'])
  })

  it('a sum meets exactly: a hundredth over is a tip, a hundredth under — a hold only by its rule', () => {
    const one = (amount: string) =>
      decide([taxi()], [line('2026-11-14', amount, 'AMD', 'YANDEX.GO')])[0]
    expect(one('1200.01')).toMatchObject({ doubt: 'tip' })
    expect(one('1199.99')).toEqual(NEW)
  })

  it('a tip is a fifth at most, a hold half at least', () => {
    const t = trip('2026-11-14', '100.00', 'GEL', { place: 'LONDA', account: AMERIA })
    const one = (amount: string) =>
      decide([t], [line('2026-11-14', amount, 'GEL', 'LONDA')], { account: AMERIA })[0]
    expect(one('120.00')).toMatchObject({ doubt: 'tip' })
    expect(one('120.01')).toEqual(NEW)
    expect(one('50.00')).toMatchObject({ doubt: 'hold' })
    expect(one('49.99')).toEqual(NEW)
  })

  it('a hold’s posting on a screenshot is let in a week after it, past the window; then a doubt to day 30; after — new', () => {
    const fuel = spending('2026-11-01', '15000.00', 'AMD', {
      place: 'Gazprom',
      account: ARDSHIN,
      link: linkTo({ day: '2026-11-01', form: 'screenshot', pending: true }),
    })
    const one = (day: string) =>
      decide([fuel], [line(day, '15000.00', 'AMD', 'GAZPROM')], {
        account: ARDSHIN,
        form: 'screenshot',
      })[0]
    expect(one('2026-11-08')).toEqual(recorded(fuel))
    expect(one('2026-11-09')).toEqual(recorded(fuel, 'late_post'))
    expect(one('2026-12-01')).toEqual(recorded(fuel, 'late_post'))
    expect(one('2026-12-02')).toEqual(NEW)
  })

  it('a refund finds its record sixty days after it, not sixty-one', () => {
    const ozon = spending('2026-09-01', '2990.00', 'RUB', { place: 'Ozon' })
    const one = (day: string) =>
      decide([ozon], [line(day, '2990.00', 'RUB', 'OZON', { sign: '+' })])[0]
    expect(one('2026-10-31')).toMatchObject({ reason: 'refund', record: { id: ozon.id } })
    expect(one('2026-11-01')).toMatchObject({ reason: 'income', record: null })
  })

  it('a hold is settled a week after it, and before then only «проводки пока нет»', () => {
    const hold = spending('2026-11-10', '40000.00', 'AMD', {
      place: 'Hotel',
      account: ARDSHIN,
      link: linkTo({ day: '2026-11-10', form: 'screenshot', pending: true }),
    })
    const upTo = (to: string) =>
      match([hold], [], {
        account: ARDSHIN,
        form: 'ardshin-xlsx',
        period: { from: '2026-11-01', to },
      }).unposted[0]
    expect(upTo('2026-11-17')).toMatchObject({ settled: true, ticked: true })
    expect(upTo('2026-11-16')).toMatchObject({ settled: false, ticked: false })
  })
})

describe('matchStatement — records and keys', () => {
  it('prefers a record on the statement’s account to an equal one on another (В-1 «а»)', () => {
    const elsewhere = spending('2026-11-14', '1200.00', 'AMD', {
      place: 'Yandex Go',
      account: TBANK,
    })
    const here = spending('2026-11-14', '1200.00', 'AMD', { place: 'Yandex Go', account: AMERIA })
    expect(
      decide([elsewhere, here], [line('2026-11-14', '1200.00', 'AMD', 'YANDEX.GO')], {
        account: AMERIA,
      }),
    ).toEqual([recorded(here)])
  })

  it('hands each line its key, the one the line gives alone', () => {
    const l = line('2026-11-14', '1200.00', 'AMD', 'YANDEX.GO')
    expect(match([], [l], { account: AMERIA }).lines[0]?.key).toBe(keyOf(l, AMERIA))
  })

  it('asks nothing of a removed hold', () => {
    const removed = spending('2026-11-10', '40000.00', 'AMD', {
      account: ARDSHIN,
      removed: true,
      link: linkTo({ day: '2026-11-10', form: 'screenshot', pending: true }),
    })
    expect(
      match([removed], [line('2026-11-30', '1.00', 'AMD', 'x')], { account: ARDSHIN }).unposted,
    ).toEqual([])
  })
})

describe('matchStatement — the link across forms and uploads (adversarial, round 1)', () => {
  it('А1: a screenshot meets a file’s line of its operation by the posting day the file prints, in either order', () => {
    const sas = 'Ք: SAS SUPERMARKET YEREVAN AM'
    const onShot = line('2026-11-14', '6400.00', 'AMD', sas, { time: '19:42' })
    const inFile = line('2026-11-12', '6400.00', 'AMD', sas, { postedOn: '2026-11-14' })
    const fromShot = spending('2026-11-14', '6400.00', 'AMD', {
      place: 'SAS',
      account: AMERIA,
      link: statementLinkOf(onShot, nextId(), { form: 'screenshot', accountId: AMERIA }),
    })
    expect(decide([fromShot], [inFile], { account: AMERIA })).toEqual([recorded(fromShot)])
    const fromFile = spending('2026-11-12', '6400.00', 'AMD', {
      place: 'SAS',
      account: AMERIA,
      link: statementLinkOf(inFile, keyOf(inFile, AMERIA), {
        form: 'ameria-csv',
        accountId: AMERIA,
      }),
    })
    expect(decide([fromFile], [onShot], { account: AMERIA, form: 'screenshot' })).toEqual([
      recorded(fromFile),
    ])
    // A file that prints no posting day meets a screenshot on one day only (Д1, Е2): a named price.
    const unposted = line('2026-11-12', '6400.00', 'AMD', sas)
    expect(decide([fromShot], [unposted], { account: AMERIA })).toEqual([NEW])
  })

  it('А2: a hold’s posting in a file of its bank is on the hold’s day — another sum a doubt «hold», another text the record', () => {
    const gas = 'AM\\YEREVAN\\GAZPROM ARMENIA'
    const hold = line('2026-11-12', '15000.00', 'AMD', gas, { status: 'pending' })
    const fuel = spending('2026-11-12', '15000.00', 'AMD', {
      place: 'Gazprom Armenia',
      account: ARDSHIN,
      link: statementLinkOf(hold, keyOf(hold, ARDSHIN), {
        form: 'ardshin-xlsx',
        accountId: ARDSHIN,
      }),
    })
    const o = {
      account: ARDSHIN,
      form: 'ardshin-xlsx',
      period: { from: '2026-11-01', to: '2026-11-30' },
    } as const
    const less = match(
      [fuel],
      [line('2026-11-12', '14200.00', 'AMD', gas, { postedOn: '2026-11-14' })],
      o,
    )
    expect(less.lines[0]?.decision).toEqual(recorded(fuel, 'hold'))
    expect(less.unposted).toEqual([])
    const renamed = line('2026-11-12', '15000.00', 'AMD', `${gas} LLC`, { postedOn: '2026-11-14' })
    expect(decide([fuel], [renamed], o)).toEqual([recorded(fuel)])
  })

  it('А3: a hold from a file lets in no other operation of its sum in the days after it', () => {
    const go = 'AM\\YEREVAN\\YANDEX.GO'
    const hold = line('2026-11-12', '1200.00', 'AMD', go, { status: 'pending' })
    const ride = spending('2026-11-12', '1200.00', 'AMD', {
      place: 'Yandex Go',
      account: ARDSHIN,
      link: statementLinkOf(hold, keyOf(hold, ARDSHIN), {
        form: 'ardshin-xlsx',
        accountId: ARDSHIN,
      }),
    })
    const o = { account: ARDSHIN, form: 'ardshin-xlsx' } as const
    expect(decide([ride], [line('2026-11-17', '1200.00', 'AMD', go)], o)).toEqual([NEW])
    const posted = line('2026-11-12', '1200.00', 'AMD', go, { postedOn: '2026-11-13' })
    expect(decide([ride], [posted], o)).toEqual([recorded(ride)])
  })

  it('А4: the same file uploaded again with an account chosen since is the same line; another account — a doubt', () => {
    const sas = 'Ք: SAS SUPERMARKET YEREVAN AM'
    const l = line('2026-11-12', '6400.00', 'AMD', sas)
    const none = spending('2026-11-12', '6400.00', 'AMD', {
      place: 'SAS',
      link: statementLinkOf(l, keyOf(l), { form: 'ameria-csv', accountId: null }),
    })
    expect(decide([none], [l], { account: AMERIA })).toEqual([recorded(none)])
    const wrong = spending('2026-11-12', '6400.00', 'AMD', {
      place: 'SAS',
      account: ARDSHIN,
      link: statementLinkOf(l, keyOf(l, ARDSHIN), { form: 'ameria-csv', accountId: ARDSHIN }),
    })
    expect(decide([wrong], [l], { account: AMERIA })).toEqual([recorded(wrong, 'other_account')])
    // Another line of that file is still another key under either account.
    const next = line('2026-11-13', '6400.00', 'AMD', sas)
    expect(decide([none], [next], { account: AMERIA })).toEqual([NEW])
  })

  it('А6: a city in a record’s name meets no line — «Ереван Сити» against a purchase at SAS is a doubt', () => {
    const sas = line('2026-11-12', '6400.00', 'AMD', 'Ք: SAS SUPERMARKET YEREVAN AM')
    const city = trip('2026-11-12', '6400.00', 'AMD', { place: 'Ереван Сити' })
    expect(decide([city], [sas], { account: AMERIA })).toEqual([recorded(city, 'other_name')])
    const market = trip('2026-11-12', '6400.00', 'AMD', { place: 'Гюмри Маркет' })
    const gyumri = line('2026-11-12', '6400.00', 'AMD', 'Ք: SAS SUPERMARKET GYUMRI AM')
    expect(decide([market], [gyumri], { account: AMERIA })).toEqual([
      recorded(market, 'other_name'),
    ])
    const own = trip('2026-11-12', '6400.00', 'AMD', { place: 'Ереван Сити' })
    const avan = line('2026-11-12', '6400.00', 'AMD', 'Ք: YEREVAN CITY AVAN YEREVAN AM 19')
    expect(decide([own], [avan], { account: AMERIA })).toEqual([recorded(own)])
  })

  it('А7: a long statement with no period is read without a stack of its days', () => {
    const lines = Array.from({ length: 200_000 }, () =>
      line('2026-11-12', '100.00', 'AMD', 'YEREVAN METRO', { sign: '+' }),
    )
    expect(match([], lines, { account: AMERIA }).lines).toHaveLength(200_000)
  }, 120_000)

  it('gives a record the line it was made from before a like one of the same file', () => {
    const both = [
      line('2026-11-12', '1200.00', 'AMD', 'YANDEX.GO'),
      line('2026-11-12', '1200.00', 'AMD', 'YANDEX.GO'),
    ]
    const [, second] = statementLineKeys(PERSON, { accountId: ARDSHIN, lines: both })
    const ride = spending('2026-11-12', '1200.00', 'AMD', {
      place: 'Yandex Go',
      account: ARDSHIN,
      link: linkTo({
        key: second ?? '',
        accountId: ARDSHIN,
        day: '2026-11-12',
        form: 'ardshin-xlsx',
        pending: true,
      }),
    })
    expect(decide([ride], both, { account: ARDSHIN, form: 'ardshin-xlsx' })).toEqual([
      NEW,
      recorded(ride),
    ])
  })
})

describe('matchStatement — review, round 1', () => {
  it('№1: weighs a month of 300 lines against a year of 3 000 records well within a second', () => {
    const shops = ['SAS SUPERMARKET', 'YEREVAN CITY AVAN', 'YANDEX.GO', 'GAZPROM ARMENIA']
    const dayOf = (n: number) =>
      new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10)
    const lines = Array.from({ length: 300 }, (_, i) =>
      line(
        dayOf(300 + (i % 30)),
        String(1000 + (i % 40) * 5),
        'AMD',
        `Ք: ${shops[i % 4] ?? ''} AM`,
      ),
    )
    const records = Array.from({ length: 3000 }, (_, i) =>
      spending(dayOf(i % 360), String(1000 + (i % 40) * 5), 'AMD', {
        place: `${shops[i % 4] ?? ''} Ереван`,
      }),
    )
    // Folded a pair at a time, before the sum and the window, it took 8.1 s (review №1).
    const started = performance.now()
    const out = match(records, lines, { account: AMERIA })
    expectWithin(performance.now() - started, 4_000)
    expect(out.lines).toHaveLength(300)
  }, 60_000)

  it('№2: asks nothing of a transfer onto the statement’s account: no money of it left there', () => {
    const o = {
      account: ARDSHIN,
      form: 'ardshin-xlsx',
      period: { from: '2026-11-01', to: '2026-11-30' },
    } as const
    const held = () => linkTo({ day: '2026-11-10', form: 'screenshot', pending: true })
    const into = transfer('2026-11-10', '50000.00', AMERIA, held())
    expect(match([into], [], o).unposted).toEqual([])
    const out = transfer('2026-11-10', '50000.00', ARDSHIN, held())
    expect(match([out], [], o).unposted).toEqual([
      { record: { id: out.id, what: 'transfer' }, settled: true, ticked: true },
    ])
  })

  it('№7: names the nearest recorded spending before a refund, whatever order the records came in', () => {
    const older = spending('2026-11-01', '2990.00', 'RUB', { place: 'Ozon' })
    const nearer = spending('2026-11-10', '2990.00', 'RUB', { place: 'Ozon' })
    const refund = [line('2026-11-12', '2990.00', 'RUB', 'OZON', { sign: '+' })]
    for (const order of [
      [older, nearer],
      [nearer, older],
    ])
      expect(decide(order, refund)[0]).toMatchObject({
        reason: 'refund',
        record: { id: nearer.id },
      })
  })
})

describe('tripCandidate', () => {
  const base = {
    id: '00000000-0000-4000-8000-0000000000aa',
    startedAt: new Date('2026-11-14T08:00:00.000Z'),
    startedOn: '2026-11-14',
    finishedAt: new Date('2026-11-15T08:00:00.000Z'),
    finishedOn: '2026-11-15',
    accountId: null,
    debited: null,
    receipt: null,
    expenses: [{ amount: cash('10.00', 'GEL') }, { amount: cash('5.00', 'GEL') }, { amount: null }],
    placeName: 'LONDA',
  }
  const state = { removed: false, link: null }

  it('holds both days of a trip over midnight and its money by its prices', () => {
    expect(tripCandidate(base, state)).toMatchObject({
      days: ['2026-11-14', '2026-11-15'],
      money: [cash('15.00', 'GEL')],
    })
  })

  it('is no candidate while open or with no money', () => {
    expect(tripCandidate({ ...base, finishedAt: null }, state)).toBeNull()
    expect(tripCandidate({ ...base, expenses: [] }, state)).toBeNull()
  })
})

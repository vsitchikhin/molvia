import { describe, expect, it } from 'vitest'
import { STATEMENT_LINES_MAX } from '@molvia/model'
import type { StatementLine } from '@molvia/model'
import { readTbankCsv } from './tbank'
import type { TbankAccount, TbankRead } from './tbank'

// Synthetic rows under the headers T-Bank's exports carry (b-russia.md, 1.2): the repository is public,
// so no row of a real statement is written here.

const HEADER_2026 =
  'Имя счёта;Номер карты;Дата операции;Сумма операции;Валюта операции;Сумма в валюте счёта;Валюта счёта;' +
  'Статус;Категория по-умолчанию;Ваша категория;MCC;Описание;Сообщение;Округление;' +
  'Сумма операции с округлением;Бонусы (включая кэшбэк);Учёт в аналитике'

const HEADER_OLD =
  'Дата операции;Дата платежа;Номер карты;Статус;Сумма операции;Валюта операции;Сумма платежа;' +
  'Валюта платежа;Кэшбэк;Категория;MCC;Описание;Бонусы (включая кэшбэк);Округление на инвесткопилку;' +
  'Сумма операции с округлением'

interface Row2026 {
  account?: string
  card?: string
  date?: string
  amount?: string
  currency?: string
  debited?: string
  debitedCurrency?: string
  status?: string
  category?: string
  own?: string
  mcc?: string
  payee?: string
  message?: string
  analytics?: string
}

function row2026(row: Row2026 = {}): string {
  return [
    row.account ?? 'Black',
    row.card ?? '*1234',
    row.date ?? '14.11.2026 12:00:00',
    row.amount ?? '-350,00',
    row.currency ?? 'RUB',
    row.debited ?? '-350,00',
    row.debitedCurrency ?? 'RUB',
    row.status ?? 'Ок',
    row.category ?? 'Супермаркеты',
    row.own ?? '',
    row.mcc ?? '5411',
    row.payee ?? 'Пятёрочка',
    row.message ?? '',
    '0,00',
    row.amount ?? '-350,00',
    '0,00',
    row.analytics ?? 'Да',
  ]
    .map((cell) => `"${cell}"`)
    .join(';')
}

const BOM = [0xef, 0xbb, 0xbf]

function utf8File(...lines: string[]): Uint8Array {
  return new Uint8Array([...BOM, ...new TextEncoder().encode(lines.join('\r\n'))])
}

/** Windows-1251 of Russian letters and ASCII: what T-Bank's export before 2026 was written in. */
function cp1251File(...lines: string[]): Uint8Array {
  return Uint8Array.from(Array.from(lines.join('\r\n')), (char) => {
    const code = char.charCodeAt(0)
    if (code < 0x80) return code
    if (char === 'Ё') return 0xa8
    if (char === 'ё') return 0xb8
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0
    throw new Error(`no such letter in the test's 1251: ${char}`)
  })
}

function accountsOf(read: TbankRead): readonly TbankAccount[] {
  if (!read.ok) throw new Error(`refused: ${JSON.stringify(read.refusal)}`)
  return read.accounts
}

/** The one line of a file of one account. */
function lineOf(read: TbankRead): StatementLine {
  const [account, ...more] = accountsOf(read)
  const [line, ...others] = account?.statement.lines ?? []
  if (line === undefined || more.length > 0 || others.length > 0) throw new Error('not one line')
  return line
}

const one = (row: Row2026, zone = 'Asia/Yerevan') =>
  lineOf(readTbankCsv(utf8File(HEADER_2026, row2026(row)), zone))

describe('readTbankCsv — the layout of 2026', () => {
  it('reads a purchase in drams from a rouble account: both sums, the sign, the payee, MCC and category', () => {
    const read = readTbankCsv(
      utf8File(
        HEADER_2026,
        row2026({
          date: '14.11.2026 18:48:38',
          amount: '-6 241,00',
          currency: 'AMD',
          debited: '-1 478,24',
          debitedCurrency: 'RUB',
          category: 'Рестораны',
          mcc: '5812',
          payee: 'ZOVQ  BAR ',
        }),
      ),
      'Asia/Yerevan',
    )
    const [account] = accountsOf(read)
    expect(account?.name).toBe('Black')
    expect(account?.currency).toBe('RUB')
    expect(account?.statement).toMatchObject({
      form: 'tbank-csv',
      accountId: null,
      accountNumber: null,
      period: null,
    })
    expect(lineOf(read)).toEqual({
      day: '2026-11-14',
      postedOn: null,
      time: null,
      amount: { minor: 624_100n, currency: 'AMD' },
      debited: { minor: 147_824n, currency: 'RUB' },
      sign: '-',
      payee: 'ZOVQ BAR',
      mcc: '5812',
      bankCategory: 'Рестораны',
      status: 'posted',
      kind: 'purchase',
    })
  })

  it('dates a line by the phone: 23:30 in Moscow is the next day in Yerevan, the same day in Moscow', () => {
    const late = { date: '14.11.2026 23:30:00' }
    expect(one(late, 'Asia/Yerevan').day).toBe('2026-11-15')
    expect(one(late, 'Europe/Moscow').day).toBe('2026-11-14')
    expect(one({ date: '14.11.2026 22:59:59' }, 'Asia/Yerevan').day).toBe('2026-11-14')
    expect(lineOf(readTbankCsv(utf8File(HEADER_2026, row2026(late)))).day).toBe('2026-11-15')
  })

  it('reads a day printed without seconds or without a time', () => {
    expect(one({ date: '14.11.2026 23:30' }).day).toBe('2026-11-15')
    expect(one({ date: '14.11.2026' }).day).toBe('2026-11-14')
  })

  it('keeps no «списано» where the operation is in the account’s currency', () => {
    expect(one({}).debited).toBeNull()
    expect(one({}).amount).toEqual({ minor: 35_000n, currency: 'RUB' })
  })

  it('takes the account’s money where the operation’s currency is none of Molvia’s', () => {
    const line = one({
      amount: '-120,00',
      currency: 'TRY',
      debited: '-310,55',
      debitedCurrency: 'RUB',
    })
    expect(line.amount).toEqual({ minor: 31_055n, currency: 'RUB' })
    expect(line.debited).toBeNull()
  })

  it('reads money in with a plus, or with no sign', () => {
    expect(one({ amount: '+1 760,00', debited: '+1 760,00', analytics: 'Да' }).sign).toBe('+')
    expect(one({ amount: '88 000,00', debited: '88 000,00' }).sign).toBe('+')
  })

  it('reads the typographic minus and spaces of every width between thousands', () => {
    expect(one({ amount: '−1 040,50', debited: '−1 040,50' }).amount.minor).toBe(104_050n)
  })

  it('leaves a line of zero out, and a declined one whose two sums disagree', () => {
    const read = readTbankCsv(
      utf8File(
        HEADER_2026,
        row2026({ amount: '0,00', debited: '0,00' }),
        row2026({ status: 'FAILED', amount: '-10,00', currency: 'USD', debited: '0,00' }),
        row2026(),
      ),
    )
    expect(accountsOf(read)[0]?.statement.lines).toHaveLength(1)
  })

  it.each([
    [
      '«Учёт в аналитике: Нет»',
      { analytics: 'Нет', category: 'Переводы', mcc: '' },
      'own_transfer',
    ],
    [
      'the words of an own transfer the bank counts — no sign of 2026’s, a transfer',
      { payee: 'Перевод себе', category: 'Переводы', mcc: '' },
      'transfer',
    ],
    [
      '«Внутренний перевод» to a contract — another person’s too, a transfer (adversarial А1)',
      { payee: 'Внутренний перевод на договор 5000000001', category: 'Переводы', mcc: '' },
      'transfer',
    ],
    [
      'a purchase taken out of the bank’s analytics — a purchase still (adversarial А2)',
      { analytics: 'Нет', mcc: '5411' },
      'purchase',
    ],
    ['MCC 6011', { mcc: '6011', category: 'Другое' }, 'cash'],
    ['the category «Наличные»', { mcc: '', category: 'Наличные' }, 'cash'],
    [
      'a fee',
      { mcc: '', category: 'Другое', payee: 'Комиссия за операцию в кредитных организациях' },
      'fee',
    ],
    [
      'the bank’s services',
      { mcc: '', category: 'Услуги банка', payee: 'Плата за обслуживание' },
      'fee',
    ],
    ['a currency exchange', { mcc: '', category: 'Другое', payee: 'Покупка валюты' }, 'exchange'],
    [
      'a transfer to somebody',
      { mcc: '', category: 'Переводы', payee: 'Перевод по номеру телефона' },
      'transfer',
    ],
    ['a purchase', { mcc: '5411' }, 'purchase'],
    ['nothing said', { mcc: '', category: 'Другое', payee: 'Что-то' }, 'unknown'],
  ] as const)('reads the kind of %s', (_, row, kind) => {
    expect(one(row).kind).toBe(kind)
  })

  it('pads an MCC an export lost a leading zero of, and reads anything else as none', () => {
    expect(one({ mcc: '742' }).mcc).toBe('0742')
    expect(one({ mcc: '5411.0' }).mcc).toBeNull()
    expect(one({ mcc: '' }).mcc).toBeNull()
  })

  it('reads the payee from «Описание» alone, cut to a line’s field, and never the message', () => {
    const line = one({ payee: `Ромашка ${'я'.repeat(300)}`, message: 'Тайное слово' })
    expect(line.payee).toHaveLength(200)
    expect(line.payee.startsWith('Ромашка я')).toBe(true)
    expect(one({ message: 'Тайное слово' }).payee).toBe('Пятёрочка')
  })

  it('cuts a payee of emoji as the schema counts, never a pair of surrogates in two (review №2)', () => {
    expect(one({ payee: '🍕'.repeat(150) }).payee).toBe('🍕'.repeat(100))
    expect(one({ payee: `x${'🍕'.repeat(150)}` }).payee).toBe(`x${'🍕'.repeat(99)}`)
  })

  it('reads «FAILED» as declined and «OK» in Latin as posted', () => {
    expect(one({ status: 'FAILED' }).status).toBe('declined')
    expect(one({ status: 'OK' }).status).toBe('posted')
  })

  it('splits a file of several accounts by «Имя счёта», in the order the file first names them', () => {
    const read = readTbankCsv(
      utf8File(
        HEADER_2026,
        row2026({ account: 'Black', payee: 'A' }),
        row2026({ account: 'Накопительный счёт', payee: 'B' }),
        row2026({ account: 'Black', payee: 'C' }),
      ),
    )
    expect(
      accountsOf(read).map(({ name, statement }) => [
        name,
        statement.lines.map(({ payee }) => payee),
      ]),
    ).toEqual([
      ['Black', ['A', 'C']],
      ['Накопительный счёт', ['B']],
    ])
  })

  it('splits one name by the account’s currency: a product’s accounts may share it (adversarial А5)', () => {
    const read = readTbankCsv(
      utf8File(
        HEADER_2026,
        row2026(),
        row2026({ amount: '-12,00', currency: 'USD', debited: '-12,00', debitedCurrency: 'USD' }),
        row2026({ amount: '-12,00', currency: 'USD', debited: '-1 000,00' }),
      ),
    )
    expect(
      accountsOf(read).map(({ name, currency, statement }) => [
        name,
        currency,
        statement.lines.length,
      ]),
    ).toEqual([
      ['Black', 'RUB', 2],
      ['Black', 'USD', 1],
    ])
  })

  it('skips the header of a second export glued into the file, its byte order mark too', () => {
    const read = readTbankCsv(
      utf8File(
        HEADER_2026,
        row2026({ payee: 'A' }),
        `\uFEFF${HEADER_2026}`,
        row2026({ payee: 'B' }),
      ),
    )
    expect(accountsOf(read)[0]?.statement.lines.map(({ payee }) => payee)).toEqual(['A', 'B'])
  })

  it('reads once a record two glued exports share, and twice two like records of one (adversarial А4)', () => {
    const edge = row2026({ date: '15.11.2026 12:34:56', payee: 'Edge' })
    const read = readTbankCsv(
      utf8File(HEADER_2026, row2026({ payee: 'A' }), edge, edge, HEADER_2026, edge, edge, edge),
    )
    expect(accountsOf(read)[0]?.statement.lines.map(({ payee }) => payee)).toEqual([
      'A',
      'Edge',
      'Edge',
    ])
  })

  it('finds the columns by name: another order, another spelling of «ё», an unknown column', () => {
    const header =
      'Описание;Статус;Новая колонка;Дата операции;Имя счета;Сумма операции;Валюта операции;' +
      'Сумма в валюте счета;Валюта счета;Категория по умолчанию;mcc;Учет в аналитике'
    const read = readTbankCsv(
      utf8File(
        header,
        'Пятёрочка;Ок;x;14.11.2026 12:00:00;Black;-350,00;RUB;-350,00;RUB;Супермаркеты;5411;Да',
      ),
    )
    expect(lineOf(read)).toMatchObject({
      payee: 'Пятёрочка',
      amount: { minor: 35_000n },
      kind: 'purchase',
    })
  })

  it('reads a file with no lines as one with no accounts', () => {
    expect(accountsOf(readTbankCsv(utf8File(HEADER_2026)))).toEqual([])
  })
})

describe('readTbankCsv — the layout before 2026', () => {
  it('reads Windows-1251, «OK», «Дата платежа» as the posting day and «Сумма платежа» as «списано»', () => {
    const read = readTbankCsv(
      cp1251File(
        HEADER_OLD,
        '14.11.2026 18:48:38;15.11.2026;*5958;OK;-12,99;USD;-1250,30;RUB;0;Супермаркеты;5411;Магазин;0;0;-12,99',
        '14.11.2026 19:00:00;;*5958;OK;-500,00;RUB;-500,00;RUB;0;Переводы;;Между своими счетами;0;0;-500,00',
      ),
    )
    const [account] = accountsOf(read)
    expect(account?.name).toBeNull()
    expect(account?.statement.lines).toEqual([
      {
        day: '2026-11-14',
        postedOn: '2026-11-15',
        time: null,
        amount: { minor: 1_299n, currency: 'USD' },
        debited: { minor: 125_030n, currency: 'RUB' },
        sign: '-',
        payee: 'Магазин',
        mcc: '5411',
        bankCategory: 'Супермаркеты',
        status: 'posted',
        kind: 'purchase',
      },
      expect.objectContaining({ postedOn: null, kind: 'own_transfer', debited: null }),
    ])
  })

  it('moves the posting day with its operation onto the phone’s calendar (adversarial А6)', () => {
    const read = readTbankCsv(
      cp1251File(
        HEADER_OLD,
        '13.11.2026 23:17:00;13.11.2026;*5958;OK;-500,00;RUB;-500,00;RUB;0;Переводы;;Перевод;0;0;-500,00',
        '13.11.2026 15:00:00;14.11.2026;*5958;OK;-500,00;RUB;-500,00;RUB;0;Переводы;;Перевод;0;0;-500,00',
      ),
      'Asia/Yerevan',
    )
    expect(
      accountsOf(read)[0]?.statement.lines.map(({ day, postedOn }) => [day, postedOn]),
    ).toEqual([
      ['2026-11-14', '2026-11-14'],
      ['2026-11-13', '2026-11-14'],
    ])
  })

  it('reads «Внутренний перевод» as no own word, «Между своими счетами» as one only with no MCC', () => {
    const read = readTbankCsv(
      cp1251File(
        HEADER_OLD,
        '14.11.2026 19:00:00;;*5958;OK;-500,00;RUB;-500,00;RUB;0;Переводы;;Внутренний перевод на договор 5000000001;0;0;-500,00',
        '14.11.2026 19:00:00;;*5958;OK;-500,00;RUB;-500,00;RUB;0;Другое;5411;Между своими счетами;0;0;-500,00',
      ),
    )
    expect(accountsOf(read)[0]?.statement.lines.map(({ kind }) => kind)).toEqual([
      'transfer',
      'purchase',
    ])
  })
})

describe('readTbankCsv — refusals', () => {
  const refusalOf = (read: TbankRead) => (read.ok ? null : read.refusal)

  it('refuses a header of no layout it knows, a missing column, an empty file and bytes of no text', () => {
    const format = { reason: 'format_unknown' }
    expect(
      refusalOf(readTbankCsv(utf8File('Date;Amount;Description', '01.11.2026;-1,00;x'))),
    ).toEqual(format)
    expect(
      refusalOf(readTbankCsv(utf8File(HEADER_2026.replace(';Учёт в аналитике', ''), row2026()))),
    ).toEqual(format)
    expect(refusalOf(readTbankCsv(new Uint8Array()))).toEqual(format)
    expect(
      refusalOf(readTbankCsv(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x9c]))),
    ).toEqual(format)
    expect(refusalOf(readTbankCsv(utf8File(HEADER_2026, row2026(), '"Black;x')))).toEqual(format)
  })

  it('refuses a status it never saw, naming it as printed (owner’s В-4 «а»)', () => {
    expect(
      refusalOf(readTbankCsv(utf8File(HEADER_2026, row2026(), row2026({ status: ' REVERSED ' })))),
    ).toEqual({
      reason: 'status_unknown',
      status: 'REVERSED',
    })
    expect(refusalOf(readTbankCsv(utf8File(HEADER_2026, row2026({ status: '' }))))).toEqual({
      reason: 'status_unknown',
      status: '',
    })
  })

  it('refuses an account in a currency Molvia keeps no account in', () => {
    expect(
      refusalOf(
        readTbankCsv(utf8File(HEADER_2026, row2026({ currency: 'KZT', debitedCurrency: 'kzt' }))),
      ),
    ).toEqual({ reason: 'currency_unknown', currency: 'kzt' })
  })

  it.each([
    ['signs that disagree', { amount: '-6 241,00', currency: 'AMD', debited: '1 478,24' }],
    ['nothing left the account', { amount: '-6 241,00', currency: 'AMD', debited: '0,00' }],
    ['nothing spent of what left it', { amount: '0,00', currency: 'AMD', debited: '-1 478,24' }],
    [
      'a sum of zero on a day no calendar has',
      { amount: '0,00', debited: '0,00', date: '31.02.2026' },
    ],
    ['a day before the rates’ epoch', { date: '14.11.1999 12:00:00' }],
    ['more digits than the currency has', { amount: '-350,005', debited: '-350,005' }],
    ['an amount that is no number', { amount: 'много', debited: 'много' }],
    ['a day no calendar has', { date: '31.02.2026 12:00:00' }],
    ['an hour no clock has', { date: '14.11.2026 24:00:00' }],
    ['a date in another order', { date: '2026-11-14 12:00:00' }],
  ] as const)('refuses a line of %s, naming its record', (_, row) => {
    expect(refusalOf(readTbankCsv(utf8File(HEADER_2026, row2026(), row2026(row))))).toEqual({
      reason: 'row_unreadable',
      row: 3,
    })
  })

  it('names the line of the file, past a payee of two lines and a blank line (adversarial А7)', () => {
    const bad = row2026({ date: '31.02.2026 12:00:00' })
    expect(
      refusalOf(
        readTbankCsv(utf8File(HEADER_2026, row2026({ payee: 'Оплата\nв Multitransfer' }), bad)),
      ),
    ).toEqual({ reason: 'row_unreadable', row: 4 })
    expect(refusalOf(readTbankCsv(utf8File(HEADER_2026, '', bad)))).toEqual({
      reason: 'row_unreadable',
      row: 3,
    })
  })

  it('refuses a record shorter than the columns it is read by', () => {
    expect(
      refusalOf(readTbankCsv(utf8File(HEADER_2026, row2026(), 'Black;*1234;14.11.2026'))),
    ).toEqual({
      reason: 'row_unreadable',
      row: 3,
    })
  })

  it('reads STATEMENT_LINES_MAX lines and refuses one more', () => {
    const rows = Array.from({ length: STATEMENT_LINES_MAX }, () => row2026())
    expect(
      accountsOf(readTbankCsv(utf8File(HEADER_2026, ...rows)))[0]?.statement.lines,
    ).toHaveLength(STATEMENT_LINES_MAX)
    expect(refusalOf(readTbankCsv(utf8File(HEADER_2026, ...rows, row2026())))).toEqual({
      reason: 'too_long',
    })
  }, 20_000)
})

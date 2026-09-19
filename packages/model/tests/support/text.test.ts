import { describe, expect, it } from 'vitest'
import { ISSUE } from '#model/support/errors'
import { visibleLine, visibleText } from '#model/support/text'

const review = visibleText(500)

function refusal(text: string): string | undefined {
  return review.safeParse(text).error?.issues[0]?.message
}

describe('visibleText', () => {
  it('takes a review written in two lines, as a textarea sends it', () => {
    expect(review.parse('Пахнет крахмалом.\nМясом — нет')).toBe('Пахнет крахмалом.\nМясом — нет')
  })

  it('makes every line ending a \\n, so Windows and a phone send one string', () => {
    expect(review.parse('раз\r\nдва')).toBe('раз\nдва')
    expect(review.parse('раз\rдва')).toBe('раз\nдва')
  })

  it('takes one empty line between paragraphs and refuses two', () => {
    expect(review.parse('раз\n\nдва')).toBe('раз\n\nдва')
    expect(refusal('раз\n\n\nдва')).toBe(ISSUE.TEXT_NOT_VISIBLE)
  })

  it('counts a line of spaces as empty — a keyboard leaves them behind', () => {
    expect(refusal('раз\n  \n\t\nдва')).toBe(ISSUE.TEXT_NOT_VISIBLE)
    expect(refusal('раз\r\n \r\n\r\nдва')).toBe(ISSUE.TEXT_NOT_VISIBLE)
  })

  it('counts a line of what draws nothing as empty — not only spaces', () => {
    // Adversarial pass: a rule that knew only `\\s` let twenty such lines through as a hole.
    for (const invisible of [
      '\u200b',
      '\u2800',
      '\u3164',
      '\u00ad',
      '\u200d',
      '\u2060',
      '\u0301',
      '\u{13441}',
      '\u{1D159}',
    ]) {
      const hole = `Пахнет крахмалом.\n${`${invisible}\n`.repeat(2)}Мясом — нет`
      expect(refusal(hole), invisible.codePointAt(0)?.toString(16)).toBe(ISSUE.TEXT_NOT_VISIBLE)
      // One such line between paragraphs is an empty line, and one is allowed.
      expect(review.safeParse(`раз\n${invisible}\nдва`).success).toBe(true)
    }
  })

  it('drops blank lines at either end, invisible ones included, as trim drops spaces', () => {
    const padded = `${'\u2800\n'.repeat(5)}Мясом — нет${'\n\u200b'.repeat(5)}`
    expect(review.parse(padded)).toBe('Мясом — нет')
  })

  it('keeps an invisible character inside a line that has text', () => {
    expect(review.parse('vkusno \u{1F468}\u200d\u{1F373}\nещё')).toBe(
      'vkusno \u{1F468}\u200d\u{1F373}\nещё',
    )
  })

  it('names a review with nothing visible as such, not as a generic refusal', () => {
    // Р-11: the code reaches the screen — from the client too, since it checks first.
    for (const text of ['   ', '\n\n', '\u200b', '\u2800\n\u2800', ' \r\n ']) {
      expect(refusal(text), JSON.stringify(text)).toBe(ISSUE.TEXT_NOT_VISIBLE)
    }
  })

  it('refuses a forbidden character on an edge line as it does inside one', () => {
    expect(refusal('\u202e\nтекст')).toBe(ISSUE.TEXT_NOT_VISIBLE)
    expect(refusal('текст\n\u202e')).toBe(ISSUE.TEXT_NOT_VISIBLE)
    expect(refusal('а\u202eб')).toBe(ISSUE.TEXT_NOT_VISIBLE)
  })

  it('measures the length as sent, before any normalisation runs', () => {
    // Four hundred thousand empty lines ahead of one letter used to be folded first — for a
    // minute, in a loop — and accepted as «a».
    const started = Date.now()
    expect(review.safeParse(`${'\n'.repeat(400_000)}a`).success).toBe(false)
    expect(Date.now() - started).toBeLessThan(100)
    // Twice the bound as sent still passes when what remains fits.
    expect(review.parse(`${'\r\n'.repeat(200)}${'а'.repeat(500)}`)).toBe('а'.repeat(500))
  })

  it('trims the ends, line breaks included', () => {
    expect(review.parse('\n\n  вкусно  \n')).toBe('вкусно')
  })

  it('refuses a review of nothing but line breaks and spaces', () => {
    for (const text of ['\n', '\n \n', ' \r\n ', '\u2800\n\u200b']) {
      expect(review.safeParse(text).success).toBe(false)
    }
  })

  it('lets no other control character through beside \\n', () => {
    for (const text of ['а\tб', 'а\u0000б', 'а\u2028б', 'а\u2029б', 'а\u202eб', 'а\u0085б']) {
      expect(refusal(text)).toBe(ISSUE.TEXT_NOT_VISIBLE)
    }
  })

  it('holds the bound after the endings are folded, on the text that is stored', () => {
    expect(review.safeParse('а'.repeat(500)).success).toBe(true)
    expect(review.safeParse('а'.repeat(501)).success).toBe(false)
    // 249 + \r\n + 249 is 500 characters once folded, and 501 as typed.
    expect(review.safeParse(`${'а'.repeat(249)}\r\n${'б'.repeat(249)}`).success).toBe(true)
  })

  it('leaves a name one line: visibleLine still refuses \\n', () => {
    expect(visibleLine(200).safeParse('Молоко\nАшхар').success).toBe(false)
  })
})

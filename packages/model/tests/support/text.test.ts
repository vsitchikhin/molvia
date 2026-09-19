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

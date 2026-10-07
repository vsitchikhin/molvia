import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POLICY_VERSION } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import {
  POLICY_REVISION,
  PRIVACY_PARTS,
  PRIVACY_RECIPIENTS,
  PRIVACY_STORED,
  TERMS_PARTS,
} from './policy'

/** The templates of both pages, as written: what they draw outside the lists (adversarial Б4). */
const sources = import.meta.glob<string>(['./PrivacyView.vue', './TermsView.vue'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
function templates(): string[] {
  return Object.keys(sources)
    .sort()
    .map((path) => /<template>[\s\S]*<\/template>/.exec(sources[path] ?? '')?.[0] ?? '')
}

/**
 * Both pages in both languages, as they are filed, the parts each shows and the templates that draw
 * them — any edit, a comma, a part or a line of the template taken out included, changes it. **And
 * the consent on the step itself** (MOL-236, adversarial А4, Р2-А1): its first words — who sees what —
 * and the card «Статистика» are the text of the
 * consent to the statistics, shown apart from the pages (В-2), and «что изменилось» says what an
 * edition changed — rewritten, either is the text a person agrees to. Not the rest of `consent`: the
 * buttons, the age and the errors are the step's, not the text. That the step draws the card at all
 * is `ConsentStep.test.ts`'s.
 */
function digestOfPages(dictionaries: { ru: typeof ru; en: typeof en } = { ru, en }): string {
  const { ru: r, en: e } = dictionaries
  return createHash('sha256')
    .update(
      JSON.stringify([
        [PRIVACY_STORED, PRIVACY_RECIPIENTS, PRIVACY_PARTS, TERMS_PARTS],
        [r.privacy, r.terms, e.privacy, e.terms],
        [r.consent.body, r.consent.statistics, r.consent.changes],
        [e.consent.body, e.consent.statistics, e.consent.changes],
        templates(),
      ]),
    )
    .digest('hex')
}

describe('the revision of the terms and the privacy page (MOL-95, В-1)', () => {
  it('reads both templates, whole', () => {
    expect(templates()).toHaveLength(2)
    for (const template of templates()) expect(template).toMatch(/^<template>[\s\S]+<\/template>$/)
  })

  it('moves with every edit of their text', () => {
    expect(
      digestOfPages(),
      'The text of «Данные и приватность» or «Условия использования» changed. Set POLICY_REVISION in ' +
        'frontend/src/views/policy.ts to today and this digest. If the change matters — a new kind ' +
        'of data, a new recipient, a new purpose, a change of the terms — raise POLICY_VERSION in ' +
        'packages/model/src/contracts/consent.ts as well, and write consent.changes.<version>.',
    ).toBe(POLICY_REVISION.digest)
  })

  it('moves with the consent on the step too, and not with its buttons (MOL-236, adversarial А4)', () => {
    const copy = () => structuredClone({ ru, en })
    const statistics = copy()
    statistics.ru.consent.statistics.text = 'Мы считаем всё, с именем. Выключить нельзя.'
    const changes = copy()
    changes.en.consent.changes['2'] = 'Nothing changed.'
    const body = copy()
    body.ru.consent.body = 'Другие видят всё.'
    const button = copy()
    button.ru.consent.accept = 'Согласен'
    expect(digestOfPages(statistics)).not.toBe(POLICY_REVISION.digest)
    expect(digestOfPages(changes)).not.toBe(POLICY_REVISION.digest)
    expect(digestOfPages(body)).not.toBe(POLICY_REVISION.digest)
    expect(digestOfPages(button)).toBe(POLICY_REVISION.digest)
  })

  it('names the edition the model asks about, so raising it is an edit of the revision too', () => {
    expect(POLICY_REVISION.version).toBe(POLICY_VERSION)
  })

  it('is a calendar day', () => {
    expect(POLICY_REVISION.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${POLICY_REVISION.day}T00:00:00Z`).toISOString().slice(0, 10)).toBe(
      POLICY_REVISION.day,
    )
  })

  it('says what changed in every language once there was an edition before', () => {
    // The screen «Условия обновились» names the change of the edition it asks about.
    const changes = (dictionary: object) =>
      (dictionary as { consent: { changes?: Record<string, string> } }).consent.changes
    const version: number = POLICY_VERSION
    for (const dictionary of [ru, en]) {
      if (version > 1) expect(changes(dictionary)?.[String(version)]).toBeTruthy()
      else expect(changes(dictionary)).toBeUndefined()
    }
  })
})

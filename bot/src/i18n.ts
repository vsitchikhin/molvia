import { pickLocale } from '@molvia/model'
import type { AppLocale } from '@molvia/model'
import { en } from '@/i18n/en'
import { ru } from '@/i18n/ru'
import type { Dictionary } from '@/i18n/ru'

export type MessageKey = keyof Dictionary

const DICTIONARIES: Readonly<Record<AppLocale, Dictionary>> = { ru, en }

/**
 * A message in the language of the person the update came from.
 *
 * The language is decided by the domain's own rule (`pickLocale`), the same one the PWA uses:
 * Telegram's `language_code` is an IETF tag like any other, and a person without one in their
 * profile is an ordinary case rather than a failure — Russian by default, as everywhere.
 *
 * Substitution is `{name}` and nothing else. No plural rule lives here: the only counted thing
 * the bot says is the age of a login request, and its forms are four keys of the dictionary —
 * see `when.ts` for why that is enough.
 */
export function t(
  languageCode: string | undefined,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const message = DICTIONARIES[pickLocale(languageCode)][key]
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

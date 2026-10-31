import { actorSettingsSchema } from '@molvia/model'
import type { ActorSettings } from '@molvia/model'
import { read, writeEverywhere } from './storage'

export const settingsKey = (owner: string): string => `molvia.settings.${owner}`

/**
 * `updatedAt` is when the row was changed; `readAt` is when the server last said it to this phone, by
 * the phone's clock — what «Без связи · настройки на 14:05» names (MOL-215). A shelf written by a build
 * before it has none, and neither does one the build before writes over: no time is known then.
 */
export interface SettingsSnapshot {
  settings: ActorSettings
  updatedAt: Date | null
  readAt: Date | null
}

const dateOf = (value: unknown): Date | null => {
  const date = typeof value === 'string' ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

export function recallSettingsSnapshot(owner: string | null): SettingsSnapshot | null {
  if (!owner) return null
  try {
    const raw = read(settingsKey(owner))
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== 'object') return null
    const envelope = value as { settings?: unknown; updatedAt?: unknown; readAt?: unknown }
    const parsed = actorSettingsSchema.safeParse(envelope.settings ?? value)
    if (!parsed.success) return null
    return {
      settings: parsed.data,
      updatedAt: dateOf(envelope.updatedAt),
      readAt: dateOf(envelope.readAt),
    }
  } catch {
    return null
  }
}

export function recallSettings(owner: string | null): ActorSettings | null {
  return recallSettingsSnapshot(owner)?.settings ?? null
}

export function rememberSettings(
  owner: string,
  settings: ActorSettings,
  updatedAt: Date,
  readAt: Date | null,
): boolean {
  return writeEverywhere(
    settingsKey(owner),
    JSON.stringify({ settings, updatedAt: updatedAt.toISOString(), readAt: readAt?.toISOString() }),
  )
}

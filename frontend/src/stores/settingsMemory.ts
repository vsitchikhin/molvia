import { actorSettingsSchema } from '@molvia/model'
import type { ActorSettings } from '@molvia/model'
import { read, writeEverywhere } from './storage'

export const settingsKey = (owner: string): string => `molvia.settings.${owner}`

export function recallSettingsSnapshot(
  owner: string | null,
): { settings: ActorSettings; updatedAt: Date | null } | null {
  if (!owner) return null
  try {
    const raw = read(settingsKey(owner))
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== 'object') return null
    const envelope = value as { settings?: unknown; updatedAt?: unknown }
    const parsed = actorSettingsSchema.safeParse(envelope.settings ?? value)
    if (!parsed.success) return null
    const date = typeof envelope.updatedAt === 'string' ? new Date(envelope.updatedAt) : null
    return { settings: parsed.data, updatedAt: date && !Number.isNaN(date.getTime()) ? date : null }
  } catch {
    return null
  }
}

export function recallSettings(owner: string | null): ActorSettings | null {
  return recallSettingsSnapshot(owner)?.settings ?? null
}

export function rememberSettings(owner: string, settings: ActorSettings, updatedAt: Date): boolean {
  return writeEverywhere(
    settingsKey(owner),
    JSON.stringify({ settings, updatedAt: updatedAt.toISOString() }),
  )
}

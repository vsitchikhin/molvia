import { DomainError, ERROR } from '@molvia/model'
import type { Actor, SettingsUpdate } from '@molvia/model'
import type { SettingsRepository } from '@/db/settings-repository'

export async function saveSettings(
  repository: SettingsRepository,
  owner: string,
  input: SettingsUpdate,
): Promise<Actor> {
  const actor = await repository.save(owner, input)
  if (!actor) throw new DomainError(ERROR.CONFLICT)
  return actor
}

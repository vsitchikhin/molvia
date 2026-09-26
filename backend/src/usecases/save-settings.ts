import { DomainError, ERROR } from '@molvia/model'
import type { Actor, SettingsUpdate } from '@molvia/model'
import type { MoneyRepository } from '@/db/money-repository'
import type { SettingsRepository } from '@/db/settings-repository'

export async function saveSettings(
  repository: SettingsRepository,
  money: Pick<MoneyRepository, 'thaw'>,
  owner: string,
  input: SettingsUpdate,
): Promise<Actor> {
  const actor = await repository.save(owner, input)
  if (!actor) throw new DomainError(ERROR.CONFLICT)
  const { previous, settings } = input
  // A month is frozen for a pair of currencies: moved away and back, the pair's old rows would be
  // read by a reckoning that has since changed. Every one is let go (MOL-73, В-8).
  if (
    previous.incomeCurrency !== settings.incomeCurrency ||
    previous.spendCurrency !== settings.spendCurrency
  ) {
    await money.thaw(owner)
  }
  return actor
}

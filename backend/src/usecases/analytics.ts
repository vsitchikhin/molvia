import type { AnalyticsSetting, ChooseAnalytics } from '@molvia/model'
import type { EventRepository } from '@/db/events-repository'

/** `GET /actors/me/analytics` (MOL-96): whether the person has objected to being counted. */
export async function analyticsOf(
  events: Pick<EventRepository, 'analyticsOf'>,
  owner: string,
): Promise<AnalyticsSetting> {
  return events.analyticsOf(owner)
}

/**
 * `PUT /actors/me/analytics`, saved on the tap with no sheet (В-3): off erases the person's log and
 * stops it, and both gates leave them out; back on, the log starts afresh.
 */
export async function chooseAnalytics(
  events: Pick<EventRepository, 'chooseAnalytics'>,
  owner: string,
  { on }: ChooseAnalytics,
): Promise<AnalyticsSetting> {
  return events.chooseAnalytics(owner, !on)
}

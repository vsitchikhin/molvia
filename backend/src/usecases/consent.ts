import type { AcceptConsent, Actor, Consent } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'

/** `GET /actors/me/consent` (MOL-95): the edition of the terms and the privacy page accepted. */
export async function consentOf(
  actors: Pick<ActorRepository, 'consentVersion'>,
  owner: Pick<Actor, 'id'>,
): Promise<Consent> {
  return { version: await actors.consentVersion(owner.id) }
}

/**
 * `PUT /actors/me/consent` (MOL-95): the edition the screen showed, accepted now. Which one to ask
 * about is the phone's — its build shows the text (Р-3) — so the answer is the edition on the row,
 * which an older build's acceptance never lowers.
 */
export async function acceptConsent(
  actors: Pick<ActorRepository, 'acceptConsent'>,
  owner: Pick<Actor, 'id'>,
  { version }: AcceptConsent,
): Promise<Consent> {
  return { version: await actors.acceptConsent(owner.id, version) }
}

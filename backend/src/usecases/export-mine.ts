import { DomainError, ERROR, EXPORT_FORMAT, EXPORT_VERSION } from '@molvia/model'
import type { ExportFile } from '@molvia/model'
import type { ExportRepository } from '@/db/export-repository'

/**
 * «Скачать мои данные» (MOL-93): the owner's own and nobody else's — there is no parameter with
 * which to name another. An owner erased between the session check and the read is the same
 * answer as any request without one.
 */
export async function exportMine(
  repository: ExportRepository,
  actorId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<ExportFile> {
  const content = await repository.exportOf(actorId, sessionId)
  if (content === null) throw new DomainError(ERROR.NO_ACTOR)
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, ...content }
}

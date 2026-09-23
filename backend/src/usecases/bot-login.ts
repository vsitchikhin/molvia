import { DomainError, ERROR } from '@molvia/model'
import type { LoginPreview, TelegramUserId } from '@molvia/model'
import type { LoginRequestRepository } from '@/db/login-requests-repository'

export async function previewLogin(
  requests: LoginRequestRepository,
  code: string,
): Promise<LoginPreview> {
  const request = await requests.byCode(code)
  if (!request) throw new DomainError(ERROR.LOGIN_UNAVAILABLE)
  return {
    deviceName: request.deviceName,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  }
}

export async function confirmLogin(
  requests: LoginRequestRepository,
  code: string,
  telegramUserId: TelegramUserId,
): Promise<void> {
  if (!(await requests.confirm(code, telegramUserId)))
    throw new DomainError(ERROR.LOGIN_UNAVAILABLE)
}

export async function declineLogin(requests: LoginRequestRepository, code: string): Promise<void> {
  if (!(await requests.decline(code))) throw new DomainError(ERROR.LOGIN_UNAVAILABLE)
}

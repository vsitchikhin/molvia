import { createActorRepository } from './actors-repository'
import { createLoginRequestRepository } from './login-requests-repository'
import { createSessionRepository } from './sessions-repository'
import type { ActorRepository } from './actors-repository'
import type { LoginRequestRepository } from './login-requests-repository'
import type { SessionRepository } from './sessions-repository'
import type { Conn, Db } from './index'

export interface AuthRepositories {
  readonly actors: ActorRepository
  readonly sessions: SessionRepository
  readonly requests: LoginRequestRepository
}

export function authRepositories(conn: Conn): AuthRepositories {
  return {
    actors: createActorRepository(conn),
    sessions: createSessionRepository(conn),
    requests: createLoginRequestRepository(conn),
  }
}

export type AuthTransact = <T>(work: (repositories: AuthRepositories) => Promise<T>) => Promise<T>

export function authTransactOn(db: Db): AuthTransact {
  return (work) => db.transaction((tx) => work(authRepositories(tx)))
}

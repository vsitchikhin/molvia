import { DomainError, ERROR, SESSION_COOKIE } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { clearSessionCookie, readCookieValues, setSessionCookie } from '@/cookie'
import type { Authenticated } from '@/usecases/authenticate'

/** Turning a session token into the owner behind it — the use case, already bound. */
export type SessionLookup = (token: string) => Promise<Authenticated>

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Both are set by `withActor` before anything else runs, and both come from the same
     * single read: `actorId` is what every later use case takes (MOL-12, MOL-21, MOL-27),
     * `actor` is there so the one route that returns the owner does not fetch it twice.
     */
    actorId: string
    actor: Actor | null
  }
}

/**
 * The one place a request is turned into an owner. A hook over a whole scope rather than a
 * line in each handler: a check that can be forgotten in one route out of ten is exactly
 * what IDOR is, and the repositories of MOL-7 already expect a trustworthy `actorId` in
 * every `WHERE`.
 *
 * On `onRequest`, which runs **before the body is read**. As a `preHandler` it ran after:
 * a stranger's megabyte was buffered and parsed before being refused, and a large enough
 * body answered 413 instead of 401 — so what an uninvited caller learned depended on what
 * it sent rather than on the door.
 *
 * **What it reads changed in MOL-53 and what it proves did not.** It used to be a header
 * carrying `actors.id` — a name and a password in one value. It is now a session token, which
 * is a secret of its own and can be thrown away without touching the account behind it; the
 * owner it yields is the same `actors.id` the rest of the server has always worked with.
 */
export function withActor(app: FastifyInstance, lookup: SessionLookup): void {
  app.decorateRequest('actorId', '')
  app.decorateRequest('actor', null)

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const sent = readCookieValues(request.headers.cookie, SESSION_COOKIE)

    // No cookie at all, a value this server could not have minted, a token nobody was issued,
    // one of a revoked session and one of an expired session all answer the same way on
    // purpose: a difference between them is how someone else's secrets get found by comparing
    // replies. The first case is decided here because there is nothing to look up; the rest
    // fail one `WHERE` in the repository and arrive as the same refusal.
    //
    // **More than one cookie of this name is refused outright** (MOL-53, А2). A browser sends
    // the more specific path first, so whatever can set a cookie on this host — a sibling app on
    // another port in development, a subdomain or an XSS later — used to be able to put its own
    // session in front of the real one and have the server answer as it. «Which of these is
    // ours» has no honest answer, and guessing it wrong means the person's purchases go into
    // somebody else's account.
    if (sent.length !== 1) throw new DomainError(ERROR.NO_ACTOR)
    const token = sent[0] ?? ''

    let authenticated: Authenticated
    try {
      authenticated = await lookup(token)
    } catch (error) {
      // The cookie that was refused is put out with the refusal (Р-4): a dead secret stops
      // riding on every request and stops sitting on the disk. Three conditions, and each one
      // is load-bearing:
      //
      // - only «there is no such session» — a database that is down is not a reason to log a
      //   person out of a browser they will still be holding when it comes back;
      // - only this server's own refusal reaches here, so a 401 from Caddy or from a shop's
      //   captive portal can never drop a live session;
      // - and only when **exactly one** cookie arrived, which is why the refusal above returns
      //   before this line. `Set-Cookie` addresses a name, a path and a domain, not the value
      //   that was rejected — so with two cookies in flight it would delete ours, the one at
      //   `Path=/`, and leave the foreign one at its deeper path untouched (А3). That turns a
      //   fixation attempt into a permanent lockout, which is worse than the 401 it answers.
      if (error instanceof DomainError && error.code === ERROR.NO_ACTOR) clearSessionCookie(reply)
      throw error
    }

    request.actor = authenticated.actor
    request.actorId = authenticated.actor.id

    // The sliding term, and it is set here rather than by the use case because a use case knows
    // nothing about HTTP. `setSessionCookie` sends `no-store` with it, so whichever handle this
    // request happened to be — `/advice`, `/trips/current` — that reply is not cached.
    if (authenticated.refreshedUntil) {
      setSessionCookie(reply, token, authenticated.refreshedUntil)
    }
  })
}

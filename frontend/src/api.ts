import { createClient } from '@molvia/client'
import { currentIdentity } from '@/stores/identity'

// The identifier comes from one place in memory, not from storage: a device that cannot
// write `localStorage` still has an identity for this session, and reading storage here
// would send every request without it while the app believed it was fine.
//
// Vite proxies /api to this copy's API port, so the origin is never hardcoded.
export const api = createClient({ baseUrl: '/api', actorId: currentIdentity })

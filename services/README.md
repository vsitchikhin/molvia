# services

Anything that is not a TypeScript workspace. The split from `apps/` is deliberate:
a different runtime is a different boundary, and it should be visible in the tree
rather than only in the docs.

Nothing here is part of the npm workspaces, and nothing here may reach the database
directly — the API is the only write path.

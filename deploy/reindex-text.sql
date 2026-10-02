-- Rebuilds every index whose key is text or an expression, by the rules of the libc the database
-- runs under now — the same block as migration 0038_pgvector, for the moves a migration cannot make:
-- back to alpine after a rolled-back deploy whose old API wrote meanwhile under glibc (round 3 of the
-- adversarial review of MOL-105, Ж), or a later tag that moves glibc, before its migration exists.
--
--   ssh molvia 'cd ~/molvia && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U molvia -d molvia -v ON_ERROR_STOP=1' < deploy/reindex-text.sql
--
-- One transaction: a unique key that refuses — two rows one place under these rules — names the
-- pair and leaves every index as it was; the pair is settled by hand and the file run again.
BEGIN;
DO $$
DECLARE
  target regclass;
BEGIN
  FOR target IN
    SELECT i.indexrelid::regclass
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (i.indexprs IS NOT NULL
        OR EXISTS (SELECT 1 FROM unnest(i.indcollation::oid[]) AS coll(id) WHERE coll.id <> 0))
  LOOP
    EXECUTE format('REINDEX INDEX %s', target);
  END LOOP;
END $$;
COMMIT;

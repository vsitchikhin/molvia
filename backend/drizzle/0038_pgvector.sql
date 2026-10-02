-- pgvector, for the embeddings of MOL-105, and the move off musl that comes with its image.
--
-- `vector` is not in postgres:17-alpine, so the image is now pgvector/pgvector on Debian
-- bookworm. The data directory is the same Postgres 17 and needs no dump, but glibc orders and
-- folds text otherwise than musl did: every index whose key is text — a primary key of codes, a
-- trigram over `search_key`, the unique `lower()` of a place's name — was built by the old
-- rules and would answer by the new ones, wrongly and silently. So they are rebuilt here, on
-- every database the migration reaches: production, each working copy's volume, a fresh one
-- (where they are empty and it costs nothing).
--
-- The extension comes first on purpose: a database still on the old image fails here, loudly,
-- rather than passing on with indexes that lie.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
-- `REINDEX SCHEMA` refuses to run inside a transaction, and the migrations run in one;
-- `REINDEX INDEX` does not. An index counts if a column of its key has a collation or if the
-- key is an expression — `lower()` folds by the ctype as well.
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
--> statement-breakpoint
-- ICU came with the image too, in another version, and every ICU collation remembers the one it
-- was created with: «Что брать» sorting by `und-x-icu` (MOL-31) warned on every query. Nothing
-- is indexed by an ICU collation, so there is nothing to rebuild before saying the new version
-- is the one.
--
-- The database's own libc collation is left without a version, as musl left it: Postgres refuses
-- a change from none to one (`invalid collation version change`), and none means it is not
-- checked. A later glibc arrives only with a new tag of the image, by hand — and then these
-- indexes are rebuilt the same way (deploy/README.md).
DO $$
DECLARE
  target oid;
BEGIN
  FOR target IN
    SELECT oid FROM pg_collation
    WHERE collprovider = 'i' AND collversion IS DISTINCT FROM pg_collation_actual_version(oid)
  LOOP
    EXECUTE format('ALTER COLLATION %s REFRESH VERSION', target::regcollation);
  END LOOP;
END $$;

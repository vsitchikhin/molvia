-- What a rolled-back deploy's window let in twice (MOL-105, adversarial rounds 3 and 5): the old API,
-- up on glibc over the indexes musl built, missed rows of its own unique keys and wrote a second one.
-- Run on alpine, before deploy/reindex-text.sql, which refuses while such a pair is there:
--
--   ssh molvia 'cd ~/molvia && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U molvia -d molvia -v ON_ERROR_STOP=1' < deploy/window-duplicates.sql
--
-- Index scans are off throughout: the indexes are the broken ones, and asked, they find no pair.
BEGIN;
SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

-- Search picks are merged as their own upsert merges a repeat: the picks summed, the latest moment,
-- the person's own word kept if either row was one.
CREATE TEMP TABLE merged_picks ON COMMIT DROP AS
  SELECT actor_id, query_key, item_id,
         sum(picks)::int AS picks, max(last_picked_at) AS last_picked_at, bool_or(admits) AS admits
  FROM search_picks
  GROUP BY actor_id, query_key, item_id
  HAVING count(*) > 1;
DELETE FROM search_picks s
  USING merged_picks m
  WHERE s.actor_id = m.actor_id AND s.query_key = m.query_key AND s.item_id = m.item_id;
INSERT INTO search_picks (actor_id, query_key, item_id, picks, last_picked_at, admits)
  SELECT actor_id, query_key, item_id, picks, last_picked_at, admits FROM merged_picks;

-- A login request lives five minutes: a code written twice is a login to begin again.
DELETE FROM login_requests
  WHERE code IN (SELECT code FROM login_requests GROUP BY code HAVING count(*) > 1);

-- Everything else is named, never merged here: a place carries trips and verdicts, and two of one
-- shop are made one by hand (deploy/README.md, step 6). Every unique index whose key is text or an
-- expression, grouped by its own key as the index defines it — and over the rows it holds unique: a
-- partial index's own condition, and no key that is null unless the index takes nulls as equal.
-- Grouped plainly, the own spending categories of one person (`preset` null, outside the partial
-- index) were «a pair» for good (adversarial round 6, И).
DO $$
DECLARE
  target record;
  pair record;
BEGIN
  FOR target IN
    SELECT i.indexrelid::regclass AS index_name, i.indrelid::regclass AS table_name,
           (SELECT string_agg(pg_get_indexdef(i.indexrelid, k, true), ', ' ORDER BY k)
              FROM generate_series(1, i.indnkeyatts) AS k) AS key,
           concat_ws(' AND ',
             '(' || pg_get_expr(i.indpred, i.indrelid) || ')',
             CASE WHEN NOT i.indnullsnotdistinct THEN
               (SELECT string_agg('(' || pg_get_indexdef(i.indexrelid, k, true) || ') IS NOT NULL', ' AND ')
                  FROM generate_series(1, i.indnkeyatts) AS k)
             END) AS held
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND i.indisunique
      AND (i.indexprs IS NOT NULL
        OR EXISTS (SELECT 1 FROM unnest(i.indcollation::oid[]) AS coll(id) WHERE coll.id <> 0))
  LOOP
    FOR pair IN EXECUTE format(
      'SELECT row(%s)::text AS key, count(*) AS rows FROM %s WHERE %s GROUP BY %s HAVING count(*) > 1',
      target.key, target.table_name, coalesce(nullif(target.held, ''), 'true'), target.key)
    LOOP
      RAISE NOTICE 'twice in %: % (% rows)', target.index_name, pair.key, pair.rows;
    END LOOP;
  END LOOP;
END $$;
COMMIT;

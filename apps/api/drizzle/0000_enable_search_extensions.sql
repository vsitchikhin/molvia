-- Catalogue search is the product's main screen, and Postgres does the work:
-- pg_trgm for typos, unaccent for stripping diacritics.
--
-- They live in a migration rather than in an init script so that the schema has one
-- source of truth and a fresh database is identical everywhere — local copy, CI, server.
--
-- Note for whoever wires up search: unaccent does NOT transliterate Cyrillic to Latin.
-- It only removes diacritics, so "malako" will not reach "молоко" through it. That is an
-- open decision, deliberately not made here — see the integration test that pins the
-- current behaviour.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

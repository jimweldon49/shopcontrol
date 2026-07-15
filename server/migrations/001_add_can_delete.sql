-- Run this ONLY if you already set up the database from an earlier version
-- of schema.sql that didn't have the can_delete column yet.
--
--   psql -h <host> -U shopapp -d concept_shop_control -f migrations/001_add_can_delete.sql
--
-- Safe to run more than once.

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT TRUE;

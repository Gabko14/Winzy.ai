-- Initial migration. Establishes the migration pipeline itself; feature
-- beads (habits, auth, social, ...) add real tables in later migrations.
--
-- gen_random_uuid() ships in Postgres core since 13, so no extension is
-- strictly required on postgres:17-alpine, but pgcrypto is enabled
-- defensively in case a later migration needs one of its other functions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

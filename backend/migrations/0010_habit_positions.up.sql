-- Habit ordering (winzy.ai-mtje): per-user position for stable list reorder.
-- No DEFAULT — the insert path computes COALESCE(MAX(position), -1) + 1.
-- Backfill covers ALL habits including archived (0-based, created_at then id).
ALTER TABLE habits ADD COLUMN position integer;

UPDATE habits AS h
SET position = sub.rn - 1
FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
    FROM habits
) AS sub
WHERE h.id = sub.id;

ALTER TABLE habits ALTER COLUMN position SET NOT NULL;

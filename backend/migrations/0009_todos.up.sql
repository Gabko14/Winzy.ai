-- Todos module (winzy.ai-30sf.1): one-off tasks alongside habits.
-- user_id intentionally carries no foreign key to users(id) — same stance
-- as habits/completions (see 0003_habits.up.sql). Cascade cleanup on
-- account deletion is handled at the application layer via the
-- events.UserDeleted hook.
CREATE TABLE todos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    title varchar(256) NOT NULL,
    due_date date NULL,
    position integer NOT NULL,
    completed_at timestamptz NULL
);

CREATE INDEX ix_todos_user_id ON todos (user_id);
